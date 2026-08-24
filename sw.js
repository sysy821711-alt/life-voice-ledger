const CACHE_NAME = 'voice-ledger-v7';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/speech.js',
  './js/charts.js',
  './js/stats.js',
  './js/app.js',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => {
          // 網路失敗且沒有快取：導覽請求退回 app shell，其餘回傳明確的錯誤 Response
          // （絕不能回傳 undefined，否則 Safari 會把整個請求判定成連線中斷）
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('離線且尚未快取此資源', { status: 503, statusText: 'Service Unavailable' });
        });
    })
  );
});
