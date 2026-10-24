'use strict';
// Looks up a group's real name from its WhatsApp / Telegram invite page (og:title, falling back to <title>).
// Used by GET /api/link-preview (Add Group form auto-fill) and on approval when a group's name is generic.
//
// Same SSRF rules as the picture fetch (lib/avatar.js safeGet: https only, exact-host allowlist, redirects
// re-checked), narrowed to the invite hosts only, with a 5 s timeout and a 512 KB body cap.
// Results are cached briefly in memory. Never throws; "no real name" resolves { name: null }.
const A = require('./avatar');
const V = require('./validate');

const INVITE_HOSTS = new Set(['chat.whatsapp.com', 't.me', 'telegram.me']);
const isInviteHost = (h) => INVITE_HOSTS.has(h);
const TIMEOUT_MS = 5000, MAX_HTML = 512 * 1024, MAX_NAME = 60;
const TTL_OK = 10 * 60e3, TTL_NONE = 2 * 60e3, MAX_CACHE = 500;
const cache = new Map(), inflight = new Map();
const config = { timeoutMs: TIMEOUT_MS }; // tests shorten the timeout

/** Normalise a pasted link to the invite page we fetch, or null if it's not a WhatsApp/Telegram invite. */
function invitePage(raw) {
  for (const plat of ['wa', 'tg']) {
    const v = V.normalizeInvite(plat, raw);
    if (v.ok) return { plat, url: v.url };
  }
  return null;
}

// Platform boilerplate that is never a group's name.
const GENERIC_TITLES = [
  /^whatsapp(\.com)?$/i, /^whatsapp group invite$/i, /^join (my |our )?whatsapp group$/i, /^whatsapp messenger$/i,
  /^telegram( messenger)?$/i, /^join group chat on telegram$/i, /^telegram: (contact|view|join|launch)\b/i, /^telegram (channel|group)$/i
];
// Boilerplate wrapped around a real name ("Foo – Telegram", "WhatsApp Group Invite: Foo").
const STRIP = [/\s*[|•·–—-]\s*(telegram|whatsapp)(\s+group invite)?$/i, /^(whatsapp group invite|telegram)\s*[|•·–—:-]\s*/i];

/** Clean a raw title into a usable group name, or null if it's empty / generic. */
function cleanName(raw) {
  if (raw == null) return null;
  let s = A.decodeEntities(String(raw)).replace(/[\u0000-\u001F\u007F\u200B\u2060\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
  const generic = (x) => !x || GENERIC_TITLES.some((re) => re.test(x));
  if (generic(s)) return null;
  for (const re of STRIP) s = s.replace(re, '').trim();
  if (generic(s)) return null;
  // Cap at MAX_NAME UTF-16 units (the form's maxlength) without splitting an emoji / surrogate pair.
  let out = '';
  for (const ch of s) { if (out.length + ch.length > MAX_NAME) break; out += ch; }
  return out.trim() || null;
}

/** Best name from an invite page's HTML: og:title, then twitter:title, then <title>. */
function nameFromHtml(html) {
  const og = cleanName(A.parseMeta(html, ['og:title', 'twitter:title']));
  if (og) return og;
  const m = String(html).match(/<title\b[^>]*>([^<]{1,300})<\/title>/i);
  return m ? cleanName(m[1]) : null;
}

/** Names that carry no information (worth replacing with the invite page's name on approval). */
function isGenericName(name) {
  const s = String(name || '').trim();
  return !s || cleanName(s) === null || /^((whatsapp|telegram|wa|tg)\s+)?(group|channel|chat)(\s+(name|link|invite))?$|^(my|new|test|untitled|no name)( group)?$/i.test(s);
}

async function lookup(page) {
  try {
    const r = await A.safeGet(page.url, { hostOk: isInviteHost, maxBytes: MAX_HTML, accept: 'text/html,application/xhtml+xml', timeoutMs: config.timeoutMs });
    if (r.type && !/html/.test(r.type)) return { name: null, reason: 'not html (' + r.type + ')' };
    const name = nameFromHtml(r.body.toString('utf8'));
    return name ? { name } : { name: null, reason: 'no name on the invite page (private, revoked or not found)' };
  } catch (e) {
    return { name: null, reason: String(e.message || e).slice(0, 200), error: true };
  }
}

/** Resolve { plat, url, name|null, reason? } for a pasted invite link. Cached; concurrent lookups share one fetch. */
async function fetchLinkName(raw) {
  const page = invitePage(raw);
  if (!page) return { plat: null, url: null, name: null, reason: 'not a WhatsApp or Telegram invite link' };
  const hit = cache.get(page.url);
  if (hit && hit.expires > Date.now()) return Object.assign({ plat: page.plat, url: page.url, cached: true }, hit.result);
  if (!inflight.has(page.url)) {
    inflight.set(page.url, lookup(page).then((result) => {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(page.url, { result, expires: Date.now() + (result.name ? TTL_OK : TTL_NONE) });
      return result;
    }).finally(() => inflight.delete(page.url)));
  }
  return Object.assign({ plat: page.plat, url: page.url }, await inflight.get(page.url));
}

const clearCache = () => cache.clear();
module.exports = { fetchLinkName, nameFromHtml, cleanName, isGenericName, invitePage, isInviteHost, clearCache, config, TIMEOUT_MS, MAX_HTML };
