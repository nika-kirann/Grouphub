'use strict';
// Usage: npm run hash-password -- "your long password"
// Prints a value for ADMIN_PASSWORD_HASH so the plain password never needs to be stored on the server.
const crypto = require('crypto');
const pw = process.argv[2];
if (!pw || pw.length < 10) { console.error('Give a password of at least 10 characters.'); process.exit(1); }
const salt = crypto.randomBytes(16);
console.log('scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(pw, salt, 64).toString('hex'));
