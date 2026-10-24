'use strict';
// First-party, privacy-friendly traffic stats.
// - Counted from a small same-origin beacon (/beacon.js) on public pages only (homepage + approved group pages),
//   so /admin, /api, static files, /healthz (UptimeRobot), robots.txt, sitemap.xml and sw.js never count.
// - Obvious bots are dropped by user-agent (and the beacon skips automated browsers).
// - No raw IPs or visitor IDs are stored. A visitor is identified by a first-party random ID kept in the browser's
//   localStorage (or, if storage is blocked, by IP + user-agent), and only a salted hash of it is kept. The salt rotates
//   daily (HMAC of a secret + the date), so hashes from different days can't be linked.
// - "Online now" = distinct visitors seen in the last 5 minutes (page views + 60s heartbeats), kept in memory only.
// - Writes are batched: hits are buffered in memory and flushed to the store about once a minute.
const crypto = require('crypto');

const BOT_RE = /bot\b|bot\/|crawl|spider|slurp|scraper|monitor|uptime|pingdom|lighthouse|pagespeed|headless|phantom|puppeteer|playwright|selenium|preview|facebookexternalhit|embedly|curl|wget|python|httpx|aiohttp|java\/|okhttp|go-http|node-fetch|axios|libwww|postman|insomnia|validator/i;
const ONLINE_MS = 5 * 60e3;
const KEEP_DAYS = 90;
const MAX_ONLINE = 50000;

function isBot(ua) { return !ua || ua.length < 20 || BOT_RE.test(ua); }

/** 'YYYY-MM-DD' for a Date in the given IANA time zone. */
function dayOf(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
/** Add n days to a 'YYYY-MM-DD' string. */
function addDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

class Analytics {
  /**
   * @param {object} o
   * @param {object} o.store      storage with getSetting/setSetting + stats* methods (lib/store.js, lib/pg-store.js)
   * @param {function} o.pageKey  async (path) -> 'home' | 'g:<id>' | null (null = not a countable page)
   * @param {string} [o.tz]       time zone for daily buckets
   * @param {function} [o.now]    clock (tests)
   */
  constructor({ store, pageKey, tz, now }) {
    this.store = store; this.pageKey = pageKey; this.tz = tz || 'Asia/Kolkata'; this.now = now || (() => Date.now());
    this.pending = new Map(); // day -> { pv, hashes: Map<hash, isNew>, pages: Map<key, n> }
    this.online = new Map();  // stable in-memory visitor key -> last seen ms
    this.secret = null; this.startedDay = null; this.lastPrune = null; this.flushing = null;
  }
  async init() {
    let s = await this.store.getSetting('analytics_secret', null);
    if (typeof s !== 'string' || s.length < 32) { s = crypto.randomBytes(32).toString('hex'); await this.store.setSetting('analytics_secret', s); }
    this.secret = s;
    this.startedDay = await this.store.getSetting('analytics_started', null);
    if (!this.startedDay) { this.startedDay = this.today(); await this.store.setSetting('analytics_started', this.startedDay); }
  }
  today() { return dayOf(new Date(this.now()), this.tz); }
  hmac(...parts) { return crypto.createHmac('sha256', this.secret).update(parts.join('\n')).digest('hex'); }

  /**
   * Record one beacon. Returns true if it counted (pageview or heartbeat), false if dropped.
   * @param {{type:'pv'|'hb', path:string, vid?:string, isNew?:boolean, ip:string, ua:string}} h
   */
  async hit(h) {
    if (!this.secret || isBot(h.ua)) return false;
    const type = h.type === 'hb' ? 'hb' : 'pv';
    const key = await this.pageKey(String(h.path || ''));
    if (!key) return false;
    const vid = typeof h.vid === 'string' && /^[a-f0-9]{32}$/.test(h.vid) ? 'v:' + h.vid : 'ipua:' + h.ip + '|' + h.ua;
    const now = this.now();
    // Online now (memory only; never persisted). Not day-rotated so a visitor isn't counted twice at midnight.
    const okey = this.hmac('online', vid).slice(0, 16);
    if (!this.online.has(okey) && this.online.size >= MAX_ONLINE) this.pruneOnline();
    this.online.set(okey, now);
    if (type === 'hb') return true;
    const day = this.today();
    const vhash = this.hmac('day', day, vid).slice(0, 16); // daily-rotating salted hash
    let p = this.pending.get(day);
    if (!p) { p = { pv: 0, hashes: new Map(), pages: new Map() }; this.pending.set(day, p); }
    p.pv++;
    p.hashes.set(vhash, p.hashes.get(vhash) || !!h.isNew || !vid.startsWith('v:'));
    p.pages.set(key, (p.pages.get(key) || 0) + 1);
    return true;
  }
  pruneOnline() { const cut = this.now() - ONLINE_MS; for (const [k, t] of this.online) if (t < cut) this.online.delete(k); }
  onlineNow() { this.pruneOnline(); return this.online.size; }

  /** Write buffered hits to the store (one small batch per day). Safe to call often. */
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const batch = this.pending; this.pending = new Map();
      for (const [day, p] of batch) {
        try {
          await this.store.statsFlush(day, { pageviews: p.pv, hashes: [...p.hashes].map(([hash, isNew]) => ({ hash, isNew })), pages: [...p.pages] });
        } catch (e) {
          console.error('[stats] flush failed, will retry:', e.message);
          this.merge(day, p);
        }
      }
      const today = this.today();
      if (this.lastPrune !== today) {
        try { await this.store.statsPrune(addDays(today, -KEEP_DAYS)); this.lastPrune = today; } catch (e) { console.error('[stats] prune failed:', e.message); }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  merge(day, p) {
    let q = this.pending.get(day);
    if (!q) { this.pending.set(day, p); return; }
    q.pv += p.pv;
    for (const [h, n] of p.hashes) q.hashes.set(h, q.hashes.get(h) || n);
    for (const [k, n] of p.pages) q.pages.set(k, (q.pages.get(k) || 0) + n);
  }

  /** Everything the admin Traffic panel needs. */
  async summary() {
    await this.flush();
    const today = this.today(), from30 = addDays(today, -29), from7 = addDays(today, -6);
    const rows = new Map((await this.store.statsDays(from30)).map((r) => [r.day, r]));
    const days = [];
    for (let d = from30; d <= today; d = addDays(d, 1)) {
      const r = rows.get(d) || {};
      days.push({ day: d, pageviews: r.pageviews || 0, visitors: r.visitors || 0, newVisitors: r.newVisitors || 0 });
    }
    const sum = (list, k) => list.reduce((a, r) => a + r[k], 0);
    const last7 = days.filter((r) => r.day >= from7);
    const range = (list) => ({ visitors: sum(list, 'visitors'), pageviews: sum(list, 'pageviews'), newVisitors: sum(list, 'newVisitors') });
    const totals = await this.store.statsTotals();
    return {
      tz: this.tz, today, startedDay: this.startedDay, onlineNow: this.onlineNow(), onlineWindowMin: ONLINE_MS / 60e3,
      todayStats: range(days.slice(-1)), last7: range(last7), last30: range(days),
      allTime: { visitors: totals.newVisitors, pageviews: totals.pageviews },
      days,
      topToday: await this.store.statsPages(today, 10),
      top7: await this.store.statsPages(from7, 10)
    };
  }
}

module.exports = { Analytics, isBot, dayOf, addDays, ONLINE_MS, KEEP_DAYS };
