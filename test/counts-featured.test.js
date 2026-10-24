'use strict';
// Per-group view/join counters, featured listings (expiry, max shown, ordering, Adult never featured), display helpers. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JsonStore = require('../lib/store');
const { Analytics } = require('../lib/analytics');
const F = require('../lib/featured');
const Card = require('../public/card-render.js');
const render = require('../lib/render');

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const V1 = 'a'.repeat(32), V2 = 'b'.repeat(32);
const T0 = Date.parse('2026-10-20T06:00:00Z');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-counts-'));
  const store = new JsonStore(path.join(dir, 'db.json')); await store.init();
  const g = await store.addGroup({ name: 'Test', cat: 'Gaming', country: 'India', lang: 'Hindi', plat: 'wa', link: 'https://chat.whatsapp.com/x', linkKey: 'k1', status: 'approved' });
  const other = await store.addGroup({ name: 'Pending', cat: 'Gaming', country: 'India', lang: 'Hindi', plat: 'wa', link: 'https://chat.whatsapp.com/y', linkKey: 'k2', status: 'pending' });
  const approved = new Set([g.id]);
  const pageKey = async (p) => { const m = /^\/group\/x-([a-f0-9]+)$/.exec(p); return p === '/' ? 'home' : m && approved.has(m[1]) ? 'g:' + m[1] : null; };
  const clock = { t: T0 }; let refreshed = 0;
  const a = new Analytics({ store, pageKey, tz: 'Asia/Kolkata', now: () => clock.t, isGroup: async (id) => approved.has(id), onCounts: () => { refreshed++; } });
  await a.init();
  return { a, store, clock, g, other, dir, refreshedCount: () => refreshed };
}

test('group views: once per visitor per group per day; home and bots do not count; totals are all-time', async () => {
  const { a, store, clock, g, refreshedCount } = await setup();
  const pv = (vid, ua) => a.hit({ type: 'pv', path: '/group/x-' + g.id, vid, ip: '1.1.1.1', ua: ua || UA });
  await pv(V1); await pv(V1); await pv(V2); await a.hit({ type: 'hb', path: '/group/x-' + g.id, vid: V1, ip: '1.1.1.1', ua: UA });
  await a.hit({ type: 'pv', path: '/', vid: V1, ip: '1.1.1.1', ua: UA });
  await pv(V1, 'Googlebot/2.1 (+http://www.google.com/bot.html)');
  await a.flush();
  assert.deepEqual((await store.groupCounts())[g.id], { views: 2, joins: 0 });
  assert.ok(refreshedCount() >= 1);
  await pv(V1); await a.flush(); // already counted today (across flushes)
  assert.equal((await store.groupCounts())[g.id].views, 2);
  clock.t += 864e5; await pv(V1); await a.flush(); // next day counts again
  assert.equal((await store.groupCounts())[g.id].views, 3);
});

test('join clicks: deduped per visitor per day, bots and non-approved groups rejected, survive restart', async () => {
  const { a, store, clock, g, other, dir } = await setup();
  const j = (id, vid, ua) => a.join({ id, vid, ip: '9.9.9.9', ua: ua || UA });
  assert.equal(await j(g.id, V1), true);
  assert.equal(await j(g.id, V1), true); // accepted but deduped
  assert.equal(await j(g.id, null), true); // no vid: IP+UA fallback
  assert.equal(await j(g.id, V2, 'curl/8.5.0'), false);
  assert.equal(await j(other.id, V2), false);
  assert.equal(await j('not-an-id!', V2), false);
  await a.flush();
  assert.deepEqual((await store.groupCounts())[g.id], { views: 0, joins: 2 });
  // restart: a fresh store + analytics on the same file still dedupes today's clicks
  const s2 = new JsonStore(path.join(dir, 'db.json')); await s2.init();
  const b = new Analytics({ store: s2, pageKey: async () => null, tz: 'Asia/Kolkata', now: () => clock.t, isGroup: async (id) => id === g.id }); await b.init();
  await b.join({ id: g.id, vid: V1, ip: '9.9.9.9', ua: UA }); await b.flush();
  assert.equal((await s2.groupCounts())[g.id].joins, 2);
  clock.t += 3 * 864e5; await b.join({ id: g.id, vid: V1, ip: '9.9.9.9', ua: UA }); await b.flush();
  assert.equal((await s2.groupCounts())[g.id].joins, 3);
  assert.ok(Object.keys(s2.data.countsSeen).every((d) => d >= '2026-10-21'), 'old dedupe keys pruned');
});

test('counts for a deleted group are dropped, failed flush retries', async () => {
  const { a, store, g } = await setup();
  await a.join({ id: g.id, vid: V1, ip: '1', ua: UA });
  const orig = store.countsFlush.bind(store); let fail = true;
  store.countsFlush = async (...x) => { if (fail) { fail = false; throw new Error('db down'); } return orig(...x); };
  await a.flush(); assert.equal((await store.groupCounts())[g.id], undefined);
  await a.flush(); assert.equal((await store.groupCounts())[g.id].joins, 1);
  await store.deleteGroup(g.id); assert.equal((await store.groupCounts())[g.id], undefined);
});

const G = (id, o) => Object.assign({ id, name: 'G' + id, cat: 'Gaming', country: 'India', lang: 'Hindi', plat: 'wa', status: 'approved', featured: false, createdAt: '2026-10-01T00:00:00Z' }, o);

test('featured: expiry, Adult never, unapproved never, max 6 most recently featured', () => {
  const now = Date.parse('2026-10-24T00:00:00Z');
  assert.equal(F.isFeaturedNow(G('a', { featured: true }), now), true);
  assert.equal(F.isFeaturedNow(G('a', { featured: true, featuredUntil: '2026-10-23T00:00:00Z' }), now), false);
  assert.equal(F.isFeaturedNow(G('a', { featured: true, featuredUntil: '2026-10-25T00:00:00Z' }), now), true);
  assert.equal(F.isFeaturedNow(G('a', { featured: true, cat: 'Adult' }), now), false);
  assert.equal(F.isFeaturedNow(G('a', { featured: true, status: 'pending' }), now), false);
  const list = Array.from({ length: 8 }, (_, i) => G('g' + i, { featured: true, featuredAt: `2026-10-1${i}T00:00:00Z` }));
  const rank = F.featuredRank(list.concat(G('ad', { featured: true, cat: 'Adult', featuredAt: '2026-10-20T00:00:00Z' })), now);
  assert.equal(rank.size, 6);
  assert.deepEqual([...rank.keys()], ['g7', 'g6', 'g5', 'g4', 'g3', 'g2']);
  assert.deepEqual(F.expired([G('x', { featured: true, featuredUntil: '2026-10-01T00:00:00Z' }), G('y', { featured: true })], now).map((g) => g.id), ['x']);
});

test('featured: admin request parsing and contact validation', () => {
  const now = Date.parse('2026-10-24T00:00:00Z');
  assert.equal(F.parseFeature({ featuredDays: 7 }, now).until, '2026-10-31T00:00:00.000Z');
  assert.equal(F.parseFeature({}, now).until, null);
  assert.equal(F.parseFeature({ featuredUntil: '2026-11-30T18:29:59.000Z' }, now).until, '2026-11-30T18:29:59.000Z');
  assert.equal(F.parseFeature({ featuredUntil: '2026-10-01T00:00:00Z' }, now).ok, false);
  assert.equal(F.parseFeature({ featuredDays: 0 }, now).ok, false);
  assert.equal(F.parseFeature({ featuredDays: 'abc' }, now).ok, false);
  assert.equal(F.parseFeature({ featuredUntil: 'nope' }, now).ok, false);
  assert.deepEqual(F.validateContact({ featureContactText: '  Pay via UPI  ', featureContactLink: 'https://wa.me/910000000000' }).value, { featureContactText: 'Pay via UPI', featureContactLink: 'https://wa.me/910000000000' });
  assert.equal(F.validateContact({ featureContactLink: 'javascript:alert(1)' }).ok, false);
  assert.equal(F.validateContact({ featureContactLink: 'http://example.com' }).ok, false);
  assert.equal(F.validateContact({ featureContactLink: 'mailto:me@example.com' }).ok, true);
  assert.equal(F.validateContact({ featureContactText: 'x'.repeat(201) }).ok, false);
});

test('display: compact numbers, zero counts hidden, featured badge and pinning order', () => {
  assert.deepEqual([0, 7, 999, 1000, 1234, 9999, 15300, 999999, 2500000].map(Card.compact), ['0', '7', '999', '1k', '1.2k', '9.9k', '15k', '999k', '2.5M']);
  assert.equal(Card.statsHTML({ views: 0, joins: 0 }), '');
  assert.match(Card.statsHTML({ views: 1234, joins: 0 }), /👁 1\.2k views/);
  assert.doesNotMatch(Card.statsHTML({ views: 1234, joins: 0 }), /joined/);
  assert.match(Card.statsHTML({ views: 1, joins: 45 }), /1 view<.*👥 45 joined/);
  const card = Card.cardHTML(Object.assign(G('c1'), { featured: true, views: 120, joins: 45 }), 0);
  assert.match(card, /class="card featured"/); assert.match(card, /⭐ Featured/); assert.match(card, /120 views/);
  const sorted = render.publicList([G('new', { createdAt: '2026-10-20T00:00:00Z' }), G('f1', { featured: true, featuredAt: '2026-10-02T00:00:00Z' }), G('f2', { featured: true, featuredAt: '2026-10-05T00:00:00Z' })]);
  assert.deepEqual(sorted.map((g) => g.id), ['f2', 'f1', 'new']);
});

test('featured contact modal: placeholder by default, escaped text, only safe links', () => {
  assert.match(render.contactHTML({ text: '', link: '' }), /haven't been added yet/);
  const h = render.contactHTML({ text: '<b>₹99</b> for 7 days', link: 'https://wa.me/910000000000' });
  assert.match(h, /&lt;b&gt;₹99/); assert.match(h, /Message on WhatsApp/); assert.match(h, /href="https:\/\/wa\.me\/910000000000"/);
  assert.doesNotMatch(render.contactHTML({ text: 'hi', link: 'javascript:alert(1)' }), /href/);
  const home = render.renderHome([], { contact: { text: 'Ping me', link: 'mailto:me@example.com' } });
  assert.match(home, /id="featuredOverlay"/); assert.match(home, /Ping me/); assert.match(home, /Email the site owner/); assert.match(home, /data-action="open-featured"/);
  const page = render.renderGroupPage(Object.assign(G('abc123', { link: 'https://chat.whatsapp.com/x', views: 5, joins: 0 }), { updatedAt: '2026-10-01T00:00:00Z' }), [], { contact: { text: 'Ping me', link: '' } });
  assert.match(page, /Ping me/); assert.match(page, /class="gp-stats"/); assert.match(page, /5 views/); assert.doesNotMatch(page, /joined/);
  assert.doesNotMatch(page, /SSR:FEATURE_CONTACT/); assert.doesNotMatch(home, /SSR:FEATURE_CONTACT/);
});
