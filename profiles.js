/* ---------- Профили: несколько рабочих мест в одной программе (как пользователи Windows) ----------
   Профиль — свои библиотеки, плейлисты, презентации, темы, макросы, экраны и настройки окна.
   Переключение — без перезапуска программы: окно оператора перезагружается с данными другого профиля,
   окна показа продолжают работать.

   Где что лежит (папка данных программы, userData):
     profiles.json                     — список профилей, какой открыт, кто к каким общим данным подключён
     library.json, settings-backup.json — профиль «Основной» (main): как было до профилей, ничего не переносится
     profiles/<id>/library.json         — библиотеки и плейлисты профиля <id>
     profiles/<id>/settings-backup.json — его настройки окна (записи localStorage «cp.*», см. preload.js)
     shared/shared.json                 — общие данные: библиотеки, их презентации, категории (темы, макросы)
     shared/conflicts/                  — версии, проигравшие при одновременной правке (ничего не теряется)
     profiles/.deleted/                 — удалённые профили (папку можно стереть руками)
   Переводы Библии, шрифты, медиафайлы, ноты и миниатюры — общие файлы программы: лежат один раз
   и видны всем профилям (файл с тем же содержимым не копируется).

   Общая библиотека хранится один раз в shared.json вместе со своими презентациями. В library.json профиля
   на её месте — заглушка { id, shared: true } (чтобы помнить порядок библиотек). Окно оператора получает
   «склеенную» библиотеку (lib:load → load) и сохраняет её целиком (lib:save → save) — разбор, что куда,
   здесь. Презентация общая, пока стоит хотя бы в одной общей библиотеке: правка песни в одном профиле
   видна во всех, где эта библиотека подключена.

   Одновременные правки. Для каждого общего куска (библиотека, презентация, категория) помним, каким
   его видел профиль при загрузке (base). При сохранении: не меняли — не пишем (чужую правку не затираем);
   поменяли, а в хранилище за это время тоже поменялось — пишем своё, чужое кладём в shared/conflicts. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAIN = 'main';
// Категории, которые можно сделать общими: ключи library.json
const CATS = { themes: ['themes', 'themesLive'], macros: ['macros', 'fileMacros'] };
const CAT_NAMES = { themes: 'Темы', macros: 'Макросы' };

const J = (v) => (v === undefined ? undefined : JSON.stringify(v));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const newId = () => crypto.randomBytes(6).toString('hex');
// Все строки в кавычках из текста JSON — один проход (id презентаций, на которые ссылается профиль)
function refsOf(text) {
  const set = new Set();
  const re = /"([^"\\]{1,64})"/g;
  let x;
  while ((x = re.exec(text))) set.add(x[1]);
  return set;
}
const safeId = (id) => (/^[\w-]{1,40}$/.test(String(id)) ? String(id) : null);

function readJson(f, def) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; }
}
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(v));
  fs.renameSync(f + '.tmp', f); // при сбое не останется половины файла
}

// Новый профиль — пустой: одна библиотека «Песни» и плейлист «Служение», как при первом запуске (playlist.js: initService)
function freshLib() {
  const libId = newId();
  const plId = newId();
  return { version: 2, items: {}, libraries: [{ id: libId, name: 'Песни', items: [] }], playlists: [{ id: plId, name: 'Служение', entries: [] }], view: { kind: 'pl', id: plId } };
}

// Объединить категорию двух профилей: списки — по id (своё не теряется), словари — по ключам (первое главнее)
function unionCat(a, b) {
  const out = clone(a) || {};
  for (const [k, v] of Object.entries(b || {})) {
    if (v === undefined || v === null) continue;
    if (out[k] === undefined || out[k] === null) { out[k] = clone(v); continue; }
    if (Array.isArray(out[k]) && Array.isArray(v)) {
      const have = new Set(out[k].map((x) => x && x.id));
      for (const x of v) if (x && !have.has(x.id)) out[k].push(clone(x));
    } else if (typeof out[k] === 'object' && typeof v === 'object') out[k] = { ...clone(v), ...out[k] };
  }
  return out;
}

function store(root) {
  const metaFile = path.join(root, 'profiles.json');
  const sharedFile = path.join(root, 'shared', 'shared.json');
  const conflictDir = path.join(root, 'shared', 'conflicts');

  /* ----- Список профилей ----- */
  let meta = null;
  function m() {
    if (meta) return meta;
    const x = readJson(metaFile, null) || {};
    meta = {
      v: 1,
      active: safeId(x.active) || MAIN,
      list: Array.isArray(x.list) ? x.list.filter((p) => p && safeId(p.id)) : [],
      libs: x.libs && typeof x.libs === 'object' ? x.libs : {},
      cats: x.cats && typeof x.cats === 'object' ? x.cats : {},
    };
    if (!meta.list.some((p) => p.id === MAIN)) meta.list.unshift({ id: MAIN, name: 'Основной' });
    if (!meta.list.some((p) => p.id === meta.active)) meta.active = MAIN;
    for (const c of Object.keys(CATS)) if (!Array.isArray(meta.cats[c])) meta.cats[c] = [];
    return meta;
  }
  const saveMeta = () => writeJson(metaFile, m());
  const exists = (id) => m().list.some((p) => p.id === id);

  const dir = (id) => (id === MAIN ? root : path.join(root, 'profiles', id));
  const libFile = (id = m().active) => path.join(dir(id), 'library.json');
  const lsFile = (id = m().active) => path.join(dir(id), 'settings-backup.json');

  /* ----- Общее хранилище (в памяти, перечитывается, если файл поменяли снаружи — восстановление и т. п.) ----- */
  let sh = null;
  let shStamp = '';
  const stamp = () => { try { const s = fs.statSync(sharedFile); return s.mtimeMs + ':' + s.size; } catch { return ''; } };
  function S() {
    const st = stamp();
    if (sh && st === shStamp) return sh;
    const x = readJson(sharedFile, null) || {};
    sh = { v: 1, items: x.items || {}, libs: x.libs || {}, cats: x.cats || {} };
    shStamp = st;
    return sh;
  }
  function saveShared() { writeJson(sharedFile, S()); shStamp = stamp(); }

  const members = (libId) => (Array.isArray(m().libs[libId]) ? m().libs[libId] : []);
  const visibleLibs = (pid) => Object.keys(m().libs).filter((l) => members(l).includes(pid) && S().libs[l]);
  const catsOn = (pid) => Object.keys(CATS).filter((c) => (m().cats[c] || []).includes(pid) && S().cats[c]);

  function keepConflict(key, value, who) {
    try {
      const f = path.join(conflictDir, new Date().toISOString().replace(/[:.]/g, '-') + '-' + key.replace(/[^\w-]/g, '_') + '.json');
      writeJson(f, { key, profile: who, value });
    } catch { /* не страшно */ }
  }

  const base = new Map(); // профиль → Map(ключ общего куска → JSON, каким профиль его видел)

  /* ----- Загрузить «склеенную» библиотеку профиля ----- */
  function load(pid = m().active, opts = {}) {
    const s = S();
    const own = readJson(libFile(pid), null);
    const refs = own ? refsOf(JSON.stringify({ ...own, items: null })) : new Set();
    const libs = visibleLibs(pid);
    const cats = catsOn(pid);
    let lib = own && own.items ? own : null;
    if (!lib) {
      if (!libs.length && !cats.length) { if (!opts.peek) base.set(pid, new Map()); return null; }
      lib = freshLib();
    }
    if (!lib.items || typeof lib.items !== 'object') lib.items = {};
    const b = new Map();
    // Презентации: из подключённых общих библиотек и те общие, на которые профиль ссылается сам (стоят в плейлисте)
    const want = new Set();
    for (const l of libs) for (const id of s.libs[l].items || []) want.add(id);
    for (const id of Object.keys(s.items)) {
      // своя копия у профиля есть — общая ему нужна, только если презентация в его общей библиотеке
      if (!want.has(id) && !(refs.has(id) && !lib.items[id])) continue;
      const sj = J(s.items[id]);
      if (want.has(id) && lib.items[id] && J(lib.items[id]) !== sj && !opts.peek) keepConflict('i:' + id, lib.items[id], pid); // своя копия разошлась с общей
      lib.items[id] = clone(s.items[id]);
      b.set('i:' + id, sj);
    }
    // Библиотеки: заглушки — на место, новые общие — в конец
    const out = [];
    const seen = new Set();
    for (const L of Array.isArray(lib.libraries) ? lib.libraries : []) {
      if (!L || !L.id) continue;
      if (libs.includes(L.id)) {
        if (!seen.has(L.id)) { out.push({ ...clone(s.libs[L.id]), shared: true }); seen.add(L.id); }
        continue;
      }
      if (L.shared) continue; // общая, к которой доступа больше нет
      out.push(L);
    }
    for (const l of libs) if (!seen.has(l)) out.push({ ...clone(s.libs[l]), shared: true });
    for (const l of libs) b.set('l:' + l, J(s.libs[l]));
    lib.libraries = out;
    // Общие категории
    for (const c of cats) {
      for (const k of CATS[c]) { if (s.cats[c][k] === undefined) delete lib[k]; else lib[k] = clone(s.cats[c][k]); }
      b.set('c:' + c, J(s.cats[c]));
    }
    if (!opts.peek) base.set(pid, b);
    return lib;
  }

  /* ----- Сохранить библиотеку профиля: общее — в shared.json, своё — в его library.json ----- */
  function save(data, pid = m().active, opts = {}) {
    if (!data || typeof data !== 'object') return { ok: false };
    const s = S();
    // по участию, а не по хранилищу: библиотека, которую только что сделали общей, переезжает в него здесь
    const libs = Object.keys(m().libs).filter((l) => members(l).includes(pid));
    const cats = catsOn(pid);
    const b = base.get(pid) || new Map();
    base.set(pid, b);
    let dirty = false;
    let metaDirty = false;
    let libsDirty = false;
    const conflicts = [];
    const put = (key, cur, next, set) => {
      const nj = J(next);
      const bj = b.get(key);
      if (nj === bj) return; // профиль это не менял — не трогаем (вдруг поменял другой)
      const sj = J(cur);
      if (bj !== undefined && sj !== undefined && sj !== bj && sj !== nj) { conflicts.push(key); keepConflict(key, cur, 'другой профиль'); }
      set(clone(next));
      b.set(key, nj);
      dirty = true;
    };

    const out = { ...data };
    // Библиотеки
    const present = new Set();
    out.libraries = (Array.isArray(data.libraries) ? data.libraries : []).filter(Boolean).map((L) => {
      if (libs.includes(L.id)) {
        if (present.has(L.id)) return null;
        present.add(L.id);
        const c = { ...L };
        delete c.shared;
        put('l:' + L.id, s.libs[L.id], c, (v) => { s.libs[L.id] = v; libsDirty = true; });
        return { id: L.id, shared: true };
      }
      if (L.shared) { const c = { ...L }; delete c.shared; return c; } // общий доступ сняли — остаётся своей
      return L;
    }).filter(Boolean);
    // Общую библиотеку удалили в этом профиле — профиль от неё отключается; у других она остаётся
    for (const l of libs) if (!present.has(l)) {
      m().libs[l] = members(l).filter((p) => p !== pid);
      metaDirty = true;
      b.delete('l:' + l);
    }
    // Презентации: из общих библиотек этого профиля — в общее хранилище, остальные — свои
    const sharedIds = new Set();
    for (const l of present) for (const id of s.libs[l].items || []) sharedIds.add(id);
    out.items = {};
    for (const [id, it] of Object.entries(data.items || {})) {
      if (sharedIds.has(id)) put('i:' + id, s.items[id], it, (v) => { s.items[id] = v; });
      else { out.items[id] = it; b.delete('i:' + id); }
    }
    // Общие категории
    for (const c of cats) {
      const next = {};
      for (const k of CATS[c]) { if (data[k] !== undefined) next[k] = data[k]; delete out[k]; }
      put('c:' + c, s.cats[c], next, (v) => { s.cats[c] = v; });
    }
    if ((libsDirty || metaDirty || opts.gc) && gc(pid, out)) dirty = true; // состав общих библиотек менялся
    if (dirty) saveShared();
    if (metaDirty) saveMeta();
    writeJson(libFile(pid), out);
    return { ok: true, conflicts };
  }

  // Общие презентации, которых нет ни в одной общей библиотеке и на которые не ссылается ни один профиль, — убрать.
  // Профиль pid ещё не записан — его библиотека передаётся (outPid)
  function gc(pid, outPid) {
    const s = S();
    const used = new Set();
    for (const L of Object.values(s.libs)) for (const id of (L && L.items) || []) used.add(id);
    const free = Object.keys(s.items).filter((id) => !used.has(id));
    if (!free.length) return false;
    // Профилю pid она не нужна: если он на неё ссылается, она уже лежит у него своей (save → out.items).
    // Нужна другому профилю, если он на неё ссылается и своей копии не держит
    const need = new Set();
    for (const p of m().list) {
      if (p.id === pid) continue;
      const own = readJson(libFile(p.id), null);
      if (!own) continue;
      const refs = refsOf(JSON.stringify({ ...own, items: null }));
      for (const id of free) if (refs.has(id) && !(own.items && own.items[id])) need.add(id);
    }
    let ch = false;
    for (const id of free) if (!need.has(id)) { delete s.items[id]; ch = true; }
    return ch;
  }

  /* ----- Профили ----- */
  function state() {
    const x = m();
    return { active: x.active, list: x.list.map((p) => ({ id: p.id, name: p.name })), cats: clone(x.cats), catNames: CAT_NAMES };
  }

  // Что у кого есть: свои библиотеки каждого профиля и общие (с кем общие). Для раздела «Профили» в настройках
  function catalog() {
    const s = S();
    const x = m();
    const profiles = x.list.map((p) => {
      const own = readJson(libFile(p.id), null);
      const libs = (own && Array.isArray(own.libraries) ? own.libraries : [])
        .filter((L) => L && L.id && !L.shared && !x.libs[L.id])
        .map((L) => ({ id: L.id, name: L.name, count: (L.items || []).length }));
      return { id: p.id, name: p.name, libs };
    });
    const shared = Object.entries(s.libs).map(([id, L]) => ({ id, name: L.name, count: (L.items || []).length, members: members(id).filter(exists) }));
    return { ...state(), profiles, shared };
  }

  function rename(id, name) {
    const p = m().list.find((q) => q.id === id);
    name = String(name || '').trim().slice(0, 60);
    if (!p || !name) return false;
    p.name = name;
    saveMeta();
    return true;
  }

  // Новый профиль — пустой. opts: { libs: [id библиотек, которые подключить], cats: ['themes', …] }
  function create(name, opts = {}) {
    name = String(name || '').trim().slice(0, 60) || 'Профиль';
    const id = newId();
    m().list.push({ id, name });
    writeJson(libFile(id), freshLib()); // пустой, но сразу свой: «Песни» и «Служение»
    saveMeta();
    for (const l of opts.libs || []) connect(l, id);
    for (const c of opts.cats || []) setCat(c, [...(m().cats[c] || []), ...(m().cats[c] && m().cats[c].length ? [] : [m().active]), id]);
    return id;
  }

  function remove(id) {
    if (id === MAIN || id === m().active || !exists(id)) return false;
    // Общие данные не удаляются: у библиотеки без участников они остаются в shared.json, их можно подключить снова
    for (const l of Object.keys(m().libs)) m().libs[l] = members(l).filter((p) => p !== id);
    for (const c of Object.keys(CATS)) m().cats[c] = (m().cats[c] || []).filter((p) => p !== id);
    m().list = m().list.filter((p) => p.id !== id);
    saveMeta();
    base.delete(id);
    try {
      const trash = path.join(root, 'profiles', '.deleted');
      fs.mkdirSync(trash, { recursive: true });
      fs.renameSync(dir(id), path.join(trash, id + '-' + Date.now()));
    } catch { /* папки не было */ }
    return true;
  }

  function setActive(id) {
    if (!exists(id)) return false;
    m().active = id;
    saveMeta();
    return true;
  }

  // Чья это своя (не общая) библиотека
  function ownerOf(libId) {
    for (const p of m().list) {
      const own = readJson(libFile(p.id), null);
      if (own && Array.isArray(own.libraries) && own.libraries.some((L) => L && L.id === libId && !L.shared)) return p.id;
    }
    return null;
  }

  // Подключить библиотеку к профилю. Своя библиотека другого профиля сначала становится общей (переезжает в shared.json)
  function connect(libId, pid) {
    if (!exists(pid)) return false;
    if (!S().libs[libId]) {
      const owner = ownerOf(libId);
      if (!owner) return false;
      const data = load(owner);
      m().libs[libId] = [owner];
      save(data, owner);
    }
    if (!members(libId).includes(pid)) { m().libs[libId] = [...members(libId), pid]; saveMeta(); }
    return true;
  }

  // Отключить профиль от общей библиотеки. keep — оставить ему свою копию (отдельную, дальше не общую).
  // Последний участник с keep — библиотека просто снова становится его своей
  function disconnect(libId, pid, keep) {
    if (!members(libId).includes(pid)) return false;
    const data = load(pid);
    const last = members(libId).length === 1;
    const i = data.libraries.findIndex((L) => L.id === libId);
    if (i >= 0) {
      if (keep && last) { /* та же библиотека станет своей: save снимет пометку */ }
      else if (keep) data.libraries[i] = { ...data.libraries[i], id: newId(), shared: undefined };
      else {
        const gone = data.libraries.splice(i, 1)[0];
        // её презентации, которых больше нигде у профиля нет, ему не нужны (у других они остаются)
        const rest = refsOf(JSON.stringify({ ...data, items: null }));
        for (const id of gone.items || []) if (!rest.has(id)) delete data.items[id];
      }
    }
    m().libs[libId] = members(libId).filter((p) => p !== pid);
    if (keep && last) { delete m().libs[libId]; delete S().libs[libId]; }
    saveMeta();
    // Презентации из отключённой библиотеки, которые стоят в плейлистах профиля, остаются у него (своими)
    save(data, pid, { gc: true });
    if (keep && last) saveShared();
    return true;
  }

  // Общая категория (темы, макросы): pids — все профили, у кого она должна быть общей
  function setCat(cat, pids) {
    if (!CATS[cat]) return false;
    const want = [...new Set(pids.filter(exists))];
    const was = m().cats[cat] || [];
    // Отключаемые получают свою копию того, что было общим
    for (const pid of was.filter((p) => !want.includes(p))) {
      const data = load(pid);
      m().cats[cat] = (m().cats[cat] || []).filter((p) => p !== pid);
      saveMeta();
      if (data) save(data, pid);
    }
    // Подключаемые: их своё добавляется к общему (ничего не теряется)
    for (const pid of want.filter((p) => !was.includes(p))) {
      const data = load(pid) || freshLib();
      const own = {};
      for (const k of CATS[cat]) if (data[k] !== undefined) own[k] = data[k];
      const s = S();
      s.cats[cat] = unionCat(s.cats[cat], own);
      saveShared();
      m().cats[cat] = [...(m().cats[cat] || []), pid];
      saveMeta();
      for (const k of CATS[cat]) data[k] = clone(s.cats[cat][k]);
      // base для категории — уже общее: save не посчитает это чужой правкой
      (base.get(pid) || base.set(pid, new Map()).get(pid)).set('c:' + cat, J(s.cats[cat]));
      if (fs.existsSync(libFile(pid)) || pid === m().active) save(data, pid);
    }
    if (!want.length && S().cats[cat]) { delete S().cats[cat]; saveShared(); }
    return true;
  }

  return { MAIN, CATS, libFile, lsFile, load, save, state, catalog, create, rename, remove, setActive, connect, disconnect, setCat, active: () => m().active, _shared: S };
}

module.exports = { store, unionCat, freshLib, CATS };
