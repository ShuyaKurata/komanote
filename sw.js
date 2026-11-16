// オフライン対応の Service Worker
// 方針: ネットワーク優先。つながらないときだけキャッシュを返す(更新がすぐ反映され、オフラインでも起動できる)
const CACHE = 'komanote-v1';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/main.js', './js/editor.js', './js/ui.js', './js/util.js', './js/icons.js', './js/paper.js',
  './js/model.js', './js/storage.js', './js/history.js', './js/brush.js', './js/render.js',
  './js/dialog.js', './js/tooldefs.js', './js/tools.js', './js/geometry.js', './js/panels.js',
  './js/text.js', './js/text-tools.js', './js/effects.js', './js/paint-tools.js', './js/export.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
