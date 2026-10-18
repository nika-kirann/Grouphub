'use strict';
// Tiny JSON-file store. Writes atomically (write temp file, then rename) and serialises writes.
// Fine for a small directory; swap for SQLite/Postgres when traffic grows.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(file, seed) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      this.data = { groups: [], reports: [] };
      if (typeof seed === 'function') seed(this);
      this.save();
    }
  }
  save() {
    const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
  id() { return crypto.randomBytes(6).toString('hex'); }

  groups(filter) { return this.data.groups.filter(filter || (() => true)); }
  group(id) { return this.data.groups.find((g) => g.id === id); }
  findByKey(key) { return this.data.groups.find((g) => g.linkKey === key); }
  addGroup(fields) {
    const now = new Date().toISOString();
    const g = Object.assign({ id: this.id(), status: 'pending', featured: false, members: null, sample: false, createdAt: now, updatedAt: now }, fields);
    this.data.groups.push(g); this.save(); return g;
  }
  updateGroup(id, fields) {
    const g = this.group(id); if (!g) return null;
    Object.assign(g, fields, { updatedAt: new Date().toISOString() }); this.save(); return g;
  }
  deleteGroup(id) {
    const n = this.data.groups.length;
    this.data.groups = this.data.groups.filter((g) => g.id !== id);
    this.data.reports = this.data.reports.filter((r) => r.groupId !== id);
    this.save(); return this.data.groups.length < n;
  }
  addReport(groupId, reason, details, reporter) {
    const r = { id: this.id(), groupId, reason, details, reporter, createdAt: new Date().toISOString() };
    this.data.reports.push(r); this.save(); return r;
  }
  reportsFor(groupId) { return this.data.reports.filter((r) => r.groupId === groupId); }
  reportCounts() { const c = {}; this.data.reports.forEach((r) => { c[r.groupId] = (c[r.groupId] || 0) + 1; }); return c; }
  clearReports(groupId) { const n = this.data.reports.length; this.data.reports = this.data.reports.filter((r) => r.groupId !== groupId); this.save(); return n - this.data.reports.length; }
}
module.exports = Store;
