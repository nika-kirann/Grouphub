'use strict';
// Fetches a group's profile picture from WhatsApp / Telegram / Discord so we can store our own copy
// (platform image URLs, especially WhatsApp's, expire).
//
// SSRF safety: we only ever request https URLs on a fixed allowlist of hosts (no user-chosen hosts,
// no ports, no credentials), follow at most 3 redirects (each re-checked against the allowlist),
// time out after 8 s, cap bodies (HTML 1 MB, images 2 MB) and require an image content-type.
let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* optional: without sharp we store small originals as-is */ }

const PAGE_HOSTS = new Set(['chat.whatsapp.com', 't.me', 'telegram.me', 'discord.com']);
const IMAGE_HOST_RES = [/^pps\.whatsapp\.net$/, /^cdn\d*\.telesco\.pe$/, /^telegram\.org$/, /^cdn\.discordapp\.com$/];
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']); // no SVG (can carry script)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TIMEOUT_MS = 8000, MAX_REDIRECTS = 3, MAX_HTML = 1024 * 1024, MAX_IMAGE = 2 * 1024 * 1024, MAX_RAW_STORE = 300 * 1024, SIZE = 256;

const isPageHost = (h) => PAGE_HOSTS.has(h);
const isImageHost = (h) => IMAGE_HOST_RES.some((re) => re.test(h));

/** Parse and check a URL against an allowlist predicate. Returns a URL or null. */
function allowedUrl(raw, hostOk, base) {
  let u;
  try { u = new URL(raw, base); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return null;
  return hostOk(u.hostname.toLowerCase()) ? u : null;
}

/** GET with manual redirects (each hop re-validated), timeout and a byte cap. */
async function safeGet(url, { hostOk, maxBytes, accept }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let u = allowedUrl(url, hostOk);
    if (!u) throw new Error('blocked url ' + url);
    for (let hop = 0; ; hop++) {
      const res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' } });
      if (res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
        const next = allowedUrl(res.headers.get('location') || '', hostOk, u);
        if (!next) throw new Error('redirect to a host that is not allowed');
        u = next; continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + u.hostname);
      const len = parseInt(res.headers.get('content-length'), 10);
      if (len > maxBytes) throw new Error('response too large');
      const chunks = []; let total = 0;
      for await (const c of res.body) { total += c.length; if (total > maxBytes) { ctrl.abort(); throw new Error('response too large'); } chunks.push(c); }
      return { url: u, type: String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(chunks) };
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally { clearTimeout(timer); }
}

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&#0*38;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Extract og:image (or twitter:image) from HTML. Attribute order and quoting may vary. */
function parseOgImage(html) {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[2] ?? m[3] ?? m[4]) : null; };
  for (const want of ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']) {
    for (const t of tags) {
      const key = (attr(t, 'property') || attr(t, 'name') || '').toLowerCase();
      const content = attr(t, 'content');
      if (key === want && content && content.trim()) return decodeEntities(content.trim());
    }
  }
  return null;
}

/** Platform placeholder images (no real group picture): Telegram's logo, WhatsApp's static assets. */
function isGenericImage(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'telegram.org' && /^\/img\//.test(u.pathname)) return true;     // t_logo.png etc.
    if (u.hostname === 'static.whatsapp.net' || u.hostname.endsWith('.whatsapp.com')) return true;
    return false;
  } catch (e) { return true; }
}

/** Work out where to look for the picture for a stored group link. */
function sourceFor(link) {
  let m;
  if ((m = /^https:\/\/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{20,24})$/.exec(link))) return { kind: 'wa', page: 'https://chat.whatsapp.com/' + m[1] };
  if ((m = /^https:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/(\+[A-Za-z0-9_-]{10,64}|joinchat\/[A-Za-z0-9_-]{10,64}|[A-Za-z][A-Za-z0-9_]{4,31})$/.exec(link))) return { kind: 'tg', page: 'https://t.me/' + m[1] };
  if ((m = /^https:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/([A-Za-z0-9-]{2,64})$/.exec(link))) return { kind: 'dc', api: 'https://discord.com/api/v10/invites/' + m[1] };
  return null;
}

/** Discord invite API JSON -> icon URL (or null). */
function discordIconUrl(json) {
  const g = json && json.guild;
  if (!g || !/^\d{5,25}$/.test(String(g.id)) || !/^(a_)?[0-9a-f]{16,64}$/.test(String(g.icon || ''))) return null;
  return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=256`;
}

/** Resize to a SIZExSIZE webp. Without sharp, keep small originals. */
async function processImage(buf, type) {
  if (sharp) {
    const out = await sharp(buf, { limitInputPixels: 40e6, animated: false }).rotate()
      .resize(SIZE, SIZE, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer();
    return { data: out, type: 'image/webp' };
  }
  if (buf.length > MAX_RAW_STORE) throw new Error('image too large to store without sharp');
  return { data: buf, type };
}

/**
 * Fetch the picture for a group link.
 * Resolves { ok:true, data, type, source } or { ok:false, status:'none'|'error', reason }.
 * Never throws.
 */
async function fetchGroupImage(link) {
  try {
    const src = sourceFor(link);
    if (!src) return { ok: false, status: 'none', reason: 'unsupported link' };
    let imgUrl;
    if (src.kind === 'dc') {
      const r = await safeGet(src.api, { hostOk: isPageHost, maxBytes: MAX_HTML, accept: 'application/json' });
      let json; try { json = JSON.parse(r.body.toString('utf8')); } catch (e) { return { ok: false, status: 'error', reason: 'bad Discord response' }; }
      imgUrl = discordIconUrl(json);
      if (!imgUrl) return { ok: false, status: 'none', reason: 'Discord server has no icon' };
    } else {
      const r = await safeGet(src.page, { hostOk: isPageHost, maxBytes: MAX_HTML, accept: 'text/html,application/xhtml+xml' });
      imgUrl = parseOgImage(r.body.toString('utf8'));
      if (!imgUrl || isGenericImage(imgUrl)) return { ok: false, status: 'none', reason: src.kind === 'wa' ? 'no group picture on the invite page (no icon, revoked or expired invite)' : 'no picture on the Telegram page (private, no photo or not found)' };
    }
    if (!allowedUrl(imgUrl, isImageHost)) return { ok: false, status: 'error', reason: 'image host not allowed: ' + (() => { try { return new URL(imgUrl).hostname; } catch (e) { return '?'; } })() };
    const img = await safeGet(imgUrl, { hostOk: isImageHost, maxBytes: MAX_IMAGE, accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8' });
    if (!IMAGE_TYPES.has(img.type)) return { ok: false, status: 'error', reason: 'not an image (' + (img.type || 'no content-type') + ')' };
    const out = await processImage(img.body, img.type);
    return { ok: true, data: out.data, type: out.type, source: src.kind };
  } catch (e) {
    return { ok: false, status: 'error', reason: String(e.message || e).slice(0, 200) };
  }
}

module.exports = { fetchGroupImage, parseOgImage, isGenericImage, sourceFor, discordIconUrl, allowedUrl, isPageHost, isImageHost, hasSharp: !!sharp };
