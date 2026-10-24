// Group page: copy invite link, report, 18+ gate for Adult groups, picture fallback.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const main = $('groupMain');
  const AGE_KEY = 'grouphub.ageConfirmed18';
  const ageOpen = () => { const o = $('ageOverlay'); return !!o && o.classList.contains('open'); };
  let toastTimer, lastFocus = null, reportId = null;

  function toast(msg, isError) { const t = $('toast'); t.textContent = msg; t.classList.toggle('error', !!isError); t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500); }
  function openOverlay(id, focusEl) { lastFocus = document.activeElement; $(id).classList.add('open'); document.body.style.overflow = 'hidden'; setTimeout(() => { const f = focusEl || $(id).querySelector('select,textarea,button'); if (f) f.focus(); }, 30); }
  function closeOverlays() { document.querySelectorAll('.overlay.open').forEach((o) => o.classList.remove('open')); document.body.style.overflow = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }

  // ----- 18+ gate (Adult groups only) -----
  const ageOk = () => { try { return localStorage.getItem(AGE_KEY) === '1'; } catch (e) { return false; } };
  if (main && main.dataset.adult === '1') {
    if (ageOk()) document.body.classList.remove('adult-locked');
    else openOverlay('ageOverlay');
  }

  // ----- picture fallback (inline onerror is blocked by our CSP) -----
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('avatar-img')) return;
    const holder = img.closest('.card, .gp-card'), nameEl = holder && holder.querySelector('.card-name, h1');
    const name = (nameEl ? nameEl.textContent : '#').trim();
    const span = document.createElement('span'); span.className = 'avatar-letter'; span.setAttribute('aria-hidden', 'true');
    span.textContent = (Array.from(name)[0] || '#').toUpperCase(); img.replaceWith(span);
  }, true);

  // ----- report reasons -----
  if ($('reportReason')) fetch('/api/meta').then((r) => r.json()).then((m) => {
    const sel = $('reportReason'); if (!sel) return;
    m.reasons.forEach((r) => { const o = document.createElement('option'); o.textContent = r; sel.append(o); });
  }).catch(() => {});

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ } ta.remove(); return ok;
    }
  }

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) { if (e.target.matches('[data-overlay]') && !ageOpen()) closeOverlays(); return; }
    const a = el.dataset.action;
    if (a === 'copy') { const ok = await copy(main.dataset.link); toast(ok ? 'Invite link copied' : 'Copy failed: long-press the Join button instead', !ok); }
    else if (a === 'report') { reportId = el.dataset.id; $('reportName').textContent = el.dataset.name; $('reportError').hidden = true; openOverlay('reportOverlay', $('reportReason')); }
    else if (a === 'open-featured') { e.preventDefault(); openOverlay('featuredOverlay', $('featuredOverlay').querySelector('.modal-close')); }
    else if (a === 'close-modal') closeOverlays();
    else if (a === 'age-yes') { try { localStorage.setItem(AGE_KEY, '1'); } catch (e2) { /* this page view only */ } document.body.classList.remove('adult-locked'); closeOverlays(); }
    else if (a === 'age-no') { location.href = '/'; }
  });
  // ----- Join clicks: counted once per visitor per day (same-origin beacon; the link opens normally) -----
  document.addEventListener('click', (e) => {
    const j = e.target.closest('.gp-join');
    if (!j || !main || main.dataset.link === '#' || navigator.webdriver) return;
    try {
      let vid = null; try { vid = localStorage.getItem('grouphub.vid'); } catch (e2) { /* storage blocked */ }
      const body = JSON.stringify({ id: main.dataset.id, v: /^[a-f0-9]{32}$/.test(vid || '') ? vid : null });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/join', new Blob([body], { type: 'application/json' })))) {
        fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
      }
    } catch (e3) { /* never block the join */ }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.overlay.open') && !ageOpen()) closeOverlays(); });

  if ($('reportForm')) $('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), err = $('reportError');
    if (!fd.get('reason')) { err.textContent = 'Please choose a reason.'; err.hidden = false; return; }
    try {
      const res = await fetch('/api/groups/' + encodeURIComponent(reportId) + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: fd.get('reason'), details: fd.get('details') }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Request failed');
      e.target.reset(); closeOverlays(); toast('Thanks. Our moderators will take a look.');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
})();
