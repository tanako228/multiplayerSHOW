/* Работа без сети: файлы приложения — в кэше телефона. Песни и пометки — не здесь, а в IndexedDB (db.js).
   VER подставляет сервер (teamsrv.js: appVer) — отпечаток файлов app/. Обновилась программа — поменялся sw.js —
   телефон скачает новые файлы, старый кэш удалит. Запросы к /api/… сюда не попадают (идут в сеть как есть). */
const VER = '__VER__';
const CACHE = 'mps-' + VER;
const FILES = ['./', 'app.css', 'pen.css', 'db.js', 'pen.js', 'app.js', 'vendor/minisearch.js', 'manifest.webmanifest', 'icon-192.png', 'icon-256.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('mps-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Сначала кэш: без сети (дома, в дороге) адрес не отвечает, и ждать его нельзя. Новые файлы приходят с новой версией.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || !u.pathname.startsWith('/app/') || u.pathname === '/app/ping') return;
  const key = e.request.mode === 'navigate' ? new URL('./', self.location).href : e.request;
  e.respondWith(caches.open(CACHE)
    .then((c) => c.match(key, { ignoreSearch: true }))
    .then((hit) => hit || fetch(e.request)));
});
