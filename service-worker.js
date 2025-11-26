// 🗑️ AGGRESSIVER SELBST-LÖSCHENDER SERVICE WORKER v2
// Version: 20251126-1235
// Diese Datei löscht ALLES und deregistriert sich selbst!

const SW_VERSION = '20251126-1235';
console.log('🗑️ Service Worker Version:', SW_VERSION);

self.addEventListener('install', function(event) {
    console.log('🗑️ Service Worker INSTALL: Lösche mich selbst...');
    // Sofort aktivieren, nicht warten!
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    console.log('🗑️ Service Worker ACTIVATE: Lösche ALLE Caches...');
    
    event.waitUntil(
        // 1. Alle Caches löschen
        caches.keys().then(function(cacheNames) {
            console.log('🗑️ Gefundene Caches:', cacheNames);
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    console.log('🗑️ Lösche Cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(function() {
            console.log('✅ Alle Caches gelöscht!');
            // 2. Alle Clients übernehmen
            return self.clients.claim();
        }).then(function() {
            console.log('✅ Clients übernommen!');
            // 3. Deregistriere mich selbst
            return self.registration.unregister();
        }).then(function(success) {
            console.log('✅ Service Worker deregistriert:', success);
            // 4. Alle Clients neu laden
            return self.clients.matchAll({ type: 'window' });
        }).then(function(clients) {
            console.log('🔄 Lade', clients.length, 'Clients neu...');
            clients.forEach(function(client) {
                if (client.url && 'navigate' in client) {
                    client.navigate(client.url);
                }
            });
        }).catch(function(error) {
            console.error('❌ Service Worker Fehler:', error);
        })
    );
});

// KEINE Fetch-Events abfangen - alles direkt zum Server!
self.addEventListener('fetch', function(event) {
    // Nichts tun - kein Caching!
    return;
});

// Message Handler für manuelles Löschen
self.addEventListener('message', function(event) {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
