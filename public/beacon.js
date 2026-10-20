// GroupHub first-party traffic beacon (no cookies, no third parties).
// Sends one page view per page load and a heartbeat every 60s while the tab is visible ("online now").
// The visitor ID is a random value kept in this browser's localStorage; the server only stores a salted, daily-rotating hash of it.
(function () {
  'use strict';
  try {
    if (navigator.webdriver) return; // automated browsers
    var KEY = 'grouphub.vid', vid = null, isNew = false;
    try {
      vid = localStorage.getItem(KEY);
      if (!/^[a-f0-9]{32}$/.test(vid || '')) {
        var a = new Uint8Array(16); crypto.getRandomValues(a);
        vid = Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
        localStorage.setItem(KEY, vid); isNew = true;
      }
    } catch (e) { vid = null; } // storage blocked: the server falls back to a daily hash of IP + browser
    var last = 0;
    function send(t) {
      last = Date.now();
      var body = JSON.stringify({ t: t, p: location.pathname, v: vid, n: t === 'pv' && isNew ? 1 : 0 });
      try { if (navigator.sendBeacon && navigator.sendBeacon('/api/collect', new Blob([body], { type: 'application/json' }))) return; } catch (e) { /* fall through */ }
      if (window.fetch) fetch('/api/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, credentials: 'same-origin' }).catch(function () {});
    }
    send('pv');
    setInterval(function () { if (document.visibilityState === 'visible') send('hb'); }, 60000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - last > 30000) send('hb'); });
  } catch (e) { /* never break the page */ }
})();
