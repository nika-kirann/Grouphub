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
    const sort = $('sort').value;
    groups = (await api('/api/admin/groups?status=' + tab + (autoOnly ? '&auto=1' : '') + (sort ? '&sort=' + sort : '') + (q ? '&q=' + encodeURIComponent(q) : ''))).groups;
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
    if (g.status === 'approved' && g.featuredNow) {
      actions.push(B('☆ Unfeature', 'gold', () => act(g.id, () => patch(g.id, { featured: false }), 'Unfeatured')));
      actions.push(B('⏱ Change end date', '', () => openFeature(g)));
    } else if (g.status === 'approved' && g.cat !== 'Adult') actions.push(B('★ Feature', 'gold', () => openFeature(g)));
    if (g.status === 'approved' && g.autoApproved) actions.push(B('✓ Mark reviewed', '', () => act(g.id, () => patch(g.id, { autoApproved: false }), 'Marked as reviewed')));
    actions.push(B('✎ Edit', '', () => openEdit(g)));
    if (g.status === 'approved' && typeof g.page === 'string' && g.page.startsWith('/group/')) actions.push(h('a', { class: 'btn sm', href: g.page, target: '_blank', rel: 'noopener' }, '↗ View page'));
    if (g.status === 'approved') actions.push(B('🖼 Refresh picture', '', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Fetching…';
      try { const r = await api('/api/admin/groups/' + encodeURIComponent(g.id) + '/refresh-image', { method: 'POST' }); toast(r.ok ? 'Picture updated' : 'No picture: ' + (r.imageError || r.imageStatus)); await loadList(); }
      catch (ex) { toast('⚠ ' + ex.message); btn.disabled = false; btn.textContent = '🖼 Refresh picture'; }
    }));
    if (g.reportCount) actions.push(B('Clear reports', '', () => act(g.id, () => api('/api/admin/groups/' + encodeURIComponent(g.id) + '/clear-reports', { method: 'POST' }), 'Reports cleared')));
    actions.push(B('🗑 Delete', 'warn', () => { if (confirm('Permanently delete "' + g.name + '"?')) act(g.id, () => api('/api/admin/groups/' + encodeURIComponent(g.id), { method: 'DELETE' }), 'Deleted'); }));
    const until = g.featuredUntil ? new Date(g.featuredUntil) : null;
    const featPill = g.featuredNow ? h('span', { class: 'pill feat', title: g.featuredShown ? 'Pinned at the top of the site' : 'More than 6 groups are featured; only the 6 most recently featured are shown' },
      '★ Featured' + (until ? ' until ' + until.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ' (no end date)') + (g.featuredShown ? '' : ' · not shown (over 6)')) : null;
    const el = h('article', { class: 'row' + (g.featuredNow ? ' featured' : ''), 'data-id': g.id },
      h('div', { class: 'row-main' },
        g.img ? h('img', { class: 'thumb', src: g.img, alt: '', width: 56, height: 56, loading: 'lazy' })
          : h('span', { class: 'thumb letter', 'aria-hidden': 'true' }, (Array.from(String(g.name).trim())[0] || '#').toUpperCase()),
        h('div', null,
        h('h3', null, g.name, featPill,
          g.autoApproved && g.status === 'approved' ? h('span', { class: 'pill auto', title: 'Went live via auto-approve; not reviewed by a moderator yet' }, '⚡ Auto') : null,
          g.holdReason && g.status === 'pending' ? h('span', { class: 'pill held', title: g.holdReason }, '⏸ Held: ' + g.holdReason) : null, g.sample ? h('span', { class: 'pill' }, 'Sample') : null),
        h('div', { class: 'meta' },
          h('span', { class: 'pill ' + g.plat }, g.plat === 'wa' ? 'WhatsApp' : 'Telegram'),
          h('span', { class: 'pill st-' + g.status }, g.status),
          g.cat === 'Adult' ? h('span', { class: 'pill adult' }, '🔞 Adult 18+') : h('span', { class: 'pill' }, g.cat), h('span', { class: 'pill' }, g.country), h('span', { class: 'pill' }, g.lang),
          g.members ? h('span', { class: 'pill' }, g.members.toLocaleString() + ' members') : null,
          g.status === 'approved' ? h('span', { class: 'pill count', title: 'All-time group page views (each visitor once per day)' }, '👁 ' + (g.views || 0).toLocaleString() + (g.views === 1 ? ' view' : ' views')) : null,
          g.status === 'approved' ? h('span', { class: 'pill count', title: 'All-time Join button clicks (each visitor once per day)' }, '👥 ' + (g.joins || 0).toLocaleString() + ' joins') : null,
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


  // ----- feature dialog -----
  let featuring = null;
  function openFeature(g) {
    featuring = g; const f = $('featForm');
    $('featName').textContent = g.name; $('featError').hidden = true;
    const d = new Date(Date.now() + 7 * 864e5); f.elements.until.value = d.toISOString().slice(0, 10);
    f.elements.until.min = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    $('featDialog').showModal();
  }
  $('featCancel').addEventListener('click', () => $('featDialog').close());
  $('featForm').elements.until.addEventListener('focus', () => { $('featForm').querySelector('input[value="date"]').checked = true; });
  $('featForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, len = f.elements.len.value, body = { featured: true };
    if (len === '7' || len === '30') body.featuredDays = Number(len);
    else if (len === 'date') {
      if (!f.elements.until.value) { $('featError').textContent = 'Pick an end date.'; $('featError').hidden = false; return; }
      body.featuredUntil = new Date(f.elements.until.value + 'T23:59:59').toISOString(); // end of that day, your time
    }
    try { await patch(featuring.id, body); $('featDialog').close(); toast('Featured'); refresh(); }
    catch (ex) { $('featError').textContent = ex.message; $('featError').hidden = false; }
  });

  // ----- featured contact setting -----
  function showContact(s) {
    const f = $('contactForm'); f.elements.featureContactText.value = s.featureContactText || ''; f.elements.featureContactLink.value = s.featureContactLink || '';
    $('contactState').textContent = s.featureContactText || s.featureContactLink ? '· set' : '· not set yet';
  }
  $('contactForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      showContact(await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ featureContactText: f.elements.featureContactText.value, featureContactLink: f.elements.featureContactLink.value }) }));
      $('contactError').hidden = true; toast('Contact saved');
    } catch (ex) { $('contactError').textContent = ex.message; $('contactError').hidden = false; }
  });

  // ----- traffic -----
  const fmt = (n) => Number(n || 0).toLocaleString();
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) { const el = document.createElementNS(SVGNS, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); if (text != null) el.textContent = text; return el; }
  function chart(days) {
    const W = Math.max(300, Math.round($('chart').clientWidth || 600)), H = 180, P = { l: 30, r: 6, t: 8, b: 20 }, n = days.length;
    const max = Math.max(1, ...days.map((d) => d.pageviews), ...days.map((d) => d.visitors));
    const step = (W - P.l - P.r) / n, bw = Math.max(2, step * 0.7), y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Daily visitors and page views, last 30 days' });
    [0, 0.5, 1].forEach((f) => { const v = Math.round(max * f); s.append(svg('line', { class: 'grid', x1: P.l, x2: W - P.r, y1: y(v), y2: y(v) }), svg('text', { class: 'axis', x: P.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, fmt(v))); });
    days.forEach((d, i) => {
      const x = P.l + i * step + (step - bw) / 2;
      const g = svg('g', {});
      g.append(svg('title', {}, `${d.day}: ${fmt(d.visitors)} visitors, ${fmt(d.pageviews)} page views`));
      g.append(svg('rect', { class: 'bar-p', x, width: bw, y: y(d.pageviews), height: Math.max(0, H - P.b - y(d.pageviews)), rx: 1.5 }));
      g.append(svg('rect', { class: 'bar-v', x: x + bw * 0.2, width: bw * 0.6, y: y(d.visitors), height: Math.max(0, H - P.b - y(d.visitors)), rx: 1.5 }));
      s.append(g);
      if (i % 5 === 0 || i === n - 1) s.append(svg('text', { class: 'axis', x: i === n - 1 ? W - P.r : x + bw / 2, y: H - 6, 'text-anchor': i === n - 1 ? 'end' : 'middle' }, d.day.slice(5)));
    });
    $('chart').replaceChildren(s);
  }
  function tops(id, list) {
    $(id).replaceChildren(...(list.length ? list.map((r) => h('li', null, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.name) : r.name, h('span', null, fmt(r.views)))) : [h('li', { class: 'muted' }, 'No views yet')]));
  }
  async function loadTraffic() {
    const t = await api('/api/admin/traffic');
    $('onlineNow').textContent = fmt(t.onlineNow);
    const card = (title, big, bigLabel, sub) => h('div', { class: 'tcard' }, h('h4', null, title), h('div', { class: 'big' }, fmt(big), h('span', { class: 'sub' }, ' ' + bigLabel)), h('div', { class: 'sub' }, sub));
    $('tcards').replaceChildren(
      card('Today', t.todayStats.visitors, 'visitors', fmt(t.todayStats.pageviews) + ' page views'),
      card('Last 7 days', t.last7.visitors, 'visits', fmt(t.last7.pageviews) + ' page views · ' + fmt(t.last7.newVisitors) + ' new visitors'),
      card('Last 30 days', t.last30.visitors, 'visits', fmt(t.last30.pageviews) + ' page views · ' + fmt(t.last30.newVisitors) + ' new visitors'),
      card('All time', t.allTime.visitors, 'visitors', fmt(t.allTime.pageviews) + ' page views'));
    lastDays = t.days; chart(t.days); tops('topToday', t.topToday); tops('top7', t.top7);
    $('trafficNote').textContent = `Counting started on ${t.startedDay} (when traffic stats were added), so earlier visits aren't included. ` +
      `Days run midnight to midnight ${t.tz} time. A visitor is counted once per day; 7/30-day "visits" add up the daily visitors, so someone who comes on 3 days counts 3 times. ` +
      `All-time visitors = distinct browsers seen since counting started. Bots, the admin panel and UptimeRobot pings are not counted. Online now = visitors active in the last ${t.onlineWindowMin} minutes (resets if the server restarts).`;
  }
  let lastDays = null, rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (lastDays) chart(lastDays); }, 150); });
  async function loadOnline() { $('onlineNow').textContent = fmt((await api('/api/admin/traffic/online')).onlineNow); }
  setInterval(() => { if (document.visibilityState === 'visible') loadOnline().catch(() => {}); }, 15000);
  setInterval(() => { if (document.visibilityState === 'visible') loadTraffic().catch(() => {}); }, 120000);
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
  $('sort').addEventListener('change', loadList);
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
      const st = await api('/api/admin/settings'); showAuto(st.autoApprove); showContact(st);
      loadTraffic().catch((e) => toast('⚠ Traffic: ' + e.message));
      await refresh();
    } catch (e) { toast('⚠ ' + e.message); }
  })();
})();
