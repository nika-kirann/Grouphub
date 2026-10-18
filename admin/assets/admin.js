(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let CSRF = '', META = null, tab = 'pending', groups = [];

  // Build DOM with textContent only, so user-submitted data can never become HTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v == null || v === false) return; if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); });
    kids.flat().forEach((k) => { if (k != null && k !== false) el.append(k instanceof Node ? k : String(k)); });
    return el;
  }
  async function api(url, opts) {
    opts = opts || {};
    const res = await fetch(url, Object.assign({}, opts, { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF } }));
    if (res.status === 401) { location.replace('/admin'); throw new Error('Session expired'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Request failed');
    return body;
  }
  let tt; function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 2600); }

  async function loadStats() {
    const s = await api('/api/admin/stats');
    const cards = [['Pending review', s.pending, s.pending ? 'hl' : ''], ['Approved', s.approved], ['Featured', s.featured], ['Reported groups', s.reported, s.reported ? 'alert' : ''], ['Open reports', s.openReports, s.openReports ? 'alert' : ''], ['New this week', s.submittedThisWeek]];
    $('stats').replaceChildren(...cards.map(([l, v, c]) => h('div', { class: 'stat ' + (c || '') }, h('b', null, v), h('span', null, l))));
    ['pending', 'approved', 'reported', 'rejected'].forEach((k) => { document.querySelector(`[data-count="${k}"]`).textContent = s[k]; });
  }
  async function loadList() {
    const q = $('q').value.trim();
    const autoOnly = tab === 'approved' && $('autoOnly').checked;
    $('autoFilterWrap').hidden = tab !== 'approved';
    groups = (await api('/api/admin/groups?status=' + tab + (autoOnly ? '&auto=1' : '') + (q ? '&q=' + encodeURIComponent(q) : ''))).groups;
    render();
  }
  async function refresh() { await Promise.all([loadStats(), loadList()]); }

  async function act(id, fn, msg) {
    try { await fn(); toast(msg); await refresh(); } catch (e) { toast('⚠ ' + e.message); }
  }
  const patch = (id, body) => api('/api/admin/groups/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) });

  function row(g) {
    const actions = [];
    const B = (label, cls, fn) => h('button', { class: 'btn sm ' + cls, type: 'button', onclick: fn }, label);
    if (g.status !== 'approved') actions.push(B('✓ Approve', 'ok', () => act(g.id, () => patch(g.id, { status: 'approved' }), 'Approved')));
    if (g.status !== 'rejected') actions.push(B('✕ Reject', 'warn', () => act(g.id, () => patch(g.id, { status: 'rejected' }), 'Rejected')));
    if (g.status === 'approved') actions.push(B(g.featured ? '☆ Unfeature' : '★ Feature', 'gold', () => act(g.id, () => patch(g.id, { featured: !g.featured }), g.featured ? 'Unfeatured' : 'Featured')));
    if (g.status === 'approved' && g.autoApproved) actions.push(B('✓ Mark reviewed', '', () => act(g.id, () => patch(g.id, { autoApproved: false }), 'Marked as reviewed')));
    actions.push(B('✎ Edit', '', () => openEdit(g)));
    if (g.status === 'approved') actions.push(B('🖼 Refresh picture', '', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Fetching…';
      try { const r = await api('/api/admin/groups/' + encodeURIComponent(g.id) + '/refresh-image', { method: 'POST' }); toast(r.ok ? 'Picture updated' : 'No picture: ' + (r.imageError || r.imageStatus)); await loadList(); }
      catch (ex) { toast('⚠ ' + ex.message); btn.disabled = false; btn.textContent = '🖼 Refresh picture'; }
    }));
    if (g.reportCount) actions.push(B('Clear reports', '', () => act(g.id, () => api('/api/admin/groups/' + encodeURIComponent(g.id) + '/clear-reports', { method: 'POST' }), 'Reports cleared')));
    actions.push(B('🗑 Delete', 'warn', () => { if (confirm('Permanently delete "' + g.name + '"?')) act(g.id, () => api('/api/admin/groups/' + encodeURIComponent(g.id), { method: 'DELETE' }), 'Deleted'); }));
    const el = h('article', { class: 'row' + (g.featured ? ' featured' : ''), 'data-id': g.id },
      h('div', { class: 'row-main' },
        g.img ? h('img', { class: 'thumb', src: g.img, alt: '', width: 56, height: 56, loading: 'lazy' })
          : h('span', { class: 'thumb letter', 'aria-hidden': 'true' }, (Array.from(String(g.name).trim())[0] || '#').toUpperCase()),
        h('div', null,
        h('h3', null, g.name, g.featured ? h('span', { class: 'pill feat' }, '★ Featured') : null,
          g.autoApproved && g.status === 'approved' ? h('span', { class: 'pill auto', title: 'Went live via auto-approve; not reviewed by a moderator yet' }, '⚡ Auto') : null,
          g.holdReason && g.status === 'pending' ? h('span', { class: 'pill held', title: g.holdReason }, '⏸ Held: ' + g.holdReason) : null, g.sample ? h('span', { class: 'pill' }, 'Sample') : null),
        h('div', { class: 'meta' },
          h('span', { class: 'pill ' + g.plat }, g.plat === 'wa' ? 'WhatsApp' : 'Telegram'),
          h('span', { class: 'pill st-' + g.status }, g.status),
          g.cat === 'Adult' ? h('span', { class: 'pill adult' }, '🔞 Adult 18+') : h('span', { class: 'pill' }, g.cat), h('span', { class: 'pill' }, g.country), h('span', { class: 'pill' }, g.lang),
          g.members ? h('span', { class: 'pill' }, g.members.toLocaleString() + ' members') : null,
          g.reportCount ? h('span', { class: 'pill rep' }, '⚑ ' + g.reportCount + ' report' + (g.reportCount > 1 ? 's' : '')) : null,
          h('span', { class: 'pill' }, 'Added ' + new Date(g.createdAt).toLocaleString())),
        g.desc ? h('p', { class: 'desc' }, g.desc) : h('p', { class: 'desc muted' }, '(no description)'),
        h('a', { class: 'link', href: g.link, target: '_blank', rel: 'noopener noreferrer nofollow' }, g.link),
        g.status === 'approved' && !g.img && g.imageStatus ? h('p', { class: 'muted small' }, '🖼 No picture (' + g.imageStatus + '): ' + (g.imageError || '') + (g.imageCheckedAt ? ' · checked ' + new Date(g.imageCheckedAt).toLocaleString() : '')) : null,
        g.status === 'approved' && !g.img && !g.imageStatus && !g.sample ? h('p', { class: 'muted small' }, '🖼 Picture not fetched yet') : null)),
      h('div', { class: 'actions' }, actions));
    if (g.reportCount) {
      const box = h('div', { class: 'reports' }, h('span', { class: 'muted' }, 'Loading reports…'));
      el.append(box);
      api('/api/admin/groups/' + encodeURIComponent(g.id) + '/reports').then((r) => {
        box.replaceChildren(...r.reports.map((x) => h('div', null, h('b', null, x.reason), x.details ? ' · ' + x.details : '', h('span', { class: 'muted small' }, ' · ' + new Date(x.createdAt).toLocaleString()))));
      }).catch(() => {});
    }
    return el;
  }
  function render() {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    $('list').replaceChildren(...(groups.length ? groups.map(row) : [h('div', { class: 'empty' }, 'Nothing in “' + tab + '” right now.')]));
  }

  // ----- edit dialog -----
  let editing = null;
  function fillSelect(sel, items) { sel.replaceChildren(...items.map((v) => h('option', { value: v }, v))); }
  function openEdit(g) {
    editing = g; const f = $('editForm');
    ['plat', 'link', 'name', 'cat', 'country', 'lang', 'desc'].forEach((k) => { f.elements[k].value = g[k] || ''; });
    f.elements.members.value = g.members == null ? '' : g.members;
    $('editError').hidden = true; $('editDialog').showModal();
  }
  $('editCancel').addEventListener('click', () => $('editDialog').close());
  $('editForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const body = {}; ['plat', 'link', 'name', 'cat', 'country', 'lang', 'desc'].forEach((k) => { body[k] = f.elements[k].value; });
    body.members = f.elements.members.value === '' ? null : f.elements.members.value;
    try { await patch(editing.id, body); $('editDialog').close(); toast('Saved'); refresh(); }
    catch (ex) { $('editError').textContent = ex.message; $('editError').hidden = false; }
  });

  // ----- init -----
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { tab = t.dataset.tab; loadList(); }));
  let qt; $('q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(loadList, 200); });
  // ----- auto-approve toggle -----
  function showAuto(on) {
    const t = $('autoToggle'); t.setAttribute('aria-checked', String(on)); t.classList.toggle('on', on);
    $('autoLabel').textContent = 'Auto-approve: ' + (on ? 'ON' : 'OFF'); $('autoBanner').hidden = !on;
  }
  async function setAuto(on) {
    if (on && !confirm('Turn ON auto-approve?\n\nNew submissions will go live immediately without review. Adult groups and spam-flagged submissions will still wait in Pending.')) return;
    $('autoToggle').disabled = true;
    try { showAuto((await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ autoApprove: on }) })).autoApprove); toast('Auto-approve ' + (on ? 'ON' : 'OFF')); }
    catch (e) { toast('⚠ ' + e.message); } finally { $('autoToggle').disabled = false; }
  }
  $('autoToggle').addEventListener('click', () => setAuto($('autoToggle').getAttribute('aria-checked') !== 'true'));
  $('autoBannerOff').addEventListener('click', () => setAuto(false));
  $('autoOnly').addEventListener('change', loadList);
  $('backfillBtn').addEventListener('click', async () => {
    if (!confirm('Fetch pictures for all approved groups that don\'t have one yet? This runs in the background.')) return;
    try { const r = await api('/api/admin/images/backfill', { method: 'POST', body: JSON.stringify({ retry: true }) }); toast(r.queued ? 'Fetching ' + r.queued + ' picture(s) in the background… refresh in a minute' : 'Every approved group already has a picture (or none is available)'); }
    catch (e) { toast('⚠ ' + e.message); }
  });
  $('logoutBtn').addEventListener('click', async () => { await api('/admin/logout', { method: 'POST' }).catch(() => {}); location.replace('/admin'); });
  (async function init() {
    try {
      CSRF = (await api('/api/admin/me')).csrf;
      META = await fetch('/api/meta').then((r) => r.json());
      const f = $('editForm'); fillSelect(f.elements.cat, META.categories); fillSelect(f.elements.country, META.countries); fillSelect(f.elements.lang, META.languages);
      showAuto((await api('/api/admin/settings')).autoApprove);
      await refresh();
    } catch (e) { toast('⚠ ' + e.message); }
  })();
})();
