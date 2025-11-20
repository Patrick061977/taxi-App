// Service Worker für Funk Taxi Heringsdorf
// Version 3.6.0 - Background Sync & Push Notifications

const CACHE_NAME = 'taxi-hgw-v3.6.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Installation
self.addEventListener('install', event => {
  console.log('🔧 Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ Service Worker: Cache opened');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.error('❌ Cache error:', err))
  );
  self.skipWaiting();
});

// Aktivierung
self.addEventListener('activate', event => {
  console.log('✅ Service Worker: Activated');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch - offline support
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// 🔔 PUSH NOTIFICATION HANDLER
self.addEventListener('push', event => {
  console.log('🔔 Push empfangen:', event);
  
  let data = { title: 'Neue Buchung', body: 'Sie haben eine neue Fahrt!' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'taxi-notification',
    requireInteraction: true,
    data: data.data || {},
    actions: [
      { action: 'view', title: '👀 Anzeigen' },
      { action: 'close', title: '❌ Schließen' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', event => {
  console.log('🔔 Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// 🔄 BACKGROUND SYNC für Firebase-Updates
self.addEventListener('sync', event => {
  console.log('🔄 Background Sync:', event.tag);
  
  if (event.tag === 'sync-rides') {
    event.waitUntil(syncRides());
  }
});

async function syncRides() {
  console.log('🔄 Syncing rides in background...');
  return Promise.resolve();
}

console.log('✅ Service Worker loaded - Version 3.6.0');
