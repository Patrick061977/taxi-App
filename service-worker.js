// 🗑️ SELBST-LÖSCHENDER SERVICE WORKER
// Diese Datei deregistriert den alten Service Worker automatisch!

self.addEventListener('install', function(event) {
    console.log('🗑️ Service Worker: Lösche mich selbst...');
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    console.log('🗑️ Service Worker: Lösche alle Caches...');
    
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    console.log('🗑️ Cache gelöscht:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(function() {
            console.log('✅ Alle Caches gelöscht!');
            // Deregistriere mich selbst
            return self.registration.unregister();
        }).then(function() {
            console.log('✅ Service Worker deregistriert!');
            // Lade Seite neu für alle Clients
            return self.clients.matchAll();
        }).then(function(clients) {
            clients.forEach(function(client) {
                client.navigate(client.url);
            });
        })
    );
});

// Keine Fetch-Events abfangen - alles direkt durchlassen
self.addEventListener('fetch', function(event) {
    // Nichts tun - Request geht direkt zum Server
    return;
});
