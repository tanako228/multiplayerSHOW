/* ===== Сценический экран (Stage Display): данные инфоблоков и управление оператора =====
   Экраны и макеты — screens.js (экран и сцена с kind 'stage'), отрисовка блоков — compose.js (stageValue).
   Здесь:
   - stSend — собирает данные блоков и шлёт окнам вывода (screens:stage) и превью (Compose.progInfo):
     текущий/следующий слайд и их текст, заметки, плейлист, номер слайда, аккорды, таймеры, сообщение, видео, запись,
     часть песни (stPart) и очередь плейлиста (stQueue — прошедшие, текущий, следующие пункты);
   - таймеры lib.timers [{ id, name, mode: 'down'|'up', dur (с) }] — в отмене Ctrl+Z; ход (пуск, пауза) — в памяти stRun;
   - сообщение для сцены stMsg, «только для сцены» stOnly — слайд, который видят только сценические экраны;
   - запись и эфир stCap — отмечает оператор (программа сама не пишет и не транслирует);
   - заметка к слайду slide.notes, макет при показе slide.stage / item.stage (→ scAuto), аккорды item.song.chords;
   - панель «Сцена» под предпросмотром (#stBtn) и ноды макросов. */

let stRun = {};                    // id таймера → { run, base (мс до пуска), at (когда пустили) }
let stMsg = { text: '', at: 0 };   // сообщение для сцены
let stOnly = null;                 // { content, label } — только для сценических экранов
let stCap = { rec: 0, live: 0 };   // когда начали запись / эфир (0 — нет)
let stVideo = null;                // видео на экране: { t, d, playing, at }
let stLast = '';

function stInit() {
  if (!Array.isArray(lib.timers)) lib.timers = [];
  stSend();
  stBtnPaint();
  tmRender();
}
function stAfterUndo() {
  if (!Array.isArray(lib.timers)) lib.timers = [];
  for (const id of Object.keys(stRun)) if (!stTimer(id)) delete stRun[id];
  stSend();
  stPanelRefresh();
}

/* ----- Данные инфоблоков ----- */

// Текст слайда: песня, стих (со ссылкой), свой слайд
function stTextOf(c) {
  if (!c) return '';
  if (c.type === 'text') {
    if (Array.isArray(c.verses) && c.verses.length) return c.verses.map((v) => (v.n ? v.n + ' ' : '') + v.t).join(' ') + (c.ref ? '\n' + c.ref : '');
    return String(c.text || '').trim();
  }
  if (c.type === 'custom') return (c.elements || []).filter((e) => e.kind === 'text' && e.text).map((e) => e.text).join('\n');
  return '';
}

function stCollect() {
  const pres = layerDefs().filter((l) => l.kind === 'pres').map((l) => layerOn[l.id]).filter(Boolean).pop();
  const cur = pres ? { ...pres.content, sound: false } : null;
  const shown = typeof mcShown === 'function' ? mcShown() : null; // { item, slide, index, total } (macros.js)
  // Следующий слайд — в том списке, откуда показан слайд (обычно лента); музыкальные пропускаем
  const entries = viewEntries(plShown ? keyView(plShown.view) : work);
  let nextSlide = null;
  let nextItem = null;
  if (plShown) {
    const flat = [];
    for (const { key, item } of entries) item.slides.forEach((s) => flat.push({ key, item, s }));
    const i = flat.findIndex((x) => x.key === plShown.key && x.s.id === plShown.sid);
    for (let j = i + 1; i >= 0 && j < flat.length; j++) if (flat[j].s.k !== 'audio') { nextSlide = flat[j].s; nextItem = flat[j].item; break; }
  }
  let next = null;
  try { next = nextSlide ? { ...contentOf(nextItem, nextSlide), sound: false } : null; } catch { next = null; }
  const ki = plShown ? entries.findIndex((x) => x.key === plShown.key) : -1;
  const nx = entries[ki + 1];
  const t0 = { run: false, base: 0, at: 0 };
  const st = {
    cur: cur ? { text: stTextOf(cur), label: shown && shown.slide.k !== 'audio' ? shown.slide.label || '' : '' } : null,
    next: next ? { text: stTextOf(next), label: nextSlide.label || '' } : null,
    notes: (shown && shown.slide.notes) || '',
    opnote: (shown && shown.item.note) || '',
    plCur: shown ? shown.item.name : pres ? pres.label || '' : '',
    plNext: nx ? nx.item.name : '',
    i: shown ? shown.index + 1 : 0,
    n: shown ? shown.total : 0,
    chords: { cur: shown ? stChordsOf(shown.item, shown.slide) : [], next: nextSlide ? stChordsOf(nextItem, nextSlide) : [] },
    msg: stMsg.text ? { ...stMsg } : null,
    // «До времени» окна вывода считают как обратный отсчёт, начатый сейчас
    timers: Object.fromEntries((lib.timers || []).map((t) => [t.id, t.mode === 'to'
      ? { mode: 'down', dur: stUntil(t.at) / 1000, run: true, base: 0, at: Date.now() }
      : { mode: t.mode, dur: t.dur, ...(stRun[t.id] || t0) }])),
    video: stVideo,
    cap: { rec: stCap.rec, live: stCap.live, ndi: (typeof scOpenOuts !== 'undefined' ? scOpenOuts : []).filter((o) => o.kind === 'ndi').length },
    part: stPart(shown),
    queue: stQueue(),
  };
  return { cur, next, only: stOnly ? stOnly.content : null, st };
}

/* ----- Часть песни (блок «Часть песни») ----- */
// Слайд не часть песни: стих Библии (подпись — номер стиха), музыка
const stPartSkip = (s) => !s || s.k === 'bible' || s.k === 'audio';
// Части презентации по порядку: parts [{ label }], at — номер части у каждого слайда (-1 — не часть).
// У песни подпись есть у каждого слайда (новая часть — другая часть или другой её повтор); у старых слайдов
// подпись бывает только у первого слайда части — слайды без подписи продолжают часть выше
function stPartsOf(item) {
  const parts = [];
  const at = [];
  let cur = -1;
  let prev = null;
  for (const s of item.slides) {
    if (stPartSkip(s)) { at.push(-1); cur = -1; prev = null; continue; }
    const lb = String(s.label || '').trim();
    const key = s.part !== undefined ? s.part + '|' + s.occ : lb;
    if (lb && (cur < 0 || key !== prev || (s.part !== undefined && s.pi === 0))) { parts.push({ label: lb }); cur = parts.length - 1; prev = key; }
    at.push(cur);
  }
  return { parts, at };
}
// { cur, curC, next, nextC, i, n } — подпись части на экране и следующей (цвет — по типу части, songs.js partColor)
function stPart(shown) {
  if (!shown || stPartSkip(shown.slide)) return null;
  const { parts, at } = stPartsOf(shown.item);
  const k = at[shown.index];
  if (k == null || k < 0) return null;
  const col = (l) => (l && typeof partColor === 'function' ? partColor(l) : '') || '';
  const nx = parts[k + 1];
  return { cur: parts[k].label, curC: col(parts[k].label), next: nx ? nx.label : '', nextC: nx ? col(nx.label) : '', i: k + 1, n: parts.length };
}

/* ----- Очередь плейлиста (блок «Очередь») ----- */
// Какой плейлист и какой пункт шёл последним: { view: 'pl:id', key } — держится и после «Очистить»,
// листание другого плейлиста очередь не меняет (только показ слайда из него)
let stQ = null;
const ST_QKINDS = ['song', 'bible', 'custom', 'deck', 'media', 'audio'];
// Вид презентации для фильтра блока: песни, Библия, слайды, презентации (PowerPoint), медиа, музыка
function stKindOf(item) {
  if (item.song) return 'song';
  const k = Slides.presKind(item);
  if (ST_QKINDS.includes(k)) return k;
  return ST_QKINDS.includes(item.kind) ? item.kind : 'custom';
}
// { name, at (номер пункта, который идёт; -1 — ещё ничего), items: [{ n: имя, k: вид, l: [id библиотек] }] }
function stQueue() {
  if (plShown && String(plShown.view).startsWith('pl:')) stQ = { view: plShown.view, key: plShown.key };
  let vk = stQ && findView(keyView(stQ.view)) ? stQ.view : '';
  if (!vk && work && work.kind === 'pl') vk = workKey(); // ещё ничего не показывали — рабочий плейлист
  const v = keyView(vk);
  const pl = v && v.kind === 'pl' ? findView(v) : null;
  if (!pl) return null;
  const list = viewEntries(v);
  const ids = new Set(list.map((x) => x.item.id));
  const libs = new Map();
  for (const l of lib.libraries) for (const id of l.items) if (ids.has(id)) { if (!libs.has(id)) libs.set(id, []); libs.get(id).push(l.id); }
  return {
    name: pl.name,
    at: stQ && stQ.view === vk ? list.findIndex((x) => x.key === stQ.key) : -1,
    items: list.map((x) => ({ n: x.item.name || '', k: stKindOf(x.item), l: libs.get(x.item.id) || [] })),
  };
}

function stSend() {
  if (!lib || !lib.screens) return;
  const info = stCollect();
  const j = JSON.stringify(info);
  if (j === stLast) return;
  stLast = j;
  if (window.api.screensStage) window.api.screensStage(info);
  Compose.progInfo(info);
  stBtnPaint();
}

// Видео на экране: время и пуск/пауза. Окна вывода сами досчитывают секунды — шлём только перемены
setInterval(() => {
  const v = typeof pv !== 'undefined' && pv && pv.isConnected ? pv : null;
  const now = Date.now();
  const cur = v && Number.isFinite(v.duration) && v.duration > 0 ? { t: v.currentTime, d: v.duration, playing: !v.paused && !v.ended } : null;
  const was = stVideo;
  let changed = !!cur !== !!was;
  if (cur && was) {
    const pred = was.t + (was.playing ? (now - was.at) / 1000 : 0);
    changed = cur.playing !== was.playing || Math.abs(cur.d - was.d) > 0.5 || Math.abs(cur.t - pred) > 0.6;
  }
  if (changed) { stVideo = cur ? { ...cur, at: now } : null; stSend(); }
}, 500);

/* ----- Аккорды: item.song.chords — тот же текст песни с аккордами (разбор — chords.js, общий с телефонами) ----- */
const stSheets = new Map(); // id песни → { src, sheet }
function stChordsOf(item, slide) {
  const src = item && item.song && item.song.chords;
  if (!src || !slide || slide.k !== 'text') return [];
  let c = stSheets.get(item.id);
  if (!c || c.src !== src) { c = { src, sheet: Chords.sheet(src) }; stSheets.set(item.id, c); }
  return Chords.forText(c.sheet, slide.text || '');
}

/* ----- Таймеры ----- */

const stTimer = (id) => (lib && lib.timers ? lib.timers.find((t) => t.id === id) : null) || null;
// Есть хотя бы один таймер (для шаблонов и нового блока «Таймер»)
function stEnsureTimer() {
  if (!Array.isArray(lib.timers)) lib.timers = [];
  if (!lib.timers.length) { lib.timers.push({ id: newId(), name: 'Таймер', mode: 'down', dur: 300 }); saveLib(); }
  return lib.timers[0].id;
}
function stNewTimer(over) {
  if (!Array.isArray(lib.timers)) lib.timers = [];
  const t = { id: newId(), name: 'Таймер ' + (lib.timers.length + 1), mode: 'down', dur: 300, ...over };
  lib.timers.push(t);
  saveLib();
  stSend();
  stPanelRefresh();
  return t.id;
}
// Отсчёт до времени суток (mode 'to', t.at = «10:00»): сколько мс осталось; прошло больше 6 ч — значит, завтра
function stUntil(at) {
  const m = String(at || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  let ms = d.getTime() - Date.now();
  if (ms < -6 * 3600e3) ms += 24 * 3600e3;
  return ms;
}
function stTimerMs(t) {
  if (t.mode === 'to') return stUntil(t.at);
  const r = stRun[t.id] || {};
  const el = (r.base || 0) + (r.run ? Date.now() - r.at : 0);
  return t.mode === 'up' ? el : (t.dur || 0) * 1000 - el;
}
function stToggle(id, want) {
  if (!stTimer(id) || stTimer(id).mode === 'to') return; // «до времени» идёт всегда
  const r = stRun[id] || (stRun[id] = { run: false, base: 0, at: 0 });
  const on = want == null ? !r.run : !!want;
  if (on === r.run) return;
  if (on) { r.at = Date.now(); r.run = true; } else { r.base += Date.now() - r.at; r.run = false; }
  stSend();
  stPanelRefresh();
}
function stReset(id, start) {
  if (!stTimer(id)) return;
  stRun[id] = { run: !!start, base: 0, at: Date.now() };
  stSend();
  stPanelRefresh();
}
// «5» — минуты, «5:30», «1:05:00»
function stParseDur(s) {
  const p = String(s || '').trim().replace(',', '.').split(/[:.]/).map(Number);
  if (!p.length || p.some((x) => !Number.isFinite(x) || x < 0)) return null;
  if (p.length === 1) return Math.round(p[0] * 60);
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] * 3600 + p[1] * 60 + p[2];
}
const stPad = (v) => String(v).padStart(2, '0');
function stFmt(ms, up) {
  const neg = ms < 0;
  let s = Math.abs(ms) / 1000;
  s = up || neg ? Math.floor(s) : Math.ceil(s - 0.001);
  const h = Math.floor(s / 3600);
  const out = h ? `${h}:${stPad(Math.floor((s % 3600) / 60))}:${stPad(s % 60)}` : `${stPad(Math.floor(s / 60))}:${stPad(s % 60)}`;
  return (neg ? '−' : '') + out;
}
async function stEditTimer(id) {
  const t = stTimer(id);
  if (!t) return;
  if (t.mode === 'to') {
    const v = await askName('До какого времени: ЧЧ:ММ', t.at || '10:00');
    if (v == null) return;
    const m = v.trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) { flashStatus('Не понял время. Пример: 10:00'); return; }
    t.at = stPad(Number(m[1])) + ':' + m[2];
    saveLib();
    stSend();
    stPanelRefresh();
    return;
  }
  const v = await askName('Время таймера: минуты или мм:сс', stFmt(t.dur * 1000));
  if (v == null) return;
  const d = stParseDur(v);
  if (d == null || d <= 0) { flashStatus('Не понял время. Пример: 5 или 4:30'); return; }
  t.dur = d;
  saveLib();
  stSend();
  stPanelRefresh();
  if (typeof scRenderInsp === 'function' && scTabOn) scRenderInsp();
}
function stTimerMenu(e, t) {
  showMenu(e, [
    { label: 'Время…', fn: () => stEditTimer(t.id) },
    { label: (t.mode !== 'up' ? '● ' : '   ') + 'Обратный отсчёт', fn: () => { t.mode = 'down'; saveLib(); stReset(t.id); } },
    { label: (t.mode === 'up' ? '● ' : '   ') + 'Секундомер (вверх)', fn: () => { t.mode = 'up'; saveLib(); stReset(t.id); } },
    { label: (t.mode === 'to' ? '● ' : '   ') + 'До времени (например, до 10:00)', fn: () => { t.mode = 'to'; if (!t.at) t.at = stNextHalfHour(); saveLib(); stReset(t.id); } },
    { label: 'Переименовать…', fn: async () => { const n = await askName('Название таймера', t.name); if (n) { t.name = n; saveLib(); stPanelRefresh(); } } },
    '-',
    { label: 'Вывести в текстовое поле…', fn: () => tmOutPick(e, t) },
    ...(t.out && t.out.length ? [{ label: 'Убрать из всех полей (' + t.out.length + ')', fn: () => tmOutSet(t, []) }] : []),
    '-',
    { label: 'Удалить таймер', fn: () => {
      lib.timers = lib.timers.filter((x) => x !== t);
      delete stRun[t.id];
      saveLib();
      stSend();
      stPanelRefresh();
      flashStatus(`Таймер «${t.name}» удалён · Ctrl+Z — вернуть`);
    } },
  ]);
}

/* ----- Сообщение, «только для сцены», запись ----- */

function stSetMsg(text) {
  const t = String(text || '').trim();
  stMsg = { text: t, at: t ? Date.now() : 0 };
  stSend();
  stPanelRefresh();
  flashStatus(t ? 'Сообщение на сцене: ' + t : 'Сообщение со сцены убрано');
}
function stShowOnly(content, label) {
  stOnly = content ? { content: { ...content, sound: false }, label: label || '' } : null;
  stSend();
  stPanelRefresh();
  if (!scPresets().some((l) => (l.items || []).some((it) => it.type === 'only'))) flashStatus(content ? 'Отправлено на сцену. Чтобы видеть его, добавьте в макет блок «Только для сцены»' : 'Со сцены убрано');
  else flashStatus(content ? 'Только на сцене: ' + (label || 'слайд') : '«Только для сцены» убрано');
}
function stToggleCap(k) {
  stCap = { ...stCap, [k]: stCap[k] ? 0 : Date.now() };
  stSend();
  stPanelRefresh();
}

/* ----- Слайды: макет при показе, заметка к слайду, «только на сцену» ----- */

// Сцены, которые слушают слайды (галочка «Макет меняют слайды» в сцене)
const stFollowers = () => lib.scenes.filter((sc) => sc.follow);
// Показан слайд (playlist.js showSlide): у слайда или презентации свой макет — включить его в сценах «по слайду»
function stSlideShown(entry, slide) {
  const lay = (slide && slide.stage) || (entry && entry.item.stage) || '';
  const l = lay && scLay(lay);
  if (!l) return;
  if (!scLive[l.id]) scLive[l.id] = scClone(l);
  let changed = false;
  for (const sc of stFollowers()) {
    const want = l.id === sc.layout ? undefined : l.id;
    if (scAuto[sc.id] === want) continue;
    if (want) scAuto[sc.id] = want; else delete scAuto[sc.id];
    changed = true;
  }
  if (!changed) return;
  scSend();
  if (scTabOn) { scRenderLists(); scRenderBar(); }
  stPanelRefresh();
}

// Пункты в меню слайда ленты (playlist.js slideMenu)
function stSlideMenu(e, entry, slide) {
  const out = [];
  if (slide.k !== 'audio') out.push({ label: 'Только на сцену', fn: () => stShowOnly(contentOf(entry.item, slide), entry.item.name + (slide.label ? ' — ' + slide.label : '')) });
  out.push({ label: 'Заметка к слайду…' + (slide.notes ? ' ✓' : ''), fn: () => stNoteEdit(e, slide) });
  if (stFollowers().length) out.push({ label: 'Макет сцены…' + (scLay(slide.stage) ? ` (${scLay(slide.stage).name})` : ''), fn: () => stLayoutPick(e, slide, 'этого слайда') });
  return out;
}
// Пункт в меню презентации (playlist.js presMenu)
function stPresMenu(e, item) {
  if (!stFollowers().length) return [];
  return [{ label: 'Макет сцены…' + (scLay(item.stage) ? ` (${scLay(item.stage).name})` : ''), fn: () => stLayoutPick(e, item, 'всех слайдов презентации') }];
}
// Какой макет включить в сценах «по слайду», когда показан этот слайд / презентация
function stLayoutPick(e, obj, what) {
  showMenu(e, [
    { label: `Макет сцены при показе ${what}`, disabled: true, fn() {} },
    { label: (!obj.stage ? '● ' : '   ') + 'Не менять', fn: () => { delete obj.stage; saveLib(); flashStatus('Макет сцены не меняется'); } },
    ...scPresets().map((l) => ({ label: (obj.stage === l.id ? '● ' : '   ') + l.name, fn: () => { obj.stage = l.id; saveLib(); flashStatus(`При показе — макет «${l.name}»`); } })),
  ]);
}

// Заметка к слайду — видна на сценическом экране (блок «Заметки к слайду»), зрители её не видят
let stNotePop = null;
function stNoteEdit(e, slide) {
  stNoteClose();
  const el = Object.assign(document.createElement('div'), { className: 'note-pop' });
  const ta = Object.assign(document.createElement('textarea'), { value: slide.notes || '', placeholder: 'Заметка к слайду — для сценического экрана…' });
  el.append(Object.assign(document.createElement('div'), { className: 'nt', textContent: 'Заметка к слайду' + (slide.label ? ' · ' + slide.label : '') }), ta);
  ta.addEventListener('input', () => {
    if (ta.value.trim()) slide.notes = ta.value; else delete slide.notes;
    saveLib();
    stSend();
  });
  ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); stNoteClose(); } });
  document.body.append(el);
  const w = el.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(e.clientX, window.innerWidth - w.width - 6)) + 'px';
  el.style.top = Math.max(6, Math.min(e.clientY, window.innerHeight - w.height - 6)) + 'px';
  const away = (ev) => { if (!el.contains(ev.target)) stNoteClose(); };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  stNotePop = { el, away };
  ta.focus();
}
function stNoteClose() {
  if (!stNotePop) return;
  document.removeEventListener('pointerdown', stNotePop.away, true);
  stNotePop.el.remove();
  stNotePop = null;
}

/* ----- Панель «Сцена» под предпросмотром ----- */

let stPop = null;
let stDraft = ''; // недописанное сообщение
const stEl = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
function stB(text, fn, title, cls) {
  const b = stEl('button', cls || '', text);
  if (title) b.title = title;
  b.addEventListener('click', fn);
  return b;
}

function stBtnPaint() {
  const b = $('stBtn');
  if (!b) return;
  const live = !!stMsg.text || !!stOnly || Object.values(stRun).some((r) => r.run) || !!(stCap.rec || stCap.live);
  b.classList.toggle('st-live', live);
  b.title = live ? 'Сценический экран: ' + [stMsg.text && 'сообщение', stOnly && '«только для сцены»', Object.values(stRun).some((r) => r.run) && 'идёт таймер', (stCap.rec || stCap.live) && 'запись/эфир'].filter(Boolean).join(', ') : 'Сценический экран: макеты, сообщение, таймеры';
}

function stPanelToggle() { if (stPop) stPanelClose(); else stPanelOpen(); }
function stPanelOpen() {
  if (stPop) return;
  const el = stEl('div', 'st-pop');
  document.body.append(el);
  const away = (ev) => { if (!el.contains(ev.target) && ev.target !== $('stBtn') && !(ev.target.closest && ev.target.closest('.ctx-menu, dialog'))) stPanelClose(); };
  const key = (ev) => { if (ev.key === 'Escape' && stPop && !document.querySelector('dialog[open]')) { ev.stopPropagation(); stPanelClose(); } };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  document.addEventListener('keydown', key, true);
  const tick = setInterval(stPanelTick, 250);
  stPop = { el, away, key, tick };
  stPanelRender();
}
function stPanelClose() {
  if (!stPop) return;
  document.removeEventListener('pointerdown', stPop.away, true);
  document.removeEventListener('keydown', stPop.key, true);
  clearInterval(stPop.tick);
  stPop.el.remove();
  stPop = null;
}
function stPanelRefresh() { stBtnPaint(); if (stPop) stPanelRender(); tmRender(); }

function stPanelPlace() {
  const el = stPop.el;
  const b = $('stBtn');
  const r = b && b.offsetParent ? b.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight - 40 };
  const w = el.offsetWidth;
  el.style.left = Math.max(6, Math.min(r.left, window.innerWidth - w - 6)) + 'px';
  el.style.top = Math.max(6, r.top - el.offsetHeight - 6) + 'px';
}

function stPanelRender() {
  const el = stPop.el;
  const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.f : '';
  el.replaceChildren();
  const head = stEl('div', 'st-head');
  head.append(Icons.el('stage'), stEl('b', '', 'Сцена — для музыкантов и ведущих'), stEl('span', 'spacer'),
    stB('Сцены…', () => { stPanelClose(); const l = lib.scenes.find((x) => (x.outputs || []).length) || lib.scenes[0]; openScreensTab(l ? { kind: 'scene', id: l.id } : undefined); }, 'Редактор сцен: сцены, их макеты и выходы'),
    stB('×', stPanelClose, 'Закрыть (Esc)', 'st-x'));
  el.append(head);
  el.append(stEl('div', 'st-note', 'Всё здесь видно только на сценах (мониторы музыкантов, ведущего). Зрители этого не видят.'));

  // Сцены с выходами: вкл/выкл и какой макет сейчас
  const sec = (title, help) => { const s = stEl('div', 'st-sec'); const h = stEl('div', 'st-sub', title); if (help) h.title = help; s.append(h); el.append(s); return s; };
  const scr = sec('Сцены на мониторах', 'Сцена с выходом — это отдельный монитор (или NDI). Макет — что на нём нарисовано.');
  const outs = lib.scenes.filter((sc) => (sc.outputs || []).length);
  if (!outs.length) {
    scr.append(stEl('div', 'st-note', 'Пока ни у одной сцены нет выхода. Добавьте сцену (например «Текущий и следующий слайд») и укажите ей монитор или NDI.'));
    scr.append(stB('＋ Сцена для музыкантов', () => { stPanelClose(); openScreensTab(); scSceneFromTpl('st-timer'); }));
  }
  for (const sc of outs) {
    const row = stEl('div', 'st-row');
    const open = scOutsOf('scene:' + sc.id).length;
    const dot = stEl('span', 'st-dot' + (open ? ' on' : ''));
    dot.title = open ? 'Выводится' : sc.on ? 'Выходы не открылись' : 'Вывод выключен';
    const on = stB(sc.on ? 'Вкл' : 'Выкл', () => { sc.on = !sc.on; scSceneOutSet(sc, true); }, sc.on ? 'Выключить вывод этой сцены' : 'Включить вывод этой сцены', sc.on ? 'on' : '');
    const sel = document.createElement('select');
    sel.title = 'Макет, который сейчас на этой сцене';
    const own = scLay(sc.layout);
    sel.append(Object.assign(stEl('option', '', own ? `Свой: ${own.name}` : 'Свой (не выбран)'), { value: '' }));
    for (const l of scPresets()) if (l !== own) sel.append(Object.assign(stEl('option', '', l.name), { value: l.id }));
    sel.value = scLayoutOf(sc) === (sc.layout || '') ? '' : scLayoutOf(sc);
    sel.addEventListener('change', () => scSetLayout(sc.id, sel.value));
    const nm = stEl('span', 'st-name', sc.name);
    nm.title = sc.name + (sc.follow ? ' · макет может менять слайд (меню слайда → «Макет сцены…»)' : '');
    row.append(dot, nm, on, sel);
    scr.append(row);
  }
  const stages = outs;

  // Сообщение
  const ms = sec('Сообщение на сцену');
  const ta = stEl('textarea');
  ta.rows = 2;
  ta.dataset.f = 'msg';
  ta.placeholder = 'Например: «Ещё один припев» — Ctrl+Enter';
  ta.value = stDraft;
  ta.addEventListener('input', () => { stDraft = ta.value; });
  ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.stopPropagation(); stSetMsg(ta.value); } else ev.stopPropagation(); });
  ms.append(ta);
  const mr = stEl('div', 'st-row');
  mr.append(stB('Показать', () => stSetMsg(ta.value), 'Ctrl+Enter', 'primary'), stB('Убрать', () => stSetMsg(''), 'Убрать сообщение со сцены'));
  if (stMsg.text) mr.append(stEl('span', 'st-now', '● ' + stMsg.text));
  ms.append(mr);
  if (stages.length && !scPresets().some((l) => (l.items || []).some((it) => it.type === 'msg'))) ms.append(stEl('div', 'st-note warn', 'В макетах нет блока «Сообщение» — сообщение некуда показать.'));

  // Таймеры
  const tm = sec('Таймеры');
  for (const t of lib.timers || []) {
    const r = stRun[t.id] || {};
    const row = stEl('div', 'st-row st-timer');
    const nm = stEl('span', 'st-name', t.name);
    nm.title = (t.mode === 'up' ? 'Секундомер' : 'Обратный отсчёт с ' + stFmt(t.dur * 1000)) + ' · правой кнопкой — настройки';
    const val = stEl('span', 'st-val');
    val.dataset.timer = t.id;
    const go = stB(r.run ? '❚❚' : '▶', () => stToggle(t.id), r.run ? 'Пауза' : 'Пуск', r.run ? 'on' : '');
    const rs = stB('⟲', () => stReset(t.id), 'Сначала');
    const more = stB('⋯', (ev) => stTimerMenu(ev, t), 'Время, вид, имя, удалить');
    row.append(nm, val, go, rs, more);
    row.addEventListener('contextmenu', (ev) => { ev.preventDefault(); stTimerMenu(ev, t); });
    tm.append(row);
  }
  tm.append(stB('＋ Таймер', async () => {
    const v = await askName('Новый таймер: минуты или мм:сс', '5:00');
    if (v == null) return;
    const d = stParseDur(v);
    if (d == null || d <= 0) { flashStatus('Не понял время. Пример: 5 или 4:30'); return; }
    stNewTimer({ dur: d });
  }, 'Обратный отсчёт; секундомер — в «⋯»'));

  // Только для сцены
  const on = sec('Только для сцены');
  const orow = stEl('div', 'st-row');
  orow.append(stEl('span', 'st-name', stOnly ? stOnly.label || 'слайд' : 'Пусто — правой кнопкой по слайду → «Только на сцену»'));
  if (stOnly) orow.append(stB('Убрать', () => stShowOnly(null)));
  on.append(orow);

  // Запись и эфир — только надпись-предупреждение на сцене, сама программа ничего не записывает
  const cp = sec('Табличка «Идёт запись / эфир»');
  cp.append(stEl('div', 'st-note', 'Включите, когда ваши операторы начали запись или трансляцию: на сцене загорится «● ЗАПИСЬ» или «● ЭФИР» со временем (блок «Запись / эфир» в макете) — чтобы музыканты и ведущий знали. Программа сама ничего не записывает.'));
  const crow = stEl('div', 'st-row');
  const capBtn = (k, name) => { const b = stB('', () => stToggleCap(k), stCap[k] ? 'Остановить отметку' : 'Отметить, что идёт ' + name.toLowerCase(), stCap[k] ? 'st-rec on' : 'st-rec'); b.dataset.cap = k; b.dataset.name = name; return b; };
  crow.append(capBtn('rec', 'Запись'), capBtn('live', 'Эфир'));
  cp.append(crow);

  Icons.apply(el);
  stPanelTick();
  stPanelPlace();
  if (focus) { const f = el.querySelector(`[data-f="${focus}"]`); if (f) f.focus(); }
}

// Цифры таймеров и записи — каждые 250 мс, без перерисовки панели
function stPanelTick() {
  if (!stPop) return;
  stPop.el.querySelectorAll('[data-timer]').forEach((v) => {
    const t = stTimer(v.dataset.timer);
    if (!t) return;
    const ms = stTimerMs(t);
    v.textContent = stFmt(ms, t.mode === 'up');
    v.classList.toggle('over', t.mode !== 'up' && ms <= 0);
    v.classList.toggle('idle', !(stRun[t.id] || {}).run);
  });
  stPop.el.querySelectorAll('[data-cap]').forEach((b) => {
    const at = stCap[b.dataset.cap];
    b.textContent = (at ? '■ ' : '● ') + b.dataset.name + (at ? ' ' + stFmt(Date.now() - at, true) : '');
  });
}

if ($('stBtn')) $('stBtn').addEventListener('click', stPanelToggle);

/* ----- Блок «Таймеры» под макросами (колонка «Предпросмотра») -----
   Те же таймеры lib.timers, что в панели «Сцена» и в блоках сценического экрана: создать, настроить, пуск/пауза, сначала.
   Виды: 'down' — обратный отсчёт (dur, с), 'up' — секундомер, 'to' — до времени суток (at, «10:00»). Свёрнут — settings.tmFold */
const TM_MODES = [['down', 'Обратный отсчёт'], ['up', 'Секундомер'], ['to', 'До времени']];
function stNextHalfHour() {
  const d = new Date(Date.now() + 30 * 60e3);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return stPad(d.getHours()) + ':' + stPad(d.getMinutes());
}
function tmSet(t, patch) {
  Object.assign(t, patch);
  saveLib();
  stSend();
  stPanelRefresh();
}
function tmRender() {
  const box = $('tmRows');
  if (!box || !lib) return;
  $('tmBox').classList.toggle('fold', !!settings.tmFold);
  $('tmFold').setAttribute('aria-expanded', String(!settings.tmFold));
  const list = lib.timers || [];
  const run = list.filter((t) => t.mode === 'to' || (stRun[t.id] || {}).run).length;
  $('tmSum').textContent = list.length ? ` · ${list.length}${run ? ', идёт ' + run : ''}` : '';
  // Не мешать вводу: поле в фокусе — перерисуем после
  if (box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  box.replaceChildren();
  if (!list.length) box.append(stEl('div', 'tm-empty', 'Таймеров нет — «＋ Таймер». Их видно и на сценическом экране (блок «Таймер»).'));
  for (const t of list) {
    const r = stRun[t.id] || {};
    const row = stEl('div', 'tm-row');
    row.dataset.tm = t.id;
    const nm = stEl('span', 'tm-name', t.name);
    nm.title = 'Двойной щелчок — переименовать · правая кнопка — меню';
    nm.addEventListener('dblclick', async () => { const n = await askName('Название таймера', t.name); if (n) tmSet(t, { name: n }); });
    const val = stEl('span', 'tm-val');
    const ctl = stEl('div', 'tm-ctl');
    if (t.mode !== 'to') {
      ctl.append(stB(r.run ? '❚❚' : '▶', () => stToggle(t.id), r.run ? 'Пауза' : 'Пуск', r.run ? 'on' : ''));
      ctl.append(stB('⟲', () => stReset(t.id), t.mode === 'up' ? 'С нуля' : 'Сначала'));
    }
    const mode = document.createElement('select');
    mode.className = 'tm-mode';
    mode.setAttribute('aria-label', 'Вид таймера');
    for (const [v, n] of TM_MODES) mode.append(Object.assign(stEl('option', '', n), { value: v }));
    mode.value = t.mode || 'down';
    mode.addEventListener('change', () => { const m = mode.value; mode.blur(); tmSet(t, { mode: m, ...(m === 'to' && !t.at ? { at: stNextHalfHour() } : {}) }); stReset(t.id); });
    ctl.append(mode);
    if (t.mode === 'to') {
      const at = Object.assign(document.createElement('input'), { type: 'time', value: t.at || '10:00', title: 'До какого времени' });
      at.addEventListener('change', () => { if (/^\d{2}:\d{2}$/.test(at.value)) { at.blur(); tmSet(t, { at: at.value }); } });
      ctl.append(at);
    } else if (t.mode !== 'up') {
      const dur = Object.assign(document.createElement('input'), { type: 'text', className: 'tm-dur', value: stFmt((t.dur || 0) * 1000), title: 'Время: минуты или мм:сс (5, 4:30, 1:00:00) — Enter' });
      const apply = () => {
        const d = stParseDur(dur.value);
        if (d == null || d <= 0) { flashStatus('Не понял время. Пример: 5 или 4:30'); dur.value = stFmt((t.dur || 0) * 1000); return; }
        if (d === t.dur) return;
        dur.blur();
        tmSet(t, { dur: d });
        if (!(stRun[t.id] || {}).run) stReset(t.id); // стоит — сразу показать новое время
      };
      dur.addEventListener('change', apply);
      dur.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') apply(); if (e.key === 'Escape') { dur.value = stFmt((t.dur || 0) * 1000); dur.blur(); } });
      ctl.append(dur);
    }
    ctl.append(stB('⋯', (ev) => stTimerMenu(ev, t), 'Время, вид, имя, вывод в поле, удалить'));
    row.append(nm, val, ctl);
    if (t.mode !== 'up') { const bar = stEl('div', 'tm-bar'); bar.append(stEl('i')); row.append(bar); }
    // Куда выведен: плейлист › презентация › поле (× — убрать), «＋ в поле…» — выбрать ещё
    const outs = stEl('div', 'tm-outs');
    for (const o of t.out || []) {
      const chip = stEl('span', 'tm-out', tmOutLabel(o));
      chip.title = 'Таймер выводится в это текстовое поле';
      chip.append(stB('×', () => tmOutSet(t, t.out.filter((x) => x !== o)), 'Убрать таймер из этого поля', 'tm-out-x'));
      outs.append(chip);
    }
    outs.append(stB('＋ в поле…', (ev) => tmOutPick(ev, t), 'Вывести таймер в текстовое поле презентации: плейлист → презентация → поле', 'tm-out-add'));
    row.append(outs);
    row.addEventListener('contextmenu', (ev) => { if (ev.target.closest('input, select')) return; ev.preventDefault(); stTimerMenu(ev, t); });
    box.append(row);
  }
  tmTick();
}
// Цифры и полоска — каждые 250 мс, без перерисовки
function tmTick() {
  const box = $('tmRows');
  if (!box || !lib || settings.tmFold) return;
  box.querySelectorAll('.tm-row').forEach((row) => {
    const t = stTimer(row.dataset.tm);
    if (!t) return;
    const ms = stTimerMs(t);
    const over = t.mode !== 'up' && ms <= 0;
    row.querySelector('.tm-val').textContent = stFmt(ms, t.mode === 'up');
    row.classList.toggle('run', t.mode === 'to' || !!(stRun[t.id] || {}).run);
    row.classList.toggle('over', over);
    const bar = row.querySelector('.tm-bar > i');
    if (bar) {
      const total = t.mode === 'to' ? 3600e3 : (t.dur || 0) * 1000; // «до времени» — полоска за последний час
      bar.style.width = (total > 0 ? Math.max(0, Math.min(1, ms / total)) * 100 : 0) + '%';
    }
  });
}
setInterval(tmTick, 250);
if ($('tmAdd')) $('tmAdd').addEventListener('click', () => { if (settings.tmFold) { settings.tmFold = false; saveSettings(); } stNewTimer({ dur: 300 }); });
if ($('tmFold')) $('tmFold').addEventListener('click', () => { settings.tmFold = !settings.tmFold; saveSettings(); tmRender(); });

/* ----- Таймер → текстовое поле презентации -----
   t.out = [{ list: 'pl:id' | 'lib:id', item, obj, name }]: в каком плейлисте (или библиотеке) выбрали, какая презентация,
   какое текстовое поле её шаблона темы (id объекта, имя — для подписи). Поле показывает время таймера вместо своего текста
   (playlist.js contentOf → meta.tm, scene.js). Одно поле — один таймер. Обратная сторона — «Что выводить → Таймер» в «Темах». */
function tmFieldsOf(item) {
  const out = new Map(); // id объекта → { name, bind }
  for (const s of item.slides || []) {
    if (s.k === 'audio') continue;
    let c;
    try { c = contentOf(item, s); } catch { continue; }
    const tpl = Scene.pickTpl(c);
    if (!tpl) continue;
    for (const [o, name] of Scene.textLabels(tpl.objs || [])) if (o.id && !out.has(o.id)) out.set(o.id, { name, bind: o.bind });
  }
  return out;
}
function tmOutSet(t, list) {
  t.out = list;
  if (!t.out.length) delete t.out;
  saveLib();
  if (typeof refreshLive === 'function') refreshLive(); // слайд на экране — с новым полем
  if (typeof renderService === 'function') renderService();
  stSend();
  stPanelRefresh();
}
// Шаги меню: плейлист (или библиотека) → презентация → текстовое поле
function tmOutPick(e, t) {
  const at = { clientX: e.clientX, clientY: e.clientY };
  const lists = [...lib.playlists.map((p) => ['pl', p, p.entries.map((x) => x.item)]), ...lib.libraries.map((l) => ['lib', l, l.items])];
  const head = (text) => ({ label: text, disabled: true, fn() {} });
  if (!lists.length) { flashStatus('Сначала создайте плейлист или библиотеку'); return; }
  showMenu(at, [
    head(`«${t.name}» → куда вывести: плейлист`),
    ...lists.flatMap(([k, v, ids], i) => [
      ...(k === 'lib' && (i === 0 || lists[i - 1][0] !== 'lib') ? ['-', head('Библиотеки')] : []),
      { label: v.name + (ids.length ? '' : ' (пусто)') + ' ›', disabled: !ids.length, fn: () => tmPickItem(at, t, k + ':' + v.id, v.name, ids) },
    ]),
  ]);
}
function tmPickItem(at, t, list, listName, ids) {
  const items = [...new Set(ids)].map((id) => lib.items[id]).filter(Boolean);
  showMenu(at, [
    { label: `${listName} → презентация`, disabled: true, fn() {} },
    ...items.map((it) => ({ label: it.name + ' ›', fn: () => tmPickField(at, t, list, it) })),
  ]);
}
function tmPickField(at, t, list, item) {
  const fields = tmFieldsOf(item);
  if (!fields.size) { showNotice(`У темы презентации «${item.name}» нет текстовых полей. Сделайте шаблон с полем во вкладке «Темы» (Редактор → Темы) и назначьте эту тему презентации`, true); return; }
  const mine = (id) => (t.out || []).some((o) => o.item === item.id && o.obj === id);
  const other = (id) => (lib.timers || []).find((x) => x !== t && (x.out || []).some((o) => o.item === item.id && o.obj === id));
  showMenu(at, [
    { label: `${item.name} → текстовое поле`, disabled: true, fn() {} },
    ...[...fields].map(([id, f]) => {
      const o2 = other(id);
      return {
        label: (mine(id) ? '✓ ' : '   ') + f.name + (f.bind && f.bind !== 'static' && Themes.BINDS[f.bind] ? ` · сейчас: ${Themes.BINDS[f.bind].split(' (')[0].toLowerCase()}` : '') + (o2 ? ` · занято «${o2.name}»` : ''),
        fn: () => {
          if (mine(id)) { tmOutSet(t, t.out.filter((o) => !(o.item === item.id && o.obj === id))); flashStatus(`Таймер убран из поля «${f.name}»`); return; }
          // Поле было у другого таймера — переходит к этому
          for (const x of lib.timers || []) if (x !== t && x.out) { x.out = x.out.filter((o) => !(o.item === item.id && o.obj === id)); if (!x.out.length) delete x.out; }
          tmOutSet(t, [...(t.out || []), { list, item: item.id, obj: id, name: f.name }]);
          flashStatus(`«${t.name}» → «${item.name}», поле «${f.name}» · Ctrl+Z — вернуть`);
        },
      };
    }),
  ]);
}
// Подпись цели: «Служение › Объявления › Время»
function tmOutLabel(o) {
  const [k, id] = String(o.list || '').split(':');
  const v = (k === 'pl' ? lib.playlists : lib.libraries).find((x) => x.id === id);
  const it = lib.items[o.item];
  return [v ? v.name : '', it ? it.name : 'презентация удалена', o.name || 'поле'].filter(Boolean).join(' › ');
}

/* ----- Ноды макросов ----- */

// Для инспектора блоков (screens.js): таймеры, сообщение, запись
const stApi = {
  timers: () => (lib && lib.timers) || [],
  newTimer: () => stNewTimer(),
  toggle: (id) => stToggle(id),
  reset: (id) => stReset(id),
  editTimer: (id) => stEditTimer(id),
  msg: () => stMsg.text,
  setMsg: (t) => stSetMsg(t),
  cap: () => stCap,
  toggleCap: (k) => stToggleCap(k),
};

if (typeof Macros === 'object') {
  const R2 = Macros.register;
  const sceneOpts = () => [['', 'Все, где «макет меняют слайды»'], ...lib.scenes.map((s) => [s.id, s.name])];
  const layoutOpts = () => [['', '— выберите —'], ...scPresets().map((x) => [x.id, x.name])]; // макеты — «Пресеты сцен»
  const timerOpts = () => [['', '— выберите —'], ...(lib.timers || []).map((t) => [t.id, t.name])];
  R2('act.stageLayout', {
    cat: 'action', name: 'Макет сцены', icon: 'stage', help: 'Поставить на выходы сцены другой макет из «Пресетов сцен» (или на все сцены «по слайду»). «Переключать» — каждое нажатие меняет макет: первый ↔ второй. Экраны зрителей не меняются.',
    params: [
      { id: 'screen', name: 'Сцена (выход)', t: 'select', opts: sceneOpts, def: '' },
      { id: 'mode', name: 'Что делать', t: 'select', opts: [['set', 'Поставить макет'], ['toggle', 'Переключать между двумя']], def: 'set' },
      { id: 'layout', name: 'Макет', t: 'select', opts: layoutOpts, def: '' },
      { id: 'layout2', name: 'Второй макет', t: 'select', opts: () => [['', 'Свой макет этой сцены'], ...scPresets().map((x) => [x.id, x.name])], def: '', show: (p) => p.mode === 'toggle' },
    ],
    ins: EXEC_IN, outs: EXEC_OUT,
    run(c, p) {
      const l = scLay(p.layout);
      if (!l) throw new Error('Макет не выбран');
      const list = p.screen ? [scScene(p.screen)].filter(Boolean) : stFollowers();
      if (!list.length) throw new Error('Нет такой сцены');
      list.forEach((sc) => {
        // Переключать: сейчас первый — ставим второй ('' — свой макет сцены), иначе — первый
        const to = p.mode === 'toggle' && scLayoutOf(sc) === l.id ? p.layout2 || sc.layout : l.id;
        scSetLayout(sc.id, to, true);
      });
      return 'out';
    },
    sum: (p) => (mcOptName(layoutOpts, p.layout || '') || 'не выбран') + (p.mode === 'toggle' ? ' ↔ ' + (p.layout2 ? mcOptName(layoutOpts, p.layout2) || '?' : 'свой') : ''),
  });
  // Цель: id экрана или 'scene:id' сцены
  const outTargets = () => [['', '— выберите —'], ...lib.screens.filter((s) => s.id !== 'main').map((s) => [s.id, 'Экран: ' + s.name]), ...lib.scenes.map((sc) => ['scene:' + sc.id, 'Сцена: ' + sc.name])];
  R2('act.screenShow', {
    cat: 'action', name: 'Вывод экрана / сцены', icon: 'screens', help: 'Включить или выключить выходы экрана или сцены — как кнопка «Вывод» в Редакторе сцен.',
    params: [
      { id: 'screen', name: 'Что', t: 'select', opts: outTargets, def: '' },
      { id: 'what', name: 'Вывод', t: 'select', opts: [['on', 'Включить'], ['off', 'Выключить'], ['toggle', 'Переключить']], def: 'on' },
    ],
    ins: EXEC_IN, outs: EXEC_OUT,
    run(c, p) {
      const id = p.screen || '';
      const sc = id.startsWith('scene:') ? scScene(id.slice(6)) : null;
      const s = sc ? null : scScreen(id);
      if (!sc && !s) throw new Error('Экран или сцена не выбраны');
      const cur = sc ? !!sc.on : !!s.enabled;
      const w = p.what === 'off' || p.what === 'blank' ? false : p.what === 'toggle' ? !cur : true; // 'blank' — из старых макросов «Ничего»
      if (sc) { sc.on = w; scSceneOutSet(sc, true); } else scScreenSet(s, { enabled: w }, true);
      return 'out';
    },
    sum: (p) => (mcOptName(outTargets, p.screen || '') || '?') + ' → ' + ({ off: 'выкл', toggle: 'переключить' }[p.what] || 'вкл'),
  });
  R2('act.stageMsg', {
    cat: 'action', name: 'Сообщение на сцену', icon: 'message', help: 'Показать или убрать сообщение на сценических экранах (блок «Сообщение»). Зрители его не видят.',
    params: [{ id: 'mode', name: 'Что', t: 'select', opts: [['show', 'Показать'], ['clear', 'Убрать']], def: 'show' }, { id: 'text', name: 'Текст', t: 'text', def: 'Ещё один припев', show: (p) => (p.mode || 'show') === 'show' }],
    ins: [...EXEC_IN, { id: 'text', name: 'Текст', t: 'any' }], outs: EXEC_OUT,
    run(c, p, inp) { if ((p.mode || 'show') === 'clear') stSetMsg(''); else stSetMsg(mcStr(inp('text'))); return 'out'; },
    sum: (p) => ((p.mode || 'show') === 'clear' ? 'убрать' : p.text ? `«${p.text}»` : ''),
  });
  R2('act.timer', {
    cat: 'action', name: 'Таймер', icon: 'timer', help: 'Пустить, остановить или сбросить таймер сценического экрана.',
    params: [
      { id: 'timer', name: 'Таймер', t: 'select', opts: timerOpts, def: '' },
      { id: 'cmd', name: 'Что', t: 'select', opts: [['start', 'Пустить'], ['pause', 'Пауза'], ['toggle', 'Пуск / пауза'], ['reset', 'Сбросить'], ['restart', 'Сначала и пустить']], def: 'restart' },
      { id: 'min', name: 'Минут (0 — как задано)', t: 'num', def: 0 },
    ],
    ins: EXEC_IN, outs: EXEC_OUT,
    run(c, p) {
      const t = stTimer(p.timer);
      if (!t) throw new Error('Таймер не выбран');
      if (Number(p.min) > 0) { t.dur = Math.round(Number(p.min) * 60); saveLib(); }
      const cmd = p.cmd || 'restart';
      if (cmd === 'start') stToggle(t.id, true);
      else if (cmd === 'pause') stToggle(t.id, false);
      else if (cmd === 'toggle') stToggle(t.id);
      else stReset(t.id, cmd === 'restart');
      return 'out';
    },
    sum: (p) => (mcOptName(timerOpts, p.timer || '') || 'не выбран') + ' · ' + ({ start: 'пуск', pause: 'пауза', toggle: 'пуск/пауза', reset: 'сброс', restart: 'сначала' })[p.cmd || 'restart'],
  });
  R2('sen.timer', {
    cat: 'sensor', name: 'Таймер', icon: 'timer', help: 'Сколько осталось (или прошло) у таймера, идёт ли он, вышло ли время.',
    params: [{ id: 'timer', name: 'Таймер', t: 'select', opts: timerOpts, def: '' }],
    outs: [{ id: 'sec', name: 'Секунд', t: 'num' }, { id: 'run', name: 'Идёт', t: 'bool' }, { id: 'over', name: 'Время вышло', t: 'bool' }],
    eval(c, p) {
      const t = stTimer(p.timer);
      if (!t) return { sec: 0, run: false, over: false };
      const ms = stTimerMs(t);
      return { sec: Math.round(ms / 1000), run: !!(stRun[t.id] || {}).run, over: t.mode !== 'up' && ms <= 0 };
    },
    sum: (p) => mcOptName(timerOpts, p.timer || '') || 'не выбран',
  });
}
