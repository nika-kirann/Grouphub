'use strict';
// Featured listings: the admin features a group (optionally until a date); featured groups are pinned at the top of
// the public lists with a badge. Payment is handled by the site owner outside the site.
const ADULT = 'Adult';
const MAX_SHOWN = 6;          // at most this many groups are shown as featured (most recently featured first)
const MAX_DAYS = 730;
const DAY_MS = 86400e3;

/** Is this group featured right now? Adult groups are never featured; expired features don't count. */
function isFeaturedNow(g, now) {
  if (!g || !g.featured || g.status !== 'approved' || g.cat === ADULT) return false;
  if (g.featuredUntil) { const t = Date.parse(g.featuredUntil); if (!Number.isNaN(t) && t <= now) return false; }
  return true;
}
const featuredSince = (g) => g.featuredAt || g.updatedAt || g.createdAt || '';
/** Map<id, rank> of the groups shown as featured (max MAX_SHOWN, most recently featured first). */
function featuredRank(groups, now, max) {
  const list = groups.filter((g) => isFeaturedNow(g, now)).sort((a, b) => featuredSince(b).localeCompare(featuredSince(a))).slice(0, max || MAX_SHOWN);
  return new Map(list.map((g, i) => [g.id, i]));
}
/** Groups whose feature has expired (still flagged featured in storage). */
function expired(groups, now) {
  return groups.filter((g) => g.featured && g.featuredUntil && !Number.isNaN(Date.parse(g.featuredUntil)) && Date.parse(g.featuredUntil) <= now);
}
/**
 * Admin "Feature" request -> { ok, until } where until is an ISO string or null (no end date).
 * body.featuredDays: 1..730, or body.featuredUntil: ISO date/time in the future, or neither (no expiry).
 */
function parseFeature(body, now) {
  const b = body || {};
  if (b.featuredDays != null && b.featuredDays !== '') {
    const d = Number(b.featuredDays);
    if (!Number.isInteger(d) || d < 1 || d > MAX_DAYS) return { ok: false, error: 'Feature length must be 1 to ' + MAX_DAYS + ' days.' };
    return { ok: true, until: new Date(now + d * DAY_MS).toISOString() };
  }
  if (b.featuredUntil != null && b.featuredUntil !== '') {
    const t = typeof b.featuredUntil === 'string' && b.featuredUntil.length <= 40 ? Date.parse(b.featuredUntil) : NaN;
    if (Number.isNaN(t)) return { ok: false, error: 'Bad end date.' };
    if (t <= now) return { ok: false, error: 'The end date must be in the future.' };
    if (t > now + MAX_DAYS * DAY_MS) return { ok: false, error: 'The end date is too far away.' };
    return { ok: true, until: new Date(t).toISOString() };
  }
  return { ok: true, until: null };
}
/** Admin "featured contact" setting: free text + optional https/mailto link. */
function validateContact(b) {
  const out = {};
  if (b.featureContactText !== undefined) {
    if (typeof b.featureContactText !== 'string') return { ok: false, error: 'Contact text must be text.' };
    const t = b.featureContactText.trim().replace(/\s+/g, ' ');
    if (t.length > 200) return { ok: false, error: 'Contact text is too long (max 200 characters).' };
    out.featureContactText = t;
  }
  if (b.featureContactLink !== undefined) {
    if (typeof b.featureContactLink !== 'string') return { ok: false, error: 'Contact link must be text.' };
    const l = b.featureContactLink.trim();
    if (l) {
      let u; try { u = new URL(l); } catch (e) { return { ok: false, error: 'Contact link must be a full URL like https://wa.me/… or mailto:you@example.com' }; }
      if (!['https:', 'mailto:'].includes(u.protocol) || l.length > 300) return { ok: false, error: 'Contact link must start with https:// or mailto:' };
    }
    out.featureContactLink = l;
  }
  return { ok: true, value: out };
}
module.exports = { MAX_SHOWN, isFeaturedNow, featuredRank, expired, parseFeature, validateContact };
