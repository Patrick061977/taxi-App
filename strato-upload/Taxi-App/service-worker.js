// 🗑️ SELBST-LÖSCHENDER SERVICE WORKER
// Version: 20251126-1315
// Dieser Service Worker deregistriert sich selbst!
// Telegram übernimmt jetzt alle Benachrichtigungen.

self.addEventListener('install', function(event) {
    console.log('🗑️ Service Worker wird entfernt...');
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        // Alle Caches löschen
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    return caches.delete(cacheName);
                })
            );
        }).then(function() {
            // Sich selbst deregistrieren
            return self.registration.unregister();
        }).then(function() {
            console.log('✅ Service Worker entfernt! Telegram ist jetzt aktiv.');
        })
    );
});

// Keine Fetch-Events - alles durchlassen
self.addEventListener('fetch', function(event) {
    return;
});
