'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const M = require('../lib/monetag');
const render = require('../lib/render');

const EXPECTED = "<script>(function(s){s.dataset.zone='12075937',s.src='https://al5sm.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>";

test('Monetag OnClick snippet is the exact Monetag code and its CSP hash matches', () => {
  assert.strictEqual(M.TAG, EXPECTED);
  const h = crypto.createHash('sha256').update(EXPECTED.slice('<script>'.length, -'</script>'.length)).digest('base64');
  assert.strictEqual(M.HASH, `'sha256-${h}'`);
});

test('public templates and rendered pages contain the snippet byte-for-byte in <head>, once', () => {
  for (const f of ['public/grouphub.html', 'views/group.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    assert.strictEqual(head.split(M.TAG).length - 1, 1, f);
    assert.ok(!html.includes('src="/monetag.js"'), f);
  }
  const g = { id: 'abcdef123456', name: 'T', cat: 'Education', country: 'India', lang: 'Hindi', plat: 'wa', link: 'https://chat.whatsapp.com/x', desc: '', createdAt: new Date().toISOString() };
  for (const out of [render.renderHome([g]), render.renderGroupPage(g, []), render.render404()]) {
    assert.strictEqual(out.split(M.TAG).length - 1, 1);
    // no other inline <script> (only the hashed one is allowed by the CSP)
    assert.deepStrictEqual(out.match(/<script>[\s\S]*?<\/script>/g), [M.TAG]);
  }
});

test('public CSP allows the hash (not unsafe-inline); admin CSP stays strict; /monetag.js still exists', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /script-src 'self' \$\{Monetag\.HASH\}/);
  const strict = src.match(/const STRICT_CSP = "([^"]+)"/)[1];
  assert.match(strict, /script-src 'self';/);
  assert.ok(!/unsafe-inline/.test(src.match(/script-src[^;`"]*/g).join(' ')));
  assert.strictEqual(fs.readFileSync(path.join(__dirname, '..', 'public/monetag.js'), 'utf8').trim(), M.INLINE);
});
