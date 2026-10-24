'use strict';
// PostgreSQL store (used when DATABASE_URL is set), e.g. Supabase. Same async interface as lib/store.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const COLS = { name: 'name', cat: 'cat', country: 'country', lang: 'lang', plat: 'plat', link: 'link', linkKey: 'link_key',
  desc: 'description', members: 'members', status: 'status', featured: 'featured', sample: 'sample', submitter: 'submitter',
  imageVersion: 'image_version', imageStatus: 'image_status', imageError: 'image_error', imageCheckedAt: 'image_checked_at',
  autoApproved: 'auto_approved', holdReason: 'hold_reason',
  createdAt: 'created_at', updatedAt: 'updated_at' };
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
function toGroup(r) {
  return { id: r.id, name: r.name, cat: r.cat, country: r.country, lang: r.lang, plat: r.plat, link: r.link, linkKey: r.link_key,
    desc: r.description, members: r.members, status: r.status, featured: r.featured, sample: r.sample, submitter: r.submitter,
    imageVersion: r.image_version, imageStatus: r.image_status, imageError: r.image_error, imageCheckedAt: iso(r.image_checked_at),
    autoApproved: !!r.auto_approved, holdReason: r.hold_reason,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}
function toReport(r) { return { id: r.id, groupId: r.group_id, reason: r.reason, details: r.details, reporter: r.reporter, createdAt: iso(r.created_at) }; }

class PgStore {
  constructor(url) {
    this.kind = 'postgres';
    // Remove any sslmode=... from the URL so our explicit ssl option below is the one that applies.
    const u = new URL(url); u.searchParams.delete('sslmode');
    const ssl = process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false }; // Supabase pooler certs
    this.pool = new Pool({ connectionString: u.toString(), ssl, max: parseInt(process.env.DATABASE_POOL_MAX, 10) || 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
    this.pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  }
  id() { return crypto.randomBytes(6).toString('hex'); }
  q(text, params) { return this.pool.query(text, params); }
  async init({ seed } = {}) {
    await this.q(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
    if (seed) {
      const { rows } = await this.q('select count(*)::int as n from groups');
      if (rows[0].n === 0) for (const g of seed) await this.addGroup(g);
    }
  }
  async ping() { await this.q('select 1'); return true; }
  async close() { await this.pool.end(); }

  async groups(filter) { const { rows } = await this.q('select * from groups order by created_at desc'); const list = rows.map(toGroup); return filter ? list.filter(filter) : list; }
  async group(id) { const { rows } = await this.q('select * from groups where id = $1', [id]); return rows[0] ? toGroup(rows[0]) : null; }
  async findByKey(key) { const { rows } = await this.q('select * from groups where link_key = $1', [key]); return rows[0] ? toGroup(rows[0]) : null; }
  async addGroup(fields) {
    const now = new Date().toISOString();
    const g = Object.assign({ id: this.id(), status: 'pending', featured: false, members: null, sample: false, desc: '', submitter: null, autoApproved: false, createdAt: now, updatedAt: now }, fields);
    const keys = Object.keys(COLS);
    const sql = `insert into groups (id, ${keys.map((k) => COLS[k]).join(', ')}) values ($1, ${keys.map((_, i) => '$' + (i + 2)).join(', ')}) returning *`;
    const { rows } = await this.q(sql, [g.id, ...keys.map((k) => (g[k] === undefined ? null : g[k]))]);
    return toGroup(rows[0]);
  }
  async updateGroup(id, fields) {
    const sets = [], vals = [];
    Object.keys(fields).forEach((k) => { if (COLS[k] && k !== 'createdAt' && k !== 'updatedAt') { vals.push(fields[k]); sets.push(`${COLS[k]} = $${vals.length}`); } });
    vals.push(id);
    const { rows } = await this.q(`update groups set ${sets.concat('updated_at = now()').join(', ')} where id = $${vals.length} returning *`, vals);
    return rows[0] ? toGroup(rows[0]) : null;
  }
  async deleteGroup(id) { const r = await this.q('delete from groups where id = $1', [id]); return r.rowCount > 0; }
  async addReport(groupId, reason, details, reporter) {
    const { rows } = await this.q('insert into reports (id, group_id, reason, details, reporter) values ($1, $2, $3, $4, $5) returning *', [this.id(), groupId, reason, details || '', reporter]);
    return toReport(rows[0]);
  }
  async reportsFor(groupId) { const { rows } = await this.q('select * from reports where group_id = $1 order by created_at desc', [groupId]); return rows.map(toReport); }
  async reportCounts() { const { rows } = await this.q('select group_id, count(*)::int as n from reports group by group_id'); const c = {}; rows.forEach((r) => { c[r.group_id] = r.n; }); return c; }
  // ----- settings -----
  async getSetting(key, fallback) { const { rows } = await this.q('select value from settings where key = $1', [key]); return rows[0] ? rows[0].value : fallback; }
  async setSetting(key, value) {
    await this.q('insert into settings (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, JSON.stringify(value)]);
    return value;
  }
  // ----- profile pictures -----
  async setImage(id, data, type) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const { rows } = await c.query("update groups set image_version = coalesce(image_version, 0) + 1, image_status = 'ok', image_error = null, image_checked_at = now() where id = $1 returning image_version", [id]);
      if (!rows[0]) { await c.query('rollback'); return null; }
      const v = rows[0].image_version;
      await c.query('insert into group_images (group_id, content_type, data, version, updated_at) values ($1, $2, $3, $4, now()) on conflict (group_id) do update set content_type = excluded.content_type, data = excluded.data, version = excluded.version, updated_at = now()', [id, type, data, v]);
      await c.query('commit'); return v;
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  }
  async getImage(id) {
    const { rows } = await this.q('select content_type, data, version from group_images where group_id = $1', [id]);
    return rows[0] ? { type: rows[0].content_type, data: rows[0].data, version: rows[0].version } : null;
  }
  async clearImage(id) {
    await this.q('delete from group_images where group_id = $1', [id]);
    await this.q('update groups set image_version = null, image_status = null, image_error = null, image_checked_at = null where id = $1', [id]);
  }
  // ----- traffic stats (see lib/analytics.js): one small transaction per day per flush -----
  async statsFlush(day, { pageviews, hashes, pages }) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const { rows } = hashes.length
        ? await c.query('insert into stats_visitors (day, vhash) select $1::date, unnest($2::text[]) on conflict do nothing returning vhash', [day, hashes.map((x) => x.hash)])
        : { rows: [] };
      const isNew = new Set(hashes.filter((x) => x.isNew).map((x) => x.hash));
      const visitors = rows.length, newVisitors = rows.filter((r) => isNew.has(r.vhash)).length;
      await c.query(`insert into stats_daily (day, pageviews, visitors, new_visitors) values ($1::date, $2, $3, $4)
        on conflict (day) do update set pageviews = stats_daily.pageviews + excluded.pageviews, visitors = stats_daily.visitors + excluded.visitors,
        new_visitors = stats_daily.new_visitors + excluded.new_visitors`, [day, pageviews, visitors, newVisitors]);
      if (pages.length) {
        await c.query(`insert into stats_pages (day, page, views) select $1::date, unnest($2::text[]), unnest($3::int[])
          on conflict (day, page) do update set views = stats_pages.views + excluded.views`, [day, pages.map((x) => x[0]), pages.map((x) => x[1])]);
      }
      await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  }
  async statsDays(fromDay) {
    const { rows } = await this.q("select to_char(day, 'YYYY-MM-DD') as day, pageviews, visitors, new_visitors from stats_daily where day >= $1::date order by day", [fromDay]);
    return rows.map((r) => ({ day: r.day, pageviews: r.pageviews, visitors: r.visitors, newVisitors: r.new_visitors }));
  }
  async statsTotals() {
    const { rows } = await this.q('select coalesce(sum(pageviews), 0)::bigint as pv, coalesce(sum(new_visitors), 0)::bigint as nv from stats_daily');
    return { pageviews: Number(rows[0].pv), newVisitors: Number(rows[0].nv) };
  }
  async statsPages(fromDay, limit) {
    const { rows } = await this.q('select page, sum(views)::int as views from stats_pages where day >= $1::date group by page order by views desc limit $2', [fromDay, limit]);
    return rows;
  }
  async statsPrune(beforeDay) {
    await this.q('delete from stats_visitors where day < $1::date', [beforeDay]);
    await this.q('delete from stats_pages where day < $1::date', [beforeDay]);
  }
  async clearReports(groupId) { const r = await this.q('delete from reports where group_id = $1', [groupId]); return r.rowCount; }
}
module.exports = PgStore;
