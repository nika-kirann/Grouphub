// Retired service worker. GroupHub no longer uses Monetag Push Notifications (zone 12076149).
// Browsers that registered the old worker fetch this file on their next visit; it stops push for them and removes itself.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try { var sub = await self.registration.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* no push subscription */ }
    try { await self.clients.claim(); } catch (e) { /* ignore */ }
    await self.registration.unregister();
  })());
});
