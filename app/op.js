/* Пульт оператора на планшете и телефоне — право «Полное управление» (галочка у человека в окне «Группа»).
   Всё, что оператор делает мышью: плейлисты и библиотеки со слайдами-картинками, Библия (место, книги, поиск),
   медиапул, «Убрать» по слоям, выходы «Зал» и «Сцена», таймеры, сообщение сцене, плашки, макросы, отмена,
   и картинка того, что сейчас на экране.
   Связь — тот же WebSocket группы (app.js: ws): { t: 'op', id, a, x } → { t: 'opr', id, ok, res };
   состояние приходит разделами { t: 'ops', s } (только изменившиеся; подписка { t: 'opsub', on } — пока пульт открыт).
   Быстро и экономно:
   — слайды презентаций хранятся на устройстве (IndexedDB «mps-op») с версией: не поменялись — ничего не качаем;
   — картинки слайдов — по отпечатку содержимого (не меняются никогда): скачанная однажды лежит у себя навсегда;
     открыли плейлист — картинки всех его слайдов подкачиваются заранее (сначала видимые и ближайшие к экрану);
   — «Что на экране» — кадр, только когда картинка поменялась; ширину и качество JPEG пульт подбирает сам
     по скорости сети и размеру своего окна (меню «Ещё» → «Трансляция экрана»: авто, экономно, чётко, выкл);
   — нажатие видно сразу (рамка у слайда), ответ программы — за десятки миллисекунд. */
'use strict';
const Op = (() => {
  const LS = 'mps.op.';
  const S = {};        // разделы состояния: lists, live, bible, macros, timers, stage, plates, pool
  let opened = false;
  let tab = ls.get(LS + 'tab', 'sl');
  let vk = ls.get(LS + 'vk', '');
  let imgMode = ls.get(LS + 'img', '1') === '1';       // слайды картинками (иначе — только текст: почти без трафика)
  let preload = ls.get(LS + 'pre', '1') === '1';       // подкачивать картинки всего плейлиста заранее
  let lvMode = ls.get(LS + 'lv', 'auto');             // auto | eco | hq | off
  let tOffOp = 0;                                       // поправка часов для таймеров (время программы − своё)
  let scr = ls.get(LS + 'scr', 'main');                // какой экран смотреть (Основной, другой экран, сцена 'scene:id')
  let stab = ls.get(LS + 'stab', 'ly');                // вкладка под экраном: ly слои, tm таймеры, pl плашки, mc макросы
  let playerAt = 0;                                     // когда пришло состояние проигрывателя (время между — считаем сами)
  const can = () => !!(Store.me && Store.me.perms && Store.me.perms.op);
  const wide = () => matchMedia('(min-width: 900px)').matches;
  const haptic = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* нет */ } };
  const noi = (e) => { e.dataset.noi18n = ''; return e; };
  const wrap = (tag, cls, ...kids) => { const e = el(tag, cls); e.append(...kids); return e; }; // el() из app.js — только текст

  /* ===== Хранилище на устройстве: своя база (работает и по http, где нет Cache Storage) ===== */
  let dbp = null;
  function idb() {
    if (!dbp) {
      dbp = new Promise((ok) => {
        let r;
        try { r = indexedDB.open('mps-op', 1); } catch { ok(null); return; }
        r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('t')) d.createObjectStore('t'); if (!d.objectStoreNames.contains('i')) d.createObjectStore('i'); };
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ok(null);
        r.onblocked = () => ok(null);
      });
    }
    return dbp;
  }
  async function dget(st, k) {
    const d = await idb();
    if (!d) return undefined;
    return new Promise((ok) => {
      try { const q = d.transaction(st).objectStore(st).get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); } catch { ok(undefined); }
    });
  }
  async function dput(st, k, v) {
    const d = await idb();
    if (!d) return;
    try { d.transaction(st, 'readwrite').objectStore(st).put(v, k); } catch { /* мало места — не страшно */ }
  }
  // Картинок больше 8000 — старые (первые по ключу) убрать: место на телефоне не бесконечное
  async function prune() {
    const d = await idb();
    if (!d) return;
    try {
      const os = d.transaction('t', 'readwrite').objectStore('t');
      const c = os.count();
      c.onsuccess = () => {
        let extra = c.result - 8000;
        if (extra <= 0) return;
        const cur = os.openCursor();
        cur.onsuccess = () => { const x = cur.result; if (!x || extra-- <= 0) return; x.delete(); x.continue(); };
      };
    } catch { /* не страшно */ }
  }

  /* ===== Связь ===== */
  let seq = 0;
  const pend = new Map();
  function call(a, x = {}, ms = 12000) {
    return new Promise((ok, no) => {
      if (!ws || ws.readyState !== 1) { no(Object.assign(new Error('Нет связи с программой'), { code: 'net' })); return; }
      const id = ++seq;
      const t = setTimeout(() => { pend.delete(id); no(new Error('Программа не ответила')); }, ms);
      pend.set(id, { ok, no, t });
      ws.send(JSON.stringify({ t: 'op', id, a, x }));
    });
  }
  // Команда с кнопки: сразу отклик пальцу, ошибка — всплывашкой
  async function act(a, x, okText) {
    haptic();
    try {
      const r = await call(a, x);
      if (okText) toast(okText);
      return r;
    } catch (e) { toast(e.message || 'Ошибка'); return null; }
  }
  function sub(on) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'opsub', on })); } catch { /* нет связи */ } }
  const authHdr = () => ({ Authorization: 'Bearer ' + Store.token });

  function onMsg(m) {
    if (m.t === 'opr') {
      const p = pend.get(m.id);
      if (!p) return true;
      pend.delete(m.id);
      clearTimeout(p.t);
      if (m.ok) p.ok(m.res || {}); else p.no(new Error(m.text || 'Ошибка'));
      return true;
    }
    if (m.t === 'rtc') { rtcMsg(m); return true; }
    if (m.t === 'ops') {
      if (m.time) tOffOp = m.time - Date.now();
      if (m.full) for (const k of Object.keys(S)) delete S[k];
      Object.assign(S, m.s || {});
      if (opened) applyState(Object.keys(m.s || {}), !!m.full);
      return true;
    }
    return false;
  }
  function onWelcome() {
    perms();
    if (opened) { sub(true); liveKick(); }
  }
  function onLost() {
    for (const [id, p] of pend) { clearTimeout(p.t); p.no(new Error('Нет связи с программой')); pend.delete(id); }
    rtcStop(false);
    if (opened) paintConn();
  }
  const wsSend = (m) => { try { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } } catch { /* нет связи */ } return false; };

  /* ===== Открыть / закрыть ===== */
  function perms() {
    const b = $('tabOp');
    if (b) b.hidden = !can();
    if (opened && !can()) { toast('Оператор выключил полное управление'); close(); }
  }
  function open(push = true) {
    if (!can()) { toast('Пульт разрешает оператор: окно «Группа» → «Полное управление»'); return; }
    opened = true;
    show('Op');
    if (push) history.pushState({ op: 1 }, '');
    document.body.classList.add('op-on');
    sub(true);
    setTab(tab, true);
    paintConn();
    applyState(Object.keys(S), true);
    loadView();
    liveKick();
    prune();
  }
  function close() {
    opened = false;
    sub(false);
    liveStop();
    rtcStop();
    document.body.classList.remove('op-on');
    if (screen === 'Op') show('Lib');
  }

  function setTab(t, quiet) {
    if (!['sl', 'bi', 'md', 'mo', 'sc'].includes(t)) t = 'sl';
    if (t === 'sc' && wide()) t = 'sl'; // на широком экране «Экран» и так справа
    tab = t;
    ls.set(LS + 'tab', t);
    for (const b of $('opTabs').children) b.setAttribute('aria-selected', String(b.dataset.t === t));
    for (const [id, k] of [['opSl', 'sl'], ['opBi', 'bi'], ['opMd', 'md'], ['opMo', 'mo']]) $(id).hidden = k !== t;
    $('scrOp').dataset.tab = t;
    if (t === 'bi') bibleOpen();
    if (t === 'md') mediaOpen();
    if (t === 'mo') paintMore();
    if (!quiet) window.scrollTo(0, 0);
    liveKick();
  }

  function paintConn() {
    const c = $('opConn');
    const ok = conn === 'ok' && ws && ws.readyState === 1;
    c.className = 'conn' + (ok ? ' ok' : conn === 'net' || BAD.includes(conn) ? ' bad' : '');
    $('opConnText').textContent = ok ? 'На связи' : conn === 'net' ? 'Нет связи' : BAD.includes(conn) ? 'Нет доступа' : 'Подключаюсь…';
  }

  function applyState(keys, full) {
    const has = (k) => full || keys.includes(k);
    if (has('lists')) { paintLists(); if (!full) listsChanged(); else listsSig = JSON.stringify(S.lists || null); }
    if (has('live')) { paintLive(); markLive(true); if (tab === 'bi') markVerses(); if (tab === 'md') markMedia(); }
    if (has('player')) { playerAt = Date.now(); paintPlayer(); }
    if (has('macros') || has('plates') || has('timers')) paintSide();
    if (has('bible') && tab === 'bi') bibleOpen();
    if (has('pool') && tab === 'md') paintFolders();
    if ((has('macros') || has('plates') || has('timers') || has('stage')) && tab === 'mo') paintMore();
    paintConn();
  }

  /* ===== Картинки: слайды и медиапул ===== */
  const urls = new Map();   // ключ → objectURL (последние 700)
  const goneV = new Set();  // картинки, которых у программы не нашлось (уже просили презентацию заново)
  const flight = new Map(); // ключ → Promise
  const hiQ = [];
  const loQ = [];
  let active = 0;
  const MAX_ACT = 4;
  function pump() {
    while (active < MAX_ACT && (hiQ.length || loQ.length)) {
      const job = hiQ.shift() || loQ.shift();
      active++;
      job().finally(() => { active--; pump(); });
    }
  }
  const slot = (hi) => new Promise((ok) => { (hi ? hiQ : loQ).push(() => new Promise((done) => ok(done))); pump(); });
  function keep(key, blob) {
    const u = URL.createObjectURL(blob);
    urls.set(key, u);
    while (urls.size > 700) { const [k, old] = urls.entries().next().value; urls.delete(k); URL.revokeObjectURL(old); }
    return u;
  }
  // kind: 't' — слайд (v), 'p' — файл медиапула (id). null — картинки нет
  function thumb(kind, v, hi) {
    const key = kind + v;
    if (urls.has(key)) { const u = urls.get(key); urls.delete(key); urls.set(key, u); return Promise.resolve(u); }
    if (flight.has(key)) { const f = flight.get(key); if (hi) f.hi = true; return f; }
    const p = (async () => {
      const got = await dget('t', key);
      if (got instanceof Blob && got.size) return keep(key, got);
      const done = await slot(hi || p.hi);
      try {
        const r = await fetch(`/api/v1/op/${kind === 't' ? 'thumb' : 'pthumb'}/${v}`, { headers: authHdr() });
        if (!r.ok) return r.status === 404 ? 'gone' : null;
        const b = await r.blob();
        if (!b.size) return null;
        dput('t', key, b);
        return keep(key, b);
      } catch { return null; } finally { done(); }
    })();
    flight.set(key, p);
    p.finally(() => flight.delete(key));
    return p;
  }
  // Картинка в плитке — когда плитка рядом с экраном
  const seen = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { seen.unobserve(e.target); fillImg(e.target, true); }
  }, { rootMargin: '500px' }) : null;
  function lazyImg(img) { if (seen) seen.observe(img); else fillImg(img, true); }
  async function fillImg(img, hi) {
    const k = img.dataset.k;
    const v = img.dataset.v;
    if (!k || !v) return;
    const u = await thumb(k, v, hi);
    if (u === 'gone') {
      // Программу перезапускали — она забыла содержимое слайда: попросить презентацию заново (один раз на картинку)
      const id = img.dataset.item;
      if (id && !goneV.has(v)) { goneV.add(v); await refreshItems([id], true); }
      return;
    }
    if (u && img.dataset.v === v) { img.src = u; img.classList.add('on'); }
  }

  /* ===== Плейлисты и библиотеки ===== */
  const items = new Map(); // id → презентация { id, name, kind, ver, slides: [{ id, k, label, c, text, v }] }
  const views = new Map(); // vk → { vk, name, kind, entries }
  let libQ = '';
  let libPick = '';        // в большой библиотеке — открытая презентация

  function paintLists() {
    const L = S.lists;
    const box = $('opLists');
    if (!L) { box.replaceChildren(el('p', 'hint', 'Жду программу…')); return; }
    if (!vk || ![...L.pl.map((p) => 'pl:' + p.id), ...L.lib.map((l) => 'lib:' + l.id)].includes(vk)) {
      vk = L.work || (L.pl[0] ? 'pl:' + L.pl[0].id : L.lib[0] ? 'lib:' + L.lib[0].id : '');
      loadView();
    }
    const row = (key, name, n, sub) => {
      const b = el('button', 'op-li' + (key === vk ? ' on' : '') + (key === L.work ? ' work' : ''));
      b.type = 'button';
      b.dataset.vk = key;
      b.append(noi(el('span', 't', name)), el('span', 'n', String(n)));
      if (sub) b.append(el('span', 's', sub));
      b.onclick = () => { if (vk === key) return; vk = key; ls.set(LS + 'vk', vk); libPick = ''; libQ = ''; paintLists(); loadView(); };
      return b;
    };
    box.replaceChildren(
      el('h4', '', 'Плейлисты'), ...L.pl.map((p) => row('pl:' + p.id, p.name, p.n, p.date ? dayName(p.date) : '')),
      el('h4', '', 'Библиотеки'), ...L.lib.map((l) => row('lib:' + l.id, l.name, l.n)));
    const on = box.querySelector('.op-li.on');
    if (on && !wide()) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  let viewTok = 0;
  async function loadView() {
    if (!vk) { $('opFeed').replaceChildren(el('p', 'empty', 'Нет плейлистов и библиотек')); return; }
    const k = vk;
    const tok = ++viewTok;
    let v = views.get(k) || (await dget('i', 'v:' + k));
    if (v && tok === viewTok) { views.set(k, v); renderView(v); }
    try {
      const nv = await call('view', { vk: k });
      if (tok !== viewTok) return;
      views.set(k, nv);
      dput('i', 'v:' + k, nv);
      if (!v || JSON.stringify(v.entries) !== JSON.stringify(nv.entries) || v.name !== nv.name) renderView(nv);
      v = nv;
    } catch (e) {
      if (!v) $('opFeed').replaceChildren(el('p', 'empty', e.message || 'Нет связи с программой'));
    }
  }
  // Список поменялся (сохранили библиотеку) — открытый вид обновить
  let listsSig = '';
  function listsChanged() {
    const s = JSON.stringify(S.lists || null);
    if (s === listsSig) return;
    listsSig = s;
    if (opened) loadView();
  }

  const bigLib = (v) => v.kind === 'lib' && v.entries.length > 40;
  function renderView(v) {
    const feed = $('opFeed');
    const L = S.lists || {};
    const head = el('div', 'op-vh');
    head.append(noi(el('h2', 'grow', v.name)));
    if (L.work !== v.vk) {
      const b = el('button', '', 'Открыть в программе');
      b.title = 'Сделать этот список рабочим (лента в программе, стрелки и «Дальше»)';
      b.onclick = () => act('open', { vk: v.vk }, 'Открыто в программе');
      head.append(b);
    } else head.append(el('span', 'op-work', 'в ленте программы'));
    const out = [head];
    let ids = [];
    if (bigLib(v)) {
      const sr = el('div', 'search op-q');
      const q = el('input');
      Object.assign(q, { type: 'search', placeholder: 'Найти в библиотеке', value: libQ, enterKeyHint: 'search', autocomplete: 'off' });
      q.oninput = () => { libQ = q.value; paintLibList(v); };
      sr.append(q);
      out.push(sr);
      if (libPick) {
        const e = v.entries.find((x) => x.key === libPick);
        if (e) { out.push(section(v, e, true)); ids = [e.id]; }
      }
      out.push(el('div', 'op-ll'));
    } else {
      if (!v.entries.length) out.push(el('p', 'empty', 'Список пуст — добавьте пункты в программе'));
      for (const e of v.entries) out.push(section(v, e));
      ids = v.entries.map((e) => e.id);
    }
    feed.replaceChildren(...out);
    feed.style.setProperty('--ar', ar());
    if (bigLib(v)) paintLibList(v);
    ensureItems(ids, v);
  }
  const ar = () => { const z = S.live && S.live.size; return z && z.W > 0 && z.H > 0 ? `${z.W} / ${z.H}` : '16 / 9'; };
  function paintLibList(v) {
    const box = $('opFeed').querySelector('.op-ll');
    if (!box) return;
    const q = libQ.trim().toLowerCase();
    const list = v.entries.filter((e) => !q || e.name.toLowerCase().includes(q)).slice(0, 300);
    box.replaceChildren(...list.map((e) => {
      const b = el('button', 'item op-lr' + (e.key === libPick ? ' on' : ''));
      b.type = 'button';
      b.append(noi(el('span', 't', e.name)), el('span', 's', kindName(e) + ' · ' + slidesN(e.n)));
      b.onclick = () => { libPick = e.key; renderView(v); window.scrollTo(0, 0); };
      return b;
    }));
    if (!list.length) box.append(el('p', 'empty', 'Ничего не найдено'));
  }
  const KINDS = { song: 'Песня', bible: 'Библия', media: 'Медиа', deck: 'Презентация', audio: 'Музыка', custom: 'Слайды', mixed: 'Слайды' };
  const kindName = (e) => KINDS[e.kind] || 'Слайды';
  const slidesN = (n) => `${n} сл.`;

  function section(v, e, closable) {
    const sec = el('section', 'op-it');
    sec.dataset.key = e.key;
    sec.dataset.id = e.id;
    const h = el('h3');
    h.append(noi(el('span', 't', e.name)), el('span', 's', kindName(e) + ' · ' + slidesN(e.n)));
    if (closable) {
      const x = el('button', 'icon op-x', '×');
      x.setAttribute('aria-label', 'Закрыть');
      x.onclick = () => { libPick = ''; renderView(v); };
      h.append(x);
    }
    const grid = el('div', 'op-sls');
    const it = items.get(e.id);
    if (it && it.ver === e.ver) fillSection(grid, v, e, it);
    else grid.append(el('p', 'hint', 'Загружаю…'));
    sec.append(h, grid);
    return sec;
  }

  function fillSection(grid, v, e, it) {
    grid.replaceChildren(...it.slides.map((s, i) => tile(v, e, it, s, i)));
    markLive(false);
  }
  function tile(v, e, it, s, i) {
    const b = el('button', 'op-sl');
    b.type = 'button';
    b.dataset.sid = s.id;
    b.dataset.key = e.key;
    b.dataset.item = it.id;
    const box = el('span', 'op-im');
    if (imgMode && s.v) {
      const img = el('img');
      img.alt = '';
      img.decoding = 'async';
      img.dataset.k = 't';
      img.dataset.v = s.v;
      img.dataset.item = it.id;
      box.append(img);
      lazyImg(img);
    } else {
      const tx = noi(el('span', 'op-tx', s.text || (s.k === 'audio' ? '♪ ' + (s.label || 'Музыка') : s.k === 'live' ? '● ' + (s.label || 'Источник') : s.label || '')));
      box.append(tx);
      box.classList.add('txt');
    }
    const lb = el('span', 'op-lb');
    lb.append(el('i', 'n', String(i + 1)), noi(el('span', '', s.label || '')));
    if (s.c) lb.style.setProperty('--c', s.c);
    b.append(box, lb);
    b.onclick = () => {
      b.classList.add('pend');
      setTimeout(() => b.classList.remove('pend'), 1500);
      act('show', { vk: v.vk, key: e.key, sid: s.id });
    };
    if (s.k === 'text') longPress(b, () => editSlide(it, s));
    return b;
  }
  function longPress(node, fn) {
    let t = 0;
    let x0 = 0;
    let y0 = 0;
    node.addEventListener('pointerdown', (ev) => { x0 = ev.clientX; y0 = ev.clientY; t = setTimeout(() => { t = 0; node.dataset.lp = '1'; haptic(); fn(); }, 600); });
    const stop = () => { clearTimeout(t); t = 0; };
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);
    node.addEventListener('pointermove', (ev) => { if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 12) stop(); });
    node.addEventListener('click', (ev) => { if (node.dataset.lp) { delete node.dataset.lp; ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
    node.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  // Презентации вида: своя копия той же версии — сразу; другие — у программы порциями
  async function ensureItems(ids, v) {
    const need = [];
    const byId = new Map(v.entries.map((e) => [e.id, e]));
    for (const id of [...new Set(ids)]) {
      const e = byId.get(id);
      let it = items.get(id);
      if (!it || it.ver !== e.ver) { const c = await dget('i', 'it:' + id); if (c && c.ver === e.ver) { it = c; items.set(id, c); } }
      if (it && it.ver === e.ver) paintItem(id); else need.push(id);
    }
    await refreshItems(need);
    if (preload && imgMode) prefetch(v);
  }
  async function refreshItems(need, force) {
    for (let i = 0; i < need.length; i += 40) {
      const part = need.slice(i, i + 40);
      const have = {};
      if (!force) for (const id of part) { const it = items.get(id); if (it) have[id] = it.ver; }
      let r;
      try { r = await call('items', { ids: part, have }, 20000); } catch { return; }
      for (const [id, x] of Object.entries(r.items || {})) {
        if (!x || x.gone || x.same) continue;
        items.set(id, x);
        dput('i', 'it:' + id, x);
        paintItem(id);
      }
    }
  }
  function paintItem(id) {
    const v = views.get(vk);
    const it = items.get(id);
    if (!v || !it) return;
    for (const sec of $('opFeed').querySelectorAll(`.op-it[data-id="${CSS.escape(id)}"]`)) {
      const e = v.entries.find((x) => x.key === sec.dataset.key);
      if (e) fillSection(sec.querySelector('.op-sls'), v, e, it);
    }
    paintNext();
  }
  // Заранее — картинки всех слайдов списка: от того, что на экране, вперёд, потом остальные
  function prefetch(v) {
    const flat = [];
    for (const e of v.entries) { const it = items.get(e.id); if (it) for (const s of it.slides) if (s.v) flat.push(s.v); }
    const at = S.live && S.live.at;
    let from = 0;
    if (at) {
      const it = items.get(at.item);
      const s = it && it.slides.find((x) => x.id === at.sid);
      if (s && s.v) from = Math.max(0, flat.indexOf(s.v));
    }
    for (const x of [...flat.slice(from), ...flat.slice(0, from)].slice(0, 1500)) thumb('t', x, false);
  }

  // Что на экране — рамкой; плитка не видна — прокрутить к ней (не мешая, если человек листает сам: только при смене)
  let lastLiveSig = '';
  function markLive(scroll) {
    const at = S.live && S.live.at;
    const sig = at ? at.vk + '|' + at.key + '|' + at.sid : '';
    let hit = null;
    for (const b of $('opFeed').querySelectorAll('.op-sl')) {
      const y = !!at && b.dataset.item === at.item && b.dataset.sid === at.sid && (at.vk !== vk || b.dataset.key === at.key);
      b.classList.toggle('live', y);
      if (y) { b.classList.remove('pend'); hit = hit || b; }
    }
    if (scroll && hit && sig !== lastLiveSig && tab === 'sl') {
      const r = hit.getBoundingClientRect();
      if (r.top < 60 || r.bottom > innerHeight - 90) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (scroll) lastLiveSig = sig;
  }

  /* ===== «Что на экране»: картинка, кнопки, слои ===== */
  function paintLive() {
    const L = S.live;
    if (!L) return;
    $('opNow').textContent = L.label ? L.label : 'Экран пуст';
    paintScr();
    $('opDockText').textContent = L.label || 'Экран пуст';
    for (const [id, g] of [['opHall', 'hall'], ['opStage', 'stage']]) {
      const b = $(id);
      const x = L[g] || { on: false, n: 0 };
      b.disabled = !x.n;
      b.classList.toggle('on', !!x.on);
      b.setAttribute('aria-pressed', String(!!x.on));
    }
    const box = $('opLayers');
    box.replaceChildren(...(L.layers || []).filter((l) => !l.hidden || l.on).map((l) => {
      const row = el('div', 'op-ly' + (l.on ? ' on' : ''));
      const nm = el('span', 'nm');
      nm.append(el('b', '', l.name), noi(el('span', '', l.on ? l.label || '…' : 'пусто')));
      row.append(nm);
      if (l.on && l.play) {
        const p = el('button', '', '▶');
        p.setAttribute('aria-label', 'Пуск');
        p.onclick = () => act('layer.play', { id: l.id, play: true });
        const z = el('button', '', '❚❚');
        z.setAttribute('aria-label', 'Пауза');
        z.onclick = () => act('layer.play', { id: l.id, play: false });
        row.append(p, z);
      }
      const x = el('button', 'danger', 'Убрать');
      x.disabled = !l.on;
      x.onclick = () => act('clear', { what: 'layer', id: l.id });
      row.append(x);
      return row;
    }));
    $('scrOp').style.setProperty('--ar', ar());
    $('opFeed').style.setProperty('--ar', ar());
    paintNext();
  }
  // «Дальше» — следующий слайд открытого списка (по тем презентациям, что уже есть на устройстве)
  function paintNext() {
    const box = $('opNextBox');
    const at = S.live && S.live.at;
    const v = views.get(at ? at.vk : vk);
    box.replaceChildren();
    if (!at || !v) return;
    const flat = [];
    for (const e of v.entries) { const it = items.get(e.id); if (it) for (const s of it.slides) flat.push({ e, it, s }); }
    const i = flat.findIndex((x) => x.e.key === at.key && x.s.id === at.sid);
    const nx = i >= 0 ? flat[i + 1] : null;
    if (!nx) return;
    const b = el('button', 'op-nx');
    b.type = 'button';
    const im = el('span', 'op-im');
    if (imgMode && nx.s.v) { const img = el('img'); img.alt = ''; img.dataset.k = 't'; img.dataset.v = nx.s.v; img.dataset.item = nx.it.id; im.append(img); fillImg(img, true); } else { im.classList.add('txt'); im.append(noi(el('span', 'op-tx', nx.s.text || nx.s.label || ''))); }
    const t = el('span', 'tt');
    t.append(el('small', '', 'Дальше'), noi(el('b', '', nx.it.name)), noi(el('span', '', nx.s.label || '')));
    b.append(im, t);
    b.onclick = () => act('show', { vk: v.vk, key: nx.e.key, sid: nx.s.id });
    box.append(b);
  }

  /* ----- Трансляция экрана: кадр, когда поменялся; ширина и качество — по сети и окну ----- */
  const LEVELS = [{ w: 320, q: 45 }, { w: 480, q: 55 }, { w: 640, q: 62 }, { w: 800, q: 68 }, { w: 960, q: 74 }];
  let lvl = Math.max(0, Math.min(LEVELS.length - 1, Number(ls.get(LS + 'lvl', '1')) || 1));
  let lvRun = false;
  let lvAbort = null;
  let lvSeq = 0;
  let lvUrl = '';
  let lvGood = 0;
  let lvReqL = -1; // уровень текущего запроса
  let lvRefit = false; // окно картинки выросло — перезапросить текущий кадр крупнее, не дожидаясь нового
  const pvImgs = () => [$('opPvImg'), $('opDockImg')].filter((x) => x && x.offsetParent);
  const lvWanted = () => opened && lvMode !== 'off' && !document.hidden && conn === 'ok' && pvImgs().length > 0;
  const rtcLive = () => !!rtc && rtc.state === 'on';
  function capLevel() {
    const w = Math.max(0, ...pvImgs().map((x) => x.clientWidth)) * Math.min(2, devicePixelRatio || 1);
    let c = 0;
    for (let i = 0; i < LEVELS.length; i++) if (LEVELS[i].w <= w * 1.15) c = i;
    return c;
  }
  const wantLevel = () => { const cap = capLevel(); return lvMode === 'eco' ? 0 : lvMode === 'hq' ? cap : Math.min(lvl, cap); };
  function liveKick() {
    $('opPvOff').hidden = lvMode !== 'off';
    if (!lvWanted()) { liveStop(); rtcStop(); return; }
    placeVid();
    // Видео: включаем, если планшет умеет и недавно не срывалось; пока соединяется — идут картинки
    if (rtcCan()) {
      if (rtc && rtc.sid !== scr) rtcStop();
      if (!rtc) rtcStart(); else rtcMode();
    }
    if (rtcLive()) { liveStop(); return; }
    if (!lvRun) liveLoop();
    else if (lvReqL >= 0 && wantLevel() > lvReqL) { lvRefit = true; liveStop(); }
  }
  function liveStop() { if (lvAbort) { try { lvAbort.abort(); } catch { /* уже */ } } }
  async function liveLoop() {
    lvRun = true;
    try {
      while (lvWanted() && !rtcLive()) {
        const L = wantLevel();
        const { w, q } = LEVELS[L];
        lvReqL = L;
        const after = lvRefit ? Math.max(0, lvSeq - 1) : lvSeq;
        lvRefit = false;
        lvAbort = new AbortController();
        const t0 = performance.now();
        let r;
        try { r = await fetch(`/api/v1/op/live?s=${encodeURIComponent(scr)}&after=${after}&w=${w}&q=${q}`, { headers: authHdr(), signal: lvAbort.signal, cache: 'no-store' }); } catch { if (!lvWanted()) break; if (lvRefit) continue; await sleep(1500); continue; }
        if (r.status === 204) continue;
        if (!r.ok) { await sleep(r.status === 403 ? 10000 : 2000); continue; }
        let b;
        try { b = await r.blob(); } catch { continue; }
        const net = performance.now() - t0 - (Number(r.headers.get('X-Wait')) || 0);
        lvSeq = Number(r.headers.get('X-Frame')) || lvSeq + 1;
        if (rtcLive()) break;
        await showFrame(b);
        $('opPvQ').textContent = `${w}px · ${Math.round(b.size / 1024)} КБ`;
        // Авто: долго шло — мельче; быстро несколько раз подряд — крупнее (не больше, чем нужно окну)
        if (lvMode === 'auto') {
          if (net > 450 && lvl > 0) { lvl--; lvGood = 0; ls.set(LS + 'lvl', String(lvl)); }
          else if (net < 160) { if (++lvGood >= 4 && lvl < LEVELS.length - 1) { lvl++; lvGood = 0; ls.set(LS + 'lvl', String(lvl)); } }
          else lvGood = 0;
        }
        // Не чаще: экономно — раз в 0,7 с, авто — 5 кадров/с (медленная сеть — реже), чётко — 8
        const gap = lvMode === 'eco' ? 700 : lvMode === 'hq' ? 120 : Math.max(180, net);
        await sleep(gap);
      }
    } finally { lvRun = false; lvAbort = null; lvReqL = -1; }
  }
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

  /* ----- Видео (WebRTC): программа шлёт экран видеопотоком VP8/H.264, битрейт по режиму (opcast.js) ----- */
  let rtc = null;      // { sid, state: 'wait' | 'on', pc, t, mode, w, stats }
  let rtcFailAt = 0;   // сорвалось — минуту только картинки
  const rtcCan = () => typeof RTCPeerConnection === 'function' && Date.now() - rtcFailAt > 60000;
  const vidW = () => Math.round(Math.max(160, ...pvImgs().map((x) => x.parentElement.clientWidth)) * Math.min(2, devicePixelRatio || 1));
  // Одно видео: туда, где сейчас видна картинка экрана (справа / вкладка «Экран» или полоса внизу)
  function placeVid() {
    const v = $('opVid');
    const host = $('opPv').offsetParent ? $('opPv') : $('opDockPv');
    if (v.parentElement === host) return;
    host.insertBefore(v, host.firstChild.nextSibling);
    if (v.srcObject) v.play().catch(() => {}); // перенос в другое место останавливает видео
    for (const x of [$('opPv'), $('opDockPv')]) x.classList.toggle('vid', x === host && rtcLive());
  }
  function rtcStart() {
    rtc = { sid: scr, state: 'wait', pc: null, mode: lvMode, w: vidW(), stats: 0, bytes: 0, at: 0 };
    rtc.t = setTimeout(() => rtcFail(), 9000);
    if (!wsSend({ t: 'rtc', k: 'start', sid: scr, mode: lvMode, w: rtc.w })) rtcFail();
  }
  function rtcMode() {
    const w = vidW();
    if (!rtc || (rtc.mode === lvMode && Math.abs(rtc.w - w) < 64)) return;
    rtc.mode = lvMode;
    rtc.w = w;
    wsSend({ t: 'rtc', k: 'mode', sid: rtc.sid, mode: lvMode, w });
  }
  function rtcStop(say = true) {
    if (!rtc) return;
    const r = rtc;
    rtc = null;
    clearTimeout(r.t);
    clearInterval(r.stats);
    try { if (r.pc) r.pc.close(); } catch { /* уже */ }
    if (say) wsSend({ t: 'rtc', k: 'bye' });
    const v = $('opVid');
    v.srcObject = null;
    for (const x of [$('opPv'), $('opDockPv')]) x.classList.remove('vid');
  }
  function rtcFail() {
    rtcStop();
    rtcFailAt = Date.now();
    if (opened) liveKick(); // картинками
  }
  async function rtcMsg(m) {
    const r = rtc;
    if (!r) return;
    try {
      if (m.k === 'fail') { rtcFail(); return; }
      if (m.k === 'offer') {
        const pc = new RTCPeerConnection({ iceServers: [] });
        r.pc = pc;
        pc.ontrack = (e) => {
          const v = $('opVid');
          v.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
          v.play().catch(() => {});
        };
        pc.onicecandidate = (e) => wsSend({ t: 'rtc', k: 'ice', c: e.candidate ? e.candidate.toJSON() : null });
        pc.onconnectionstatechange = () => {
          if (rtc !== r) return;
          if (pc.connectionState === 'connected' && r.state !== 'on') {
            r.state = 'on';
            clearTimeout(r.t);
            liveStop(); // картинки больше не нужны
            for (const x of [$('opPv'), $('opDockPv')]) x.classList.add('vid');
            r.stats = setInterval(() => rtcStats(r), 2000);
          }
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) rtcFail();
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        wsSend({ t: 'rtc', k: 'answer', sdp: pc.localDescription.sdp });
      } else if (m.k === 'ice' && r.pc) {
        if (m.c) await r.pc.addIceCandidate(m.c);
      }
    } catch { rtcFail(); }
  }
  // Сколько идёт по сети — в углу картинки
  async function rtcStats(r) {
    if (rtc !== r || !r.pc) return;
    try {
      const st = await r.pc.getStats();
      st.forEach((x) => {
        if (x.type !== 'inbound-rtp' || x.kind !== 'video') return;
        const now = x.timestamp;
        if (r.at) { const kbit = Math.round(((x.bytesReceived - r.bytes) * 8) / (now - r.at)); $('opPvQ').textContent = `Видео · ${x.frameWidth || '?'}px · ${kbit} кбит/с`; }
        r.at = now;
        r.bytes = x.bytesReceived;
      });
    } catch { /* нет */ }
  }
  async function showFrame(b) {
    const u = URL.createObjectURL(b);
    const im = new Image();
    im.src = u;
    try { await im.decode(); } catch { /* покажем как есть */ }
    for (const x of [$('opPvImg'), $('opDockImg')]) { x.src = u; x.classList.add('on'); }
    if (lvUrl) URL.revokeObjectURL(lvUrl);
    lvUrl = u;
  }

  /* ===== Библия ===== */
  let bBooks = null;      // { id, books: [{ bi, name, n }] }
  let bView = { bi: -1, ci: -1 }; // открытая глава (-1 — список книг)
  let bChap = null;       // { id, bi, ci, name, n, verses }
  let bRange = null;      // «Несколько стихов»: первый выбранный
  let bTouched = 0;       // когда человек сам листал Библию (тогда не перескакиваем за экраном)
  let bRes = null;        // результаты поиска

  async function bibleOpen() {
    const B = S.bible;
    const sel = $('opBiSel');
    if (B) {
      const sig = JSON.stringify(B.list) + B.cur;
      if (sel.dataset.sig !== sig) {
        sel.dataset.sig = sig;
        sel.replaceChildren(...B.list.map((b) => { const o = noi(el('option', '', b.name)); o.value = b.id; o.selected = b.id === B.cur; return o; }));
      }
      sel.value = B.cur;
    }
    if (!B || !B.cur) { $('opBiBody').replaceChildren(el('p', 'empty', 'В программе нет Библии — добавьте перевод (вкладка «Библия»)')); return; }
    if (!bBooks || bBooks.id !== B.cur) {
      bBooks = (await dget('i', 'bb:' + B.cur)) || null;
      if (!bBooks || bBooks.id !== B.cur) {
        try { bBooks = await call('bible.books'); dput('i', 'bb:' + bBooks.id, bBooks); } catch (e) { $('opBiBody').replaceChildren(el('p', 'empty', e.message)); return; }
      }
      bChap = null;
    }
    // За экраном: показали стих — открыть его главу (если человек сам не листал последние 15 с)
    const lb = S.live && S.live.bible;
    if (lb && Date.now() - bTouched > 15000 && !bRes && (bView.bi !== lb.bi || bView.ci !== lb.ci)) bView = { bi: lb.bi, ci: lb.ci };
    paintBible();
  }
  async function paintBible() {
    const box = $('opBiBody');
    const crumbs = el('div', 'op-crumb');
    const cb = (t, fn) => { const b = el('button', '', t); b.onclick = fn; return b; };
    crumbs.append(cb('Книги', () => { bTouched = Date.now(); bRes = null; bView = { bi: -1, ci: -1 }; paintBible(); }));
    const book = bBooks && bBooks.books.find((b) => b.bi === bView.bi);
    if (bRes) {
      crumbs.append(el('span', '', '›'), el('b', '', 'Поиск'));
      box.replaceChildren(crumbs, ...(bRes.results.length ? bRes.results.map((r) => {
        const b = el('button', 'item op-vr');
        b.append(noi(el('b', '', r.ref)), noi(el('span', '', r.text)));
        b.onclick = () => act('bible.verse', { bi: r.bi, ci: r.ci, v1: r.v });
        return b;
      }) : [el('p', 'empty', 'Ничего не найдено')]), ...(bRes.more ? [el('p', 'hint', 'Показаны первые — уточните запрос')] : []));
      return;
    }
    if (!book) {
      box.replaceChildren(crumbs, wrap('div', 'op-books', ...(bBooks ? bBooks.books : []).map((b) => {
        const x = noi(el('button', '', b.name));
        x.onclick = () => { bTouched = Date.now(); bView = { bi: b.bi, ci: b.n === 1 ? 0 : -1 }; paintBible(); };
        return x;
      })));
      return;
    }
    crumbs.append(el('span', '', '›'), cb(book.name, () => { bTouched = Date.now(); bView = { bi: book.bi, ci: -1 }; paintBible(); }));
    if (bView.ci < 0) {
      const g = el('div', 'op-chs');
      for (let ci = 0; ci < book.n; ci++) { const x = el('button', '', String(ci + 1)); x.onclick = () => { bTouched = Date.now(); bView = { bi: book.bi, ci }; paintBible(); }; g.append(x); }
      box.replaceChildren(crumbs, g);
      return;
    }
    crumbs.append(el('span', '', '›'), el('b', '', String(bView.ci + 1)));
    const want = `${bBooks.id}:${bView.bi}:${bView.ci}`;
    if (!bChap || `${bChap.id}:${bChap.bi}:${bChap.ci}` !== want) {
      bChap = (await dget('i', 'bc:' + want)) || null;
      if (!bChap) {
        box.replaceChildren(crumbs, el('p', 'hint', 'Загружаю…'));
        try { bChap = await call('bible.chapter', { bi: bView.bi, ci: bView.ci }); dput('i', 'bc:' + want, bChap); } catch (e) { box.replaceChildren(crumbs, el('p', 'empty', e.message)); return; }
      }
    }
    const nav = el('div', 'op-chnav');
    const prev = el('button', '', '‹ Глава');
    prev.disabled = bView.ci <= 0;
    prev.onclick = () => { bTouched = Date.now(); bView = { bi: bView.bi, ci: bView.ci - 1 }; paintBible(); };
    const next = el('button', '', 'Глава ›');
    next.disabled = bView.ci >= book.n - 1;
    next.onclick = () => { bTouched = Date.now(); bView = { bi: bView.bi, ci: bView.ci + 1 }; paintBible(); };
    const rg = el('button', bRange ? 'on' : '', bRange ? `С ${bRange} — выберите последний` : 'Несколько стихов');
    rg.onclick = () => { bRange = bRange ? null : -1; paintBible(); };
    nav.append(prev, rg, next);
    const list = el('div', 'op-vs');
    bChap.verses.forEach((t, i) => {
      if (!t) return;
      const b = el('button', 'op-v');
      b.dataset.v = String(i + 1);
      b.append(el('b', '', String(i + 1)), noi(el('span', '', t)));
      b.onclick = () => {
        const v = i + 1;
        if (bRange === -1) { bRange = v; paintBible(); return; }
        if (bRange) { const a = Math.min(bRange, v); const z = Math.max(bRange, v); bRange = null; act('bible.verse', { bi: bView.bi, ci: bView.ci, v1: a, v2: z }); paintBible(); return; }
        b.classList.add('pend');
        act('bible.verse', { bi: bView.bi, ci: bView.ci, v1: v });
      };
      list.append(b);
    });
    box.replaceChildren(crumbs, nav, list);
    markVerses(true);
  }
  function markVerses(scroll) {
    const lb = S.live && S.live.bible;
    let hit = null;
    for (const b of $('opBiBody').querySelectorAll('.op-v')) {
      const v = Number(b.dataset.v);
      const y = !!lb && lb.bi === bView.bi && lb.ci === bView.ci && v >= lb.v1 && v <= lb.v2;
      b.classList.toggle('live', y);
      if (y) { b.classList.remove('pend'); hit = hit || b; }
      if (bRange > 0) b.classList.toggle('pick', v === bRange);
    }
    if (hit && (scroll || Date.now() - bTouched > 15000)) { const r = hit.getBoundingClientRect(); if (r.top < 120 || r.bottom > innerHeight - 90) hit.scrollIntoView({ block: 'center', behavior: scroll ? 'auto' : 'smooth' }); }
  }
  async function bibleRef() {
    const t = $('opBiRef').value.trim();
    if (!t) return;
    const r = await act('bible.ref', { text: t });
    if (r && r.bi != null) { bRes = null; bTouched = 0; bView = { bi: r.bi, ci: r.ci }; paintBible(); $('opBiRef').blur(); }
  }
  let bQT = 0;
  function bibleSearch() {
    clearTimeout(bQT);
    const q = $('opBiQ').value.trim();
    if (!q) { bRes = null; paintBible(); return; }
    bQT = setTimeout(async () => {
      try { bRes = await call('bible.search', { q }); bTouched = Date.now(); paintBible(); } catch (e) { toast(e.message); }
    }, 350);
  }

  /* ===== Медиапул ===== */
  let mDir = ls.get(LS + 'dir', '');
  let mList = null;
  function paintFolders() {
    const P = S.pool || { folders: [] };
    $('opMdFolders').replaceChildren(...P.folders.map((f) => {
      const b = noi(el('button', mDir && mDir.toLowerCase().startsWith(f.path.toLowerCase()) ? 'on' : '', '📁 ' + f.name));
      b.onclick = () => { mDir = f.path; ls.set(LS + 'dir', mDir); mediaLoad(); };
      return b;
    }));
    if (!P.folders.length) $('opMdFolders').append(el('p', 'hint', 'В программе нет папок медиапула — закрепите папку в медиапуле (F8 → «＋»)'));
  }
  function mediaOpen() {
    paintFolders();
    const P = S.pool || { folders: [] };
    if (!mDir || !P.folders.some((f) => mDir.toLowerCase().startsWith(f.path.toLowerCase()))) mDir = P.folders[0] ? P.folders[0].path : '';
    if (!mList || mList.dir !== mDir) mediaLoad(); else paintMedia();
  }
  async function mediaLoad() {
    paintFolders();
    if (!mDir) { $('opMdGrid').replaceChildren(); $('opMdPath').textContent = ''; return; }
    const cached = await dget('i', 'md:' + mDir.toLowerCase());
    if (cached) { mList = cached; paintMedia(); }
    try {
      const r = await call('pool.list', { dir: mDir }, 20000);
      mList = r;
      dput('i', 'md:' + mDir.toLowerCase(), r);
      paintMedia();
    } catch (e) { if (!cached) $('opMdGrid').replaceChildren(el('p', 'empty', e.message)); }
  }
  function paintMedia() {
    const r = mList;
    if (!r) return;
    $('opMdPath').textContent = r.name || '';
    $('opMdUp').disabled = !r.up;
    $('opMdUp').onclick = () => { if (r.up) { mDir = r.up; ls.set(LS + 'dir', mDir); mediaLoad(); } };
    const grid = $('opMdGrid');
    grid.replaceChildren(...r.dirs.map((d) => {
      const b = el('button', 'op-mf dir');
      b.append(el('span', 'op-im txt', '📁'), noi(el('span', 'op-lb', d.name)));
      b.onclick = () => { mDir = d.path; ls.set(LS + 'dir', mDir); mediaLoad(); };
      return b;
    }), ...r.files.map((f) => {
      const b = el('button', 'op-mf');
      b.dataset.name = f.name;
      const im = el('span', 'op-im');
      if (f.type === 'audio') { im.classList.add('txt'); im.textContent = '♪'; } else {
        const img = el('img');
        img.alt = '';
        img.dataset.k = 'p';
        img.dataset.v = f.id;
        im.append(img);
        if (f.type === 'video') im.classList.add('vid');
        lazyImg(img);
      }
      b.append(im, noi(el('span', 'op-lb', f.name)));
      b.onclick = () => { b.classList.add('pend'); setTimeout(() => b.classList.remove('pend'), 1500); act('pool.show', { id: f.id }, f.type === 'audio' ? 'Музыка включена' : ''); };
      return b;
    }));
    if (!grid.children.length) grid.append(el('p', 'empty', 'В этой папке нет фото, видео и музыки'));
    markMedia();
  }
  function markMedia() {
    const names = new Set(((S.live && S.live.layers) || []).filter((l) => l.on).map((l) => l.label));
    for (const b of $('opMdGrid').querySelectorAll('.op-mf[data-name]')) { const y = names.has(b.dataset.name); b.classList.toggle('live', y); if (y) b.classList.remove('pend'); }
  }

  /* ===== Ещё: макросы, плашки, таймеры, сообщение сцене, настройки пульта ===== */
  function paintMore() {
    const box = $('opMoBody');
    if (box.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) { tickTimers(); return; } // не мешать вводу
    const out = [];
    const sec = (title) => { const s = el('section', 'op-sec'); s.append(el('h3', '', title)); out.push(s); return s; };
    sec('Макросы').append(...partMacros());
    sec('Плашки').append(...partPlates());
    sec('Таймеры').append(...partTimers());

    const ss = sec('Сообщение на сцену');
    const mr = el('div', 'msg-row');
    const mi = el('input', 'field');
    Object.assign(mi, { placeholder: 'Видят только сценические экраны', maxLength: 300, enterKeyHint: 'send', value: '' });
    const send = () => { const t = mi.value.trim(); if (!t) return; act('stage.msg', { text: t }, 'Сообщение на сцене'); mi.value = ''; mi.blur(); };
    mi.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    const mg = el('button', 'primary', 'Отправить');
    mg.onclick = send;
    mr.append(mi, mg);
    ss.append(mr);
    const cur = (S.stage && S.stage.msg) || '';
    if (cur) {
      const now = el('div', 'op-stmsg');
      now.append(noi(el('span', '', '● ' + cur)));
      const x = el('button', 'danger', 'Убрать');
      x.onclick = () => act('stage.msg', { text: '' }, 'Сообщение убрано');
      now.append(x);
      ss.append(now);
    }

    const so = sec('Программа');
    const ub = el('button', '', 'Отменить последнее (Ctrl+Z)');
    ub.onclick = async () => { if (await ask('Отменить последнее изменение в программе (как Ctrl+Z)?', 'Отменить')) act('undo', {}, 'Отменено'); };
    so.append(wrap('div', 'op-btns', ub));

    const sv = sec('Пульт на этом устройстве');
    const seg = (label, cur, opts, fn) => {
      const r = el('div', 'row-i step');
      r.append(el('span', '', label));
      const g = el('div', 'seg');
      for (const [v, t] of opts) { const b = el('button', '', t); b.setAttribute('aria-pressed', String(v === cur)); b.onclick = () => { fn(v); paintMore(); }; g.append(b); }
      r.append(g);
      return r;
    };
    sv.append(
      seg('Трансляция экрана', lvMode, [['auto', 'Авто'], ['eco', 'Экономно'], ['hq', 'Чётко'], ['off', 'Выкл']], (v) => { lvMode = v; ls.set(LS + 'lv', v); liveKick(); }),
      seg('Слайды', imgMode ? '1' : '0', [['1', 'Картинки'], ['0', 'Текст']], (v) => { imgMode = v === '1'; ls.set(LS + 'img', v); const vv = views.get(vk); if (vv) renderView(vv); }),
      seg('Картинки заранее', preload ? '1' : '0', [['1', 'Весь список'], ['0', 'Только видимые']], (v) => { preload = v === '1'; ls.set(LS + 'pre', v); }),
    );
    const cl = el('button', '', 'Очистить кэш пульта');
    cl.onclick = async () => {
      if (!(await ask('Стереть сохранённые на устройстве слайды и картинки пульта? Они скачаются снова.', 'Стереть'))) return;
      const d = await idb();
      if (d) { try { const t = d.transaction(['t', 'i'], 'readwrite'); t.objectStore('t').clear(); t.objectStore('i').clear(); } catch { /* нет */ } }
      items.clear();
      views.clear();
      toast('Кэш пульта очищен');
      loadView();
    };
    sv.append(wrap('div', 'op-btns', cl),el('p', 'hint', 'Слайды и картинки хранятся на устройстве: второй раз список открывается сразу, а по сети идёт только то, что поменялось.'));
    box.replaceChildren(...out);
    tickTimers();
  }
  // Части «Ещё» — они же во вкладках под экраном (opStabs)
  function partMacros() {
    const M = S.macros || [];
    if (!M.length) return [el('p', 'hint', 'Макросов нет')];
    const g = el('div', 'op-btns');
    for (const m of M) { const b = noi(el('button', '', m.name)); b.onclick = () => act('macro', { id: m.id }, `Макрос «${m.name}»`); g.append(b); }
    return [g];
  }
  function partPlates() {
    const P = S.plates || { list: [], live: '' };
    if (!P.list.length) return [el('p', 'hint', 'Плашек нет — их делают в программе (значок «Плашки» сверху)')];
    const g = el('div', 'op-btns');
    for (const p of P.list) { const b = noi(el('button', p.id === P.live ? 'on' : '', p.name)); b.onclick = () => act('plate', { id: p.id }); g.append(b); }
    const h = el('button', 'danger', 'Убрать плашку');
    h.disabled = !P.live;
    h.onclick = () => act('plate', { id: '' });
    g.append(h);
    return [g];
  }
  function partTimers() {
    const T = S.timers || { list: [] };
    if (!T.list.length) return [el('p', 'hint', 'Таймеров нет — «＋ Таймер» в программе (панель «Сцена»)')];
    return T.list.map((t) => {
      const row = el('div', 'op-tm');
      row.dataset.tm = t.id;
      row.append(noi(el('span', 'nm', t.name)), el('b', 'val', ''));
      if (t.mode !== 'to') {
        const p = el('button', t.run ? 'on' : 'primary', t.run ? '❚❚ Пауза' : '▶ Пуск');
        p.onclick = () => act('timer', { id: t.id, op: 'toggle' });
        const r = el('button', '', '⟲');
        r.title = 'Сначала';
        r.onclick = () => act('timer', { id: t.id, op: 'reset' });
        row.append(p, r);
        if (t.mode === 'down') {
          const d = el('input', 'field op-dur');
          Object.assign(d, { value: fmtMs(t.dur * 1000), inputMode: 'numeric', enterKeyHint: 'done', title: 'Время: минуты или мм:сс' });
          d.onchange = () => act('timer', { id: t.id, op: 'dur', v: d.value });
          row.append(d);
        }
      }
      tickRow(row);
      return row;
    });
  }

  /* ===== Под экраном: вкладки Слои / Таймеры / Плашки / Макросы ===== */
  function paintSide() {
    if (!['ly', 'tm', 'pl', 'mc'].includes(stab)) stab = 'ly';
    for (const b of $('opStabs').children) b.setAttribute('aria-selected', String(b.dataset.s === stab));
    $('opLayers').hidden = stab !== 'ly';
    const o = $('opSother');
    o.hidden = stab === 'ly';
    if (stab === 'ly') { o.replaceChildren(); return; }
    if (o.contains(document.activeElement) && /INPUT/.test(document.activeElement.tagName)) return; // не мешать вводу времени
    o.replaceChildren(...(stab === 'tm' ? partTimers() : stab === 'pl' ? partPlates() : partMacros()));
  }

  /* ===== Проигрыватель программы: музыка (и видео на экране) — всегда под рукой ===== */
  const fmtT = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600); return (h ? h + ':' + pad2(Math.floor((s % 3600) / 60)) : Math.floor(s / 60)) + ':' + pad2(s % 60); };
  const plDrag = { a: false, v: false }; // палец на ползунке — не двигать его из состояния
  let volT = 0;
  function playerNow(x) { return x && x.play ? x.t + (Date.now() - playerAt) / 1000 : x ? x.t : 0; }
  function playerRow(which, x, label) {
    const box = el('div', 'op-pl' + (which === 'v' ? ' vid' : '') + (x.play ? ' on' : ''));
    box.dataset.w = which;
    const top = el('div', 'op-pl-top');
    top.append(el('small', '', label), noi(el('b', '', x.name || (which === 'v' ? 'Видео' : 'Ничего не играет'))));
    if (which === 'a') {
      const li = el('button', 'icon op-pl-list', '☰');
      li.title = 'Песни: что играет и плейлисты музыки';
      li.onclick = () => trackPick('');
      top.append(li);
    }
    const sk = el('div', 'op-pl-seek');
    const t0 = el('span', 't', fmtT(playerNow(x)));
    const rng = Object.assign(el('input'), { type: 'range', min: 0, max: Math.max(1, x.d || 0), step: 1, value: String(Math.min(x.d || 0, playerNow(x))) });
    rng.disabled = !x.d;
    rng.setAttribute('aria-label', 'Перемотка');
    rng.onpointerdown = () => { plDrag[which] = true; };
    rng.oninput = () => { t0.textContent = fmtT(Number(rng.value)); };
    rng.onchange = () => { plDrag[which] = false; act('player.seek', { which, t: Number(rng.value) }); };
    sk.append(t0, rng, el('span', 't', fmtT(x.d)));
    const ctl = el('div', 'op-pl-ctl');
    const btn = (txt, title, fn, cls) => { const b = el('button', cls || '', txt); b.title = title; b.setAttribute('aria-label', title); b.onclick = fn; ctl.append(b); return b; };
    if (which === 'a') btn('⏮', 'Предыдущая песня', () => act('player.step', { d: -1 }));
    btn(x.play ? '❚❚' : '▶', x.play ? 'Пауза' : 'Играть', () => act('player.play', { which }), 'primary op-pl-pp');
    btn('■', 'Стоп', () => act('player.stop', { which }));
    if (which === 'a') btn('⏭', 'Следующая песня', () => act('player.step', { d: 1 }));
    const mu = btn(x.mute ? '🔇' : '🔊', x.mute ? 'Звук выключен — включить' : 'Выключить звук (Mute)', () => act('player.mute', { which }), 'op-pl-mute' + (x.mute ? ' on' : ''));
    mu.setAttribute('aria-pressed', String(!!x.mute));
    const vol = Object.assign(el('input'), { type: 'range', min: 0, max: 100, step: 1, value: String(x.vol) });
    vol.className = 'op-pl-vol';
    vol.setAttribute('aria-label', 'Громкость');
    vol.onpointerdown = () => { plDrag[which] = true; };
    // Громкость — сразу, пока ведут пальцем (не чаще 6 раз в секунду)
    vol.oninput = () => { clearTimeout(volT); volT = setTimeout(() => call('player.vol', { which, v: Number(vol.value) }).catch(() => {}), 150); };
    vol.onchange = () => { plDrag[which] = false; clearTimeout(volT); act('player.vol', { which, v: Number(vol.value) }); };
    ctl.append(vol);
    box.append(top, sk, ctl);
    return box;
  }
  function paintPlayer() {
    const P = S.player;
    const box = $('opPlayer');
    if (!P) { box.hidden = true; return; }
    box.hidden = false;
    // Тянут ползунок — перерисуем, когда отпустят
    if (plDrag.a || plDrag.v) return;
    const rows = [playerRow('a', P.a, 'Музыка')];
    if (P.v) rows.push(playerRow('v', P.v, 'Видео на экране'));
    box.replaceChildren(...rows);
  }
  // Время идёт само, пока играет (состояние приходит раз в секунду, а то и реже)
  setInterval(() => {
    const P = S.player;
    if (!opened || !P) return;
    for (const r of $('opPlayer').querySelectorAll('.op-pl.on')) {
      const x = r.dataset.w === 'v' ? P.v : P.a;
      if (!x || plDrag[r.dataset.w]) continue;
      const t = Math.min(x.d || Infinity, playerNow(x));
      r.querySelector('.op-pl-seek .t').textContent = fmtT(t);
      r.querySelector('.op-pl-seek input').value = String(t);
    }
  }, 500);
  // Список песен: что играет сейчас и плейлисты музыки программы
  async function trackPick(id) {
    const P = S.player || { lists: [] };
    const tabs = el('div', 'op-chips');
    for (const l of [{ id: '', name: 'Сейчас играет' }, ...(P.lists || [])]) {
      const b = noi(el('button', l.id === id ? 'on' : '', l.name + (l.n != null ? ' · ' + l.n : '')));
      b.onclick = () => trackPick(l.id);
      tabs.append(b);
    }
    const list = el('div', 'op-tracks');
    list.append(el('p', 'hint', 'Загружаю…'));
    pickOpen('Музыка', [tabs, list]);
    let r;
    try { r = await call('player.list', { id }); } catch (e) { list.replaceChildren(el('p', 'empty', e.message)); return; }
    if (!r.tracks.length) { list.replaceChildren(el('p', 'empty', 'Список пуст')); return; }
    list.replaceChildren(...r.tracks.map((n, i) => {
      const b = el('button', 'item op-tr' + (i === r.cur ? ' on' : ''));
      b.append(el('span', 'n', String(i + 1)), noi(el('span', 't', n)));
      b.onclick = () => { act('player.track', { id, i }); $('opPickDlg').close(); };
      return b;
    }));
    const cur = list.querySelector('.on');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
  function pickOpen(title, kids) {
    $('opPickTitle').textContent = title;
    $('opPickBody').replaceChildren(...kids);
    const d = $('opPickDlg');
    if (!d.open) d.showModal();
  }

  /* ===== Какой экран смотреть: Основной, другие экраны, сцены (как выбор в «Предпросмотре» программы) ===== */
  const scrList = () => (S.live && S.live.screens) || [{ id: 'main', name: 'Основной' }];
  function paintScr() {
    const l = scrList();
    if (!l.some((s) => s.id === scr)) scr = 'main';
    const s = l.find((x) => x.id === scr) || l[0];
    const b = $('opPvScr');
    b.textContent = (s.scene ? 'Сцена: ' : '') + s.name + (l.length > 1 ? ' ▾' : '');
    b.hidden = l.length < 2 && scr === 'main';
    b.disabled = l.length < 2;
  }
  function scrPick() {
    pickOpen('Какой экран смотреть', scrList().map((s) => {
      const b = el('button', 'item op-tr' + (s.id === scr ? ' on' : ''));
      b.append(noi(el('span', 't', (s.scene ? 'Сцена: ' : '') + s.name)));
      b.onclick = () => {
        $('opPickDlg').close();
        if (s.id === scr) return;
        scr = s.id;
        ls.set(LS + 'scr', scr);
        paintScr();
        lvSeq = 0;
        for (const x of [$('opPvImg'), $('opDockImg')]) x.classList.remove('on');
        rtcStop();
        liveStop();
        setTimeout(liveKick, 50);
      };
      return b;
    }));
  }

  /* ===== Лупа: песни и презентации, файлы медиапула и музыки, место Писания (как Ctrl+F) ===== */
  let findT = 0;
  let findTok = 0;
  function findOpen() {
    const d = $('opFindDlg');
    if (!d.open) d.showModal();
    const q = $('opFindQ');
    q.focus();
    q.select();
    if (!q.value) $('opFindBody').replaceChildren(el('p', 'hint', 'Ищет по названиям и тексту песен и презентаций, по файлам медиапула и музыки (во всех папках), а «Ин 3:16» — покажет место Писания.'));
  }
  async function findRun() {
    const q = $('opFindQ').value.trim();
    const box = $('opFindBody');
    const tok = ++findTok;
    if (q.length < 2) { box.replaceChildren(el('p', 'hint', 'Наберите хотя бы две буквы')); return; }
    let r;
    try { r = await call('search', { q }, 20000); } catch (e) { if (tok === findTok) box.replaceChildren(el('p', 'empty', e.message)); return; }
    if (tok !== findTok) return;
    const out = [];
    if (r.ref) {
      const b = el('button', 'primary op-find-ref');
      b.append(document.createTextNode('📖 '), noi(el('span', '', r.ref)));
      b.onclick = async () => { const x = await act('bible.ref', { text: q }); if (x) { $('opFindDlg').close(); if (x.bi != null) { bView = { bi: x.bi, ci: x.ci }; bTouched = Date.now(); } setTab('bi'); } };
      out.push(b);
    }
    if (r.items.length) {
      out.push(el('h3', 'op-h', 'Песни и презентации'));
      out.push(...r.items.map((it) => {
        const b = el('button', 'item op-fr');
        const t = el('span', 'tt');
        t.append(noi(el('b', '', it.name)), noi(el('span', 's', kindName(it) + ' · ' + slidesN(it.n) + ' · ' + it.at.list)));
        if (it.hit) t.append(noi(el('span', 'hit', it.hit)));
        b.append(t);
        b.onclick = () => { $('opFindDlg').close(); openFound(it); };
        return b;
      }));
    }
    if (r.files.length) {
      out.push(el('h3', 'op-h', 'Файлы'));
      const g = el('div', 'op-grid');
      for (const f of r.files) {
        const b = el('button', 'op-mf');
        const im = el('span', 'op-im');
        if (f.type === 'audio') { im.classList.add('txt'); im.textContent = '♪'; } else {
          const img = el('img');
          img.alt = '';
          img.dataset.k = 'p';
          img.dataset.v = f.id;
          im.append(img);
          if (f.type === 'video') im.classList.add('vid');
          fillImg(img, true);
        }
        b.append(im, noi(el('span', 'op-lb', f.name)));
        b.title = f.dir;
        b.onclick = () => { b.classList.add('pend'); act('pool.show', { id: f.id }, f.type === 'audio' ? 'Музыка включена' : 'На экране'); };
        g.append(b);
      }
      out.push(g);
    }
    if (!out.length) out.push(el('p', 'empty', 'Ничего не найдено'));
    box.replaceChildren(...out);
  }
  // Найденная презентация: открыть её список и прокрутить к ней
  async function openFound(it) {
    vk = it.at.vk;
    ls.set(LS + 'vk', vk);
    libPick = it.at.key;
    libQ = '';
    setTab('sl');
    paintLists();
    await loadView();
    const sec = $('opFeed').querySelector(`.op-it[data-key="${CSS.escape(it.at.key)}"]`);
    if (sec) { sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); sec.classList.add('flash'); setTimeout(() => sec.classList.remove('flash'), 1600); }
  }

  const pad2 = (v) => String(v).padStart(2, '0');
  function fmtMs(ms) {
    const neg = ms < 0;
    let s = Math.abs(ms) / 1000;
    s = neg ? Math.floor(s) : Math.ceil(s - 0.001);
    const h = Math.floor(s / 3600);
    return (neg ? '−' : '') + (h ? `${h}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}` : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`);
  }
  function timerMs(t) {
    const now = Date.now() + tOffOp;
    if (t.mode === 'to') {
      const m = /^(\d{1,2}):(\d{2})/.exec(t.at || '');
      if (!m) return 0;
      const d = new Date(now);
      d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      let ms = d.getTime() - now;
      if (ms < -6 * 3600e3) ms += 24 * 3600e3;
      return ms;
    }
    const el2 = t.base + (t.run ? now - t.t0 : 0);
    return t.mode === 'up' ? el2 : t.dur * 1000 - el2;
  }
  function tickRow(row) {
    const T = S.timers;
    const t = T && T.list.find((x) => x.id === row.dataset.tm);
    if (!t) return;
    const ms = timerMs(t);
    const v = row.querySelector('.val');
    v.textContent = fmtMs(ms);
    v.classList.toggle('neg', ms < 0 && t.mode !== 'up');
  }
  function tickTimers() {
    if (!S.timers || !opened) return;
    for (const row of $('scrOp').querySelectorAll('.op-tm')) tickRow(row);
  }
  setInterval(tickTimers, 500);

  /* ===== Правка текста слайда (долгое нажатие на текстовый слайд) ===== */
  function editSlide(it, s) {
    const d = $('opEdDlg');
    $('opEdTitle').textContent = it.name + (s.label ? ' — ' + s.label : '');
    $('opEdTa').value = s.text || '';
    $('opEdOk').onclick = async () => {
      const r = await act('slide.text', { id: it.id, sid: s.id, text: $('opEdTa').value }, 'Текст изменён — Ctrl+Z в программе вернёт');
      if (r) { d.close(); refreshItems([it.id], true); }
    };
    d.showModal();
  }

  /* ===== Кнопки ===== */
  function wire() {
    $('tabOp').onclick = () => open();
    $('opBack').onclick = () => { if (history.state && history.state.op) history.back(); else close(); };
    window.addEventListener('popstate', () => { if (screen === 'Op') close(); });
    for (const b of $('opTabs').children) b.onclick = () => setTab(b.dataset.t);
    const step = (d) => act('step', { d });
    for (const id of ['opPrev', 'opDPrev']) $(id).onclick = () => step(-1);
    for (const id of ['opNext', 'opDNext']) $(id).onclick = () => step(1);
    for (const b of $('opStabs').children) b.onclick = () => { stab = b.dataset.s; ls.set(LS + 'stab', stab); paintSide(); };
    $('opPvScr').onclick = scrPick;
    $('opPickX').onclick = () => $('opPickDlg').close();
    $('opFind').onclick = findOpen;
    $('opFindX').onclick = () => $('opFindDlg').close();
    $('opFindQ').oninput = () => { clearTimeout(findT); findT = setTimeout(findRun, 300); };
    $('opFindQ').onkeydown = (e) => { if (e.key === 'Enter') { clearTimeout(findT); findRun(); } };
    $('opDClr').onclick = () => act('clear', { what: 'pres' });
    longPress($('opDClr'), () => act('clear', { what: 'all' }, 'Экран очищен'));
    $('opHall').onclick = () => act('out', { g: 'hall', on: !(S.live && S.live.hall && S.live.hall.on) });
    $('opStage').onclick = () => act('out', { g: 'stage', on: !(S.live && S.live.stage && S.live.stage.on) });
    $('opDockPv').onclick = () => setTab('sc');
    $('opBiGo').onclick = bibleRef;
    $('opBiRef').onkeydown = (e) => { if (e.key === 'Enter') bibleRef(); };
    $('opBiPrev').onclick = () => act('bible.step', { d: -1 });
    $('opBiNext').onclick = () => act('bible.step', { d: 1 });
    $('opBiSel').onchange = () => act('bible.set', { id: $('opBiSel').value });
    $('opBiQ').oninput = bibleSearch;
    $('opEdX').onclick = () => $('opEdDlg').close();
    document.addEventListener('visibilitychange', liveKick);
    matchMedia('(min-width: 900px)').addEventListener('change', () => { if (tab === 'sc' && wide()) setTab('sl'); liveKick(); });
    // Повернули планшет — картинка экрана могла стать крупнее
    let rzT = 0;
    addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (opened) liveKick(); }, 300); });
    // Клавиатура (планшет с клавиатурой, пульт-кликер): стрелки, пробел, PageUp/Down — листать, Esc — убрать текст
    document.addEventListener('keydown', (e) => {
      // Ctrl+F / F3 — лупа, как на компьютере
      if (opened && ((e.key === 'f' || e.key === 'F' || e.code === 'KeyF') && (e.ctrlKey || e.metaKey) || e.key === 'F3')) { e.preventDefault(); findOpen(); return; }
      if (!opened || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || document.querySelector('dialog[open]')) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); step(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); act('clear', { what: 'pres' }); }
    });
    perms();
  }

  return { wire, onMsg, onWelcome, onLost, perms, open, close, paintConn, get opened() { return opened; } };
})();
Op.wire(); // app.js уже загружен (op.js подключён после него)
