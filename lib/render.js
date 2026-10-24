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
  const index = recent.length ? `<section class="recent" aria-labelledby="recentTitle">
  <h2 id="recentTitle">Recently added WhatsApp &amp; Telegram groups</h2>
  <ul>
${recent.map((g) => `    <li><a href="${esc(Card.groupPath(g))}">${esc(g.name)}</a> · ${plat(g)} group · ${esc(g.cat)} · ${esc(g.country)} · ${esc(g.lang)}${g.desc ? ' – ' + esc(g.desc.length > 120 ? g.desc.slice(0, 117) + '…' : g.desc) : ''}</li>`).join('\n')}
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
  const xesc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // One page per approved, non-adult, non-sample group (sample groups have fake links and are noindex).
  const pages = list.filter((g) => !g.sample).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((g) => `  <url>
    <loc>${xesc(SITE + Card.groupPath(g))}</loc>
    <lastmod>${new Date(g.updatedAt || g.createdAt).toISOString()}</lastmod>
  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}/</loc>${last ? `\n    <lastmod>${new Date(last).toISOString()}</lastmod>` : ''}
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
${pages.join('\n')}${pages.length ? '\n' : ''}</urlset>
`;
}

// ---------------- group pages ----------------
const GROUP_TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'views', 'group.html'), 'utf8');
const pick = (re) => { const m = TEMPLATE.match(re); if (!m) throw new Error('render: homepage block not found: ' + re); return m[0]; };
const STYLE = pick(/<style>[\s\S]*?<\/style>/).replace(/^<style>|<\/style>$/g, '');
// Header/footer/modals are taken from the homepage so both pages always look the same; in-page links point home.
const NAV = pick(/<!-- NAV -->[\s\S]*?<\/nav>/).replace('href="#" class="nav-logo"', 'href="/" class="nav-logo"')
  .replace('href="#groupGrid"', 'href="/#groupGrid"').replace('href="#add" data-action="open-add"', 'href="/#add"');
const FOOTER = pick(/<!-- FOOTER -->[\s\S]*?<\/footer>/).replace(/href="#"/g, 'href="/"');
const OVERLAYS = pick(/<!-- REPORT MODAL -->[\s\S]*?(?=<!-- FOOTER -->)/);
const jsonLd = (obj) => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
const PLAT = { wa: 'WhatsApp', tg: 'Telegram' };
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t);

function fillGroupTemplate(f) { return GROUP_TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in f ? f[k] : '')); }

/** g: approved group (with .img like publicGroup); similar: publicGroup objects for the "Similar groups" grid. */
function renderGroupPage(g, similar) {
  const platform = PLAT[g.plat] || 'Group';
  const url = SITE + Card.groupPath(g);
  const isAdult = g.cat === Card.ADULT;
  const title = `${g.name} – ${platform} group | GROUPHUB`;
  const desc = g.desc ? clip(g.desc, 160)
    : `Join ${g.name}, a ${platform} group about ${g.cat} (${g.country}, ${g.lang}). Free, moderated group links on GROUPHUB.`;
  const image = g.img ? SITE + g.img : SITE + '/og-image.png';
  const safeInvite = /^https:\/\/(chat\.whatsapp\.com|t\.me)\//.test(g.link) ? g.link : '#';
  const avatar = g.img && /^\/img\/group\/[A-Za-z0-9]+\?v=\d+$/.test(g.img)
    ? `<img class="avatar-img" src="${esc(g.img)}" alt="${esc(g.name)} group picture" width="104" height="104" decoding="async">` : Card.letterAvatar(g);
  const members = g.members ? Number(g.members).toLocaleString('en-US') + ' members' : 'Not listed';
  const main = `<main class="gp-wrap" id="groupMain" data-id="${esc(g.id)}" data-name="${esc(g.name)}" data-link="${esc(safeInvite)}"${isAdult ? ' data-adult="1"' : ''}>
  <div class="crumbs" role="navigation" aria-label="Breadcrumb"><a href="/">Home</a> › <span>${esc(g.cat)}</span> › <span aria-current="page">${esc(g.name)}</span></div>
  <article class="gp-card">
    <header class="gp-head">
      <div class="gp-avatar card-icon avatar ${g.plat === 'wa' ? 'wa' : 'tg'}">${avatar}<span class="avatar-plat">${g.plat === 'wa' ? Card.ICON.wa : Card.ICON.tg}</span></div>
      <div>
        <h1>${esc(g.name)}</h1>
        <div class="gp-badges">
          ${g.featured ? '<span class="badge badge-featured">★ Featured</span>' : ''}
          <span class="badge badge-${g.plat === 'wa' ? 'wa' : 'tg'}">${platform} group</span>
          <span class="badge badge-cat">${esc(g.cat)}</span>
          ${isAdult ? '<span class="badge badge-adult" title="Adults only">18+</span>' : ''}
          ${g.sample ? '<span class="badge badge-sample">Sample</span>' : ''}
        </div>
      </div>
    </header>
    <dl class="gp-facts">
      <div class="gp-fact"><dt>Category</dt><dd>${esc(g.cat)}</dd></div>
      <div class="gp-fact"><dt>Country</dt><dd>🌍 ${esc(g.country)}</dd></div>
      <div class="gp-fact"><dt>Language</dt><dd>${esc(g.lang)}</dd></div>
      <div class="gp-fact"><dt>Members</dt><dd>${members}</dd></div>
      <div class="gp-fact"><dt>Added</dt><dd><time datetime="${esc(g.createdAt)}">${fmtDate(g.createdAt)}</time></dd></div>
    </dl>
    ${g.desc ? `<p class="gp-desc">${esc(g.desc)}</p>` : '<p class="gp-desc muted">The group admin hasn\'t added a description yet.</p>'}
    <div class="gp-safety" role="note"><b>Before you join:</b> GROUPHUB lists public invite links that people submit and our moderators review, but we don't run these groups. Never share OTPs, passwords or bank details, don't send money to strangers, and leave any group that asks you to. See something wrong? Use Report.</div>
    <div class="gp-actions">
      <a class="gp-join ${g.plat === 'wa' ? 'wa' : 'tg'}" href="${esc(safeInvite)}" target="_blank" rel="nofollow noopener noreferrer">${g.plat === 'wa' ? Card.ICON.wa : Card.ICON.tg} Join on ${platform}</a>
      <button type="button" class="gp-btn" data-action="copy">🔗 Copy invite link</button>
      <button type="button" class="gp-btn" data-action="report" data-id="${esc(g.id)}" data-name="${esc(g.name)}">⚑ Report</button>
    </div>
    ${g.sample ? '<p class="gp-sample">This is a sample listing with a fake invite link, so joining won\'t work.</p>' : ''}
  </article>
  <div class="gp-back-row"><a class="gp-btn" href="/">← Back to all groups</a></div>
</main>
${similar.length ? `<section class="gp-similar" aria-labelledby="similarTitle">
  <h2 class="section-title" id="similarTitle">Similar groups</h2>
  <div class="grid">${similar.map(Card.cardHTML).join('')}</div>
</section>` : ''}`;
  const social = `<meta property="og:type" content="website">
  <meta property="og:site_name" content="GROUPHUB">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:alt" content="${esc(g.name)}">
  <meta name="twitter:card" content="${g.img ? 'summary' : 'summary_large_image'}">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${esc(image)}">`;
  return fillGroupTemplate({
    TITLE: esc(title), DESCRIPTION: esc(desc),
    // Adult pages are gated client-side and kept out of search; sample listings are not real groups.
    ROBOTS: isAdult || g.sample ? '<meta name="robots" content="noindex, follow">' : '',
    CANONICAL: `<link rel="canonical" href="${esc(url)}">`, SOCIAL: social,
    JSONLD: jsonLd({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'GROUPHUB', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: g.name, item: url }] }),
    STYLE, NAV, FOOTER, OVERLAYS, MAIN: main, BODY_CLASS: isAdult ? ' class="adult-locked"' : ''
  });
}

function render404() {
  return fillGroupTemplate({
    TITLE: 'Group not found | GROUPHUB', DESCRIPTION: 'This group is not available on GROUPHUB.',
    ROBOTS: '<meta name="robots" content="noindex">', STYLE, NAV, FOOTER, OVERLAYS: '',
    MAIN: `<main class="gp-404"><h1>Group not found</h1><p>This group doesn't exist, is waiting for review, or was removed.</p><a class="gp-btn" href="/">← Browse all groups</a></main>`
  });
}

/** Parse "/group/<slug>-<id>" (or just "<id>") -> id or null. */
function parseGroupParam(param) {
  const m = /^(?:(.*)-)?([a-f0-9]{6,32})$/.exec(String(param || ''));
  return m ? m[2] : null;
}

module.exports = { renderHome, renderSitemap, publicList, renderGroupPage, render404, parseGroupParam };
