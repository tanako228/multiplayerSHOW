// Удалённый режим R2 (wpfiles.js): раздача файлов A и приём их на B
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const wpf = require('../wpfiles');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wpf-'));
  const ud = path.join(root, 'userdata');
  const pool = path.join(root, 'Медиа пул');
  const other = path.join(root, 'secret');
  const songDir = path.join(root, 'docs');
  for (const d of [ud, path.join(ud, 'slides'), pool, path.join(pool, 'sub'), other, songDir]) fs.mkdirSync(d, { recursive: true });
  const big = Buffer.alloc(300000); for (let i = 0; i < big.length; i++) big[i] = i % 251;
  fs.writeFileSync(path.join(ud, 'slides', 's1.png'), 'PNG-1');
  fs.writeFileSync(path.join(pool, 'sub', 'v.mp4'), big);
  fs.writeFileSync(path.join(other, 'x.png'), 'нельзя');
  fs.writeFileSync(path.join(other, 'pass.txt'), 'нельзя');
  fs.writeFileSync(path.join(songDir, 'bg.jpg'), 'JPG');
  fs.writeFileSync(path.join(songDir, 'not-mine.jpg'), 'нельзя');
  // Библиотека: файл песни адресом file:///; настройки окна (строка JSON внутри JSON) — папка медиапула
  const lib = path.join(ud, 'library.json');
  fs.writeFileSync(lib, JSON.stringify({ items: [{ bg: pathToFileURL(path.join(songDir, 'bg.jpg')).href }, { media: path.join(other, 'pass.txt') }] }));
  const ls = path.join(ud, 'settings-backup.json');
  fs.writeFileSync(ls, JSON.stringify({ 'cp.settings': JSON.stringify({ poolDirs: [pool] }) }));
  let key = 'a'.repeat(32);
  const h = wpf.host({ key: () => key, roots: () => [ud], dataFiles: () => [lib, ls] });
  const srv = http.createServer((req, res) => { if (!h.serve(req, res, new URL(req.url, 'http://x'))) { res.writeHead(404); res.end(); } });
  return { root, ud, pool, other, songDir, big, h, srv, setKey: (k) => { key = k; } };
}

test('A: что можно отдавать', () => {
  const t = setup();
  assert.equal(t.h.allowed(path.join(t.ud, 'slides', 's1.png')), true, 'папка данных');
  assert.equal(t.h.allowed(path.join(t.pool, 'sub', 'v.mp4')), true, 'папка медиапула из настроек окна');
  assert.equal(t.h.allowed(path.join(t.songDir, 'bg.jpg')), true, 'файл из библиотеки адресом file:///');
  assert.equal(t.h.allowed(path.join(t.songDir, 'not-mine.jpg')), false, 'сосед упомянутого файла — нет');
  assert.equal(t.h.allowed(path.join(t.other, 'x.png')), false, 'неупомянутая папка');
  assert.equal(t.h.allowed(path.join(t.other, 'pass.txt')), false, 'не медиа — нет, даже если упомянут');
  assert.equal(t.h.allowed(path.join(t.root, 'x.png')), false, 'общая папка над упомянутыми — нет');
});

test('A → B: Range, ETag, ключ, кэш, свои файлы программы', async () => {
  const t = setup();
  await new Promise((r) => t.srv.listen(0, '127.0.0.1', r));
  const port = t.srv.address().port;
  const url = (p, k = 'a'.repeat(32)) => `http://127.0.0.1:${port}/wpf/${k}/${wpf.b64(p)}`;
  try {
    const v = path.join(t.pool, 'sub', 'v.mp4');
    let r = await fetch(url(v), { headers: { Range: 'bytes=1000-1999' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 1000-1999/300000');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), t.big.subarray(1000, 2000));
    r = await fetch(url(v), { headers: { Range: 'bytes=-10' } });
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), t.big.subarray(-10));
    r = await fetch(url(v));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'video/mp4');
    const et = r.headers.get('etag');
    await r.arrayBuffer();
    r = await fetch(url(v), { headers: { 'If-None-Match': et } });
    assert.equal(r.status, 304);
    assert.equal((await fetch(url(v, 'b'.repeat(32)))).status, 403, 'чужой ключ');
    assert.equal((await fetch(url(path.join(t.other, 'x.png')))).status, 403, 'не из списка');
    assert.equal((await fetch(url(v), { headers: { Origin: 'http://evil' } })).status, 403, 'из браузера');
    assert.equal((await fetch(url(path.join(t.ud, 'nope.png')))).status, 404);

    // Клиент B: адреса file:// окна
    let on = true;
    const app = path.join(t.root, 'app');
    const c = wpf.client({ base: () => (on ? `http://127.0.0.1:${port}/wpf/${'a'.repeat(32)}/` : ''), appDirs: [app], local: () => new Response('LOCAL') });
    const req = (p, h) => new Request(pathToFileURL(p).href + '?v=3', { headers: h || {} });
    const s1 = path.join(t.ud, 'slides', 's1.png');
    r = await c.handle(req(s1));
    assert.equal(await r.text(), 'PNG-1');
    assert.equal(c.stats().n, 1, 'маленький файл запомнен');
    fs.writeFileSync(s1, 'PNG-2'); // поменялся на A — B берёт новый (ETag)
    const t0 = Date.now() + 5000; fs.utimesSync(s1, t0 / 1000, t0 / 1000);
    assert.equal(await (await c.handle(req(s1))).text(), 'PNG-2');
    assert.equal(await (await c.handle(req(s1))).text(), 'PNG-2', 'из памяти после 304');
    r = await c.handle(req(v, { Range: 'bytes=5-9' }));
    assert.equal(r.status, 206);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), t.big.subarray(5, 10));
    assert.equal(await (await c.handle(req(path.join(app, 'index.html')))).text(), 'LOCAL', 'файлы программы — свои');
    assert.equal((await c.handle(req(path.join(t.other, 'x.png')))).status, 403);
    on = false;
    assert.equal(await (await c.handle(req(s1))).text(), 'LOCAL', 'не управляем — всё своё');
    // Никто не управляет A — ключа нет
    t.setKey('');
    assert.equal((await fetch(url(v))).status, 403);
  } finally {
    await new Promise((r) => t.srv.close(r));
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test('R3: список папки — сначала папки, по имени с числами; нет папки — ошибка, а не исключение', () => {
  const t = setup();
  try {
    fs.writeFileSync(path.join(t.pool, 'a10.png'), 'x');
    fs.writeFileSync(path.join(t.pool, 'a9.png'), 'x');
    const r = wpf.listDir(t.pool);
    assert.deepEqual(r.entries.map((e) => [e.name, e.dir]), [['sub', true], ['a9.png', false], ['a10.png', false]]);
    assert.equal(r.parent, t.root);
    assert.ok(wpf.listDir(path.join(t.root, 'нет такой')).error);
    assert.ok(wpf.drives().length >= 1);
  } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
});
