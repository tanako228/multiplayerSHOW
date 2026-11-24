/* ---------- Источник данных программы для ядра синхронизации (sync/core.js) ----------
   Превращает данные открытого профиля в «документы» с ключами и обратно:
     lib/items/<id>          — каждая презентация отдельно (правки разных песен не спорят)
     lib/<ключ>/<id>         — элемент списка с id (плейлисты, библиотеки, темы, макросы, экраны…)
     lib/<ключ>#order        — порядок такого списка (массив id)
     lib/<ключ>              — остальное целиком
     set/<ключ>              — настройка окна (cp.settings)
     ls/<ключ>               — запись localStorage «cp.*» (закладки, рисунки, списки…)
     bible/index, bible/<id>.json — список переводов и сами переводы
     file/ud/<путь>          — файл из папки программы (слайды, картинки, ноты, карты, шрифты)
     file/x/<метка>/<имя>    — файл из другого места (D:\Видео\…): на других компьютерах ляжет в <папка программы>\media\cloud

   Пути к файлам внутри данных хранятся в облаке «переносимыми»:
     mps:ud/<путь>, mps:udu/<путь> (как file:///…) — внутри папки программы, на каждом компьютере свой путь к ней;
     mps:x/<метка>/<имя>, mps:xu/…                   — из другого места; метка — от исходного пути.
   У каждого компьютера своя карта «метка → где файл лежит здесь» (xmap), поэтому скачанный файл снова превращается
   в ту же метку и обратно не «меняется».

   Файлы и переводы синхронизация не удаляет никогда (удаление в облаке — только у данных): файл может быть нужен тому,
   что не синхронизируется (экраны, раскладка). Пришедшие данные копятся и применяются в finish() одним разом поверх
   свежей библиотеки; настройки и localStorage — возвращаются окну (их пишет само окно, как при восстановлении).

   deps: { ud, libView(), saveLib(obj), ls (снимок cp.* окна), readIndex(), writeIndex(list), bibleDir,
           owner(kind, key) → часть (REPO_PARTS из main.js), parts: Set частей, stateFile, conflictDir, now? } */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { sha1 } = require('./core.js');

const DICT = new Set(['items', 'themesLive', 'fileMacros']); // объекты «id → запись»
const LIB_SKIP = new Set(['view', 'lastPl']);                 // что открыто сейчас — у каждого компьютера своё
const SET_SKIP = new Set(['repo', 'backupParts', 'cloud']);
const LS_SKIP = new Set(['cp.settings', 'cp.repoLast', 'cp.profile']);
const MAX_FILE = 500 * 1024 * 1024; // больше — не отправляем (видео лучше переносить иначе)

const enc = encodeURIComponent;
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const idArray = (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && !Array.isArray(x) && x.id != null);
const lsParse = (v) => { try { const x = JSON.parse(v); return x && typeof x === 'object' ? x : v; } catch { return v; } };
const lsText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const safeName = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').slice(0, 150);
const okRel = (rel) => rel.split('/').every((s) => s && s !== '.' && s !== '..' && !/[\\:]/.test(s));
const TOKEN_RE = /^mps:(ud|udu|x|xu)\/([^#]+)(#.*)?$/;

async function writeAtomic(file, buf) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, file);
}

function createAppSource(d) {
  const now = d.now || Date.now;
  const UD = path.resolve(d.ud);
  const udLow = UD.toLowerCase() + path.sep;
  let st = { lt: {}, fh: {}, xmap: {} };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(d.stateFile, 'utf8')) }; } catch { /* первый раз */ }
  const xrev = new Map(Object.entries(st.xmap).map(([tok, p]) => [String(p).toLowerCase(), tok]));

  const bufs = new Map();   // ключ → Buffer (данные в переносимом виде)
  const files = new Map();  // ключ → абсолютный путь (файлы и переводы)
  const ops = [];           // пришедшие данные: { key, val } (val undefined — удалён)
  const skipped = [];       // слишком большие файлы
  const stamp = new Date(now()).toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const out = { lib: 0, set: {}, ls: {}, dropSet: [], dropLs: [], files: 0, bibles: 0, kept: 0, skipped };

  const partOf = (key) => {
    const m = /^(lib|set|ls)\/([^/#]+)/.exec(key);
    if (m) return d.owner(m[1], m[1] === 'ls' ? dec(m[2]) : m[2]);
    if (key.startsWith('file/')) return 'files';
    if (key.startsWith('bible/')) return 'bibles';
    return null;
  };
  const include = (key) => d.parts.has(partOf(key));

  // Где лежит файл с этой переносимой меткой здесь
  function localOf(kind, rel) {
    if (!okRel(rel)) return null;
    if (kind === 'ud' || kind === 'udu') return path.join(UD, ...rel.split('/'));
    const tok = rel; // <метка>/<имя>
    if (st.xmap[tok] && fs.existsSync(st.xmap[tok])) return st.xmap[tok];
    const p = path.join(UD, 'media', 'cloud', rel.replace('/', '-'));
    st.xmap[tok] = p; xrev.set(p.toLowerCase(), tok);
    return p;
  }

  // Строка — путь к существующему файлу? → { tok, key, abs }
  function tokenize(s) {
    let abs = null;
    let frag = '';
    const url = s.startsWith('file:///');
    if (url) { const i = s.indexOf('#'); if (i >= 0) frag = s.slice(i); try { abs = fileURLToPath(i >= 0 ? s.slice(0, i) : s); } catch { return null; } }
    else if (/^[A-Za-z]:[\\/]/.test(s)) abs = s;
    else return null;
    try { if (!fs.statSync(abs).isFile()) return null; } catch { return null; }
    const low = path.resolve(abs).toLowerCase();
    const known = xrev.get(low); // чужой файл, скачанный сюда (лежит в media\cloud), — с прежней меткой
    if (known) return { tok: `mps:${url ? 'xu' : 'x'}/${known}${frag}`, key: 'file/x/' + known, abs };
    if (low.startsWith(udLow)) {
      const rel = path.resolve(abs).slice(udLow.length).split(path.sep).join('/');
      return { tok: `mps:${url ? 'udu' : 'ud'}/${rel}${frag}`, key: 'file/ud/' + rel, abs };
    }
    let tok = xrev.get(low);
    if (!tok) {
      tok = crypto.createHash('md5').update(low).digest('hex').slice(0, 8) + '/' + safeName(path.basename(abs));
      st.xmap[tok] = abs; xrev.set(low, tok);
    }
    return { tok: `mps:${url ? 'xu' : 'x'}/${tok}${frag}`, key: 'file/x/' + tok, abs };
  }

  function portable(v, refs) {
    if (typeof v === 'string') { const t = tokenize(v); if (!t) return v; refs.set(t.key, t.abs); return t.tok; }
    if (Array.isArray(v)) return v.map((x) => portable(x, refs));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, portable(x, refs)]));
    return v;
  }
  function localize(v) {
    if (typeof v === 'string') {
      const m = TOKEN_RE.exec(v);
      if (!m) return v;
      const p = localOf(m[1], m[2]);
      if (!p) return v;
      return m[1] === 'udu' || m[1] === 'xu' ? pathToFileURL(p).href + (m[3] || '') : p;
    }
    if (Array.isArray(v)) return v.map(localize);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x)]));
    return v;
  }

  // Когда документ менялся: хэш тот же — прежнее время, другой — сейчас
  function stampOf(key, h, t) {
    const o = st.lt[key];
    if (o && o.h === h) return o.t;
    st.lt[key] = { h, t: t || now() };
    return st.lt[key].t;
  }

  async function fileMeta(key, abs, res) {
    let s;
    try { s = await fs.promises.stat(abs); } catch { return; }
    if (!s.isFile()) return;
    if (s.size > MAX_FILE) { skipped.push({ key, size: s.size }); return; }
    const c = st.fh[abs];
    let h;
    if (c && c.size === s.size && c.mtime === s.mtimeMs) h = c.h;
    else {
      h = await new Promise((ok, bad) => {
        const hs = crypto.createHash('sha1');
        fs.createReadStream(abs).on('data', (b) => hs.update(b)).on('end', () => ok(hs.digest('hex'))).on('error', bad);
      });
      st.fh[abs] = { size: s.size, mtime: s.mtimeMs, h };
    }
    files.set(key, abs);
    res.set(key, { h, t: stampOf(key, h, Math.round(s.mtimeMs)), z: s.size });
  }

  async function scan() {
    bufs.clear(); files.clear();
    const res = new Map();
    const refs = new Map();
    const put = (key, val) => {
      if (!include(key)) return;
      const buf = Buffer.from(JSON.stringify(portable(val, refs)));
      const h = sha1(buf);
      bufs.set(key, buf);
      res.set(key, { h, t: stampOf(key, h), z: buf.length });
    };

    const lib = d.libView() || {};
    for (const [k, v] of Object.entries(lib)) {
      if (LIB_SKIP.has(k) || /[/#]/.test(k)) continue;
      if (DICT.has(k) && v && typeof v === 'object' && !Array.isArray(v)) for (const [id, x] of Object.entries(v)) put(`lib/${k}/${enc(id)}`, x);
      else if (idArray(v)) { for (const x of v) put(`lib/${k}/${enc(String(x.id))}`, x); put(`lib/${k}#order`, v.map((x) => String(x.id))); }
      else put(`lib/${k}`, v);
    }
    const ls = d.ls || {};
    let set = {};
    try { set = JSON.parse(ls['cp.settings'] || '{}') || {}; } catch { set = {}; }
    for (const [k, v] of Object.entries(set)) if (!SET_SKIP.has(k)) put(`set/${k}`, v);
    for (const [k, v] of Object.entries(ls)) if (k.startsWith('cp.') && !LS_SKIP.has(k) && !k.startsWith('cp.cloud')) put(`ls/${enc(k)}`, lsParse(v));

    if (d.parts.has('files')) {
      for (const [key, abs] of refs) await fileMeta(key, abs, res);
      const fontDir = path.join(UD, 'fonts');
      let list = [];
      try { list = await fs.promises.readdir(fontDir, { recursive: true }); } catch { list = []; }
      for (const f of list) {
        const rel = 'fonts/' + String(f).split(path.sep).join('/');
        if (!rel.endsWith('.tmp')) await fileMeta('file/ud/' + rel, path.join(fontDir, String(f)), res);
      }
    }
    if (d.parts.has('bibles')) {
      put('bible/index', d.readIndex());
      let list = [];
      try { list = await fs.promises.readdir(d.bibleDir); } catch { list = []; }
      for (const f of list) if (/^[\w-]+\.json$/.test(f) && f !== 'index.json') await fileMeta('bible/' + f, path.join(d.bibleDir, f), res);
    }
    return res;
  }

  async function read(key) {
    if (bufs.has(key)) return bufs.get(key);
    if (files.has(key)) return fs.promises.readFile(files.get(key));
    throw new Error('нет документа ' + key);
  }

  async function apply(key, buf) {
    let m;
    if ((m = /^file\/(ud|x)\/(.+)$/.exec(key))) {
      if (!buf) return; // файлы не удаляем
      const p = localOf(m[1], m[2]);
      if (!p) throw new Error('недопустимый путь ' + key);
      await writeAtomic(p, buf);
      st.fh[p] = undefined;
      out.files++;
      return;
    }
    if ((m = /^bible\/([\w-]+\.json)$/.exec(key))) {
      if (!buf) return;
      await writeAtomic(path.join(d.bibleDir, m[1]), buf);
      out.bibles++;
      return;
    }
    ops.push({ key, val: buf ? JSON.parse(buf.toString('utf8')) : undefined });
  }

  async function keep(key, buf, meta) {
    if (!buf) return;
    const ext = key.startsWith('file/') ? path.extname(key) : '.json';
    const name = safeName(key) + ' (' + (meta.from === 'local' ? 'этот компьютер' : 'другой компьютер') + ')' + ext;
    await writeAtomic(path.join(d.conflictDir, stamp, name), buf);
    out.kept++;
  }

  // Применить накопленное и запомнить состояние
  function finish() {
    const libOps = ops.filter((o) => o.key.startsWith('lib/'));
    if (libOps.length) {
      const cur = d.libView() || {};
      const orders = {};
      const touched = new Set();
      for (const { key, val } of libOps) {
        const v = val === undefined ? undefined : localize(val);
        let m;
        if ((m = /^lib\/([^/#]+)#order$/.exec(key))) { if (Array.isArray(v)) { orders[m[1]] = v; touched.add(m[1]); } continue; }
        if ((m = /^lib\/([^/#]+)\/(.+)$/.exec(key))) {
          const k = m[1];
          const id = dec(m[2]);
          if (DICT.has(k)) {
            if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
            if (v === undefined) delete cur[k][id]; else cur[k][id] = v;
          } else {
            if (!Array.isArray(cur[k])) cur[k] = [];
            const i = cur[k].findIndex((x) => x && String(x.id) === id);
            if (v === undefined) { if (i >= 0) cur[k].splice(i, 1); } else if (i >= 0) cur[k][i] = v; else cur[k].push(v);
            touched.add(k);
          }
          continue;
        }
        if ((m = /^lib\/([^/#]+)$/.exec(key))) { if (v === undefined) delete cur[m[1]]; else cur[m[1]] = v; }
      }
      // Порядок списков — как в облаке; чего в нём нет — в конце, в прежнем порядке
      for (const k of touched) {
        if (!Array.isArray(cur[k]) || !orders[k]) continue;
        const pos = new Map(orders[k].map((id, i) => [id, i]));
        cur[k] = cur[k].map((x, i) => [x, pos.has(String(x.id)) ? pos.get(String(x.id)) : 1e9 + i]).sort((a, b) => a[1] - b[1]).map(([x]) => x);
      }
      d.saveLib(cur);
      out.lib = libOps.length;
    }
    for (const { key, val } of ops) {
      let m;
      if ((m = /^set\/(.+)$/.exec(key))) { if (val === undefined) out.dropSet.push(m[1]); else out.set[m[1]] = localize(val); }
      else if ((m = /^ls\/(.+)$/.exec(key))) { const k = dec(m[1]); if (val === undefined) out.dropLs.push(k); else out.ls[k] = lsText(localize(val)); }
      else if (key === 'bible/index' && Array.isArray(val)) { d.writeIndex(val); out.bibles++; }
    }
    for (const k of Object.keys(st.fh)) if (st.fh[k] === undefined) delete st.fh[k];
    try { fs.mkdirSync(path.dirname(d.stateFile), { recursive: true }); fs.writeFileSync(d.stateFile, JSON.stringify(st)); } catch { /* не страшно: время правок посчитается заново */ }
    out.changed = !!(out.lib || out.files || out.bibles || Object.keys(out.set).length || Object.keys(out.ls).length || out.dropSet.length || out.dropLs.length);
    return out;
  }

  return { scan, read, apply, keep, finish, include };
}

module.exports = { createAppSource };
