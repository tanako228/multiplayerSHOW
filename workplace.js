/* ---------- Удалённый режим: «рабочее место» B управляет компьютером A по локальной сети (этап R1) ----------
   Проект — ТЗ-Облако-и-удалённый-режим.md, часть 2. Окно программы разговаривает с главным процессом только через
   ipcMain.handle/on (preload.js). Этот модуль подменяет «трубу» в ГЛАВНОМ процессе:
   - B (клиент): обращения окна к своим обработчикам уходят по WebSocket на A, ответ возвращается окну как обычно.
     Окно B при этом — та же программа; данные (библиотека, настройки окна) — с A, снимком при подключении.
   - A (хост): вызывает свои настоящие обработчики, будто их вызвало его окно оператора; всё, что главный процесс A
     шлёт окну оператора (события), пересылается B. Окно оператора A на это время — плашка «Управляет компьютер B»
     (wplock.html): два живых окна оператора разошлись бы. B ушёл или «Забрать управление» — окно A грузится с диска.
   Связь — тот же http-сервер, что для пульта и телефонов (main.js: rmStart, порт 8090…), путь /wp. Вход — код из
   6 цифр, который показывает A. Первый кадр — JSON (hello), дальше — двоичные кадры v8.serialize (как IPC Electron:
   Buffer, массивы байт, Date). Модуль не требует Electron: всё нужное отдаёт main.js через setup() — так его можно
   проверить в Node (test/workplace.test.js). */
'use strict';
const v8 = require('v8');
const os = require('os');
const crypto = require('crypto');
const wpfiles = require('./wpfiles'); // файлы A для окна B (этап R2)

const PATH = '/wp';
const DEF_PORT = 8090;
const DISC_PORT = 8099;     // R4: поиск компьютеров A в сети (UDP, широковещательно)
const PING_MS = 5000;
const DEAD_MS = 16000;
const GRACE_MS = 180000;    // R4: связь оборвалась — столько A держит сеанс, а B переподключается сам
const TRUST_MAX = 20;       // запомненных компьютеров B на A
const WATCH_MAX = 8;        // R5: зрителей одновременно
// R5: что зритель получает — то же, что окна вывода A (стоп-кадр — нет: его снимает само окно вывода)
const WATCH_CH = new Set(['output:show', 'output:clear', 'output:layers', 'output:video', 'output:ink', 'output:view', 'output:settings', 'screen:config', 'screen:stage']);
const grace = () => (o.graceMs || GRACE_MS);
const HEAVY = new Set(['ndi:video', 'ndi:audio', 'team:castFrame']); // поток кадров: при забитой сети — пропускать
const HEAVY_MAX = 8 * 1024 * 1024;

// Каналы, которые B всегда выполняет у себя: своё окно и программа (закрыть, версия, обновление, буфер обмена),
// снимок своего окна, редактор (окно редактора открывается на B), сам удалённый режим
const LOCAL = new Set(['app:close-ok', 'app:version', 'clip:get', 'clip:set', 'output:freezePrev',
  'editor:open', 'editor:save', 'editor:themes']);
const isLocal = (ch) => LOCAL.has(ch) || ch.startsWith('update:') || ch.startsWith('wp:') || ch.startsWith('perf:'); // perf: — железо и режим своего ПК
// Нельзя с B: смена профиля и восстановление (перезаписывают данные A и перезагружают окно), облако,
// окна Проводника на A (их никто не видит), выбор папки репозитория
const BLOCK = new Set(['profile:do', 'cloud:sync', 'cloud:signin', 'cloud:signout', 'cloud:client', 'cloud:pickDir',
  'repo:restore', 'backup:restore', 'repo:pick', 'repo:open', 'data:open', 'file:reveal', 'repo:reveal']);
const BLOCK_MSG = 'Недоступно при управлении другим компьютером';
// ipcMain.on, которые B передаёт на A (остальные — свои: копия настроек, язык, перетаскивание, фокус)
const FWD_ON = new Set(['ndi:close', 'ndi:ack']);
// События главного процесса A, которые B не нужны: свой вопрос о закрытии и обновление — у каждой программы свои
const NO_FWD = new Set(['app:ask-close', 'update:state']);
// Свои события B, которые доходят до окна B и в режиме клиента (остальное — от A)
const CLIENT_OWN = new Set(['app:ask-close', 'update:state', 'editor:saved', 'wp:state', 'wp:notice', 'wp:flush']);

const handlers = new Map(); // канал → настоящий обработчик (ipcMain.handle)
const onFns = new Map();    // канал → обработчики ipcMain.on из FWD_ON
let o = {};                 // из main.js (setup)

const enc = (m) => v8.serialize(m);
const dec = (b) => v8.deserialize(Buffer.isBuffer(b) ? b : Buffer.from(b));
const say = (ws, m) => { try { if (ws && ws.readyState === 1) ws.send(enc(m)); } catch { /* закрылся */ } };
const sayJson = (ws, m) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); } catch { /* закрылся */ } };
const errText = (e) => String((e && e.message) || e || 'Ошибка').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const eqHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Сохранённое (main.js: workplace.json): разрешено ли управление, адрес, id этого компьютера, ключи
let mem = {};
const saveP = (patch) => { mem = { ...mem, ...patch }; if (o.save) o.save(patch); };
const myName = () => (o.name ? o.name() : os.hostname());
// Своё имя компьютера (main.js: devName читает его из workplace.json). Пусто — имя Windows
function setName(n) {
  const v = String(n == null ? '' : n).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  saveP({ name: v });
  notify();
  return state();
}
function myId() { if (!mem.id) saveP({ id: crypto.randomBytes(8).toString('hex') }); return mem.id; }
// A: запомненные компьютеры B — { id, name, hash (sha256 ключа), at, last }
const trusted = () => (Array.isArray(mem.trusted) ? mem.trusted : []);
// B: ключи для входа без кода — { [id A]: { key, name, addr } }
const keys = () => (mem.keys && typeof mem.keys === 'object' ? mem.keys : {});

/* ----- Подмена ipcMain: до регистрации первого обработчика (main.js, в самом начале) ----- */
function hook(ipcMain) {
  if (ipcMain.__wp) return;
  ipcMain.__wp = true;
  const handle0 = ipcMain.handle.bind(ipcMain);
  const remove0 = ipcMain.removeHandler.bind(ipcMain);
  const on0 = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (ch, fn) => {
    handlers.set(ch, fn);
    return handle0(ch, (e, ...a) => {
      if (cli.on && !isLocal(ch) && !(o.switching && o.switching())) {
        if (BLOCK.has(ch)) throw new Error(BLOCK_MSG);
        return cli.call(ch, a);
      }
      return fn(e, ...a);
    });
  };
  ipcMain.removeHandler = (ch) => { handlers.delete(ch); return remove0(ch); };
  ipcMain.on = (ch, fn) => {
    if (!FWD_ON.has(ch)) return on0(ch, fn);
    onFns.set(ch, fn);
    return on0(ch, (e, ...a) => { if (cli.on) cli.fire(ch, a); else fn(e, ...a); });
  };
}

/* ======================= Хост A ======================= */
const host = {
  on: false,       // «Разрешить управление с других компьютеров»
  code: '',        // код для входа (6 цифр), новый при каждом включении
  wss: null,
  peer: null,      // { ws, name, ip, at, ready, alive }
  wrong: 0,        // неверных кодов подряд
  lockUntil: 0,    // после 5 неверных — пауза
  taking: false,   // идёт перехват: сохранение и плашка
  locked: false,   // окно оператора A уже плашка (переподключение B не сохраняет и не грузит его заново)
  vars: null,      // цвета темы окна A — для плашки
  ended: new Map(),// сеанс → { code, text }: B, вернувшийся после обрыва, узнаёт, чем кончилось
  udp: null,       // ответчик поиска в сети (R4)
  watchers: new Set(), // R5: смотрят без управления
  show: null,      // R5: что на экране (снимок окна оператора) — окну, которое продолжит показ
};
const newCode = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');

function hostSet(on) {
  on = !!on;
  if (on === host.on || (on && cli.on)) return state(); // этот компьютер сам управляет другим — его не пускаем
  host.on = on;
  host.code = on ? newCode() : '';
  host.wrong = 0;
  if (!on && host.peer) hostDrop('off', 'На компьютере A выключили управление с других компьютеров');
  if (!on) watchersDrop('off', 'На компьютере A выключили управление с других компьютеров');
  saveP({ host: on });
  discSet(on);
  if (o.want) o.want();
  notify();
  return state();
}

/* ----- R4: поиск в сети. A отвечает на широковещательный UDP-запрос именем и портом; B собирает ответы ----- */
const discPort = () => (o.discPort ? o.discPort() : DISC_PORT);
function discSet(on) {
  if (on && !host.udp) {
    let s;
    try { s = require('dgram').createSocket({ type: 'udp4', reuseAddr: true }); } catch { return; }
    host.udp = s;
    s.on('error', () => { try { s.close(); } catch { /* уже */ } if (host.udp === s) host.udp = null; });
    s.on('message', (buf, r) => {
      if (buf.length > 256) return;
      let m = null;
      try { m = JSON.parse(String(buf)); } catch { return; }
      const port = o.port ? o.port() : 0;
      if (!m || m.t !== 'mpswp?' || m.v !== 1 || !port || !host.on) return;
      const rep = Buffer.from(JSON.stringify({ t: 'mpswp', v: 1, id: myId(), name: myName(), port, busy: !!(host.peer && !host.peer.lost) }));
      try { s.send(rep, r.port, r.address); } catch { /* закрыт */ }
    });
    try { s.bind(discPort()); } catch { host.udp = null; }
  } else if (!on && host.udp) {
    try { host.udp.close(); } catch { /* уже */ }
    host.udp = null;
  }
}
// Куда кричать: всем в каждой своей сети IPv4 и себе (A и B на одном компьютере)
function bcastAddrs() {
  const out = new Set(['255.255.255.255', '127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== 'IPv4' && n.family !== 4) continue;
      if (n.internal) continue;
      const a = n.address.split('.').map(Number);
      const k = String(n.netmask || '255.255.255.0').split('.').map(Number);
      if (a.length === 4 && k.length === 4) out.add(a.map((x, i) => (x | (~k[i] & 255)) & 255).join('.'));
    }
  }
  return [...out];
}
function discover(ms = 1500) {
  return new Promise((done) => {
    const found = new Map();
    let s;
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      try { s.close(); } catch { /* уже */ }
      const k = keys();
      done([...found.values()].map((f) => ({ ...f, known: !!k[f.id] })).sort((a, b) => a.name.localeCompare(b.name)));
    };
    try { s = require('dgram').createSocket({ type: 'udp4', reuseAddr: true }); } catch { done([]); return; }
    s.on('error', end);
    s.on('message', (buf, r) => {
      let m = null;
      try { m = JSON.parse(String(buf)); } catch { return; }
      if (!m || m.t !== 'mpswp' || m.v !== 1 || typeof m.id !== 'string' || !/^[0-9a-f]{4,32}$/.test(m.id) || m.id === mem.id) return;
      const port = Number(m.port) > 0 && Number(m.port) < 65536 ? Number(m.port) : DEF_PORT;
      const prev = found.get(m.id);
      if (prev && !prev.addr.startsWith('127.') && r.address.startsWith('127.')) return; // адрес в сети лучше, чем «сам себе»
      found.set(m.id, { id: m.id, name: String(m.name || r.address).slice(0, 60), addr: r.address + ':' + port, busy: !!m.busy });
    });
    s.bind(0, () => {
      try { s.setBroadcast(true); } catch { /* нет — хотя бы себе */ }
      const msg = Buffer.from(JSON.stringify({ t: 'mpswp?', v: 1 }));
      for (const ip of bcastAddrs()) try { s.send(msg, discPort(), ip, () => {}); } catch { /* эта сеть недоступна */ }
      setTimeout(end, ms);
    });
  });
}

// A: «Забыть» запомненный компьютер — дальше только по коду
function hostForget(id) {
  saveP({ trusted: trusted().filter((t) => t.id !== id) });
  notify();
  return state();
}

// http-сервер пульта (main.js: rmSrv 'upgrade'): наш ли путь
function upgrade(req, sock, head) {
  const p = String(req.url || '').split('?')[0];
  if (p !== PATH) return false;
  // Браузер всегда шлёт Origin — значит, это страница, а не программа: чужой сайт в сети не подключится
  if (!host.on || req.headers.origin) { sock.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return true; }
  if (!host.wss) {
    const { WebSocketServer } = require('ws');
    host.wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 * 1024, perMessageDeflate: { threshold: 4096, zlibDeflateOptions: { level: 3 }, concurrencyLimit: 4 } });
  }
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  host.wss.handleUpgrade(req, sock, head, (ws) => hostAttach(ws, ip));
  return true;
}

function hostAttach(ws, ip) {
  let me = null; // этот ws стал peer
  const t = setTimeout(() => { if (!me) try { ws.close(4001, 'hello'); } catch { /* уже */ } }, 10000);
  ws.on('message', (buf, bin) => {
    if (!me) {
      if (bin) { try { ws.close(4001, 'hello'); } catch { /* уже */ } return; }
      let m = null;
      try { m = JSON.parse(String(buf)); } catch { m = null; }
      me = hostHello(ws, ip, m);
      if (me) clearTimeout(t);
      return;
    }
    if (me.watch) { let m = null; try { m = bin ? dec(buf) : null; } catch { /* мусор */ } if (m && m.t === 'bye') try { ws.close(1000, 'bye'); } catch { /* уже */ } return; }
    if (!bin || host.peer !== me || me.ws !== ws || !me.ready) return;
    let m = null;
    try { m = dec(buf); } catch { return; }
    if (m && typeof m === 'object') hostMsg(me, m);
  });
  ws.on('pong', () => { if (me && me.ws === ws) me.alive = Date.now(); });
  ws.on('close', () => {
    clearTimeout(t);
    if (me && me.watch) { clearInterval(me.timer); if (host.watchers.delete(me)) notify(); return; }
    if (!me || host.peer !== me || me.ws !== ws) return; // этот сеанс уже продолжен другим соединением
    clearInterval(me.timer);
    dialogsCancel();
    if (!me.bye && me.ready && me.keyHash) { hostLost(me); return; } // R4: ждём, что B вернётся
    host.peer = null;
    hostUnlock(me.bye ? '' : 'Связь с компьютером «' + me.name + '» прервалась');
  });
  ws.on('error', () => { /* close придёт */ });
}

function hostWrong(ip, what) {
  if (++host.wrong >= 5) { host.wrong = 0; host.code = newCode(); host.lockUntil = Date.now() + 30000; notify(); }
  if (o.log) o.log('Удалённое управление: ' + what + ' с ' + ip);
}

function hostHello(ws, ip, m) {
  const bye = (code, text) => { sayJson(ws, { t: 'bye', code, text }); try { ws.close(4001, code); } catch { /* уже */ } return null; };
  if (!m || m.t !== 'hello' || m.v !== 1) return bye('proto', 'Другая версия программы — обновите обе');
  if (!host.on) return bye('off', 'На этом компьютере не включено управление с других компьютеров');
  if (Date.now() < host.lockUntil) return bye('wait', 'Слишком много неверных кодов — подождите полминуты');
  const name = String(m.name || ip).slice(0, 60);
  const p = host.peer;
  const key = typeof m.key === 'string' && /^[0-9a-f]{64}$/.test(m.key) ? m.key : '';
  // R4: B вернулся после обрыва — тот же сеанс, окно A не трогаем
  if (m.resume) {
    const sid = String(m.resume);
    if (p && p.ready && p.sid === sid && key && eqHex(sha(key), p.keyHash)) return hostResume(p, ws, ip);
    const end = host.ended.get(sid);
    return bye(end ? end.code : 'gone', end ? end.text : 'Сеанс управления закончился');
  }
  // Вход: ключ запомненного компьютера или код с экрана A
  let hash = '';
  let byCode = false;
  if (key) {
    hash = sha(key);
    if (!trusted().some((t) => eqHex(t.hash, hash))) { hostWrong(ip, 'неизвестный ключ'); return bye('key', 'Компьютер A вас больше не помнит — введите код'); }
  } else {
    const code = String(m.code || '').replace(/\D/g, '');
    if (!host.code || code.length !== 6 || !crypto.timingSafeEqual(Buffer.from(code), Buffer.from(host.code))) { hostWrong(ip, 'неверный код'); return bye('code', 'Неверный код'); }
    byCode = true;
  }
  // R5: «Смотреть без управления» — окно A не трогаем, зрителей может быть несколько
  if (m.watch) {
    if (host.watchers.size >= WATCH_MAX) return bye('busy', 'Смотрят уже с ' + WATCH_MAX + ' компьютеров');
    host.wrong = 0;
    const t = hostTrust(byCode, hash, name, ip);
    return hostWatch(ws, ip, name, t.fresh);
  }
  // Занято. Но сеанс, потерявший связь, уступает: тот же компьютер B (перезапустили программу) или новый вход по коду
  if (host.taking || (p && !(p.keyHash && eqHex(p.keyHash, hash)) && !(p.lost && byCode))) return bye('busy', 'Компьютером уже управляют с другого места');
  host.wrong = 0;
  if (p) hostForgetPeer(p, 'replaced', 'Управление перешло к новому подключению');
  const t = hostTrust(byCode, hash, name, ip);
  hash = t.hash;
  const fresh = t.fresh;
  const peer = { ws, name, ip, at: Date.now(), ready: false, alive: Date.now(), bye: false, lost: 0, keyHash: hash, sid: crypto.randomBytes(12).toString('hex'), fkey: crypto.randomBytes(16).toString('hex') };
  host.peer = peer;
  if (o.log) o.log('Удалённое управление: подключился «' + peer.name + '» (' + ip + ')' + (byCode ? '' : ' по ключу'));
  hostTake(peer, fresh);
  return peer;
}

// Вошёл по коду — выдать ключ и запомнить компьютер; по ключу — отметить, когда был
function hostTrust(byCode, hash, name, ip) {
  if (!byCode) {
    saveP({ trusted: trusted().map((t) => (eqHex(t.hash, hash) ? { ...t, name, ip, last: Date.now() } : t)) });
    return { hash, fresh: '' };
  }
  host.code = newCode(); // код одноразовый: следующему — новый
  const fresh = crypto.randomBytes(32).toString('hex');
  const h = sha(fresh);
  const list = trusted().filter((t) => t.name !== name || t.ip !== ip); // тот же компьютер с прошлым ключом — заменить
  list.push({ id: crypto.randomBytes(6).toString('hex'), name, ip, hash: h, at: Date.now(), last: Date.now() });
  saveP({ trusted: list.slice(-TRUST_MAX) });
  return { hash: h, fresh };
}

/* ----- R5: зритель — видит экран A в своём окне (то же, что идёт окнам вывода A), ничем не управляет ----- */
function hostWatch(ws, ip, name, key) {
  const w = { watch: true, ws, name, ip, at: Date.now(), alive: Date.now(), fkey: crypto.randomBytes(16).toString('hex') };
  host.watchers.add(w);
  hostPing(w);
  say(ws, { t: 'welcome', watch: true, name: myName(), id: myId(), key: key || undefined, fkey: w.fkey, replay: o.outReplay ? o.outReplay() : [] });
  if (o.log) o.log('Удалённое управление: смотрит «' + name + '» (' + ip + ')');
  notify();
  return w;
}
// Окнам вывода A ушло событие (main.js: toOutputs) — и зрителям. Поток кадров при забитой сети пропускаем
function watchEvent(ch, d) {
  if (!host.watchers.size || !WATCH_CH.has(ch)) return;
  let buf = null;
  for (const w of host.watchers) {
    if (!w.ws || w.ws.readyState !== 1 || (ch === 'output:video' && w.ws.bufferedAmount > HEAVY_MAX)) continue;
    try { buf = buf || enc({ t: 'ev', ch, d }); w.ws.send(buf); } catch { /* не клонируется — пропускаем */ }
  }
}
function watchersDrop(code, text) {
  for (const w of host.watchers) { say(w.ws, { t: 'bye', code, text }); clearInterval(w.timer); setTimeout(() => { try { w.ws.close(1000, code); } catch { /* уже */ } }, 100); }
  host.watchers.clear();
}

function hostPing(peer) {
  clearInterval(peer.timer);
  peer.timer = setInterval(() => {
    if (Date.now() - peer.alive > DEAD_MS) { try { peer.ws.terminate(); } catch { /* уже */ } return; }
    try { peer.ws.ping(); } catch { /* закрылся */ }
  }, PING_MS);
}

// Связь с B пропала: экраны показывают своё, плашка остаётся; grace() ждём, потом окно A — снова своё
function hostLost(p) {
  p.lost = Date.now();
  if (o.log) o.log('Удалённое управление: связь с «' + p.name + '» прервалась — жду переподключения');
  clearTimeout(p.graceT);
  p.graceT = setTimeout(() => {
    if (host.peer !== p || !p.lost) return;
    host.peer = null;
    hostEnded(p, 'lost', 'Связь с компьютером A прервалась');
    hostUnlock('Связь с компьютером «' + p.name + '» прервалась');
  }, grace());
  notify();
}
function hostResume(p, ws, ip) {
  const old = p.ws;
  p.ws = ws;
  p.ip = ip;
  p.lost = 0;
  p.alive = Date.now();
  clearTimeout(p.graceT);
  if (old && old !== ws) try { old.terminate(); } catch { /* уже */ } // полуоткрытое старое соединение
  hostPing(p);
  say(ws, { t: 'welcome', resume: true, sid: p.sid, id: myId(), name: myName() });
  if (o.log) o.log('Удалённое управление: «' + p.name + '» снова на связи');
  notify();
  return p;
}
// Сеанс кончился: запомнить чем (B после обрыва узнает), старое соединение закрыть, окно A не трогать
function hostEnded(p, code, text) {
  if (!p.sid) return;
  host.ended.set(p.sid, { code, text });
  while (host.ended.size > 20) host.ended.delete(host.ended.keys().next().value);
}
function hostForgetPeer(p, code, text) {
  p.bye = true;
  clearInterval(p.timer);
  clearTimeout(p.graceT);
  dialogsCancel();
  hostEnded(p, code, text);
  host.peer = null;
  say(p.ws, { t: 'bye', code, text });
  setTimeout(() => { try { p.ws.terminate(); } catch { /* уже */ } }, 100);
}

// Перехват: окно A сохраняет всё → плашка вместо окна → B получает снимок настроек и начинает работать.
// Окно A уже плашка (прежний B потерял связь и пришёл заново) — сохранять и грузить нечего
async function hostTake(peer, key) {
  host.taking = true;
  notify();
  try {
    if (!host.locked) {
      host.vars = null;
      if (o.flush) { const r = await o.flush(); if (r && r.vars) host.vars = r.vars; if (r && r.show) host.show = r.show; }
      if (host.peer !== peer) return;
      if (o.lock) await o.lock(peer.name);
      if (host.peer !== peer) return;
      host.locked = true;
    }
    const ls = o.lsRead ? o.lsRead() : null;
    peer.ready = true;
    hostPing(peer);
    say(peer.ws, { t: 'welcome', name: myName(), id: myId(), sid: peer.sid, key: key || undefined, ls, show: showFix(host.show), profile: o.profile ? o.profile() : '', fkey: peer.fkey, upDir: o.upDir ? o.upDir() : '' });
  } catch (e) {
    if (o.log) o.log('Удалённое управление: перехват не удался: ' + errText(e));
    hostDrop('fail', 'Не получилось передать управление: ' + errText(e));
  } finally {
    host.taking = false;
    notify();
  }
}

/* ----- R5: подхват показа. Окно оператора держит в памяти, что на экране (слои с подписями, подсветка в списках).
   При перехвате окно A отдаёт снимок (wp:flush → wpFlushed), B восстанавливает его после перезагрузки; пока B
   управляет, он присылает свежий снимок при каждой смене (t:'show'), и окно A, вернувшись, продолжает с того же места.
   Снимок сверяется с тем, что на экранах на самом деле (main.js: current): чего там нет — выбрасывается,
   что там есть, а в снимке нет, — берётся без подписи */
const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
function showFix(s) {
  const cur = o.outCurrent ? o.outCurrent() : null;
  if (!cur) return s && s.layers ? s : null;
  const src = s && s.layers && typeof s.layers === 'object' ? s.layers : {};
  const layers = {};
  let lostMarks = false;
  for (const [id, content] of Object.entries(cur)) {
    const x = src[id];
    layers[id] = x && same(x.content, content) ? x : { label: '', content, marks: null };
  }
  for (const [id, x] of Object.entries(src)) if (!layers[id] || layers[id] !== x) { if (x && x.marks && Object.keys(x.marks).length) lostMarks = true; }
  const out = { layers, live: -1, bShown: null, plShown: null, at: s && s.at ? s.at : Date.now() };
  if (s && !lostMarks) { out.live = typeof s.live === 'number' ? s.live : -1; out.bShown = s.bShown || null; out.plShown = s.plShown || null; }
  return out;
}
// Окно оператора загрузилось (main.js: wp:show): B — снимок от A; A — после возврата управления. Один раз
function takeShow() {
  if (cli.on) { const s = cli.show; cli.show = null; return s || null; }
  if (host.peer) return null;
  const s = host.show;
  host.show = null;
  return s ? showFix(s) : null;
}
// B: показ сменился — свежий снимок на A (renderer.js: liveSnap)
const showPut = (s) => { if (cli.on && !cli.lost && s && typeof s === 'object') say(cli.ws, { t: 'show', data: s }); };

/* ----- R3: окно выбора файлов на A, пока управляет B, — окно обзора на B (wpbrowse.js) -----
   main.js оборачивает dialog.showOpenDialog/showSaveDialog/showMessageBox: при управлении с B — сюда. Ответ B
   приходит в том же виде, что у Electron; связь оборвалась — «отмена» */
const dlg = new Map(); // id → { ok, kind, opts }
let dlgSeq = 0;
const cancelRes = (kind, opts) => (kind === 'showMessageBox' ? { response: opts && opts.cancelId != null ? opts.cancelId : 0, checkboxChecked: false } : kind === 'showSaveDialog' ? { canceled: true, filePath: '' } : { canceled: true, filePaths: [] });
const plain = (o) => { try { return JSON.parse(JSON.stringify(o || {})); } catch { return {}; } };
function remoteDialog(kind, opts) {
  const p = host.peer;
  if (!p || !p.ready || p.lost) return Promise.resolve(cancelRes(kind, opts));
  const id = ++dlgSeq;
  return new Promise((ok) => {
    dlg.set(id, { ok, kind, opts });
    say(p.ws, { t: 'dlg', id, kind, opts: plain(opts) });
  });
}
function dialogsCancel() { for (const [id, d] of dlg) { dlg.delete(id); d.ok(cancelRes(d.kind, d.opts)); } }
// Ответ B — только то, что положено ответу этого окна
function dialogRes(m) {
  const d = dlg.get(m.id);
  if (!d) return;
  dlg.delete(m.id);
  const r = m.res && typeof m.res === 'object' ? m.res : {};
  const abs = (x) => typeof x === 'string' && x.length < 4096 && require('path').isAbsolute(x);
  if (d.kind === 'showMessageBox') { const n = Number(r.response); d.ok({ response: Number.isInteger(n) && n >= 0 ? n : cancelRes(d.kind, d.opts).response, checkboxChecked: !!r.checkboxChecked }); return; }
  if (r.canceled) { d.ok(cancelRes(d.kind, d.opts)); return; }
  if (d.kind === 'showSaveDialog') { d.ok(abs(r.filePath) ? { canceled: false, filePath: r.filePath } : cancelRes(d.kind, d.opts)); return; }
  const list = Array.isArray(r.filePaths) ? r.filePaths.filter(abs).slice(0, 5000) : [];
  d.ok(list.length ? { canceled: false, filePaths: list } : cancelRes(d.kind, d.opts));
}

function hostMsg(peer, m) {
  if (m.t === 'dlgres') { dialogRes(m); return; }
  if (m.t === 'call') {
    const i = m.i;
    const ch = String(m.ch || '');
    const fn = handlers.get(ch);
    if (!fn || isLocal(ch) || BLOCK.has(ch)) { say(peer.ws, { t: 'res', i, err: fn ? BLOCK_MSG : 'Нет такого действия: ' + ch }); return; }
    const ev = o.event ? o.event() : { sender: null };
    Promise.resolve().then(() => fn(ev, ...(Array.isArray(m.a) ? m.a : []))).then(
      (v) => { try { peer.ws.readyState === 1 && peer.ws.send(enc({ t: 'res', i, v })); } catch (e) { say(peer.ws, { t: 'res', i, err: 'Ответ не передаётся: ' + errText(e) }); } },
      (e) => say(peer.ws, { t: 'res', i, err: errText(e) }),
    );
    return;
  }
  if (m.t === 'on') {
    const fn = onFns.get(String(m.ch || ''));
    if (fn) try { fn(o.event ? o.event() : { sender: null }, ...(Array.isArray(m.a) ? m.a : [])); } catch { /* не страшно */ }
    return;
  }
  if (m.t === 'ls') { if (o.lsWrite && m.data && typeof m.data === 'object') o.lsWrite(m.data); return; }
  if (m.t === 'show') { if (m.data && typeof m.data === 'object' && m.data.layers && typeof m.data.layers === 'object') host.show = m.data; return; }
  if (m.t === 'bye') { peer.bye = true; try { peer.ws.close(1000, 'bye'); } catch { /* уже */ } }
}

// Событие главного процесса окну оператора A (main.js: control.webContents.send) — и B
function hostEvent(ch, d) {
  const p = host.peer;
  if (!p || !p.ready || p.lost || NO_FWD.has(ch) || (ch.startsWith('wp:') && ch !== 'wp:notice')) return;
  if (HEAVY.has(ch) && p.ws.bufferedAmount > HEAVY_MAX) return;
  try { p.ws.send(enc({ t: 'ev', ch, d })); } catch { /* не передаётся (не клонируется) — пропускаем */ }
}

// Отключить B: сказать почему, закрыть; окно A — снова с диска
function hostDrop(code, text) {
  const p = host.peer;
  if (!p) return;
  p.bye = true;
  clearInterval(p.timer);
  clearTimeout(p.graceT);
  dialogsCancel();
  hostEnded(p, code, text);
  host.peer = null;
  say(p.ws, { t: 'bye', code, text });
  setTimeout(() => { try { p.ws.close(1000, code); } catch { /* уже */ } }, 100);
  hostUnlock('');
}
function hostUnlock(why) {
  if (why && o.log) o.log('Удалённое управление: ' + why);
  host.locked = false;
  if (o.unlock) o.unlock(why);
  notify();
}
const hostTakeBack = () => { hostDrop('taken', 'На компьютере A забрали управление'); return state(); };

/* ======================= Клиент B ======================= */
const cli = {
  on: false,        // окно B работает с данными A
  ws: null,
  addr: '',
  name: '',         // имя компьютера A
  id: '',           // id компьютера A (поиск в сети, ключ)
  sid: '',          // сеанс на A — для переподключения
  key: '',          // ключ этого компьютера на A — вход без кода
  ls: null,         // снимок настроек окна A (preload.js: ls:restore)
  show: null,       // R5: что на экранах A — окну B после перезагрузки
  profile: '',
  seq: 0,
  wait: new Map(),  // i → { ok, fail }
  connecting: null, // Promise подключения
  bye: null,        // { code, text, at } — почему прервалось (окно покажет после перезагрузки)
  alive: 0,
  timer: 0,
  lost: 0,          // R4: когда пропала связь (0 — на связи)
  back: [],         // вызовы, ждущие переподключения
  retry: 0,
  fails: 0,
  relogin: false,   // A не знает прежний сеанс (перезапускалась) — войти заново по ключу
  ups: new Map(), // путь на A → Promise загрузки перетащенного файла (R3)
  async call(ch, a) {
    // В аргументах — перетащенный файл, который ещё едет на A: ждём его (иначе A не найдёт такого пути)
    if (cli.ups.size) {
      const s = JSON.stringify(a);
      const w = [...cli.ups].filter(([ap]) => s.includes(JSON.stringify(ap).slice(1, -1))).map(([, pr]) => pr);
      if (w.length) await Promise.all(w);
    }
    // Связь пропала — ждём переподключения (или отказа, если не вернулась)
    if (cli.lost) await new Promise((ok, fail) => cli.back.push({ ok, fail }));
    const ws = cli.ws;
    if (!ws || ws.readyState !== 1) throw new Error('Нет связи с компьютером A');
    const i = ++cli.seq;
    return new Promise((ok, fail) => {
      cli.wait.set(i, { ok, fail });
      try { ws.send(enc({ t: 'call', i, ch, a })); } catch (e) { cli.wait.delete(i); fail(new Error('Не передаётся: ' + errText(e))); }
    });
  },
  fire(ch, a) { say(cli.ws, { t: 'on', ch, a }); },
};

const normAddr = (s) => {
  let a = String(s || '').trim().replace(/^(wss?|https?):\/\//i, '').replace(/\/.*$/, '');
  if (!a) return '';
  if (!/:\d+$/.test(a) && !/^\[.*\]$/.test(a)) a += ':' + DEF_PORT;
  return a;
};

// Соединение с A: первый кадр — hello (JSON), дальше — по обработчикам
function cliOpen(a, hello, h) {
  const WebSocket = require('ws');
  const ws = new WebSocket('ws://' + a + PATH, { handshakeTimeout: 8000, maxPayload: 512 * 1024 * 1024, perMessageDeflate: true });
  ws.on('open', () => sayJson(ws, hello));
  ws.on('message', (buf, bin) => {
    let m = null;
    try { m = bin ? dec(buf) : JSON.parse(String(buf)); } catch { return; }
    if (m && typeof m === 'object') h.msg(ws, m, bin);
  });
  ws.on('pong', () => { if (cli.ws === ws) cli.alive = Date.now(); });
  ws.on('ping', () => { if (cli.ws === ws) cli.alive = Date.now(); });
  ws.on('close', () => h.close(ws));
  ws.on('error', (e) => { if (h.error) h.error(ws, e); });
  return ws;
}
const helloOf = (extra) => ({ t: 'hello', v: 1, name: myName(), ...extra });

function cliPing(ws) {
  clearInterval(cli.timer);
  cli.alive = Date.now();
  cli.timer = setInterval(() => {
    if (Date.now() - cli.alive > DEAD_MS) { try { ws.terminate(); } catch { /* уже */ } return; }
    try { ws.ping(); } catch { /* закрылся */ }
  }, PING_MS);
}
// Ключ для входа без кода — запомнить (с именем и адресом A: по ним B найдёт его в списке)
function keySave(id, patch) {
  if (!id) return;
  const k = { ...keys() };
  const cur = k[id] || {};
  if (!patch.key && !cur.key) return;
  k[id] = { ...cur, ...patch };
  saveP({ keys: k });
}
function keyDrop(id) { const k = { ...keys() }; delete k[id]; saveP({ keys: k }); }

// A принял: новый сеанс. Окно B перезагружается с данными A
function cliWelcome(ws, m, a) {
  for (const b of cli.back.splice(0)) b.fail(new Error('Связь с компьютером A прервалась'));
  cli.ws = ws; cli.addr = a; cli.name = String(m.name || a); cli.ls = m.ls || null; cli.profile = String(m.profile || ''); cli.show = m.show && typeof m.show === 'object' ? m.show : null;
  cli.fkey = /^[0-9a-f]{32}$/.test(m.fkey) ? m.fkey : ''; cli.upDir = String(m.upDir || ''); cli.ups.clear();
  cli.id = typeof m.id === 'string' ? m.id : ''; cli.sid = typeof m.sid === 'string' ? m.sid : '';
  if (typeof m.key === 'string' && /^[0-9a-f]{64}$/.test(m.key)) cli.key = m.key;
  keySave(cli.id, { key: cli.key, name: cli.name, addr: a });
  cli.on = true; cli.bye = null; cli.lost = 0; cli.relogin = false; cli.fails = 0;
  cliPing(ws);
  saveP({ addr: a });
  if (o.log) o.log('Удалённое управление: управляем компьютером «' + cli.name + '» (' + a + ')');
  notify();
  if (o.fileProto) o.fileProto(true); // file:// окна B — с компьютера A
  if (o.reload) o.reload(); // окно B — с данными A
}

// «Подключиться»: адрес A и код (или ключ, если этот компьютер A уже пускал нас). Ответ — когда A передал
// управление (окно B уже перезагружается) или ошибка
function connect({ addr, code, id, watch } = {}) {
  if (cli.on || cli.connecting) return Promise.resolve({ ok: false, error: 'Уже подключено' });
  if (watch && wt.ws) watchStop();
  if (host.on) return Promise.resolve({ ok: false, error: 'Сначала выключите «Разрешить управление с других компьютеров» на этом компьютере' });
  const a = normAddr(addr);
  if (!a) return Promise.resolve({ ok: false, error: 'Укажите адрес компьютера' });
  code = String(code || '').replace(/\D/g, '');
  // Без кода — ключом: по id найденного компьютера или по адресу
  const all = keys();
  const kid = code ? '' : (id && all[id] ? id : Object.keys(all).find((k) => all[k].addr === a) || '');
  if (!code && !kid) return Promise.resolve({ ok: false, error: 'Введите код — его показывает компьютер A', needCode: true });
  cli.key = kid ? all[kid].key : '';
  cli.connecting = new Promise((done) => {
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; cli.connecting = null; clearTimeout(tm); notify(); done(r); };
    let ws;
    try {
      ws = cliOpen(a, helloOf({ ...(code ? { code } : { key: cli.key }), ...(watch ? { watch: true } : {}) }), {
        msg(w, m, bin) {
          if (cli.on && cli.ws === w) { cliMsg(m); return; }
          if (wt.ws === w) { watchMsg(m); return; }
          if (m.t === 'bye') {
            if (m.code === 'key' && kid) keyDrop(kid); // A нас забыл — дальше по коду
            finish({ ok: false, error: m.text || m.code || 'Отказано', needCode: m.code === 'key' });
            try { w.close(); } catch { /* уже */ }
            return;
          }
          if (m.t === 'welcome' && bin && watch && m.watch) { finish({ ok: true, name: String(m.name || a), watch: true }); watchStart(w, m, a); return; }
          if (m.t === 'welcome' && bin && !m.resume && !m.watch) { finish({ ok: true, name: String(m.name || a) }); cliWelcome(w, m, a); }
        },
        close(w) {
          if (wt.ws === w) { watchEnd(wt.bye ? '' : 'Связь с компьютером «' + wt.name + '» прервалась'); return; }
          if (!cli.on || cli.ws !== w) { finish({ ok: false, error: 'Связь не установилась' }); return; }
          cliClosed(w);
        },
        error(w, e) { if (!cli.on && wt.ws !== w) finish({ ok: false, error: /ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT/.test(String(e && e.code)) ? 'Компьютер A не найден по адресу ' + a : errText(e) }); },
      });
    } catch (e) { finish({ ok: false, error: errText(e) }); return; }
    const tm = setTimeout(() => { try { ws.terminate(); } catch { /* уже */ } finish({ ok: false, error: 'Компьютер A не ответил' }); }, 45000);
  });
  return cli.connecting;
}

// Рабочее соединение закрылось: A попрощался — конец; оборвалось — переподключаемся (R4)
function cliClosed(ws) {
  if (!cli.on || cli.ws !== ws) return;
  if (cli.bye || !cli.key || !cli.sid) { cliEnd(cli.bye || { code: 'lost', text: 'Связь с компьютером «' + cli.name + '» прервалась' }); return; }
  cliLost();
}
function cliLost() {
  cli.lost = Date.now();
  cli.ws = null;
  cli.fails = 0;
  clearInterval(cli.timer);
  // Ответы на отправленное потерялись: повторять нельзя (могло выполниться) — ошибка
  for (const w of cli.wait.values()) w.fail(new Error('Связь с компьютером A прервалась'));
  cli.wait.clear();
  if (o.log) o.log('Удалённое управление: связь с «' + cli.name + '» прервалась — переподключаюсь');
  if (o.toControl) o.toControl('wp:notice', { text: 'Связь с компьютером «' + cli.name + '» прервалась — переподключаюсь…', ok: true });
  notify();
  cliRetry(300);
}
function cliRetry(ms) { clearTimeout(cli.retry); cli.retry = setTimeout(cliResume, ms); }
function cliResume() {
  if (!cli.on || !cli.lost) return;
  if (Date.now() - cli.lost > grace()) { cliEnd({ code: 'lost', text: 'Связь с компьютером «' + cli.name + '» прервалась' }); return; }
  const a = cli.addr;
  let over = false;
  const again = () => {
    if (over) return;
    over = true;
    cli.fails++;
    // Каждая третья неудача — поискать A в сети: мог получить другой адрес
    if (cli.fails % 3 === 0 && cli.id) {
      discover(1200).then((list) => { const f = list.find((x) => x.id === cli.id); if (f && f.addr !== cli.addr) { cli.addr = f.addr; keySave(cli.id, { addr: f.addr }); } }, () => {}).then(() => cliRetry(1000));
    } else cliRetry(2000);
  };
  let ws;
  try {
    ws = cliOpen(a, helloOf(cli.relogin ? { key: cli.key } : { key: cli.key, resume: cli.sid }), {
      msg(w, m, bin) {
        if (cli.ws === w) { cliMsg(m); return; }
        if (!cli.on || !cli.lost) { try { w.close(); } catch { /* уже */ } return; }
        if (m.t === 'welcome' && bin && m.resume) { over = true; cliResumed(w, m); return; }
        if (m.t === 'welcome' && bin && cli.relogin) { over = true; cliWelcome(w, m, a); return; }
        if (m.t === 'bye') {
          over = true;
          try { w.close(); } catch { /* уже */ }
          if (m.code === 'gone' && !cli.relogin) { cli.relogin = true; cliRetry(100); return; } // A перезапускалась — войти по ключу заново
          if (m.code === 'key') keyDrop(cli.id);
          cliEnd({ code: String(m.code || ''), text: String(m.text || 'Управление прекращено') });
        }
      },
      close(w) { if (cli.ws === w) cliClosed(w); else again(); },
    });
  } catch { again(); return; }
  setTimeout(() => { if (!over && cli.ws !== ws) { try { ws.terminate(); } catch { /* уже */ } } }, 10000);
}
function cliResumed(ws, m) {
  cli.ws = ws;
  cli.lost = 0;
  cli.fails = 0;
  cliPing(ws);
  keySave(cli.id, { addr: cli.addr, name: String(m.name || cli.name) });
  for (const b of cli.back.splice(0)) b.ok();
  if (o.log) o.log('Удалённое управление: связь с «' + cli.name + '» восстановлена');
  if (o.toControl) o.toControl('wp:notice', { text: 'Связь с компьютером «' + cli.name + '» восстановлена', ok: true, kind: 'ok' });
  notify();
}

function cliMsg(m) {
  cli.alive = Date.now();
  if (m.t === 'dlg') {
    if (o.focus) o.focus();
    if (o.toControl) o.toControl('wp:dialog', { id: m.id, kind: String(m.kind || ''), opts: m.opts || {} });
    return;
  }
  if (m.t === 'res') {
    const w = cli.wait.get(m.i);
    if (!w) return;
    cli.wait.delete(m.i);
    if (m.err != null) w.fail(new Error(String(m.err))); else w.ok(m.v);
    return;
  }
  if (m.t === 'ev') { if (o.toControl) o.toControl(String(m.ch), m.d); return; }
  if (m.t === 'bye') { cli.bye = { code: String(m.code || ''), text: String(m.text || 'Управление прекращено'), at: Date.now() }; }
}

/* ----- R5: B смотрит экран A без управления: своё окно (main.js: watchOpen), события окон вывода A ----- */
const wt = { ws: null, name: '', addr: '', fkey: '', bye: false };
function watchStart(ws, m, a) {
  wt.ws = ws; wt.name = String(m.name || a); wt.addr = a; wt.bye = false;
  wt.fkey = /^[0-9a-f]{32}$/.test(m.fkey) ? m.fkey : '';
  const id = typeof m.id === 'string' ? m.id : '';
  if (typeof m.key === 'string' && /^[0-9a-f]{64}$/.test(m.key)) keySave(id, { key: m.key, name: wt.name, addr: a });
  else keySave(id, { name: wt.name, addr: a });
  saveP({ addr: a });
  const t = setInterval(() => { if (wt.ws !== ws) { clearInterval(t); return; } try { ws.ping(); } catch { /* закрылся */ } }, PING_MS);
  if (o.log) o.log('Удалённое управление: смотрю экран «' + wt.name + '» (' + a + ')');
  if (o.watchOpen) o.watchOpen({ name: wt.name, replay: Array.isArray(m.replay) ? m.replay : [] });
  notify();
}
function watchMsg(m) {
  if (m.t === 'ev') { if (o.watchSend && WATCH_CH.has(String(m.ch))) o.watchSend(String(m.ch), m.d); return; }
  if (m.t === 'bye') { wt.bye = true; if (m.text && o.toControl) o.toControl('wp:notice', { text: String(m.text) }); }
}
function watchEnd(why) {
  if (!wt.ws) return;
  const ws = wt.ws;
  wt.ws = null; wt.fkey = '';
  try { if (ws.readyState <= 1) ws.close(1000, 'bye'); } catch { /* уже */ }
  if (files.watch) files.watch.clear();
  if (o.watchClose) o.watchClose();
  if (why && o.toControl) o.toControl('wp:notice', { text: why });
  notify();
}
// Окно «Экран компьютера A» закрыли или «Не смотреть»
function watchStop() { if (!wt.ws) return state(); wt.bye = true; say(wt.ws, { t: 'bye' }); watchEnd(''); return state(); }

// Окно B — снова своё: отложенные вызовы отвергаются, окно перезагружается со своими данными
function cliEnd(bye) {
  if (!cli.on) return;
  cli.on = false;
  cli.fkey = '';
  cli.sid = '';
  cli.show = null;
  cli.lost = 0;
  cli.relogin = false;
  clearTimeout(cli.retry);
  cli.ups.clear();
  if (files.cli) files.cli.clear();
  if (o.fileProto) o.fileProto(false);
  clearInterval(cli.timer);
  const ws = cli.ws;
  cli.ws = null;
  const err = new Error('Связь с компьютером A прервалась');
  for (const w of cli.wait.values()) w.fail(err);
  cli.wait.clear();
  for (const b of cli.back.splice(0)) b.fail(err);
  cli.bye = bye ? { ...bye, at: Date.now() } : null;
  try { if (ws && ws.readyState <= 1) ws.close(1000, 'bye'); } catch { /* уже */ }
  if (o.log) o.log('Удалённое управление: отключено' + (bye && bye.text ? ' — ' + bye.text : ''));
  notify();
  if (o.reload) o.reload();
}
function disconnect() {
  if (!cli.on) return state();
  say(cli.ws, { t: 'bye' });
  cliEnd(null);
  return state();
}
// Копия настроек окна B (preload.js: ls:backup) — в файл профиля A
const sendLs = (data) => say(cli.ws, { t: 'ls', data });

/* ----- Состояние для окна ----- */
function state() {
  const p = host.peer;
  const k = keys();
  return {
    host: { on: host.on, code: host.code, port: o.port ? o.port() : 0, ips: o.ips ? o.ips() : [], taking: host.taking,
      peer: p ? { name: p.name, ip: p.ip, at: p.at, ready: p.ready, lostUntil: p.lost ? p.lost + grace() : 0 } : null, vars: host.vars,
      trusted: trusted().map((t) => ({ id: t.id, name: t.name, ip: t.ip || '', at: t.at, last: t.last })),
      watchers: [...host.watchers].map((w) => ({ name: w.name, ip: w.ip, at: w.at })) },
    client: { on: cli.on, connecting: !!cli.connecting, addr: cli.addr || mem.addr || '', name: cli.name, bye: cli.bye,
      lostUntil: cli.lost ? cli.lost + grace() : 0,
      watching: wt.ws ? { name: wt.name, addr: wt.addr } : null,
      known: Object.keys(k).map((id) => ({ id, name: String(k[id].name || ''), addr: String(k[id].addr || '') })) },
    me: myName(), meOwn: !!String(mem.name || '').trim(), sysName: os.hostname(),
  };
}
function notify() { if (o.notify) try { o.notify(state()); } catch { /* окно закрывается */ } }

const files = { host: null, cli: null, watch: null, up: () => false };
function setup(opts) {
  o = opts || {};
  files.host = wpfiles.host({
    key: () => [host.peer && host.peer.ready ? host.peer.fkey : '', ...[...host.watchers].map((w) => w.fkey)],
    roots: () => (o.fileRoots ? o.fileRoots() : []),
    dataFiles: () => (o.dataFiles ? o.dataFiles() : []),
  });
  files.up = wpfiles.uploadServe({ key: () => (host.peer && host.peer.ready ? host.peer.fkey : ''), dir: () => (o.upDir ? o.upDir() : require('os').tmpdir()) });
  files.cli = wpfiles.client({
    base: () => (cli.on && cli.fkey ? 'http://' + cli.addr + '/wpf/' + cli.fkey + '/' : ''),
    appDirs: o.appDirs || [],
    local: (req) => (o.localFetch ? o.localFetch(req) : new Response('', { status: 404 })),
  });
  files.watch = wpfiles.client({
    base: () => (wt.ws && wt.fkey ? 'http://' + wt.addr + '/wpf/' + wt.fkey + '/' : ''),
    appDirs: o.appDirs || [],
    local: (req) => (o.localFetch ? o.localFetch(req) : new Response('', { status: 404 })),
  });
  const s = o.saved ? o.saved() : {};
  mem = s && typeof s === 'object' ? { ...s } : {};
  if (mem.host) { host.on = true; host.code = newCode(); discSet(true); if (o.want) o.want(); }
}
function shutdown() {
  if (cli.on) disconnect();
  watchStop();
  watchersDrop('closed', 'Программа на компьютере A закрывается');
  if (host.peer) hostDrop('closed', 'Программа на компьютере A закрывается');
  discSet(false);
}

// http-сервер пульта (main.js: rmHandle): /wpf/… — файл A для B
const serveFile = (req, res, u) => (files.host ? files.host.serve(req, res, u) || files.up(req, res, u) : false);
// Окно обзора B ответило
const dialogDone = (x) => { if (cli.on && x && x.id) say(cli.ws, { t: 'dlgres', id: x.id, res: x.res || {} }); };

// R3: файл перетащили в окно B (preload.js: pathForFile) — сразу ответ «где он будет на A», загрузка — в фоне.
// Вызовы с этим путём ждут конца загрузки (cli.call). Не файл (папка) или нет связи — путь как есть
function uploadMap(local) {
  if (!cli.on || !cli.upDir || !cli.fkey || !local) return local;
  let st;
  try { st = require('fs').statSync(local); } catch { return local; }
  if (!st.isFile()) { if (o.toControl) o.toControl('wp:notice', { text: 'Папку с этого компьютера перетащить нельзя — перетащите файлы' }); return local; }
  const rel = wpfiles.uploadName(local, st);
  const [tag, name] = rel.split('/');
  const ap = require('path').join(cli.upDir, tag, name);
  if (!cli.ups.has(ap)) {
    const url = 'http://' + cli.addr + '/wpu/' + cli.fkey + '/' + tag + '/' + wpfiles.b64(name);
    const big = st.size > 20 * 1024 * 1024;
    if (big && o.toControl) o.toControl('wp:notice', { text: 'Передаю на компьютер A: ' + name + ' (' + Math.round(st.size / 1048576) + ' МБ)…', ok: true });
    const pr = wpfiles.uploadSend(local, url).then(
      () => { if (big && o.toControl) o.toControl('wp:notice', { text: 'Передано на компьютер A: ' + name, ok: true }); },
      (e) => { cli.ups.delete(ap); if (o.toControl) o.toControl('wp:notice', { text: 'Не передался на компьютер A: ' + name + ' — ' + errText(e) }); throw e; },
    );
    pr.catch(() => {});
    cli.ups.set(ap, pr);
  }
  return ap;
}
// Протокол file: на B в режиме клиента (main.js: protocol.handle)
const fileRequest = (req) => files.cli.handle(req);
const watchFile = (req) => files.watch.handle(req); // окно зрителя B (своя сессия, main.js: watchOpen)

module.exports = {
  serveFile, fileRequest, remoteDialog, dialogDone, uploadMap, dialogPending: () => dlg.size > 0, fileStats: () => (files.cli ? files.cli.stats() : null),
  hook, setup, shutdown, upgrade, state, setName, hostSet, hostEvent, hostTakeBack, hostForget, connect, disconnect, sendLs, discover,
  takeShow, showPut, watchEvent, watchStop, watchFile, isWatching: () => !!wt.ws,
  isClient: () => cli.on, clientName: () => cli.name, clientLs: () => cli.ls, clientProfile: () => cli.profile,
  hostLocked: () => !!host.peer, hostOn: () => host.on, changed: () => notify(),
  clientOwn: (ch) => CLIENT_OWN.has(ch),
  takeBye: () => { const b = cli.bye; cli.bye = null; return b; },
  _t: { normAddr, isLocal, BLOCK, handlers, bcastAddrs, drop: () => { try { cli.ws && cli.ws.terminate(); } catch { /* уже */ } } },
};
