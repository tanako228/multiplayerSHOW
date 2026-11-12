/* Работа без сети: файлы приложения — в кэше телефона. Песни и пометки — не здесь, а в IndexedDB (db.js).
   VER подставляет сервер (teamsrv.js: appVer) — отпечаток файлов app/. Обновилась программа — поменялся sw.js —
   телефон скачает новые файлы, старый кэш удалит. Запросы к /api/… сюда не попадают (идут в сеть как есть). */
const VER = '__VER__';
const CACHE = 'mps-' + VER;
const FILES = ['./', 'app.css', 'pen.css', 'db.js', 'chords.js', 'i18n.js', 'lang-app.js', 'pen.js', 'stylus.js', 'mine.js', 'sheets.js', 'app.js', 'vendor/minisearch.js', 'manifest.webmanifest', 'icon-192.png', 'icon-256.png', 'icon-512.png'];

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
// Android: «Поделиться» → «MP Группа» (share_target в manifest) — файл с аккордами и нотами кладём в кэш share-in,
// приложение откроется с ?share=1 и заберёт его (sheets.js: fromShare)
async function shareIn(req) {
  try {
    const fd = await req.formData();
    const f = fd.getAll('file').find((x) => x && typeof x.text === 'function');
    const text = f ? await f.text() : String(fd.get('text') || '');
    const c = await caches.open('share-in');
    await c.put('/app/share-in', new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  } catch { /* не прочитали — просто откроем приложение */ }
  return Response.redirect('/app/?share=1', 303);
}

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.origin === self.location.origin && u.pathname === '/app/share') { e.respondWith(shareIn(e.request)); return; }
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || !u.pathname.startsWith('/app/') || u.pathname === '/app/ping') return;
  const key = e.request.mode === 'navigate' ? new URL('./', self.location).href : e.request;
  e.respondWith(caches.open(CACHE)
    .then((c) => c.match(key, { ignoreSearch: true }))
    .then((hit) => hit || fetch(e.request)));
});
