// NEOS Snap — minimaler Service Worker (Installierbarkeit; Netzwerk-Passthrough).
// Bewusst kein Offline-Cache: Belegdaten sollen stets frisch geladen werden.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* passthrough — Browser-Default */ });
