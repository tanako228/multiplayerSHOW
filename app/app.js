/* Экраны приложения группы. Данные и синхронизация песен — db.js (Store).
   Вход: имя и роль → «Попросить доступ» → ждём оператора (долгий запрос /join/wait) → ключ устройства.
   Песни: сразу то, что лежит на телефоне (без сети тоже). Связь — WebSocket /ws (протокол v1, teamapi.js):
   hello с ключом → welcome; ping раз в 15 с; оборвалось — снова через 1 → 2 → 4 … 30 с (между попытками —
   /me по http: узнать, что случилось, и докачать песни, даже если WebSocket не проходит).
   Программа присылает: live (что на экране), lib (песни поменялись — докачать изменения), sets (сетлисты), me, bye.
   «Следовать» — телефон сам открывает то, что на экране, и держит текущий слайд перед глазами;
   «Листать самому» — смотреть своё, внизу полоса «На экране: …». Право «Может листать» (оператор, окно «Группа») —
   кнопки ◀ ▶ «Убрать» и «Показать на экране» у слайда. Ключ отозван / приостановлен / доступ выключен —
   полоса сверху, песни на телефоне остаются. Назад (кнопка телефона) — из песни в список (history).
   Текст слайда — строки (.ln) из слов (.w): к словам привязаны пометки (pen.js, этап 3).
   Аккорды (этап 4): song.chords раскладывает по строкам chords.js (общий с программой); аккорд — пустой значок .cd
   внутри слова (номера слов не меняются — пометки на месте). Транспонирование и капо — на песню (localStorage mps.tr);
   тональность строки сетлиста сама сдвигает аккорды. Аккорды по умолчанию: Музыкант, Лидер — да, остальные — нет.
   «Моя версия» (этап 5, mine.js): переключатель «Оригинал / Моя версия» над песней, редактор, «Оригинал изменился».
   Этап 6: вход по паролю (режим входа — /join/info), сообщения группе (msg; писать — Лидер, Звук), метроном: свой или
   общий (metro от программы: удары от t0 по часам программы; поправка часов — по ping/pong с наименьшей задержкой).
   Этап 7: свои данные (пометки, заметки, «Моя версия», настройки mps.*) — в файл JSON и обратно (меню «…»),
   установка (Android — кнопка по beforeinstallprompt, iPhone — подсказка «Поделиться → На экран „Домой“»),
   первый запуск: после первой загрузки песен — окно «Готово!» (роль, что где, установка). */
'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ROLES = [['musician', 'Музыкант'], ['vocal', 'Вокалист'], ['leader', 'Лидер'], ['sound', 'Звук'], ['tech', 'Техник']];
const PING_MS = 15000;
const fmt = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } } };
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const BAD = ['auth', 'off', 'closed'];

let screen = '';
let conn = 'start';   // ok | net | auth | off | closed | start
let prog = null;      // { got, total } — идёт загрузка
let updated = false;  // пришли новые файлы приложения (sw.js) — предложить перезапуск

function show(name) {
  screen = name;
  for (const s of document.querySelectorAll('.scr')) s.hidden = s.id !== 'scr' + name;
  document.body.classList.toggle('on-song', name === 'Song');
  paintBar();
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
let joinMode = 'qr'; // qr — запрос оператору; qrpass — с паролем сразу, без — запрос; pass — только имя и пароль
function paintJoinMode() {
  const pass = joinMode === 'pass';
  const pw = !!$('joinPw').value;
  $('joinPwBox').hidden = joinMode === 'qr';
  $('joinRoles').hidden = $('joinRoleLbl').hidden = pass;
  $('joinGo').textContent = pass || (joinMode === 'qrpass' && pw) ? 'Войти' : 'Попросить доступ';
  $('joinHint').textContent = pass ? 'Имя и пароль даёт оператор (окно «Группа» → «Люди и устройства» → «Пароль»).'
    : joinMode === 'qrpass' ? 'Есть пароль — впишите и войдёте сразу. Нет — оператор увидит запрос и нажмёт «Пустить».'
      : 'Оператор увидит запрос в программе (окно «Группа») и нажмёт «Пустить». Дальше телефон входит сам.';
}
function showJoin(msg) {
  show('Join');
  Store.api('/join/info', { timeout: 6000 }).then((r) => { joinMode = r && ['qr', 'qrpass', 'pass'].includes(r.mode) ? r.mode : 'qr'; paintJoinMode(); }).catch(() => {});
  paintJoinMode();
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
    const pw = joinMode !== 'qr' ? $('joinPw').value : '';
    const r = await Store.api('/join', { method: 'POST', body: { name, role: joinRole, dev: devName(), ...(pw ? { pw } : {}) } });
    if (r.token) { // по паролю — сразу
      $('joinPw').value = '';
      await Store.saveAuth(r.token, r.me);
      await Store.delMeta('join');
      toast('Вы вошли — загружаю песни');
      startLib();
      return;
    }
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

/* ----- Связь: состояние ----- */

function paintConn() {
  const c = $('conn');
  const busy = !!prog;
  const bad = BAD.includes(conn);
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
  paintBar();
}

let syncAgain = false;
async function runSync(full) {
  if (Store.busy) { syncAgain = true; return; } // во время загрузки пришло «песни поменялись» — ещё раз после
  const first = !Store.meta.at;
  prog = { got: 0, total: 0 };
  paintConn();
  try {
    const r = await (full ? Store.resync : Store.sync)((got, total) => { prog = { got, total }; paintConn(); });
    if (r.got || r.reset) {
      fillLibs();
      renderList();
      renderSets();
      // Оператор поправил открытую песню — показать новый текст, не теряя места
      if (screen === 'Song' && cur && cur.song && Store.songs.has(cur.id) && Store.songs.get(cur.id) !== cur.src) {
        const y = window.scrollY;
        openSong(cur.id, false, { pl: cur.pl, eid: cur.eid, key: cur.key });
        window.scrollTo(0, y);
        markLive(false);
      }
      // На экране песня, которой не было на телефоне, — пришла
      if (follow && live.kind === 'song' && screen === 'Song' && cur && cur.note) followLive();
    }
    if (first || full) {
      toast(`Песни загружены: ${Store.songs.size}`);
      if (first) welcome();
      // Попросить браузер не удалять песни, когда мало места (на установленном приложении обычно — да)
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }
  } catch (e) {
    if (BAD.includes(e.code)) { conn = e.code; if (conn === 'auth') await Store.dropAuth(); }
    else if (e.code === 'net') conn = 'net';
    else toast('Песни не обновились: ' + e.message);
  } finally {
    prog = null;
    paintConn();
    if (syncAgain) { syncAgain = false; runSync(); }
  }
}
// Номер изменений у программы другой — докачать
function syncIf(x) {
  const m = Store.meta;
  if (x && (x.lib !== m.lib || x.seq !== m.since || x.lh !== m.lh)) runSync();
}

/* ----- Связь: WebSocket ----- */

let ws = null;
let wsTry = 0;   // неудачных попыток подряд: следующая через 1 → 2 → 4 … 30 с
let wsT = 0;
let wsPing = 0;
let wsLast = 0;  // когда пришло последнее сообщение

function connect() {
  clearTimeout(wsT);
  if (!Store.token || ws || conn === 'auth') return;
  let s;
  try { s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); } catch { lost(); return; }
  ws = s;
  let bye = '';
  s.onopen = () => { wsLast = Date.now(); s.send(JSON.stringify({ t: 'hello', v: 1, token: Store.token })); };
  s.onmessage = (e) => {
    wsLast = Date.now();
    let m = null;
    try { m = JSON.parse(e.data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'bye') bye = m.code;
    onMsg(m);
  };
  s.onerror = () => { /* close придёт следом */ };
  s.onclose = () => {
    if (ws !== s) return;
    ws = null;
    clearInterval(wsPing);
    if (bye === 'auth') return; // ключ отозван — не стучаться
    lost(bye);
  };
}
// Связь оборвалась (или не открылась): спросить по http, что случилось, и попробовать снова позже
async function lost(code) {
  clearTimeout(wsT);
  const wait = Math.min(30, 2 ** wsTry) * 1000;
  wsTry++;
  if (!code) {
    try {
      const me = await Store.api('/me', { timeout: 8000 });
      conn = 'ok'; // http проходит, WebSocket — нет (прокси?): песни всё равно докачаем
      Store.saveMe(me).catch(() => {});
      syncIf(me);
    } catch (e) {
      conn = BAD.includes(e.code) ? e.code : 'net';
      if (conn === 'auth') { await Store.dropAuth(); paintConn(); return; }
    }
    paintConn();
  }
  wsT = setTimeout(connect, wait);
}
function wsSend(m) {
  if (!ws || ws.readyState !== 1) { toast('Нет связи с программой'); return false; }
  ws.send(JSON.stringify(m));
  return true;
}
// Раз в 15 с «ты тут?»; ответа нет 8 с — связь мёртвая (ушли из Wi-Fi), открыть заново
function pingNow() {
  if (!ws || ws.readyState !== 1) return;
  const s = ws;
  const t0 = Date.now();
  s.send(JSON.stringify({ t: 'ping', id: t0 }));
  setTimeout(() => { if (ws === s && wsLast < t0) s.close(); }, 8000);
}
// Вернулись в приложение, появилась сеть — сразу, без ожидания
function wake() {
  if (!Store.token) return;
  if (ws && ws.readyState === 1) pingNow();
  else if (!ws) { wsTry = 0; connect(); }
}

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      wsTry = 0;
      conn = 'ok';
      clearInterval(wsPing);
      wsPing = setInterval(pingNow, PING_MS);
      Store.saveMe(m.me).catch(() => {});
      setSets(m.sets);
      applyLive(m.live);
      syncIf(m.me);
      if (m.time && tRtt === Infinity) tOff = m.time - Date.now();
      syncBurst();
      for (const x of m.msgs || []) gotMsg(x, false);
      if (m.metro && m.metro.on) gotMetro(m.metro); else if (mt && mt.shared) mtStop();
      paintConn();
      break;
    case 'pong': if (m.id && m.time) clockSample(Number(m.id), m.time); break;
    case 'msg': gotMsg(m.msg, true); break;
    case 'metro': if (m.metro && m.metro.on) syncBurst(); gotMetro(m.metro); break;
    case 'live': applyLive(m.live); break;
    case 'lib': syncIf({ lib: m.lib, seq: m.seq, lh: m.lh }); break;
    case 'sets': setSets(m.sets); break;
    case 'me': Store.saveMe(m.me).catch(() => {}); toast(m.me.perms.control ? 'Оператор разрешил листать слайды' : 'Права изменились'); paintBar(); if (screen === 'Song') paintPick(); break;
    case 'err': toast(m.text || 'Ошибка'); break;
    case 'bye':
      conn = BAD.includes(m.code) ? m.code : 'net';
      if (conn === 'auth') Store.dropAuth().catch(() => {});
      paintConn();
      break;
    default: break; // pong и новое из будущих версий
  }
}

/* ----- Сообщения группе ----- */

const QUICK = ['Повтор припева', 'Ещё раз', 'Тише', 'Громче', 'Медленнее', 'Быстрее', 'Последний раз', 'Заканчиваем'];
let msgs = [];
let mcT = 0;
const canMsg = () => !!(Store.me && Store.me.perms && Store.me.perms.msg);
const hm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function gotMsg(m, fresh) {
  if (!m || !m.id || msgs.some((x) => x.id === m.id)) return;
  msgs.push(m);
  if (msgs.length > 50) msgs.shift();
  if ($('msgDlg').open) paintMsgs();
  if (!fresh) return;
  $('mcFrom').textContent = (m.role === 'op' ? 'Оператор' : m.from) + ' · ' + hm(m.at);
  $('mcText').textContent = m.text;
  $('msgCard').hidden = false;
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch { /* нет вибрации */ }
  clearTimeout(mcT);
  mcT = setTimeout(() => { $('msgCard').hidden = true; }, 12000);
}
function paintMsgs() {
  $('msgList').replaceChildren(...msgs.slice().reverse().map((m) => {
    const d = el('div', 'msg-it');
    d.append(el('small', '', (m.role === 'op' ? 'Оператор' : m.from) + ' · ' + hm(m.at)), document.createTextNode(m.text));
    return d;
  }));
  $('msgSend').hidden = !canMsg();
  $('msgHint').textContent = canMsg() ? 'Увидят все телефоны группы и оператор.' : 'Писать группе могут Лидер и Звук. Сообщения от них и от оператора появятся здесь и сверху экрана.';
}
function openMsgs() {
  $('msgCard').hidden = true;
  paintMsgs();
  $('msgDlg').showModal();
}
function sendMsg(text) {
  const t = String(text || '').trim();
  if (!t) return;
  if (wsSend({ t: 'msg', text: t })) { $('msgText').value = ''; toast('Отправлено группе'); }
}

/* ----- Метроном: свой или общий (удары от t0 по часам программы) ----- */

let tOff = 0;        // время программы = Date.now() + tOff
let tRtt = Infinity; // задержка лучшего замера
const srvNow = () => Date.now() + tOff;
function clockSample(sent, srv) {
  const now = Date.now();
  const rtt = now - sent;
  tRtt = Math.min(tRtt + 4, 5000); // старый лучший замер понемногу «стареет»
  if (rtt <= tRtt) { tRtt = rtt; tOff = srv - (sent + rtt / 2); }
}
let mt = null;       // { on, bpm, beats, t0, shared, by }
let mtNext = 0;
let mtLast = -1;
let mtRaf = 0;
let mtTimer = 0;
let actx = null;
let mtBpm = Number(ls.get('mps.mtBpm', '72')) || 72;
let mtSig = Number(ls.get('mps.mtSig', '4')) || 4;
const mtSound = () => ls.get('mps.mtSnd', '0') === '1';
const per = () => 60000 / mt.bpm;
function audio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { actx = null; }
  return actx;
}
function click(when, one) {
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.frequency.value = one ? 1650 : 1100;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(one ? 0.9 : 0.55, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(actx.destination);
  o.start(when);
  o.stop(when + 0.06);
}
function mtStart(x) {
  mt = x;
  mtNext = Math.max(0, Math.ceil((srvNow() - mt.t0) / per()));
  mtLast = -1;
  cancelAnimationFrame(mtRaf);
  clearInterval(mtTimer);
  // Звук: расписание на 150 мс вперёд (WebAudio точнее таймеров)
  mtTimer = setInterval(() => {
    if (!mt) return;
    const now = srvNow();
    while (mt.t0 + mtNext * per() < now + 150) {
      const at = mt.t0 + mtNext * per();
      if (mtSound() && actx && at >= now - 20) click(actx.currentTime + Math.max(0, at - now) / 1000, mtNext % mt.beats === 0);
      mtNext++;
    }
  }, 25);
  const frame = () => {
    if (!mt) return;
    const k = Math.floor((srvNow() - mt.t0) / per());
    if (k !== mtLast) { mtLast = k; paintBeat(k >= 0 ? k % mt.beats : -1); }
    mtRaf = requestAnimationFrame(frame);
  };
  frame();
  paintMetro();
}
function mtStop() {
  mt = null;
  cancelAnimationFrame(mtRaf);
  clearInterval(mtTimer);
  paintMetro();
}
function paintBeat(b) {
  for (const box of [$('mbDots'), $('mtBeats')]) [...box.children].forEach((d, i) => d.classList.toggle('on', i === b));
}
function paintMetro() {
  const on = !!mt;
  const beats = on ? mt.beats : mtSig;
  for (const box of [$('mbDots'), $('mtBeats')]) {
    if (box.children.length !== beats) box.replaceChildren(...Array.from({ length: beats }, (_, i) => el('i', i ? '' : 'one')));
  }
  $('metroBar').hidden = !on;
  $('metroBar').classList.toggle('shared', on && !!mt.shared);
  $('mbText').textContent = on ? '♩ ' + mt.bpm : '';
  $('mtBpm').textContent = String(on ? mt.bpm : mtBpm);
  $('mtSig').textContent = String(beats);
  $('mtSound').checked = mtSound();
  $('mtGo').textContent = on ? 'Стоп' : 'Старт';
  const can = !!(Store.me && Store.me.perms && Store.me.perms.metro);
  $('mtGroup').hidden = !can;
  $('mtGroup').textContent = on && mt.shared ? 'Остановить у всей группы' : 'Для всей группы';
  $('mtSt').textContent = on && mt.shared ? `Общий метроном группы — включил(а) ${mt.by || 'оператор'}. Доли у всех в такт (по часам программы).`
    : on ? 'Метроном только на этом телефоне.' : can ? '«Старт» — только у вас, «Для всей группы» — у всех телефонов разом.' : 'Метроном на этом телефоне. Общий для группы включают Лидер, Звук или оператор.';
}
function openMetro() {
  if (!mt && cur && cur.song && cur.src) { // темп и размер песни
    if (cur.src.tempo) mtBpm = cur.src.tempo;
    const n = parseInt(cur.src.time, 10);
    if (n >= 1 && n <= 12) mtSig = n;
  }
  paintMetro();
  $('metroDlg').showModal();
}
// Поменяли темп или размер во время игры — заново с ближайшей доли
function mtChange(bpm, sig) {
  mtBpm = Math.max(30, Math.min(300, bpm));
  mtSig = Math.max(1, Math.min(12, sig));
  ls.set('mps.mtBpm', String(mtBpm));
  ls.set('mps.mtSig', String(mtSig));
  if (mt && mt.shared) { wsSend({ t: 'metro', on: true, bpm: mtBpm, beats: mtSig }); return; }
  if (mt) mtStart({ on: true, bpm: mtBpm, beats: mtSig, t0: srvNow() + 150 });
  else paintMetro();
}
function gotMetro(m) {
  if (m && m.on) mtStart({ ...m, shared: true });
  else if (mt && mt.shared) { mtStop(); toast('Общий метроном остановлен'); }
}
function syncBurst() { [0, 350, 700, 1050].forEach((d) => setTimeout(pingNow, d)); } // точнее поправка часов

/* ----- Свои данные: в файл и из файла ----- */

const MY_STORES = ['marks', 'mine'];
const myKeys = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('mps.')) out.push(k); } } catch { /* нет доступа */ } return out; };
async function exportMine() {
  const data = { app: 'church-presenter', kind: 'team-mine', v: 1, at: Date.now(), who: Store.me ? Store.me.person.name : '', ls: {} };
  for (const st of MY_STORES) data[st] = await Store.allRec(st).catch(() => []);
  for (const k of myKeys()) data.ls[k] = ls.get(k, '');
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `мои-пометки-${new Date().toISOString().slice(0, 10)}.json`;
  // Телефон умеет «Поделиться» файлом — удобнее (почта, мессенджер, «Файлы»); иначе — скачать
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('Файл сохранён в «Загрузки»');
}
async function importMine(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch { toast('Это не файл с пометками'); return; }
  if (!d || d.kind !== 'team-mine' || !Array.isArray(d.marks)) { toast('Это не файл с пометками приложения группы'); return; }
  const n = (d.marks || []).length + (d.mine || []).length;
  if (!(await ask(`Загрузить из файла ${n} записей (пометки, заметки, мои версии) и настройки? Записи тех же песен на этом телефоне заменятся.`, 'Загрузить'))) return;
  for (const st of MY_STORES) for (const r of d[st] || []) if (r && r.id) await Store.putRec(st, r).catch(() => {});
  for (const [k, v] of Object.entries(d.ls || {})) if (k.startsWith('mps.') && typeof v === 'string') ls.set(k, v);
  toast('Загружено — перезапускаю');
  setTimeout(() => location.reload(), 900);
}
async function paintMine() {
  try {
    const [m, v] = await Promise.all(MY_STORES.map((st) => Store.allRec(st)));
    $('iMine').textContent = `пометки: ${m.filter((x) => x.strokes && x.strokes.length).length}, заметки: ${m.filter((x) => x.note).length}, версии: ${v.length}`;
  } catch { $('iMine').textContent = '—'; }
}

/* ----- Установка на экран «Домой» ----- */

let installEv = null; // Android/Chrome: событие, по которому показывается окно установки
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
function installHint() {
  if (standalone()) return '';
  if (!window.isSecureContext) return 'Установить на экран «Домой» можно, когда приложение открыто по защищённому адресу (с замком) — его настраивает оператор.';
  if (installEv) return '';
  if (isIos()) return 'Установить: в Safari нажмите «Поделиться» (квадрат со стрелкой) → «На экран „Домой“».';
  return 'Установить: меню браузера (⋮) → «Установить приложение» или «Добавить на главный экран».';
}
function paintInstall() {
  const can = !!installEv && !standalone();
  $('iInstall').hidden = $('welInst').hidden = !can;
  const h = installHint();
  $('iInstallHint').hidden = !h;
  $('iInstallHint').textContent = h;
  $('welInstall').textContent = h;
}
async function doInstall() {
  if (!installEv) return;
  const ev = installEv;
  installEv = null;
  ev.prompt();
  try { const r = await ev.userChoice; if (r && r.outcome === 'accepted') toast('Приложение установлено'); } catch { /* закрыли */ }
  paintInstall();
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEv = e; paintInstall(); });
window.addEventListener('appinstalled', () => { installEv = null; paintInstall(); });

// Первый запуск: песни загрузились первый раз — что где
function welcome() {
  if (ls.get('mps.welcomed', '') || !Store.me) return;
  ls.set('mps.welcomed', '1');
  $('welTop').textContent = `${Store.me.person.name} (${Store.me.person.roleName}) — на телефоне ${Store.songs.size} песен.`;
  paintInstall();
  $('welDlg').showModal();
}

/* ----- Что на экране: «Следовать» / «Листать самому» ----- */

let live = { kind: 'none' };
let liveSlides = null; // { item, slides } — текст Библии и своих слайдов (приходит, когда пункт сменился)
let follow = ls.get('mps.follow', '1') === '1';
let sets = [];

function applyLive(l) {
  live = l && typeof l === 'object' ? l : { kind: 'none' };
  if (Array.isArray(live.slides)) liveSlides = { item: live.item, slides: live.slides };
  else if (!live.same || !liveSlides || liveSlides.item !== live.item) liveSlides = null;
  if (follow && (screen === 'Lib' || screen === 'Song')) followLive();
  else markLive(false);
  paintBar();
  if (libTab === 'sets' && screen === 'Lib') markSets();
}
const canCtl = () => !!(Store.me && Store.me.perms && Store.me.perms.control) && conn === 'ok';

// То, что на экране, — видом для экрана песни
function liveView() {
  const l = live;
  if (l.kind === 'song' && Store.songs.has(l.item)) {
    const s = Store.songs.get(l.item);
    return { id: s.id, name: s.name, slides: s.slides, song: true, src: s, pl: l.pl, eid: l.eid, key: keyOf(l.eid) };
  }
  if ((l.kind === 'bible' || l.kind === 'text') && liveSlides && liveSlides.slides.length) {
    return { id: l.item, name: l.name, kind: l.kind, src: liveSlides, pl: l.pl, eid: l.eid,
      slides: liveSlides.slides.map((z) => ({ id: z.id, label: z.label, text: z.text, pi: 0 })) };
  }
  const note = l.kind === 'none' ? 'Экран пуст — ждём, что покажет оператор.'
    : l.kind === 'song' ? `На экране песня «${l.name}» — её ещё нет на телефоне, загружаю…`
      : `На экране: ${l.name || 'видео или картинка'}` + (l.n > 1 && l.idx >= 0 ? ` — слайд ${l.idx + 1} из ${l.n}` : '');
  return { id: l.item || '', name: l.kind === 'none' ? 'Экран пуст' : l.name || 'На экране', slides: [], note, src: note };
}
function followLive() {
  const v = liveView();
  if (Pen.isOpen && screen === 'Song') { markLive(false); return; } // открыт пенал — песню под рукой не менять
  if (screen === 'Song' && cur && cur.id === v.id && cur.src === v.src) { markLive(true); return; } // тот же пункт — только слайд
  // Экран очистили — песня остаётся перед глазами (доигрывают), снимается только отметка; в списке — остаёмся в списке
  if (live.kind === 'none' && (screen === 'Lib' || (cur && !cur.note))) { markLive(false); return; }
  openView(v, screen === 'Lib');
  markLive(true);
}
function setFollow(on, quiet) {
  follow = on;
  ls.set('mps.follow', on ? '1' : '0');
  if (on) followLive();
  if (!quiet) toast(on ? 'Следую за экраном' : 'Листаете сами — «Следовать» внизу вернёт');
  paintBar();
}
// Подпись текущего слайда для полосы внизу
function liveLabel() {
  const l = live;
  if (l.kind === 'none') return 'экран пуст';
  let z = null;
  if (l.kind === 'song') { const s = Store.songs.get(l.item); z = s && s.slides.find((x) => x.id === l.sid); if (z) return [l.name, z.label || z.part].filter(Boolean).join(' — '); }
  if (liveSlides) { z = liveSlides.slides.find((x) => x.id === l.sid); if (z && z.label) return /^\d+$/.test(z.label) ? `${l.name}:${z.label}` : `${l.name} — ${z.label}`; }
  return l.name + (l.n > 1 && l.idx >= 0 ? ` — ${l.idx + 1} из ${l.n}` : '');
}
function paintBar() {
  const bar = $('liveBar');
  const on = !!Store.token && conn === 'ok' && (screen === 'Lib' || screen === 'Song');
  bar.hidden = !on;
  document.body.classList.toggle('has-bar', on);
  if (!on) return;
  $('liveText').textContent = (follow ? 'Следую: ' : 'На экране: ') + liveLabel();
  $('liveText').disabled = follow && screen === 'Song';
  $('liveMode').textContent = follow ? 'Листать самому' : 'Следовать';
  $('liveMode').classList.toggle('primary', !follow);
  const ctl = canCtl();
  $('ctlRow').hidden = !ctl;
  document.body.classList.toggle('has-ctl', ctl);
}
function markLive(scroll) {
  const on = screen === 'Song' && cur && cur.id && cur.id === live.item;
  let hit = null;
  for (const sec of $('songBody').querySelectorAll('.sl')) {
    const y = !!on && sec.dataset.id === live.sid;
    sec.classList.toggle('cur', y);
    if (y) hit = sec;
  }
  if (hit && scroll) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ----- Сетлисты: плейлисты «для группы» ----- */

function setSets(list) {
  sets = Array.isArray(list) ? list : [];
  Store.setMeta('sets', sets).catch(() => {});
  renderSets();
}
const keyOf = (eid) => { for (const st of sets) for (const e of st.entries) if (e.eid === eid) return e.key || ''; return ''; };
const dayName = (d) => { try { return new Date(d + 'T12:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }); } catch { return d; } };
const KIND = { song: '', bible: 'Библия', media: 'Видео', deck: 'Презентация', audio: 'Музыка', custom: 'Слайды', mixed: 'Слайды' };
function renderSets() {
  const box = $('setList');
  $('setCount').textContent = sets.length ? String(sets.length) : '';
  if (!sets.length) {
    box.replaceChildren(el('p', 'empty', 'Сетлистов пока нет. Оператор отмечает плейлист галочкой «Для группы» (окно «Группа» → «Сетлисты»).'));
    return;
  }
  box.replaceChildren(...sets.map((st) => {
    const sec = el('section', 'set');
    const h = el('h2', '', st.name);
    if (st.date) h.prepend(el('span', 'date', dayName(st.date)));
    sec.append(h);
    if (!st.entries.length) sec.append(el('p', 'hint', 'Пока пусто'));
    st.entries.forEach((e, i) => {
      const b = el('button', 'item set-row');
      b.type = 'button';
      b.dataset.eid = e.eid;
      b.dataset.set = st.id;
      const has = e.kind === 'song' && Store.songs.has(e.item);
      b.append(el('span', 'n', String(i + 1)), el('span', 't', e.name));
      if (KIND[e.kind]) b.append(el('span', 'kind', KIND[e.kind]));
      if (e.key) b.append(el('span', 'key', e.key));
      if (e.kind === 'song' && !has) b.classList.add('dim');
      sec.append(b);
    });
    return sec;
  }));
  markSets();
}
function markSets() {
  for (const b of $('setList').querySelectorAll('.set-row')) b.classList.toggle('cur', !!live.eid && b.dataset.eid === live.eid);
}
function openSetRow(b) {
  const st = sets.find((x) => x.id === b.dataset.set);
  const e = st && st.entries.find((x) => x.eid === b.dataset.eid);
  if (!e) return;
  if (live.eid === e.eid || (live.item === e.item && live.kind !== 'song')) { if (follow) followLive(); else openView(liveView(), true); markLive(true); return; }
  if (e.kind === 'song' && openSong(e.item, true, { pl: st.id, eid: e.eid, key: e.key })) { if (follow) setFollow(false); return; }
  toast(e.kind === 'song' ? 'Этой песни ещё нет на телефоне — обновите песни (меню «…»)' : 'Это не песня — текст будет виден, когда оператор её покажет');
}

/* ----- Список песен ----- */

let rows = [];
let shown = 0;
const PAGE = 120;
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) more(); }, { rootMargin: '600px' }) : null;
const sentinel = el('div');
let libTab = ls.get('mps.tab', 'songs') === 'sets' ? 'sets' : 'songs';

function setTab(t) {
  libTab = t;
  ls.set('mps.tab', t);
  $('tabSongs').setAttribute('aria-selected', String(t === 'songs'));
  $('tabSets').setAttribute('aria-selected', String(t === 'sets'));
  $('songsPane').hidden = t !== 'songs';
  $('setList').hidden = t !== 'sets';
  window.scrollTo(0, 0);
  if (t === 'sets') renderSets();
}

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

/* ----- Аккорды: показать, транспонировать, капо ----- */

const chordsShown = () => { const v = ls.get('mps.chords', ''); return v ? v === '1' : !(Store.me && ['vocal', 'sound', 'tech'].includes(Store.me.person.role)); };
let trAll = {};
try { trAll = JSON.parse(ls.get('mps.tr', '{}')) || {}; } catch { trAll = {}; }
// { t: полутонов, capo } — своё у песни, иначе от тональности строки сетлиста
function trOf(v) {
  const own = trAll[v.id];
  if (own) return { t: Number(own.t) || 0, capo: Number(own.capo) || 0, own: true };
  const s = v.src || {};
  return { t: v.key && s.key ? Chords.interval(s.key, v.key) : 0, capo: 0, own: false };
}
function setTr(id, t, capo) {
  if (!t && !capo) delete trAll[id]; else trAll[id] = { t, capo };
  ls.set('mps.tr', JSON.stringify(trAll));
}
const keyNow = (v) => { const s = v.src || {}; const tr = v.tr || { t: 0 }; return s.key ? Chords.keyShift(s.key, tr.t) || s.key : v.key || ''; };
// Строка аккордов «[Am]Сла[G]ва» → места в строке слайда (по счёту букв: пробелы и знаки могут отличаться)
function chordMarks(line, raw, n, flat) {
  const sp = Chords.split(raw);
  if (!sp.marks.length) return [];
  const isL = (ch) => /[\p{L}\p{N}]/u.test(ch);
  const letters = (s, upto) => { let k = 0; for (let i = 0; i < upto && i < s.length; i++) if (isL(s[i])) k++; return k; };
  const atLetter = (s, k) => { let c = 0; for (let i = 0; i < s.length; i++) { if (isL(s[i])) { if (c === k) return i; c++; } } return s.length; };
  return sp.marks.map((m) => ({ at: atLetter(line, letters(sp.text, m.at)), c: Chords.shift(m.c, n, flat) }));
}
function paintKey() {
  const v = cur;
  const s = (v && v.src) || {};
  const can = !!(v && v.song && (s.chords || s.key || v.key));
  $('songKey').hidden = !can;
  if (!can) return;
  const tr = v.tr || { t: 0, capo: 0 };
  $('songKey').textContent = (keyNow(v) || (s.chords ? 'Аккорды' : '')) + (tr.capo ? ` · капо ${tr.capo}` : '');
  $('songKey').classList.toggle('moved', !!tr.t);
}
function paintKeyDlg() {
  const v = cur;
  if (!v || !v.song) return;
  const s = v.src || {};
  const tr = v.tr || { t: 0, capo: 0 };
  $('kChords').checked = chordsShown();
  $('kChords').disabled = !s.chords;
  const sign = (n) => (n > 0 ? '+' + n : String(n));
  $('kKey').textContent = s.key ? keyNow(v) + (tr.t ? ` (${sign(tr.t)})` : '') : tr.t ? sign(tr.t) : 'как написано';
  $('kCapo').textContent = tr.capo ? String(tr.capo) : 'нет';
  const shape = s.key ? Chords.keyShift(s.key, tr.t - tr.capo) : '';
  $('kHint').textContent = !s.chords ? 'У этой песни нет аккордов. Оператор может вписать их в окне песни («Аккорды для сценического экрана»).'
    : tr.capo ? `Капо на ${tr.capo}-м ладу: аккорды показаны аппликатурой${shape ? ' ' + shape : ''}, звучит ${keyNow(v) || 'как написано'}.`
      : s.key ? `Тональность в программе — ${s.key}.` + (v.key && Chords.interval(s.key, v.key) ? ` В сетлисте — ${v.key}.` : '') : '';
  $('kReset').disabled = !tr.t && !tr.capo;
}
function retune(t, capo) {
  if (!cur || !cur.song) return;
  setTr(cur.id, t, Math.max(0, Math.min(11, capo)));
  rerender();
  paintKeyDlg();
}
// Показать открытую песню заново, не теряя места
function rerender() {
  if (!cur) return;
  const y = window.scrollY;
  openView(cur, false);
  window.scrollTo(0, y);
  markLive(false);
}

/* ----- «Моя версия»: переключатель и плашка «Оригинал изменился» ----- */

function mineBar(v, mine) {
  const bar = el('div', 'mvbar');
  const seg = el('div', 'seg');
  const bo = el('button', '', 'Оригинал');
  const bm = el('button', '', 'Моя версия');
  bo.setAttribute('aria-pressed', String(!mine));
  bm.setAttribute('aria-pressed', String(mine));
  bo.onclick = () => { if (mine) { Mine.setOn(v.id, false); rerender(); } };
  bm.onclick = () => { if (mine) return; if (Mine.has(v.id)) { Mine.setOn(v.id, true); rerender(); } else openMine(v); };
  seg.append(bo, bm);
  bar.append(seg);
  if (mine) { const be = el('button', 'mv-ed', 'Изменить'); be.onclick = () => openMine(v); bar.append(be); }
  return bar;
}
function openMine(v) {
  if (Pen.isOpen) Pen.close();
  Mine.edit(v);
}
function mineChanged(v, list) {
  const box = el('div', 'mvchg');
  box.append(el('b', '', 'Оригинал изменился'), el('span', 'hint', ' — ' + list.map((c) => c.label || 'текст').join(', ')));
  const det = el('div', 'mvdiff');
  det.hidden = true;
  for (const c of list) {
    det.append(el('h4', '', c.label || 'Текст'));
    for (const [op, t] of Mine.diff(c.was, c.now)) det.append(el('div', 'df ' + { '-': 'del', '+': 'add', '=': 'same' }[op], (op === '=' ? '  ' : op + ' ') + (t || ' ')));
  }
  const btns = el('div', 'btns');
  const bShow = el('button', '', 'Что изменилось');
  bShow.onclick = () => { det.hidden = !det.hidden; bShow.textContent = det.hidden ? 'Что изменилось' : 'Скрыть'; };
  const bKeep = el('button', '', 'Оставить мою');
  bKeep.onclick = () => { Mine.keep(v.id, list, false); toast('Ваша версия оставлена'); rerender(); };
  const bNew = el('button', '', 'Взять из оригинала');
  bNew.onclick = async () => {
    if (!(await ask('Изменённые части станут как в новом оригинале — ваши правки в них пропадут.', 'Взять'))) return;
    Mine.keep(v.id, list, true);
    rerender();
  };
  btns.append(bShow, bKeep, bNew);
  box.append(det, btns);
  return box;
}

/* ----- Песня (и то, что на экране: Библия, свои слайды) ----- */

let listY = 0;
let cur = null;       // что открыто: { id, name, slides, song?, kind?, note?, src, pl?, eid?, key? }
let fs = Math.min(44, Math.max(14, Number(ls.get('mps.fs', 22)) || 22));
function setFs(v) {
  fs = Math.min(44, Math.max(14, v));
  document.documentElement.style.setProperty('--fs', fs + 'px');
  ls.set('mps.fs', String(fs));
}
function openSong(id, push, ctx) {
  const s = Store.songs.get(id);
  if (!s) return false;
  openView({ id, name: s.name, slides: s.slides, song: true, src: s, ...(ctx || {}) }, push);
  return true;
}
function openView(v, push) {
  if (screen === 'Lib') listY = window.scrollY;
  cur = v;
  $('songTitle').textContent = v.name;
  const body = $('songBody');
  body.replaceChildren();
  if (v.note) body.append(el('p', 'note', v.note));
  // Песня: тональность, темп, размер; аккорды — с транспонированием и капо
  const src = v.song ? v.src || {} : {};
  const sheet = v.song && src.chords && chordsShown() ? Chords.sheet(src.chords) : null;
  v.tr = v.song ? trOf(v) : { t: 0, capo: 0 };
  const n = v.tr.t - v.tr.capo;
  const flat = Chords.flatFor(src.key, n, src.chords);
  const info = [keyNow(v) && `Тональность ${keyNow(v)}` + (v.tr.t && src.key ? ` (в программе ${src.key})` : ''),
    v.tr.capo && `капо ${v.tr.capo}`, src.tempo && `♩ = ${src.tempo}`, src.time].filter(Boolean);
  if (v.song && info.length) body.append(el('p', 'meta', info.join(' · ')));
  paintKey();
  // «Моя версия»: свой текст с оформлением, свои пометки
  let slides = v.slides;
  let rich = false;
  v.markKey = '';
  if (v.song && v.id) {
    const mv = Mine.has(v.id) ? Mine.view(v) : null;
    const mine = !!mv && Mine.on(v.id);
    body.append(mineBar(v, mine));
    if (mv && mv.changed.length) body.append(mineChanged(v, mv.changed));
    if (mine) { slides = mv.slides; rich = true; v.markKey = 'my:' + v.id; }
  }
  // Порядок частей (аранжировка), если части подписаны
  const order = v.song ? v.slides.filter((z) => z.pi === 0 && (z.label || z.part)).map((z) => z.label || z.part) : [];
  if (order.length > 1) body.append(el('p', 'order', order.join(' → ')));
  const verses = v.kind === 'bible';
  for (const z of slides) {
    if (rich && !String(z.text).trim()) continue; // часть убрана в моей версии
    const head = v.song ? z.pi === 0 && (z.label || z.part) : !!z.label && !(verses && /^\d+$/.test(z.label));
    const sec = el('section', 'sl' + (head ? ' part' : ''));
    sec.dataset.id = z.id;
    if (head) sec.append(el('h3', '', v.song ? z.label || z.part : z.label));
    const tx = textBlock(z.text || (z.label && !head ? '' : '—'), sheet ? Chords.forText(sheet, rich ? Mine.plain(z.text) : z.text) : null, n, flat, rich);
    if (verses && /^\d+$/.test(z.label || '') && tx.firstChild) tx.firstChild.prepend(el('b', 'vn', z.label + ' '));
    sec.append(tx);
    body.append(sec);
  }
  if (!v.slides.length && !v.note) body.append(el('p', 'hint', 'Нет текста'));
  show('Song');
  window.scrollTo(0, 0);
  if (push) history.pushState({ song: v.id || 'live' }, '');
  else if (!history.state || !history.state.song) history.pushState({ song: v.id || 'live' }, '');
  Pen.show(v);
}
// Текст слайда: строка — .ln, слово — .w (по словам держатся пометки); аккорды — значки .cd внутри слов;
// rich — разметка «Моей версии» (Mine.parse): выделить / замазать / подчеркнуть — обёртки внутри слов, подписи — между словами
const cdEl = (c) => { const i = el('i', 'cd'); i.dataset.c = c; return i; };
function textBlock(text, chordLines, n, flat, rich) {
  const tx = el('div', 'tx');
  let k = 0; // аккорды приложены к непустым строкам слайда
  for (const raw of String(text).split('\n')) {
    const p = rich ? Mine.parse(raw) : { text: raw, fx: [], caps: [] };
    const line = p.text;
    const ln = el('div', 'ln');
    const marks = chordLines && chordLines.length && line.trim() ? chordMarks(line, chordLines[k++] || '', n, flat) : [];
    let i = 0;
    let m = 0;
    let c = 0;
    // кусок строки [a, b) — в обёртках оформления
    const piece = (box, a, b) => {
      if (b <= a) return;
      const cls = p.fx.filter((f) => f.a < b && f.b > a).map((f) => 'f-' + f.k);
      box.append(cls.length ? el('span', cls.join(' '), line.slice(a, b)) : line.slice(a, b));
    };
    const cuts = (a, b, extra) => [...new Set([a, b, ...p.fx.flatMap((f) => [f.a, f.b]), ...extra])].filter((x) => x >= a && x <= b).sort((x, y) => x - y);
    for (const part of line.split(/(\s+)/)) {
      if (!part) continue;
      const end = i + part.length;
      while (c < p.caps.length && p.caps[c].at <= i) ln.append(el('span', 'cap', p.caps[c++].t));
      if (/^\s+$/.test(part)) {
        while (m < marks.length && marks[m].at < end) ln.append(cdEl(marks[m++].c));
        const pts = cuts(i, end, []);
        for (let j = 0; j + 1 < pts.length; j++) piece(ln, pts[j], pts[j + 1]);
      } else {
        const w = el('span', 'w');
        const pts = cuts(i, end, marks.slice(m).filter((x) => x.at < end).map((x) => x.at));
        for (let j = 0; j + 1 < pts.length; j++) {
          while (m < marks.length && marks[m].at <= pts[j]) w.append(cdEl(marks[m++].c));
          piece(w, pts[j], pts[j + 1]);
        }
        ln.append(w);
        while (c < p.caps.length && p.caps[c].at < end) ln.append(el('span', 'cap', p.caps[c++].t));
      }
      i = end;
    }
    while (m < marks.length) ln.append(cdEl(marks[m++].c));
    while (c < p.caps.length) ln.append(el('span', 'cap', p.caps[c++].t));
    if (marks.length) ln.classList.add('ch');
    tx.append(ln);
  }
  return tx;
}
function closeSong() {
  Pen.close();
  if (follow) setFollow(false);
  show('Lib');
  window.scrollTo(0, listY);
}

// Слайд под пальцем (право «Может листать»): кнопка «Показать на экране»
let picked = '';
function paintPick() {
  for (const sec of $('songBody').querySelectorAll('.sl')) {
    const y = canCtl() && sec.dataset.id === picked;
    sec.classList.toggle('pick', y);
    const b = sec.querySelector('.show-btn');
    if (y && !b) {
      const btn = el('button', 'show-btn primary', 'Показать на экране');
      btn.type = 'button';
      sec.append(btn);
    } else if (!y && b) b.remove();
  }
}
function onSlideTap(e) {
  const cov = e.target.closest('.f-cov');
  if (cov) { cov.classList.toggle('peek'); return; } // замазанное — подсмотреть
  if (e.target.closest('.show-btn')) {
    const sec = e.target.closest('.sl');
    if (cur && sec && wsSend({ t: 'cmd', cmd: 'show', item: cur.id, sid: sec.dataset.id, pl: cur.pl || '', eid: cur.eid || '' })) { picked = ''; paintPick(); }
    return;
  }
  if (!canCtl() || !cur || !cur.id) return;
  const sec = e.target.closest('.sl');
  if (!sec || window.getSelection().toString()) return;
  picked = picked === sec.dataset.id ? '' : sec.dataset.id;
  paintPick();
}

/* ----- Сведения ----- */

function paintSheet() {
  const me = Store.me;
  $('iWho').textContent = me ? `${me.person.name} · ${me.person.roleName}` + (me.perms && me.perms.control ? ' · может листать' : '') : '—';
  $('iDev').textContent = me ? me.device.name : devName();
  $('iConn').textContent = conn === 'ok' ? (ws && ws.readyState === 1 ? 'на связи с программой' : 'на связи (без живого показа)') : conn === 'net' ? 'нет связи (работаю с песнями на телефоне)'
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
  $('iPaper').checked = ls.get('mps.paper', '0') === '1';
}

/* ----- Запуск ----- */

async function startLib() {
  show('Lib');
  history.replaceState({}, '');
  fillLibs();
  renderList();
  setTab(libTab);
  Store.onIndex = () => { if ($('q').value.trim()) renderList(); };
  Store.indexAll();
  paintConn();
  wsTry = 0;
  connect();
}

function wire() {
  $('joinGo').onclick = doJoin;
  $('joinName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  $('waitCancel').onclick = async () => { await Store.delMeta('join'); showJoin(); };
  let qT = 0;
  $('q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { window.scrollTo(0, 0); renderList(); }, 120); });
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('libSel').onchange = () => { ls.set('mps.lib', $('libSel').value); window.scrollTo(0, 0); renderList(); };
  $('tabSongs').onclick = () => setTab('songs');
  $('tabSets').onclick = () => setTab('sets');
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('.item');
    if (!b) return;
    if (follow && b.dataset.id !== live.item) setFollow(false); // открыли своё — значит, листаете сами
    openSong(b.dataset.id, true);
    markLive(follow);
  });
  $('setList').addEventListener('click', (e) => { const b = e.target.closest('.set-row'); if (b) openSetRow(b); });
  $('songBody').addEventListener('click', onSlideTap);
  $('back').onclick = () => { if (history.state && history.state.song) history.back(); else closeSong(); };
  window.addEventListener('popstate', () => { if (screen === 'Song') closeSong(); });
  // Аккорды и тональность: значок тональности в шапке песни
  $('songKey').onclick = () => { paintKeyDlg(); $('keyDlg').showModal(); };
  $('keyX').onclick = () => $('keyDlg').close();
  $('keyDlg').addEventListener('click', (e) => { if (e.target === $('keyDlg')) $('keyDlg').close(); });
  $('kChords').onchange = () => { ls.set('mps.chords', $('kChords').checked ? '1' : '0'); rerender(); paintKeyDlg(); };
  $('kUp').onclick = () => cur && cur.tr && retune(cur.tr.t >= 11 ? -12 + cur.tr.t + 1 : cur.tr.t + 1, cur.tr.capo);
  $('kDown').onclick = () => cur && cur.tr && retune(cur.tr.t <= -11 ? 12 + cur.tr.t - 1 : cur.tr.t - 1, cur.tr.capo);
  $('cUp').onclick = () => cur && cur.tr && retune(cur.tr.t, cur.tr.capo + 1);
  $('cDown').onclick = () => cur && cur.tr && retune(cur.tr.t, cur.tr.capo - 1);
  $('kReset').onclick = () => { if (cur) { delete trAll[cur.id]; ls.set('mps.tr', JSON.stringify(trAll)); rerender(); paintKeyDlg(); } };
  // Вход по паролю
  $('joinPw').addEventListener('input', paintJoinMode);
  $('joinPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  // Сообщения группе
  $('msgCard').onclick = openMsgs;
  $('iMsgs').onclick = () => { $('sheet').close(); openMsgs(); };
  $('msgX').onclick = () => $('msgDlg').close();
  $('msgDlg').addEventListener('click', (e) => { if (e.target === $('msgDlg')) $('msgDlg').close(); });
  $('msgQuick').replaceChildren(...QUICK.map((t) => { const b = el('button', '', t); b.onclick = () => sendMsg(t); return b; }));
  $('msgGo').onclick = () => sendMsg($('msgText').value);
  $('msgText').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg($('msgText').value); });
  // Метроном
  $('metroBtn').onclick = openMetro;
  $('metroBar').onclick = openMetro;
  $('iMetro').onclick = () => { $('sheet').close(); openMetro(); };
  $('mtX').onclick = () => $('metroDlg').close();
  $('metroDlg').addEventListener('click', (e) => { if (e.target === $('metroDlg')) $('metroDlg').close(); });
  $('mtDown').onclick = () => mtChange((mt ? mt.bpm : mtBpm) - 1, mt ? mt.beats : mtSig);
  $('mtUp').onclick = () => mtChange((mt ? mt.bpm : mtBpm) + 1, mt ? mt.beats : mtSig);
  $('mtBDown').onclick = () => mtChange(mt ? mt.bpm : mtBpm, (mt ? mt.beats : mtSig) - 1);
  $('mtBUp').onclick = () => mtChange(mt ? mt.bpm : mtBpm, (mt ? mt.beats : mtSig) + 1);
  $('mtSound').onchange = () => { ls.set('mps.mtSnd', $('mtSound').checked ? '1' : '0'); if ($('mtSound').checked) audio(); };
  $('mtGo').onclick = () => {
    if (mt) { mtStop(); return; }
    if (mtSound()) audio(); // звук можно включить только по нажатию
    mtStart({ on: true, bpm: mtBpm, beats: mtSig, t0: srvNow() + 150 });
  };
  $('mtGroup').onclick = () => {
    if (mtSound()) audio();
    if (mt && mt.shared) wsSend({ t: 'metro', on: false });
    else wsSend({ t: 'metro', on: true, bpm: mt ? mt.bpm : mtBpm, beats: mt ? mt.beats : mtSig });
  };
  // Свои данные и установка
  $('iExport').onclick = () => exportMine().catch(() => toast('Не получилось сохранить файл'));
  $('iImport').onclick = () => $('iImportFile').click();
  $('iImportFile').onchange = () => { const f = $('iImportFile').files[0]; $('iImportFile').value = ''; if (f) { $('sheet').close(); importMine(f); } };
  $('iInstall').onclick = doInstall;
  $('welInst').onclick = doInstall;
  $('welGo').onclick = () => $('welDlg').close();
  $('fsMinus').onclick = () => setFs(fs - 2);
  $('fsPlus').onclick = () => setFs(fs + 2);
  // Полоса «На экране»: текст — посмотреть, что там; кнопка — следовать / листать самому
  $('liveText').onclick = () => { openView(liveView(), screen === 'Lib'); markLive(true); };
  $('liveMode').onclick = () => setFollow(!follow);
  $('ctlPrev').onclick = () => wsSend({ t: 'cmd', cmd: 'prev' });
  $('ctlNext').onclick = () => wsSend({ t: 'cmd', cmd: 'next' });
  $('ctlClear').onclick = () => wsSend({ t: 'cmd', cmd: 'clear' });
  $('conn').onclick = () => $('menuBtn').click();
  $('menuBtn').onclick = () => { paintSheet(); paintInstall(); paintMine(); $('sheet').showModal(); };
  $('sheetX').onclick = () => $('sheet').close();
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').close(); });
  $('iSync').onclick = () => { $('sheet').close(); runSync(); };
  $('iResync').onclick = async () => { if (await ask('Загрузить все песни заново? Займёт минуту.', 'Загрузить')) { $('sheet').close(); runSync(true); } };
  $('iForget').onclick = async () => {
    if (!(await ask('Отключить этот телефон?\nКлюч доступа и песни будут стёрты с телефона (пометки и заметки останутся). Подключиться снова можно по QR-коду.', 'Отключить'))) return;
    $('sheet').close();
    if (ws) { const s = ws; ws = null; s.close(); }
    clearTimeout(wsT);
    await Store.forget();
    sets = [];
    showJoin();
  };
  $('bannerBtn').onclick = () => { if (conn === 'auth') showJoin(); else if (updated) location.reload(); };
  $('iPaper').onchange = () => {
    ls.set('mps.paper', $('iPaper').checked ? '1' : '0');
    document.body.classList.toggle('paper', $('iPaper').checked || Pen.isOpen);
  };
  Pen.init();
  Mine.wire(rerender);
  Pen.onChange = () => { paintBar(); markLive(false); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  window.addEventListener('online', wake);
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
    await Mine.init();
    sets = (await Store.getMeta('sets')) || [];
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
