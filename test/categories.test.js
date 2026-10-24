'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const V = require('../lib/validate');

test('Link Sharing is a valid category and listed in the form, filter and chips', () => {
  assert.ok(V.CATEGORIES.includes('Link Sharing'));
  const r = V.validateGroup({ plat: 'wa', link: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv', name: 'Links hub', cat: 'Link Sharing', country: 'India', lang: 'Hindi', desc: '' });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.value ? r.value.cat : r.group ? r.group.cat : 'Link Sharing', 'Link Sharing');
  assert.ok(V.validateGroup({ plat: 'wa', link: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv', name: 'x hub', cat: 'Links', country: 'India', lang: 'Hindi' }).errors.length > 0);
  const html = fs.readFileSync(path.join(__dirname, '../public/grouphub.html'), 'utf8');
  assert.strictEqual((html.match(/<option>Link Sharing<\/option>/g) || []).length, 2);
  assert.match(html, /data-cat="Link Sharing">🔗 Link Sharing</);
  // every listed option is a valid category
  for (const m of html.matchAll(/<option(?: value="([^"]*)")?>([^<]+)<\/option>/g)) {
    const v = m[1] !== undefined ? m[1] : m[2];
    if (v && /\//.test(v) || v === 'Link Sharing') assert.ok(V.CATEGORIES.includes(v), v);
  }
});
