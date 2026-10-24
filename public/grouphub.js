(function () {
  'use strict';
  // Old deep links (#group/<id>) now live on their own pages; the server 301s /group/<id> to the canonical slug URL.
  { const m = /^#group\/([a-f0-9]{6,32})$/.exec(location.hash); if (m) { location.replace('/group/' + m[1]); return; } }
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGE_SIZE = 9;
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

  // Card markup lives in /card-render.js (shared with the server, which pre-renders the first page for crawlers).
  const { letterAvatar, cardHTML } = window.GHCard;

  // If a picture fails to load, swap in the letter avatar (inline onerror handlers are blocked by our CSP).
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('avatar-img')) return;
    const card = img.closest('.card'), name = card ? card.querySelector('.card-name').textContent : '';
    img.insertAdjacentHTML('afterend', letterAvatar({ name })); img.remove();
  }, true);

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
    updateLinkHint(); scheduleNameLookup(true);
  }

  // Group name auto-fill from the invite page (GET /api/link-preview). Only fills an empty name or one we filled
  // ourselves earlier (autoName); anything the user typed is left alone. Failures are silent: the form still works.
  let autoName = '', autoFor = '', nameSeq = 0, nameTimer = null;
  function setNameHint(text, cls) { const h = $('nameHint'); h.className = 'form-hint' + (cls ? ' ' + cls : ''); h.textContent = text || ''; }
  async function autoFillName() {
    const link = $('groupLink').value.trim(), nameEl = $('groupName');
    if (!checkLink(selectedPlat, link)) return;
    if (nameEl.value.trim() && nameEl.value !== autoName) return; // user's own text wins
    if (autoName && nameEl.value === autoName && autoFor === link) return; // already filled for this link
    const seq = ++nameSeq;
    setNameHint('Fetching name…', 'busy');
    let name = null;
    try { name = (await api('/api/link-preview?url=' + encodeURIComponent(link))).name; } catch (ex) { /* no name: keep manual entry */ }
    if (seq !== nameSeq) return; // a newer link was pasted meanwhile
    if (name && (!nameEl.value.trim() || nameEl.value === autoName)) {
      nameEl.value = autoName = name.slice(0, nameEl.maxLength > 0 ? nameEl.maxLength : 60); autoFor = link;
      setNameHint('✓ Name filled from the invite link. You can edit it.', 'ok');
    } else setNameHint('');
  }
  function scheduleNameLookup(now) { clearTimeout(nameTimer); nameTimer = setTimeout(autoFillName, now ? 0 : 600); }
  function resetAutoName() { autoName = ''; autoFor = ''; nameSeq++; clearTimeout(nameTimer); setNameHint(''); }

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
      const r = await api('/api/groups', { method: 'POST', body: JSON.stringify(data) });
      f.reset(); resetAutoName(); $('descCount').textContent = '0/300'; $('adultNote').hidden = true; selectPlat('wa'); closeOverlays();
      if (r && r.live) { toast('🎉 Your group is live!'); load(); }
      else toast('✓ Submitted for review! A moderator will check your group before it appears.');
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
  $('groupLink').addEventListener('input', () => {
    const other = selectedPlat === 'wa' ? 'tg' : 'wa', v = $('groupLink').value;
    if (!checkLink(selectedPlat, v) && checkLink(other, v)) selectPlat(other); // pasted the other platform's link
    updateLinkHint(); scheduleNameLookup(false);
  });
  $('groupLink').addEventListener('blur', () => scheduleNameLookup(true));
  $('groupName').addEventListener('input', () => { if ($('groupName').value !== autoName) { autoName = ''; nameSeq++; setNameHint(''); } }); // user took over
  $('groupDesc').addEventListener('input', () => { $('descCount').textContent = $('groupDesc').value.length + '/300'; });
  $('addForm').addEventListener('submit', submitGroup);
  $('reportForm').addEventListener('submit', submitReport);
  api('/api/meta').then((m) => { $('reportReason').insertAdjacentHTML('beforeend', m.reasons.map((r) => `<option>${esc(r)}</option>`).join('')); }).catch(() => {});
  // ?q=term (used by the WebSite SearchAction in the page's structured data) pre-fills the search box.
  try { const q0 = new URLSearchParams(location.search).get('q'); if (q0) $('searchInput').value = q0.slice(0, 100); } catch (e) { /* old browser */ }
  load().then(() => { if (location.hash === '#add') { updateLinkHint(); openOverlay('overlay', $('groupLink')); } });
})();
