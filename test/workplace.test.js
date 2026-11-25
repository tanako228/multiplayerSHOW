// Удалённый режим (workplace.js): два экземпляра модуля — компьютер A (хост) и B (клиент) — по настоящему WebSocket
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');

const MOD = path.join(__dirname, '..', 'workplace.js');
function fresh() { delete require.cache[require.resolve(MOD)]; return require(MOD); }
function fakeIpc() {
  const h = new Map();
  const on = new Map();
  return {
    h, onm: on,
    handle(ch, fn) { if (h.has(ch)) throw new Error('twice ' + ch); h.set(ch, fn); },
    removeHandler(ch) { h.delete(ch); },
    on(ch, fn) { on.set(ch, fn); return this; },
    invoke(ch, ...a) { return Promise.resolve().then(() => h.get(ch)({ sender: null }, ...a)); },
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms = 3000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await wait(10); } }

function makeHost(extra) {
  const wp = fresh();
  const ipc = fakeIpc();
  wp.hook(ipc);
  const log = { locked: '', unlocked: 0, flushed: 0, ls: null, ndi: [] };
  ipc.handle('lib:load', () => ({ who: 'A', bin: Buffer.from([1, 2, 3]), at: new Date(5) }));
  ipc.handle('echo', (_e, ...a) => a);
  ipc.handle('fail', () => { throw new Error('плохо'); });
  ipc.handle('profile:do', () => 'нельзя');
  ipc.handle('app:version', () => 'A-ver');
  ipc.handle('slow', () => wait(200).then(() => 'slow-ok'));
  ipc.handle('pick', () => wp.remoteDialog('showOpenDialog', { properties: ['openFile'], title: 'Т' }));
  ipc.handle('ask', () => wp.remoteDialog('showMessageBox', { buttons: ['Да', 'Нет'], cancelId: 1 }));
  ipc.on('ndi:ack', (_e, k) => log.ndi.push(k));
  const upDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'wpup-'));
  log.upDir = upDir;
  const srv = http.createServer((q, r) => { if (!wp.serveFile(q, r, new URL(q.url, 'http://x'))) { r.writeHead(404); r.end(); } });
  srv.on('upgrade', (req, sock, head) => { if (!wp.upgrade(req, sock, head)) sock.destroy(); });
  wp.setup({
    name: () => 'A', port: () => srv.address().port, ips: () => ['127.0.0.1'],
    flush: async () => { log.flushed++; return { vars: { '--live': 'red' } }; },
    lock: async (name) => { log.locked = name; },
    unlock: () => { log.unlocked++; },
    lsRead: () => ({ 'cp.settings': '{"a":1}' }),
    lsWrite: (d) => { log.ls = d; },
    event: () => ({ sender: 'A-window' }),
    upDir: () => upDir,
    ...extra,
  });
  return { wp, ipc, srv, log, listen: () => new Promise((r) => srv.listen(0, '127.0.0.1', r)) };
}
function makeClient(name, extra) {
  const wp = fresh();
  const ipc = fakeIpc();
  wp.hook(ipc);
  const log = { reload: 0, ev: [] };
  ipc.handle('lib:load', () => ({ who: 'B' }));
  ipc.handle('echo', () => 'B-echo');
  ipc.handle('app:version', () => 'B-ver');
  ipc.handle('profile:do', () => 'B-prof');
  ipc.handle('slow', () => 'B-slow');
  ipc.handle('fail', () => 'B-fail');
  ipc.handle('pick', () => 'B-pick');
  ipc.handle('ask', () => 'B-ask');
  ipc.on('ndi:ack', () => { throw new Error('ndi:ack должен уйти на A'); });
  wp.setup({ name: () => name, reload: () => { log.reload++; }, toControl: (ch, d) => log.ev.push([ch, d]), ...extra });
  return { wp, ipc, log };
}

test('удалённый режим: вызовы, события, запреты, отключение', async () => {
  const A = makeHost();
  await A.listen();
  const addr = '127.0.0.1:' + A.srv.address().port;
  try {
    const B = makeClient('B');
    // Хост не включён — отказ
    let r = await B.wp.connect({ addr, code: '000000' });
    assert.equal(r.ok, false);
    A.wp.hostSet(true);
    const code = A.wp.state().host.code;
    assert.match(code, /^\d{6}$/);
    // Неверный код
    r = await B.wp.connect({ addr, code: code === '111111' ? '222222' : '111111' });
    assert.equal(r.ok, false);
    assert.match(r.error, /Неверный код/);
    // Верный: A сохранил всё, стал плашкой, B получил снимок настроек и перезагружает окно
    r = await B.wp.connect({ addr, code });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.name, 'A');
    assert.equal(A.log.flushed, 1);
    assert.equal(A.log.locked, 'B');
    assert.equal(B.log.reload, 1);
    assert.equal(B.wp.isClient(), true);
    assert.deepEqual(B.wp.clientLs(), { 'cp.settings': '{"a":1}' });
    assert.notEqual(A.wp.state().host.code, code, 'код одноразовый');
    assert.equal(A.wp.state().host.peer.name, 'B');
    assert.equal(A.wp.state().host.vars['--live'], 'red');

    // Вызовы уходят на A; Buffer и Date доходят как есть
    const lib = await B.ipc.invoke('lib:load');
    assert.equal(lib.who, 'A');
    assert.ok(Buffer.isBuffer(lib.bin) || lib.bin instanceof Uint8Array);
    assert.deepEqual([...lib.bin], [1, 2, 3]);
    assert.equal(+lib.at, 5);
    assert.deepEqual(await B.ipc.invoke('echo', 1, { x: [2] }), [1, { x: [2] }]);
    // Ошибка A — ошибкой у B
    await assert.rejects(B.ipc.invoke('fail'), /плохо/);
    // Своё у B: версия программы
    assert.equal(await B.ipc.invoke('app:version'), 'B-ver');
    // Запрещённое: не уходит и не выполняется у себя
    await assert.rejects(B.ipc.invoke('profile:do'), /Недоступно/);
    // Параллельные вызовы не путаются
    const [s1, e1] = await Promise.all([B.ipc.invoke('slow'), B.ipc.invoke('echo', 'q')]);
    assert.equal(s1, 'slow-ok');
    assert.deepEqual(e1, ['q']);
    // ipcMain.on из списка — на A
    B.ipc.onm.get('ndi:ack')({}, 'k1');
    await until(() => A.log.ndi.length === 1);
    assert.equal(A.log.ndi[0], 'k1');
    // События окну оператора A — у B; свой вопрос о закрытии A — нет
    A.wp.hostEvent('output:state', { open: true, buf: Buffer.from('z') });
    A.wp.hostEvent('app:ask-close');
    A.wp.hostEvent('wp:notice', { text: 'n' });
    await until(() => B.log.ev.length >= 2);
    await wait(50);
    assert.deepEqual(B.log.ev.map((x) => x[0]), ['output:state', 'wp:notice']);
    // Копия настроек окна B — в файл A
    B.wp.sendLs({ 'cp.settings': '{"b":2}' });
    await until(() => A.log.ls);
    assert.deepEqual(A.log.ls, { 'cp.settings': '{"b":2}' });

    // R3: окно выбора на A — окно обзора на B, ответ — обработчику A
    const pk = B.ipc.invoke('pick');
    await until(() => B.log.ev.some((x) => x[0] === 'wp:dialog'));
    const dq = B.log.ev.find((x) => x[0] === 'wp:dialog')[1];
    assert.equal(dq.kind, 'showOpenDialog');
    assert.equal(dq.opts.title, 'Т');
    assert.equal(A.wp.dialogPending(), true);
    const abs = require('path').resolve('/x/y.png');
    B.wp.dialogDone({ id: dq.id, res: { canceled: false, filePaths: [abs, 'не путь'] } });
    assert.deepEqual(await pk, { canceled: false, filePaths: [abs] }, 'чужое (не путь) отброшено');
    assert.equal(A.wp.dialogPending(), false);
    const ak = B.ipc.invoke('ask');
    await until(() => B.log.ev.filter((x) => x[0] === 'wp:dialog').length === 2);
    const dq2 = B.log.ev.filter((x) => x[0] === 'wp:dialog')[1][1];
    B.wp.dialogDone({ id: dq2.id, res: { response: 0 } });
    assert.equal((await ak).response, 0);
    // R3: перетащенный в окно B файл — сразу путь на A; вызов с ним ждёт конца загрузки
    const fsx = require('fs');
    const local = require('path').join(require('os').tmpdir(), 'wp-drop-' + Date.now() + '.png');
    const body = Buffer.alloc(200000, 7);
    fsx.writeFileSync(local, body);
    const ap = B.wp.uploadMap(local);
    assert.ok(ap.startsWith(A.log.upDir), ap);
    assert.equal(require('path').basename(ap), require('path').basename(local));
    assert.equal(B.wp.uploadMap(local), ap, 'тот же файл — тот же путь');
    const got = await B.ipc.invoke('echo', { files: [ap] });
    assert.deepEqual(got, [{ files: [ap] }]);
    assert.deepEqual(fsx.readFileSync(ap), body, 'файл уже на A, когда обработчик получил путь');
    fsx.unlinkSync(local);

    // Третий компьютер — «уже управляют»
    const C = makeClient('C');
    r = await C.wp.connect({ addr, code: A.wp.state().host.code });
    assert.equal(r.ok, false);
    assert.match(r.error, /уже управляют/);

    // Окно выбора открыто, а связь прервалась — обработчик A получает «отмену», а не ждёт вечно
    const pk2 = A.ipc.invoke('pick');
    await until(() => A.wp.dialogPending());

    // «Забрать управление» на A: B узнаёт почему и возвращается к своим данным
    const pending = B.ipc.invoke('slow').then(() => 'ok', (e) => e.message);
    A.wp.hostTakeBack();
    await until(() => !B.wp.isClient());
    assert.match(await pending, /прервалась/, 'ждавший ответа вызов не висит');
    assert.deepEqual(await pk2, { canceled: true, filePaths: [] });
    assert.equal(B.log.reload, 2);
    assert.equal(A.log.unlocked, 1);
    const bye = B.wp.takeBye();
    assert.equal(bye.code, 'taken');
    assert.equal(B.wp.takeBye(), null, 'причина — один раз');
    // Не на связи — снова свои обработчики
    assert.deepEqual(await B.ipc.invoke('lib:load'), { who: 'B' });

    // Снова подключились и сами отключились с B
    r = await B.wp.connect({ addr, code: A.wp.state().host.code });
    assert.equal(r.ok, true, r.error);
    B.wp.disconnect();
    await until(() => A.log.unlocked === 2);
    assert.equal(A.wp.state().host.peer, null);
    assert.equal(B.wp.takeBye(), null, 'сами ушли — без пояснения');

    // Пять неверных кодов — новый код и пауза
    const old = A.wp.state().host.code;
    for (let i = 0; i < 5; i++) await B.wp.connect({ addr, code: old === '123456' ? '654321' : '123456' });
    assert.notEqual(A.wp.state().host.code, old);
    r = await B.wp.connect({ addr, code: A.wp.state().host.code });
    assert.equal(r.ok, false);
    assert.match(r.error, /подождите/);

    // Страница из браузера (есть Origin) не подключится
    const WebSocket = require('ws');
    const code2 = await new Promise((done) => {
      const ws = new WebSocket('ws://' + addr + '/wp', { headers: { Origin: 'http://evil.example' } });
      ws.on('unexpected-response', (_q, res) => done(res.statusCode));
      ws.on('error', () => done('err'));
    });
    assert.equal(code2, 403);
    A.wp.hostSet(false);
  } finally {
    A.wp.shutdown();
    await new Promise((r) => A.srv.close(r));
  }
});

test('адрес без порта — порт пульта 8090', () => {
  const wp = fresh();
  assert.equal(wp._t.normAddr('192.168.1.5'), '192.168.1.5:8090');
  assert.equal(wp._t.normAddr('http://192.168.1.5:8091/x'), '192.168.1.5:8091');
  assert.equal(wp._t.normAddr(''), '');
  assert.equal(wp._t.isLocal('update:check'), true);
  assert.equal(wp._t.isLocal('output:show'), false);
});

test('R4: вход по ключу, обрыв и возврат без перезагрузки, «Забрать» во время обрыва, «Забыть»', async () => {
  const A = makeHost();
  await A.listen();
  const addr = '127.0.0.1:' + A.srv.address().port;
  try {
    A.wp.hostSet(true);
    const B = makeClient('B');
    let r = await B.wp.connect({ addr, code: A.wp.state().host.code });
    assert.equal(r.ok, true, r.error);
    assert.equal(A.wp.state().host.trusted.length, 1, 'A запомнил B');
    assert.equal(A.wp.state().host.trusted[0].name, 'B');
    assert.equal(B.wp.state().client.known.length, 1, 'B запомнил ключ A');
    assert.equal(JSON.stringify(B.wp.state()).includes(A.wp.state().host.trusted[0].hash || '@@'), false);

    // Обрыв: A держит плашку, B переподключается сам; вызов во время обрыва дождался связи
    B.wp._t.drop();
    await until(() => B.wp.state().client.lostUntil > 0);
    await until(() => A.wp.state().host.peer && A.wp.state().host.peer.lostUntil > 0);
    const during = B.ipc.invoke('echo', 'после обрыва');
    await until(() => A.wp.state().host.peer && !A.wp.state().host.peer.lostUntil && !B.wp.state().client.lostUntil);
    assert.deepEqual(await during, ['после обрыва']);
    assert.equal(A.log.unlocked, 0, 'окно A не возвращалось');
    assert.equal(A.log.flushed, 1, 'и не сохранялось заново');
    assert.equal(B.log.reload, 1, 'окно B не перезагружалось');
    assert.ok(B.log.ev.some(([ch, d]) => ch === 'wp:notice' && /восстановлена/.test(d.text)));
    // События после возврата снова доходят
    A.wp.hostEvent('output:state', { n: 2 });
    await until(() => B.log.ev.some(([ch, d]) => ch === 'output:state' && d.n === 2));

    // Отключились сами — снова без кода (по ключу)
    B.wp.disconnect();
    await until(() => A.log.unlocked === 1);
    r = await B.wp.connect({ addr });
    assert.equal(r.ok, true, r.error);
    assert.equal(A.log.flushed, 2);
    assert.equal(A.wp.state().host.trusted.length, 1, 'тот же компьютер — одна запись');

    // Обрыв, а на A тем временем «Забрать управление»: B, вернувшись, узнаёт это и уходит к своим данным
    B.wp._t.drop();
    await until(() => A.wp.state().host.peer && A.wp.state().host.peer.lostUntil > 0);
    A.wp.hostTakeBack();
    await until(() => !B.wp.isClient());
    assert.equal(B.wp.takeBye().code, 'taken');

    // Тот же B зашёл заново (программу перезапустили), пока старый сеанс ждал: старый уступает
    r = await B.wp.connect({ addr });
    assert.equal(r.ok, true, r.error);
    const B2 = makeClient('B');
    // Чужой компьютер без ключа и кода не войдёт, с ключом от другого — тоже
    r = await B2.wp.connect({ addr });
    assert.equal(r.ok, false);
    assert.equal(r.needCode, true);

    // «Забыть» на A: дальше B — только по коду
    B.wp.disconnect();
    await until(() => A.log.unlocked === 3);
    A.wp.hostForget(A.wp.state().host.trusted[0].id);
    assert.equal(A.wp.state().host.trusted.length, 0);
    r = await B.wp.connect({ addr });
    assert.equal(r.ok, false);
    assert.equal(r.needCode, true);
    assert.match(r.error, /не помнит/);
    assert.equal(B.wp.state().client.known.length, 0, 'B выбросил ненужный ключ');
    A.wp.hostSet(false);
  } finally {
    A.wp.shutdown();
    await new Promise((r) => A.srv.close(r));
  }
});

test('R4: связь не вернулась за время ожидания — каждый к своему', async () => {
  const A = makeHost({ graceMs: 250 });
  await A.listen();
  const addr = '127.0.0.1:' + A.srv.address().port;
  try {
    A.wp.hostSet(true);
    const B = makeClient('B', { graceMs: 250 });
    const r = await B.wp.connect({ addr, code: A.wp.state().host.code });
    assert.equal(r.ok, true, r.error);
    // B «пропал» и не возвращается: имитируем — A не пускает обратно (выключили сервер для всех новых)
    const up = A.wp.upgrade;
    A.srv.removeAllListeners('upgrade');
    A.srv.on('upgrade', (_q, sock) => sock.destroy());
    B.wp._t.drop();
    await until(() => A.log.unlocked === 1, 3000);
    assert.equal(A.wp.state().host.peer, null);
    await until(() => !B.wp.isClient(), 4000);
    assert.equal(B.wp.takeBye().code, 'lost');
    assert.equal(B.log.reload, 2);
    void up;
  } finally {
    A.wp.shutdown();
    await new Promise((r) => A.srv.close(r));
  }
});

test('R4: поиск компьютеров A в сети', async () => {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const A = makeHost({ discPort: () => port });
  await A.listen();
  try {
    const B = makeClient('B', { discPort: () => port });
    assert.deepEqual(await B.wp.discover(300), [], 'A не разрешает управление — молчит');
    A.wp.hostSet(true);
    await wait(50);
    const list = await B.wp.discover(600);
    assert.equal(list.length, 1, JSON.stringify(list));
    assert.equal(list[0].name, 'A');
    assert.ok(list[0].addr.endsWith(':' + A.srv.address().port), list[0].addr);
    assert.equal(list[0].known, false);
    assert.equal(list[0].busy, false);
    // Порт из ответа годится для входа (тестовый сервер слушает только 127.0.0.1, найден — адрес в сети)
    const r = await B.wp.connect({ addr: '127.0.0.1:' + list[0].addr.split(':').pop(), code: A.wp.state().host.code });
    assert.equal(r.ok, true, r.error);
    B.wp.disconnect();
    await until(() => A.log.unlocked === 1);
    const again = await B.wp.discover(600);
    assert.equal(again[0].known, true, 'уже знаком — войдёт без кода');
    assert.equal(again[0].id, B.wp.state().client.known[0].id);
    A.wp.hostSet(false);
    await wait(50);
    assert.deepEqual(await B.wp.discover(300), []);
    assert.ok(B.wp._t.bcastAddrs().includes('127.0.0.1'));
  } finally {
    A.wp.shutdown();
    await new Promise((r) => A.srv.close(r));
  }
});

test('R5: подхват показа — снимок окна A у B, свежий снимок B у A, сверка с экранами', async () => {
  let cur = { slides: { type: 'text', t: 1 }, media: { type: 'image', url: 'file:///x.png' } };
  const snapA = { layers: { slides: { label: 'Песня', content: { type: 'text', t: 1 }, marks: { live: 2 } } }, live: 2, bShown: null, plShown: { key: 'k' } };
  const A = makeHost({ flush: async () => ({ vars: {}, show: snapA }), outCurrent: () => cur });
  await A.listen();
  const addr = '127.0.0.1:' + A.srv.address().port;
  try {
    A.wp.hostSet(true);
    const B = makeClient('B');
    const r = await B.wp.connect({ addr, code: A.wp.state().host.code });
    assert.equal(r.ok, true, r.error);
    // Окно B после перезагрузки: снимок A, дополненный тем, что на экране без подписи
    const s = B.wp.takeShow();
    assert.equal(s.layers.slides.label, 'Песня');
    assert.equal(s.layers.media.label, '');
    assert.deepEqual(s.layers.media.content, cur.media);
    assert.equal(s.live, 2);
    assert.deepEqual(s.plShown, { key: 'k' });
    assert.equal(B.wp.takeShow(), null, 'один раз');
    // Пока B управляет — на A приходят свежие снимки; окно A, вернувшись, продолжает с того же места
    cur = { slides: { type: 'text', t: 9 } };
    B.wp.showPut({ layers: { slides: { label: 'Другая', content: { type: 'text', t: 9 }, marks: { live: 5 } } }, live: 5, bShown: null, plShown: null });
    await wait(50);
    assert.equal(A.wp.takeShow(), null, 'пока управляют — окну A нечего брать');
    B.wp.disconnect();
    await until(() => A.log.unlocked === 1);
    const a = A.wp.takeShow();
    assert.equal(a.layers.slides.label, 'Другая');
    assert.equal(a.live, 5);
    assert.equal(A.wp.takeShow(), null);
    // Снимок разошёлся с экранами (там уже другое) — слой берётся с экрана, подсветка не врёт
    const C = makeClient('C');
    A.wp.hostSet(false); A.wp.hostSet(true);
    const r2 = await C.wp.connect({ addr, code: A.wp.state().host.code });
    assert.equal(r2.ok, true, r2.error);
    cur = { slides: { type: 'text', t: 100 } };
    C.wp.showPut({ layers: { slides: { label: 'Старое', content: { type: 'text', t: 9 }, marks: { live: 7 } } }, live: 7 });
    await wait(50);
    C.wp.disconnect();
    await until(() => A.log.unlocked === 2);
    const b = A.wp.takeShow();
    assert.equal(b.layers.slides.label, '');
    assert.deepEqual(b.layers.slides.content, { type: 'text', t: 100 });
    assert.equal(b.live, -1);
    A.wp.hostSet(false);
  } finally {
    A.wp.shutdown();
    await new Promise((r) => A.srv.close(r));
  }
});

test('R5: смотреть без управления', async () => {
  const A = makeHost({ outReplay: () => [['output:settings', { resW: 0, resH: 0 }], ['output:show', { layer: 'slides', content: { t: 1 } }]] });
  await A.listen();
  const addr = '127.0.0.1:' + A.srv.address().port;
  try {
    A.wp.hostSet(true);
    const got = { open: null, ev: [], closed: 0 };
    const B = makeClient('B', { watchOpen: (x) => { got.open = x; }, watchSend: (ch, d) => got.ev.push([ch, d]), watchClose: () => { got.closed++; } });
    const r = await B.wp.connect({ addr, code: A.wp.state().host.code, watch: true });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.watch, true);
    assert.equal(got.open.name, 'A');
    assert.deepEqual(got.open.replay.map((x) => x[0]), ['output:settings', 'output:show'], 'сразу — что на экране');
    assert.equal(B.wp.isClient(), false, 'окно B своё');
    assert.equal(B.log.reload, 0);
    assert.equal(A.log.flushed, 0, 'окно A не трогали');
    assert.equal(A.log.locked, '');
    assert.equal(A.wp.state().host.watchers.length, 1);
    assert.equal(A.wp.state().host.peer, null);
    // Окнам вывода A — и зрителю; чужое — нет
    A.wp.watchEvent('output:show', { layer: 'slides', content: { t: 2 } });
    A.wp.watchEvent('wp:notice', { text: 'нет' });
    A.wp.watchEvent('output:clear', { layer: 'slides' });
    await until(() => got.ev.length === 2);
    await wait(30);
    assert.deepEqual(got.ev.map((x) => x[0]), ['output:show', 'output:clear']);
    // Пока смотрят — управлять может другой (по коду), зритель остаётся
    const C = makeClient('C');
    const rc = await C.wp.connect({ addr, code: A.wp.state().host.code });
    assert.equal(rc.ok, true, rc.error);
    assert.equal(A.wp.state().host.watchers.length, 1);
    C.wp.disconnect();
    await until(() => A.log.unlocked === 1);
    // Второй раз — без кода; «Не смотреть» — окно закрыто, A забыл зрителя
    B.wp.watchStop();
    assert.equal(got.closed, 1);
    await until(() => A.wp.state().host.watchers.length === 0);
    const r2 = await B.wp.connect({ addr, watch: true });
    assert.equal(r2.ok, true, r2.error);
    // A выключил управление — зритель узнаёт, окно закрывается
    A.wp.hostSet(false);
    await until(() => got.closed === 2);
    assert.ok(B.log.ev.some(([ch, d]) => ch === 'wp:notice' && /выключили/.test(d.text)));
    assert.equal(B.wp.state().client.watching, null);
  } finally {
    A.wp.shutdown();
    await new Promise((r) => A.srv.close(r));
  }
});
