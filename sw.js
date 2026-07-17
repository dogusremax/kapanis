const CACHE_NAME = 'kapanis-v2';
const urlsToCache = [
  '/kapanis/',
  '/kapanis/index.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache).catch(() => {}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ÖNCE AĞ, çevrimdışıysa önbellek — güncellemeler anında yansır
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (event.request.method === 'GET' && response && response.ok) {
          const kopya = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, kopya)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(r => r || caches.match('/kapanis/'))
      )
  );
});
