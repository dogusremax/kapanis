// v158 — sayfa her zaman ağdan (tarayıcı önbelleği atlanır), çevrimdışıysa son kopya
const CACHE_NAME = 'kapanis-v164';

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

// Telefon bildirimleri (Firebase üzerinden web push). Gelen veri: {data:{baslik, metin, link, etiket}}
self.addEventListener('push', event => {
  let d = {};
  try { const j = event.data ? event.data.json() : {}; d = j.data || j.notification || j; } catch (e) {}
  const baslik = d.baslik || d.title || 'RE/MAX Doğuş';
  event.waitUntil(self.registration.showNotification(baslik, {
    body: d.metin || d.body || '',
    icon: 'icon.png',
    badge: 'icon.png',
    tag: d.etiket || undefined,
    renotify: !!d.etiket,   // aynı türden yeni bildirim de sesle uyarsın
    silent: false,
    data: { link: d.link || '' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (link === self.registration.scope) {
        const acik = list.find(c => c.url.startsWith(self.registration.scope));
        if (acik) return acik.focus();
      }
      return self.clients.openWindow(link);
    })
  );
});
