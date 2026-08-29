const CACHE_NAME = 'voice-ledger-v10';
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

// Network-first：每次都先試著抓最新版本，只有在離線／連線失敗時才退回快取。
// （改版前是「快取優先，有快取就永遠不再檢查網路」，會導致已安裝在手機主畫面的
// App 卡在舊版本，即使程式碼已經更新、重開 App 也不會抓到新版，只能手動清除資料才會恢復。）
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // 離線且沒有快取：導覽請求退回 app shell，其餘回傳明確的錯誤 Response
          // （絕不能回傳 undefined，否則 Safari 會把整個請求判定成連線中斷）
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('離線且尚未快取此資源', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});
