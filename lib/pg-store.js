'use strict';
// PostgreSQL store (used when DATABASE_URL is set), e.g. Supabase. Same async interface as lib/store.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const COLS = { name: 'name', cat: 'cat', country: 'country', lang: 'lang', plat: 'plat', link: 'link', linkKey: 'link_key',
  desc: 'description', members: 'members', status: 'status', featured: 'featured', sample: 'sample', submitter: 'submitter',
  createdAt: 'created_at', updatedAt: 'updated_at' };
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
function toGroup(r) {
  return { id: r.id, name: r.name, cat: r.cat, country: r.country, lang: r.lang, plat: r.plat, link: r.link, linkKey: r.link_key,
    desc: r.description, members: r.members, status: r.status, featured: r.featured, sample: r.sample, submitter: r.submitter,
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
    const g = Object.assign({ id: this.id(), status: 'pending', featured: false, members: null, sample: false, desc: '', submitter: null, createdAt: now, updatedAt: now }, fields);
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
  async clearReports(groupId) { const r = await this.q('delete from reports where group_id = $1', [groupId]); return r.rowCount; }
}
module.exports = PgStore;
