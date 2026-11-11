/* ---------- Доступ телефонов группы и данные для приложения (главный процесс) — ТЗ-8-Группа.md, этапы 1–2 ----------
   Вход: телефон просит доступ (имя, роль) → «Ожидают подтверждения» в окне «Группа» → оператор «Пустить» →
   телефон получает свой ключ. На компьютере хранится только отпечаток ключа (sha256), сам ключ — только на телефоне.
   Все /api/v1/… кроме входа — с заголовком Authorization: Bearer <ключ>; права проверяются здесь, не на телефоне.
   Люди (people) — имя и роль, без паролей (пароли — этап 6). У человека может быть несколько устройств (devices).
   Песни: телефон качает порциями «всё, что изменилось после номера N» (/api/v1/songs/changes?since=N).
   Номер изменения каждой песни ведём здесь: отпечаток того, что уходит на телефон, сравниваем с прошлым
   (team-sync.json); удалённые помним, чтобы телефон удалил их тоже. Песни берём из library.json
   (main.js: lib:save зовёт libSaved). Данные группы — team.json (разделы people, devices; пишет teamsrv.js),
   журнал — team-log.jsonl. Подключает teamsrv.js (route → handle, info → state, окно «Группа» → act).
   Этап 2 — связь в реальном времени: WebSocket /ws (npm ws), протокол v1 (см. «WebSocket» ниже): что на экране (live —
   от окна оператора, team.js), «библиотека поменялась», сетлисты (плейлисты с пометкой «для группы»), листать с телефона
   (право «управлять показом» — галочка у человека, ctl). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const FMT = 2; // вид песни для телефона; поменялся (новые поля) — меняются все отпечатки, телефоны докачают песни
// 2 — этап 4: тональность, темп, размер, аккорды (song.chords целиком; по слайдам раскладывает телефон — chords.js)
const ROLES = [
  { id: 'musician', name: 'Музыкант' },
  { id: 'vocal', name: 'Вокалист' },
  { id: 'leader', name: 'Лидер' },
  { id: 'sound', name: 'Звук' },
  { id: 'tech', name: 'Техник' },
];
// Право → у каких ролей есть; «управлять показом» (control) — не по роли, а галочкой у человека (ctl)
const PERMS = { songs: ROLES.map((r) => r.id), control: [] };
const ONLINE_MS = 20e3;      // без WebSocket и запросов 20 с — не в сети (телефон шлёт ping раз в 15 с)
const PING_MS = 45e3;        // по WebSocket тишина 45 с — связь оборвалась, закрыть
const PEND_MS = 10 * 60e3;   // запрос на вход живёт 10 минут
const LOG_MAX = 512 * 1024;  // журнал больше — старое в team-log.old.jsonl

let o = {};        // { dir, libFile, store: { read, write }, notify(), on(), ver, cmd(c) }
let people = [];   // [{ id, name, role, at, ctl }]
let devices = [];  // [{ id, person, name, hash, at, seen, ip, off, synced }]
const byHash = new Map();
const pending = new Map(); // id → { id, sh, name, role, dev, ip, at, ok, no, waits: Set }
let seenDirty = false;
let onlineKey = '';
let timers = [];

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newId = () => crypto.randomBytes(6).toString('hex');
const newKey = () => crypto.randomBytes(24).toString('base64url');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const roleOk = (r) => ROLES.some((x) => x.id === r);
const roleName = (r) => (ROLES.find((x) => x.id === r) || ROLES[0]).name;
const can = (person, perm) => !!person && (perm === 'control' ? !!person.ctl : (PERMS[perm] || []).includes(person.role));
const personOf = (d) => people.find((p) => p.id === d.person) || null;

/* ----- Люди и устройства: team.json ----- */

function load() {
  const j = o.store.read();
  people = (Array.isArray(j.people) ? j.people : []).filter((p) => p && p.id && p.name)
    .map((p) => ({ id: String(p.id), name: clean(p.name, 40), role: roleOk(p.role) ? p.role : 'musician', at: Number(p.at) || 0, ctl: !!p.ctl }));
  devices = (Array.isArray(j.devices) ? j.devices : []).filter((d) => d && d.id && /^[0-9a-f]{64}$/.test(d.hash) && people.some((p) => p.id === d.person))
    .map((d) => ({ id: String(d.id), person: String(d.person), name: clean(d.name, 60), hash: d.hash, at: Number(d.at) || 0, seen: Number(d.seen) || 0, ip: String(d.ip || ''), off: !!d.off, synced: Number(d.synced) || 0 }));
  byHash.clear();
  for (const d of devices) byHash.set(d.hash, d);
}
function saveTeam() {
  seenDirty = false;
  o.store.write({ people, devices });
}

/* ----- Журнал: строка JSON на событие ----- */

const logFile = () => path.join(o.dir, 'team-log.jsonl');
function log(ev, x) {
  try {
    try { if (fs.statSync(logFile()).size > LOG_MAX) fs.renameSync(logFile(), path.join(o.dir, 'team-log.old.jsonl')); } catch { /* журнала ещё нет */ }
    fs.appendFileSync(logFile(), JSON.stringify({ at: Date.now(), ev, ...x }) + '\n');
  } catch { /* журнал не главное */ }
}
function readLog(n = 200) {
  let lines = [];
  try { lines = fs.readFileSync(logFile(), 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; }
  const out = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch { /* испорченная строка */ } }
  return out.reverse();
}
// Чужой ключ — в журнал не чаще раза в минуту с одного адреса
const badAt = new Map();
function logBad(ip) {
  const t = badAt.get(ip) || 0;
  if (Date.now() - t < 60e3) return;
  badAt.set(ip, Date.now());
  log('bad', { ip });
}

/* ----- Ответы ----- */

function send(req, res, code, obj) {
  if (res.headersSent || res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(obj));
  const head = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  // Песни — порциями по сотне килобайт: сжатие уменьшает их в 4–5 раз
  if (body.length > 1024 && /gzip/.test(String(req.headers['accept-encoding'] || ''))) {
    zlib.gzip(body, (err, gz) => {
      if (res.headersSent || res.writableEnded) return;
      if (err) { res.writeHead(code, head); res.end(body); return; }
      res.writeHead(code, { ...head, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      res.end(gz);
    });
    return;
  }
  res.writeHead(code, head);
  res.end(body);
}
function readBody(req, max) {
  return new Promise((ok, no) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > max) { no(new Error('big')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(b || '{}') || {}); } catch (e) { no(e); } });
    req.on('error', no);
  });
}
const ipOf = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

/* ----- Вход: запрос → подтверждение оператора → ключ ----- */

function expire() {
  const now = Date.now();
  for (const r of pending.values()) {
    if (now - r.at < PEND_MS) continue;
    for (const w of r.waits) { clearTimeout(w.timer); send(w.req, w.res, 200, { gone: true }); }
    pending.delete(r.id);
  }
}

async function join(req, res) {
  // Только JSON: обычная страница из интернета не может так спросить без разрешения (CORS) — не засыплет запросами
  if (!/^application\/json/.test(String(req.headers['content-type'] || ''))) return send(req, res, 415, { error: 'type' });
  let b;
  try { b = await readBody(req, 4096); } catch { return send(req, res, 400, { error: 'body' }); }
  const ip = ipOf(req);
  const name = clean(b.name, 40);
  if (!name) return send(req, res, 400, { error: 'name', text: 'Впишите имя' });
  expire();
  const open = [...pending.values()].filter((r) => !r.ok && !r.no);
  if (open.filter((r) => r.ip === ip).length >= 3 || open.length >= 30) return send(req, res, 429, { error: 'many', text: 'Слишком много запросов — подождите несколько минут' });
  const id = newId();
  const secret = newKey();
  const r = { id, sh: sha(secret), name, role: roleOk(b.role) ? b.role : 'musician', dev: clean(b.dev, 60) || 'Телефон', ip, at: Date.now(), ok: null, no: false, waits: new Set() };
  pending.set(id, r);
  log('join', { name, role: r.role, dev: r.dev, ip });
  o.notify();
  send(req, res, 200, { id, secret });
}

// Телефон ждёт ответа оператора: долгий запрос до 25 с, потом спросит снова. Тайный ключ запроса — в теле, не в адресе
async function joinWait(req, res) {
  let b;
  try { b = await readBody(req, 1024); } catch { return send(req, res, 400, { error: 'body' }); }
  const r = pending.get(String(b.id || ''));
  if (!r || sha(b.secret || '') !== r.sh) return send(req, res, 200, { gone: true });
  const a = answer(r);
  if (a) return send(req, res, 200, a);
  const w = { req, res, timer: setTimeout(() => { r.waits.delete(w); send(req, res, 200, { wait: true }); }, 25000) };
  r.waits.add(w);
  res.on('close', () => { clearTimeout(w.timer); r.waits.delete(w); });
}
function answer(r) {
  if (r.no) { pending.delete(r.id); return { rejected: true }; }
  if (r.ok) return admit(r);
  return null;
}
// Ответ оператора — сразу тому, кто ждёт (ключ получает один запрос, остальные спросят снова и узнают, что уже нет)
function flush(r) {
  const ws = [...r.waits];
  r.waits.clear();
  ws.forEach((w, i) => { clearTimeout(w.timer); send(w.req, w.res, 200, i === 0 ? answer(r) : { wait: true }); });
}
// Пустили: человек (тот же по имени — второе устройство того же человека) и устройство с новым ключом
function admit(r) {
  pending.delete(r.id);
  let p = people.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
  if (!p) { p = { id: newId(), name: r.name, role: r.role, at: Date.now(), ctl: false }; people.push(p); }
  const key = newKey();
  const d = { id: newId(), person: p.id, name: r.dev, hash: sha(key), at: Date.now(), seen: Date.now(), ip: r.ip, off: false, synced: 0 };
  devices.push(d);
  byHash.set(d.hash, d);
  saveTeam();
  log('admit', { name: p.name, dev: d.name, ip: r.ip });
  o.notify();
  return { token: key, me: me(d, p) };
}

/* ----- Песни: номер изменения каждой песни, порции «после N» ----- */

const syncFile = () => path.join(o.dir, 'team-sync.json');
let sync = null;     // { v, lib, seq, songs: { id: [отпечаток, номер] }, gone: { id: номер } }
let pay = new Map(); // id → песня, как уходит на телефон
let ord = [];        // [{ id, n, del }] по возрастанию номера
let libs = [];       // библиотеки с песнями: [{ id, name, songs: [id] }]
let lh = '';         // отпечаток библиотек — телефон берёт их заново, только если поменялись
let libSeen = -1;    // время изменения library.json, которое уже разобрано
let fresh = null;    // { data, mtime } — свежая библиотека из lib:save (не читать файл заново)
let sets = [];       // сетлисты: плейлисты с пометкой «для группы» (pl.team = { date }), тональность строки — entry.key
let sh = '';         // отпечаток сетлистов

function loadSync() {
  sync = null;
  try {
    const j = JSON.parse(fs.readFileSync(syncFile(), 'utf8'));
    if (j && j.v === 1 && typeof j.lib === 'string' && j.songs && j.gone) sync = { v: 1, lib: j.lib, seq: Number(j.seq) || 0, songs: j.songs, gone: j.gone };
  } catch { /* первый запуск или файл испорчен — новая «база»: телефоны скачают всё заново */ }
  if (!sync) sync = { v: 1, lib: newId(), seq: 0, songs: {}, gone: {} };
}
function saveSync() {
  try {
    fs.writeFileSync(syncFile() + '.tmp', JSON.stringify(sync));
    fs.renameSync(syncFile() + '.tmp', syncFile());
  } catch { /* не записалось — при следующем запуске телефоны просто докачают */ }
}

// Что уходит на телефон. Слайды — уже собранные программой (Songs.build): порядок аранжировки, повторы,
// id слайда — постоянный (к нему потом привяжутся пометки и «что сейчас на экране»)
function songPay(it) {
  const s = it.song || {};
  const p = {
    id: String(it.id), name: clean(it.name, 200),
    slides: (Array.isArray(it.slides) ? it.slides : []).filter((z) => z && z.id && typeof z.text === 'string')
      .map((z) => ({ id: String(z.id), part: String(z.part || ''), label: String(z.label || ''), occ: Number(z.occ) || 1, pi: Number(z.pi) || 0, text: z.text })),
  };
  if (s.number) p.number = String(s.number);
  if (s.ccli) p.ccli = String(s.ccli);
  if (s.key) p.key = clean(s.key, 8);
  if (Number(s.tempo) > 0) p.tempo = Math.round(Number(s.tempo));
  if (/^\d{1,2}\/\d{1,2}$/.test(String(s.time || ''))) p.time = String(s.time);
  if (typeof s.chords === 'string' && s.chords.trim()) p.chords = s.chords.slice(0, 30000);
  return p;
}

function apply(lib) {
  const items = lib && lib.items && typeof lib.items === 'object' ? lib.items : {};
  const now = new Map();
  for (const it of Array.isArray(items) ? items : Object.values(items)) if (it && it.kind === 'song' && it.id) now.set(String(it.id), songPay(it));
  let ch = false;
  for (const [id, p] of now) {
    const h = crypto.createHash('sha1').update(FMT + JSON.stringify(p)).digest('base64url').slice(0, 16);
    const old = sync.songs[id];
    if (!old || old[0] !== h) { sync.songs[id] = [h, ++sync.seq]; ch = true; }
    if (sync.gone[id] !== undefined) { delete sync.gone[id]; ch = true; }
  }
  for (const id of Object.keys(sync.songs)) if (!now.has(id)) { delete sync.songs[id]; sync.gone[id] = ++sync.seq; ch = true; }
  pay = now;
  ord = [
    ...Object.entries(sync.songs).map(([id, v]) => ({ id, n: v[1], del: false })),
    ...Object.entries(sync.gone).map(([id, n]) => ({ id, n, del: true })),
  ].sort((a, b) => a.n - b.n);
  // Библиотеки — только песни, порядок как в программе
  libs = (Array.isArray(lib && lib.libraries) ? lib.libraries : [])
    .map((l) => ({ id: String(l.id), name: clean(l.name, 80), songs: (Array.isArray(l.items) ? l.items : []).map(String).filter((id) => now.has(id)) }))
    .filter((l) => l.songs.length);
  lh = sha(JSON.stringify(libs)).slice(0, 12);
  // Сетлисты: строки — что угодно из плейлиста (песня, Библия, видео); у песни телефон откроет текст
  const byId = (id) => (Array.isArray(items) ? items.find((x) => x && String(x.id) === String(id)) : items[id]) || null;
  sets = (Array.isArray(lib && lib.playlists) ? lib.playlists : []).filter((pl) => pl && pl.id && pl.team)
    .map((pl) => ({
      id: String(pl.id), name: clean(pl.name, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(pl.team.date) ? pl.team.date : '',
      entries: (Array.isArray(pl.entries) ? pl.entries : []).map((e) => {
        const it = e && byId(e.item);
        return it ? { eid: String(e.eid), item: String(it.id), name: clean(it.name, 200), kind: String(it.kind || ''), key: clean(e.key, 12) } : null;
      }).filter(Boolean),
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  sh = sha(JSON.stringify(sets)).slice(0, 12);
  if (ch) saveSync();
}

// Библиотека поменялась (lib:save или файл заменили — восстановление из репозитория) — разобрать заново
function refresh() {
  let m = 0;
  try { m = fs.statSync(o.libFile).mtimeMs; } catch { m = 0; }
  if (m === libSeen) return;
  let data = null;
  if (fresh && fresh.mtime === m) data = fresh.data;
  else if (m) { try { data = JSON.parse(fs.readFileSync(o.libFile, 'utf8')); } catch { return; } } // пишется — в другой раз
  fresh = null;
  libSeen = m;
  apply(data || {});
}
function libSaved(data) {
  let m = 0;
  try { m = fs.statSync(o.libFile).mtimeMs; } catch { /* нет файла */ }
  fresh = data && typeof data === 'object' ? { data, mtime: m } : null;
  // Кто-то на связи — сказать сразу (через 1,5 с: правки идут пачкой, разбор ~35 мс)
  if (socks.size) { clearTimeout(pushT); pushT = setTimeout(pushLib, 1500); }
}

function changes(req, res, u, d) {
  refresh();
  const since = Math.max(0, Math.floor(Number(u.searchParams.get('since')) || 0));
  const limit = Math.min(1000, Math.max(50, Math.floor(Number(u.searchParams.get('limit')) || 400)));
  const base = { fmt: FMT, lib: sync.lib, seq: sync.seq };
  // Другая «база» (файл синхронизации потерян) или номер из будущего — телефон начинает с нуля
  if (since > 0 && (u.searchParams.get('lib') !== sync.lib || since > sync.seq)) return send(req, res, 200, { ...base, reset: true });
  let i = 0;
  while (i < ord.length && ord[i].n <= since) i++;
  const rest = ord.length - i;
  const page = ord.slice(i, i + limit);
  const more = rest > limit;
  const out = { ...base, since, next: more ? page[page.length - 1].n : sync.seq, more, total: rest, songs: [], gone: [] };
  for (const e of page) { if (e.del) out.gone.push(e.id); else if (pay.has(e.id)) out.songs.push(pay.get(e.id)); }
  if (!more && u.searchParams.get('lh') !== lh) { out.libs = libs; out.lh = lh; }
  if (!more) { d.synced = Date.now(); seenDirty = true; o.notify(); }
  send(req, res, 200, out);
}

/* ----- Запросы телефонов: /api/v1/… ----- */

function me(d, p) {
  return {
    device: { id: d.id, name: d.name },
    person: { name: p.name, role: p.role, roleName: roleName(p.role) },
    perms: Object.fromEntries(Object.keys(PERMS).map((k) => [k, can(p, k)])),
    server: { app: 'church-presenter', name: 'multiplayerSHOW', ver: o.ver || '' },
    lib: sync.lib, seq: sync.seq, lh, songs: pay.size, time: Date.now(),
  };
}
function touch(d, ip) {
  const was = Date.now() - d.seen < ONLINE_MS;
  d.seen = Date.now();
  d.ip = ip;
  seenDirty = true;
  if (!was) o.notify(); // появился в сети — окно «Группа»
}

// Ключ устройства → { d, p } или { code, http } (401 — нет такого, 403 — приостановлен)
const ERR = { auth: 'Доступ отозван оператором', off: 'Оператор приостановил доступ этого телефона', closed: 'Доступ для группы выключен в программе' };
function authKey(key, ip) {
  const ok = /^[\w-]{20,100}$/.test(String(key || ''));
  const d = ok ? byHash.get(sha(key)) : null;
  const p = d && personOf(d);
  if (!d || !p) { if (key) logBad(ip); return { code: 'auth', http: 401 }; }
  if (d.off) return { code: 'off', http: 403 };
  return { d, p };
}

function handle(req, res, u) {
  const p = u.pathname.slice('/api/v1'.length);
  if (!o.on()) return send(req, res, 403, { error: 'closed', text: ERR.closed });
  if (p === '/join' && req.method === 'POST') { join(req, res); return; }
  if (p === '/join/wait' && req.method === 'POST') { joinWait(req, res); return; }
  const ip = ipOf(req);
  const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
  const a = authKey(m ? m[1] : '', ip);
  if (a.code) return send(req, res, a.http, { error: a.code, text: ERR[a.code] });
  const { d } = a;
  const person = a.p;
  touch(d, ip);
  if (p === '/me') { refresh(); return send(req, res, 200, me(d, person)); }
  if (p === '/songs/changes') {
    if (!can(person, 'songs')) return send(req, res, 403, { error: 'perm', text: 'Нет права смотреть песни' });
    return changes(req, res, u, d);
  }
  send(req, res, 404, { error: 'nf' });
}

/* ----- Окно «Группа»: состояние и действия оператора ----- */

const isOn = (d, now) => !d.off && ([...socks].some((c) => c.d === d) || now - d.seen < ONLINE_MS);
function state() {
  expire();
  const now = Date.now();
  return {
    roles: ROLES,
    pending: [...pending.values()].filter((r) => !r.ok && !r.no).map((r) => ({ id: r.id, name: r.name, role: r.role, dev: r.dev, ip: r.ip, at: r.at })),
    people: people.map((p) => ({
      id: p.id, name: p.name, role: p.role, at: p.at,
      ctl: !!p.ctl,
      devices: devices.filter((d) => d.person === p.id).map((d) => ({ id: d.id, name: d.name, ip: d.ip, at: d.at, seen: d.seen, off: d.off, synced: d.synced, online: isOn(d, now) })),
    })),
    online: devices.filter((d) => isOn(d, now)).length,
    songs: pay.size,
  };
}

function act(a) {
  a = a || {};
  const dev = () => { const d = devices.find((x) => x.id === a.id); if (!d) throw new Error('Такого устройства уже нет'); return d; };
  const per = () => { const p = people.find((x) => x.id === a.id); if (!p) throw new Error('Такого человека уже нет'); return p; };
  const req = () => { expire(); const r = pending.get(a.id); if (!r || r.ok || r.no) throw new Error('Запрос уже не действует — телефон может попросить доступ снова'); return r; };
  switch (a.act) {
    case 'approve': { const r = req(); r.ok = true; r.at = Date.now(); log('approve', { name: r.name, dev: r.dev, ip: r.ip }); flush(r); break; }
    case 'reject': { const r = req(); r.no = true; r.at = Date.now(); log('reject', { name: r.name, dev: r.dev, ip: r.ip }); flush(r); break; }
    case 'off': { const d = dev(); d.off = !!a.off; saveTeam(); log(d.off ? 'off' : 'on', { name: (personOf(d) || {}).name, dev: d.name }); if (d.off) kick((c) => c.d === d, 'off'); break; }
    case 'revoke': {
      const d = dev();
      devices = devices.filter((x) => x !== d);
      byHash.delete(d.hash);
      saveTeam();
      log('revoke', { name: (personOf(d) || {}).name, dev: d.name });
      kick((c) => c.d === d, 'auth');
      break;
    }
    case 'person': {
      const p = per();
      if (typeof a.name === 'string') {
        const n = clean(a.name, 40);
        if (!n) throw new Error('Имя не может быть пустым');
        if (people.some((x) => x !== p && x.name.toLowerCase() === n.toLowerCase())) throw new Error(`«${n}» уже есть — у одного человека может быть несколько телефонов`);
        p.name = n;
      }
      if (roleOk(a.role)) p.role = a.role;
      if (typeof a.ctl === 'boolean' && a.ctl !== p.ctl) { p.ctl = a.ctl; log(p.ctl ? 'ctlOn' : 'ctlOff', { name: p.name }); }
      saveTeam();
      for (const c of socks) if (c.d.person === p.id) wsSend(c, { t: 'me', me: me(c.d, p) }); // роль и права — телефону сразу
      break;
    }
    case 'delPerson': {
      const p = per();
      for (const d of devices.filter((x) => x.person === p.id)) byHash.delete(d.hash);
      kick((c) => c.d.person === p.id, 'auth');
      devices = devices.filter((x) => x.person !== p.id);
      people = people.filter((x) => x !== p);
      saveTeam();
      log('delPerson', { name: p.name });
      break;
    }
    case 'log': return readLog(Number(a.n) || 200);
    default: throw new Error('Неизвестное действие');
  }
  o.notify();
  return null;
}

/* ----- WebSocket /ws: протокол v1 ----------
   Телефон → программа: { t: 'hello', v: 1, token } (первым, иначе закрываем), { t: 'ping', id } раз в 15 с,
   { t: 'cmd', cmd: 'next'|'prev'|'show'|'clear', item, sid } — только с правом «управлять показом».
   Программа → телефон: welcome { v, me, live, sets, sh, time } · live { live } — что на экране (у песни — id слайда,
   у Библии и своих слайдов — ещё и их текст, когда пункт сменился; same: true — текст тот же, что в прошлый раз) ·
   lib { lib, seq, lh } — песни поменялись, докачать · sets { sets, sh } · me { me } — роль или права поменялись ·
   pong { id, time } · err { text } · bye { code, text } — перед закрытием: auth (ключ отозван), off (приостановлен),
   closed (доступ выключен). Ключ — в первом сообщении, не в адресе (адреса попадают в журналы). */

let WSS = null;
const socks = new Set(); // { ws, d, ip, last } — только вошедшие (hello принят)
let live = { kind: 'none' };
let liveSig = '';
let slidesSig = '';
let sent = { lib: '', seq: -1, lh: '', sh: '' }; // что разослали последним
let pushT = 0;

function wsSend(c, m) {
  try { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); } catch { /* закрылся */ }
}
function broadcast(m, perm) {
  const s = JSON.stringify(m);
  for (const c of socks) {
    if (perm && !can(personOf(c.d), perm)) continue;
    try { if (c.ws.readyState === 1) c.ws.send(s); } catch { /* закрылся */ }
  }
}
// Отключить телефоны (отозвали, приостановили, выключили доступ): сначала сказать почему
function kick(test, code) {
  for (const c of [...socks]) {
    if (!test(c)) continue;
    wsSend(c, { t: 'bye', code, text: ERR[code] || '' });
    socks.delete(c);
    try { c.ws.close(code === 'off' ? 4003 : code === 'closed' ? 4004 : 4001, code); } catch { /* уже */ }
  }
  o.notify();
}
const closeAll = () => kick(() => true, 'closed');

// Из teamsrv.js: запрос на /ws (адрес и Origin уже проверены)
function upgrade(req, sock, head) {
  if (!o.on()) { sock.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
  if (!WSS) WSS = new (require('ws').WebSocketServer)({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  WSS.handleUpgrade(req, sock, head, (ws) => attach(ws, ipOf(req)));
}
function attach(ws, ip) {
  const c = { ws, d: null, ip, last: Date.now() };
  const t = setTimeout(() => { if (!c.d) try { ws.close(4001, 'hello'); } catch { /* уже */ } }, 10000);
  ws.on('message', (buf) => {
    c.last = Date.now();
    let m = null;
    try { m = JSON.parse(String(buf)); } catch { return; }
    if (m && typeof m === 'object') onMsg(c, m);
  });
  ws.on('close', () => { clearTimeout(t); if (socks.delete(c)) o.notify(); });
  ws.on('error', () => { /* оборвалось — close придёт */ });
}
function onMsg(c, m) {
  if (!c.d) {
    if (m.t !== 'hello') { try { c.ws.close(4001, 'hello'); } catch { /* уже */ } return; }
    if (!o.on()) { wsSend(c, { t: 'bye', code: 'closed', text: ERR.closed }); c.ws.close(4004, 'closed'); return; }
    const a = authKey(m.token, c.ip);
    if (a.code) { wsSend(c, { t: 'bye', code: a.code, text: ERR[a.code] }); c.ws.close(a.code === 'off' ? 4003 : 4001, a.code); return; }
    c.d = a.d;
    socks.add(c);
    touch(c.d, c.ip);
    o.notify();
    refresh();
    wsSend(c, { t: 'welcome', v: 1, me: me(c.d, a.p), live, sets, sh, time: Date.now() });
    return;
  }
  const p = personOf(c.d);
  if (!p || !byHash.has(c.d.hash) || c.d.off) { kick((x) => x === c, c.d.off ? 'off' : 'auth'); return; }
  touch(c.d, c.ip);
  if (m.t === 'ping') { wsSend(c, { t: 'pong', id: m.id, time: Date.now() }); return; }
  if (m.t === 'cmd') {
    if (!can(p, 'control')) { wsSend(c, { t: 'err', text: 'Нет права листать — его даёт оператор в окне «Группа»' }); return; }
    const cmd = String(m.cmd || '');
    if (!['next', 'prev', 'show', 'clear'].includes(cmd)) return;
    if (o.cmd) o.cmd({ cmd, item: clean(m.item, 40), sid: clean(m.sid, 40), pl: clean(m.pl, 40), eid: clean(m.eid, 40), who: p.name });
  }
}

// Что на экране — от окна оператора (team.js). Текст слайдов шлём, только когда пункт или его слайды поменялись
const LIVE_KINDS = ['song', 'text', 'bible', 'media', 'none'];
function setLive(l) {
  const x = l && typeof l === 'object' ? l : {};
  const kind = LIVE_KINDS.includes(x.kind) ? x.kind : 'none';
  const nl = { kind, item: clean(x.item, 40), name: clean(x.name, 200), sid: clean(x.sid, 40),
    idx: Math.max(-1, Math.floor(Number(x.idx)) || 0), n: Math.max(0, Math.floor(Number(x.n)) || 0),
    pl: clean(x.pl, 40), eid: clean(x.eid, 40) };
  if (kind === 'text' || kind === 'bible') {
    let total = 0;
    nl.slides = (Array.isArray(x.slides) ? x.slides : []).slice(0, 400).map((z) => {
      const t = String((z && z.text) || '').slice(0, 4000);
      total += t.length;
      return { id: clean(z && z.id, 40), label: clean(z && z.label, 80), text: total > 300000 ? '' : t };
    });
  }
  const sig = JSON.stringify(nl);
  if (sig === liveSig) return false;
  liveSig = sig;
  live = { ...nl, at: Date.now() };
  const ss = JSON.stringify([nl.item, nl.slides || null]);
  const same = ss === slidesSig;
  slidesSig = ss;
  broadcast({ t: 'live', live: same && nl.slides ? { ...live, slides: undefined, same: true } : live }, 'songs');
  return true;
}

// Библиотека поменялась — телефонам: докачать песни, новые сетлисты
function pushLib() {
  if (!socks.size) return;
  refresh();
  if (sent.lib !== sync.lib || sent.seq !== sync.seq || sent.lh !== lh) broadcast({ t: 'lib', lib: sync.lib, seq: sync.seq, lh }, 'songs');
  if (sent.sh !== sh) broadcast({ t: 'sets', sets, sh }, 'songs');
  sent = { lib: sync.lib, seq: sync.seq, lh, sh };
}

/* ----- Запуск ----- */

function init(opt) {
  o = opt;
  load();
  loadSync();
  // Библиотеку разбираем не при запуске программы (7 МБ — заметная пауза), а по первому запросу телефона
  for (const h of timers) clearInterval(h);
  timers = [];
  const t = (fn, ms) => { const h = setInterval(fn, ms); if (h.unref) h.unref(); timers.push(h); };
  // Кто в сети: поменялось — окно «Группа»; когда телефон был последний раз — в файл раз в минуту
  t(() => {
    const now = Date.now();
    const k = devices.filter((d) => isOn(d, now)).map((d) => d.id).join(',');
    if (k !== onlineKey) { onlineKey = k; o.notify(); }
    if (pending.size) { const n = pending.size; expire(); if (pending.size !== n) o.notify(); }
  }, 5e3);
  t(() => { if (seenDirty) saveTeam(); }, 60e3);
  // Телефон пропал без «до свидания» (ушёл из Wi-Fi) — закрыть
  t(() => {
    const now = Date.now();
    for (const c of [...socks]) if (now - c.last > PING_MS) { socks.delete(c); try { c.ws.terminate(); } catch { /* уже */ } o.notify(); }
  }, 10e3);
}
function shutdown() {
  for (const h of timers) clearInterval(h);
  timers = [];
  if (seenDirty) saveTeam();
  for (const r of pending.values()) for (const w of r.waits) { clearTimeout(w.timer); send(w.req, w.res, 200, { wait: true }); }
  clearTimeout(pushT);
  for (const c of socks) { try { c.ws.terminate(); } catch { /* уже */ } }
  socks.clear();
}

module.exports = { init, shutdown, handle, state, act, libSaved, upgrade, setLive, closeAll, ROLES,
  _test: { refresh, apply, pending, sync: () => sync, socks, sets: () => sets, live: () => live } };
