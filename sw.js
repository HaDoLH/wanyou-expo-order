/* =========================================================
   Service Worker：讓網頁在展場網路不穩時也能打開
   比喻：像把網頁「影印一份」放在平板裡，沒網路就看影印本。
   ⚠ 每次更新網站檔案，要把下面的版本號 +1，平板才會抓新版
   ========================================================= */
const CACHE = 'wyx-v12';

const FILES = [
  './',
  './index.html',
  './style.css?v=10',
  './products.js?v=7',
  './app.js?v=9',
  './manifest.webmanifest',
  './images/logo-256.png',
  './images/logo-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

// 安裝：把檔案存起來
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// 啟用：清掉舊版本的影印本
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 讀取：有網路就用最新的（順便更新影印本），沒網路才用影印本
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // 上傳訂單（POST）不經過這裡
  if (req.url.includes('script.google.com')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: false }).then((r) => r || caches.match('./index.html')))
  );
});
