'use strict';
// JSON-file store (fallback when DATABASE_URL is not set). Writes atomically (temp file + rename).
// All methods are async so this is interchangeable with lib/pg-store.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };

class JsonStore {
  constructor(file) { this.file = file; this.kind = 'json'; this.imgDir = path.join(path.dirname(file), 'images'); }
  async init({ seed } = {}) {
    fs.mkdirSync(this.imgDir, { recursive: true });
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { groups: [], reports: [] };
    this.data.settings = this.data.settings || {};
    this.data.analytics = this.data.analytics || { daily: {}, visitors: {}, pages: {} };
    this.data.counts = this.data.counts || {};         // groupId -> { views, joins } (all time)
    this.data.countsSeen = this.data.countsSeen || {}; // day -> [daily-rotating visitor keys]
    if (seed && this.data.groups.length === 0) { seed.forEach((g) => this.data.groups.push(Object.assign({ id: this.id() }, g))); }
    this.save();
  }
  save() {
    const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
  id() { return crypto.randomBytes(6).toString('hex'); }
  async ping() { return true; }
  async close() {}

  async groups(filter) { return this.data.groups.filter(filter || (() => true)).map((g) => Object.assign({}, g)); }
  async group(id) { const g = this.data.groups.find((x) => x.id === id); return g ? Object.assign({}, g) : null; }
  async findByKey(key) { const g = this.data.groups.find((x) => x.linkKey === key); return g ? Object.assign({}, g) : null; }
  async addGroup(fields) {
    const now = new Date().toISOString();
    const g = Object.assign({ id: this.id(), status: 'pending', featured: false, members: null, sample: false, autoApproved: false, desc: '', createdAt: now, updatedAt: now }, fields);
    this.data.groups.push(g); this.save(); return Object.assign({}, g);
  }
  async updateGroup(id, fields) {
    const g = this.data.groups.find((x) => x.id === id); if (!g) return null;
    Object.assign(g, fields, { updatedAt: new Date().toISOString() }); this.save(); return Object.assign({}, g);
  }
  async deleteGroup(id) {
    const n = this.data.groups.length;
    this.data.groups = this.data.groups.filter((g) => g.id !== id);
    this.data.reports = this.data.reports.filter((r) => r.groupId !== id);
    delete this.data.counts[id];
    this.removeImageFiles(id);
    this.save(); return this.data.groups.length < n;
  }
  // ----- settings -----
  async getSetting(key, fallback) { return Object.prototype.hasOwnProperty.call(this.data.settings, key) ? this.data.settings[key] : fallback; }
  async setSetting(key, value) { this.data.settings[key] = value; this.save(); return value; }
  // ----- profile pictures (stored as data/images/<id>.<ext>) -----
  imgFile(id, type) { if (!/^[a-f0-9]{6,32}$/.test(id)) throw new Error('bad id'); return path.join(this.imgDir, id + '.' + (EXT[type] || 'bin')); }
  removeImageFiles(id) { Object.keys(EXT).forEach((t) => { try { fs.unlinkSync(this.imgFile(id, t)); } catch (e) { /* not there */ } }); }
  async setImage(id, data, type) {
    const g = this.data.groups.find((x) => x.id === id); if (!g) return null;
    this.removeImageFiles(id);
    const f = this.imgFile(id, type), tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, data); fs.renameSync(tmp, f);
    Object.assign(g, { imageVersion: (g.imageVersion || 0) + 1, imageType: type, imageStatus: 'ok', imageError: null, imageCheckedAt: new Date().toISOString() });
    this.save(); return g.imageVersion;
  }
  async getImage(id) {
    const g = this.data.groups.find((x) => x.id === id); if (!g || !g.imageVersion || !g.imageType) return null;
    try { return { type: g.imageType, data: fs.readFileSync(this.imgFile(id, g.imageType)), version: g.imageVersion }; } catch (e) { return null; }
  }
  async clearImage(id) {
    const g = this.data.groups.find((x) => x.id === id); if (!g) return;
    this.removeImageFiles(id);
    Object.assign(g, { imageVersion: null, imageType: null, imageStatus: null, imageError: null, imageCheckedAt: null }); this.save();
  }
  // ----- traffic stats (see lib/analytics.js) -----
  async statsFlush(day, { pageviews, hashes, pages }) {
    const A = this.data.analytics;
    const d = A.daily[day] || (A.daily[day] = { pageviews: 0, visitors: 0, newVisitors: 0 });
    const seen = new Set(A.visitors[day] || []);
    for (const { hash, isNew } of hashes) { if (!seen.has(hash)) { seen.add(hash); d.visitors++; if (isNew) d.newVisitors++; } }
    A.visitors[day] = [...seen];
    d.pageviews += pageviews;
    const pg = A.pages[day] || (A.pages[day] = {});
    for (const [k, n] of pages) pg[k] = (pg[k] || 0) + n;
    this.save();
  }
  async statsDays(fromDay) { return Object.entries(this.data.analytics.daily).filter(([d]) => d >= fromDay).map(([day, r]) => Object.assign({ day }, r)).sort((a, b) => a.day.localeCompare(b.day)); }
  async statsTotals() { return Object.values(this.data.analytics.daily).reduce((a, r) => ({ pageviews: a.pageviews + r.pageviews, newVisitors: a.newVisitors + r.newVisitors }), { pageviews: 0, newVisitors: 0 }); }
  async statsPages(fromDay, limit) {
    const c = {}; Object.entries(this.data.analytics.pages).forEach(([d, pg]) => { if (d >= fromDay) Object.entries(pg).forEach(([k, n]) => { c[k] = (c[k] || 0) + n; }); });
    return Object.entries(c).map(([page, views]) => ({ page, views })).sort((a, b) => b.views - a.views).slice(0, limit);
  }
  async statsPrune(beforeDay) {
    const A = this.data.analytics; let n = 0;
    [A.visitors, A.pages].forEach((m) => Object.keys(m).forEach((d) => { if (d < beforeDay) { delete m[d]; n++; } }));
    if (n) this.save();
  }
  // ----- per-group view/join counters -----
  async countsFlush(day, items) {
    if (!items.length) return;
    const seen = new Set(this.data.countsSeen[day] || []), ids = new Set(this.data.groups.map((g) => g.id));
    for (const x of items) {
      if (seen.has(x.k)) continue;
      seen.add(x.k);
      if (!ids.has(x.gid)) continue;
      const c = this.data.counts[x.gid] || (this.data.counts[x.gid] = { views: 0, joins: 0 });
      c[x.kind === 'j' ? 'joins' : 'views']++;
    }
    this.data.countsSeen[day] = [...seen]; this.save();
  }
  async groupCounts() { const out = {}; Object.entries(this.data.counts).forEach(([id, c]) => { out[id] = { views: c.views, joins: c.joins }; }); return out; }
  async countsPrune(beforeDay) {
    let n = 0; Object.keys(this.data.countsSeen).forEach((d) => { if (d < beforeDay) { delete this.data.countsSeen[d]; n++; } });
    if (n) this.save();
  }
  async addReport(groupId, reason, details, reporter) {
    const r = { id: this.id(), groupId, reason, details, reporter, createdAt: new Date().toISOString() };
    this.data.reports.push(r); this.save(); return r;
  }
  async reportsFor(groupId) { return this.data.reports.filter((r) => r.groupId === groupId); }
  async reportCounts() { const c = {}; this.data.reports.forEach((r) => { c[r.groupId] = (c[r.groupId] || 0) + 1; }); return c; }
  async clearReports(groupId) { const n = this.data.reports.length; this.data.reports = this.data.reports.filter((r) => r.groupId !== groupId); this.save(); return n - this.data.reports.length; }
}
module.exports = JsonStore;
