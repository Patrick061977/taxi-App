// 🆕 v6.62.402: Minimaler Service Worker für PWA-Installierbarkeit (buchen.html)
// Zweck: Browser ("Zum Startbildschirm hinzufügen") verlangt einen aktiven SW
// mit fetch-Handler. Wir cachen nichts aktiv — Network-only, kein Offline-Modus.
const SW_VERSION = 'buchen-v6.62.402';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Pass-through: Anfragen direkt ans Netz, kein Cache.
    event.respondWith(fetch(event.request).catch(() => {
        return new Response('', { status: 504, statusText: 'Offline' });
    }));
});
