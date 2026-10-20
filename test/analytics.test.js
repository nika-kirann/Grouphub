'use strict';
// Traffic stats: counting rules, daily uniques, online-now window, persistence (JSON store). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JsonStore = require('../lib/store');
const { Analytics, isBot, addDays, dayOf } = require('../lib/analytics');

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const V1 = 'a'.repeat(32), V2 = 'b'.repeat(32);
const pageKey = async (p) => (p === '/' ? 'home' : p === '/group/test-abc123' ? 'g:abc123' : null);

async function setup(startMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-stats-'));
  const store = new JsonStore(path.join(dir, 'db.json')); await store.init();
  const clock = { t: startMs };
  const a = new Analytics({ store, pageKey, tz: 'Asia/Kolkata', now: () => clock.t });
  await a.init();
  return { a, store, clock, dir };
}
const T0 = Date.parse('2026-10-20T06:00:00Z'); // 11:30 IST

test('bot user-agents are detected, real browsers are not', () => {
  ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)', 'curl/8.5.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0 Safari/537.36', 'facebookexternalhit/1.1', ''].forEach((ua) => assert.ok(isBot(ua), ua));
  [UA, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'].forEach((ua) => assert.ok(!isBot(ua), ua));
});

test('days are bucketed in IST and date math works', () => {
  assert.equal(dayOf(new Date('2026-10-20T19:00:00Z'), 'Asia/Kolkata'), '2026-10-21'); // 00:30 IST
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('page views, daily unique visitors, new visitors, top pages; bots and unknown pages ignored', async () => {
  const { a, store } = await setup(T0);
  assert.equal(await a.hit({ type: 'pv', path: '/', vid: V1, isNew: true, ip: '1.1.1.1', ua: UA }), true);
  await a.hit({ type: 'pv', path: '/group/test-abc123', vid: V1, ip: '1.1.1.1', ua: UA });
  await a.hit({ type: 'pv', path: '/', vid: V2, isNew: true, ip: '2.2.2.2', ua: UA });
  await a.hit({ type: 'hb', path: '/', vid: V2, ip: '2.2.2.2', ua: UA }); // heartbeat: not a page view
  assert.equal(await a.hit({ type: 'pv', path: '/', ip: '3.3.3.3', ua: 'Googlebot/2.1' }), false);
  for (const p of ['/admin', '/api/groups', '/healthz', '/robots.txt', '/sitemap.xml', '/sw.js', '/logo.png', '/group/nope-ffffff'])
    assert.equal(await a.hit({ type: 'pv', path: p, vid: V1, ip: '1.1.1.1', ua: UA }), false, p);
  await a.flush();
  // Same visitor again after a flush (e.g. later the same day) must not be counted twice.
  await a.hit({ type: 'pv', path: '/', vid: V1, isNew: false, ip: '1.1.1.1', ua: UA });
  const s = await a.summary();
  assert.deepEqual(s.todayStats, { visitors: 2, pageviews: 4, newVisitors: 2 });
  assert.equal(s.allTime.visitors, 2); assert.equal(s.allTime.pageviews, 4);
  assert.equal(s.days.length, 30); assert.equal(s.days[29].day, '2026-10-20');
  assert.deepEqual(s.topToday, [{ page: 'home', views: 3 }, { page: 'g:abc123', views: 1 }]);
  assert.equal(s.onlineNow, 2);
  // No raw IDs or IPs in the stored data.
  const raw = fs.readFileSync(store.file, 'utf8');
  assert.ok(!raw.includes(V1) && !raw.includes('1.1.1.1'));
});

test('a returning visitor on a new day counts as a visitor that day but not as a new all-time visitor', async () => {
  const { a, clock } = await setup(T0);
  await a.hit({ type: 'pv', path: '/', vid: V1, isNew: true, ip: '1.1.1.1', ua: UA });
  clock.t += 864e5;
  await a.hit({ type: 'pv', path: '/', vid: V1, isNew: false, ip: '1.1.1.1', ua: UA });
  const s = await a.summary();
  assert.equal(s.todayStats.visitors, 1); assert.equal(s.last7.visitors, 2);
  assert.equal(s.allTime.visitors, 1); assert.equal(s.allTime.pageviews, 2);
});

test('online now only counts visitors seen in the last 5 minutes', async () => {
  const { a, clock } = await setup(T0);
  await a.hit({ type: 'pv', path: '/', vid: V1, ip: '1.1.1.1', ua: UA });
  clock.t += 3 * 60e3;
  await a.hit({ type: 'hb', path: '/', vid: V2, ip: '2.2.2.2', ua: UA });
  assert.equal(a.onlineNow(), 2);
  clock.t += 3 * 60e3; // V1 last seen 6 min ago
  assert.equal(a.onlineNow(), 1);
});

test('counts survive a restart and old visitor hashes are pruned after 90 days', async () => {
  const { a, store, clock } = await setup(T0);
  await a.hit({ type: 'pv', path: '/', vid: V1, isNew: true, ip: '1.1.1.1', ua: UA });
  await a.flush();
  const b = new Analytics({ store, pageKey, tz: 'Asia/Kolkata', now: () => clock.t }); await b.init();
  assert.equal(b.startedDay, '2026-10-20');
  await b.hit({ type: 'pv', path: '/', vid: V1, isNew: false, ip: '1.1.1.1', ua: UA }); // same salt after restart -> same hash
  assert.equal((await b.summary()).todayStats.visitors, 1);
  clock.t += 91 * 864e5; await b.flush();
  assert.equal(store.data.analytics.visitors['2026-10-20'], undefined);
  assert.equal((await b.summary()).allTime.pageviews, 2); // daily totals are kept
});
