'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createSync } = require('../sync/core.js');
const { createAppSource } = require('../sync/appsource.js');
const { memoryProvider } = require('../sync/providers/memory.js');

// Части как в main.js (REPO_PARTS), только нужное для проверки
const PARTS = { lib: { themes: 'themes', macros: 'macros' }, set: { sizes: 'layout' }, ls: { 'cp.bookmarks': 'bookmarks' } };
const owner = (kind, k) => (PARTS[kind] && PARTS[kind][k]) || (kind === 'lib' ? 'library' : 'settings');
const ALL = ['library', 'files', 'themes', 'macros', 'bibles', 'bookmarks', 'settings'];

/* «Компьютер»: своя папка программы, своя библиотека, свой localStorage */
function computer(name, provider, opts = {}) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), `mps-${name}-`));
  const pc = {
    ud, lib: { version: 2, items: {}, libraries: [], playlists: [], view: { kind: 'pl', id: name } },
    ls: { 'cp.settings': JSON.stringify({ volume: 1, sizes: { a: 1 }, cloud: { x: 1 } }) },
    bibleIdx: [], t: 1000, last: null,
  };
  const bibleDir = path.join(ud, 'bibles');
  let coreState = null;
  pc.sync = async (run = {}) => {
    const src = createAppSource({
      ud, libView: () => JSON.parse(JSON.stringify(pc.lib)), saveLib: (o) => { pc.lib = o; }, ls: pc.ls,
      readIndex: () => pc.bibleIdx, writeIndex: (l) => { pc.bibleIdx = l; }, bibleDir, owner,
      parts: new Set(opts.parts || ALL), stateFile: path.join(ud, 'cloud', 'source.json'), conflictDir: path.join(ud, 'cloud', 'conflicts'),
      now: () => pc.t,
    });
    const core = createSync({ provider, source: src, deviceId: name, include: src.include, now: () => pc.t,
      state: { load: async () => coreState && JSON.parse(coreState), save: async (o) => { coreState = JSON.stringify(o); } } });
    // первая синхронизация с непустым облаком — как ответ «Взять из облака» в окне
    if (!coreState && !run.prefer && await core.others()) run = { ...run, prefer: 'remote' };
    const res = await core.sync(run);
    const out = src.finish();
    // как окно: применить настройки и записи localStorage
    const set = JSON.parse(pc.ls['cp.settings']);
    Object.assign(set, out.set); for (const k of out.dropSet) delete set[k];
    pc.ls['cp.settings'] = JSON.stringify(set);
    for (const [k, v] of Object.entries(out.ls)) pc.ls[k] = v;
    for (const k of out.dropLs) delete pc.ls[k];
    pc.last = { res, out };
    return pc.last;
  };
  pc.file = (rel, text) => { const p = path.join(ud, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
  pc.done = () => fs.rmSync(ud, { recursive: true, force: true });
  return pc;
}
const quiet = (r) => r.res.pushed.length + r.res.pulled.length + r.res.deleted.length + r.res.conflicts.length;

test('песня с картинками из папки программы и из другого места доезжает и не возвращается обратно', async (t) => {
  const p = memoryProvider();
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-ext-'));
  const A = computer('A', p), B = computer('B', p);
  t.after(() => { A.done(); B.done(); fs.rmSync(ext, { recursive: true, force: true }); });
  const img = A.file('images/bg.png', 'PNG-A');
  const video = path.join(ext, 'Интро.mp4'); fs.writeFileSync(video, 'VIDEO');
  A.lib.items.s1 = { id: 's1', name: 'Песня', bg: img, media: pathToFileURL(video).href + '#t=5' };
  A.lib.libraries = [{ id: 'L1', name: 'Песни', items: ['s1'] }];
  A.lib.themes = [{ id: 'T1', name: 'Тёмная' }, { id: 'T2', name: 'Светлая' }];
  A.ls['cp.bookmarks'] = JSON.stringify([{ v: 1 }]);
  await A.sync();

  const r = await B.sync();
  assert.equal(r.out.changed, true);
  const s = B.lib.items.s1;
  assert.equal(s.bg, path.join(B.ud, 'images', 'bg.png'));                      // путь — уже свой
  assert.equal(fs.readFileSync(s.bg, 'utf8'), 'PNG-A');
  assert.match(s.media, /^file:\/\/\/.*\/media\/cloud\/[0-9a-f]{8}-.*\.mp4#t=5$/);  // чужой файл — в media\cloud
  assert.equal(B.lib.themes.map((x) => x.id).join(), 'T1,T2');
  assert.deepEqual(B.lib.view, { kind: 'pl', id: 'B' });                          // что открыто — своё
  assert.equal(B.ls['cp.bookmarks'], '[{"v":1}]');
  const set = JSON.parse(B.ls['cp.settings']);
  assert.equal(set.volume, 1); assert.deepEqual(set.cloud, { x: 1 });              // cloud не синхронизируется

  B.t = 2000; A.t = 2000;
  { const q = await B.sync(); assert.equal(quiet(q), 0, 'B не должен ничего отправлять обратно: ' + JSON.stringify(q.res)); }
  assert.equal(quiet(await A.sync()), 0, 'A тоже');
});

test('порядок, удаление и правка элемента списка', async (t) => {
  const p = memoryProvider();
  const A = computer('A', p), B = computer('B', p);
  t.after(() => { A.done(); B.done(); });
  A.lib.playlists = [{ id: 'p1', name: 'Утро', entries: [] }, { id: 'p2', name: 'Вечер', entries: [] }, { id: 'p3', name: 'Молодёжь', entries: [] }];
  await A.sync(); await B.sync();
  A.t = 2000;
  A.lib.playlists = [A.lib.playlists[2], { ...A.lib.playlists[0], name: 'Утро!' }]; // p2 удалён, p3 вперёд, p1 переименован
  await A.sync();
  B.t = 3000; await B.sync();
  assert.deepEqual(B.lib.playlists.map((x) => x.id + ':' + x.name), ['p3:Молодёжь', 'p1:Утро!']);
});

test('разные песни правят на двух компьютерах одновременно — без конфликта', async (t) => {
  const p = memoryProvider();
  const A = computer('A', p), B = computer('B', p);
  t.after(() => { A.done(); B.done(); });
  A.lib.items = { a: { id: 'a', text: '1' }, b: { id: 'b', text: '1' } };
  await A.sync(); await B.sync();
  A.t = 2000; A.lib.items.a.text = 'A правил';
  B.t = 2100; B.lib.items.b.text = 'B правил';
  await A.sync(); const r = await B.sync(); A.t = 3000; await A.sync();
  assert.equal(r.res.conflicts.length, 0);
  for (const pc of [A, B]) assert.deepEqual([pc.lib.items.a.text, pc.lib.items.b.text], ['A правил', 'B правил']);
});

test('одна песня на двух компьютерах: проигравшая версия — в папке конфликтов', async (t) => {
  const p = memoryProvider();
  const A = computer('A', p), B = computer('B', p);
  t.after(() => { A.done(); B.done(); });
  A.lib.items = { a: { id: 'a', text: '0' } };
  await A.sync(); await B.sync();
  A.t = 2000; A.lib.items.a.text = 'от A'; await A.sync();
  B.t = 2500; B.lib.items.a.text = 'от B';
  const r = await B.sync();
  assert.equal(r.res.conflicts.length, 1);
  assert.equal(r.out.kept, 1);
  const dir = path.join(B.ud, 'cloud', 'conflicts');
  const [stamp] = fs.readdirSync(dir);
  const [f] = fs.readdirSync(path.join(dir, stamp));
  assert.match(f, /другой компьютер/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, stamp, f), 'utf8')).text, 'от A');
});

test('переводы Библии и шрифты; снятая часть не трогается', async (t) => {
  const p = memoryProvider();
  const A = computer('A', p), B = computer('B', p, { parts: ['library', 'bibles'] }); // B: без тем и без файлов
  t.after(() => { A.done(); B.done(); });
  A.file('bibles/syn.json', '{"name":"Синодальный"}'); A.bibleIdx = [{ id: 'syn', name: 'Синодальный' }];
  A.file('fonts/Мой.ttf', 'FONT');
  A.lib.themes = [{ id: 'T1' }];
  await A.sync(); await B.sync();
  assert.deepEqual(B.bibleIdx, [{ id: 'syn', name: 'Синодальный' }]);
  assert.equal(fs.readFileSync(path.join(B.ud, 'bibles', 'syn.json'), 'utf8'), '{"name":"Синодальный"}');
  assert.equal(fs.existsSync(path.join(B.ud, 'fonts', 'Мой.ttf')), false);
  assert.equal(B.lib.themes, undefined);
});

test('удалённый в облаке файл на диске не удаляется', async (t) => {
  const p = memoryProvider();
  const A = computer('A', p), B = computer('B', p);
  t.after(() => { A.done(); B.done(); });
  A.lib.items = { a: { id: 'a', bg: A.file('images/x.png', 'X') } };
  await A.sync(); await B.sync();
  A.t = 2000; delete A.lib.items.a; await A.sync();
  B.t = 3000; await B.sync();
  assert.equal(B.lib.items.a, undefined);                                   // песня ушла
  assert.equal(fs.existsSync(path.join(B.ud, 'images', 'x.png')), true);   // файл остался
});

test('только отправить: пришедшее не применяется, но и не теряется', async (t) => {
  const p = memoryProvider();
  const A = computer('A', p), B = computer('B', p);
  t.after(() => { A.done(); B.done(); });
  A.lib.items = { a: { id: 'a', text: '1' } };
  await A.sync(); await B.sync();
  A.t = 2000; A.lib.items.a.text = '2'; await A.sync();
  B.t = 2100; B.lib.items.c = { id: 'c' };
  const r = await B.sync({ pushOnly: true });
  assert.deepEqual(r.res.pushed, ['lib/items/c']);
  assert.equal(B.lib.items.a.text, '1');
  await B.sync();
  assert.equal(B.lib.items.a.text, '2');
});

test('новый компьютер «заменить моё облачным»: свои пустые «Песни» не задваиваются', async (t) => {
  const p = memoryProvider();
  const A = computer('A', p), B = computer('B', p);
  t.after(() => { A.done(); B.done(); });
  A.lib.libraries = [{ id: 'LA', name: 'Песни', items: [] }]; A.lib.playlists = [{ id: 'PA', name: 'Служение', entries: [] }];
  await A.sync();
  B.lib.libraries = [{ id: 'LB', name: 'Песни', items: [] }]; B.lib.playlists = [{ id: 'PB', name: 'Служение', entries: [] }];
  const r = await B.sync({ prefer: 'remote', adopt: true });
  assert.deepEqual(B.lib.libraries.map((x) => x.id), ['LA']);
  assert.deepEqual(B.lib.playlists.map((x) => x.id), ['PA']);
  assert.ok(r.out.kept >= 2); // своё — в папке конфликтов
  A.t = 2000; await A.sync();
  assert.deepEqual(A.lib.libraries.map((x) => x.id), ['LA']); // у A ничего лишнего
  B.t = 3000; assert.equal(quiet(await B.sync()), 0);
});
