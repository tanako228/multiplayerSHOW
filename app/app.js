/* Экраны приложения группы. Данные и связь — db.js (Store).
   Вход: имя и роль → «Попросить доступ» → ждём оператора (долгий запрос /join/wait) → ключ устройства.
   Песни: сразу то, что лежит на телефоне (без сети тоже); раз в 15 с /me — «на связи?» и номер изменений:
   поменялось у оператора — докачиваем только изменения. Ключ отозван / приостановлен / доступ выключен —
   полоса сверху, песни на телефоне остаются. Назад (кнопка телефона) — из песни в список (history). */
'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ROLES = [['musician', 'Музыкант'], ['vocal', 'Вокалист'], ['leader', 'Лидер'], ['sound', 'Звук'], ['tech', 'Техник']];
const PING_MS = 15000;
const fmt = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } } };
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let screen = '';
let conn = 'start';   // ok | net | auth | off | closed | start
let prog = null;      // { got, total } — идёт загрузка
let pingT = 0;
let updated = false;  // пришли новые файлы приложения (sw.js) — предложить перезапуск

function show(name) {
  screen = name;
  for (const s of document.querySelectorAll('.scr')) s.hidden = s.id !== 'scr' + name;
}

let toastT = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 3200);
}

// Вопрос «Да / Отмена» — своё окно (системное confirm на телефоне выглядит чужим)
function ask(text, ok = 'Да') {
  return new Promise((resolve) => {
    const d = $('ask');
    $('askText').textContent = text;
    $('askOk').textContent = ok;
    const done = (v) => { d.close(); $('askOk').onclick = $('askNo').onclick = null; resolve(v); };
    $('askOk').onclick = () => done(true);
    $('askNo').onclick = () => done(false);
    d.onclose = () => resolve(false);
    d.showModal();
  });
}

// Что за устройство — видит оператор в окне «Группа»
function devName() {
  const ua = navigator.userAgent;
  const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : 'Устройство';
  const model = (/Android [\d.]+; ([^;)]+)\)/.exec(ua) || [])[1];
  const br = /SamsungBrowser/.test(ua) ? 'Samsung' : /YaBrowser/.test(ua) ? 'Яндекс' : /EdgA?\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return [os, model && model.trim() !== 'K' ? model.trim() : '', br].filter(Boolean).join(' · ') + (standalone() ? ' (приложение)' : '');
}

/* ----- Вход ----- */

let joinRole = ls.get('mps.role', 'musician');
function showJoin(msg) {
  show('Join');
  $('joinMsg').hidden = !msg;
  $('joinMsg').textContent = msg || '';
  if (!$('joinName').value) $('joinName').value = ls.get('mps.name', '');
  $('joinRoles').replaceChildren(...ROLES.map(([id, name]) => {
    const b = el('button', '', name);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(id === joinRole));
    b.onclick = () => { joinRole = id; for (const x of $('joinRoles').children) x.setAttribute('aria-pressed', String(x === b)); };
    return b;
  }));
}
async function doJoin() {
  const name = $('joinName').value.trim();
  if (!name) { $('joinName').focus(); showJoin('Впишите имя — его увидит оператор'); return; }
  ls.set('mps.name', name);
  ls.set('mps.role', joinRole);
  $('joinGo').disabled = true;
  try {
    const r = await Store.api('/join', { method: 'POST', body: { name, role: joinRole, dev: devName() } });
    await Store.setMeta('join', { id: r.id, secret: r.secret });
    showWait();
  } catch (e) {
    showJoin(e.code === 'net' ? 'Нет связи с программой. Телефон должен быть в той же сети Wi-Fi, что и компьютер.' : e.message);
  } finally {
    $('joinGo').disabled = false;
  }
}

async function showWait() {
  show('Wait');
  $('waitText').textContent = 'Попросите оператора открыть в программе окно «Группа» и нажать «Пустить».';
  const j = await Store.getMeta('join');
  if (!j) { showJoin(); return; }
  while (screen === 'Wait') {
    try {
      const r = await Store.api('/join/wait', { method: 'POST', body: j, timeout: 35000 });
      if (screen !== 'Wait') return;
      if (r.token) {
        await Store.saveAuth(r.token, r.me);
        await Store.delMeta('join');
        toast('Доступ открыт — загружаю песни');
        startLib();
        return;
      }
      if (r.rejected || r.gone) {
        await Store.delMeta('join');
        showJoin(r.rejected ? 'Оператор отклонил запрос.' : 'Запрос устарел — попросите доступ снова.');
        return;
      }
      $('waitText').textContent = 'Попросите оператора открыть в программе окно «Группа» и нажать «Пустить».';
    } catch (e) {
      if (screen !== 'Wait') return;
      $('waitText').textContent = e.code === 'net' ? 'Нет связи с программой — пробую снова… Телефон в той же сети Wi-Fi?' : e.message;
      await new Promise((ok) => setTimeout(ok, 4000));
    }
  }
}

/* ----- Связь и синхронизация ----- */

function paintConn() {
  const c = $('conn');
  const busy = !!prog;
  const bad = ['auth', 'off', 'closed'].includes(conn);
  c.className = 'conn' + (busy ? ' busy' : conn === 'ok' ? ' ok' : bad ? ' bad' : '');
  $('connText').textContent = busy ? (prog.total > 50 ? `Загружаю ${prog.got} из ${prog.total}` : 'Обновляю…')
    : conn === 'ok' ? 'На связи' : conn === 'net' ? 'Нет связи' : bad ? 'Нет доступа' : 'Подключаюсь…';
  const p = $('prog');
  p.hidden = !busy || prog.total <= 50;
  if (busy && prog.total) $('progBar').style.width = Math.round((100 * prog.got) / prog.total) + '%';
  // Полоса сверху — что случилось с доступом
  const msg = conn === 'auth' ? 'Оператор отозвал доступ этого телефона. Песни на телефоне остались.'
    : conn === 'off' ? 'Оператор приостановил доступ этого телефона. Песни на телефоне остались, новые не придут.'
      : conn === 'closed' ? 'Доступ для группы выключен в программе. Песни на телефоне остались.' : '';
  const upd = !msg && updated;
  $('banner').hidden = !msg && !upd;
  $('bannerText').textContent = upd ? 'Приложение обновилось.' : msg;
  $('bannerBtn').hidden = !upd && conn !== 'auth';
  $('bannerBtn').textContent = upd ? 'Перезапустить' : 'Попросить доступ снова';
  if ($('sheet').open) paintSheet();
}

async function ping() {
  clearTimeout(pingT);
  pingT = setTimeout(ping, PING_MS);
  if (!Store.token) return;
  try {
    const me = await Store.api('/me', { timeout: 8000 });
    conn = 'ok';
    Store.saveMe(me).catch(() => {});
    const m = Store.meta;
    if (me.lib !== m.lib || me.seq !== m.since || me.lh !== m.lh) runSync();
  } catch (e) {
    conn = ['auth', 'off', 'closed'].includes(e.code) ? e.code : 'net';
    if (conn === 'auth') await Store.dropAuth();
  }
  paintConn();
}

async function runSync(full) {
  if (Store.busy) return;
  const first = !Store.meta.at;
  prog = { got: 0, total: 0 };
  paintConn();
  try {
    const r = await (full ? Store.resync : Store.sync)((got, total) => { prog = { got, total }; paintConn(); });
    if (r.got || r.reset) {
      fillLibs();
      renderList();
      // Оператор поправил открытую песню — показать новый текст, не теряя места
      if (screen === 'Song' && Store.songs.has(curId)) { const y = window.scrollY; openSong(curId, false); window.scrollTo(0, y); }
    }
    if (first || full) {
      toast(`Песни загружены: ${Store.songs.size}`);
      // Попросить браузер не удалять песни, когда мало места (на установленном приложении обычно — да)
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }
  } catch (e) {
    if (['auth', 'off', 'closed'].includes(e.code)) { conn = e.code; if (conn === 'auth') await Store.dropAuth(); }
    else if (e.code === 'net') conn = 'net';
    else toast('Песни не обновились: ' + e.message);
  } finally {
    prog = null;
    paintConn();
  }
}

/* ----- Список песен ----- */

let rows = [];
let shown = 0;
const PAGE = 120;
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) more(); }, { rootMargin: '600px' }) : null;
const sentinel = el('div');

function fillLibs() {
  const sel = $('libSel');
  const want = ls.get('mps.lib', '');
  sel.replaceChildren(el('option', '', 'Все песни'), ...Store.libs.map((l) => {
    const o = el('option', '', l.name);
    o.value = l.id;
    return o;
  }));
  sel.firstChild.value = '';
  sel.value = Store.libs.some((l) => l.id === want) ? want : '';
}

function firstLine(s) {
  const z = s.slides.find((x) => x.text.trim());
  return z ? z.text.trim().split('\n')[0] : '';
}
function renderList() {
  rows = Store.search($('q').value, $('libSel').value);
  shown = 0;
  $('list').replaceChildren();
  more();
  $('libCount').textContent = Store.songs.size ? String(rows.length) : '';
  const e = $('empty');
  e.hidden = rows.length > 0;
  if (!rows.length) {
    e.textContent = Store.songs.size ? 'Ничего не нашлось. Попробуйте часть слова или номер.'
      : conn === 'net' ? 'Песен на телефоне ещё нет. Нужна связь с программой: телефон в той же сети Wi-Fi, что и компьютер.'
        : 'Загружаю песни…';
  }
}
function more() {
  const list = $('list');
  const end = Math.min(rows.length, shown + PAGE);
  const frag = document.createDocumentFragment();
  for (; shown < end; shown++) {
    const s = rows[shown];
    const b = el('button', 'item');
    b.type = 'button';
    b.setAttribute('role', 'listitem');
    b.dataset.id = s.id;
    b.append(el('span', 't', s.name), el('span', 's', firstLine(s)));
    frag.append(b);
  }
  list.append(frag);
  if (shown < rows.length) {
    list.append(sentinel);
    if (io) { io.disconnect(); io.observe(sentinel); }
  } else if (io) io.disconnect();
}

/* ----- Песня ----- */

let listY = 0;
let curId = '';       // открытая песня
let fs = Math.min(44, Math.max(14, Number(ls.get('mps.fs', 22)) || 22));
function setFs(v) {
  fs = Math.min(44, Math.max(14, v));
  document.documentElement.style.setProperty('--fs', fs + 'px');
  ls.set('mps.fs', String(fs));
}
function openSong(id, push) {
  const s = Store.songs.get(id);
  if (!s) return;
  if (screen === 'Lib') listY = window.scrollY;
  curId = id;
  $('songTitle').textContent = s.name;
  const body = $('songBody');
  body.replaceChildren();
  // Порядок частей (аранжировка), если части подписаны
  const order = s.slides.filter((z) => z.pi === 0 && (z.label || z.part)).map((z) => z.label || z.part);
  if (order.length > 1) body.append(el('p', 'order', order.join(' → ')));
  for (const z of s.slides) {
    const sec = el('section', 'sl' + (z.pi === 0 && (z.label || z.part) ? ' part' : ''));
    sec.dataset.id = z.id;
    if (z.pi === 0 && (z.label || z.part)) sec.append(el('h3', '', z.label || z.part));
    sec.append(el('p', '', z.text));
    body.append(sec);
  }
  if (!s.slides.length) body.append(el('p', 'hint', 'В песне нет текста'));
  show('Song');
  window.scrollTo(0, 0);
  if (push) history.pushState({ song: id }, '');
}
function closeSong() {
  show('Lib');
  window.scrollTo(0, listY);
}

/* ----- Сведения ----- */

function paintSheet() {
  const me = Store.me;
  $('iWho').textContent = me ? `${me.person.name} · ${me.person.roleName}` : '—';
  $('iDev').textContent = me ? me.device.name : devName();
  $('iConn').textContent = conn === 'ok' ? 'на связи с программой' : conn === 'net' ? 'нет связи (работаю с песнями на телефоне)'
    : conn === 'auth' ? 'доступ отозван' : conn === 'off' ? 'доступ приостановлен' : conn === 'closed' ? 'доступ выключен в программе' : 'подключаюсь…';
  $('iAddr').textContent = location.host + (location.protocol === 'https:' ? ' (защищённый)' : ' (простой)');
  $('iSongs').textContent = String(Store.songs.size);
  $('iAt').textContent = fmt(Store.meta.at);
  for (const id of ['iSync', 'iResync']) $(id).disabled = !!prog || conn !== 'ok';
  const st = $('iStore');
  if (location.protocol !== 'https:') st.textContent = 'Простой адрес: установить приложение и открывать его без сети нельзя. Для этого оператору нужно настроить в программе «Адрес и сертификат».';
  else if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => {
      st.textContent = p ? 'Песни хранятся на телефоне надёжно — браузер не удалит их сам.'
        : 'Браузер может удалить песни, если на телефоне мало места. Надёжнее — установить приложение на экран «Домой».';
    }).catch(() => { st.textContent = ''; });
  }
  $('iVer').textContent = me && me.server ? `multiplayerSHOW ${me.server.ver}` : '';
}

/* ----- Запуск ----- */

async function startLib() {
  show('Lib');
  history.replaceState({}, '');
  fillLibs();
  renderList();
  Store.onIndex = () => { if ($('q').value.trim()) renderList(); };
  Store.indexAll();
  paintConn();
  ping();
}

function wire() {
  $('joinGo').onclick = doJoin;
  $('joinName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  $('waitCancel').onclick = async () => { await Store.delMeta('join'); showJoin(); };
  let qT = 0;
  $('q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { window.scrollTo(0, 0); renderList(); }, 120); });
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('libSel').onchange = () => { ls.set('mps.lib', $('libSel').value); window.scrollTo(0, 0); renderList(); };
  $('list').addEventListener('click', (e) => { const b = e.target.closest('.item'); if (b) openSong(b.dataset.id, true); });
  $('back').onclick = () => { if (history.state && history.state.song) history.back(); else closeSong(); };
  window.addEventListener('popstate', () => { if (screen === 'Song') closeSong(); });
  $('fsMinus').onclick = () => setFs(fs - 2);
  $('fsPlus').onclick = () => setFs(fs + 2);
  $('conn').onclick = () => $('menuBtn').click();
  $('menuBtn').onclick = () => { paintSheet(); $('sheet').showModal(); };
  $('sheetX').onclick = () => $('sheet').close();
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').close(); });
  $('iSync').onclick = () => { $('sheet').close(); runSync(); };
  $('iResync').onclick = async () => { if (await ask('Загрузить все песни заново? Займёт минуту.', 'Загрузить')) { $('sheet').close(); runSync(true); } };
  $('iForget').onclick = async () => {
    if (!(await ask('Отключить этот телефон?\nКлюч доступа и все песни будут стёрты с телефона. Подключиться снова можно по QR-коду.', 'Отключить'))) return;
    $('sheet').close();
    await Store.forget();
    showJoin();
  };
  $('bannerBtn').onclick = () => { if (conn === 'auth') showJoin(); else if (updated) location.reload(); };
  // Вернулись в приложение / появилась сеть — сразу проверить связь
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Store.token) ping(); });
  window.addEventListener('online', () => { if (Store.token) ping(); });
  setFs(fs);
}

function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Программа обновилась — пришли новые файлы приложения
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had) return;
    updated = true;
    if (screen === 'Lib' || screen === 'Song') paintConn(); else location.reload();
  });
}

(async () => {
  wire();
  try {
    await Store.open();
    await Store.load();
  } catch (e) {
    showJoin('Браузер не даёт хранить данные (' + (e.message || e) + '). Откройте не в режиме «Инкогнито».');
    return;
  }
  registerSW();
  if (Store.token) startLib();
  else if (Store.songs.size && Store.meta.lib) { startLib(); conn = 'auth'; paintConn(); }
  else if (await Store.getMeta('join')) showWait();
  else showJoin();
})();
