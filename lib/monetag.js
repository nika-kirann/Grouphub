'use strict';
// Monetag OnClick tag (zone 12075937), inlined in <head> of the public pages exactly as Monetag provides it,
// because Monetag's "Installation check" looks for this snippet in the HTML. The public CSP allows it by its
// sha256 hash (no 'unsafe-inline'). The hash is computed here from the exact text, and test/monetag.test.js
// checks that public/grouphub.html and views/group.html contain this text byte-for-byte, so the two can't drift.
// Don't reformat the snippet (no whitespace changes): any change to the bytes changes the hash.
const crypto = require('crypto');

const ZONE = '12075937';
const INLINE = "(function(s){s.dataset.zone='12075937',s.src='https://al5sm.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))";
const TAG = `<script>${INLINE}</script>`;
const HASH = `'sha256-${crypto.createHash('sha256').update(INLINE, 'utf8').digest('base64')}'`;

module.exports = { ZONE, INLINE, TAG, HASH };
