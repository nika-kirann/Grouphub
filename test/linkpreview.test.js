'use strict';
// Group-name auto-fill from invite pages. fetch is mocked: no network. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../lib/linkpreview');
const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

const realFetch = globalThis.fetch;
let calls = [];
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(String(url)); return handler(String(url), opts); };
}
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: Object.assign({ 'content-type': 'text/html; charset=utf-8' }, headers) });
test.beforeEach(() => { L.clearCache(); L.config.timeoutMs = L.TIMEOUT_MS; });
test.after(() => { globalThis.fetch = realFetch; });

test('WhatsApp invite with a name -> og:title (not the generic <title>)', async () => {
  mockFetch(() => html(fx('whatsapp-group-with-icon.html')));
  const r = await L.fetchLinkName('chat.whatsapp.com/SAMPLEFAKEGROUPHUB0001?utm=x');
  assert.equal(r.name, 'Example Group');
  assert.equal(r.plat, 'wa');
  assert.deepEqual(calls, ['https://chat.whatsapp.com/SAMPLEFAKEGROUPHUB0001']);
});
test('WhatsApp hex entities (real-world fancy names and emoji) are decoded', async () => {
  mockFetch(() => html('<title id="pageTitle">WhatsApp Group Invite</title><meta property="og:title" content="&#x1d401;&#x1d401; &#x1d407;&#x1d414;&#x1d401;&#x2728; &amp; friends" />'));
  assert.equal((await L.fetchLinkName('https://chat.whatsapp.com/Fm1FWkwmczzE3YUk2jjdqc')).name, '𝐁𝐁 𝐇𝐔𝐁✨ & friends');
});
test('revoked WhatsApp invite (empty og:title, generic <title>) -> null', async () => {
  mockFetch(() => html(fx('whatsapp-revoked-invite.html')));
  assert.equal((await L.fetchLinkName('https://chat.whatsapp.com/SAMPLEFAKEGROUPHUB0001')).name, null);
});
test('Telegram channel -> og:title; invalid invite / unknown user -> null', async () => {
  mockFetch(() => html(fx('telegram-channel.html')));
  assert.equal((await L.fetchLinkName('https://t.me/durov')).name, 'Pavel Durov');
  mockFetch(() => html(fx('telegram-invalid-invite.html')));
  assert.equal((await L.fetchLinkName('https://t.me/+AbCdEfGhIjKlmn')).name, null);
  mockFetch(() => html('<title>Telegram: Contact @nosuchuser</title><meta property="og:title" content="Telegram: Contact @nosuchuser">'));
  assert.equal((await L.fetchLinkName('https://telegram.me/nosuchuser')).name, null);
  assert.equal(calls[0], 'https://t.me/nosuchuser');
});
test('cleanName strips platform boilerplate and caps length without splitting emoji', () => {
  assert.equal(L.cleanName('Foo &amp; Bar – Telegram'), 'Foo & Bar');
  assert.equal(L.cleanName('WhatsApp Group Invite: Study Club'), 'Study Club');
  for (const g of ['WhatsApp Group Invite', 'Join group chat on Telegram', 'Telegram: View @telegram', 'Telegram', '', '   ', null]) assert.equal(L.cleanName(g), null, String(g));
  const long = L.cleanName('a'.repeat(59) + '😀😀');
  assert.equal(long, 'a'.repeat(59)); // the emoji (2 UTF-16 units) would exceed 60, so it is dropped whole
});
test('fallback to <title> when there is no og:title', async () => {
  mockFetch(() => html('<html><head><title>Crypto Club | WhatsApp</title></head></html>'));
  assert.equal((await L.fetchLinkName('https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAAAAAA')).name, 'Crypto Club');
});
test('non-invite URLs are rejected without any fetch (SSRF)', async () => {
  mockFetch(() => { throw new Error('must not fetch'); });
  for (const bad of ['https://evil.com/x', 'http://127.0.0.1/', 'https://t.me.evil.com/durov', 'https://discord.gg/abc', 'file:///etc/passwd', 'https://chat.whatsapp.com/short', '']) {
    const r = await L.fetchLinkName(bad);
    assert.equal(r.name, null, bad);
  }
  assert.equal(calls.length, 0);
});
test('redirects off the invite hosts are refused', async () => {
  mockFetch((u) => (u.startsWith('https://t.me/') ? new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }) : html('<meta property="og:title" content="pwned">')));
  const r = await L.fetchLinkName('https://t.me/somechannel');
  assert.equal(r.name, null);
  assert.match(r.reason, /not allowed/);
  assert.deepEqual(calls, ['https://t.me/somechannel']);
});
test('oversized responses are cut off', async () => {
  mockFetch(() => html('<meta property="og:title" content="Big">' + 'x'.repeat(L.MAX_HTML + 10), 200, { 'content-length': '' }));
  const r = await L.fetchLinkName('https://t.me/bigchannel');
  assert.equal(r.name, null);
  assert.match(r.reason, /too large/);
});
test('slow responses time out', async () => {
  L.config.timeoutMs = 50;
  mockFetch((u, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
  const r = await L.fetchLinkName('https://t.me/slowchannel');
  assert.equal(r.name, null);
  assert.match(r.reason, /timed out/);
});
test('results are cached and concurrent lookups share one fetch', async () => {
  mockFetch(() => html('<meta property="og:title" content="Cached Name">'));
  const [a, b] = await Promise.all([L.fetchLinkName('https://t.me/cachedone'), L.fetchLinkName('t.me/cachedone/')]);
  const c = await L.fetchLinkName('https://t.me/cachedone');
  assert.equal(a.name, 'Cached Name'); assert.equal(b.name, 'Cached Name'); assert.equal(c.name, 'Cached Name'); assert.equal(c.cached, true);
  assert.equal(calls.length, 1);
});
test('isGenericName: only placeholder names get replaced on approval', () => {
  for (const g of ['', 'WhatsApp Group', 'Telegram', 'group', 'Telegram Channel', 'My group', 'Test', 'WhatsApp Group Invite']) assert.equal(L.isGenericName(g), true, g);
  for (const n of ['BB HUB', 'Link Group', 'Telegram News', 'KMPOFFICIAL 3', 'Study Group India']) assert.equal(L.isGenericName(n), false, n);
});
