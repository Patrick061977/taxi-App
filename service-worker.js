// 🚀 TAXI APP SERVICE WORKER
// Version 5.9.0 - Auto-Update System

const CACHE_VERSION = 'taxi-app-v5.9.0-1345';
const CACHE_NAME = CACHE_VERSION;

// Dateien die gecached werden sollen
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

// Installation - Cache erstellen
self.addEventListener('install', event => {
    console.log('📦 Service Worker v5.9.0 installiert');
    
    // Sofort aktivieren ohne auf alte Worker zu warten
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✅ Cache geöffnet:', CACHE_NAME);
                return cache.addAll(urlsToCache);
            })
    );
});

// Aktivierung - Alte Caches LÖSCHEN!
self.addEventListener('activate', event => {
    console.log('🔄 Service Worker aktiviert');
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Lösche ALLE alten Caches
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Lösche alten Cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
        .then(() => {
            console.log('✅ Alle alten Caches gelöscht!');
            // Übernehme Kontrolle über alle Tabs sofort
            return self.clients.claim();
        })
    );
});

// Fetch - Network First Strategie für HTML
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Für HTML: IMMER vom Netzwerk laden (für Updates)
    if (event.request.method === 'GET' && 
        (url.pathname === '/' || url.pathname.endsWith('.html'))) {
        
        event.respondWith(
            fetch(event.request, { cache: 'no-store' })
                .then(response => {
                    // Speichere im Cache
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(event.request, responseToCache));
                    return response;
                })
                .catch(() => {
                    // Fallback: Aus Cache wenn offline
                    return caches.match(event.request);
                })
        );
        return;
    }
    
    // Für andere Dateien: Cache First
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

// Push Notifications
self.addEventListener('push', event => {
    console.log('📬 Push Notification empfangen');
    
    const data = event.data ? event.data.json() : {};
    const title = data.title || '🚕 Funk Taxi Heringsdorf';
    const options = {
        body: data.body || 'Neue Benachrichtigung',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: data
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Notification Click
self.addEventListener('notificationclick', event => {
    console.log('🔔 Notification geklickt');
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow('/')
    );
});

// Message Handler - Für manuelles Cache-Löschen
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        console.log('🗑️ Manuelles Cache-Löschen angefordert');
        event.waitUntil(
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => caches.delete(cacheName))
                );
            })
            .then(() => {
                console.log('✅ Alle Caches gelöscht!');
                // Sende Bestätigung zurück
                event.ports[0].postMessage({ success: true });
            })
        );
    }
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
