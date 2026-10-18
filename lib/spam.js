'use strict';
// Simple spam check used by auto-approve. When auto-approve is ON, a submission that trips any rule
// here goes to the pending queue for a human instead of going live. Edit the lists freely.
// Matching is case-insensitive. Words match whole words; phrases match anywhere.

const SPAM_WORDS = [
  'earn daily', 'daily earning', 'earn money', 'make money', 'work from home', 'passive income',
  'investment', 'invest', 'investing', 'forex', 'signals', 'trading signals', 'crypto pump', 'pump and dump', 'binary option',
  'loan', 'loans', 'instant loan', 'betting', 'bet', 'casino', 'satta', 'matka', 'jackpot', 'lottery',
  '100% profit', 'guaranteed profit', 'double your money', 'profit daily', 'free money', 'giveaway',
  'click here', 'dm for', 'whatsapp me', 'call girl', 'escort'
];
const MAX_EMOJIS = { name: 3, desc: 6 };          // more than this -> held for review
const CAPS_MIN_LETTERS = 10, CAPS_RATIO = 0.7;      // mostly-uppercase text (>=10 letters, >70% caps)

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_RES = SPAM_WORDS.map((w) => ({ w, re: new RegExp((/^\w/.test(w) ? '\\b' : '') + esc(w).replace(/\s+/g, '\\s+') + (/\w$/.test(w) ? '\\b' : ''), 'i') }));
const URL_RE = /(https?:\/\/|www\.|\bt\.me\/|\bwa\.me\/|chat\.whatsapp\.com|\b[a-z0-9-]{2,}\.(?:com|net|org|in|io|me|ly|co|xyz|link|site|top|shop|online|club|info|biz|app)\b)/i;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function capsHeavy(s) {
  const letters = s.match(/\p{L}/gu) || [];
  const upper = s.match(/\p{Lu}/gu) || [];
  return letters.length >= CAPS_MIN_LETTERS && upper.length / letters.length > CAPS_RATIO;
}

/** Returns { spam: boolean, reasons: string[] } for a validated group (uses name + desc). */
function checkSpam({ name = '', desc = '' }) {
  const reasons = [];
  const text = name + ' \n ' + desc;
  const hits = WORD_RES.filter(({ re }) => re.test(text)).map(({ w }) => w);
  if (hits.length) reasons.push('spam words: ' + hits.slice(0, 5).join(', '));
  if (URL_RE.test(desc)) reasons.push('link in description');
  if ((name.match(EMOJI_RE) || []).length > MAX_EMOJIS.name || (desc.match(EMOJI_RE) || []).length > MAX_EMOJIS.desc) reasons.push('too many emojis');
  if (capsHeavy(name) || capsHeavy(desc)) reasons.push('mostly capital letters');
  return { spam: reasons.length > 0, reasons };
}

module.exports = { checkSpam, SPAM_WORDS };
