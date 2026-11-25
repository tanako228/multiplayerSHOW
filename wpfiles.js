/* ---------- Удалённый режим, этап R2: файлы компьютера A для окна компьютера B ----------
   Команды выполняет A — он показывает оригиналы со своего диска. Окну B файлы A нужны только для превью: картинки
   слайдов, видео, музыка, шрифты, ноты. Окно B просит их обычными адресами file:///C:/… (как у себя); главный процесс B
   перехватывает протокол file: (main.js: protocol.handle) и берёт файл у A по HTTP:
     GET /wpf/<ключ сеанса>/<путь в base64url>   — тот же http-сервер пульта (порт 8090…)
   С Range (видео перематывается сразу, без загрузки целиком) и ETag (повторно — «не изменился», 304).
   A отдаёт не «любой файл диска», а только:
     - файлы с расширениями медиа, картинок, шрифтов, PDF;
     - из папки данных программы A, или из папки, которая упомянута в данных A (библиотека, общие данные,
       настройки окна — там пути медиапула, музыки, файлов презентаций); сам файл тоже может быть упомянут.
   Ключ сеанса — новый при каждом подключении B (workplace.js), без него — 403.
   На B: маленькие файлы (до 4 МБ, всего до 200 МБ) помнятся в памяти и сверяются с A по ETag; файлы самой программы
   (её папка) — всегда свои. */
'use strict';
const fs = require('fs');
const path = require('path');

const EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico',
  'mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv',
  'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus',
  'ttf', 'otf', 'woff', 'woff2', 'pdf']);
const TYPE = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  avif: 'image/avif', ico: 'image/x-icon', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', opus: 'audio/ogg', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', pdf: 'application/pdf',
};
const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');
const low = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

/* ======================= Хост A ======================= */
// o: { key() — ключ сеанса, их список (управляющий и зрители) или '' (никого), roots() — папки, откуда можно всё, dataFiles() — файлы данных }
function host(o) {
  let stamp = '';
  let texts = [];
  const okDirs = new Map(); // папка → можно ли (сбрасывается, когда данные поменялись)

  function refresh() {
    const files = o.dataFiles();
    const st = files.map((f) => { try { const s = fs.statSync(f); return f + ':' + s.mtimeMs + ':' + s.size; } catch { return f + ':-'; } }).join('|');
    if (st === stamp) return;
    stamp = st;
    okDirs.clear();
    texts = [];
    for (const f of files) { try { texts.push(low(fs.readFileSync(f, 'utf8'))); } catch { /* нет файла */ } }
  }
  // Упомянут ли путь в данных ЦЕЛИКОМ — отдельным значением, а не началом другого пути (иначе любая песня с
  // файлом из «Документов» открыла бы всю папку пользователя). Формы: C:\a\b, C:/a/b, file:///C:/a/b (и с %20),
  // с косой на конце; в JSON библиотеки (экранировано раз) и в настройках окна (строка JSON внутри JSON — дважды)
  const esc = (s) => JSON.stringify(s).slice(1, -1);
  function needles(p) {
    const lp = low(p);
    const fwd = lp.replace(/\\/g, '/');
    const out = [];
    for (const lvl of [1, 2]) {
      const e = (s) => (lvl === 1 ? esc(s) : esc(esc(s)));
      const q = lvl === 1 ? '"' : '\\"';
      for (const f of [lp, fwd]) for (const tail of ['', f === fwd ? '/' : '\\']) out.push(q + e(f + tail) + q);
      for (const f of [fwd, low(encodeURI(fwd))]) out.push(e('file:///' + f) + q, e('file:///' + f + '/') + q);
    }
    return out;
  }
  function mentioned(p) {
    const ns = needles(p);
    return texts.some((t) => ns.some((n) => t.includes(n)));
  }
  function allowed(p) {
    if (!EXT.has(extOf(p))) return false;
    const lp = low(p);
    for (const r of o.roots()) { const lr = low(path.resolve(r)); if (lp === lr || lp.startsWith(lr + path.sep)) return true; }
    refresh();
    if (mentioned(p)) return true;
    // Папка-предок упомянута (медиапул, музыка, папка презентации); корень диска и первая папка за ним не в счёт
    let d = path.dirname(p);
    while (d && path.dirname(d) !== d && path.dirname(path.dirname(d)) !== path.dirname(d)) {
      let ok = okDirs.get(low(d));
      if (ok === undefined) { ok = mentioned(d); okDirs.set(low(d), ok); }
      if (ok) return true;
      d = path.dirname(d);
    }
    return false;
  }

  // Из main.js: rmHandle — наш ли запрос (/wpf/…)
  function serve(req, res, u) {
    if (!u.pathname.startsWith('/wpf/')) return false;
    const end = (code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text || ''); return true; };
    if (req.method !== 'GET' && req.method !== 'HEAD') return end(405);
    if (req.headers.origin) return end(403); // страница браузера — не программа B
    const m = /^\/wpf\/([0-9a-f]{32})\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
    const keys = [].concat(o.key() || []).filter(Boolean); // управляющий и зрители (R5)
    if (!m || !keys.includes(m[1])) return end(403);
    let p;
    try { p = unb64(m[2]); } catch { return end(400); }
    if (!p || p.includes('\0') || !path.isAbsolute(p)) return end(400);
    p = path.resolve(p);
    if (!allowed(p)) return end(403, 'Этот файл компьютер A не раздаёт');
    fs.stat(p, (err, st) => {
      if (err || !st.isFile()) { end(404); return; }
      const etag = '"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
      const head = { 'Content-Type': TYPE[extOf(p)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'no-cache' };
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (!range && req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
      let a = 0;
      let b = st.size - 1;
      let code = 200;
      if (range) {
        if (range[1] === '' && range[2] !== '') { a = Math.max(0, st.size - Number(range[2])); } else { a = Number(range[1] || 0); if (range[2] !== '') b = Math.min(b, Number(range[2])); }
        if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); res.end(); return; }
        code = 206;
        head['Content-Range'] = 'bytes ' + a + '-' + b + '/' + st.size;
      }
      head['Content-Length'] = st.size ? b - a + 1 : 0;
      res.writeHead(code, head);
      if (req.method === 'HEAD' || !st.size) { res.end(); return; }
      const s = fs.createReadStream(p, { start: a, end: b });
      s.on('error', () => res.destroy());
      res.on('close', () => s.destroy());
      s.pipe(res);
    });
    return true;
  }
  return { serve, allowed };
}

/* ======================= Клиент B ======================= */
// o: { base() — 'http://адрес/wpf/ключ/' или '' (не управляем), appDirs — папки программы, local(req) — обычный file: }
const CACHE_ONE = 4 * 1024 * 1024;
const CACHE_ALL = 200 * 1024 * 1024;
function client(o) {
  const cache = new Map(); // путь → { etag, type, buf } (порядок — давность)
  let size = 0;
  const put = (p, x) => {
    const old = cache.get(p);
    if (old) { size -= old.buf.length; cache.delete(p); }
    cache.set(p, x);
    size += x.buf.length;
    for (const [k, v] of cache) { if (size <= CACHE_ALL) break; cache.delete(k); size -= v.buf.length; }
  };
  const isApp = (p) => o.appDirs.some((d) => { const ld = low(d); const lp = low(p); return lp === ld || lp.startsWith(ld + path.sep); });
  const pathOf = (url) => {
    try { const u = new URL(url); u.search = ''; u.hash = ''; return require('url').fileURLToPath(u); } catch { return ''; }
  };
  const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag'];

  async function handle(req) {
    const base = o.base();
    const p = pathOf(req.url);
    if (!base || !p || isApp(p) || req.method !== 'GET') return o.local(req);
    const range = req.headers.get('range');
    const hit = range ? null : cache.get(p);
    const headers = {};
    if (range) headers.Range = range;
    if (hit) headers['If-None-Match'] = hit.etag;
    let r;
    try { r = await fetch(base + b64(p), { headers, signal: req.signal }); } catch (e) {
      if (hit) return new Response(hit.buf, { status: 200, headers: { 'Content-Type': hit.type } }); // нет связи — что помним
      return new Response('', { status: 502 });
    }
    if (r.status === 304 && hit) {
      cache.delete(p); cache.set(p, hit); // свежий — в конец очереди
      return new Response(hit.buf, { status: 200, headers: { 'Content-Type': hit.type, 'Content-Length': String(hit.buf.length) } });
    }
    const h = {};
    for (const k of pass) { const v = r.headers.get(k); if (v) h[k] = v; }
    const len = Number(r.headers.get('content-length') || -1);
    if (r.status === 200 && !range && len >= 0 && len <= CACHE_ONE && r.headers.get('etag')) {
      const buf = Buffer.from(await r.arrayBuffer());
      put(p, { etag: r.headers.get('etag'), type: h['content-type'] || '', buf });
      return new Response(buf, { status: 200, headers: h });
    }
    return new Response(r.body, { status: r.status, headers: h });
  }
  return { handle, clear: () => { cache.clear(); size = 0; }, stats: () => ({ n: cache.size, size }) };
}

/* ======================= R3: обзор папок A и файлы, перетащенные на B ======================= */

// Окно обзора на B (wpbrowse.js) — содержимое папки A. Только пока открыт выбор файлов (workplace.js: dialogPending)
function listDir(dir) {
  const p = path.resolve(String(dir || ''));
  const out = { dir: p, parent: path.dirname(p) === p ? '' : path.dirname(p), entries: [], error: '' };
  let names;
  try { names = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { out.error = e.code === 'EPERM' || e.code === 'EACCES' ? 'Нет доступа к папке' : 'Папка не открывается'; return out; }
  for (const d of names) {
    if (d.name.startsWith('$') || /^(desktop\.ini|thumbs\.db)$/i.test(d.name)) continue;
    const full = path.join(p, d.name);
    let isDir = d.isDirectory();
    let size = 0;
    let mtime = 0;
    try { const st = fs.statSync(full); isDir = st.isDirectory(); size = isDir ? 0 : st.size; mtime = st.mtimeMs; } catch { if (!isDir && !d.isFile()) continue; }
    out.entries.push({ name: d.name, dir: isDir, size, mtime });
  }
  out.entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (out.entries.length > 5000) out.entries.length = 5000;
  return out;
}
// Диски (Windows) — для левой колонки окна обзора
function drives() {
  if (process.platform !== 'win32') return ['/'];
  const out = [];
  for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; try { fs.accessSync(d); out.push(d); } catch { /* нет диска */ } }
  return out;
}

// Перетащенный на B файл: где он будет на A — <папка приёма>\<метка>\<имя>; метка — от пути, размера и времени на B,
// чтобы один и тот же файл не грузился дважды, а одинаковые имена из разных папок не путались
const cleanName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\0]/g, '_').replace(/^\.+/, '_').slice(0, 180) || 'file';
function uploadName(local, st) {
  const h = require('crypto').createHash('sha1').update(local + '|' + st.size + '|' + st.mtimeMs).digest('hex').slice(0, 10);
  return h + '/' + cleanName(path.basename(local));
}
// A: PUT /wpu/<ключ>/<метка>/<имя в base64url> — тело запроса пишется в папку приёма
function uploadServe(o) {
  return (req, res, u) => {
    if (!u.pathname.startsWith('/wpu/')) return false;
    const end = (code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text || ''); return true; };
    if (req.method !== 'PUT' || req.headers.origin) return end(403);
    const m = /^\/wpu\/([0-9a-f]{32})\/([0-9a-f]{10})\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
    const key = o.key();
    if (!m || !key || m[1] !== key) return end(403);
    let name;
    try { name = cleanName(unb64(m[3])); } catch { return end(400); }
    const dir = path.join(o.dir(), m[2]);
    const file = path.join(dir, name);
    const want = Number(req.headers['content-length']);
    try {
      const st = fs.statSync(file);
      if (st.size === want) { req.resume(); return end(200, 'есть'); } // уже передан в этом или прошлом сеансе
    } catch { /* нет — пишем */ }
    try { fs.mkdirSync(dir, { recursive: true }); } catch { return end(500); }
    const tmp = file + '.part';
    const w = fs.createWriteStream(tmp);
    let got = 0;
    req.on('data', (c) => { got += c.length; });
    req.pipe(w);
    const fail = () => { try { w.destroy(); fs.unlinkSync(tmp); } catch { /* уже */ } };
    req.on('aborted', fail);
    w.on('error', () => { fail(); end(500); });
    w.on('finish', () => {
      if (Number.isFinite(want) && got !== want) { fail(); end(400, 'файл пришёл не целиком'); return; }
      try { fs.renameSync(tmp, file); } catch { fail(); end(500); return; }
      end(200, 'ok');
    });
    return true;
  };
}
// B: отправить файл на A (поток, без чтения целиком в память)
function uploadSend(local, url) {
  return new Promise((ok, fail) => {
    let st;
    try { st = fs.statSync(local); } catch (e) { fail(e); return; }
    const u = new URL(url);
    const req = require('http').request({ host: u.hostname, port: u.port, path: u.pathname, method: 'PUT', headers: { 'Content-Length': st.size } }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode === 200 ? ok() : fail(new Error('компьютер A не принял файл (' + res.statusCode + ')'))));
    });
    req.on('error', fail);
    fs.createReadStream(local).on('error', (e) => { req.destroy(e); }).pipe(req);
  });
}

module.exports = { host, client, b64, unb64, EXT, listDir, drives, uploadName, uploadServe, uploadSend };
