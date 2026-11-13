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
   (право «управлять показом» — галочка у человека, ctl).
   Этап 6: сообщения группе (Лидер, Звук, оператор), общий метроном по времени программы, пароли (crypto.scrypt —
   на диске только соль и отпечаток), режимы входа auth.mode: qr — запрос и «Пустить»; qrpass — с паролем сразу,
   без пароля — запрос; pass — только имя и пароль. 5 неверных паролей (с адреса или для имени) — вход закрыт на 10 мин.
   Полный журнал — оба файла (team-log.old.jsonl и team-log.jsonl), с поиском и отбором по событиям. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const FMT = 2; // вид песни для телефона; поменялся (новые поля) — меняются все отпечатки, телефоны докачают песни
// 2 — этап 4: тональность, темп, размер, аккорды (song.chords целиком; по слайдам раскладывает телефон — chords.js)
const ROLES = [
  { id: 'musician', name: 'Музыкант' },
  { id: 'pianist', name: 'Пианист' }, // песня с нотами открывается нотами на весь экран
  { id: 'vocal', name: 'Вокалист' },
  { id: 'leader', name: 'Лидер' },
  { id: 'sound', name: 'Звук' },
  { id: 'tech', name: 'Техник' },
];
// Право → у каких ролей есть; «управлять показом» (control) и «править аккорды» (chords) — не по роли, а галочкой у человека (ctl, chd)
const PERMS = { songs: ROLES.map((r) => r.id), control: [], chords: [], msg: ['leader', 'sound'], metro: ['leader', 'sound'] };
const MODES = ['qr', 'qrpass', 'pass'];
const LOCK_N = 5;            // неверных паролей подряд …
const LOCK_MS = 10 * 60e3;   // … — вход закрыт на 10 минут
const ONLINE_MS = 20e3;      // без WebSocket и запросов 20 с — не в сети (телефон шлёт ping раз в 15 с)
const PING_MS = 45e3;        // по WebSocket тишина 45 с — связь оборвалась, закрыть
const PEND_MS = 10 * 60e3;   // запрос на вход живёт 10 минут
const LOG_MAX = 512 * 1024;  // журнал больше — старое в team-log.old.jsonl

let o = {};        // { dir, libFile, store: { read, write }, notify(), on(), ver, cmd(c) }
let people = [];   // [{ id, name, role, at, ctl, chd }]
let devices = [];  // [{ id, person, name, hash, at, seen, ip, off, synced }]
let auth = { mode: 'qr' }; // как входят телефоны (team.json → auth)
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
const can = (person, perm) => !!person && (perm === 'control' ? !!person.ctl : perm === 'chords' ? !!person.chd : (PERMS[perm] || []).includes(person.role));
const personOf = (d) => people.find((p) => p.id === d.person) || null;

/* ----- Люди и устройства: team.json ----- */

function load() {
  const j = o.store.read();
  people = (Array.isArray(j.people) ? j.people : []).filter((p) => p && p.id && p.name)
    .map((p) => ({ id: String(p.id), name: clean(p.name, 40), role: roleOk(p.role) ? p.role : 'musician', at: Number(p.at) || 0, ctl: !!p.ctl, chd: !!p.chd,
      ...(/^[0-9a-f]{64}$/.test(p.ek || '') ? { ek: p.ek } : {}),
      ...(p.pw && /^[0-9a-f]{32}$/.test(p.pw.s) && /^[0-9a-f]{64}$/.test(p.pw.h) ? { pw: { s: p.pw.s, h: p.pw.h } } : {}) }));
  auth = { mode: j.auth && MODES.includes(j.auth.mode) ? j.auth.mode : 'qr' };
  devices = (Array.isArray(j.devices) ? j.devices : []).filter((d) => d && d.id && /^[0-9a-f]{64}$/.test(d.hash) && people.some((p) => p.id === d.person))
    .map((d) => ({ id: String(d.id), person: String(d.person), name: clean(d.name, 60), hash: d.hash, at: Number(d.at) || 0, seen: Number(d.seen) || 0, ip: String(d.ip || ''), off: !!d.off, synced: Number(d.synced) || 0 }));
  byHash.clear();
  for (const d of devices) byHash.set(d.hash, d);
}
function saveTeam() {
  seenDirty = false;
  o.store.write({ people, devices, auth });
}

/* ----- Пароли: scrypt (встроен в Node), соль на человека; неверные — счётчик и временная блокировка ----- */

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(String(pw).normalize('NFC'), Buffer.from(salt, 'hex'), 32, SCRYPT, (e, k) => (e ? no(e) : ok(k))));
async function pwMake(pw) {
  const s = crypto.randomBytes(16).toString('hex');
  return { s, h: (await scrypt(pw, s)).toString('hex') };
}
async function pwCheck(p, pw) {
  if (!p || !p.pw || !pw) return false;
  const k = await scrypt(pw, p.pw.s);
  return crypto.timingSafeEqual(k, Buffer.from(p.pw.h, 'hex'));
}
const fails = new Map(); // 'ip:…' / 'name:…' → { n, first, until }
function lockedMin(keys) {
  const now = Date.now();
  for (const k of keys) { const f = fails.get(k); if (f && f.until > now) return Math.ceil((f.until - now) / 60e3); }
  return 0;
}
function failed(keys, name, ip) {
  const now = Date.now();
  let lock = false;
  for (const k of keys) {
    let f = fails.get(k);
    if (!f || now - f.first > LOCK_MS) f = { n: 0, first: now, until: 0 };
    f.n++;
    if (f.n >= LOCK_N) { f.until = now + LOCK_MS; f.n = 0; f.first = now; lock = true; }
    fails.set(k, f);
  }
  if (fails.size > 2000) for (const [k, f] of fails) if (f.until < now && now - f.first > LOCK_MS) fails.delete(k);
  log('pwBad', { name, ip });
  if (lock) log('locked', { name, ip, min: LOCK_MS / 60e3 });
  o.notify();
}
const locks = () => { const now = Date.now(); return [...fails].filter(([, f]) => f.until > now).map(([k, f]) => ({ who: k.replace(/^(ip|name):/, ''), ip: k.startsWith('ip:'), min: Math.ceil((f.until - now) / 60e3) })); };

/* ----- Журнал: строка JSON на событие ----- */

const logFile = () => path.join(o.dir, 'team-log.jsonl');
function log(ev, x) {
  try {
    try { if (fs.statSync(logFile()).size > LOG_MAX) fs.renameSync(logFile(), path.join(o.dir, 'team-log.old.jsonl')); } catch { /* журнала ещё нет */ }
    fs.appendFileSync(logFile(), JSON.stringify({ at: Date.now(), ev, ...x }) + '\n');
  } catch { /* журнал не главное */ }
}
// Новые — первыми; q — найти текст, evs — только эти события; читаем и прошлый файл (team-log.old.jsonl)
function readLog(n = 200, q = '', evs = null) {
  let lines = [];
  for (const f of [path.join(o.dir, 'team-log.old.jsonl'), logFile()]) {
    try { lines = lines.concat(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)); } catch { /* нет файла */ }
  }
  const ql = String(q || '').toLowerCase().trim();
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    let x;
    try { x = JSON.parse(lines[i]); } catch { continue; } // испорченная строка
    if (evs && !evs.includes(x.ev)) continue;
    if (ql && !JSON.stringify(x).toLowerCase().includes(ql)) continue;
    out.push(x);
  }
  return out;
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
    const parts = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { no(new Error('big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') || {}); } catch (e) { no(e); } });
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
  // С паролем (режимы qrpass, pass) — сразу ключ, без оператора
  const pw = typeof b.pw === 'string' ? b.pw.slice(0, 200) : '';
  if (auth.mode === 'pass' || (auth.mode === 'qrpass' && pw)) {
    if (!pw) return send(req, res, 400, { error: 'pw', text: 'Впишите пароль' });
    const keys = ['ip:' + ip, 'name:' + name.toLowerCase()];
    const min = lockedMin(keys);
    if (min) return send(req, res, 429, { error: 'locked', text: `Слишком много неверных паролей. Попробуйте через ${min} мин. или попросите оператора снять блокировку` });
    const p = people.find((x) => x.name.toLowerCase() === name.toLowerCase());
    let ok = false;
    try { ok = await pwCheck(p, pw); } catch { ok = false; }
    if (!ok) { failed(keys, name, ip); return send(req, res, 403, { error: 'pw', text: 'Неверное имя или пароль' }); }
    for (const k of keys) fails.delete(k);
    const dev = clean(b.dev, 60) || 'Телефон';
    log('pwOk', { name: p.name, dev, ip });
    return send(req, res, 200, admit({ name: p.name, role: p.role, dev, ip }));
  }
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
  if (!p) { p = { id: newId(), name: r.name, role: r.role, at: Date.now(), ctl: false, chd: false }; people.push(p); }
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
let sheetFiles = new Map(); // имя листа нот (abc.jpg) → путь на диске — только листы песен (song.sheets)
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
const SHEET_RE = /^[\w-]{1,40}\.(jpg|png)$/;
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
  // Ноты: листы-картинки; телефон качает их отдельно (/api/v1/sheets/<f>) и хранит у себя
  const sh = (Array.isArray(s.sheets) ? s.sheets : []).filter((x) => x && typeof x.file === 'string' && SHEET_RE.test(path.basename(x.file)));
  if (sh.length) p.sheets = sh.map((x) => ({ f: path.basename(x.file), name: clean(x.name, 120), w: Number(x.w) || 0, h: Number(x.h) || 0 }));
  return p;
}

function apply(lib) {
  const items = lib && lib.items && typeof lib.items === 'object' ? lib.items : {};
  const now = new Map();
  const files = new Map();
  for (const it of Array.isArray(items) ? items : Object.values(items)) {
    if (!it || it.kind !== 'song' || !it.id) continue;
    now.set(String(it.id), songPay(it));
    for (const x of (it.song && Array.isArray(it.song.sheets) ? it.song.sheets : [])) if (x && typeof x.file === 'string') files.set(path.basename(x.file), x.file);
  }
  sheetFiles = files;
  let ch = false;
  for (const [id, p] of now) {
    const h = crypto.createHash('sha1').update(FMT + JSON.stringify(p)).digest('base64url').slice(0, 16);
    const old = sync.songs[id];
    if (!old || old[0] !== h) {
      const own = (expect.get(id) || 0) > Date.now();
      if (own) expect.delete(id);
      sync.songs[id] = [h, ++sync.seq, !old ? 0 : own ? Number(old[2]) || 0 : Date.now()];
      ch = true;
    }
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
// Файл библиотеки открытого профиля (main.js передаёт функцию: профиль можно переключить на ходу)
const libPath = () => (typeof o.libFile === 'function' ? o.libFile() : o.libFile);
function refresh() {
  let m = 0;
  try { m = fs.statSync(libPath()).mtimeMs; } catch { m = 0; }
  if (m === libSeen) return;
  let data = null;
  if (fresh && fresh.mtime === m) data = fresh.data;
  else if (m) { try { data = JSON.parse(fs.readFileSync(libPath(), 'utf8')); } catch { return; } } // пишется — в другой раз
  fresh = null;
  libSeen = m;
  apply(data || {});
}
function libSaved(data) {
  let m = 0;
  try { m = fs.statSync(libPath()).mtimeMs; } catch { /* нет файла */ }
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
  // Ключ подписи правок: телефон подписывает ими правку без связи, а донести до программы может любой телефон группы (putEdit)
  if (can(p, 'chords') && !p.ek) { p.ek = crypto.randomBytes(32).toString('hex'); saveTeam(); }
  return {
    device: { id: d.id, name: d.name },
    person: { id: p.id, name: p.name, role: p.role, roleName: roleName(p.role) },
    ...(can(p, 'chords') ? { ek: p.ek } : {}),
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
  if (p === '/join/info') return send(req, res, 200, { mode: auth.mode }); // экран входа: нужен ли пароль
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
  // Аккорды песни с телефона — только с правом «Может править аккорды»; пишет окно оператора (o.chords), отменяется Ctrl+Z
  if (p === '/songs/chords' && req.method === 'POST') { putChords(req, res, d, person); return; }
  // Ноты: лист-картинка (право смотреть песни) и добавить/убрать лист (то же право, что аккорды)
  if (p.startsWith('/sheets/') && req.method === 'GET') {
    if (!can(person, 'songs')) return send(req, res, 403, { error: 'perm', text: 'Нет права смотреть песни' });
    refresh();
    return getSheet(req, res, p.slice(8));
  }
  if (p === '/songs/sheets' && req.method === 'POST') { putSheets(req, res, d, person); return; }
  // Правка (аккорды, ноты), подписанная тем, кто может править; принести может любой телефон группы
  if (p === '/songs/edit' && req.method === 'POST') { putEdit(req, res, d, person); return; }
  send(req, res, 404, { error: 'nf' });
}
function getSheet(req, res, f) {
  const file = SHEET_RE.test(f) ? sheetFiles.get(f) : null;
  if (!file) return send(req, res, 404, { error: 'nf', text: 'Такого листа нот уже нет' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(req, res, 404, { error: 'nf', text: 'Файл листа нот пропал с диска' });
    // имя — по содержимому: лист не меняется, телефон хранит его у себя
    res.writeHead(200, { 'Content-Type': /\.png$/i.test(f) ? 'image/png' : 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}
// { id, add: { name, data: base64 (JPEG/PNG/PDF) } } или { id, del: имя листа }
const shBusy = new Set(); // устройства, чей лист сейчас сохраняется
async function putSheets(req, res, d, person) {
  if (!can(person, 'chords')) return send(req, res, 403, { error: 'perm', text: 'Править ноты разрешает оператор в окне «Группа»' });
  let b;
  try { b = await readBody(req, 40 * 1024 * 1024); } catch { return send(req, res, 400, { error: 'body', text: 'Файл слишком большой (больше 30 МБ) или не прочитался' }); }
  const id = String(b.id || '');
  const it = pay.get(id);
  if (!it) return send(req, res, 404, { error: 'nf', text: 'Такой песни в программе уже нет' });
  if (!o.sheets) return send(req, res, 503, { error: 'off', text: 'Программа не готова принять ноты — её нужно закрыть полностью и запустить заново (обновление не применилось)' });
  const c = { id, who: person.name };
  if (b.del) {
    if (!SHEET_RE.test(String(b.del))) return send(req, res, 400, { error: 'body', text: 'Нет такого листа' });
    c.del = String(b.del);
  } else {
    const a = b.add || {};
    const buf = typeof a.data === 'string' ? Buffer.from(a.data, 'base64') : null;
    if (!buf || buf.length < 100) return send(req, res, 400, { error: 'body', text: 'Пустой файл' });
    c.buf = buf;
    c.name = clean(a.name, 120);
  }
  // по одному запросу с телефона за раз (телефон и шлёт листы по очереди)
  if (shBusy.has(d.id)) return send(req, res, 429, { error: 'rate', text: 'Подождите — предыдущий лист ещё сохраняется' });
  shBusy.add(d.id);
  try {
    const r = await o.sheets(c);
    log('sheets', { name: person.name, song: it.name, n: (r && r.n) || 0, del: !!c.del });
    send(req, res, 200, { ok: true, ...(r || {}) });
  } catch (e) { send(req, res, 503, { error: 'off', text: (e && e.message) || 'Окно программы не ответило' }); } finally { shBusy.delete(d.id); }
}
async function putChords(req, res, d, person) {
  if (!can(person, 'chords')) return send(req, res, 403, { error: 'perm', text: 'Править аккорды разрешает оператор в окне «Группа»' });
  let b;
  try { b = await readBody(req, 160 * 1024); } catch { return send(req, res, 400, { error: 'body', text: 'Не получилось прочитать запрос' }); }
  const id = String(b.id || '');
  const it = pay.get(id);
  if (!it) return send(req, res, 404, { error: 'nf', text: 'Такой песни в программе уже нет' });
  if (typeof b.chords !== 'string' || b.chords.length > 30000) return send(req, res, 400, { error: 'body', text: 'Аккорды слишком длинные' });
  if (Date.now() - (d.chAt || 0) < 800) return send(req, res, 429, { error: 'rate', text: 'Подождите секунду' });
  d.chAt = Date.now();
  if (!o.chords) return send(req, res, 503, { error: 'off', text: 'Программа не готова принять аккорды — её нужно закрыть полностью и запустить заново (обновление не применилось)' });
  try {
    const r = await o.chords({ id, chords: b.chords.split(String.fromCharCode(13)).join('').trimEnd(), who: person.name, ...(typeof b.key === 'string' ? { key: clean(b.key, 8) } : {}) });
    log('chords', { name: person.name, song: it.name, clear: !b.chords.trim() });
    send(req, res, 200, { ok: true, ...(r || {}) });
  } catch (e) { send(req, res, 503, { error: 'off', text: (e && e.message) || 'Окно программы не ответило' }); }
}

/* ----- Правка без связи: подписана ключом того, кто правил (ek), приносит любой телефон ----- */
/* e = { v: 1, lib, sid, at, by, bn, chords, key, sh, sig }: sh — листы нот целиком ([['f', файл, имя] — уже есть в программе,
   ['h', sha256, имя] — новый, байты в data[h]]) или null (листы не трогать: правка из ссылки). sig = HMAC-SHA256(ek, editMsg(e)).
   Порядок: правка ставится, только если она новее последней принятой (ранг: at*2 + есть ли листы) и новее изменения песни
   в программе (sync.songs[id][2]). Старая или уже принятая — ответ ok, телефон её просто убирает. */
let edits = { songs: {} }; // id песни → { r: ранг, sig } — последняя принятая правка
const expect = new Map();  // id песни → до какого времени изменение песни — наша правка (apply не двигает время программы)
const edBusy = new Set();
const HEX64 = /^[0-9a-f]{64}$/;
const editsFile = () => path.join(o.dir, 'team-edits.json');
function loadEdits() {
  edits = { songs: {} };
  try { const j = JSON.parse(fs.readFileSync(editsFile(), 'utf8')); if (j && j.songs && typeof j.songs === 'object') edits = { songs: j.songs }; } catch { /* нет файла */ }
}
function saveEdits() {
  try { fs.writeFileSync(editsFile() + '.tmp', JSON.stringify(edits)); fs.renameSync(editsFile() + '.tmp', editsFile()); } catch { /* не записалось */ }
}
const editMsg = (e) => JSON.stringify(['mps-edit', 1, e.lib, e.sid, e.at, e.by, e.chords, e.key, e.sh]);
function editShape(e) {
  return !!e && typeof e.lib === 'string' && typeof e.sid === 'string' && Number.isSafeInteger(e.at) && e.at >= 0 && typeof e.by === 'string'
    && typeof e.chords === 'string' && e.chords.length <= 30000 && typeof e.key === 'string' && e.key.length <= 12 && typeof e.sig === 'string' && HEX64.test(e.sig)
    && (e.sh === null || (Array.isArray(e.sh) && e.sh.length <= 60 && e.sh.every((x) => Array.isArray(x) && x.length === 3 && typeof x[2] === 'string' && x[2].length <= 200
      && ((x[0] === 'f' && SHEET_RE.test(String(x[1]))) || (x[0] === 'h' && HEX64.test(String(x[1])))))));
}
async function putEdit(req, res, d, person) {
  if (!can(person, 'songs')) return send(req, res, 403, { error: 'perm', text: 'Нет права смотреть песни' });
  let b;
  try { b = await readBody(req, 60 * 1024 * 1024); } catch { return send(req, res, 400, { error: 'body', text: 'Правка слишком большая или не прочиталась' }); }
  const e = b.e;
  if (!editShape(e)) return send(req, res, 400, { error: 'body', text: 'Правка повреждена' });
  refresh();
  const drop = (why, text) => send(req, res, 200, { ok: false, drop: true, why, text });
  if (e.lib !== sync.lib) return drop('other', 'Правка сделана для другой программы — сюда не подходит');
  const signer = people.find((x) => x.id === e.by);
  if (!signer || !signer.ek) return drop('who', 'Того, кто правил, в программе уже нет');
  const want = crypto.createHmac('sha256', Buffer.from(signer.ek, 'hex')).update(editMsg(e)).digest();
  if (!crypto.timingSafeEqual(want, Buffer.from(e.sig, 'hex'))) { log('editBad', { name: person.name, dev: d.name }); return drop('sig', 'Правка повреждена или изменена после подписи — не принята'); }
  if (!can(signer, 'chords')) return drop('perm', `У «${signer.name}» больше нет права править аккорды и ноты — правка не принята`);
  const it = pay.get(e.sid);
  if (!it) return drop('nf', 'Такой песни в программе уже нет');
  const rank = e.at * 2 + (e.sh ? 1 : 0);
  const st = edits.songs[e.sid] || { r: 0, sig: '' };
  if (st.sig === e.sig) return send(req, res, 200, { ok: true, same: true });
  const progAt = Number((sync.songs[e.sid] || [])[2]) || 0;
  if (rank <= st.r || e.at <= progAt) return send(req, res, 200, { ok: true, old: true });
  // Листы: уже есть в программе — путь к файлу; новые — байты, сверка sha256
  let sheets = null;
  if (e.sh) {
    sheets = [];
    const data = b.data && typeof b.data === 'object' ? b.data : {};
    for (const [k, v, name] of e.sh) {
      if (k === 'f') { const file = sheetFiles.get(v); if (file) sheets.push({ file, name: clean(name, 120) }); continue; }
      const buf = typeof data[v] === 'string' ? Buffer.from(data[v], 'base64') : null;
      if (!buf || crypto.createHash('sha256').update(buf).digest('hex') !== v) return send(req, res, 400, { error: 'body', text: 'В правке не хватает листа нот — попросите прислать файл, а не ссылку' });
      sheets.push({ buf, name: clean(name, 120) || 'Ноты' });
    }
  }
  if (!o.edit) return send(req, res, 503, { error: 'off', text: 'Программа не готова принять правку — её нужно закрыть полностью и запустить заново (обновление не применилось)' });
  if (edBusy.has(e.sid)) return send(req, res, 429, { error: 'rate', text: 'Подождите — эта песня ещё сохраняется' });
  edBusy.add(e.sid);
  expect.set(e.sid, Date.now() + 30e3);
  try {
    await o.edit({ id: e.sid, chords: e.chords.split(String.fromCharCode(13)).join('').trimEnd(), key: clean(e.key, 8), sheets, who: signer.name, via: person.name });
    edits.songs[e.sid] = { r: rank, sig: e.sig };
    saveEdits();
    log('edit', { name: person.name, by: signer.name, song: it.name, sh: !!sheets });
    send(req, res, 200, { ok: true, applied: true });
  } catch (err) {
    expect.delete(e.sid);
    send(req, res, 503, { error: 'off', text: (err && err.message) || 'Окно программы не ответило' });
  } finally { edBusy.delete(e.sid); }
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
      ctl: !!p.ctl, chd: !!p.chd, pw: !!p.pw,
      devices: devices.filter((d) => d.person === p.id).map((d) => ({ id: d.id, name: d.name, ip: d.ip, at: d.at, seen: d.seen, off: d.off, synced: d.synced, online: isOn(d, now) })),
    })),
    online: devices.filter((d) => isOn(d, now)).length,
    songs: pay.size,
    auth: { ...auth }, locks: locks(),
    msgs: msgs.slice(-40), metro: { ...metro },
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
      if (typeof a.chd === 'boolean' && a.chd !== !!p.chd) { p.chd = a.chd; log(p.chd ? 'chdOn' : 'chdOff', { name: p.name }); }
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
    case 'log': return readLog(Math.min(20000, Number(a.n) || 200), a.q, Array.isArray(a.evs) ? a.evs.map(String) : null);
    case 'mode': {
      if (!MODES.includes(a.mode)) throw new Error('Неизвестный режим входа');
      if (a.mode !== 'qr' && !people.some((x) => x.pw)) throw new Error('Сначала задайте пароль хотя бы одному человеку (кнопка «Пароль» у человека)');
      auth.mode = a.mode;
      saveTeam();
      log('mode', { mode: a.mode });
      break;
    }
    case 'password': return setPw(per(), a.pw);
    case 'unlock': fails.clear(); log('unlock', {}); break;
    case 'msg': if (!postMsg('Оператор', 'op', a.text)) throw new Error('Пустое сообщение'); return null;
    case 'metro': setMetro(a, 'Оператор'); return null;
    default: throw new Error('Неизвестное действие');
  }
  o.notify();
  return null;
}

// Пароль человеку ('' — убрать). Последний пароль не убрать, пока вход только по паролю
async function setPw(p, pw) {
  const s = String(pw == null ? '' : pw);
  if (!s) {
    if (auth.mode !== 'qr' && !people.some((x) => x !== p && x.pw)) throw new Error('Это последний пароль, а вход сейчас по паролю — сначала смените режим входа');
    delete p.pw;
    log('pwDel', { name: p.name });
  } else {
    if (s.length < 4) throw new Error('Пароль — не короче 4 знаков');
    p.pw = await pwMake(s.slice(0, 200));
    log('pwSet', { name: p.name });
  }
  saveTeam();
  o.notify();
  return null;
}

/* ----- Сообщения группе и метроном ----- */

let msgs = [];  // последние 50: { id, at, from, role, text }
let metro = { on: false, bpm: 0, beats: 4, t0: 0, by: '' };
function postMsg(from, role, text) {
  const t = clean(text, 300);
  if (!t) return null;
  const m = { id: newId(), at: Date.now(), from, role, text: t };
  msgs.push(m);
  if (msgs.length > 50) msgs.shift();
  broadcast({ t: 'msg', msg: m }, 'songs');
  log('msg', { name: from, text: t });
  o.notify();
  return m;
}
const recentMsgs = () => msgs.filter((m) => Date.now() - m.at < 6 * 3600e3).slice(-20);
// Общий метроном: удары от t0 (время программы) — телефоны считают сами, со своей поправкой часов (ping/pong)
function setMetro(x, by) {
  const on = !!x.on;
  const bpm = Math.round(Number(x.bpm));
  const beats = Math.round(Number(x.beats));
  if (on && !(bpm >= 30 && bpm <= 300)) throw new Error('Темп — от 30 до 300 ударов в минуту');
  metro = on ? { on: true, bpm, beats: beats >= 1 && beats <= 12 ? beats : 4, t0: Date.now() + 800, by } : { ...metro, on: false, by };
  broadcast({ t: 'metro', metro, time: Date.now() }, 'songs');
  log(on ? 'metroOn' : 'metroOff', { name: by, bpm: on ? bpm : undefined });
  o.notify();
}

/* ----- WebSocket /ws: протокол v1 ----------
   Телефон → программа: { t: 'hello', v: 1, token } (первым, иначе закрываем), { t: 'ping', id } раз в 15 с,
   { t: 'cmd', cmd: 'next'|'prev'|'show'|'clear', item, sid } — только с правом «управлять показом».
   Программа → телефон: welcome { v, me, live, sets, sh, time } · live { live } — что на экране (у песни — id слайда,
   у Библии и своих слайдов — ещё и их текст, когда пункт сменился; same: true — текст тот же, что в прошлый раз) ·
   lib { lib, seq, lh } — песни поменялись, докачать · sets { sets, sh } · me { me } — роль или права поменялись ·
   pong { id, time } · err { text } · bye { code, text } — перед закрытием: auth (ключ отозван), off (приостановлен),
   closed (доступ выключен). Ключ — в первом сообщении, не в адресе (адреса попадают в журналы).
   Этап 6: телефон → { t: 'msg', text } (право msg: Лидер, Звук), { t: 'metro', on, bpm, beats } (право metro);
   программа → msg { msg: { id, at, from, role, text } } · metro { metro: { on, bpm, beats, t0, by }, time };
   в welcome — ещё msgs (последние за 6 часов) и metro. */

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
    wsSend(c, { t: 'welcome', v: 1, me: me(c.d, a.p), live, sets, sh, msgs: recentMsgs(), metro, time: Date.now() });
    return;
  }
  const p = personOf(c.d);
  if (!p || !byHash.has(c.d.hash) || c.d.off) { kick((x) => x === c, c.d.off ? 'off' : 'auth'); return; }
  touch(c.d, c.ip);
  if (m.t === 'ping') { wsSend(c, { t: 'pong', id: m.id, time: Date.now() }); return; }
  if (m.t === 'msg') {
    if (!can(p, 'msg')) { wsSend(c, { t: 'err', text: 'Писать группе могут Лидер и Звук' }); return; }
    if (Date.now() - (c.msgAt || 0) < 1500) return; // не чаще раза в полторы секунды
    c.msgAt = Date.now();
    postMsg(p.name, p.role, m.text);
    return;
  }
  if (m.t === 'metro') {
    if (!can(p, 'metro')) { wsSend(c, { t: 'err', text: 'Общий метроном включают Лидер и Звук' }); return; }
    try { setMetro(m, p.name); } catch (e) { wsSend(c, { t: 'err', text: e.message }); }
    return;
  }
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
  loadEdits();
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
  _test: { refresh, apply, editMsg, edits: () => edits, pending, sync: () => sync, pay: () => pay, socks, sets: () => sets, live: () => live, fails } };
