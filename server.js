'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Store = require('./lib/store');
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

// ---------- storage (seeded with clearly-fake sample groups on first run) ----------
const SEED = [
  ['Anime World JP', 'Anime / Manga', 'Japan', 'Japanese', 'wa', 890, 'All things anime, manga and cosplay: daily recommendations and fan art.'],
  ['Tech Enthusiasts India', 'Science / Tech', 'India', 'English', 'wa', 220, 'Daily discussions on gadgets, software, AI, and everything tech.'],
  ['Study Buddies UK', 'Education', 'United Kingdom', 'English', 'wa', 180, 'University students share notes, resources, and study tips.'],
  ['Lagos Business Network', 'Business / Marketing', 'Nigeria', 'English', 'tg', 410, 'Entrepreneurs and professionals in Lagos connect and grow.'],
  ['Bollywood Fans Club', 'Entertainment', 'India', 'Hindi', 'wa', 530, 'Movies, songs, gossip, and memes: everything Bollywood.'],
  ['FIFA & Football Talk', 'Sports', 'United Kingdom', 'English', 'tg', 295, 'Premier League, Champions League, fantasy football and more.'],
  ['Anime Telegram Hub', 'Anime / Manga', 'Japan', 'Japanese', 'tg', 1200, 'Anime discussion on Telegram: subs, dubs and reviews.'],
  ['Global Music Lovers', 'Music / Audio', 'United States', 'English', 'tg', 340, 'Share music recommendations, playlists, and discover new artists.'],
  ['Fitness & Nutrition', 'Health / Fitness', 'India', 'English', 'wa', 200, 'Workout plans, diet tips, progress pics and motivation.'],
  ['Naija Comedy Hub', 'Entertainment', 'Nigeria', 'English', 'wa', 660, 'Viral memes, funny videos, and comedy skits every day.'],
  ['Dev & Design Chat', 'Science / Tech', 'United States', 'English', 'tg', 450, 'Developers, designers, and product people talking shop.'],
  ['Travel South Asia', 'Travel', 'India', 'English', 'wa', 175, 'Hidden gems, travel tips, and trip planning across South Asia.'],
  ['Manga Collectors', 'Anime / Manga', 'United States', 'English', 'tg', 540, 'Buy, sell, trade manga volumes and talk about your favourite series.'],
  ['Brasil Empreendedores', 'Business / Marketing', 'Brazil', 'Portuguese', 'tg', 310, 'Comunidade de empreendedores, freelancers e startups.'],
  ['Gaming Arena PH', 'Gaming / Apps', 'Philippines', 'English', 'wa', 780, 'Mobile and PC gaming, tournament announcements and squad formation.']
];
const store = new Store(DB_FILE, (s) => {
  SEED.forEach(([name, cat, country, lang, plat, members, desc], i) => {
    const n = String(i + 1).padStart(4, '0');
    const link = plat === 'wa' ? `https://chat.whatsapp.com/SAMPLEFAKEGROUPHUB${n}` : `https://t.me/+SAMPLEfakeGROUPHUB${n}`;
    const v = V.normalizeInvite(plat, link);
    const d = new Date(Date.now() - (i + 1) * 36e5 * 20).toISOString();
    s.data.groups.push({ id: s.id(), name, cat, country, lang, plat, members, desc, link: v.url, linkKey: v.key,
      status: 'approved', featured: i < 2, sample: true, createdAt: d, updatedAt: d });
  });
});

// ---------- helpers ----------
function clientIp(req) { return req.ip || req.socket.remoteAddress || 'unknown'; }
const HASH_SALT = crypto.randomBytes(16).toString('hex');
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
    desc: g.desc, members: g.members, featured: !!g.featured, sample: !!g.sample, createdAt: g.createdAt };
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY); // e.g. "1" behind one reverse proxy

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
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
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'grouphub.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'deny' }));

// ----- public API -----
app.get('/api/meta', (req, res) => res.json({ categories: V.CATEGORIES, countries: V.COUNTRIES, languages: V.LANGUAGES, reasons: V.REPORT_REASONS }));

app.get('/api/groups', (req, res) => {
  const list = store.groups((g) => g.status === 'approved')
    .sort((a, b) => (b.featured - a.featured) || b.createdAt.localeCompare(a.createdAt))
    .map(publicGroup);
  res.set('Cache-Control', 'no-cache').json({ groups: list });
});

app.post('/api/groups', rateLimit('submit', 10, 60 * 60e3), (req, res) => {
  const body = req.body || {};
  if (body.website) return res.status(201).json({ ok: true, status: 'pending' }); // honeypot: silently drop bots
  const v = V.validateGroup(body);
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  if (store.findByKey(v.value.linkKey)) return res.status(409).json({ error: 'This invite link has already been submitted.' });
  const g = store.addGroup(Object.assign(v.value, { status: 'pending', submitter: anonId(req) }));
  res.status(201).json({ ok: true, id: g.id, status: 'pending' });
});

app.post('/api/groups/:id/report', rateLimit('report', 20, 60 * 60e3), (req, res) => {
  const g = store.group(req.params.id);
  if (!g || g.status !== 'approved') return res.status(404).json({ error: 'Group not found.' });
  const reason = (req.body || {}).reason;
  if (!V.REPORT_REASONS.includes(reason)) return res.status(400).json({ error: 'Choose a report reason.' });
  const who = anonId(req);
  const dupe = store.reportsFor(g.id).some((r) => r.reporter === who && Date.now() - Date.parse(r.createdAt) < 864e5);
  if (!dupe) store.addReport(g.id, reason, V.cleanText((req.body || {}).details, 300), who);
  res.status(201).json({ ok: true });
});

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
api.get('/stats', (req, res) => {
  const counts = store.reportCounts(), all = store.groups(), week = Date.now() - 7 * 864e5;
  const by = (s) => all.filter((g) => g.status === s).length;
  res.json({ pending: by('pending'), approved: by('approved'), rejected: by('rejected'),
    reported: Object.keys(counts).length, openReports: Object.values(counts).reduce((a, b) => a + b, 0),
    featured: all.filter((g) => g.featured && g.status === 'approved').length,
    submittedThisWeek: all.filter((g) => Date.parse(g.createdAt) > week && !g.sample).length, total: all.length });
});
api.get('/groups', (req, res) => {
  const status = String(req.query.status || 'pending'), q = String(req.query.q || '').toLowerCase();
  const counts = store.reportCounts();
  let list = status === 'reported' ? store.groups((g) => counts[g.id]) : store.groups((g) => g.status === status);
  if (q) list = list.filter((g) => (g.name + ' ' + g.desc + ' ' + g.link).toLowerCase().includes(q));
  list = list.map((g) => Object.assign({}, g, { reportCount: counts[g.id] || 0 }))
    .sort((a, b) => status === 'reported' ? b.reportCount - a.reportCount : b.createdAt.localeCompare(a.createdAt));
  res.json({ groups: list });
});
api.get('/groups/:id/reports', (req, res) => res.json({ reports: store.reportsFor(req.params.id) }));
api.patch('/groups/:id', (req, res) => {
  const g = store.group(req.params.id); if (!g) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {}, fields = {};
  const editable = ['plat', 'link', 'name', 'cat', 'country', 'lang', 'desc', 'members'].filter((k) => b[k] !== undefined);
  if (editable.length) {
    const input = {}; editable.forEach((k) => { input[k] = b[k]; });
    if (input.plat && input.link === undefined) input.link = g.link; // re-validate link against new platform
    input._existingPlat = g.plat;
    const v = V.validateGroup(input, { partial: true });
    if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
    if (v.value.linkKey) { const other = store.findByKey(v.value.linkKey); if (other && other.id !== g.id) return res.status(409).json({ error: 'Another listing already uses this link.' }); }
    Object.assign(fields, v.value);
  }
  if (b.status !== undefined) { if (!['pending', 'approved', 'rejected'].includes(b.status)) return res.status(400).json({ error: 'Bad status.' }); fields.status = b.status; }
  if (b.featured !== undefined) fields.featured = !!b.featured;
  if (fields.status && fields.status !== 'approved') fields.featured = false;
  res.json({ group: store.updateGroup(g.id, fields) });
});
api.delete('/groups/:id', (req, res) => store.deleteGroup(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found.' }));
api.post('/groups/:id/clear-reports', (req, res) => res.json({ cleared: store.clearReports(req.params.id) }));
app.use('/api/admin', api);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request body.' });
  console.error(err); res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, () => console.log(`GroupHub running on http://localhost:${PORT}  (admin: /admin)`));
