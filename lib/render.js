'use strict';
// Server-side rendering of the public homepage (so crawlers see real content, not an empty shell),
// plus sitemap.xml. The browser JS takes over after load and re-renders the grid with the same markup
// (public/card-render.js is shared by both sides). Everything user-supplied is HTML-escaped.
const fs = require('fs');
const path = require('path');
const Card = require('../public/card-render.js');

const SITE = 'https://grouphub.in';
const INDEX_MAX = 60;
const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'public', 'grouphub.html'), 'utf8');
const { esc } = Card;

/** Approved groups the public sees by default (no Adult), in the same order as /api/groups. */
function publicList(groups) {
  return groups.filter((g) => (g.status === undefined || g.status === 'approved') && g.cat !== Card.ADULT) // publicGroup() objects have no status (already approved-only)
    .sort((a, b) => (b.featured - a.featured) || b.createdAt.localeCompare(a.createdAt));
}

/** groups: approved+public groups already mapped like publicGroup() (with img). */
function renderHome(groups) {
  const list = publicList(groups);
  const wa = list.filter((g) => g.plat === 'wa');
  const first = wa.slice(0, Card.PAGE_SIZE);
  const grid = first.length ? first.map(Card.cardHTML).join('')
    : '<div class="empty"><p>No groups found.<br>Try a different filter~</p></div>';
  const uniq = (k) => new Set(list.map((g) => g[k])).size;
  // Crawlable "recently added" index: real (non-sample) groups, newest first.
  const recent = list.filter((g) => !g.sample).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, INDEX_MAX);
  const plat = (g) => (g.plat === 'wa' ? 'WhatsApp' : 'Telegram');
  const safeLink = (g) => (/^https:\/\/(chat\.whatsapp\.com|t\.me)\//.test(g.link) ? g.link : '#');
  const index = recent.length ? `<section class="recent" aria-labelledby="recentTitle">
  <h2 id="recentTitle">Recently added WhatsApp &amp; Telegram groups</h2>
  <ul>
${recent.map((g) => `    <li><a href="${esc(safeLink(g))}" target="_blank" rel="nofollow ugc noopener noreferrer">${esc(g.name)}</a> · ${plat(g)} group · ${esc(g.cat)} · ${esc(g.country)} · ${esc(g.lang)}${g.desc ? ' – ' + esc(g.desc.length > 120 ? g.desc.slice(0, 117) + '…' : g.desc) : ''}</li>`).join('\n')}
  </ul>
</section>` : '';
  const fill = {
    STAT_GROUPS: String(list.length), STAT_COUNTRIES: String(uniq('country')), STAT_CATS: String(uniq('cat')),
    GRID_LABEL: 'WhatsApp Groups · ' + wa.length, GRID: grid,
    LOADMORE_STYLE: wa.length > first.length ? '' : ' style="display:none"', INDEX: index
  };
  return TEMPLATE.replace(/<!--SSR:([A-Z_]+)-->/g, (m, k) => (k in fill ? fill[k] : ''));
}

/** Only real public pages: the homepage (filters are client-side, so they are not separate pages). */
function renderSitemap(groups) {
  const list = publicList(groups);
  const last = list.reduce((m, g) => (g.updatedAt > m ? g.updatedAt : m), '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}/</loc>${last ? `\n    <lastmod>${new Date(last).toISOString()}</lastmod>` : ''}
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

module.exports = { renderHome, renderSitemap, publicList };
