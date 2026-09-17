// v140 — sayfa her zaman ağdan (tarayıcı önbelleği atlanır), çevrimdışıysa son kopya
const CACHE_NAME = 'kapanis-v140';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // POST vb. dokunma
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Apps Script, Drive vb. dokunma
  const sayfa = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  event.respondWith(
    fetch(sayfa ? new Request(req, { cache: 'no-store' }) : req)
      .then(res => {
        if (res && res.ok) {
          const kopya = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, kopya)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('/kapanis/')))
  );
});
