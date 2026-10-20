'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const JsonStore = require('./lib/store');
const { sampleGroups } = require('./lib/seed');
const V = require('./lib/validate');

// ---------- config ----------
const PORT = parseInt(process.env.PORT, 10) || 8000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'grouphub.json');
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_HOURS = 8;

// Admin password: ADMIN_PASSWORD_HASH ("scrypt$<saltHex>$<hashHex>", made with `npm run hash-password`)
// or plain ADMIN_PASSWORD (hashed in memory at startup). Only hashes are ever compared.
let ADMIN = null;
(function setupAdmin() {
  if (process.env.ADMIN_PASSWORD_HASH) {
    const [alg, salt, hash] = process.env.ADMIN_PASSWORD_HASH.split('$');
    if (alg === 'scrypt' && salt && hash) ADMIN = { salt: Buffer.from(salt, 'hex'), hash: Buffer.from(hash, 'hex') };
  } else if (process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 10) {
      console.warn('[admin] ADMIN_PASSWORD must be at least 10 characters. Admin login is DISABLED.');
    } else {
      const salt = crypto.randomBytes(16);
      ADMIN = { salt, hash: crypto.scryptSync(process.env.ADMIN_PASSWORD, salt, 64) };
    }
  }
  if (!ADMIN) console.warn('[admin] No valid ADMIN_PASSWORD / ADMIN_PASSWORD_HASH set. /admin login is disabled.');
})();
function checkPassword(pw) {
  if (!ADMIN || typeof pw !== 'string' || pw.length > 200) return false;
  const h = crypto.scryptSync(pw, ADMIN.salt, ADMIN.hash.length);
  return crypto.timingSafeEqual(h, ADMIN.hash);
}

// ---------- storage ----------
// Postgres (e.g. Supabase) when DATABASE_URL is set; otherwise a local JSON file.
const store = process.env.DATABASE_URL
  ? new (require('./lib/pg-store'))(process.env.DATABASE_URL)
  : new JsonStore(DB_FILE);
// Any change to groups clears the cached server-rendered homepage.
['addGroup', 'updateGroup', 'deleteGroup', 'setImage', 'clearImage'].forEach((m) => {
  const orig = store[m].bind(store);
  store[m] = async (...args) => { const r = await orig(...args); homeCache = null; sitemapCache = null; approvedIdsCache = null; pageCache.clear(); return r; };
});

// ---------- traffic stats (first-party; see lib/analytics.js) ----------
const { Analytics } = require('./lib/analytics');
let approvedIdsCache = null; // { ids: Set, at }
async function approvedIds() {
  if (!approvedIdsCache || Date.now() - approvedIdsCache.at > 60e3) {
    approvedIdsCache = { ids: new Set((await store.groups((g) => g.status === 'approved')).map((g) => g.id)), at: Date.now() };
  }
  return approvedIdsCache.ids;
}
// Only the homepage and approved group pages count. Everything else (admin, API, assets, /healthz, robots, sitemap, sw.js, 404s) doesn't.
async function pageKey(p) {
  if (p === '/') return 'home';
  const m = /^\/group\/([^/]{1,200})$/.exec(p);
  if (!m) return null;
  let raw; try { raw = decodeURIComponent(m[1]); } catch (e) { return null; }
  const id = render.parseGroupParam(raw);
  return id && (await approvedIds()).has(id) ? 'g:' + id : null;
}
const analytics = new Analytics({ store, pageKey, tz: process.env.STATS_TZ || 'Asia/Kolkata' });
setInterval(() => analytics.flush().catch(() => {}), 60e3).unref();

// ---------- helpers ----------
function clientIp(req) { return req.ip || req.socket.remoteAddress || 'unknown'; }
// Set IP_HASH_SALT to keep report de-duplication stable across restarts (optional).
const HASH_SALT = process.env.IP_HASH_SALT || crypto.randomBytes(16).toString('hex');
function anonId(req) { return crypto.createHash('sha256').update(HASH_SALT + clientIp(req)).digest('hex').slice(0, 16); }

// Fixed-window in-memory rate limiter (per IP + bucket).
const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = name + ':' + clientIp(req), now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count++;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60e3).unref();

// Sessions: random token in an httpOnly cookie, server-side map. (Restart = logout.)
const sessions = new Map();
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function getSession(req) {
  const t = parseCookies(req).gh_admin; if (!t) return null;
  const s = sessions.get(t); if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(t); return null; }
  return Object.assign({ token: t }, s);
}
function cookie(res, value, maxAgeSec, req) {
  const secure = IS_PROD || req.secure ? '; Secure' : '';
  res.append('Set-Cookie', `gh_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`);
}
function requireAdmin(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in.' });
  if (req.method !== 'GET' && req.get('X-CSRF-Token') !== s.csrf) return res.status(403).json({ error: 'Bad CSRF token.' });
  req.session = s; next();
}

function publicGroup(g) {
  return { id: g.id, name: g.name, cat: g.cat, country: g.country, lang: g.lang, plat: g.plat, link: g.link,
    desc: g.desc, members: g.members, featured: !!g.featured, sample: !!g.sample, createdAt: g.createdAt, img: imgUrl(g) };
}
// Same-origin picture URL; ?v= changes whenever the picture changes so it can be cached "forever".
const imgUrl = (g) => (g.imageVersion ? `/img/group/${encodeURIComponent(g.id)}?v=${g.imageVersion}` : null);

// ---------- profile pictures (fetched in the background; never blocks moderation) ----------
const avatar = require('./lib/avatar');
const { checkSpam } = require('./lib/spam');
const imgQueue = [], imgQueued = new Set();
let imgActive = 0;
const IMG_CONCURRENCY = 2;
/** Fetch + store the picture for one group now. Resolves the updated group (or null). */
async function refreshImage(id) {
  const g = await store.group(id);
  if (!g) return null;
  const r = await avatar.fetchGroupImage(g.link);
  const fresh = await store.group(id); // the group may have been edited/deleted meanwhile
  if (!fresh || fresh.link !== g.link) return fresh;
  if (r.ok) {
    await store.setImage(id, r.data, r.type);
    console.log(`[img] ${id} ${g.link}: stored ${r.type} ${r.data.length} bytes`);
  } else {
    await store.updateGroup(id, { imageStatus: r.status, imageError: r.reason, imageCheckedAt: new Date().toISOString() });
    console.warn(`[img] ${id} ${g.link}: ${r.status}: ${r.reason}`);
  }
  return store.group(id);
}
function queueImage(id) {
  if (imgQueued.has(id)) return false;
  imgQueued.add(id); imgQueue.push(id); pumpImages(); return true;
}
function pumpImages() {
  while (imgActive < IMG_CONCURRENCY && imgQueue.length) {
    const id = imgQueue.shift(); imgActive++;
    refreshImage(id).catch((e) => console.error('[img] ' + id + ' failed:', e.message))
      .finally(() => { imgQueued.delete(id); setTimeout(() => { imgActive--; pumpImages(); }, 300); }); // small gap: be polite to the platforms
  }
}

// Express 4 does not catch rejected promises, so wrap async handlers.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
// TRUST_PROXY: number of proxy hops ("1" on Render), "true", or an IP/subnet list such as "loopback".
// Env vars are strings and Express treats the string "1" as an IP address, so convert hop counts/booleans first.
// Without this, every visitor gets the proxy's IP (shared rate limits and report de-duplication).
function trustProxySetting(v) { if (/^\d+$/.test(v)) return parseInt(v, 10); if (v === 'true') return true; if (v === 'false') return false; return v; }
if (process.env.TRUST_PROXY) app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

// Strict CSP everywhere (admin, API). Public pages get a relaxed CSP so the Monetag tag can load.
const STRICT_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
// Monetag OnClick tag (public pages only, loaded by /monetag.js). The tag script itself comes from one fixed host;
// it then calls ad servers whose domains Monetag rotates (seen: 255md.com, my.rtmark.net), so connect-src allows any
// https: origin on public pages. img-src already allows https:, so this adds no new exfiltration path. The tag compiles
// WebAssembly, which needs 'wasm-unsafe-eval' (WebAssembly only; JS eval and inline scripts stay blocked).
// The Monetag Push Notifications tag (zone 12076149) loads from a second fixed host and registers /sw.js.
const MONETAG_SCRIPT = 'https://al5sm.com';
const MONETAG_PUSH = 'https://5gvci.com';
// Monetag In-Page Push (zone 12078493), loaded by /monetag-inpage.js.
const MONETAG_INPAGE = 'https://nap5k.com';
const PUBLIC_CSP = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${MONETAG_SCRIPT} ${MONETAG_PUSH} ${MONETAG_INPAGE}`,
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' https: data:",
  "connect-src 'self' https:",
  "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"
].join('; ');
const PUBLIC_PAGES = new Set(['/', '/grouphub.html']);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': PUBLIC_PAGES.has(req.path) || req.path.startsWith('/group/') ? PUBLIC_CSP : STRICT_CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  if (IS_PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
// Reject cross-site state-changing requests (defence in depth on top of SameSite cookies).
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('Origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('Host')) return res.status(403).json({ error: 'Cross-origin request blocked.' }); }
    catch (e) { return res.status(403).json({ error: 'Bad origin.' }); }
  }
  next();
});
app.use(express.json({ limit: '10kb' }));

// Only the public/ folder is web-accessible (NOT the project root, server code or node_modules).
// Homepage: server-rendered first page + crawlable index (cached briefly; any write clears the cache).
const render = require('./lib/render');
const Card = require('./public/card-render.js');
let homeCache = null; // { html, at }
const HOME_TTL_MS = 60e3;
app.get('/', ah(async (req, res) => {
  if (!homeCache || Date.now() - homeCache.at > HOME_TTL_MS) {
    const list = (await store.groups((g) => g.status === 'approved')).map(publicGroup);
    homeCache = { html: render.renderHome(list), at: Date.now() };
  }
  res.set('Cache-Control', 'no-cache').type('html').send(homeCache.html);
}));
app.get('/grouphub.html', (req, res) => res.redirect(301, '/')); // one canonical URL for the homepage

// Group pages: /group/<slug>-<id>. Only approved groups; wrong/old slugs 301 to the canonical URL.
const pageCache = new Map(); // id -> { html, at }
let sitemapCache = null;
const SIMILAR_MAX = 6;
function notFound(res) { res.status(404).set('Cache-Control', 'no-cache').type('html').send(render.render404()); }
app.get('/group/:param', ah(async (req, res) => {
  const id = render.parseGroupParam(req.params.param);
  if (!id) return notFound(res);
  const g = await store.group(id);
  if (!g || g.status !== 'approved') return notFound(res);
  const canonical = Card.groupPath(g);
  if ('/group/' + req.params.param !== canonical) return res.redirect(301, canonical);
  let hit = pageCache.get(id);
  if (!hit || Date.now() - hit.at > HOME_TTL_MS) {
    const pub = Object.assign(publicGroup(g), { updatedAt: g.updatedAt });
    // Similar: same category first, then same platform; never Adult, never the group itself.
    const others = render.publicList((await store.groups((x) => x.status === 'approved' && x.id !== g.id)).map(publicGroup));
    const same = others.filter((x) => x.cat === g.cat);
    const similar = same.concat(others.filter((x) => x.cat !== g.cat && x.plat === g.plat)).slice(0, SIMILAR_MAX);
    hit = { html: render.renderGroupPage(pub, similar), at: Date.now() };
    if (pageCache.size > 2000) pageCache.clear();
    pageCache.set(id, hit);
  }
  res.set('Cache-Control', 'no-cache').type('html').send(hit.html);
}));
app.get('/group', (req, res) => res.redirect(301, '/'));
app.get('/sitemap.xml', ah(async (req, res) => {
  // Cached like the homepage (60s) and dropped on every write.
  if (!sitemapCache || Date.now() - sitemapCache.at > HOME_TTL_MS) {
    sitemapCache = { xml: render.renderSitemap(await store.groups((g) => g.status === 'approved')), at: Date.now() };
  }
  res.set('Cache-Control', 'public, max-age=600').type('application/xml').send(sitemapCache.xml);
}));
// Monetag push service worker. Must live at the site root (scope /). It importScripts() Monetag's worker code from
// 5gvci.com, which may pull further code/endpoints from rotating ad domains, so it gets no CSP (a page CSP doesn't apply
// to workers anyway; only the worker response's own header does). Not cached long so zone changes roll out quickly.
const SW_JS = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8');
app.get('/sw.js', (req, res) => {
  res.removeHeader('Content-Security-Policy');
  res.set('Cache-Control', 'no-cache').type('application/javascript').send(SW_JS);
});
app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'deny' }));

// ----- public API -----
// Health check for Render (also verifies the database connection).
app.get('/healthz', ah(async (req, res) => {
  try { await store.ping(); res.set('Cache-Control', 'no-store').json({ ok: true, db: store.kind }); }
  catch (e) { res.status(503).json({ ok: false, error: 'database unavailable' }); }
}));

// Group pictures: public for approved groups, admins can also see others. Long cache + ETag; the URL carries ?v=<version>.
app.get('/img/group/:id', ah(async (req, res) => {
  const g = await store.group(req.params.id);
  const admin = !!getSession(req);
  if (!g || !g.imageVersion || (g.status !== 'approved' && !admin)) return res.status(404).end();
  const etag = `"${g.id}-${g.imageVersion}"`;
  res.set({ ETag: etag, 'Cache-Control': g.status === 'approved' && String(req.query.v) === String(g.imageVersion) ? 'public, max-age=31536000, immutable' : 'private, no-cache', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  if (req.get('If-None-Match') === etag) return res.status(304).end();
  const img = await store.getImage(g.id);
  if (!img) return res.status(404).end();
  res.type(img.type).send(img.data);
}));

// Traffic beacon from /beacon.js (public pages). Always 204; bots, unknown pages and bad bodies are silently ignored.
app.post('/api/collect', rateLimit('collect', 60, 60e3), (req, res) => {
  const b = req.body || {};
  analytics.hit({ type: b.t, path: typeof b.p === 'string' ? b.p.slice(0, 300) : '', vid: b.v, isNew: b.n === 1, ip: clientIp(req), ua: String(req.get('User-Agent') || '').slice(0, 400) })
    .catch((e) => console.error('[stats] hit failed:', e.message));
  res.set('Cache-Control', 'no-store').status(204).end();
});

app.get('/api/meta', (req, res) => res.json({ adultCategory: V.ADULT_CATEGORY, categories: V.CATEGORIES, countries: V.COUNTRIES, languages: V.LANGUAGES, reasons: V.REPORT_REASONS }));

// Adult groups are only returned when explicitly requested (?includeAdult=1), after the client-side 18+ gate.
app.get('/api/groups', ah(async (req, res) => {
  const includeAdult = req.query.includeAdult === '1';
  const list = (await store.groups((g) => g.status === 'approved' && (includeAdult || g.cat !== V.ADULT_CATEGORY)))
    .sort((a, b) => (b.featured - a.featured) || b.createdAt.localeCompare(a.createdAt))
    .map(publicGroup);
  res.set('Cache-Control', 'no-cache').json({ groups: list });
}));

app.post('/api/groups', rateLimit('submit', 10, 60 * 60e3), ah(async (req, res) => {
  const body = req.body || {};
  if (body.website) return res.status(201).json({ ok: true, status: 'pending' }); // honeypot: silently drop bots
  const v = V.validateGroup(body);
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  if (await store.findByKey(v.value.linkKey)) return res.status(409).json({ error: 'This invite link has already been submitted.' });
  // Auto-approve (admin setting): normal submissions go live at once; Adult and anything the spam check flags wait for a moderator.
  let status = 'pending', holdReason = null;
  if (await store.getSetting('auto_approve', false) === true) {
    const spam = checkSpam(v.value);
    if (v.value.cat === V.ADULT_CATEGORY) holdReason = 'Adult category always needs review';
    else if (spam.spam) holdReason = 'Spam check: ' + spam.reasons.join('; ');
    else status = 'approved';
  }
  let g;
  try { g = await store.addGroup(Object.assign(v.value, { status, autoApproved: status === 'approved', holdReason, submitter: anonId(req) })); }
  catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'This invite link has already been submitted.' }); throw e; } // unique race
  if (status === 'approved') queueImage(g.id); // same background picture fetch as a manual approval
  res.status(201).json({ ok: true, id: g.id, status, live: status === 'approved' });
}));

app.post('/api/groups/:id/report', rateLimit('report', 20, 60 * 60e3), ah(async (req, res) => {
  const g = await store.group(req.params.id);
  if (!g || g.status !== 'approved') return res.status(404).json({ error: 'Group not found.' });
  const reason = (req.body || {}).reason;
  if (!V.REPORT_REASONS.includes(reason)) return res.status(400).json({ error: 'Choose a report reason.' });
  const who = anonId(req);
  const dupe = (await store.reportsFor(g.id)).some((r) => r.reporter === who && Date.now() - Date.parse(r.createdAt) < 864e5);
  if (!dupe) await store.addReport(g.id, reason, V.cleanText((req.body || {}).details, 300), who);
  res.status(201).json({ ok: true });
}));

// ----- admin -----
const ADMIN_VIEWS = path.join(__dirname, 'admin', 'views');
app.use('/admin/assets', express.static(path.join(__dirname, 'admin', 'assets'), { index: false, dotfiles: 'deny' }));
app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(ADMIN_VIEWS, getSession(req) ? 'dashboard.html' : 'login.html'));
});

// 5 attempts per 15 minutes per IP, plus a small fixed delay on failure.
app.post('/admin/login', rateLimit('login', 5, 15 * 60e3), (req, res) => {
  if (!ADMIN) return res.status(503).json({ error: 'Admin login is disabled: set ADMIN_PASSWORD on the server.' });
  const ok = checkPassword((req.body || {}).password);
  if (!ok) return setTimeout(() => res.status(401).json({ error: 'Wrong password.' }), 400);
  buckets.delete('login:' + clientIp(req)); // successful login resets the failure counter
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { csrf: crypto.randomBytes(16).toString('hex'), expires: Date.now() + SESSION_HOURS * 36e5 });
  cookie(res, token, SESSION_HOURS * 3600, req);
  res.json({ ok: true });
});
app.post('/admin/logout', (req, res) => {
  const s = getSession(req); if (s) sessions.delete(s.token);
  cookie(res, '', 0, req); res.json({ ok: true });
});

const api = express.Router();
api.use(requireAdmin);
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.get('/me', (req, res) => res.json({ ok: true, csrf: req.session.csrf }));
api.get('/stats', ah(async (req, res) => {
  const counts = await store.reportCounts(), all = await store.groups(), week = Date.now() - 7 * 864e5;
  const by = (s) => all.filter((g) => g.status === s).length;
  res.json({ pending: by('pending'), approved: by('approved'), rejected: by('rejected'),
    reported: Object.keys(counts).length, openReports: Object.values(counts).reduce((a, b) => a + b, 0),
    featured: all.filter((g) => g.featured && g.status === 'approved').length,
    submittedThisWeek: all.filter((g) => Date.parse(g.createdAt) > week && !g.sample).length, total: all.length });
}));
// Traffic panel. Group pages are returned with their name and URL.
api.get('/traffic', ah(async (req, res) => {
  const t = await analytics.summary();
  const ids = new Set([...t.topToday, ...t.top7].filter((r) => r.page.startsWith('g:')).map((r) => r.page.slice(2)));
  const byId = new Map((await store.groups((g) => ids.has(g.id))).map((g) => [g.id, g]));
  const label = (r) => {
    if (r.page === 'home') return { views: r.views, name: 'Homepage', url: '/' };
    const g = byId.get(r.page.slice(2));
    return { views: r.views, name: g ? g.name : '(deleted group)', url: g && g.status === 'approved' ? Card.groupPath(g) : null };
  };
  t.topToday = t.topToday.map(label); t.top7 = t.top7.map(label);
  res.json(t);
}));
api.get('/traffic/online', (req, res) => res.json({ onlineNow: analytics.onlineNow() }));
api.get('/groups', ah(async (req, res) => {
  const status = String(req.query.status || 'pending'), q = String(req.query.q || '').toLowerCase();
  const counts = await store.reportCounts();
  let list = status === 'reported' ? await store.groups((g) => counts[g.id]) : await store.groups((g) => g.status === status);
  if (status === 'approved' && req.query.auto === '1') list = list.filter((g) => g.autoApproved);
  if (q) list = list.filter((g) => (g.name + ' ' + g.desc + ' ' + g.link).toLowerCase().includes(q));
  list = list.map((g) => Object.assign({}, g, { reportCount: counts[g.id] || 0, img: imgUrl(g), page: g.status === 'approved' ? Card.groupPath(g) : null }))
    .sort((a, b) => status === 'reported' ? b.reportCount - a.reportCount : b.createdAt.localeCompare(a.createdAt));
  res.json({ groups: list });
}));
// Site settings. GET is read-only; PUT needs the CSRF token (enforced by requireAdmin for non-GET).
api.get('/settings', ah(async (req, res) => res.json({ autoApprove: (await store.getSetting('auto_approve', false)) === true })));
api.put('/settings', ah(async (req, res) => {
  const b = req.body || {};
  if (typeof b.autoApprove !== 'boolean') return res.status(400).json({ error: 'autoApprove must be true or false.' });
  await store.setSetting('auto_approve', b.autoApprove);
  console.log('[settings] auto-approve ' + (b.autoApprove ? 'ON' : 'OFF'));
  res.json({ autoApprove: b.autoApprove });
}));
api.get('/groups/:id/reports', ah(async (req, res) => res.json({ reports: await store.reportsFor(req.params.id) })));
api.patch('/groups/:id', ah(async (req, res) => {
  const g = await store.group(req.params.id); if (!g) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {}, fields = {};
  const editable = ['plat', 'link', 'name', 'cat', 'country', 'lang', 'desc', 'members'].filter((k) => b[k] !== undefined);
  if (editable.length) {
    const input = {}; editable.forEach((k) => { input[k] = b[k]; });
    if (input.plat && input.link === undefined) input.link = g.link; // re-validate link against new platform
    input._existingPlat = g.plat;
    const v = V.validateGroup(input, { partial: true });
    if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
    if (v.value.linkKey) { const other = await store.findByKey(v.value.linkKey); if (other && other.id !== g.id) return res.status(409).json({ error: 'Another listing already uses this link.' }); }
    Object.assign(fields, v.value);
  }
  if (b.status !== undefined) { if (!['pending', 'approved', 'rejected'].includes(b.status)) return res.status(400).json({ error: 'Bad status.' }); fields.status = b.status; }
  if (b.featured !== undefined) fields.featured = !!b.featured;
  if (b.autoApproved === false) fields.autoApproved = false; // admin "Mark reviewed" on an auto-approved group
  if (fields.status) fields.holdReason = null;
  if (fields.status && fields.status !== 'approved') fields.featured = false;
  const linkChanged = fields.link && fields.link !== g.link;
  if (linkChanged) await store.clearImage(g.id); // old picture belongs to the old link
  const updated = await store.updateGroup(g.id, fields);
  // Fetch the picture in the background on approval (or when an approved group's link changes). Approval never waits for it.
  if (updated.status === 'approved' && ((fields.status === 'approved' && g.status !== 'approved') || linkChanged)) queueImage(g.id);
  res.json({ group: updated });
}));
// Re-fetch one group's picture now and report the result (admin "Refresh picture" button).
api.post('/groups/:id/refresh-image', rateLimit('refreshimg', 60, 60 * 60e3), ah(async (req, res) => {
  const g = await store.group(req.params.id); if (!g) return res.status(404).json({ error: 'Not found.' });
  const updated = await refreshImage(g.id);
  res.json({ ok: updated.imageStatus === 'ok', imageStatus: updated.imageStatus, imageError: updated.imageError, img: imgUrl(updated) });
}));
// One-off backfill: queue every approved, non-sample group that has no picture yet (retry=1 also retries earlier failures).
api.post('/images/backfill', ah(async (req, res) => {
  const retry = (req.body || {}).retry === true;
  const todo = await store.groups((g) => g.status === 'approved' && !g.sample && !g.imageVersion && (retry || !g.imageStatus));
  const queued = todo.filter((g) => queueImage(g.id)).length;
  res.json({ queued, inQueue: imgQueue.length + imgActive });
}));
api.delete('/groups/:id', ah(async (req, res) => ((await store.deleteGroup(req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found.' }))));
api.post('/groups/:id/clear-reports', ah(async (req, res) => res.json({ cleared: await store.clearReports(req.params.id) })));
app.use('/api/admin', api);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request body.' });
  console.error(err); res.status(500).json({ error: 'Server error.' });
});

// Start: prepare storage (creates tables on Postgres), optionally seed samples, then listen on $PORT.
// Note: admin sessions and rate limits live in memory, which is fine for a single instance (e.g. Render free).
(async function start() {
  try {
    await store.init({ seed: process.env.SEED_SAMPLES === '1' ? sampleGroups() : null });
    await analytics.init();
  } catch (e) {
    console.error('[db] Failed to initialise ' + store.kind + ' storage:', e.message);
    process.exit(1);
  }
  const server = app.listen(PORT, () => console.log(`GroupHub running on http://localhost:${PORT}  (storage: ${store.kind}, admin: /admin)`));
  const shutdown = () => { server.close(() => analytics.flush().catch(() => {}).then(() => store.close()).finally(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
})();
