'use strict';
// Shared validation for GroupHub. Used by the API; the browser does a light pre-check too.

const PLATFORMS = ['wa', 'tg'];
const CATEGORIES = [
  'Anime / Manga', 'Art / Design', 'Business / Marketing', 'Comedy / Funny', 'Education',
  'Entertainment', 'Family', 'Fashion / Style', 'Gaming / Apps', 'Health / Fitness', 'Jobs / Career',
  'Music / Audio', 'News / Politics', 'Pets / Animals', 'Science / Tech', 'Shopping',
  'Social / Friendship', 'Sports', 'Travel'
];
const COUNTRIES = ['India', 'Japan', 'Nigeria', 'Pakistan', 'United States', 'United Kingdom', 'Brazil',
  'Indonesia', 'Philippines', 'Malaysia', 'Kenya', 'Other'];
const LANGUAGES = ['English', 'Hindi', 'Japanese', 'Arabic', 'Portuguese', 'Spanish', 'Urdu', 'Bengali', 'Other'];
const REPORT_REASONS = ['Link broken or expired', 'Adult or sexual content', 'Scam or fraud', 'Spam or misleading', 'Hate or illegal content', 'Other'];

/**
 * Validate and normalise an invite link.
 * WhatsApp: https://chat.whatsapp.com/<20-24 alphanumerics>
 * Telegram: https://t.me/<username 5-32> or https://t.me/+<code> (also telegram.me, /joinchat/)
 * Returns { ok, url, key } or { ok:false, error }.
 */
function normalizeInvite(plat, raw) {
  let s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'Invite link is required.' };
  if (s.length > 200) return { ok: false, error: 'Invite link is too long.' };
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/^http:\/\//i, 'https://').replace(/[?#].*$/, '').replace(/\/+$/, '');
  let m;
  if (plat === 'wa') {
    m = s.match(/^https:\/\/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{20,24})$/i);
    if (!m) return { ok: false, error: 'WhatsApp links must look like https://chat.whatsapp.com/<20–24 character code>.' };
    return { ok: true, url: 'https://chat.whatsapp.com/' + m[1], key: 'wa:' + m[1] };
  }
  if (plat === 'tg') {
    m = s.match(/^https:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([A-Za-z0-9_-]{10,64})$/i);
    if (m) return { ok: true, url: 'https://t.me/+' + m[1], key: 'tg+:' + m[1] };
    m = s.match(/^https:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{4,31})$/i);
    if (m && !/__/.test(m[1]) && !/_$/.test(m[1])) return { ok: true, url: 'https://t.me/' + m[1], key: 'tg:' + m[1].toLowerCase() };
    return { ok: false, error: 'Telegram links must look like https://t.me/groupname or https://t.me/+InviteCode.' };
  }
  return { ok: false, error: 'Platform must be WhatsApp or Telegram.' };
}

function cleanText(v, max) {
  // Strip control chars and collapse whitespace. HTML escaping happens at render time.
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Validate a group payload. partial=true for admin edits (only provided fields). */
function validateGroup(input, { partial = false } = {}) {
  const errors = [];
  const out = {};
  const has = (k) => input[k] !== undefined;
  if (!partial || has('plat')) {
    if (!PLATFORMS.includes(input.plat)) errors.push('Choose WhatsApp or Telegram.'); else out.plat = input.plat;
  }
  if (!partial || has('link')) {
    const plat = out.plat || input.plat || input._existingPlat;
    const v = normalizeInvite(plat, input.link);
    if (!v.ok) errors.push(v.error); else { out.link = v.url; out.linkKey = v.key; }
  }
  if (!partial || has('name')) {
    const n = cleanText(input.name, 60);
    if (n.length < 3) errors.push('Group name must be 3–60 characters.'); else out.name = n;
  }
  if (!partial || has('cat')) { if (!CATEGORIES.includes(input.cat)) errors.push('Choose a valid category.'); else out.cat = input.cat; }
  if (!partial || has('country')) { if (!COUNTRIES.includes(input.country)) errors.push('Choose a valid country.'); else out.country = input.country; }
  if (!partial || has('lang')) { if (!LANGUAGES.includes(input.lang)) errors.push('Choose a valid language.'); else out.lang = input.lang; }
  if (!partial || has('desc')) {
    const d = cleanText(input.desc, 300);
    if (d.length < 20) errors.push('Description must be 20–300 characters.'); else out.desc = d;
  }
  if (has('members')) {
    const n = parseInt(input.members, 10);
    out.members = Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : null;
  }
  return { ok: errors.length === 0, errors, value: out };
}

module.exports = { PLATFORMS, CATEGORIES, COUNTRIES, LANGUAGES, REPORT_REASONS, normalizeInvite, validateGroup, cleanText };
