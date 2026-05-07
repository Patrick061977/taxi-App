// 🆕 v6.62.404: Minimaler Service Worker für PWA-Installierbarkeit (hotel.html)
// Network-only, kein Offline-Cache. fetch-Handler ist Pflicht für Chrome-Installierbarkeit.
const SW_VERSION = 'hotel-v6.62.404';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request).catch(() => {
        return new Response('', { status: 504, statusText: 'Offline' });
    }));
});
