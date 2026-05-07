// 🆕 v6.62.400: Minimaler Service Worker für PWA-Installierbarkeit (kunden.html)
// Zweck: Browser ("Zum Startbildschirm hinzufügen") verlangt einen aktiven SW
// mit fetch-Handler. Wir cachen nichts aktiv — Network-First, kein Offline-Modus.
const SW_VERSION = 'kunden-v6.62.400';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Pass-through: Anfragen direkt ans Netz, kein Cache.
    // Wichtig: fetch-Listener muss existieren, damit Chrome die PWA als installierbar erkennt.
    event.respondWith(fetch(event.request).catch(() => {
        // Bei Netzwerkfehler keine Offline-Antwort — Browser zeigt seinen Standard-Fehler.
        return new Response('', { status: 504, statusText: 'Offline' });
    }));
});
