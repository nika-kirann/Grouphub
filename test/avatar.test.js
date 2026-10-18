'use strict';
// Unit tests for picture parsing / URL safety (no network). Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../lib/avatar');
const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('WhatsApp invite page with a group icon -> pps.whatsapp.net URL with entities decoded', () => {
  const u = A.parseOgImage(fx('whatsapp-group-with-icon.html'));
  assert.match(u, /^https:\/\/pps\.whatsapp\.net\/v\/t61/);
  assert.ok(u.includes('&oh=01_FAKE&oe=') && !u.includes('&amp;'));
  assert.equal(A.isGenericImage(u), false);
  assert.ok(A.allowedUrl(u, A.isImageHost));
});
test('WhatsApp invite page without icon / revoked -> generic static.whatsapp.net image is skipped', () => {
  const u = A.parseOgImage(fx('whatsapp-revoked-invite.html'));
  assert.match(u, /^https:\/\/static\.whatsapp\.net\//);
  assert.equal(A.isGenericImage(u), true);
});
test('Telegram channel page -> cdn*.telesco.pe photo', () => {
  const u = A.parseOgImage(fx('telegram-channel.html'));
  assert.match(u, /^https:\/\/cdn\d*\.telesco\.pe\/file\//);
  assert.equal(A.isGenericImage(u), false);
  assert.ok(A.allowedUrl(u, A.isImageHost));
});
test('Telegram invalid invite -> default Telegram logo is skipped', () => {
  const u = A.parseOgImage(fx('telegram-invalid-invite.html'));
  assert.equal(u, 'https://telegram.org/img/t_logo_2x.png');
  assert.equal(A.isGenericImage(u), true);
});
test('Discord invite JSON -> CDN icon URL; no icon -> null', () => {
  const j = JSON.parse(fx('discord-invite.json'));
  assert.equal(A.discordIconUrl(j), `https://cdn.discordapp.com/icons/${j.guild.id}/${j.guild.icon}.png?size=256`);
  assert.equal(A.discordIconUrl({ guild: { id: '123456789', icon: null } }), null);
  assert.equal(A.discordIconUrl({ guild: { id: '../x', icon: 'abcdef0123456789' } }), null);
});
test('og:image parsing handles attribute order, quotes, name= and fallbacks', () => {
  assert.equal(A.parseOgImage(`<meta content='https://cdn4.telesco.pe/a.jpg' property='og:image'>`), 'https://cdn4.telesco.pe/a.jpg');
  assert.equal(A.parseOgImage(`<META NAME="twitter:image" CONTENT="https://cdn1.telesco.pe/b.jpg">`), 'https://cdn1.telesco.pe/b.jpg');
  assert.equal(A.parseOgImage(`<meta property="og:image" content="">`), null);
  assert.equal(A.parseOgImage('<html><head></head></html>'), null);
});
test('sourceFor maps stored links to the page/API we fetch', () => {
  assert.deepEqual(A.sourceFor('https://chat.whatsapp.com/FtwV7Gwaet41nWgXCxc2cd'), { kind: 'wa', page: 'https://chat.whatsapp.com/FtwV7Gwaet41nWgXCxc2cd' });
  assert.deepEqual(A.sourceFor('https://t.me/+AbCdEfGhIjKl'), { kind: 'tg', page: 'https://t.me/+AbCdEfGhIjKl' });
  assert.deepEqual(A.sourceFor('https://t.me/durov'), { kind: 'tg', page: 'https://t.me/durov' });
  assert.deepEqual(A.sourceFor('https://discord.gg/discord-developers'), { kind: 'dc', api: 'https://discord.com/api/v10/invites/discord-developers' });
  assert.equal(A.sourceFor('https://evil.example/t.me/durov'), null);
  assert.equal(A.sourceFor('https://t.me/durov/../../x'), null);
});
test('SSRF allowlist: only exact hosts, https, default port, no credentials', () => {
  const page = (u) => !!A.allowedUrl(u, A.isPageHost), img = (u) => !!A.allowedUrl(u, A.isImageHost);
  assert.ok(page('https://t.me/x') && page('https://chat.whatsapp.com/x') && page('https://discord.com/api/v10/invites/x'));
  for (const bad of ['http://t.me/x', 'https://t.me:8443/x', 'https://user:pw@t.me/x', 'https://t.me.evil.com/x', 'https://evil.com/?t.me', 'https://127.0.0.1/', 'https://localhost/', 'https://169.254.169.254/latest', 'file:///etc/passwd', 'https://xt.me/x'])
    assert.equal(page(bad), false, bad);
  assert.ok(img('https://pps.whatsapp.net/v/x.jpg') && img('https://cdn5.telesco.pe/f.jpg') && img('https://cdn.telesco.pe/f.jpg') && img('https://cdn.discordapp.com/icons/1/a.png'));
  for (const bad of ['https://evilpps.whatsapp.net/x', 'https://cdn4.telesco.pe.evil.com/x', 'https://t.me/x.jpg', 'http://cdn4.telesco.pe/x', 'https://media.discordapp.net/x'])
    assert.equal(img(bad), false, bad);
});

// ----- fetch behaviour with a mocked fetch (no network) -----
function mockFetch(routes) {
  const seen = [];
  global.fetch = async (u, opts) => {
    seen.push(String(u)); assert.equal(opts.redirect, 'manual');
    const r = routes[String(u)];
    if (!r) throw new Error('unexpected request ' + u);
    const body = Buffer.from(r.body || '');
    return { status: r.status || 200, ok: (r.status || 200) < 300, headers: new Map(Object.entries(Object.assign({ 'content-type': r.type || 'text/html' }, r.headers || {}))),
      body: (async function* () { yield body; })() };
  };
  return seen;
}
const realFetch = global.fetch;
test.after(() => { global.fetch = realFetch; });
const page = (img) => `<meta property="og:image" content="${img}">`;

test('redirect to a non-allowlisted host is refused (SSRF)', async () => {
  const seen = mockFetch({ 'https://t.me/somegroup': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } } });
  const r = await A.fetchGroupImage('https://t.me/somegroup');
  assert.equal(r.ok, false); assert.match(r.reason, /redirect/); assert.deepEqual(seen, ['https://t.me/somegroup']);
});
test('og:image on a non-allowlisted host is never requested', async () => {
  const seen = mockFetch({ 'https://t.me/somegroup': { body: page('https://evil.example/x.jpg') } });
  const r = await A.fetchGroupImage('https://t.me/somegroup');
  assert.equal(r.ok, false); assert.match(r.reason, /not allowed/); assert.equal(seen.length, 1);
});
test('non-image content-type (e.g. SVG or HTML) is rejected', async () => {
  for (const type of ['image/svg+xml', 'text/html']) {
    mockFetch({ 'https://t.me/somegroup': { body: page('https://cdn4.telesco.pe/file/x.jpg') }, 'https://cdn4.telesco.pe/file/x.jpg': { type, body: '<svg/>' } });
    const r = await A.fetchGroupImage('https://t.me/somegroup');
    assert.equal(r.ok, false); assert.match(r.reason, /not an image/);
  }
});
test('oversized image (Content-Length > 2 MB) is rejected', async () => {
  mockFetch({ 'https://t.me/somegroup': { body: page('https://cdn4.telesco.pe/file/x.jpg') }, 'https://cdn4.telesco.pe/file/x.jpg': { type: 'image/jpeg', headers: { 'content-length': String(3 * 1024 * 1024) } } });
  const r = await A.fetchGroupImage('https://t.me/somegroup');
  assert.equal(r.ok, false); assert.match(r.reason, /too large/);
});
test('too many redirects are refused', async () => {
  mockFetch({ 'https://t.me/abcdef': { status: 301, headers: { location: '/b' } }, 'https://t.me/b': { status: 301, headers: { location: '/c' } }, 'https://t.me/c': { status: 301, headers: { location: '/d' } }, 'https://t.me/d': { status: 301, headers: { location: '/e' } } });
  const r2 = await A.fetchGroupImage('https://t.me/abcdef');
  assert.equal(r2.ok, false); assert.match(r2.reason, /too many redirects/);
});
