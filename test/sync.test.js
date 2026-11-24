'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createSync, sha1 } = require('../sync/core.js');
const { memoryProvider } = require('../sync/providers/memory.js');
const { folderProvider } = require('../sync/providers/folder.js');
const { gdriveProvider } = require('../sync/providers/gdrive.js');

/* ---------- «Устройство»: свои данные в памяти + своё время + своя память ядра ---------- */
function device(id, provider, clock) {
  const docs = new Map(); // ключ → { buf, t }
  const kept = [];
  let saved = null;
  const dev = {
    id, docs, kept, clock,
    put(k, text) { docs.set(k, { buf: Buffer.from(text), t: clock.t }); },
    del(k) { docs.delete(k); },
    text(k) { const d = docs.get(k); return d ? d.buf.toString() : undefined; },
    sync: null,
  };
  const source = {
    async scan() { return new Map([...docs].map(([k, d]) => [k, { h: sha1(d.buf), t: d.t, z: d.buf.length }])); },
    async read(k) { return docs.get(k).buf; },
    async apply(k, buf, m) { if (buf) docs.set(k, { buf, t: m.t }); else docs.delete(k); },
    async keep(k, buf, m) { kept.push({ k, text: buf && buf.toString(), from: m.from }); },
  };
  const s = createSync({ provider, source, deviceId: id, deviceName: id, now: () => clock.t, state: { load: async () => saved && JSON.parse(saved), save: async (o) => { saved = JSON.stringify(o); } } });
  dev.sync = s.sync; dev.gc = s.gc;
  return dev;
}
const clock = (t = 1000) => ({ t });

test('A отправляет, B забирает; правки идут в обе стороны', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock();
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('lib/1', 'песня'); A.put('set/x', '1');
  let r = await A.sync();
  assert.deepEqual(r.pushed.sort(), ['lib/1', 'set/x']);
  r = await B.sync();
  assert.deepEqual(r.pulled.sort(), ['lib/1', 'set/x']);
  assert.equal(B.text('lib/1'), 'песня');
  cb.t = 2000; B.put('lib/1', 'песня 2'); await B.sync();
  ca.t = 3000; r = await A.sync();
  assert.deepEqual(r.pulled, ['lib/1']);
  assert.equal(A.text('lib/1'), 'песня 2');
});

test('после отправки своей версии старая чужая не затирает её', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock();
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('k', 'v1'); await A.sync(); await B.sync();
  ca.t = 2000; A.put('k', 'v2'); await A.sync(); // в описи B осталась v1
  ca.t = 3000; const r = await A.sync();
  assert.deepEqual([r.pulled, r.pushed, r.conflicts], [[], [], []]);
  assert.equal(A.text('k'), 'v2');
});

test('удаление доезжает до других устройств', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock();
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('k', 'v'); await A.sync(); await B.sync();
  ca.t = 2000; A.del('k'); await A.sync();
  const r = await B.sync();
  assert.deepEqual(r.deleted, ['k']);
  assert.equal(B.docs.has('k'), false);
  assert.deepEqual((await B.sync()).deleted, []); // и обратно не воскресает
  assert.equal((await A.sync()).pulled.length, 0);
});

test('одновременная правка: побеждает более поздняя, проигравшая сохраняется', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock();
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('k', 'v0'); await A.sync(); await B.sync();
  ca.t = 2000; A.put('k', 'правка A'); cb.t = 2500; B.put('k', 'правка B');
  await A.sync(); // A отправила первой
  const r = await B.sync(); // у B правка позднее
  assert.deepEqual(r.conflicts, [{ key: 'k', won: 'local' }]);
  assert.deepEqual(B.kept, [{ k: 'k', text: 'правка A', from: 'remote' }]);
  const r2 = await A.sync();
  assert.deepEqual(r2.pulled, ['k']);
  assert.equal(A.text('k'), 'правка B');
  assert.deepEqual(A.kept, []); // у A проигравшей версии не было — она уже лежит в «конфликтах» у B
});

test('конфликт: если облако новее — своя версия уходит в «конфликты»', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock();
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('k', 'v0'); await A.sync(); await B.sync();
  ca.t = 3000; A.put('k', 'A позже'); await A.sync();
  cb.t = 2000; B.put('k', 'B раньше');
  const r = await B.sync();
  assert.deepEqual(r.conflicts, [{ key: 'k', won: 'remote' }]);
  assert.deepEqual(B.kept, [{ k: 'k', text: 'B раньше', from: 'local' }]);
  assert.equal(B.text('k'), 'A позже');
});

test('правка против удаления: побеждает правка', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock();
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('k', 'v0'); await A.sync(); await B.sync();
  ca.t = 5000; A.del('k'); await A.sync();   // удалили позже…
  cb.t = 2000; B.put('k', 'правили'); await B.sync(); // …но правка всё равно главнее
  assert.equal(B.text('k'), 'правили');
  await A.sync();
  assert.equal(A.text('k'), 'правили');
});

test('часы отстают: правка после чужой версии всё равно новее', async () => {
  const p = memoryProvider(); const ca = clock(9000), cb = clock(1000);
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('k', 'v1'); await A.sync(); await B.sync();
  B.put('k', 'v2 с отстающих часов'); await B.sync(); // часы B показывают 1000, а версия A — 9000
  const r = await A.sync();
  assert.deepEqual(r.pulled, ['k']);
  assert.equal(A.text('k'), 'v2 с отстающих часов');
});

test('первая синхронизация: одинаковое принимается без споров, разное — конфликт', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock(2000);
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('same', 'x'); A.put('diff', 'a'); await A.sync();
  B.put('same', 'x'); B.put('diff', 'b');
  const r = await B.sync();
  assert.deepEqual(r.conflicts.map((c) => c.key), ['diff']);
  assert.equal(B.text('same'), 'x');
});

test('prefer: remote — при конфликте берём облако независимо от времени', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock(9999);
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('k', 'облако'); await A.sync();
  B.put('k', 'моё');
  const r = await B.sync({ prefer: 'remote' });
  assert.equal(B.text('k'), 'облако');
  assert.equal(B.kept[0].text, 'моё');
  assert.equal(r.conflicts[0].won, 'remote');
});

test('нет содержимого в облаке — ключ ждёт; повреждённое не принимается', async () => {
  const p = memoryProvider(); const ca = clock(), cb = clock();
  const A = device('A', p, ca), B = device('B', p, cb);
  A.put('k', 'данные'); await A.sync();
  const [blob] = [...p.files.keys()].filter((n) => n.startsWith('blobs/'));
  const saved = p.files.get(blob); p.files.delete(blob);
  assert.deepEqual((await B.sync()).pending, ['k']);
  p.files.set(blob, { buf: Buffer.from('испорчено'), mtime: 1 });
  assert.equal((await B.sync()).errors.length, 1);
  p.files.set(blob, saved);
  assert.deepEqual((await B.sync()).pulled, ['k']);
});

test('три устройства сходятся', async () => {
  const p = memoryProvider(); const cs = [clock(1000), clock(1000), clock(1000)];
  const [A, B, C] = ['A', 'B', 'C'].map((id, i) => device(id, p, cs[i]));
  A.put('a', '1'); B.put('b', '2'); C.put('c', '3');
  for (let i = 0; i < 2; i++) for (const d of [A, B, C]) { d.clock.t += 10; await d.sync(); }
  for (const d of [A, B, C]) assert.deepEqual([...d.docs.keys()].sort(), ['a', 'b', 'c']);
});

test('gc: убирает содержимое, на которое никто не ссылается, и только старое', async () => {
  const p = memoryProvider(() => ca.t); const ca = clock(0);
  const A = device('A', p, ca);
  A.put('k', 'v1'); await A.sync();
  ca.t = 1000; A.put('k', 'v2'); await A.sync();
  assert.equal([...p.files.keys()].filter((n) => n.startsWith('blobs/')).length, 2);
  assert.deepEqual(await A.gc({ graceMs: 5000 }), []);   // ещё в запасе
  ca.t = 10000;
  assert.equal((await A.gc({ graceMs: 5000 })).length, 1); // осталась только v2
});

/* ---------- Папка (общий контракт провайдера) ---------- */
async function contract(p) {
  assert.equal(await p.read('devices/a.json'), null);
  await p.write('devices/a.json', Buffer.from('1'));
  await p.write('blobs/ab/abc', Buffer.from('xyz'));
  await p.write('blobs/ab/abc', Buffer.from('xyzw')); // перезапись
  assert.equal((await p.read('blobs/ab/abc')).toString(), 'xyzw');
  assert.deepEqual((await p.list('devices/')).map((f) => f.name), ['devices/a.json']);
  const bl = await p.list('blobs/');
  assert.equal(bl.length, 1); assert.equal(bl[0].size, 4);
  await p.remove('blobs/ab/abc'); await p.remove('blobs/ab/abc'); // повторное удаление — не ошибка
  assert.equal(await p.read('blobs/ab/abc'), null);
}
test('провайдер «Память» соблюдает контракт', async () => { await contract(memoryProvider()); });
test('провайдер «Папка» соблюдает контракт и не пускает наружу', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-sync-'));
  try {
    const p = folderProvider(dir);
    await contract(p);
    await assert.rejects(() => p.write('../evil', Buffer.from('x')));
    await assert.rejects(() => p.read('a/../../b'));
    // ядро поверх папки: два устройства через одну папку
    const ca = clock(), cb = clock();
    const A = device('A', p, ca), B = device('B', p, cb);
    A.put('k', 'через папку'); await A.sync();
    assert.deepEqual((await B.sync()).pulled, ['k']);
    assert.equal(fs.readdirSync(dir, { recursive: true }).some((n) => String(n).endsWith('.part')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- Google Диск на поддельном сервере ---------- */
function fakeGoogle({ pageSize = 2 } = {}) {
  const files = new Map(); // id → { name, buf, mtime }
  const sessions = new Map();
  const st = { n: 0, tokenCalls: 0, fail429: 0, expireAccess: false, revoked: false, challenge: null, codes: new Map() };
  const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const meta = (id) => { const x = files.get(id); return { id, name: x.name, size: String(x.buf.length), modifiedTime: new Date(x.mtime).toISOString() }; };
  async function fetch(url, init = {}) {
    const u = new URL(url); const m = init.method || 'GET';
    if (u.href === 'https://oauth2.googleapis.com/token') {
      st.tokenCalls++;
      const q = new URLSearchParams(init.body);
      if (q.get('grant_type') === 'authorization_code') {
        const want = st.codes.get(q.get('code'));
        const ok = want && crypto.createHash('sha256').update(q.get('code_verifier')).digest('base64url') === want;
        return ok ? json({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400);
      }
      if (st.revoked) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'at' + (++st.n + 1), expires_in: 3600 });
    }
    const auth = init.headers && init.headers.Authorization;
    if (st.expireAccess && auth === 'Bearer at1') return new Response('', { status: 401 });
    if (st.fail429 > 0) { st.fail429--; return new Response('slow', { status: 429 }); }
    if (u.origin + u.pathname === 'https://www.googleapis.com/drive/v3/files' && m === 'GET') {
      assert.equal(u.searchParams.get('spaces'), 'appDataFolder');
      const all = [...files.keys()]; const from = +(u.searchParams.get('pageToken') || 0);
      const page = all.slice(from, from + pageSize);
      return json({ files: page.map(meta), ...(from + pageSize < all.length ? { nextPageToken: String(from + pageSize) } : {}) });
    }
    let mm;
    if ((mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname))) {
      const x = files.get(mm[1]);
      if (!x) return new Response('', { status: 404 });
      if (m === 'DELETE') { files.delete(mm[1]); return new Response(null, { status: 204 }); }
      return new Response(x.buf);
    }
    if (u.pathname === '/upload/drive/v3/files' && m === 'POST' && u.searchParams.get('uploadType') === 'multipart') {
      const b = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
      const parts = Buffer.from(init.body).toString('latin1').split('--' + b).filter((s) => /Content-Type/.test(s));
      const [h1, b1] = parts[0].split('\r\n\r\n'); const [, b2] = parts[1].split('\r\n\r\n');
      const metaObj = JSON.parse(Buffer.from(b1.replace(/\r\n$/, ''), 'latin1').toString('utf8'));
      assert.deepEqual(metaObj.parents, ['appDataFolder']);
      const id = 'f' + (++st.n); files.set(id, { name: metaObj.name, buf: Buffer.from(b2.replace(/\r\n$/, ''), 'latin1'), mtime: Date.now() });
      return json(meta(id));
    }
    if ((mm = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname))) {
      const type = u.searchParams.get('uploadType');
      if (type === 'media' && m === 'PATCH') { const x = files.get(mm[1]); x.buf = Buffer.from(init.body); x.mtime = Date.now(); return json(meta(mm[1])); }
      if (type === 'resumable') {
        const sid = 'https://upload.fake/s' + (++st.n);
        sessions.set(sid, { id: mm[1] || null, name: JSON.parse(init.body).name, chunks: [] });
        return new Response('', { status: 200, headers: { Location: sid } });
      }
    }
    if (u.origin === 'https://upload.fake' && m === 'PUT') {
      const s = sessions.get(url); const [, a, b, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(init.headers['Content-Range']);
      s.chunks.push(Buffer.from(init.body)); assert.equal(+a, s.chunks.slice(0, -1).reduce((n, c) => n + c.length, 0));
      if (+b + 1 < +total) return new Response('', { status: 308 });
      const id = s.id || 'f' + (++st.n); files.set(id, { name: s.name || files.get(id).name, buf: Buffer.concat(s.chunks), mtime: Date.now() });
      return json(meta(id));
    }
    throw new Error('поддельный Google: неизвестный запрос ' + m + ' ' + url);
  }
  return { fetch, files, st };
}
const tokenBox = (init = { refresh_token: 'rt1' }) => { let v = init; return { load: () => v, save: (x) => { v = x; }, get: () => v }; };
const gd = (g, tokens = tokenBox(), extra = {}) => gdriveProvider({ clientId: 'cid', tokens, fetch: g.fetch, sleep: async () => {}, ...extra });

test('Google Диск: контракт провайдера (создание, замена, постраничный список, удаление)', async () => {
  const g = fakeGoogle(); const p = gd(g);
  assert.equal(await p.read('devices/a.json'), null);
  await p.write('devices/a.json', Buffer.from('один'));
  await p.write('devices/b.json', Buffer.from('два'));
  await p.write('blobs/ab/abc', Buffer.from('xyz'));
  await p.write('devices/a.json', Buffer.from('один!')); // замена, не копия
  assert.equal(g.files.size, 3);
  assert.equal((await p.read('devices/a.json')).toString(), 'один!');
  assert.deepEqual((await p.list('devices/')).map((f) => f.name).sort(), ['devices/a.json', 'devices/b.json']); // список шёл в две страницы
  await p.remove('blobs/ab/abc'); await p.remove('blobs/ab/abc');
  assert.equal(await p.read('blobs/ab/abc'), null);
});

test('Google Диск: большой файл уходит кусками и читается обратно', async () => {
  const g = fakeGoogle(); const p = gd(g);
  const big = crypto.randomBytes(9 * 1024 * 1024 + 123);
  await p.write('blobs/big', big);
  assert.equal(sha1(await p.read('blobs/big')), sha1(big));
  const big2 = crypto.randomBytes(5 * 1024 * 1024);
  await p.write('blobs/big', big2); // замена большого — тоже кусками
  assert.equal(g.files.size, 1);
  assert.equal(sha1(await p.read('blobs/big')), sha1(big2));
});

test('Google Диск: устаревший доступ обновляется, 429 повторяется, отозванный — просит войти', async () => {
  const g = fakeGoogle(); const tb = tokenBox({ refresh_token: 'rt1', access_token: 'at1', expires: Date.now() + 3600e3 });
  const p = gd(g, tb);
  g.st.expireAccess = true; g.st.fail429 = 2;
  await p.write('x', Buffer.from('1'));
  assert.equal((await p.read('x')).toString(), '1');
  assert.ok(g.st.tokenCalls >= 1);
  g.st.revoked = true; g.st.expireAccess = true; tb.save({ refresh_token: 'rt1', access_token: 'at1', expires: 0 });
  const p2 = gd(g, tb);
  await assert.rejects(() => p2.list(''), (e) => e.code === 'NEED_SIGNIN');
  assert.equal(tb.get(), null); // токен убран, программа покажет «Войти»
});

test('Google Диск: вход через браузер (PKCE) сохраняет токен', async () => {
  const g = fakeGoogle(); const tb = tokenBox(null); const p = gd(g, tb);
  assert.equal(p.signedIn(), false);
  await p.signIn({
    openUrl: (url) => { // «браузер»: читаем запрос, возвращаем код на адрес из redirect_uri
      const q = new URL(url).searchParams;
      assert.equal(q.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
      assert.equal(q.get('code_challenge_method'), 'S256');
      g.st.codes.set('CODE1', q.get('code_challenge'));
      http.get(`${q.get('redirect_uri')}/?code=CODE1&state=${q.get('state')}`, (res) => res.resume()).on('error', () => {});
    },
  });
  assert.equal(tb.get().refresh_token, 'rt1');
  assert.equal(p.signedIn(), true);
  await p.signOut();
  assert.equal(p.signedIn(), false);
});

test('Google Диск + ядро: два устройства через один «диск»', async () => {
  const g = fakeGoogle({ pageSize: 3 });
  const ca = clock(), cb = clock();
  const A = device('A', gd(g), ca), B = device('B', gd(g), cb);
  for (let i = 0; i < 5; i++) A.put('lib/' + i, 'песня ' + i);
  await A.sync();
  const r = await B.sync();
  assert.equal(r.pulled.length, 5);
  assert.equal(B.text('lib/3'), 'песня 3');
});
