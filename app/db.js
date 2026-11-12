/* Данные приложения на телефоне: IndexedDB «mps» — песни (songs), служебное (meta: auth, join, sync, libs),
   свои данные человека: пометки и заметки (marks, pen.js), «Моя версия» песни (mine), аккорды и ноты из чужого файла (got, sheets.js).
   Листы нот программы — sheets ({ id: имя файла, type, buf }): качаются после синхронизации, нужны без сети. Свои данные на сервер не уходят,
   «Отключить этот телефон» их не стирает; перенос на другой телефон — экспорт/импорт (меню «…»).
   Связь с программой — Store.api (/api/v1/…, ключ устройства в заголовке Authorization).
   Синхронизация: /api/v1/songs/changes?since=N порциями; номер N пишется вместе с порцией (одна транзакция) —
   оборвалась связь, продолжим с того же места. Сервер сказал reset (другая «база») — начинаем с нуля.
   Поиск — MiniSearch: ё = е, опечатки (слова длиннее 3 букв), начало слова; номер песни — отдельно.
   Пока индекс строится (1–2 с на телефоне, по кусочкам), ищем просто по названию. */
'use strict';
const Store = (() => {
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  let db = null;
  let token = '';
  let me = null;
  let meta = { lib: '', since: 0, lh: '', at: 0 };
  let libs = [];
  const songs = new Map();
  let sorted = null; // все песни по названию (кэш)
  let ms = null;
  let msReady = false;
  let onIndex = null;

  /* ----- IndexedDB ----- */

  function open() {
    return new Promise((ok, no) => {
      const r = indexedDB.open('mps', 3);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('marks')) d.createObjectStore('marks', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('mine')) d.createObjectStore('mine', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('sheets')) d.createObjectStore('sheets', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('got')) d.createObjectStore('got', { keyPath: 'id' });
      };
      r.onsuccess = () => { db = r.result; ok(); };
      r.onerror = () => no(r.error || new Error('IndexedDB'));
      r.onblocked = () => no(new Error('Хранилище занято другой вкладкой — закройте её'));
    });
  }
  // Транзакция: fn ставит запросы; ответ — результат запроса, который вернула fn (после успешного конца)
  function tx(stores, mode, fn) {
    return new Promise((ok, no) => {
      const t = db.transaction(stores, mode);
      let r = null;
      t.oncomplete = () => ok(r && typeof r === 'object' && 'result' in r ? r.result : undefined);
      t.onerror = () => no(t.error);
      t.onabort = () => no(t.error || new Error('Хранилище не записало данные (мало места?)'));
      r = fn(t);
    });
  }
  const getMeta = (k) => tx(['meta'], 'readonly', (t) => t.objectStore('meta').get(k));
  const setMeta = (k, v) => tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put(v, k); });
  const delMeta = (k) => tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').delete(k); });
  // Свои данные: marks — { id: песня, strokes, note, at }, mine — { id: песня, slides, base, at }
  const getRec = (st, id) => tx([st], 'readonly', (t) => t.objectStore(st).get(id));
  const putRec = (st, r) => tx([st], 'readwrite', (t) => { t.objectStore(st).put(r); });
  const delRec = (st, id) => tx([st], 'readwrite', (t) => { t.objectStore(st).delete(id); });
  const allRec = (st) => tx([st], 'readonly', (t) => t.objectStore(st).getAll());
  const allKeys = (st) => tx([st], 'readonly', (t) => t.objectStore(st).getAllKeys());

  // Всё, что есть на телефоне — сразу в память (3000 песен — пара мегабайт)
  async function load() {
    const auth = (await getMeta('auth')) || {};
    token = auth.token || '';
    me = auth.me || null;
    meta = { lib: '', since: 0, lh: '', at: 0, ...((await getMeta('sync')) || {}) };
    libs = (await getMeta('libs')) || [];
    const all = (await tx(['songs'], 'readonly', (t) => t.objectStore('songs').getAll())) || [];
    songs.clear();
    for (const s of all) songs.set(s.id, s);
    sorted = null;
    return { token, me };
  }

  async function saveAuth(t, m) {
    token = t;
    me = m;
    await setMeta('auth', { token, me });
  }
  async function saveMe(m) {
    me = m;
    await setMeta('auth', { token, me });
  }
  // «Отключить этот телефон»: ключ и все песни — стереть
  async function forget() {
    token = '';
    me = null;
    await tx(['songs', 'meta', 'sheets'], 'readwrite', (t) => { t.objectStore('songs').clear(); t.objectStore('meta').clear(); t.objectStore('sheets').clear(); });
    songs.clear();
    libs = [];
    meta = { lib: '', since: 0, lh: '', at: 0 };
    sorted = null;
    ms = null;
    msReady = false;
  }
  // Ключ отозван — песни остаются, ключа нет
  async function dropAuth() {
    token = '';
    await delMeta('auth');
  }

  /* ----- Связь с программой ----- */

  // Ошибка: e.code — 'net' (нет связи), 'auth' (ключ отозван), 'off' (приостановлен), 'closed' (доступ выключен), …
  async function api(p, { method = 'GET', body, timeout = 15000 } = {}) {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), timeout);
    let r;
    try {
      r = await fetch('/api/v1' + p, {
        method, cache: 'no-store', signal: ac.signal, body: body ? JSON.stringify(body) : undefined,
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      });
    } catch (e) {
      clearTimeout(tm);
      const err = new Error('Нет связи с программой');
      err.code = 'net';
      throw err;
    }
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    clearTimeout(tm);
    if (!r.ok) {
      const err = new Error((j && j.text) || 'Программа ответила ошибкой ' + r.status);
      err.code = (j && j.error) || String(r.status);
      throw err;
    }
    return j;
  }

  /* ----- Синхронизация песен ----- */

  let syncing = null;
  function sync(onProgress) {
    if (syncing) return syncing;
    syncing = (async () => {
      let reset = false;
      let got = 0;
      let total = 0;
      const changed = [];
      const gone = [];
      for (let guard = 0; guard < 1000; guard++) {
        const q = `?since=${meta.since}&lib=${encodeURIComponent(meta.lib)}&lh=${encodeURIComponent(meta.lh)}&limit=400`;
        const j = await api('/songs/changes' + q, { timeout: 90000 });
        if (j.reset) {
          if (reset) throw new Error('Программа дважды попросила начать заново');
          reset = true;
          await tx(['songs', 'meta'], 'readwrite', (t) => { t.objectStore('songs').clear(); t.objectStore('meta').delete('sync'); });
          songs.clear();
          sorted = null;
          meta = { lib: j.lib, since: 0, lh: '', at: 0 };
          continue;
        }
        if (!total) total = j.total;
        const next = { ...meta, lib: j.lib, since: j.next };
        if (j.libs) next.lh = j.lh;
        await tx(['songs', 'meta'], 'readwrite', (t) => {
          const s = t.objectStore('songs');
          for (const x of j.songs) s.put(x);
          for (const id of j.gone) s.delete(id);
          const m = t.objectStore('meta');
          if (j.libs) m.put(j.libs, 'libs');
          m.put(next, 'sync');
        });
        meta = next;
        for (const x of j.songs) { songs.set(x.id, x); changed.push(x); }
        for (const id of j.gone) { songs.delete(id); gone.push(id); }
        if (j.libs) libs = j.libs;
        if (j.songs.length || j.gone.length) sorted = null;
        got += j.songs.length + j.gone.length;
        if (onProgress) onProgress(got, total);
        if (!j.more) break;
      }
      meta = { ...meta, at: Date.now() };
      await setMeta('sync', meta);
      indexUpdate(changed, gone, reset);
      return { got, total, reset };
    })().finally(() => { syncing = null; });
    return syncing;
  }
  // «Загрузить всё заново»
  async function resync(onProgress) {
    meta = { lib: '', since: 0, lh: '', at: 0 };
    await setMeta('sync', meta);
    return sync(onProgress);
  }

  /* ----- Поиск ----- */

  const MS_OPT = {
    fields: ['name', 'number', 'text'],
    processTerm: (t) => norm(t),
    searchOptions: { boost: { name: 4, number: 6 }, prefix: true, fuzzy: (term) => (term.length > 3 ? 0.2 : false), combineWith: 'AND' },
  };
  // Текст песни для поиска — без повторов припева
  const doc = (s) => ({ id: s.id, name: s.name, number: s.number || '', text: s.slides.filter((z) => z.occ <= 1).map((z) => z.text).join('\n') });
  function indexAll() {
    if (typeof MiniSearch !== 'function') return;
    const m = new MiniSearch(MS_OPT);
    ms = m;
    msReady = false;
    m.addAllAsync([...songs.values()].map(doc), { chunkSize: 150 }).then(() => {
      if (ms !== m) return;
      msReady = true;
      if (onIndex) onIndex();
    });
  }
  function indexUpdate(changed, gone, reset) {
    if (!ms || !msReady || reset || changed.length + gone.length > 300) { indexAll(); return; }
    for (const id of gone) if (ms.has(id)) ms.discard(id);
    for (const s of changed) { if (ms.has(s.id)) ms.replace(doc(s)); else ms.add(doc(s)); }
  }

  const numOf = (s) => String(s.number || (/^\s*(\d+)[.)\s]/.exec(s.name) || [])[1] || '');
  function allSorted() {
    if (!sorted) sorted = [...songs.values()].sort((a, b) => collator.compare(a.name, b.name));
    return sorted;
  }
  function libSongs(libId) {
    const l = libs.find((x) => x.id === libId);
    return l ? l.songs.map((id) => songs.get(id)).filter(Boolean) : allSorted();
  }
  function search(q, libId) {
    const t = String(q || '').trim();
    const base = libId ? libSongs(libId) : null;
    if (!t) return base || allSorted();
    const inLib = base ? new Set(base.map((s) => s.id)) : null;
    let list;
    if (/^\d+$/.test(t)) {
      // Номер: сначала точно такой, потом начинающиеся с него
      list = (base || allSorted()).filter((s) => numOf(s).startsWith(t))
        .sort((a, b) => (numOf(a) === t ? 0 : 1) - (numOf(b) === t ? 0 : 1) || numOf(a).length - numOf(b).length || collator.compare(a.name, b.name));
      return list;
    }
    if (ms && msReady) {
      let r = ms.search(t);
      if (!r.length) r = ms.search(t, { combineWith: 'OR' });
      list = r.map((x) => songs.get(x.id)).filter(Boolean);
    } else {
      const n = norm(t);
      list = allSorted().filter((s) => norm(s.name).includes(n));
    }
    return inLib ? list.filter((s) => inLib.has(s.id)) : list;
  }

  return {
    open, load, getMeta, setMeta, delMeta, getRec, putRec, delRec, allRec, allKeys, saveAuth, saveMe, forget, dropAuth, api, sync, resync, indexAll, search,
    songs, norm,
    get token() { return token; },
    get me() { return me; },
    get meta() { return meta; },
    get libs() { return libs; },
    get indexReady() { return msReady; },
    get busy() { return !!syncing; },
    set onIndex(f) { onIndex = f; },
  };
})();
