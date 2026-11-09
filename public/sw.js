/* Darts Tracker — Service Worker.
   Navigation: Netz zuerst (damit ein Deploy sofort greift), Cache als Rückfall.
   Assets mit Hash im Namen: Cache zuerst. API: immer live. */
const CACHE = 'darts-v2';
const FALLBACK = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', FALLBACK])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((cache) => cache.put(FALLBACK, copy));
          return res;
        })
        .catch(() => caches.match(FALLBACK)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      });
    }),
  );
});
