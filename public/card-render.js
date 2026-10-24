/* GroupHub card markup, shared by the browser (window.GHCard) and the server (require), so the
   server-rendered first page and the JS-rendered grid are identical. All user text is escaped. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GHCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PAGE_SIZE = 9;
  const ADULT = 'Adult';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = {
    wa: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#25d366" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.07L2 22l5.13-1.35A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Z"/></svg>',
    tg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#2aabee" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm4.64 6.8-1.69 8.02c-.12.57-.46.71-.93.44l-2.56-1.89-1.23 1.19c-.14.13-.25.25-.51.25l.18-2.6 4.69-4.24c.2-.18-.04-.28-.32-.1L7.46 14.6l-2.52-.79c-.55-.17-.56-.55.12-.81l9.85-3.8c.46-.16.86.11.73.6Z"/></svg>'
  };
  // Group page URL: /group/<slug>-<id>. The slug is cosmetic (ASCII words from the name); the id is what counts.
  function slugify(name) {
    const s = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
    return s || 'group';
  }
  const groupPath = (g) => '/group/' + slugify(g.name) + '-' + encodeURIComponent(g.id);
  // Group picture (stored on our server, same origin) or a coloured letter avatar; small platform badge on top.
  function letterAvatar(g) {
    let hsh = 0; for (const c of String(g.name)) hsh = (hsh * 31 + c.codePointAt(0)) >>> 0;
    const letter = (Array.from(String(g.name).trim())[0] || '#').toUpperCase();
    return `<span class="avatar-letter" style="background:hsl(${hsh % 360},55%,42%)" aria-hidden="true">${esc(letter)}</span>`;
  }
  function avatarHTML(g, isWa) {
    const pic = typeof g.img === 'string' && /^\/img\/group\/[A-Za-z0-9]+\?v=\d+$/.test(g.img)
      ? `<img class="avatar-img" src="${esc(g.img)}" alt="" width="48" height="48" loading="lazy" decoding="async">` : '';
    return `<div class="card-icon avatar ${isWa ? 'wa' : 'tg'}">${pic || letterAvatar(g)}<span class="avatar-plat">${isWa ? ICON.wa : ICON.tg}</span></div>`;
  }
function cardHTML(g, idx) {
  const isWa = g.plat === 'wa';
  return `<div class="card" style="animation-delay:${(idx % PAGE_SIZE) * 0.04}s">
  <div class="card-top">
    ${avatarHTML(g, isWa)}
    <div class="card-info">
      <a class="card-name" href="${esc(groupPath(g))}" title="${esc(g.name)}">${esc(g.name)}</a>
      <div class="card-meta">
        <span class="badge badge-${isWa ? 'wa' : 'tg'}">${isWa ? 'WhatsApp' : 'Telegram'}</span>
        <span class="badge badge-cat">${esc(g.cat)}</span>
        <span class="badge badge-country">🌍 ${esc(g.country)}</span>
        ${g.cat === ADULT ? '<span class="badge badge-adult" title="Adults only">18+</span>' : ''}
        ${g.sample ? '<span class="badge badge-sample" title="Example listing with a fake invite link">Sample</span>' : ''}
      </div>
    </div>
  </div>
  ${g.desc ? `<div class="card-desc">${esc(g.desc)}</div>` : ''}
  <div class="card-footer">
    <div class="card-members">${g.members ? Number(g.members).toLocaleString('en-US') + ' members' : esc(g.lang)}</div>
    <div class="card-actions">
      <button type="button" class="btn-report" data-action="report" data-id="${esc(g.id)}" data-name="${esc(g.name)}" title="Report" aria-label="Report ${esc(g.name)}">⚑</button>
      <a class="btn-join ${isWa ? 'wa' : 'tg'}" href="${esc(groupPath(g))}" aria-label="Join ${esc(g.name)}">Join →</a>
    </div>
  </div>
</div>`;
}

  return { PAGE_SIZE, ADULT, ICON, esc, slugify, groupPath, letterAvatar, avatarHTML, cardHTML };
});
