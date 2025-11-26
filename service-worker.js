// 🔇 PASSIVER SERVICE WORKER - tut NICHTS außer existieren
// Version: 20251126-1245
// Kein Caching, kein Selbst-Löschen, keine Reloads!

const SW_VERSION = '20251126-1245';

self.addEventListener('install', function(event) {
    console.log('✅ Service Worker installiert (passiv)', SW_VERSION);
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    console.log('✅ Service Worker aktiviert (passiv)', SW_VERSION);
    // NUR alte Caches löschen, NICHT die Seite neu laden!
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    console.log('🗑️ Alter Cache gelöscht:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// Alle Requests direkt durchlassen - KEIN Caching!
self.addEventListener('fetch', function(event) {
    // Nichts tun - Request geht direkt zum Server
    return;
});
