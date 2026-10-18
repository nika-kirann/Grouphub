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
    this.removeImageFiles(id);
    this.save(); return this.data.groups.length < n;
  }
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
  async addReport(groupId, reason, details, reporter) {
    const r = { id: this.id(), groupId, reason, details, reporter, createdAt: new Date().toISOString() };
    this.data.reports.push(r); this.save(); return r;
  }
  async reportsFor(groupId) { return this.data.reports.filter((r) => r.groupId === groupId); }
  async reportCounts() { const c = {}; this.data.reports.forEach((r) => { c[r.groupId] = (c[r.groupId] || 0) + 1; }); return c; }
  async clearReports(groupId) { const n = this.data.reports.length; this.data.reports = this.data.reports.filter((r) => r.groupId !== groupId); this.save(); return n - this.data.reports.length; }
}
module.exports = JsonStore;
