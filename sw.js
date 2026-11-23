// オフライン対応の Service Worker
// 方針: ネットワーク優先。つながらないときだけキャッシュを返す(更新がすぐ反映され、オフラインでも起動できる)
const CACHE = 'komanote-v11';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/main.js', './js/editor.js', './js/ui.js', './js/util.js', './js/icons.js', './js/paper.js',
  './js/model.js', './js/storage.js', './js/history.js', './js/brush.js', './js/render.js',
  './js/dialog.js', './js/tooldefs.js', './js/tools.js', './js/geometry.js', './js/panels.js',
  './js/text.js', './js/text-tools.js', './js/effects.js', './js/paint-tools.js', './js/export.js', './js/notice.js', './js/filelink.js', './js/gdrive.js', './js/drive-ui.js', './js/config.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const FONT_CACHE = 'komanote-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Google Fonts は一度読み込んだらキャッシュから使う(オフラインでも同じフォントで表示できる)
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: ブラウザの HTTP キャッシュに古いファイルが残っていても、必ずサーバーに更新を確認する
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
