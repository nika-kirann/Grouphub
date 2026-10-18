'use strict';
// JSON-file store (fallback when DATABASE_URL is not set). Writes atomically (temp file + rename).
// All methods are async so this is interchangeable with lib/pg-store.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class JsonStore {
  constructor(file) { this.file = file; this.kind = 'json'; }
  async init({ seed } = {}) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { groups: [], reports: [] };
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
    const g = Object.assign({ id: this.id(), status: 'pending', featured: false, members: null, sample: false, desc: '', createdAt: now, updatedAt: now }, fields);
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
    this.save(); return this.data.groups.length < n;
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
