// Selbst-abmeldender Service Worker.
// Ersetzt den früheren PWA-SW: löscht alle Caches, meldet sich ab und lädt
// kontrollierte Seiten neu — danach gibt es keinen SW mehr (kein Stale-Cache).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try { await self.registration.unregister(); } catch {}
    try {
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.navigate(c.url));
    } catch {}
  })());
});
