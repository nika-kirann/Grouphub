(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGE_SIZE = 9;
  const ICON = {
    wa: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#25d366" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.07L2 22l5.13-1.35A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Z"/></svg>',
    tg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#2aabee" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm4.64 6.8-1.69 8.02c-.12.57-.46.71-.93.44l-2.56-1.89-1.23 1.19c-.14.13-.25.25-.51.25l.18-2.6 4.69-4.24c.2-.18-.04-.28-.32-.1L7.46 14.6l-2.52-.79c-.55-.17-.56-.55.12-.81l9.85-3.8c.46-.16.86.11.73.6Z"/></svg>'
  };
  const ADULT = 'Adult', AGE_KEY = 'grouphub.ageConfirmed18';
  const isAdultOk = () => { if (ageSessionOk) return true; try { return localStorage.getItem(AGE_KEY) === '1'; } catch (e) { return false; } };
  let pendingAdultSource = null, ageSessionOk = false; // 'chip' | 'select' while the age gate is open
  let GROUPS = [], currentPlatform = 'wa', currentPage = 1, activeCat = '', selectedPlat = 'wa', reportId = null, lastFocus = null;

  // ---------- sakura (skipped when the user prefers reduced motion) ----------
  (function () {
    const canvas = $('sakura-canvas');
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d'); let W, H; const petals = [];
    const COLORS = ['#ff9de2', '#ffb3c6', '#d4a8ff', '#c084fc', '#f9a8d4', '#e879f9'];
    function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
    addEventListener('resize', resize); resize();
    function Petal() { this.x = Math.random() * W; this.y = Math.random() * H - H; this.r = 4 + Math.random() * 6; this.color = COLORS[Math.floor(Math.random() * COLORS.length)]; this.speed = 0.6 + Math.random() * 1.2; this.wind = (Math.random() - 0.5) * 0.8; this.rot = Math.random() * Math.PI * 2; this.rotSpeed = (Math.random() - 0.5) * 0.04; this.opacity = 0.35 + Math.random() * 0.5; }
    const count = innerWidth < 600 ? 25 : 55;
    for (let i = 0; i < count; i++) { const p = new Petal(); p.y = Math.random() * H; petals.push(p); }
    function draw(p) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = p.opacity; ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    function animate() { if (!document.hidden) { ctx.clearRect(0, 0, W, H); petals.forEach((p) => { p.y += p.speed; p.x += p.wind + Math.sin(p.y * 0.02) * 0.5; p.rot += p.rotSpeed; if (p.y > H + 20) { Object.assign(p, new Petal()); p.y = -10; } draw(p); }); } requestAnimationFrame(animate); }
    animate();
  })();

  // ---------- mascot ----------
  const MSGS = [['Konnichiwa! 👋', 'Find your group~'], ['🌸 New groups', 'added daily!'], ['💜 Join a group,', 'make friends~'], ['✨ Try the', 'Anime category!'], ['🎮 Gamers?', 'We got you~'], ['Add your group', 'for free! 🚀']];
  let msgIdx = 0;
  function mascotClick() {
    msgIdx = (msgIdx + 1) % MSGS.length;
    const b = $('mascotBubble'); b.textContent = '';
    b.append(MSGS[msgIdx][0], document.createElement('br'), MSGS[msgIdx][1]);
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = 'bubblePop 0.4s cubic-bezier(0.34,1.56,0.64,1)';
  }

  // ---------- data ----------
  async function api(url, opts) {
    const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    let body = {}; try { body = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error(body.error || 'Request failed (' + res.status + ')');
    return body;
  }
  async function load() {
    try {
      // Adult groups are only fetched once the visitor has passed the 18+ gate.
      GROUPS = (await api('/api/groups' + (isAdultOk() ? '?includeAdult=1' : ''))).groups;
      const general = GROUPS.filter((g) => g.cat !== ADULT);
      const uniq = (k) => new Set(general.map((g) => g[k])).size;
      $('statGroups').textContent = general.length; $('statCountries').textContent = uniq('country'); $('statCats').textContent = uniq('cat');
      renderGrid(true);
    } catch (e) {
      $('groupGrid').innerHTML = '<div class="empty"><p>Couldn\'t load groups. Please refresh.</p></div>';
    }
  }

  function getFiltered() {
    const q = $('searchInput').value.trim().toLowerCase();
    const cat = activeCat || $('catFilter').value, country = $('countryFilter').value, lang = $('langFilter').value;
    const showAdult = cat === ADULT && isAdultOk();
    return GROUPS.filter((g) => g.plat === currentPlatform &&
      (g.cat === ADULT ? showAdult : true) &&
      (!q || g.name.toLowerCase().includes(q) || (g.desc || '').toLowerCase().includes(q)) &&
      (!cat || g.cat === cat) && (!country || g.country === country) && (!lang || g.lang === lang));
  }

  function cardHTML(g, idx) {
    const isWa = g.plat === 'wa';
    // g.link was validated server-side to be https://chat.whatsapp.com/... or https://t.me/...; check again before rendering.
    const safeLink = /^https:\/\/(chat\.whatsapp\.com|t\.me)\//.test(g.link) ? g.link : '#';
    return `<div class="card${g.featured ? ' featured' : ''}" style="animation-delay:${(idx % PAGE_SIZE) * 0.04}s">
    <div class="card-top">
      <div class="card-icon ${isWa ? 'wa' : 'tg'}">${isWa ? ICON.wa : ICON.tg}</div>
      <div class="card-info">
        <div class="card-name" title="${esc(g.name)}">${esc(g.name)}</div>
        <div class="card-meta">
          ${g.featured ? '<span class="badge badge-featured">★ Featured</span>' : ''}
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
      <div class="card-members">${g.members ? Number(g.members).toLocaleString() + ' members' : esc(g.lang)}</div>
      <div class="card-actions">
        <button type="button" class="btn-report" data-action="report" data-id="${esc(g.id)}" data-name="${esc(g.name)}" title="Report" aria-label="Report ${esc(g.name)}">⚑</button>
        <a class="btn-join ${isWa ? 'wa' : 'tg'}" href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer nofollow">Join ↗</a>
      </div>
    </div>
  </div>`;
  }

  function renderGrid(reset) {
    if (reset) currentPage = 1;
    const filtered = getFiltered(), grid = $('groupGrid'), lw = $('loadMoreWrap');
    $('gridLabel').textContent = (currentPlatform === 'wa' ? 'WhatsApp' : 'Telegram') + ' Groups · ' + filtered.length;
    const slice = filtered.slice(0, currentPage * PAGE_SIZE);
    if (!slice.length) { grid.innerHTML = '<div class="empty"><p>No groups found.<br>Try a different filter~</p></div>'; lw.style.display = 'none'; return; }
    grid.innerHTML = slice.map(cardHTML).join('');
    lw.style.display = filtered.length > slice.length ? 'block' : 'none';
  }

  // ---------- modals ----------
  function openOverlay(id, focusEl) { lastFocus = document.activeElement; $(id).classList.add('open'); document.body.style.overflow = 'hidden'; setTimeout(() => (focusEl || $(id).querySelector('input,select,textarea,button')).focus(), 30); }
  function closeOverlays() {
    if ($('ageOverlay').classList.contains('open') && !isAdultOk() && !ageSessionOk) { $('ageOverlay').classList.remove('open'); pendingAdultSource = null; setCategory('', true); } document.querySelectorAll('.overlay.open').forEach((o) => o.classList.remove('open')); document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  let toastTimer;
  function toast(msg, isError) { const t = $('toast'); t.textContent = msg; t.classList.toggle('error', !!isError); t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500); }

  // Client-side pre-check (the server re-validates everything).
  function checkLink(plat, raw) {
    let s = String(raw || '').trim(); if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (plat === 'wa') return /^https?:\/\/chat\.whatsapp\.com\/(invite\/)?[A-Za-z0-9]{20,24}$/i.test(s);
    return /^https?:\/\/(www\.)?(t|telegram)\.me\/((\+|joinchat\/)[A-Za-z0-9_-]{10,64}|[A-Za-z][A-Za-z0-9_]{4,31})$/i.test(s);
  }
  function updateLinkHint() {
    const v = checkLink(selectedPlat, $('groupLink').value), h = $('linkHint');
    if (v === null) { h.className = 'form-hint'; h.textContent = selectedPlat === 'wa' ? 'Format: https://chat.whatsapp.com/<code>' : 'Format: https://t.me/<name> or https://t.me/+<code>'; }
    else { h.className = 'form-hint ' + (v ? 'ok' : 'bad'); h.textContent = v ? '✓ Looks valid' : 'This doesn\'t look like a valid ' + (selectedPlat === 'wa' ? 'WhatsApp' : 'Telegram') + ' invite link.'; }
  }
  function selectPlat(p) {
    selectedPlat = p;
    $('plat-wa').className = 'plat-btn' + (p === 'wa' ? ' sel-wa' : ''); $('plat-wa').setAttribute('aria-pressed', p === 'wa');
    $('plat-tg').className = 'plat-btn' + (p === 'tg' ? ' sel-tg' : ''); $('plat-tg').setAttribute('aria-pressed', p === 'tg');
    $('linkLabel').textContent = p === 'wa' ? 'WhatsApp Invite Link *' : 'Telegram Group/Channel Link *';
    $('groupLink').placeholder = p === 'wa' ? 'https://chat.whatsapp.com/…' : 'https://t.me/…';
    updateLinkHint();
  }

  async function submitGroup(e) {
    e.preventDefault();
    const f = e.target, err = $('formError'), fd = new FormData(f);
    const data = { plat: selectedPlat, link: fd.get('link'), name: fd.get('name'), cat: fd.get('cat'), country: fd.get('country'), lang: fd.get('lang'), desc: fd.get('desc'), website: fd.get('website') };
    let problem = '';
    if (!checkLink(data.plat, data.link)) problem = 'Please enter a valid ' + (data.plat === 'wa' ? 'WhatsApp' : 'Telegram') + ' invite link.';
    else if (String(data.name).trim().length < 3) problem = 'Group name must be at least 3 characters.';
    else if (!data.cat || !data.country || !data.lang) problem = 'Please choose a category, country and language.';
    else if (!fd.get('agree')) problem = 'Please confirm your group follows the rules.';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true; $('submitBtn').disabled = true;
    try {
      await api('/api/groups', { method: 'POST', body: JSON.stringify(data) });
      f.reset(); $('descCount').textContent = '0/300'; $('adultNote').hidden = true; selectPlat('wa'); closeOverlays();
      toast('✓ Submitted! A moderator will review your group before it appears.');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { $('submitBtn').disabled = false; }
  }

  async function submitReport(e) {
    e.preventDefault();
    const fd = new FormData(e.target), err = $('reportError');
    if (!fd.get('reason')) { err.textContent = 'Please choose a reason.'; err.hidden = false; return; }
    try { await api('/api/groups/' + encodeURIComponent(reportId) + '/report', { method: 'POST', body: JSON.stringify({ reason: fd.get('reason'), details: fd.get('details') }) }); e.target.reset(); closeOverlays(); toast('Thanks. Our moderators will take a look.'); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
  }

  // fromChip: chip selections set activeCat; dropdown selections clear it.
  function setCategory(cat, fromChip) {
    activeCat = fromChip ? cat : '';
    $('catFilter').value = cat;
    document.querySelectorAll('.cat-chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === cat));
    renderGrid(true);
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) { if (e.target.matches('[data-overlay]')) closeOverlays(); return; }
    const a = el.dataset.action;
    if (a === 'open-add') { e.preventDefault(); updateLinkHint(); openOverlay('overlay', $('groupLink')); }
    else if (a === 'close-modal') closeOverlays();
    else if (a === 'platform') { currentPlatform = el.dataset.plat; $('tab-wa').className = 'tab' + (currentPlatform === 'wa' ? ' active-wa' : ''); $('tab-tg').className = 'tab' + (currentPlatform === 'tg' ? ' active-tg' : ''); $('tab-wa').setAttribute('aria-pressed', currentPlatform === 'wa'); $('tab-tg').setAttribute('aria-pressed', currentPlatform === 'tg'); renderGrid(true); }
    else if (a === 'chip') { if (el.dataset.cat === ADULT && !isAdultOk()) { pendingAdultSource = 'chip'; openOverlay('ageOverlay'); return; } setCategory(el.dataset.cat, true); }
    else if (a === 'age-yes') { const pendingSrc = pendingAdultSource; ageSessionOk = true; try { localStorage.setItem(AGE_KEY, '1'); } catch (e) { /* storage blocked: allow for this page view only */ } closeOverlays(); pendingAdultSource = null; load().then(() => setCategory(ADULT, pendingSrc !== 'select')); }
    else if (a === 'age-no') { closeOverlays(); pendingAdultSource = null; setCategory('', true); }
    else if (a === 'load-more') { currentPage++; renderGrid(false); }
    else if (a === 'mascot') mascotClick();
    else if (a === 'select-plat') selectPlat(el.dataset.plat);
    else if (a === 'report') { reportId = el.dataset.id; $('reportName').textContent = el.dataset.name; $('reportError').hidden = true; openOverlay('reportOverlay', $('reportReason')); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.overlay.open')) closeOverlays(); });
  let t; $('searchInput').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => renderGrid(true), 120); });
  // Dropdown category replaces any chip selection (fixes chip/dropdown conflict).
  $('catFilter').addEventListener('change', () => {
    const v = $('catFilter').value;
    if (v === ADULT && !isAdultOk()) { pendingAdultSource = 'select'; openOverlay('ageOverlay'); return; }
    setCategory(v, false);
  });
  $('groupCat').addEventListener('change', () => { $('adultNote').hidden = $('groupCat').value !== ADULT; });
  $('countryFilter').addEventListener('change', () => renderGrid(true));
  $('langFilter').addEventListener('change', () => renderGrid(true));
  $('groupLink').addEventListener('input', updateLinkHint);
  $('groupDesc').addEventListener('input', () => { $('descCount').textContent = $('groupDesc').value.length + '/300'; });
  $('addForm').addEventListener('submit', submitGroup);
  $('reportForm').addEventListener('submit', submitReport);
  api('/api/meta').then((m) => { $('reportReason').insertAdjacentHTML('beforeend', m.reasons.map((r) => `<option>${esc(r)}</option>`).join('')); }).catch(() => {});
  load();
})();
