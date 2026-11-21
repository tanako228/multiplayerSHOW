/* ---------- Плейлисты, библиотеки и презентации (вкладка «Экран») ----------
   Всё — презентации из слайдов (модель описана в slides.js). Презентации хранятся один раз
   в lib.items. Библиотека — список id презентаций. Плейлист — упорядоченный список записей
   { eid, item }, поэтому одна песня может стоять в плейлисте дважды, а правка видна везде.
   Слайды любого вида выделяются, копируются (Ctrl+C), вырезаются (Ctrl+X), вставляются (Ctrl+V)
   в любую презентацию и перетаскиваются мышью. Всё сохраняется в userData/library.json. */

const newId = Slides.newId;

let lib = null;
// Рабочее содержимое — то, что в ленте (по нему идут стрелки и щелчки по слайдам). Список слева (lib.view) и «Содержание»
// можно листать свободно: лента не меняется, пока пункт не открыли (щелчок, Enter).
let work = null;             // рабочий список { kind, id }
let openKey = null;          // пункт рабочего списка, открытый в ленте, когда «одной лентой» выключено (settings.plFeed)
// Показанный слайд в ленте уже другой (сменили перевод у пункта «Библия»), а на экране — прежний: тот же объект,
// что plShown, пока на экран ничего не выводили. Рамка такого слайда — обратного цвета (.sl.live.stale); щелчок — вывести
let plStale = null;
// Одной лентой — только плейлист; в библиотеке песен много, открывается один пункт
const feedAll = () => !!settings.plFeed && !!work && work.kind === 'pl';

/* ----- Темы: фон, размытие, шрифт, расположение ----- */

const THEME_DEFAULTS = {
  font: 'segoe', scale: 1, color: '#ffffff', bg: '#000000', bgUrl: '', bgVideo: false, blur: 0, dim: 0,
  weight: 500, italic: false, align: 'center', valign: 'middle', shadow: false, upper: false, lineHeight: 1.25, pad: 5,
};

function starterThemes() {
  const t = (name, s) => ({ id: newId(), name, style: { ...THEME_DEFAULTS, ...s } });
  return [
    t('Тёмно-синяя', { bg: '#051822', color: '#d4c9c7', weight: 600 }),
    t('Классика', { font: 'georgia', bg: '#000000', color: '#ffffff' }),
    t('Медь', { font: 'bahnschrift', bg: '#2d383e', color: '#ffffff', weight: 700, upper: true, shadow: true }),
    t('Внизу экрана', { valign: 'bottom', pad: 4, scale: 0.7, weight: 700, shadow: true }),
  ];
}

// Свои темы (lib.themes) и стандартные из программы (Themes.BUILTIN, themes.js).
// Правки во вкладке «Темы» — черновик; экран и миниатюры берут применённую копию lib.themesLive[id] (кнопка «Применить тему»)
// lib.extThemes — темы, пришедшие с презентацией с другого компьютера, которых нет среди своих: ими презентация
// показывается как раньше; в редакторе тем (группа «Из презентаций») правая кнопка — «Сохранить в темы»
const extThemes = () => (lib && Array.isArray(lib.extThemes) ? lib.extThemes : []);
const themeById = (id) => (lib ? (lib.themesLive && lib.themesLive[id]) || Themes.find(lib.themes, id) || (id && extThemes().find((t) => t.id === id)) || null : null);
const appliedThemes = () => (lib ? [...lib.themes.map((t) => (lib.themesLive && lib.themesLive[t.id]) || t), ...extThemes()] : []);

// Какая тема действует: у слайда → у презентации → общая для вида (песни, Библия, картинки, свои слайды)
// Темы, которой нет (пришла с импортом из другой программы, удалена), — пропускаем: действует выбранная по умолчанию
function themeIdFor(kind, item, slide) {
  const ok = (id) => (id && themeById(id) ? id : '');
  return ok(slide && slide.theme) || ok(item && item.theme) || (lib && lib.themeFor[kind]) || '';
}

function styleFor(kind, item, slide) {
  const t = themeById(themeIdFor(kind, item, slide));
  if (!t) {
    const base = textStyle();
    return kind === 'custom' ? { ...THEME_DEFAULTS, ...base } : base;
  }
  // style.tpls — шаблоны темы; style.tpl — шаблон, выбранный в окне темы (у презентации, иначе общий для вида)
  return { ...THEME_DEFAULTS, ...Themes.style(t), showTranslation: settings.showTr, bible: bibleLook(), tpl: tplIdFor(kind, item) };
}
const tplIdFor = (kind, item) => (item && item.tpl) || (lib && lib.tplFor && lib.tplFor[kind]) || undefined;

// Вид презентации для тем: song | bible | media | custom | audio | mixed
const kindOfItem = (item) => ({ deck: 'media', media: 'media' })[item.kind] || item.kind || 'mixed';

// meta — данные для полей шаблона темы (название, CCLI, номер песни)
const contentOf = (item, slide) => Slides.content(slide, styleFor(Slides.themeKind(slide), item, slide),
  { fit: settings.fit, sound: settings.videoSound, loop: settings.videoLoop, meta: { title: item.name, ccli: item.song && item.song.ccli, number: item.song && item.song.number, tm: tmMapOf(item) } });
// Таймеры, выведенные в текстовые поля этой презентации (stage.js: t.out) → { id объекта шаблона: id таймера }
function tmMapOf(item) {
  let m = null;
  for (const t of (typeof lib !== 'undefined' && lib && lib.timers) || []) for (const o of t.out || []) if (o.item === item.id) (m || (m = {}))[o.obj] = t.id;
  return m;
}

let saveTimer = 0;
function saveLib() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushLib, 300);
}
function flushLib() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  histTake();
  libSend(histCur);
  if (typeof mcLibSaved === 'function') mcLibSaved(); // макросы: «Добавлено в плейлист»
  if (typeof repoTouch === 'function') repoTouch('lib'); // репозиторий (tools.js)
  if (typeof scStage === 'function') scStage(); // очередь и части песни на сценах — после правки плейлиста (stage.js)
}

/* ----- Отмена и повтор (Ctrl+Z, Ctrl+Shift+Z): снимки содержимого при каждом сохранении ----- */
// Правки за 0,3 с до сохранения — один шаг. Открытый список (view) не входит: отмена не переключает вид.
const HIST_KEYS = ['items', 'libraries', 'playlists', 'themes', 'themeFor', 'tplFor', 'themesLive', 'macros', 'fileMacros', 'screens', 'scenes', 'scenePresets', 'timers', 'verseSplits', 'lowerThirds'];
const HIST_MAX = 30;           // шагов назад
const HIST_CHARS = 80e6;       // и не больше ~80 млн символов на всю историю (большие библиотеки), но не меньше 5 шагов
let histCur = null;            // снимок того, что сохранено сейчас
let histUndo = [];
let histRedo = [];

/* Снимок — по кускам: каждая презентация своей строкой JSON (кэш), остальное (списки, темы, макросы…) — одной строкой.
   Строки презентаций, которые не менялись, берутся из прошлого снимка: 30 шагов отмены большой библиотеки
   занимают почти столько же памяти, сколько один, а в main (libSend) уходят только изменённые презентации.
   { items: Map id → строка, rest: строка, size: сколько нового в этом снимке } */
function histSnap() {
  const prev = histCur && histCur.items;
  const items = new Map();
  let size = 0;
  for (const id of Object.keys(lib.items || {})) {
    const s = JSON.stringify(lib.items[id]);
    const old = prev && prev.get(id);
    if (old === s) items.set(id, old);
    else { items.set(id, s); size += s.length; }
  }
  const rest = JSON.stringify(HIST_KEYS.map((k) => (k === 'items' ? null : lib[k])));
  return { items, rest, size: size + rest.length };
}
function snapSame(a, b) {
  if (!a || !b || a.rest !== b.rest || a.items.size !== b.items.size) return false;
  for (const [id, s] of a.items) if (b.items.get(id) !== s) return false;
  return true;
}

function histTake() {
  if (!lib) return;
  const now = histSnap();
  if (histCur === null) { histCur = now; return; }
  if (snapSame(now, histCur)) return; // ничего не поменялось — тот же снимок (по нему team.js, remote.js узнают о правках)
  histUndo.push(histCur);
  histRedo = [];
  histCur = now;
  let size = histUndo.reduce((n, s) => n + s.size, 0);
  while (histUndo.length > HIST_MAX || (histUndo.length > 5 && size > HIST_CHARS)) size -= histUndo.shift().size;
}

/* Сохранение по кускам: main (lib:patch) хранит строки презентаций, присланные раньше, и получает только изменённые.
   Раньше каждая правка пересылала и разбирала всю библиотеку (7 МБ у 3000 песен) — ~0,2 с на правку */
const libGen = newId(); // какой копией строк в main мы пользуемся (после перезапуска окна — новая)
let libSent = null;     // Map id → строка: что уже лежит в main
let libSendQ = Promise.resolve();
function libSend(snap) {
  if (!window.api.libPatch || !snap) {
    window.api.libSave(lib).catch(() => showNotice('Не удалось сохранить плейлисты и библиотеки', true));
    return;
  }
  const head = {};
  for (const k of Object.keys(lib)) if (k !== 'items') head[k] = lib[k];
  const msg = { gen: libGen, ids: [...snap.items.keys()], head: JSON.stringify(head), shared: (lib.libraries || []).some((l) => l && l.shared) };
  // Отправки идут по очереди: следующая считает изменения от того, что main точно получил
  libSendQ = libSendQ.then(async () => {
    for (let tries = 0; tries < 2; tries++) {
      const full = !libSent;
      const items = {};
      for (const [id, s] of snap.items) if (full || libSent.get(id) !== s) items[id] = s;
      try {
        const r = await window.api.libPatch({ ...msg, full, items });
        if (r && r.resend) { libSent = null; continue; } // main не знает наших строк (перезапуск, другой профиль) — целиком
        libSent = snap.items;
        return;
      } catch {
        libSent = null;
        showNotice('Не удалось сохранить плейлисты и библиотеки', true);
        return;
      }
    }
  });
}

function histApply(snap) {
  const liveWas = JSON.stringify(lib.themesLive || null);
  const splitsWas = JSON.stringify(lib.verseSplits || null);
  JSON.parse(snap.rest).forEach((v, i) => { if (HIST_KEYS[i] === 'items') return; if (v === undefined || v === null) delete lib[HIST_KEYS[i]]; else lib[HIST_KEYS[i]] = v; });
  // Презентации: неизменные остаются теми же объектами (на них ссылается то, что на экране), остальные — из снимка
  const was = histCur && histCur.items;
  const items = {};
  for (const [id, s] of snap.items) { const cur = lib.items[id]; items[id] = cur && was && was.get(id) === s && JSON.stringify(cur) === s ? cur : JSON.parse(s); }
  lib.items = items;
  histCur = snap;
  if (!findView()) lib.view = lib.playlists[0] ? { kind: 'pl', id: lib.playlists[0].id } : lib.libraries[0] ? { kind: 'lib', id: lib.libraries[0].id } : null;
  libSend(snap);
  const keys = new Set(viewEntries().map((x) => x.key));
  selItems = selItems.filter((k) => keys.has(k));
  sel = [];
  renderService();
  if (typeof teAfterUndo === 'function') teAfterUndo(); // вкладка «Темы» — по вернувшимся темам
  if (typeof mcAfterUndo === 'function') mcAfterUndo(); // «Макросы» — по вернувшимся макросам
  if (typeof scAfterUndo === 'function') scAfterUndo(); // «Экраны» — экраны и сцены как были
  if (typeof ltAfterUndo === 'function') ltAfterUndo(); // окно «Плашки» (service.js) — по вернувшимся плашкам
  if (JSON.stringify(lib.themesLive || null) !== liveWas) refreshLive(); // отменили «Применить тему» — экран с прежней темой
  if (JSON.stringify(lib.verseSplits || null) !== splitsWas) bibleLookChanged(); // вернули деление стиха на части
}

function libUndo() {
  if (saveTimer) flushLib(); // несохранённая правка — сначала в историю
  if (!histUndo.length) { flashStatus('Отменять нечего'); return; }
  histRedo.push(histCur);
  histApply(histUndo.pop());
  flashStatus(`Отменено · Ctrl+Shift+Z — вернуть (шагов назад: ${histUndo.length})`);
}

function libRedo() {
  if (saveTimer) flushLib();
  if (!histRedo.length) { flashStatus('Повторять нечего'); return; }
  histUndo.push(histCur);
  histApply(histRedo.pop());
  flashStatus('Повторено');
}

async function initService() {
  lib = await window.api.libLoad();
  if (!lib || !lib.items) {
    const libId = newId();
    const plId = newId();
    lib = { version: 2, items: {}, libraries: [{ id: libId, name: 'Песни', items: [] }], playlists: [{ id: plId, name: 'Служение', entries: [] }], view: { kind: 'pl', id: plId } };
    saveLib();
  }
  // Старые песни, файлы и места из Библии становятся презентациями из слайдов
  if (lib.version !== 2) {
    for (const id of Object.keys(lib.items)) lib.items[id] = Slides.migrate(lib.items[id]);
    lib.version = 2;
    saveLib();
  }
  for (const it of Object.values(lib.items)) for (const s of it.slides) if (!s.id) s.id = newId();
  if (!Array.isArray(lib.themes)) { lib.themes = starterThemes(); saveLib(); }
  if (!lib.themeFor) lib.themeFor = {};
  if (!findView()) lib.view = lib.playlists[0] ? { kind: 'pl', id: lib.playlists[0].id } : lib.libraries[0] ? { kind: 'lib', id: lib.libraries[0].id } : null;
  work = lib.view ? { ...lib.view } : null; // при запуске в ленте — список, открытый слева
  if (typeof mcInit === 'function') mcInit(); // макросы: lib.macros, lib.fileMacros
  if (typeof scInit === 'function') scInit(); // экраны и сцены: lib.screens, lib.scenes
  histCur = histSnap(); // с этого состояния начинается история отмены
  renderService();
}

const curPl = () => (lib.view && lib.view.kind === 'pl' ? lib.playlists.find((p) => p.id === lib.view.id) : null) ||
  lib.playlists.find((p) => p.id === lib.lastPl) || lib.playlists[0] || null;

// view — { kind, id }; без него — список, открытый слева (lib.view)
function findView(view = lib.view) {
  if (!view) return null;
  const list = view.kind === 'pl' ? lib.playlists : lib.libraries;
  return list.find((x) => x.id === view.id) || null;
}
const viewKey = (view = lib.view) => (view ? view.kind + ':' + view.id : '');
const keyView = (vk) => { const i = String(vk || '').indexOf(':'); return i > 0 ? { kind: vk.slice(0, i), id: vk.slice(i + 1) } : null; };
const workKey = () => viewKey(work);
const workIsView = () => !!work && workKey() === viewKey(); // слева открыт тот же список, что в ленте
// Вкладки, где видна колонка «Плейлисты и библиотеки» + «Содержание»: «Экран» и «Библия» (одна логика)
const listsTab = () => tab === 'service' || tab === 'bible';

// Записи вида: [{ key, item, entry? }] — key уникален внутри вида; entry — запись плейлиста (у неё свой слой)
function viewEntries(view = lib.view) {
  const v = findView(view);
  if (!v) return [];
  if (view.kind === 'pl') return v.entries.map((e) => ({ key: e.eid, item: lib.items[e.item], entry: e })).filter((x) => x.item);
  return v.items.map((id) => ({ key: id, item: lib.items[id] })).filter((x) => x.item);
}
const entryByKey = (key, view = lib.view) => viewEntries(view).find((x) => x.key === key) || null;
const workEntries = () => viewEntries(work);
const workEntry = (key) => entryByKey(key, work);

/* ----- Слой у пункта: в плейлисте — у записи (своя у каждой записи), в библиотеке — у презентации ----- */
// entry.layer: id слоя, '' — «сам» (явно); нет поля — как у самой презентации (item.layer, старые данные)
const pickedLayer = (x) => (x.entry && 'layer' in x.entry ? x.entry.layer : x.item.layer) || '';
// Куда слайды пункта попадут «сами»: по первому видимому слайду
function autoLayerOf(item) {
  const s = item.slides.find((x) => x.k !== 'audio');
  const type = s ? ({ image: 'image', video: 'video', live: 'live', custom: 'custom' })[s.k] || 'text' : 'text';
  return autoLayer({ type });
}
// Слой, куда идёт пункт: выбранный вручную (если такой слой есть) или «сам»
const layerOfEntry = (x) => (layerById(pickedLayer(x)) ? pickedLayer(x) : autoLayerOf(x.item));
function setPickedLayer(x, id) {
  if (x.entry) x.entry.layer = id;
  else if (id) x.item.layer = id; else delete x.item.layer;
}
// Кнопка выбора слоя у пункта (в «Содержании» — span: строка сама кнопка)
function layerBtn(x, tag) {
  const b = document.createElement(tag || 'button');
  const own = layerById(pickedLayer(x));
  const l = layerById(layerOfEntry(x));
  b.className = 'ly-pick' + (own ? ' own' : '');
  b.title = `Слой: ${own ? layerName(own) : `сам (${l ? layerName(l) : '—'})`} — щелчок, чтобы выбрать другой`;
  b.textContent = own ? layerName(own) : 'Авто';
  if (tag === 'span') b.setAttribute('role', 'button');
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  b.addEventListener('dblclick', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const r = b.getBoundingClientRect();
    // Выделено несколько пунктов и этот среди них — меняем у всех
    const many = isItemSelected(x.key) && selItems.length > 1 && viewEntries().some((y) => y.key === x.key) ? selectedItems() : [x];
    layerPickMenu({ clientX: r.left, clientY: r.bottom + 2 }, many);
  });
  return b;
}

function setView(kind, id) {
  lib.view = { kind, id };
  if (kind === 'pl') lib.lastPl = id;
  // Открыли список — «Содержание» всегда видно, даже пустое
  if (settings.contentFold) { settings.contentFold = false; saveSettings(); }
  selItems = [];
  saveLib();
  // В «Библии» остаёмся: плейлист выбирается там же, куда добавлять стихи
  if (!listsTab()) setTab('service');
  // Лента (рабочее содержимое) не меняется — только «Содержание»; пусто в ленте — откроется этот список
  if (!work || !findView(work)) { work = { kind, id }; openKey = null; }
  renderService();
}

// Открыть пункт «Содержания» в ленте (щелчок, Enter): он становится рабочим
function openEntry(key) {
  const changed = !workIsView();
  work = { ...lib.view };
  selItems = [key];
  itemAnchor = key;
  if (changed) sel = [];
  peekClose();
  if (!feedAll()) {
    if (key !== openKey) sel = [];
    openKey = key;
    renderFeed();
    return;
  }
  if (changed) renderFeed();
  const el = document.querySelector(`#svcFeed .svc-item[data-key="${key}"]`);
  if (el) el.scrollIntoView({ block: 'start', behavior: changed ? 'auto' : 'smooth' });
  updatePlaylistLive();
}

// Ничего не открыто в ленте — добавленное (новая песня, файлы) сразу открыть; иначе рабочее не трогаем
function openIfIdle(key) {
  if (!key) return;
  if (work && findView(work) && (feedAll() ? workIsView() : openKey && workEntry(openKey))) return;
  work = { ...lib.view };
  if (!feedAll()) openKey = key;
}

// Презентация поменялась: обновить подпись вида и сохранить
function touched(item) {
  if (item.song) songAbsorb(item); // songs.js: правка слайдов песни возвращается в её текст
  item.kind = Slides.presKind(item);
  saveLib();
}

/* ----- Миниатюры слайдов ----- */

/* Сцена миниатюры (тема, подгонка текста) — самое дорогое в ленте. Поэтому:
   - в ленте слайды получают картинку, когда до них докрутили (thumbIO; запас — пара экранов), а не все сразу;
   - готовые сцены лежат в кэше по содержимому: перерисовка ленты (правка, другой перевод, новый стих)
     берёт для неизменных слайдов уже собранную сцену, а не строит её заново.
   Видео в миниатюрах — общий кадр (Scene.stillFrame), а не <video> на каждый слайд. */
const slThumbs = new Map(); // JSON содержимого → слой сцены; порядок — давность использования
const SL_THUMBS_MAX = 600;
if (document.fonts) document.fonts.addEventListener('loadingdone', () => slThumbs.clear()); // шрифт догрузился — подогнать заново
function thumbScene(content) {
  const key = JSON.stringify(content);
  const hit = slThumbs.get(key);
  if (hit && !hit.isConnected) {
    slThumbs.delete(key);
    slThumbs.set(key, hit);
    Scene.track(hit); // подгонка текста снова следит за размером (миниатюры могли стать крупнее)
    return hit;
  }
  const layer = Scene.build(content);
  if (!hit) {
    slThumbs.set(key, layer);
    if (slThumbs.size > SL_THUMBS_MAX) slThumbs.delete(slThumbs.keys().next().value);
  }
  return layer; // такой же слайд уже виден рядом — у этого своя сцена
}
function thumbContent(item, slide) {
  const content = contentOf(item, slide);
  if (content.style) content.style = { ...content.style, still: true };
  return content;
}
let thumbIO = null;
function thumbLater(pic, fill) {
  const root = $('svcFeed');
  if (!thumbIO && root && typeof IntersectionObserver === 'function') {
    thumbIO = new IntersectionObserver((list) => {
      for (const e of list) {
        if (!e.isIntersecting || !e.target._fill) continue;
        thumbIO.unobserve(e.target);
        const f = e.target._fill;
        e.target._fill = null;
        f();
      }
    }, { root, rootMargin: '1200px 0px' });
  }
  if (!thumbIO) { fill(); return; }
  pic._fill = fill;
  thumbIO.observe(pic);
}

// lazy — для ленты: сцену строить, когда миниатюра станет видна
function slideThumb(item, slide, lazy) {
  // Картинка слайда, под ней полоска с номером и подписью
  const el = Object.assign(document.createElement('div'), { className: 'sl k-' + slide.k + (slide.extra ? ' extra' : '') });
  if (slide.extra) el.title = 'Дополнительный стих — загружен заранее, показывается по щелчку или стрелкой';
  const pic = Object.assign(document.createElement('div'), { className: 'pic' });
  if (slide.k === 'audio') {
    pic.classList.add('audio-pic');
    pic.append(Object.assign(document.createElement('span'), { className: 'note', textContent: '♪' }),
      Object.assign(document.createElement('span'), { className: 'aname', textContent: slide.name || 'Музыка' }));
  } else if (slide.k === 'live') {
    // Живой источник: на миниатюре только значок и имя — камера включается, когда слайд на экране
    pic.classList.add('audio-pic', 'live-pic');
    pic.append(Object.assign(document.createElement('span'), { className: 'note', textContent: '● LIVE' }),
      Object.assign(document.createElement('span'), { className: 'aname', textContent: slide.name || 'Источник' }));
  } else if (slide.k === 'image' || slide.k === 'video') {
    // Видео — общим кадром (Scene.stillFrame): у ленты нет своего декодера на каждый ролик
    const m = slide.k === 'video' ? Scene.stillFrame(slide.url) : Object.assign(document.createElement('img'), { src: slide.url, loading: 'lazy' });
    m.draggable = false;
    pic.append(m);
    if (slide.k === 'video') pic.append(Object.assign(document.createElement('span'), { className: 'vbadge', textContent: '▶' }));
  } else {
    // Текст, Библия и свои слайды рисуем той же сценой, что и экран, — с темой (видеофон — кадром)
    const fill = () => pic.prepend(thumbScene(thumbContent(item, slide))); // под значками макросов (mcBadge)
    if (lazy) thumbLater(pic, fill); else fill();
  }
  const cap = Object.assign(document.createElement('div'), { className: 'cap' });
  cap.append(Object.assign(document.createElement('span'), { className: 'no', textContent: item.slides.indexOf(slide) + 1 }),
    Object.assign(document.createElement('span'), { className: 'lbl', textContent: slide.label || '' }));
  // Часть песни — полоска цвета её типа (songs.js)
  const pc = slide.k === 'text' && partColor(slide.label);
  if (pc) { cap.classList.add('part'); cap.style.setProperty('--part', pc); }
  el.append(pic, cap);
  return el;
}

/* ----- Иконки (свои, без внешних файлов) ----- */

const ICONS = {
  lib: '<rect x="1.5" y="3" width="3.2" height="11" rx=".6" fill="#e04a3c"/><rect x="5.4" y="1.8" width="3.2" height="12.2" rx=".6" fill="#b8302a"/><rect x="9.7" y="3.2" width="3.2" height="10.8" rx=".6" fill="#ef6f60" transform="rotate(-14 11.3 8.6)"/><rect x="5.9" y="4" width="2.2" height=".9" fill="#ffd2cc"/><rect x="1" y="14" width="14" height="1.3" rx=".6" fill="#8c2219"/>',
  pl: '<rect x="1" y="2.6" width="8.4" height="1.9" rx=".95" fill="#f5c400"/><rect x="1" y="6.6" width="8.4" height="1.9" rx=".95" fill="#f5c400"/><rect x="1" y="10.6" width="5.4" height="1.9" rx=".95" fill="#f5c400"/><circle cx="11.2" cy="12.5" r="2.1" fill="#e2a600"/><path d="M12.3 12.5V2.4l3 1v2l-1.6-.5v7.6z" fill="#e2a600"/>',
  files: '<path d="M1 3.6a1 1 0 0 1 1-1h4.2l1.5 1.5H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="#5e9cc8"/><rect x="1" y="5.6" width="14" height="1" fill="#4a85b0"/>',
  song: '<path d="M5.6 3.2L14 1.4v9.4a2.2 2.2 0 1 1-1.5-2.1V4.6L7.1 5.8v7.1a2.2 2.2 0 1 1-1.5-2.1z" fill="#5aa9e6"/>',
  bible: '<rect x="2.5" y="1.3" width="11" height="13.4" rx="1.3" fill="#a8743f"/><rect x="2.5" y="12.4" width="11" height="2.3" rx="1" fill="#7d5328"/><rect x="7.3" y="3.6" width="1.4" height="7" fill="#f6e6c8"/><rect x="5.3" y="5.4" width="5.4" height="1.4" fill="#f6e6c8"/>',
  image: '<rect x="1" y="2.5" width="14" height="11" rx="1.5" fill="#3f9b5a"/><circle cx="5" cy="6" r="1.5" fill="#dcf6e3"/><path d="M2.5 12l4-4.3 2.8 2.9 1.8-1.9 2.4 3.3z" fill="#dcf6e3"/>',
  video: '<rect x="1" y="2.5" width="14" height="11" rx="1.5" fill="#8a5cc9"/><path d="M6.3 5.2v5.6L11.2 8z" fill="#f0e6ff"/>',
  deck: '<rect x="1" y="1.8" width="14" height="9.6" rx="1.2" fill="#e0812c"/><rect x="3" y="4.1" width="6" height="1.3" fill="#fff1e2"/><rect x="3" y="6.8" width="9" height="1.3" fill="#fff1e2"/><path d="M7.3 11.4h1.4l1.6 3.2H8.8L8 13.1l-.8 1.5H5.7z" fill="#e0812c"/>',
  audio: '<path d="M1.8 6h2.7L8 3v10l-3.5-3H1.8z" fill="#30b3a6"/><path d="M10.2 5.3a3.8 3.8 0 0 1 0 5.4M12 3.5a6.3 6.3 0 0 1 0 9" stroke="#30b3a6" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  custom: '<rect x="1.5" y="1.5" width="6" height="6" rx="1.2" fill="#9aa7b5"/><rect x="8.5" y="1.5" width="6" height="6" rx="1.2" fill="#6f7d8c"/><rect x="1.5" y="8.5" width="6" height="6" rx="1.2" fill="#6f7d8c"/><rect x="8.5" y="8.5" width="6" height="6" rx="1.2" fill="#9aa7b5"/>',
};
function ico(name) {
  const s = Object.assign(document.createElement('span'), { className: 'ico' });
  s.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] || ICONS.custom}</svg>`;
  return s;
}
// Иконка пункта плейлиста по его виду (песня, Библия, фото, видео…)
function itemIcon(item) {
  const k = item.kind;
  if (k === 'media') return ico(item.slides.some((s) => s.k === 'video' || s.k === 'live') ? 'video' : 'image');
  return ico(ICONS[k] && k !== 'lib' && k !== 'pl' ? k : 'custom');
}

/* ----- Левая колонка: плейлисты и библиотеки ----- */

// Свернуть/развернуть панель слева в цветную точку (запоминается): 'sideFold' — списки, 'contentFold' — содержание
function toggleFold(key) {
  settings[key] = !settings[key];
  saveSettings();
  renderSide();
}

function renderSide() {
  // Перерисовка не сбрасывает прокрутку списка (выбрали нижний плейлист — список не прыгает наверх)
  const sideScroll = $('sideBox').scrollTop;
  const isCur = (kind, x) => listsTab() && !!lib.view && lib.view.kind === kind && lib.view.id === x.id;
  const row = (kind, x, count) => {
    const b = Object.assign(document.createElement('button'), { className: 'svc-row' + (isCur(kind, x) ? ' cur' : ''), draggable: true });
    b.dataset.view = kind + ':' + x.id; // сюда бросают файлы из медиапула (poolDrop)
    b.append(ico(kind), document.createTextNode(x.name), Object.assign(document.createElement('span'), { className: 'cnt', textContent: count }));
    // Общая библиотека (profiles.js): правки видны в других профилях, где она подключена
    if (x.shared) { b.querySelector('.cnt').before(Object.assign(document.createElement('span'), { className: 'shared-mark', textContent: '⇄' })); b.title = 'Общая библиотека: правки видны во всех профилях, где она подключена (Настройки → Профили)'; }
    b.addEventListener('click', () => setView(kind, x.id));
    b.addEventListener('dblclick', () => renameView(kind, x.id));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); viewMenu(e, kind, x); });
    // Порядок: строку тянут выше или ниже внутри своего списка (библиотеки к библиотекам, плейлисты к плейлистам)
    b.addEventListener('dragstart', (e) => {
      viewDrag = { kind, id: x.id };
      e.dataTransfer.setData('application/x-cp-view', x.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    b.addEventListener('dragend', () => { viewDrag = null; document.querySelectorAll('.svc-row.before, .svc-row.after').forEach((r) => r.classList.remove('before', 'after')); });
    b.addEventListener('dragover', (e) => {
      if (!viewDrag || !e.dataTransfer.types.includes('application/x-cp-view')) return;
      e.stopPropagation();
      if (viewDrag.kind !== kind || viewDrag.id === x.id) return;
      e.preventDefault();
      const after = e.clientY > b.getBoundingClientRect().top + b.offsetHeight / 2;
      b.classList.toggle('after', after);
      b.classList.toggle('before', !after);
    });
    b.addEventListener('dragleave', () => b.classList.remove('before', 'after'));
    b.addEventListener('drop', (e) => {
      if (!viewDrag || !e.dataTransfer.types.includes('application/x-cp-view')) return;
      e.preventDefault();
      e.stopPropagation();
      const after = b.classList.contains('after');
      b.classList.remove('before', 'after');
      if (viewDrag.kind === kind) moveView(kind, viewDrag.id, x.id, after);
      viewDrag = null;
    }, true);
    // Сюда можно перетащить презентацию или слайды из ленты
    const accepts = (e) => e.dataTransfer.types.includes('application/x-cp-item') || e.dataTransfer.types.includes('application/x-cp-slides') || isListDrag(e) || isPoolDrag(e);
    b.addEventListener('dragover', (e) => { if (accepts(e)) { e.preventDefault(); e.stopPropagation(); b.classList.add('drop'); } });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', (e) => {
      b.classList.remove('drop');
      if (isPoolDrag(e)) return; // файл из медиапула добавит общий обработчик (poolDrop) — в этот список
      // Стихи из «Библии» или источник из медиапула — новой презентацией в конец этого списка
      if (isListDrag(e)) { e.preventDefault(); e.stopPropagation(); dropList(e, kind, x, null); return; }
      let ids = draggedItemIds(e);
      const sl = e.dataTransfer.getData('application/x-cp-slides');
      if (sl && !ids.length) {
        // Слайды на библиотеку — новой презентацией из их копий; в плейлисте новое не создаётся
        if (kind === 'pl') { e.preventDefault(); e.stopPropagation(); showNotice(PL_ONLY_DRAG, true); return; }
        const slides = draggedSlides(sl);
        if (!slides.length) return;
        const p = { id: newId(), type: 'pres', name: 'Слайды', slides: Slides.copy(slides) };
        p.kind = Slides.presKind(p);
        lib.items[p.id] = p;
        ids = [p.id];
      }
      if (!ids.length) return;
      e.preventDefault();
      e.stopPropagation();
      putItems(kind, x, ids, null);
    });
    return b;
  };
  $('plList').replaceChildren(...lib.playlists.map((p) => row('pl', p, p.entries.length)));
  $('libList').replaceChildren(...lib.libraries.map((l) => row('lib', l, l.items.length)));
  renderContent();
  // Свёрнутые панели — точками в ряд: синяя «Библиотеки» слева, красная «Содержание» справа
  const v = listsTab() ? findView() : null;
  const sideFold = !!settings.sideFold;
  const contFold = !!settings.contentFold && !!v;
  $('sideBox').hidden = sideFold;
  if (contFold) $('contentBox').hidden = true;
  $('tileSide').hidden = !sideFold;
  $('tileContent').hidden = !contFold;
  $('sideTiles').hidden = !sideFold && !contFold;
  const col = $('sideBox').closest('.svc-col');
  col.classList.toggle('content-folded', contFold || !v);
  // Обе свёрнуты (или «Содержания» нет) — колонка сужается до полоски с точками, освободившееся место — слайдам и «Предпросмотру»
  const rail = sideFold && (contFold || !v);
  col.classList.toggle('rail', rail);
  document.body.classList.toggle('side-folded', rail);
  // Колонка спрятана — точки в начале верхней строки (в «Библии» — слева от переводов), иначе — наверху колонки
  const slot = !rail ? col : tab === 'bible' ? $('bibleDots') : $('svcDots');
  if ($('sideTiles').parentNode !== slot) slot.prepend($('sideTiles'));
  // Подписи у точек — только во всплывающей подсказке
  const open = v ? v.name : '';
  $('tileSide').title = 'Развернуть плейлисты и библиотеки' + (open ? ` (открыто: ${open})` : '');
  $('tileContent').title = 'Развернуть содержание' + (v ? ` (${v.name}: ${viewEntries().length} шт.)` : '');
  keepSideScroll(sideScroll);
  updatePlaylistLive();
}

// Вернуть прокрутку списка слева; панель стала ниже — выбранная строка остаётся видна
function keepSideScroll(top) {
  const box = $('sideBox');
  if (box.hidden) return;
  box.scrollTop = top;
  const cur = box.querySelector('.svc-row.cur');
  if (!cur) return;
  const r = cur.getBoundingClientRect(), br = box.getBoundingClientRect();
  if (r.bottom > br.bottom) box.scrollTop += r.bottom - br.bottom + 4;
  else if (r.top < br.top) box.scrollTop -= br.top - r.top + 4;
}

// Галочки «выполнено» (v.done — ключи пунктов) и включение режима задач (v.todo)
function toggleDone(v, key) {
  const done = v.done || [];
  v.done = done.includes(key) ? done.filter((k) => k !== key) : done.concat([key]);
  saveLib();
  renderContent();
}
function contentMenu(e) {
  const v = findView();
  if (!v) return;
  const set = (fn) => () => { fn(); saveLib(); renderContent(); };
  showMenu(e, [
    { label: (v.todo ? '✓ ' : '') + 'Режим задач (галочки)', fn: set(() => { v.todo = !v.todo; }) },
    { label: 'Снять все галочки', disabled: !v.todo || !(v.done || []).length, fn: set(() => { v.done = []; }) },
  ]);
}

// Отдельная панель снизу слева: содержание открытого плейлиста или библиотеки
function renderContent() {
  const v = listsTab() ? findView() : null;
  $('contentBox').hidden = !v;
  if (!v) return;
  const kind = lib.view.kind;
  $('contentTitle').textContent = (kind === 'pl' ? 'Плейлист: ' : 'Библиотека: ') + v.name;
  const entries = viewEntries();
  // Перерисовка не сбрасывает прокрутку «Содержания» (бросили файл в список — он не прыгает наверх)
  const box = $('contentBox'), keepTop = box.dataset.view === viewKey() ? box.scrollTop : 0;
  box.dataset.view = viewKey();
  if (!entries.length) {
    const empty = Object.assign(document.createElement('div'), { className: 'svc-empty' });
    empty.append(Object.assign(document.createElement('img'), { src: 'brand/icon.svg', alt: '', draggable: false }), document.createTextNode('Нет содержимого'));
    $('contentList').replaceChildren(empty);
    return;
  }
  const make = (x) => {
    const { key, item } = x;
    const b = Object.assign(document.createElement('button'), { className: 'svc-sub', title: `${item.name} — ${Slides.PRES_NAMES[item.kind] || 'Презентация'}\nЩелчок или Enter — открыть в ленте`, draggable: true });
    b.dataset.key = key;
    markEl(b, item);
    // Режим задач: вместо номера — квадратик, щелчок ставит/снимает галочку
    if (v.todo) {
      const done = (v.done || []).includes(key);
      b.classList.toggle('done', done);
      const chk = Object.assign(document.createElement('span'), { className: 'chk', textContent: '✓', title: done ? 'Снять галочку' : 'Отметить выполненным' });
      chk.addEventListener('click', (e) => { e.stopPropagation(); toggleDone(v, key); });
      b.append(chk);
    }
    b.append(itemIcon(item), Object.assign(document.createElement('span'), { className: 't', textContent: item.name }), noteBtn(item), layerBtn(x, 'span'));
    if (typeof mcItemBadge === 'function') mcItemBadge(b, x);
    b.addEventListener('click', (e) => contentClick(e, key));
    // Двойной щелчок или Enter — открыть в ленте (в «Библии» — с переходом на «Экран»)
    const open = () => { if (tab === 'bible') setTab('service'); openEntry(key); };
    b.addEventListener('dblclick', (e) => { if (!e.ctrlKey && !e.shiftKey && !e.metaKey) open(); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); open(); } });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); presMenu(e, key, item, kind === 'pl'); });
    // Перетащить на другой плейлист — добавить (выделенные — все сразу); внутри плейлиста — поменять порядок
    b.addEventListener('dragstart', (e) => itemDragStart(e, key, item, viewKey(), kind === 'pl'));
    // В плейлисте пункт можно перетащить на другое место; стихи из «Библии» и пункты из другого списка, брошенные на пункт,
    // встают перед ним; слайды — в конец этой презентации (копией)
    const vk = viewKey();
    b.addEventListener('dragover', (e) => {
      if ((kind === 'pl' && isOwnEntryDrag(e, vk)) || isListDrag(e) || isForeignItemDrag(e, vk) || isSlidesDrag(e)) { e.preventDefault(); e.stopPropagation(); b.classList.add('drop'); }
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', (e) => {
      b.classList.remove('drop');
      $('contentBox').classList.remove('drop');
      if (isListDrag(e)) { e.preventDefault(); e.stopPropagation(); dropList(e, kind, v, key); return; }
      if (isSlidesDrag(e)) { e.preventDefault(); e.stopPropagation(); dropSlides(e.dataTransfer.getData('application/x-cp-slides'), item, null); return; }
      if (isForeignItemDrag(e, vk)) { e.preventDefault(); e.stopPropagation(); putItems(kind, v, draggedItemIds(e), key); return; }
      const from = kind === 'pl' && e.dataTransfer.getData('application/x-cp-entry');
      if (!from) return;
      e.preventDefault();
      e.stopPropagation();
      reorderEntry(draggedEntryKeys(e), key);
    });
    return b;
  };
  contentFill(entries, make, keepTop);
}

/* «Содержание» большой библиотеки (тысячи песен): на странице только видимые строки и запас вокруг,
   остальные дорисовываются при прокрутке. Тысячи кнопок замедляли всё окно: любая правка перестраивала
   список ~0,5 с, а смена слайда перебирала все строки. Маленькие списки рисуются целиком, как раньше */
const VIRT_MIN = 150;   // с какого числа пунктов рисовать только видимые
const VIRT_PAD = 12;    // строк запаса сверху и снизу
let contentRows = null; // { entries, make, rowH, from, to }

function contentFill(entries, make, keepTop) {
  const list = $('contentList'), box = $('contentBox');
  if (entries.length < VIRT_MIN) {
    contentRows = null;
    list.style.paddingTop = list.style.paddingBottom = '';
    list.replaceChildren(...entries.map(make));
    box.scrollTop = keepTop;
    requestAnimationFrame(() => { box.scrollTop = keepTop; });
    return;
  }
  contentRows = { entries, make, rowH: (contentRows && contentRows.rowH) || 0, from: -1, to: -1 };
  // Высота строки (с промежутком) — по двум пробным строкам; одна на все: строки «Содержания» одинаковые
  if (!contentRows.rowH && box.offsetParent) {
    const a = make(entries[0]), b = make(entries[1]);
    list.style.paddingTop = list.style.paddingBottom = '';
    list.replaceChildren(a, b);
    contentRows.rowH = b.offsetTop - a.offsetTop || a.offsetHeight || 30;
  }
  if (!contentRows.rowH) contentRows.rowH = 30; // панель скрыта — уточним, когда покажется
  list.style.paddingBottom = entries.length * contentRows.rowH + 'px'; // сначала высота — потом прокрутка встаёт куда надо
  list.replaceChildren();
  box.scrollTop = keepTop;
  contentPaint(true);
  requestAnimationFrame(() => { if (Math.abs(box.scrollTop - keepTop) > 1) { box.scrollTop = keepTop; contentPaint(); } });
}

// Нарисовать строки, попавшие в окно «Содержания» (и запас вокруг)
function contentPaint(force) {
  const r = contentRows;
  if (!r) return;
  const list = $('contentList'), box = $('contentBox');
  if (box.hidden) return;
  const n = r.entries.length, h = r.rowH;
  const top = box.scrollTop - list.offsetTop;
  const from = Math.max(0, Math.floor(top / h) - VIRT_PAD);
  const to = Math.min(n, Math.ceil((top + box.clientHeight) / h) + VIRT_PAD);
  if (!force && from === r.from && to === r.to) return;
  // Строка под мышью при перетаскивании или в фокусе — не пересоздаём (иначе пропадёт перетаскивание и Tab)
  const keep = new Map();
  for (const el of list.children) keep.set(el.dataset.key, el);
  r.from = from;
  r.to = to;
  const rows = r.entries.slice(from, to).map((x) => (!force && keep.get(x.key)) || r.make(x));
  list.style.paddingTop = from * h + 'px';
  list.style.paddingBottom = (n - to) * h + 'px';
  list.replaceChildren(...rows);
  paintSubs();
}
$('contentBox').addEventListener('scroll', () => { if (contentRows) contentPaint(); }, { passive: true });
new ResizeObserver(() => {
  if (!contentRows) return;
  // Панель показали или поменялся масштаб — перемерить строку
  const a = $('contentList').querySelector('.svc-sub');
  if (a && a.nextElementSibling) { const h = a.nextElementSibling.offsetTop - a.offsetTop; if (h > 0 && h !== contentRows.rowH) { contentRows.rowH = h; return contentPaint(true); } }
  contentPaint();
}).observe($('contentBox'));

// Строка пункта в «Содержании»: в большом списке её может не быть на странице — сначала прокрутить к ней
function contentRowEl(key) {
  const q = () => document.querySelector(`#contentList .svc-sub[data-key="${CSS.escape(key)}"]`);
  let el = q();
  if (!el && contentRows) {
    const i = contentRows.entries.findIndex((x) => x.key === key);
    if (i < 0) return null;
    const box = $('contentBox');
    box.scrollTop = $('contentList').offsetTop + i * contentRows.rowH - box.clientHeight / 2;
    contentPaint();
    el = q();
  }
  return el;
}

/* ----- Выделение пунктов «Содержания»: Ctrl+щелчок — по одному, Shift+щелчок — диапазон, Ctrl+A — все ----- */

let itemAnchor = null; // от какого пункта считать диапазон Shift+щелчка

// Ctrl/Shift+щелчок по пункту (в «Содержании» или по заголовку в ленте); true — выделение изменено
function pickItem(e, key) {
  selFocus = 'items';
  if (e.ctrlKey || e.metaKey) {
    selItems = isItemSelected(key) ? selItems.filter((k) => k !== key) : selItems.concat([key]);
    itemAnchor = key;
  } else if (e.shiftKey && (itemAnchor || selItems.length)) {
    const all = viewEntries().map((x) => x.key);
    const a = all.indexOf(itemAnchor || selItems[selItems.length - 1]);
    const b = all.indexOf(key);
    selItems = a >= 0 && b >= 0 ? all.slice(Math.min(a, b), Math.max(a, b) + 1) : [key];
  } else return false;
  sel = [];
  updatePlaylistLive();
  return true;
}

function contentClick(e, key) {
  selFocus = 'items';
  if (pickItem(e, key)) return;
  itemAnchor = key;
  selItems = [key];
  // В «Библии» щелчок только выделяет (лента «Экрана» не видна)
  if (tab === 'bible') { updatePlaylistLive(); return; }
  // Один щелчок — открыть в ленте (уже в ленте — прокрутить к нему)
  openEntry(key);
}

function selectAllItems() {
  selFocus = 'items';
  selItems = viewEntries().map((x) => x.key);
  sel = [];
  updatePlaylistLive();
  flashStatus(`Выделено пунктов: ${selItems.length}`);
}

// Выделенные пункты (презентации) открытого плейлиста или библиотеки, по порядку
const selectedItems = () => viewEntries().filter((x) => isItemSelected(x.key));

// Поменять порядок в плейлисте: запись from (или несколько — по порядку) встаёт на место записи to
function reorderEntry(from, to, view = lib.view) {
  itemDrag = null;
  const v = findView(view);
  const keys = new Set(Array.isArray(from) ? from : [from]);
  const list = v.entries;
  const a = list.findIndex((x) => keys.has(x.eid));
  const b = list.findIndex((x) => x.eid === to);
  if (a < 0 || b < 0 || keys.has(to)) return updatePlaylistLive();
  const moved = list.filter((x) => keys.has(x.eid));
  const rest = list.filter((x) => !keys.has(x.eid));
  // Тянут вниз — встают после to, вверх — перед ним (как раньше для одной записи)
  rest.splice(rest.findIndex((x) => x.eid === to) + (a < b ? 1 : 0), 0, ...moved);
  v.entries = rest;
  saveLib();
  renderService();
}

/* ----- Перетаскивание пунктов: выделенные в «Содержании» тянутся все сразу, по порядку списка ----- */

let itemDrag = null; // { from: ключ списка, ids: [id презентаций], keys: [ключи пунктов] }

function itemDragStart(e, key, item, vk, isPl) {
  const many = vk === viewKey() && isItemSelected(key) && selItems.length > 1;
  const list = many ? selectedItems() : [{ key, item }];
  itemDrag = { from: vk, ids: list.map((x) => x.item.id), keys: list.map((x) => x.key) };
  e.dataTransfer.setData('application/x-cp-item', item.id);
  if (isPl) e.dataTransfer.setData('application/x-cp-entry', key);
  e.dataTransfer.effectAllowed = 'copyMove';
  if (many) flashStatus(`Перетаскивается пунктов: ${list.length}`);
}
const isItemDrag = (e) => e.dataTransfer.types.includes('application/x-cp-item');
// Пункт тянут из другого списка (не переставляют внутри своего)
const isForeignItemDrag = (e, vk) => isItemDrag(e) && (itemDrag ? itemDrag.from !== vk : !e.dataTransfer.types.includes('application/x-cp-entry'));
const isOwnEntryDrag = (e, vk) => e.dataTransfer.types.includes('application/x-cp-entry') && (!itemDrag || itemDrag.from === vk);
const isSlidesDrag = (e) => e.dataTransfer.types.includes('application/x-cp-slides');
// id перетаскиваемых презентаций (все выделенные, если тянули одну из них)
function draggedItemIds(e) {
  const first = e.dataTransfer.getData('application/x-cp-item');
  if (!first) return [];
  const ids = itemDrag && itemDrag.ids.includes(first) ? itemDrag.ids : [first];
  return ids.filter((id) => lib.items[id]);
}
function draggedEntryKeys(e) {
  const first = e.dataTransfer.getData('application/x-cp-entry');
  return itemDrag && itemDrag.keys.includes(first) ? itemDrag.keys : [first];
}
// Поставить несколько презентаций в список (перед beforeKey или в конец); в библиотеке — без повторов
function putItems(kind, x, ids, beforeKey) {
  itemDrag = null;
  const add = kind === 'pl' ? ids : ids.filter((id, i) => !x.items.includes(id) && ids.indexOf(id) === i);
  if (!add.length) { flashStatus(`Уже есть в «${x.name}»`); return 0; }
  for (const id of add) putItem(kind, x, id, beforeKey);
  saveLib();
  renderService();
  flashStatus(add.length > 1 ? `${add.length} шт. → «${x.name}»` : `«${lib.items[add[0]].name}» → «${x.name}»`);
  return add.length;
}

/* ----- Лента: презентации по порядку, у каждой её слайды ----- */

function renderFeed() {
  const feed = $('svcFeed');
  // Рабочий список удалили (или его ещё нет) — в ленту список, открытый слева
  if (!findView(work)) { work = lib.view ? { ...lib.view } : null; openKey = null; }
  const entries = workEntries();
  // «Одной лентой» выключено — в ленте только открытый пункт
  const single = !feedAll();
  if (single && entries.length && !entries.some((x) => x.key === openKey)) {
    // Сначала то, что на экране, потом выделенное, иначе первый пункт
    const want = [plShown && plShown.view === workKey() && plShown.key, workIsView() && selItems[0]].find((k) => k && entries.some((x) => x.key === k));
    // В библиотеке без выбора ничего не открываем — ждём щелчка в «Содержании»
    openKey = want || (work.kind === 'pl' ? entries[0].key : null);
  }
  const keepScroll = feed.dataset.view === workKey() && (!single || feed.dataset.open === openKey) ? feed.scrollTop : 0;
  feed.dataset.open = single ? openKey || '' : '';
  feed.dataset.view = workKey();
  if (thumbIO) thumbIO.disconnect(); // миниатюры прежней ленты больше не ждут показа
  feed.replaceChildren();
  const v = findView(work);
  const isPl = !!v && work.kind === 'pl';
  $('svcKind').textContent = ''; // сверху — только название плейлиста/библиотеки, без «Плейлист»/«Библиотека»
  $('svcName').title = !v ? '' : isPl ? 'Плейлист' : 'Библиотека';
  $('svcName').textContent = v ? v.name : 'Создайте плейлист или библиотеку';
  $('viewTitle').hidden = !listsTab();
  if (!entries.length) {
    feed.append(Object.assign(document.createElement('div'), {
      className: 'svc-empty',
      textContent: !v ? 'Нажмите «＋» слева, чтобы создать плейлист или библиотеку.'
        : (isPl ? 'Плейлист пуст. ' : 'Библиотека пуста. ') + 'Добавьте песню, свои слайды или файлы, вставьте скопированные слайды (Ctrl+V) или перетащите файлы сюда.',
    }));
    return;
  }
  if (single && !openKey) {
    feed.append(Object.assign(document.createElement('div'), { className: 'svc-empty', textContent: 'Выберите песню или презентацию в «Содержании» — она откроется здесь.' }));
    return;
  }
  entries.forEach((x) => {
    const { key, item } = x;
    if (single && key !== openKey) return;
    const box = Object.assign(document.createElement('div'), { className: 'svc-item' });
    box.dataset.key = key;
    markEl(box, item);
    const head = Object.assign(document.createElement('div'), { className: 'svc-ihead', draggable: true, title: 'Правая кнопка — меню' });
    head.append(
      itemIcon(item),
      Object.assign(document.createElement('span'), { className: 'kind', textContent: Slides.PRES_NAMES[item.kind] || 'Презентация' }),
      Object.assign(document.createElement('span'), { className: 'iname', textContent: item.name }),
      noteBtn(item),
      Object.assign(document.createElement('span'), { className: 'cnt', textContent: item.slides.length > 1 ? `${item.slides.length} сл.` : '' }),
    );
    if (item.kind === 'bible') head.append(brefCtl(item)); // место, перевод и ‹ › — расширить на стих
    const btn = (text, title, fn) => {
      const b = Object.assign(document.createElement('button'), { textContent: text, title });
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      head.append(b);
      return b;
    };
    if (item.song || (item.slides.length && item.slides.every((s) => s.k === 'text'))) btn('Текст', 'Текст песни, разметка частей и аранжировки', () => openSongDialog(item));
    const arrPick = songArrPick(item);
    if (arrPick) head.append(arrPick);
    if (item.slides.some((s) => ['text', 'bible', 'custom'].includes(s.k))) btn('✎', 'Изменить слайды в редакторе тем', () => openSlideLook(item));
    const tb = btn('', 'Тема', () => openThemePicker({ kind: 'item', item, name: item.name }));
    tb.dataset.icon = 'theme';
    tb.classList.add('icon-only');
    Icons.apply(head);
    head.append(layerBtn(x)); // слой вывода этого пункта
    if (typeof mcItemBadge === 'function') mcItemBadge(head, x);
    // Слайды переключаются сами (item.auto) — кнопка-подпись, щелчок — настройки
    if (item.auto && item.auto.sec > 0) btn(`${fmtSec(item.auto.sec)}${item.auto.loop ? ' ↻' : ''}`, `Автосмена: слайды переключаются сами каждые ${fmtSec(item.auto.sec)}${item.auto.loop ? ', по кругу' : ''} — щелчок, чтобы настроить`, () => openFx('item', [item])).classList.add('auto-chip');
    if (!isPl) {
      const pl = curPl();
      if (pl) btn('＋ в плейлист', `Добавить в плейлист «${pl.name}»`, () => { pl.entries.push({ eid: newId(), item: item.id }); saveLib(); renderSide(); });
    }
    head.addEventListener('click', (e) => {
      browseWork();
      if (pickItem(e, key)) return;
      selItems = [key];
      selFocus = 'items';
      itemAnchor = key;
      sel = [];
      updatePlaylistLive();
    });
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); browseWork(); presMenu(e, key, item, isPl); });
    // Заголовок: на плейлист слева — добавить; внутри плейлиста — поменять порядок
    head.addEventListener('dragstart', (e) => itemDragStart(e, key, item, workKey(), isPl));
    // Слайды, брошенные на заголовок, встают в конец презентации
    head.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-cp-slides')) { e.preventDefault(); e.stopPropagation(); head.classList.add('drop'); } });
    head.addEventListener('dragleave', () => head.classList.remove('drop'));
    head.addEventListener('drop', (e) => {
      head.classList.remove('drop');
      const data = e.dataTransfer.getData('application/x-cp-slides');
      if (!data) return;
      e.preventDefault();
      e.stopPropagation();
      dropSlides(data, item, null);
    });
    const grid = Object.assign(document.createElement('div'), { className: 'svc-slides' });
    // Стихи, источник или пункты из другого списка, брошенные на пункт ленты, встают перед ним
    const wk = workKey();
    box.addEventListener('dragover', (e) => { if (isListDrag(e) || isForeignItemDrag(e, wk)) { e.preventDefault(); e.stopPropagation(); box.classList.add('drop-item'); } });
    if (!isPl) box.addEventListener('dragleave', () => box.classList.remove('drop-item'));
    box.addEventListener('drop', (e) => {
      if (isForeignItemDrag(e, wk)) {
        box.classList.remove('drop-item');
        e.preventDefault();
        e.stopPropagation();
        putItems(work.kind, findView(work), draggedItemIds(e), key);
        return;
      }
      if (!isListDrag(e)) return;
      box.classList.remove('drop-item');
      e.preventDefault();
      e.stopPropagation();
      dropList(e, work.kind, findView(work), key);
    });
    // Слайды, брошенные на свободное место презентации (между слайдами, под ними), встают в её конец
    box.addEventListener('dragover', (e) => { if (isSlidesDrag(e)) { e.preventDefault(); e.stopPropagation(); box.classList.add('drop-slides'); } });
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('drop-slides'); });
    box.addEventListener('drop', (e) => {
      box.classList.remove('drop-slides');
      if (!isSlidesDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dropSlides(e.dataTransfer.getData('application/x-cp-slides'), item, null);
    });
    // Правая кнопка по свободному месту презентации — её меню («Вставить слайды в конец» и др.)
    grid.addEventListener('contextmenu', (e) => { if (e.target.closest('.sl')) return; e.preventDefault(); browseWork(); presMenu(e, key, item, isPl); });
    if (isPl) {
      box.addEventListener('dragover', (e) => { if (isOwnEntryDrag(e, wk)) { e.preventDefault(); e.stopPropagation(); box.classList.add('drop-item'); } });
      box.addEventListener('dragleave', () => box.classList.remove('drop-item'));
      box.addEventListener('drop', (e) => {
        box.classList.remove('drop-item');
        const from = e.dataTransfer.getData('application/x-cp-entry');
        if (!from || !isOwnEntryDrag(e, wk)) return;
        e.preventDefault();
        e.stopPropagation();
        reorderEntry(draggedEntryKeys(e), key, work);
      });
    }

    if (!item.slides.length) grid.append(Object.assign(document.createElement('div'), { className: 'svc-noslides', textContent: 'Слайдов нет — вставьте (Ctrl+V) или перетащите сюда' }));
    item.slides.forEach((slide) => {
      const el = slideThumb(item, slide, true);
      el.dataset.key = key;
      el.dataset.sid = slide.id;
      el.draggable = true;
      el.title = Slides.SLIDE_NAMES[slide.k] + (slide.k === 'audio' ? ' — щелчок включает музыку' : '');
      if (typeof mcSlideBadge === 'function') mcSlideBadge(el, item, slide); // привязанные макросы
      el.addEventListener('click', (e) => slideClick(e, key, slide.id));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); slideMenu(e, key, slide.id); });
      el.addEventListener('dragstart', (e) => {
        // Выделенные слайды (и из других презентаций ленты) — все, в порядке ленты
        const list = isSelected(key, slide.id) ? flatSlides().filter((x) => isSelected(x.key, x.sid)) : [{ key, sid: slide.id }];
        e.dataTransfer.setData('application/x-cp-slides', JSON.stringify({ view: workKey(), key, sids: list.filter((x) => x.key === key).map((x) => x.sid), list }));
        if (list.length > 1) flashStatus(`Перетаскивается слайдов: ${list.length}`);
        e.dataTransfer.effectAllowed = 'copyMove';
      });
      el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-cp-slides')) { e.preventDefault(); e.stopPropagation(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (e) => {
        el.classList.remove('drop');
        const data = e.dataTransfer.getData('application/x-cp-slides');
        if (!data) return;
        e.preventDefault();
        e.stopPropagation();
        dropSlides(data, item, slide.id);
      });
      grid.append(el);
    });
    box.append(head, grid);
    feed.append(box);
  });
  feed.scrollTop = keepScroll;
  fitThumbs(feed);
  updatePlaylistLive();
}

// Подогнать размер текста в миниатюрах (после того как они попали на страницу)
function fitThumbs(root) {
  requestAnimationFrame(() => root.querySelectorAll('.sl .layer.text').forEach((l) => Scene.fitText(l)));
}

function renderService() {
  if (!lib) return;
  renderSide();
  renderFeed();
}

function updatePlaylistLive() {
  if (!lib) return;
  const on = plShown && plShown.view === workKey();      // лента — рабочий список
  const same = workIsView();
  const stale = !!on && plStale === plShown; // на экране — прежний вид этого слайда (сменили перевод)
  document.querySelectorAll('#svcFeed .sl').forEach((el) => {
    const isLive = !!on && el.dataset.key === plShown.key && el.dataset.sid === plShown.sid;
    el.classList.toggle('live', isLive);
    if (el.classList.toggle('stale', isLive && stale)) el.title = 'На экране — прежний перевод этого слайда. Щёлкните, чтобы показать новый';
    else if (el.title.startsWith('На экране — прежний')) el.title = Slides.SLIDE_NAMES.bible;
    el.classList.toggle('live-ov', Object.values(ovShown).some((o) => o.view === workKey() && o.key === el.dataset.key && o.sid === el.dataset.sid));
    el.classList.toggle('sel', isSelected(el.dataset.key, el.dataset.sid));
  });
  const picked = new Set(selItems);
  document.querySelectorAll('#svcFeed .svc-item').forEach((el) => {
    el.classList.toggle('live-item', !!on && el.dataset.key === plShown.key);
    el.classList.toggle('sel-item', same && picked.has(el.dataset.key));
  });
  paintSubs(picked);
}

// Подсветка строк «Содержания»: на экране, открыт в ленте, выделен
function paintSubs(picked = new Set(selItems)) {
  const onSide = plShown && plShown.view === viewKey();
  const same = workIsView();
  const all = feedAll();
  const many = picked.size > 1;
  document.querySelectorAll('.svc-sub').forEach((el) => {
    const k = el.dataset.key;
    el.classList.toggle('live', !!onSide && k === plShown.key);
    // Открыт в ленте (рабочий) — рамка; выделен для просмотра, но не открыт — подсветка выбора
    const open = same && (all ? picked.has(k) : k === openKey);
    el.classList.toggle('open', open);
    el.classList.toggle('picked', picked.has(k) && (many || tab === 'bible' || !open));
  });
}

// Щелчок по заголовку пункта в ленте — «Содержание» слева показывает рабочий список (меню и выделение — по нему)
function browseWork() {
  if (!work || workIsView() || !findView(work)) return;
  lib.view = { ...work };
  if (work.kind === 'pl') lib.lastPl = work.id;
  selItems = [];
  saveLib();
  renderSide();
}

/* ----- Выделение слайдов: щелчок, Ctrl+щелчок, Shift+щелчок ----- */

let sel = [];          // [{ key, sid }]
let selAnchor = null;  // { key, sid }
let selItems = [];     // выделенные блоки презентаций [key]
let selFocus = 'slides'; // с чем работают Delete и Ctrl+A: 'slides' — слайды ленты, 'items' — пункты «Содержания»
const isSelected = (key, sid) => sel.some((x) => x.key === key && x.sid === sid);
const isItemSelected = (key) => selItems.includes(key);

// Все слайды ленты подряд — стрелки идут по ним через границы презентаций
function flatSlides() {
  const out = [];
  for (const { key, item } of workEntries()) item.slides.forEach((s) => out.push({ key, sid: s.id }));
  return out;
}

function slideClick(e, key, sid) {
  selFocus = 'slides';
  if (e.ctrlKey || e.metaKey) {
    sel = isSelected(key, sid) ? sel.filter((x) => !(x.key === key && x.sid === sid)) : sel.concat([{ key, sid }]);
    selAnchor = { key, sid };
    updatePlaylistLive();
    return;
  }
  if (e.shiftKey && selAnchor) {
    const flat = flatSlides();
    const a = flat.findIndex((x) => x.key === selAnchor.key && x.sid === selAnchor.sid);
    const b = flat.findIndex((x) => x.key === key && x.sid === sid);
    if (a >= 0 && b >= 0) { sel = flat.slice(Math.min(a, b), Math.max(a, b) + 1); updatePlaylistLive(); return; }
  }
  sel = [{ key, sid }];
  selAnchor = { key, sid };
  // Слайд уже на экране — только выделить: без нового показа, перехода, анимаций и макросов слайда
  if (slideOnScreen(key, sid)) { keepShown(key, sid); return; }
  showSlide(key, sid);
}

// Этот слайд (из рабочего списка) сейчас на экране — ровно в том виде, в каком его покажет новый щелчок.
// Слайд правили, в его слое уже другое (Библия, другой пункт) — не на экране. Музыкальные слайды — всегда заново (кнопка музыки)
function slideOnScreen(key, sid, vk = workKey()) {
  const entry = entryByKey(key, keyView(vk));
  const slide = entry && entry.item.slides.find((s) => s.id === sid);
  if (!slide || slide.k === 'audio') return false;
  const ly = pickedLayer(entry);
  const shown = isOverlay(ly) ? ovShown[ly] : plShown;
  if (!shown || shown.view !== vk || shown.key !== key || shown.sid !== sid) return false;
  let content;
  try { content = contentOf(entry.item, slide); } catch { return false; }
  const id = ly && layerById(ly) ? ly : autoLayer(content);
  const on = layerOn[id];
  if (!on) return false;
  if (JSON.stringify(on.content) === JSON.stringify(content)) return true;
  // Отличается только название пункта (‹ › у «Библии» переименовывают пункт), а поля «Название» в шаблоне нет —
  // на экране то же самое: повторный щелчок не проигрывает переход заново
  const noTitle = (c) => JSON.stringify({ ...c, meta: { ...(c.meta || {}), title: '' } });
  if (noTitle(on.content) !== noTitle(content)) return false;
  const tpl = content.style && content.style.tpls ? Scene.pickTpl(content) : null;
  return !tpl || !(tpl.objs || []).some((o) => o && !o.hidden && o.bind === 'title');
}
// Повторный щелчок по слайду на экране: подсветка, прокрутка к нему; остановленную автосмену — снова запустить
function keepShown(key, sid, vk = workKey()) {
  updatePlaylistLive();
  const entry = entryByKey(key, keyView(vk));
  const slide = entry && entry.item.slides.find((s) => s.id === sid);
  if (slide && !autoT && entry.item.auto && entry.item.auto.sec > 0) autoArm(key, entry.item, slide, vk);
  const el = document.querySelector(`#svcFeed .sl[data-key="${key}"][data-sid="${sid}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

/* ----- Показ и листание ----- */

// vk — из какого списка (по умолчанию рабочий, лента); другой — показать заново то, что уже на экране
function showSlide(key, sid, vk = workKey()) {
  const entry = entryByKey(key, keyView(vk));
  if (!entry) return;
  const { item } = entry;
  const si = item.slides.findIndex((s) => s.id === sid);
  const slide = item.slides[si];
  if (!slide) return;
  // Пункт со слоем Overlay: показ поверх, выделение и лента основной презентации не меняются
  const ly = pickedLayer(entry);
  if (slide.k !== 'audio' && isOverlay(ly)) {
    present(() => contentOf(item, slide), item.name + (item.slides.length > 1 ? ` — ${slide.label || si + 1}` : ''), false, ly, ownTransition(item, slide));
    ovShown[ly] = { view: vk, key, sid };
    plLastOv = ly; // пробел и стрелки дальше листают этот пункт
    if (vk === workKey()) { sel = [{ key, sid }]; selAnchor = { key, sid }; selFocus = 'slides'; } // выделение — за показом
    updatePlaylistLive(); // триггеры слайдов макросов не трогаем (на Overlay срабатывает «Слой»)
    if (slide.k !== 'audio') plPreload(key, sid, vk);
    return;
  }
  plLastOv = '';
  const moved = !plShown || plShown.view !== vk || plShown.key !== key || plShown.sid !== sid;
  if (slide.k === 'audio') {
    // Музыкальный слайд: экран не меняется, включается музыка
    playAudioItem(slide);
    plShown = { view: vk, key, sid };
  } else {
    live = -1;
    bShown = null;
    const many = item.slides.length > 1;
    present(() => contentOf(item, slide), item.name + (many ? ` — ${slide.label || si + 1}` : ''), false, pickedLayer(entry), ownTransition(item, slide)); // слой, выбранный у пункта; свой переход
    plShown = { view: vk, key, sid };
  }
  // Выделение в ленте — всегда на показанном слайде: пробел, стрелки, автосмена, макросы, пульт, телефон.
  // Тот же слайд показали заново (правка темы и т. п.) — выделение не трогаем, оно может быть шире
  if (moved && vk === workKey()) {
    sel = [{ key, sid }];
    selAnchor = { key, sid };
    selFocus = 'slides';
  }
  if (slide.k !== 'audio') autoArm(key, item, slide, vk); // авто-переключение по таймеру (item.auto)
  // Листание дошло до следующего пункта — в режиме «один пункт» открыть его
  if (vk === workKey() && !feedAll() && key !== openKey) { openKey = key; renderFeed(); }
  updatePlaylistLive();
  if (typeof mcSlideShown === 'function') mcSlideShown(entry, slide, vk); // триггеры макросов (macros.js)
  if (typeof stSlideShown === 'function') stSlideShown(entry, slide); // свой сценический макет у слайда (stage.js)
  plScrollTo(key, sid);
  if (slide.k !== 'audio' && !isOverlay(ly)) plPreload(key, sid, vk);
}

// Прокрутить ленту к слайду перед ближайшей отрисовкой: вёрстка считается один раз вместе с новым слайдом,
// а не лишний раз сразу (быстрое листание — только к последнему)
let plScrollKey = null;
function plScrollTo(key, sid) {
  const was = plScrollKey;
  plScrollKey = { key, sid };
  if (was) return;
  requestAnimationFrame(() => {
    const k = plScrollKey;
    plScrollKey = null;
    const el = k && document.querySelector(`#svcFeed .sl[data-key="${k.key}"][data-sid="${k.sid}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  });
}

/* ----- Предзагрузка соседних слайдов: окна вывода и предпросмотр держат наготове медиа 2 следующих
   и 1 предыдущего слайда (видео — буфер и первый кадр, картинки — декодированы). Показ берёт готовое (Scene.preload). */
// Медиа слайда: файл (фото/видео), фон и видео/картинки шаблона темы
function slideMedia(item, s) {
  if (s.k === 'image' || s.k === 'video') return s.url ? [{ url: s.url, kind: s.k }] : [];
  if (!['text', 'bible', 'custom'].includes(s.k)) return [];
  let c;
  try { c = contentOf(item, s); } catch { return []; }
  const st = c.style || {};
  const out = [];
  const tpl = st.tpls ? Scene.pickTpl(c) : null;
  if (tpl) {
    if (tpl.bg && (tpl.bg.type === 'video' || tpl.bg.type === 'image') && tpl.bg.url) out.push({ url: tpl.bg.url, kind: tpl.bg.type });
    for (const o of tpl.objs || []) if (o && !o.hidden && (o.kind === 'video' || o.kind === 'image') && o.url) out.push({ url: o.url, kind: o.kind });
  } else if (st.bgUrl) out.push({ url: st.bgUrl, kind: st.bgVideo ? 'video' : 'image' });
  return out;
}
let preT = 0;
function plPreload(key, sid, vk) {
  clearTimeout(preT);
  // Чуть позже показа: переход начинается без помех; при быстром листании — только для последнего слайда
  preT = setTimeout(() => {
    if (vk !== workKey()) return;
    const flat = flatSlides();
    const i = flat.findIndex((x) => x.key === key && x.sid === sid);
    if (i < 0) return;
    const list = [];
    for (const j of [i + 1, i + 2, i - 1]) {
      const x = flat[j];
      const e = x && entryByKey(x.key, keyView(vk));
      const s = e && e.item.slides.find((y) => y.id === x.sid);
      if (s && !isOverlay(pickedLayer(e))) list.push(...slideMedia(e.item, s));
    }
    if (!list.length) return;
    window.api.layers({ cmd: 'preload', list });
    Scene.preload(list); // предпросмотр и «Программа» в этом окне
  }, 250);
}

// Пункт на слое поверх основного («Плашки», Overlay) показали последним — листаем его (раньше пробел шёл от основного слоя)
let plLastOv = '';
function plStep(d) {
  const flat = flatSlides();
  if (!flat.length) return;
  const from = plLastOv && ovShown[plLastOv] ? ovShown[plLastOv] : plShown;
  const cur = from && from.view === workKey() ? flat.findIndex((x) => x.key === from.key && x.sid === from.sid) : -1;
  const next = cur < 0 ? (d > 0 ? 0 : flat.length - 1) : Math.max(0, Math.min(flat.length - 1, cur + d));
  if (next === cur) return;
  sel = [flat[next]];
  selAnchor = flat[next];
  showSlide(flat[next].key, flat[next].sid);
}

function plJumpItem(d) {
  const entries = workEntries();
  const cur = plShown && plShown.view === workKey() ? entries.findIndex((x) => x.key === plShown.key) : -1;
  for (let i = cur + d; i >= 0 && i < entries.length; i += d) {
    if (entries[i].item.slides[0]) return showSlide(entries[i].key, entries[i].item.slides[0].id);
  }
}

/* ----- Авто-переключение слайдов по таймеру (объявления и т. п.) -----
   item.auto = { sec, loop } — через сколько секунд следующий слайд, по кругу ли; slide.autoSec — своё время слайда.
   Работает, пока на экране слайд этой презентации: показали другое или очистили — останавливается.
   Ручной показ слайда начинает отсчёт заново. В отмену попадает само (lib). */
let autoT = null; // { key, sid, vk, until, timer }
const fmtSec = (s) => (s >= 60 && s % 60 === 0 ? s / 60 + ' мин' : s + ' с');
function autoStop() {
  if (autoT) clearTimeout(autoT.timer);
  autoT = null;
  autoPaint();
}
function autoArm(key, item, slide, vk) {
  if (autoT) clearTimeout(autoT.timer);
  autoT = null;
  const a = item.auto;
  if (a && a.sec > 0 && item.slides.length > 1) {
    const sec = slide.autoSec > 0 ? slide.autoSec : a.sec;
    autoT = { key, sid: slide.id, vk, until: Date.now() + sec * 1000 };
    autoT.timer = setTimeout(autoFire, sec * 1000);
  }
  autoPaint();
}
const autoAlive = () => !!autoT && !!plShown && plShown.key === autoT.key && plShown.sid === autoT.sid && plShown.view === autoT.vk;
function autoFire() {
  if (!autoAlive()) { autoStop(); return; }
  const e = entryByKey(autoT.key, keyView(autoT.vk));
  if (!e || !e.item.auto || !(e.item.auto.sec > 0)) { autoStop(); return; }
  const list = e.item.slides;
  const i = list.findIndex((s) => s.id === autoT.sid);
  let j = i + 1;
  if (j >= list.length) {
    if (!e.item.auto.loop) { autoStop(); flashStatus(`«${e.item.name}»: последний слайд — авто-переключение закончилось`); return; }
    j = 0;
  }
  const next = list[j];
  if (autoT.vk === workKey()) { sel = [{ key: autoT.key, sid: next.id }]; selAnchor = sel[0]; }
  showSlide(autoT.key, next.id, autoT.vk);
}
// Кнопка в шапке «Предпросмотра»: сколько осталось; щелчок — остановить
function autoPaint() {
  const b = $('autoBadge');
  if (!b) return;
  if (autoT && !autoAlive()) { clearTimeout(autoT.timer); autoT = null; } // показали другое или очистили экран
  b.hidden = !autoT;
  if (autoT) b.textContent = 'Автосмена ' + Math.max(0, Math.ceil((autoT.until - Date.now()) / 1000)) + ' с';
}
setInterval(() => { if (autoT) autoPaint(); }, 250);
$('autoBadge').addEventListener('click', () => { autoStop(); flashStatus('Авто-переключение остановлено (щелчок по слайду — запустить снова)'); });

/* ----- Окно «Переход и авто-переключение»: для презентации (kind 'item') или слайдов (kind 'slides') ----- */
let fxFor = null; // { kind, list }
function openFx(kind, list) {
  if (!list || !list.length) return;
  fxFor = { kind, list };
  const o = list[0];
  const isItem = kind === 'item';
  $('fxTitle').textContent = isItem ? (list.length > 1 ? `Презентации (${list.length})` : `«${o.name}»`) : list.length > 1 ? `Слайды (${list.length})` : 'Слайд';
  transOptions($('fxType'), [['', isItem ? 'Общий (как в строке «Переход»)' : 'Как у презентации']]);
  $('fxType').value = o.trans && o.trans.type ? o.trans.type : '';
  $('fxMs').value = o.trans && o.trans.ms ? o.trans.ms : settings.transMs;
  $('fxMs').dataset.def = settings.transMs; // двойной щелчок — как в программе
  const a = isItem ? o.auto : null;
  $('fxAuto').checked = isItem ? !!(a && a.sec > 0) : o.autoSec > 0;
  $('fxSec').value = isItem ? (a && a.sec) || 10 : o.autoSec || 10;
  $('fxLoop').checked = isItem ? !a || a.loop !== false : false;
  $('fxAutoLbl').textContent = isItem ? 'Переключать слайды сами' : 'Своё время показа этого слайда';
  $('fxLoopRow').hidden = !isItem;
  $('fxHint').textContent = isItem
    ? 'Например, объявления: каждый слайд держится столько секунд, потом сам идёт следующий. Своё время у отдельного слайда — правой кнопкой по слайду → «Переход и время слайда…».'
    : 'Время работает, когда у презентации включено «Переключать слайды сами». Переход — как этот слайд появляется на экране.';
  fxSync();
  $('fxDialog').showModal();
}
function fxSync() {
  $('fxMsRow').hidden = !$('fxType').value || $('fxType').value === 'none';
  $('fxMsVal').textContent = (Number($('fxMs').value) / 1000).toFixed(1) + ' с';
  $('fxSecRow').hidden = !$('fxAuto').checked;
  $('fxLoopRow').classList.toggle('off', !$('fxAuto').checked);
}
['fxType', 'fxMs', 'fxAuto'].forEach((id) => $(id).addEventListener('input', fxSync));
$('fxAuto').addEventListener('change', fxSync);
$('fxDialog').addEventListener('close', () => {
  if ($('fxDialog').returnValue !== 'ok' || !fxFor) { fxFor = null; return; }
  const type = $('fxType').value;
  const ms = Math.max(100, Number($('fxMs').value) || settings.transMs);
  const sec = Math.max(1, Math.min(3600, Math.round(Number($('fxSec').value) || 10)));
  const on = $('fxAuto').checked;
  for (const o of fxFor.list) {
    if (type) o.trans = type === 'none' ? { type: 'none', ms: 0 } : { type, ms }; else delete o.trans;
    if (fxFor.kind === 'item') { if (on) o.auto = { sec, loop: $('fxLoop').checked }; else delete o.auto; }
    else if (on) o.autoSec = sec; else delete o.autoSec;
  }
  fxFor = null;
  saveLib();
  renderService();
  renderFeed();
  // Показан слайд из этой презентации — отсчёт по новым настройкам
  if (plShown) { const e = entryByKey(plShown.key, keyView(plShown.view)); const s = e && e.item.slides.find((x) => x.id === plShown.sid); if (e && s) autoArm(plShown.key, e.item, s, plShown.view); }
  flashStatus((on ? `Авто-переключение: ${fmtSec(sec)}` : 'Без авто-переключения') + (type ? ` · переход «${(Scene.TRANS.find(([v]) => v === type) || [, ''])[1]}»` : '') + ' · Ctrl+Z — вернуть');
});

// Музыкальный слайд: песня встаёт в быструю очередь (если её там нет) и играет
function playAudioItem(a) {
  // Эта песня уже в слое «Аудио» — не начинать сначала (как видео в «Медиа»); на паузе — продолжить
  const s = curSong();
  if (s && s.url === a.url && auState()) { if (audio.paused) musicToggle(); return; }
  let i = tracks.findIndex((t) => t.url === a.url);
  if (i < 0) {
    queueAdd([{ type: 'audio', name: a.name || 'Музыка', path: a.path, url: a.url }]);
    i = tracks.length - 1;
  }
  playTrack(i, tracks);
}

/* ----- Копировать, вырезать, вставить, дублировать, удалить ----- */

// Выделенные слайды, а если ничего не выделено — тот, что на экране
function selectedSlides() {
  const list = sel.length ? sel : plShown && plShown.view === workKey() ? [plShown] : [];
  const out = [];
  for (const { key, sid } of list) {
    const e = workEntry(key);
    const slide = e && e.item.slides.find((s) => s.id === sid);
    if (slide) out.push({ key, item: e.item, slide });
  }
  // В порядке ленты
  const flat = flatSlides();
  const pos = (x) => flat.findIndex((f) => f.key === x.key && f.sid === x.slide.id);
  return out.sort((a, b) => pos(a) - pos(b));
}

async function copySlides(slides) {
  if (!slides.length) return false;
  await window.api.clipSet({ slides: JSON.parse(JSON.stringify(slides)), text: Slides.toText(slides) });
  return true;
}

async function svcCopy(cut) {
  const chosen = selectedSlides();
  if (!(await copySlides(chosen.map((x) => x.slide)))) return;
  if (cut) removeSlides(chosen);
  flashStatus(cut ? `Вырезано слайдов: ${chosen.length}` : `Скопировано слайдов: ${chosen.length}`);
}

function removeSlides(chosen) {
  const items = new Set();
  for (const { item, slide } of chosen) {
    item.slides = item.slides.filter((s) => s !== slide);
    items.add(item);
  }
  items.forEach(touched);
  sel = [];
  renderService();
}

// Куда вставлять: после выделенного (или показанного) слайда; иначе — новая презентация в открытом списке
async function svcPaste(target) {
  const clip = await window.api.clipGet();
  let slides = clip.slides ? Slides.copy(clip.slides) : clip.text && clip.text.trim() ? Slides.parseText(clip.text) : [];
  if (!slides.length) { flashStatus('В буфере обмена нет слайдов или текста'); return; }
  let item;
  let after = null;
  if (target) ({ item, after } = target);
  // Выделена одна презентация (щелчок по шапке, по свободному месту в ленте или по пункту «Содержания») — в её конец
  else if (selFocus === 'items' && selItems.length === 1 && entryByKey(selItems[0])) item = entryByKey(selItems[0]).item;
  else {
    const last = selectedSlides().pop();
    if (last) { item = last.item; after = last.slide.id; }
  }
  if (!item) {
    if (!findView()) { showNotice('Сначала создайте плейлист или библиотеку', true); return; }
    if (plNoCreate()) return; // новая презентация — только в библиотеке
    item ={ id: newId(), type: 'pres', name: clip.slides ? 'Вставленные слайды' : 'Вставленный текст', slides: [] };
    addItems([item], false);
  }
  const at = after ? item.slides.findIndex((s) => s.id === after) + 1 : item.slides.length;
  item.slides.splice(at, 0, ...slides);
  touched(item);
  const key = (workEntries().find((x) => x.item === item) || {}).key;
  sel = key ? slides.map((s) => ({ key, sid: s.id })) : [];
  renderService();
  flashStatus(`Вставлено слайдов: ${slides.length}`);
}

function svcDuplicate() {
  const chosen = selectedSlides();
  if (!chosen.length) return;
  const newSel = [];
  // Копии встают сразу после последнего выделенного слайда своей презентации
  const byItem = new Map();
  for (const x of chosen) { if (!byItem.has(x.item)) byItem.set(x.item, []); byItem.get(x.item).push(x); }
  for (const [item, list] of byItem) {
    const copies = Slides.copy(list.map((x) => x.slide));
    const at = item.slides.indexOf(list[list.length - 1].slide) + 1;
    item.slides.splice(at, 0, ...copies);
    copies.forEach((s) => newSel.push({ key: list[0].key, sid: s.id }));
    touched(item);
  }
  sel = newSel;
  renderService();
}

// Без вопросов: всё можно вернуть Ctrl+Z
function svcDelete() {
  const chosen = selectedSlides();
  if (!chosen.length) return;
  removeSlides(chosen);
  flashStatus(`Удалено слайдов: ${chosen.length} · Ctrl+Z — вернуть`);
}

// Delete по выделенным пунктам «Содержания»: из плейлиста — убрать, из библиотеки — удалить
function deleteSelItems() {
  const v = findView();
  const keys = new Set(selectedItems().map((x) => x.key));
  if (!v || !keys.size) return false;
  const ids = [];
  if (lib.view.kind === 'pl') {
    v.entries = v.entries.filter((e) => { if (!keys.has(e.eid)) return true; ids.push(e.item); return false; });
  } else {
    v.items = v.items.filter((id) => { if (!keys.has(id)) return true; ids.push(id); return false; });
  }
  ids.forEach(dropIfUnused);
  selItems = [];
  sel = [];
  saveLib();
  renderService();
  flashStatus(`Удалено: ${keys.size} · Ctrl+Z — вернуть`);
  return true;
}

// Delete и Ctrl+A — к тому, что выделяли последним: пунктам «Содержания» или слайдам
function deleteSelected() {
  if (selFocus === 'items' && selItems.length) deleteSelItems();
  else svcDelete();
}
function selectAllSlides() {
  // Вся лента: в плейлисте одной лентой — все слайды, иначе — слайды открытого пункта
  sel = flatSlides().filter((x) => feedAll() || x.key === openKey);
  selFocus = 'slides';
  updatePlaylistLive();
  flashStatus(`Выделено слайдов: ${sel.length}`);
}

// Слайды, которые тянут мышью: [{ item, slide }] по порядку ленты (list — и из разных презентаций)
function draggedList(data) {
  try {
    const d = JSON.parse(data);
    const view = keyView(d.view);
    const list = Array.isArray(d.list) ? d.list : d.sids.map((sid) => ({ key: d.key, sid }));
    const out = [];
    for (const { key, sid } of list) {
      const e = entryByKey(key, view);
      const slide = e && e.item.slides.find((s) => s.id === sid);
      if (slide) out.push({ item: e.item, slide });
    }
    return out;
  } catch { return []; }
}
const draggedSlides = (data) => draggedList(data).map((x) => x.slide);

// Бросили слайды: внутри той же презентации — переставить, в другую — скопировать (исходные остаются на месте)
function dropSlides(data, target, beforeSid) {
  const list = draggedList(data);
  const slides = list.map((x) => x.slide);
  if (!slides.length) return;
  if (list.every((x) => x.item === target)) {
    if (slides.some((s) => s.id === beforeSid)) return;
    target.slides = target.slides.filter((s) => !slides.includes(s));
    const at = beforeSid ? target.slides.findIndex((s) => s.id === beforeSid) : target.slides.length;
    target.slides.splice(at < 0 ? target.slides.length : at, 0, ...slides);
  } else {
    const copies = Slides.copy(slides);
    const at = beforeSid ? target.slides.findIndex((s) => s.id === beforeSid) : target.slides.length;
    target.slides.splice(at < 0 ? target.slides.length : at, 0, ...copies);
    flashStatus(`Скопировано слайдов: ${copies.length} → «${target.name}» · Ctrl+Z — вернуть`);
  }
  touched(target);
  renderService();
}

// Короткое сообщение о действии. Островок (notify.js) — только когда есть что сказать (решение владельца):
// ошибка или «не получилось» (вид error/warn по началу текста) или important — событие не от самого человека
// (группа, телефон, обновление). Обычный отклик на щелчок («вывод включён», «скопировано», «выделено…») — без островка.
function flashStatus(text, important) {
  if (!text) return;
  const t = String(text);
  const kind = Notify.guessKind(t);
  if (!important && kind !== 'error' && kind !== 'warn') return;
  Notify.show({ text: t, kind: important && kind === 'ok' ? 'info' : kind });
}

// Клавиши плейлиста на вкладке «Экран» — раньше общих горячих клавиш
function svcKey(e) {
  if (!e.ctrlKey && !e.metaKey) {
    if (e.key === 'Delete') { deleteSelected(); return true; }
    // Enter — открыть в ленте пункт, выделенный в «Содержании» (если фокус не на другой кнопке)
    if (e.key === 'Enter' && !e.altKey && !e.shiftKey && selFocus === 'items' && selItems.length === 1 && entryByKey(selItems[0])
      && (e.target === document.body || (e.target.closest && e.target.closest('#contentList')))) { openEntry(selItems[0]); return true; }
    return false;
  }
  if (e.altKey || e.shiftKey) return false;
  if (e.code === 'KeyC') { svcCopy(false); return true; }
  if (e.code === 'KeyX') { svcCopy(true); return true; }
  if (e.code === 'KeyV') { svcPaste(); return true; }
  if (e.code === 'KeyD') { svcDuplicate(); return true; }
  if (e.code === 'KeyA') { if (selFocus === 'items') selectAllItems(); else selectAllSlides(); return true; }
  return false;
}

/* ----- Меню правой кнопки ----- */

let ctxMenu = null;
function showMenu(e, items) {
  closeMenu();
  ctxMenu = Object.assign(document.createElement('div'), { className: 'ctx-menu' });
  for (const it of items) {
    if (it === '-') { ctxMenu.append(Object.assign(document.createElement('div'), { className: 'ctx-sep' })); continue; }
    if (it.head) { ctxMenu.append(Object.assign(document.createElement('div'), { className: 'ctx-head', textContent: it.head })); continue; } // подпись раздела
    if (it.colors) {
      // Строка-палитра: кружки цветов, первый — «без цвета»
      const row = Object.assign(document.createElement('div'), { className: 'ctx-colors' });
      row.append(Object.assign(document.createElement('div'), { className: 'ctx-title', textContent: it.label }));
      for (const c of ['', ...it.colors]) {
        const b = Object.assign(document.createElement('button'), { className: (c ? '' : 'none') + (c === (it.value || '') ? ' on' : ''), title: c ? '' : 'Без цвета' });
        if (c) b.style.background = c;
        b.addEventListener('click', () => { closeMenu(); it.fn(c); });
        row.append(b);
      }
      ctxMenu.append(row);
      continue;
    }
    const b = Object.assign(document.createElement('button'), { textContent: it.label, disabled: !!it.disabled });
    if (it.title) b.title = it.title;
    if (it.icon && typeof Icons !== 'undefined') { const l = Object.assign(document.createElement('span'), { className: 'ctx-ic', textContent: it.label }); l.prepend(Icons.el(it.icon)); b.replaceChildren(l); }
    if (it.key) b.append(Object.assign(document.createElement('span'), { className: 'ctx-key', textContent: it.key }));
    b.addEventListener('click', () => { closeMenu(); it.fn(); });
    ctxMenu.append(b);
  }
  // открыто окно (например, «Настройки → Экран и вывод») — меню внутри него, иначе окажется под ним.
  // И в верхнем слое (popover): края окна его не обрезают, размытие фона окна (оформление «Аура») не сдвигает
  const dlg = [...document.querySelectorAll('dialog[open]')].pop();
  (dlg || document.body).append(ctxMenu);
  if (dlg && ctxMenu.showPopover) { ctxMenu.popover = 'manual'; ctxMenu.showPopover(); }
  // Всегда целиком в окне программы; ox/oy — если меню всё же отсчитывается не от угла экрана
  ctxMenu.style.left = '0px';
  ctxMenu.style.top = '0px';
  const r = ctxMenu.getBoundingClientRect();
  const x = Math.max(6, Math.min(e.clientX, window.innerWidth - r.width - 6));
  const y = Math.max(6, Math.min(e.clientY, window.innerHeight - r.height - 6));
  ctxMenu.style.left = x - r.left + 'px';
  ctxMenu.style.top = y - r.top + 'px';
}
let menuClosed = { tag: '', t: 0 }; // какое меню закрыли и когда — повторный щелчок по «＋» закрывает, а не открывает снова
function closeMenu() { if (ctxMenu) { menuClosed = { tag: ctxMenu.dataset.tag || '', t: Date.now() }; ctxMenu.remove(); ctxMenu = null; } }
window.addEventListener('pointerdown', (e) => { if (ctxMenu && !ctxMenu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ctxMenu) { closeMenu(); e.stopPropagation(); } }, true);
window.addEventListener('blur', closeMenu);

function slideMenu(e, key, sid) {
  if (!isSelected(key, sid)) { sel = [{ key, sid }]; selAnchor = { key, sid }; updatePlaylistLive(); }
  const entry = workEntry(key);
  const slide = entry && entry.item.slides.find((s) => s.id === sid);
  if (!slide) return;
  const n = sel.length;
  const many = n > 1 ? ` (${n})` : '';
  showMenu(e, [
    { label: slide.k === 'audio' ? 'Включить музыку' : 'Показать на экране', fn: () => showSlide(key, sid) },
    ...(slide.k === 'live' ? [{ label: 'Предпросмотр', fn: () => srcPopup(slide.src, e) }] : []),
    '-',
    { label: 'Копировать' + many, key: 'Ctrl+C', fn: () => svcCopy(false) },
    { label: 'Вырезать' + many, key: 'Ctrl+X', fn: () => svcCopy(true) },
    { label: 'Вставить после', key: 'Ctrl+V', fn: () => svcPaste({ item: entry.item, after: sid }) },
    { label: 'Дублировать' + many, key: 'Ctrl+D', fn: svcDuplicate },
    { label: 'В новую презентацию' + many, fn: () => toNewPres() },
    '-',
    ...(['text', 'bible', 'custom'].includes(slide.k) ? [
      { label: 'Тема слайда' + many + '…', fn: () => { const ch = selectedSlides(); openThemePicker({ kind: 'slides', slides: ch, name: ch.length > 1 ? `слайды (${ch.length})` : slide.label || 'слайд' }); } },
      { label: 'Шаблон темы' + many + '…', fn: () => tplPickMenu(e, selectedSlides()) },
    ] : []),
    ...(slide.k !== 'audio' ? [{ label: 'Переход и время слайда' + many + '…' + (slide.trans || slide.autoSec ? ' ✓' : ''), fn: () => openFx('slides', selectedSlides().map((x) => x.slide)) }] : []),
    ...(lib.macros && lib.macros.length ? [{ label: 'Привязать макрос…', fn: () => mcAttachMenu(e, { kind: 'slide', key, sid }) }] : []),
    ...(typeof stSlideMenu === 'function' ? stSlideMenu(e, entry, slide) : []), // сценический экран (stage.js)
    // Текст, Библия, свой слайд — в редакторе тем (свой вид слайда)
    ...(['text', 'bible', 'custom'].includes(slide.k) ? [{ label: 'Изменить в редакторе' + (slide.look ? ' (свой вид)' : ''), fn: () => openSlideLook(entry.item, sid) }] : []),
    ...(slide.k === 'audio' && slide.path ? [{ label: 'Открыть в аудиоредакторе', fn: () => openAudioEditor({ name: slide.name || entry.item.name, path: slide.path, url: slide.url }, { kind: 'item', itemId: entry.item.id, slideId: sid }) }] : []),
    ...(slide.k === 'image' ? [{ label: 'Изменить картинку…', fn: () => openImageEditor({ url: slide.url, path: slide.path, name: slide.name || entry.item.name }, { itemId: entry.item.id, slideId: sid }) }] : []),
    ...(slide.path ? [{ label: 'Показать в проводнике', fn: () => revealFile(slide.path) }] : []),
    { label: 'Удалить' + many, key: 'Delete', fn: svcDelete },
  ]);
}

function presMenu(e, key, item, isPl) {
  if (!isItemSelected(key)) { selItems = [key]; itemAnchor = key; updatePlaylistLive(); }
  const n = selItems.length;
  // Источник (камера, карта захвата…) — посмотреть сигнал в маленьком окне, не трогая экран
  const liveSl = item.slides.find((s) => s.k === 'live');
  const x = entryByKey(key) || { key, item };
  const inFeed = workIsView() && (feedAll() || key === openKey);
  showMenu(e, [
    ...(inFeed ? [] : [{ label: 'Открыть в ленте', key: 'Enter', fn: () => openEntry(key) }, '-']),
    ...(liveSl ? [{ label: 'Предпросмотр', fn: () => srcPopup(liveSl.src, e) }, '-'] : []),
    ...(n > 1 ? [{ label: `Тема для выделенных (${n})…`, fn: () => openThemeForSelected() }, '-'] : []),
    ...songMenuItems(item, selectedItems().map((x) => x.item)),
    { label: 'Вставить слайды в конец', key: 'Ctrl+V', fn: () => svcPaste({ item, after: item.slides.length ? item.slides[item.slides.length - 1].id : null }) },
    { label: 'Выделить все слайды', key: 'Ctrl+A', fn: () => { sel = item.slides.map((s) => ({ key, sid: s.id })); updatePlaylistLive(); } },
    { label: 'Копировать все слайды', fn: () => copySlides(item.slides).then((ok) => ok && flashStatus(`Скопировано слайдов: ${item.slides.length}`)) },
    '-',
    { label: 'Открыть в редакторе тем', disabled: !item.slides.some((s) => ['text', 'bible', 'custom'].includes(s.k)), fn: () => openSlideLook(item) },
    ...((() => { const a = item.slides.find((s) => s.k === 'audio' && s.path); return a ? [{ label: 'Открыть в аудиоредакторе', fn: () => openAudioEditor({ name: item.name, path: a.path, url: a.url }, { kind: 'item', itemId: item.id, slideId: a.id }) }] : []; })()),
    // Из плейлиста — перейти к песне в её библиотеке
    ...(isPl ? itemPlaces(item).filter((p) => p.kind === 'lib').map((p) => ({ label: `Найти в библиотеке «${p.name}»`, fn: () => gotoItem('lib', p.id, item.id) })) : []),
    ...(itemPath(item) ? [{ label: 'Показать в проводнике', fn: () => revealFile(itemPath(item)) }] : []),
    { label: 'Переход и авто-переключение' + (n > 1 ? ` (${n})` : '') + '…' + (item.trans || item.auto ? ' ✓' : ''), fn: () => openFx('item', n > 1 ? selectedItems().map((y) => y.item) : [item]) },
    { label: n > 1 ? 'Тема только этого…' : 'Тема…', fn: () => openThemePicker({ kind: 'item', item, name: item.name }) },
    { label: 'Переименовать…', fn: () => renamePres(item) },
    { label: `Слой: ${layerById(pickedLayer(x)) ? layerName(layerById(pickedLayer(x))) : 'сам'}…`, fn: () => layerPickMenu(e, n > 1 ? selectedItems() : [x]) },
    ...(lib.macros && lib.macros.length && entryByKey(key) ? [{ label: 'Привязать макрос…', fn: () => mcAttachMenu(e, { kind: 'entry', key }) }] : []),
    ...(typeof stPresMenu === 'function' ? stPresMenu(e, item) : []), // сценический макет при показе (stage.js)
    ...(typeof rmPresMenu === 'function' ? rmPresMenu(item) : []), // пульт с телефона (remote.js)
    { label: n > 1 ? `Экспорт презентаций (${n})…` : 'Экспорт презентации…', title: 'В файл вместе с её темами — на другом компьютере покажется так же', fn: () => exportPres(n > 1 ? selectedItems().map((y) => y.item) : [item]) },
    { label: 'Копия презентации', fn: () => addItems([{ ...JSON.parse(JSON.stringify(item)), id: newId(), name: item.name + ' (копия)', slides: Slides.copy(item.slides) }], false) },
    '-',
    { label: 'Цвет в списке', colors: MARKS, value: item.color, fn: (c) => setMark(item, c) },
    '-',
    n > 1 ? { label: (isPl ? 'Убрать из плейлиста' : 'Удалить из библиотеки') + ` (${n})`, key: 'Delete', fn: () => deleteSelItems() }
      : isPl ? { label: 'Убрать из плейлиста', key: 'Delete', fn: () => removeEntry(key) } : { label: 'Удалить из библиотеки', key: 'Delete', fn: () => removeFromLibrary(item) },
  ]);
}

// Шаблон темы для выделенных слайдов (шаблоны — у темы первого слайда); «Сам» — по виду слайда
function tplPickMenu(e, chosen) {
  if (!chosen.length) return;
  const { item, slide } = chosen[0];
  const t = themeById(themeIdFor(Slides.themeKind(slide), item, slide));
  const list = Themes.templatesOf(t);
  if (!list.length) { flashStatus('У темы этого слайда нет шаблонов — сделайте их в редакторе тем (F7 → «Темы»)'); return; }
  const cur = slide.tpl || '';
  const pick = (id) => {
    chosen.forEach((x) => { if (id) x.slide.tpl = id; else delete x.slide.tpl; if (x.slide.k !== 'custom') delete x.slide.look; }); // выбран шаблон — свой вид слайда не мешает
    saveLib();
    renderService();
    if (plShown && chosen.some((x) => x.slide.id === plShown.sid)) showSlide(plShown.key, plShown.sid, plShown.view);
    flashStatus(id ? `Шаблон «${list.find((x) => x.id === id).name}» · Ctrl+Z — вернуть` : 'Шаблон выбирается сам');
  };
  showMenu(e, [
    { label: (cur ? '' : '✓ ') + 'Сам — по виду слайда', fn: () => pick('') },
    '-',
    ...list.map((x) => ({ label: (cur === x.id ? '✓ ' : '') + x.name + (Themes.USES[x.use] && x.use !== 'any' && Themes.USES[x.use] !== x.name ? ` · ${Themes.USES[x.use]}` : ''), fn: () => pick(x.id) })),
  ]);
}

// В какой слой вывода идут слайды пункта: «сам» (по виду: камера → Источники, фото/видео → Медиа, текст → Презентации) или вручную.
// list — записи [{ key, item, entry? }]: в плейлисте выбор у записи, в библиотеке — у презентации
function layerPickMenu(e, list) {
  const cur = layerById(pickedLayer(list[0])) ? pickedLayer(list[0]) : '';
  const auto = layerById(autoLayerOf(list[0].item));
  const pick = (id) => {
    list.forEach((x) => setPickedLayer(x, id));
    saveLib();
    renderService();
    flashStatus((id ? `Слой: «${layerName(layerById(id))}»` : 'Слой выбирается сам') + (list.length > 1 ? ` (пунктов: ${list.length})` : '')
      + (id && layerById(id).kind === 'lower' ? ' — теперь и в окне «Плашки и бегущая строка»' : '') + ' · Ctrl+Z — вернуть');
  };
  showMenu(e, [
    { label: (cur ? '' : '✓ ') + `Сам — по виду${auto && list.length === 1 ? ` (${layerName(auto)})` : ''}`, fn: () => pick('') },
    '-',
    ...layerDefs().slice().reverse().map((l) => ({ label: (cur === l.id ? '✓ ' : '') + layerName(l), fn: () => pick(l.id) })),
  ]);
}

async function toNewPres() {
  const chosen = selectedSlides();
  if (!chosen.length) return;
  const name = await askName('Название новой презентации', chosen[0].item.name);
  if (!name) return;
  addItems([{ id: newId(), type: 'pres', name, slides: Slides.copy(chosen.map((x) => x.slide)), kind: Slides.presKind({ slides: chosen.map((x) => x.slide) }) }], false);
}

// Цветная метка пункта: фон названия в «Содержании» и (приглушённо) в ленте
const MARKS = ['#e5484d', '#f76b15', '#f5c400', '#46a758', '#12a594', '#0090ff', '#8e4ec6', '#d6409f', '#8b8d98'];
function setMark(item, color) {
  if (color) item.color = color; else delete item.color;
  saveLib();
  renderService();
}
const markEl = (el, item) => {
  el.classList.toggle('marked', !!item.color);
  if (item.color) el.style.setProperty('--mark', item.color);
};

// Заметка оператору (item.note): одна на презентацию — та же в плейлисте и в библиотеке
let notePop = null;
function noteBtn(item) {
  // span, а не button: строка «Содержания» сама кнопка
  const b = Object.assign(document.createElement('span'), { className: 'note-btn', textContent: '?' });
  b.setAttribute('role', 'button');
  b.dataset.item = item.id;
  paintNote(b, item);
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); openNote(b, item); });
  b.addEventListener('dblclick', (e) => e.stopPropagation());
  return b;
}
function paintNote(b, item) {
  b.classList.toggle('has', !!item.note);
  b.title = item.note || 'Заметка для оператора';
}
function openNote(anchor, item) {
  const reopen = notePop && notePop.item === item;
  closeNote();
  if (reopen) return;
  const el = Object.assign(document.createElement('div'), { className: 'note-pop' });
  const ta = Object.assign(document.createElement('textarea'), { value: item.note || '', placeholder: 'Заметка для оператора…' });
  el.append(Object.assign(document.createElement('div'), { className: 'nt', textContent: item.name }), ta);
  // Сохраняем сразу при вводе
  ta.addEventListener('input', () => {
    const t = ta.value.trim() ? ta.value : '';
    if (t) item.note = t; else delete item.note;
    saveLib();
    // Перекрасить «?» везде, где есть эта презентация (в ленте и в «Содержании»)
    document.querySelectorAll(`.note-btn[data-item="${item.id}"]`).forEach((x) => paintNote(x, item));
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeNote(); } });
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(r.left, window.innerWidth - w.width - 6)) + 'px';
  el.style.top = (r.bottom + w.height + 6 > window.innerHeight ? r.top - w.height - 4 : r.bottom + 4) + 'px';
  notePop = { el, item };
  ta.focus();
}
function closeNote() {
  if (!notePop) return;
  notePop.el.remove();
  notePop = null;
}
// Щелчок мимо окошка — закрыть (текст уже сохранён)
window.addEventListener('pointerdown', (e) => {
  if (notePop && !notePop.el.contains(e.target) && !e.target.closest('.note-btn')) closeNote();
}, true);

async function renamePres(item) {
  const name = await askName('Название презентации', item.name);
  if (!name) return;
  item.name = name;
  saveLib();
  renderService();
}

// Файл с вкладки «Экран» или из медиапула — копировать как слайд; before — свои пункты сверху
function mediaMenu(e, f, before) {
  showMenu(e, [...(before || []), {
    label: 'Копировать как слайд',
    key: 'Ctrl+C',
    fn: () => copySlides(Slides.fromFile(f).slides).then((ok) => ok && flashStatus('Скопировано: вставьте в любую презентацию (Ctrl+V)')),
  }, ...revealItems(f.path)]);
}

// «Показать в проводнике»: папка с файлом открывается, файл выделен
async function revealFile(p) {
  if (!p) return;
  const ok = await window.api.revealFile(p);
  if (!ok) showNotice('Файл не найден: ' + p, true);
}
const revealItems = (p) => (p ? ['-', { label: 'Показать в проводнике', fn: () => revealFile(p) }] : []);
// Файл презентации на диске (фото, видео, музыка — один файл)
const itemPath = (item) => { const ps = [...new Set(item.slides.map((s) => s.path).filter(Boolean))]; return ps.length === 1 ? ps[0] : ''; };

// Где лежит презентация: библиотеки и плейлисты
const itemPlaces = (item) => [
  ...lib.libraries.filter((l) => l.items.includes(item.id)).map((l) => ({ kind: 'lib', id: l.id, name: l.name })),
  ...lib.playlists.filter((p) => p.entries.some((e) => e.item === item.id)).map((p) => ({ kind: 'pl', id: p.id, name: p.name })),
];

// Открыть библиотеку (или плейлист) и показать в ней презентацию: выделена, открыта в ленте
function gotoItem(kind, id, itemId) {
  setView(kind, id);
  const x = viewEntries().find((y) => y.item.id === itemId);
  if (!x) return;
  openEntry(x.key);
  updatePlaylistLive();
  const el = contentRowEl(x.key);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.focus();
  el.classList.add('found');
  setTimeout(() => el.classList.remove('found'), 2000);
}

/* ----- Правка состава ----- */

function itemUsed(id) {
  return lib.libraries.some((l) => l.items.includes(id)) || lib.playlists.some((p) => p.entries.some((e) => e.item === id));
}
function dropIfUnused(id) { if (!itemUsed(id)) delete lib.items[id]; }

function moveEntry(idx, d) {
  const list = findView().entries;
  const j = idx + d;
  if (j < 0 || j >= list.length) return;
  [list[idx], list[j]] = [list[j], list[idx]];
  saveLib();
  renderFeed();
}

function removeEntry(key) {
  const pl = findView();
  const e = pl.entries.find((x) => x.eid === key);
  pl.entries = pl.entries.filter((x) => x.eid !== key);
  if (e) dropIfUnused(e.item);
  saveLib();
  renderService();
}

function removeFromLibrary(item) {
  const l = findView();
  l.items = l.items.filter((id) => id !== item.id);
  dropIfUnused(item.id);
  saveLib();
  renderService();
  flashStatus(`«${item.name}» удалено из библиотеки · Ctrl+Z — вернуть`);
}

// Добавить новые презентации в то, что открыто: в плейлист — в конец, в библиотеку — в список.
// how: 'pool' — файл из медиапула (в плейлист можно); 'rescue' — уже сделанная работа (песня, редактор):
// открыт плейлист — сохраняется в библиотеку, чтобы не пропала; иначе в плейлисте новое не создаётся (plNoCreate)
function addItems(items, alsoToLibrary, how) {
  let v = findView();
  if (!v) { showNotice('Сначала создайте плейлист или библиотеку', true); return; }
  if (lib.view.kind === 'pl' && how !== 'pool') {
    if (how !== 'rescue') { plNoCreate(); return; }
    let l = lib.libraries[0];
    if (!l) { l = { id: newId(), name: freeName('lib', 'Библиотека'), items: [] }; lib.libraries.push(l); }
    for (const it of items) { if (!it.kind) it.kind = Slides.presKind(it); lib.items[it.id] = it; if (!l.items.includes(it.id)) l.items.push(it.id); }
    saveLib();
    renderService();
    flashStatus(`Сохранено в библиотеку «${l.name}» — в плейлист перетащите оттуда`);
    return;
  }
  let lastKey = null;
  for (const it of items) {
    if (!it.kind) it.kind = Slides.presKind(it);
    lib.items[it.id] = it;
    if (lib.view.kind === 'pl') {
      lastKey = newId();
      v.entries.push({ eid: lastKey, item: it.id });
      if (alsoToLibrary && lib.libraries[0] && !lib.libraries[0].items.includes(it.id)) lib.libraries[0].items.push(it.id);
    } else { v.items.push(it.id); lastKey = it.id; }
  }
  // В ленте ничего не открыто — сразу открыть добавленное; иначе рабочее не меняем, добавленное — в «Содержании»
  openIfIdle(lastKey);
  if (lastKey && tab === 'service' && !(workIsView() && (feedAll() || openKey === lastKey))) {
    selItems = [lastKey];
    flashStatus('Добавлено в «Содержание» · щелчок — открыть в ленте');
  }
  saveLib();
  if (tab !== 'service') setTab('service');
  renderService();
  const feed = $('svcFeed');
  if (feedAll() && workIsView()) feed.scrollTop = feed.scrollHeight;
}

const fromFileItem = (f) => Slides.fromFile(f);

function addFileResult({ items, errors }, fromPool) {
  if (!fromPool && items.length && plNoCreate()) return; // файлы с диска — только в библиотеку
  if (items.length) addItems(items.map(fromFileItem), false, fromPool ? 'pool' : undefined);
  showNotice(errors.length ? 'Не удалось добавить: ' + errors.join('; ') : '', errors.length > 0);
}

// Ctrl+O, кнопки «Добавить файлы» — то же «Добавить…»: файлы, песни, презентации, темы
async function svcAddFiles() {
  await addAll();
}

async function svcAddPaths(paths, fromPool) {
  if (!findView()) return;
  // Из Проводника — как «Добавить…» (песни, презентации и темы тоже); в плейлист — нельзя, из медиапула — можно
  if (!fromPool) { await addAnything(await window.api.addRead(paths, { slideWidth: slideWidth(), groupDecks: true }), true); return; }
  const res = await window.api.describeFiles(paths, { slideWidth: slideWidth(), groupDecks: true });
  if (fromPool) res.items.forEach((i) => { if (i.type === 'image' || i.type === 'video') i.fit = poolFitValue(); });
  else markPoolFit(res.items);
  addFileResult(res, fromPool);
}

/* ----- Библия → слайды ----- */

// Выделенные слайды-стихи, иначе показанные стихи, иначе все открытые главы — по слайду на стих
function bibleSlidesSelected() {
  // На экране слайд из набора с дополнительными стихами — весь набор (дополнительные помечены)
  if (bSet && bsetAt() >= 0 && !(slidesMode() && vsel[bPane].length > 1)) {
    const keys = [];
    for (let v = bSet.x1; v <= bSet.x2; v++) if (verseText(vkey(bSet.bi, bSet.ci, v))) keys.push(vkey(bSet.bi, bSet.ci, v));
    const b = bibleSlidesFor(keys, (k) => { const v = unkey(k).v; return v < bSet.m1 || v > bSet.m2; });
    const main = keys.filter((k) => { const v = unkey(k).v; return v >= bSet.m1 && v <= bSet.m2; });
    return { name: `${refString(main)} (+ ${bSet.x1}-${bSet.x2})`, slides: b.slides, keys };
  }
  const keys = bibleKeysForAction();
  if (!keys.length) { flashStatus('Сначала выберите стихи: щелчок по стиху, в «Слайдах» Ctrl/Shift+щелчок — несколько'); return null; }
  return bibleSlidesFor(keys);
}

// Стихи (ключи «книга:глава:стих» по порядку) → { name, slides }, по слайду на стих (длинный — по слайду на часть).
// extraOf(k) — дополнительный ли стих
function bibleSlidesFor(keys, extraOf) {
  const slides = keys.filter(verseText).flatMap((k) => verseParts(k).map((_, pi) => bibleSlide([k], pi, extraOf && extraOf(k))));
  return { name: bibleNameFor(keys), slides, keys };
}
// Целые главы называем коротко: «Иоанна 3-4», а не «Иоанна 3:1-36; 4:1-54»
function bibleNameFor(keys) {
  const chs = [];
  for (const k of keys) { const { bi, ci } = unkey(k); if (!chs.some((x) => x[0] === bi && x[1] === ci)) chs.push([bi, ci]); }
  const whole = chapterKeys(chs).length === keys.length;
  return whole ? chaptersTitle(chs) : refString(keys);
}

/* ----- Место Писания у пункта «Библия»: item.bref = { tr, canon, bi, vs: [[ci, v], …] } -----
   Перевод (id), книга (канонический номер; bi — запасной, если в переводе нет номеров) и стихи по порядку.
   По нему пункт перестраивается в другом переводе и расширяется на стих влево/вправо — в шапке ленты (brefCtl).
   У старых пунктов bref нет — восстанавливаем по подписям слайдов (brefEnsure). */

// Стихи открытого перевода → bref (только одна книга)
function brefOf(keys) {
  if (!bible || !keys || !keys.length) return null;
  const ks = sortKeys(keys).map(unkey);
  if (ks.some((k) => k.bi !== ks[0].bi)) return null;
  return { tr: bible.id, canon: bible.books[ks[0].bi].canon || 0, bi: ks[0].bi, vs: ks.map((k) => [k.ci, k.v]) };
}
// Книга места в переводе b; -1 — такой книги в нём нет
function brefBook(b, r) {
  if (r.canon) return b.books.findIndex((bk) => bk.canon === r.canon);
  return b.books[r.bi] ? r.bi : -1;
}
// Сделать что-то так, будто открыт перевод b (слайды, названия, деление стихов берутся из открытого перевода)
function withBible(b, fn) {
  const saved = bible;
  bible = b;
  try { return fn(); } finally { bible = saved; }
}
function brefKeys(b, r) {
  const bi = brefBook(b, r);
  if (bi < 0) return [];
  const ch = b.books[bi].chapters;
  return r.vs.filter(([ci, v]) => ch[ci] && ch[ci][v - 1]).map(([ci, v]) => vkey(bi, ci, v));
}
const brefName = (b, r) => { const keys = brefKeys(b, r); return keys.length ? withBible(b, () => bibleNameFor(keys)) : ''; };
const brefRef = (b, r) => { const keys = brefKeys(b, r); return keys.length ? withBible(b, () => refString(keys)) : ''; };
// В пункте только слайды Библии — иначе перестраивать его нельзя (потеряются свои слайды)
// и все стихи — из одной книги: в пункт могли вставить стихи из других книг, а bref помнит только исходное место —
// тогда перевод и ‹ › в шапке не показываем (перестройка по bref стёрла бы вставленные слайды)
const brefBookOf = (s) => String(s.ref || '').replace(/\s+\d+:\d+.*$/, '').trim();
const brefOk = (item) => item.kind === 'bible' && item.slides.length > 0 && item.slides.every((s) => s.k === 'bible')
  && new Set(item.slides.map(brefBookOf)).size === 1;

// Старый пункт без bref: перевод — по подписи перевода на слайдах, стихи — по подписям «Книга 3:16» (или «3:16A» — часть стиха)
const brefFailed = new WeakSet();
async function brefEnsure(item) {
  if (item.bref) return item.bref;
  if (!brefOk(item) || brefFailed.has(item) || !bibleIndex.length) return null;
  const fail = () => { brefFailed.add(item); return null; };
  const label = item.slides[0].translation || item.translation || '';
  const t = bibleIndex.find((x) => label && (trLabel(x) === label || x.name === label || trAbbr(x) === label))
    || (bible && bibleIndex.find((x) => x.id === bible.id));
  const b = t && (await loadBible(t.id));
  if (!b) return fail();
  let book = null;
  const vs = [];
  for (const s of item.slides) {
    const m = /^(.*\S)\s+(\d+):(\d+)(?:-(\d+))?[A-Z]?$/.exec(String(s.ref || '').trim());
    if (!m || (book !== null && m[1] !== book)) return fail();
    book = m[1];
    const ci = +m[2] - 1;
    for (let v = +m[3]; v <= +(m[4] || m[3]); v++) if (!vs.some((x) => x[0] === ci && x[1] === v)) vs.push([ci, v]);
  }
  const bi = Bible.findBook(b, book);
  if (bi < 0 || item.bref) return item.bref || fail();
  item.bref = { tr: t.id, canon: b.books[bi].canon || 0, bi, vs }; // сохранится со следующей правкой — отмены не нужно
  return item.bref;
}

// Соседний непустой стих книги: d = 1 — следующий (за концом главы — первый стих следующей), -1 — предыдущий
function brefNext(ch, ci, v, d) {
  for (let guard = 0; guard < 400; guard++) {
    v += d;
    if (v < 1) { ci--; if (ci < 0) return null; v = (ch[ci] || []).length + 1; continue; }
    if (v > (ch[ci] || []).length) { ci++; if (ci >= ch.length) return null; v = 0; continue; }
    if (ch[ci][v - 1]) return [ci, v];
  }
  return null;
}

// Правки места идут по очереди: несколько быстрых щелчков по ‹ › — несколько стихов, без гонок
let brefQueue = Promise.resolve();
const brefDo = (fn) => { brefQueue = brefQueue.then(fn).catch((e) => console.error(e)); return brefQueue; };

// Расширить место на стих (d = 1 — справа, -1 — слева); shrink — наоборот, убрать крайний стих с этой стороны
function brefStep(item, d, shrink) {
  return brefDo(async () => {
    const r = item.bref;
    const b = r && (await loadBible(r.tr));
    const bi = b ? brefBook(b, r) : -1;
    if (bi < 0) return;
    const vs = r.vs.slice();
    if (shrink) {
      if (vs.length <= 1) { flashStatus('Остался один стих — меньше некуда'); return; }
      if (d > 0) vs.pop(); else vs.shift();
    } else {
      const edge = d > 0 ? vs[vs.length - 1] : vs[0];
      const nx = brefNext(b.books[bi].chapters, edge[0], edge[1], d);
      if (!nx) { flashStatus(d > 0 ? 'Это последний стих книги' : 'Это первый стих книги'); return; }
      if (d > 0) vs.push(nx); else vs.unshift(nx);
    }
    await brefApply(item, { ...r, vs });
  });
}

// Перестроить слайды пункта по новому месту/переводу. Слайды тех же стихов сохраняют id и свои настройки
// (тему, переход, заметки…). Экран при этом НЕ меняется (решение владельца, 20.11.2026): ни новый стих,
// ни другой перевод сами не выводятся — только по щелчку. Показанный слайд в другом переводе помечается (plStale)
async function brefApply(item, nr) {
  const b = await loadBible(nr.tr);
  if (!b) { showNotice('Перевод не найден', true); renderFeed(); return; }
  const keys = brefKeys(b, nr);
  if (!keys.length) { showNotice(`В переводе «${b.name}» нет этого места`, true); renderFeed(); return; }
  const oldB = item.bref && (await loadBible(item.bref.tr));
  const oldName = oldB ? brefName(oldB, item.bref) : '';
  const tagOf = (s) => { const m = /(\d+):(\d+)([A-Z]?)$/.exec(s.ref || ''); return m ? m.slice(1).join(':') : ''; };
  // Тот же перевод (‹ › — стих добавили или убрали): слайды остальных стихов остаются те же самые — без пересборки,
  // новые собираются только для добавленных стихов
  const mine = new Map(); // «глава:стих» → слайды этого стиха (части 7A, 7B…)
  const trChanged = !item.bref || item.bref.tr !== nr.tr;
  if (!trChanged) {
    for (const s of item.slides) {
      const t = tagOf(s);
      if (!t) continue;
      const v = t.split(':').slice(0, 2).join(':');
      if (!mine.has(v)) mine.set(v, []);
      mine.get(v).push(s);
    }
  }
  const kept = new Set();
  const built = withBible(b, () => {
    const slides = [];
    for (const k of keys) {
      const { ci, v } = unkey(k);
      const same = mine.get(`${ci + 1}:${v}`);
      if (same) { same.forEach((s) => kept.add(s)); slides.push(...same); } else slides.push(...bibleSlidesFor([k]).slides);
    }
    return { name: bibleNameFor(keys), slides };
  });
  const old = new Map(item.slides.map((s) => [tagOf(s), s]));
  const CONTENT = ['k', 'label', 'ref', 'verses', 'translation', 'trs']; // extra (доп. стих) — переносится со старого слайда
  for (const s of built.slides) {
    if (kept.has(s)) continue;
    const o = old.get(tagOf(s));
    if (!o) continue;
    old.delete(tagOf(s));
    for (const [k, v] of Object.entries(o)) if (!CONTENT.includes(k)) s[k] = v;
  }
  item.slides = built.slides;
  // Название меняем вместе с местом, только если его не переименовывали
  if (!item.name || item.name === oldName) item.name = built.name;
  item.bref = nr;
  // На экране — прежний вид показанного слайда; если в ленте он теперь другой (другой перевод) — пометить
  const on = plShown && entryByKey(plShown.key, keyView(plShown.view));
  if (on && on.item === item && trChanged) {
    plStale = item.slides.some((s) => s.id === plShown.sid) && !slideOnScreen(plShown.key, plShown.sid, plShown.view) ? plShown : null;
  }
  saveLib();
  renderService();
}

// Открыть место пункта в «Библии»: тот же перевод (если он установлен), книга, главы и стихи выделены.
// На экран ничего не идёт, лента и выделение в ней не меняются
async function brefReveal(item) {
  const r = await brefEnsure(item);
  if (!r) { showNotice('Не удалось понять, из какого места Писания эта презентация', true); return; }
  if (bibleIndex.some((t) => t.id === r.tr) && (!bible || bible.id !== r.tr)) await selectBible(r.tr);
  else if (!bibleIndex.some((t) => t.id === r.tr)) flashStatus('Перевода этой презентации нет — место открыто в текущем переводе');
  if (!bible) { showNotice('Сначала добавьте перевод Библии', true); return; }
  const keys = brefKeys(bible, r);
  if (!keys.length) { showNotice(`В переводе «${bible.name}» нет этого места`, true); return; }
  if (tab !== 'bible') setTab('bible');
  const chs = [];
  for (const k of keys) { const { bi, ci } = unkey(k); if (!chs.some((x) => x[0] === bi && x[1] === ci)) chs.push([bi, ci]); }
  if (chs.length > 1) openChapters(chs); else openChapter(...chs[0]);
  const vs = keys.map(unkey);
  refSel = { v1: vs[0].v, v2: vs[vs.length - 1].v, keys: new Set(keys) }; // подсветка, как при наборе в поле «Место»
  if (slidesMode()) { vsel.main = keys.slice(); vAnchor.main = keys[0]; }
  $('refInput').value = refString(keys);
  updateBibleHighlight();
  scrollToVerse(vs[0].v, versesEl, vs[0].bi, vs[0].ci);
}

// Шапка пункта «Библия»: [перевод ▾] ‹ Иоанна 3:16-18 ›
function brefCtl(item) {
  const box = Object.assign(document.createElement('span'), { className: 'bref' });
  // Щелчки здесь — не выбор пункта и не перетаскивание
  for (const ev of ['click', 'mousedown', 'dblclick']) box.addEventListener(ev, (e) => e.stopPropagation());
  box.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
  if (!brefOk(item)) return box;
  brefEnsure(item).then(async (r) => {
    const b = r && (await loadBible(r.tr));
    if (!b || !box.isConnected || !brefOk(item)) return;
    const sel = Object.assign(document.createElement('select'), { title: 'Перевод этого места — выберите другой, глава и стихи сохранятся' });
    for (const t of bibleIndex) sel.append(Object.assign(document.createElement('option'), { value: t.id, textContent: trLabel(t) }));
    if (!bibleIndex.some((t) => t.id === r.tr)) sel.append(Object.assign(document.createElement('option'), { value: r.tr, textContent: b.name || '—' }));
    sel.value = r.tr;
    sel.addEventListener('change', () => brefDo(() => brefApply(item, { ...item.bref, tr: sel.value })));
    const arrow = (text, d, title) => {
      const a = Object.assign(document.createElement('button'), { className: 'bref-step', textContent: text, title });
      a.addEventListener('click', (e) => brefStep(item, d, e.shiftKey || e.altKey));
      return a;
    };
    // Место полностью; если оно и так в названии пункта — коротко, главы и стихи: «3:28–4:1»
    const ref = brefRef(b, r);
    const [c1, v1] = r.vs[0];
    const [c2, v2] = r.vs[r.vs.length - 1];
    const short = `${c1 + 1}:${v1}` + (c1 === c2 && v1 === v2 ? '' : `–${c2 === c1 ? '' : `${c2 + 1}:`}${v2}`);
    // Иконка Библии — открыть это место в разделе «Библия» (перевод, главы, стихи); на экран ничего не идёт
    const go = Object.assign(document.createElement('button'), { className: 'bref-go', title: 'Открыть это место в «Библии»: тот же перевод, глава и стихи. На экран ничего не выводится' });
    go.append(ico('bible'));
    go.addEventListener('click', () => brefDo(() => brefReveal(item)));
    box.append(
      go,
      sel,
      arrow('‹', -1, 'Добавить стих перед местом (за началом главы — из предыдущей). Shift+щелчок — убрать первый стих'),
      Object.assign(document.createElement('span'), { className: 'bref-ref', textContent: ref === item.name ? short : ref, title: ref }),
      arrow('›', 1, 'Добавить стих после места (за концом главы — из следующей). Shift+щелчок — убрать последний стих'),
    );
  });
  return box;
}

// Выделенные стихи — в открытый слева плейлист или библиотеку отдельной презентацией, по стиху на слайд
function svcAddBible() {
  const b = bibleSlidesSelected();
  if (!b) return;
  const v = findView();
  if (!v) { showNotice('Сначала создайте плейлист: «＋» у «Плейлистов» слева', true); return; }
  const it = { id: newId(), type: 'pres', kind: 'bible', name: b.name, slides: b.slides, bref: brefOf(b.keys) };
  lib.items[it.id] = it;
  putItem(lib.view.kind, v, it.id, null);
  saveLib();
  renderService();
  flashStatus(`✓ В «${v.name}»: ${it.slides.length} сл.`);
}

// Поставить презентацию в плейлист или библиотеку: перед пунктом beforeKey или в конец
function putItem(kind, x, itemId, beforeKey) {
  if (kind === 'pl') {
    const at = beforeKey ? x.entries.findIndex((e) => e.eid === beforeKey) : -1;
    x.entries.splice(at < 0 ? x.entries.length : at, 0, { eid: newId(), item: itemId });
  } else if (!x.items.includes(itemId)) {
    const at = beforeKey ? x.items.indexOf(beforeKey) : -1;
    x.items.splice(at < 0 ? x.items.length : at, 0, itemId);
  }
}

/* ----- Перетаскивание слайдов из «Библии» (application/x-cp-bible: { keys } или { groups: [keys…] } — закладки) ----- */

const BIBLE_DT = 'application/x-cp-bible';
const isBibleDrag = (e) => e.dataTransfer.types.includes(BIBLE_DT);

// Бросили стихи на плейлист/библиотеку (kind, x) — новая презентация из них, перед beforeKey или в конец
// groups — несколько мест сразу (закладки): каждое — своя презентация, по порядку
function dropBible(e, kind, x, beforeKey) {
  let d;
  try { d = JSON.parse(e.dataTransfer.getData(BIBLE_DT)); } catch { return false; }
  const groups = Array.isArray(d.groups) ? d.groups : [d.keys];
  if (!bible) return false;
  const names = [];
  let n = 0;
  for (const keys of groups) {
    if (!Array.isArray(keys) || !keys.length) continue;
    const b = bibleSlidesFor(sortKeys(keys));
    if (!b.slides.length) continue;
    const it = { id: newId(), type: 'pres', kind: 'bible', name: b.name, slides: b.slides, bref: brefOf(b.keys) };
    lib.items[it.id] = it;
    putItem(kind, x, it.id, beforeKey);
    names.push(b.name);
    n += b.slides.length;
  }
  if (!names.length) return false;
  saveLib();
  renderService();
  flashStatus(names.length > 1 ? `${names.length} мест Писания → «${x.name}»: ${n} сл.` : `«${names[0]}» → «${x.name}»: ${n} сл.`);
  return true;
}

/* Источник из «Медиапул → Источники» (application/x-cp-source: { type, id, label }) — тем же путём, что и стихи */
const SOURCE_DT = 'application/x-cp-source';
const isListDrag = (e) => isBibleDrag(e) || e.dataTransfer.types.includes(SOURCE_DT);
function dropList(e, kind, x, beforeKey) {
  if (!x) return false;
  if (!e.dataTransfer.types.includes(SOURCE_DT)) return dropBible(e, kind, x, beforeKey);
  let s;
  try { s = JSON.parse(e.dataTransfer.getData(SOURCE_DT)); } catch { return false; }
  return srcPut(s, kind, x, beforeKey);
}

// Пустое место «Содержания» и ленты — стихи, источник или готовая презентация в конец списка
// («Содержание» — открытый слева список, лента — рабочий: можно тянуть из библиотеки прямо в ленту плейлиста)
for (const id of ['contentBox', 'svcFeed']) {
  const el = $(id);
  const target = () => (id === 'svcFeed' && work && findView(work) ? { kind: work.kind, v: findView(work) } : findView() ? { kind: lib.view.kind, v: findView() } : null);
  const tk = (t) => t.kind + ':' + t.v.id;
  el.addEventListener('dragover', (e) => { const t = target(); if (t && (isListDrag(e) || isPoolDrag(e) || isForeignItemDrag(e, tk(t)))) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop');
    const t = target();
    if (!t) return;
    // Пункты из другого списка (библиотека → плейлист, плейлист → библиотека, между плейлистами) — все выделенные
    if (isForeignItemDrag(e, tk(t))) {
      const ids = draggedItemIds(e);
      if (!ids.length) return;
      e.preventDefault();
      putItems(t.kind, t.v, ids, null);
      return;
    }
    if (!isListDrag(e)) return;
    e.preventDefault();
    dropList(e, t.kind, t.v, null);
  });
}

/* Правило владельца: новое (песня, файл, свои слайды, вставка, копия) создаётся только в библиотеке — там, где оно будет жить.
   В плейлист — только перетащить готовое: презентацию из библиотеки, стихи из «Библии», файл или источник из медиапула. */
const PL_ONLY_DRAG = 'В плейлисте новое не создаётся. Создайте его в библиотеке, а в плейлист перетащите: презентацию из библиотеки, стихи из «Библии», файл из медиапула';
const plOpen = () => !!lib && !!lib.view && lib.view.kind === 'pl' && !!findView();
function plNoCreate() {
  if (!plOpen()) return false;
  showNotice(PL_ONLY_DRAG, true);
  return true;
}

// Выделенные стихи — в буфер обмена как слайды (Ctrl+C на вкладке «Библия»)
async function bibleCopySlides() {
  const b = bibleSlidesSelected();
  if (!b || !(await copySlides(b.slides))) return;
  flashStatus(`✓ Скопировано слайдов: ${b.slides.length} — вставьте в любую презентацию (Ctrl+V)`);
}

/* ----- Создать, переименовать, удалить плейлист или библиотеку ----- */

function askName(title, value) {
  const dlg = $('nameDialog');
  $('nameDlgTitle').textContent = title;
  $('nameInput').value = value || '';
  dlg.returnValue = '';
  dlg.showModal();
  $('nameInput').select();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? $('nameInput').value.trim() || null : null), { once: true });
  });
}

// Вопрос «Да / Отмена» — своё окно вместо window.confirm: после системного окна Electron в Windows поля ввода
// переставали принимать буквы (курсор мигает, текст не вводится) до перезапуска. window.confirm/alert не использовать.
// Текст до первого «?» (или до переноса строки) — заголовок, остальное — пояснение. ok — подпись кнопки;
// danger — опасное действие: красная кнопка, Enter = «Отмена». Ответ — Promise<true/false>. Вопросы идут по очереди.
let askChain = Promise.resolve();
function askYes(text, ok = 'Да', danger = false) {
  const run = () => new Promise((resolve) => {
    const dlg = $('askDialog');
    const s = String(text || '');
    const m = /^([^\n]*?\?)\s+([\s\S]+)$/.exec(s) || /^([^\n]*)\n+([\s\S]+)$/.exec(s);
    $('askTitle').textContent = m ? m[1] : s;
    $('askText').textContent = m ? m[2] : '';
    $('askBody').hidden = !m;
    $('askOk').textContent = ok;
    $('askOk').className = danger ? 'danger-btn' : 'primary';
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    try { dlg.showModal(); } catch { resolve(false); return; }
    (danger ? $('askNo') : $('askOk')).focus();
  });
  const p = askChain.then(run, run);
  askChain = p.catch(() => {});
  return p;
}

// Свободное имя: «Плейлист 02.11.2026», а если такое уже есть — «… (2)», «… (3)»
function freeName(kind, base) {
  const names = (kind === 'pl' ? lib.playlists : lib.libraries).map((x) => x.name);
  let name = base;
  for (let n = 2; names.includes(name); n++) name = `${base} (${n})`;
  return name;
}

// «＋» сразу создаёт плейлист или библиотеку с датой; переименовать — правой кнопкой или двойным щелчком
function createView(kind) {
  const name = freeName(kind, (kind === 'pl' ? 'Плейлист ' : 'Библиотека ') + new Date().toLocaleDateString(I18n.loc));
  const x = kind === 'pl' ? { id: newId(), name, entries: [] } : { id: newId(), name, items: [] };
  (kind === 'pl' ? lib.playlists : lib.libraries).push(x);
  setView(kind, x.id);
}

// Копия плейлиста — те же песни в том же порядке; копия библиотеки — свои копии презентаций
function copyView(kind, id) {
  const src = (kind === 'pl' ? lib.playlists : lib.libraries).find((v) => v.id === id);
  if (!src) return;
  const name = freeName(kind, src.name + ' (копия)');
  let x;
  if (kind === 'pl') x = { id: newId(), name, entries: src.entries.map((e) => ({ ...e, eid: newId() })) }; // со слоем записи
  else {
    x = { id: newId(), name, items: [] };
    for (const itemId of src.items) {
      const it = lib.items[itemId];
      if (!it) continue;
      const copy = { ...JSON.parse(JSON.stringify(it)), id: newId(), slides: Slides.copy(it.slides) };
      lib.items[copy.id] = copy;
      x.items.push(copy.id);
    }
  }
  const list = kind === 'pl' ? lib.playlists : lib.libraries;
  list.splice(list.indexOf(src) + 1, 0, x);
  setView(kind, x.id);
  flashStatus(`Создана копия: ${name}`);
}

let viewDrag = null; // какую строку библиотек/плейлистов сейчас тянут

// Переставить библиотеку или плейлист: id встаёт перед target (after — после него); target null + after — в конец
function moveView(kind, id, target, after) {
  const list = kind === 'pl' ? lib.playlists : lib.libraries;
  const from = list.findIndex((v) => v.id === id);
  if (from < 0) return;
  const [x] = list.splice(from, 1);
  let to = target ? list.findIndex((v) => v.id === target) : list.length;
  if (to < 0) to = list.length;
  list.splice(to + (target && after ? 1 : 0), 0, x);
  saveLib();
  renderSide();
}

function viewMenu(e, kind, x) {
  const what = kind === 'pl' ? 'плейлист' : 'библиотеку';
  const list = kind === 'pl' ? lib.playlists : lib.libraries;
  const i = list.indexOf(x);
  showMenu(e, [
    { label: 'Открыть', fn: () => setView(kind, x.id) },
    { label: 'Переименовать…', fn: () => renameView(kind, x.id) },
    { label: `Копировать ${what}`, fn: () => copyView(kind, x.id) },
    '-',
    { label: 'Выше', disabled: i <= 0, fn: () => moveView(kind, x.id, list[i - 1].id, false) },
    { label: 'Ниже', disabled: i < 0 || i >= list.length - 1, fn: () => moveView(kind, x.id, list[i + 1].id, true) },
    '-',
    { label: `Удалить ${what}`, fn: () => deleteView(kind, x.id) },
  ]);
}

async function renameView(kind = lib.view && lib.view.kind, id = lib.view && lib.view.id) {
  const x = (kind === 'pl' ? lib.playlists : lib.libraries).find((v) => v.id === id);
  if (!x) return;
  const name = await askName('Новое название', x.name);
  if (!name) return;
  x.name = name;
  saveLib();
  renderService();
}

async function deleteView(kind = lib.view && lib.view.kind, id = lib.view && lib.view.id) {
  const isPl = kind === 'pl';
  const v = (isPl ? lib.playlists : lib.libraries).find((x) => x.id === id);
  if (!v) return;
  const ask = isPl ? `Удалить плейлист «${v.name}»? Песни в библиотеках останутся.`
    : v.shared ? `Убрать общую библиотеку «${v.name}» из этого профиля? У других профилей она останется. Презентации, которые стоят в плейлистах, там останутся.`
      : `Удалить библиотеку «${v.name}»? Презентации, которые стоят в плейлистах, там останутся.`;
  if (!(await askYes(ask, v.shared ? 'Убрать' : 'Удалить', true))) return;
  if (!(isPl ? lib.playlists : lib.libraries).includes(v)) return; // пока спрашивали, уже удалили (Ctrl+Z, другой вопрос)
  if (isPl) lib.playlists = lib.playlists.filter((p) => p !== v);
  else lib.libraries = lib.libraries.filter((l) => l !== v);
  const ids = isPl ? v.entries.map((e) => e.item) : v.items;
  ids.forEach(dropIfUnused);
  // Удалили не тот, что открыт, — остаёмся где были
  if (findView()) { saveLib(); renderService(); return; }
  const next = lib.playlists[0] ? ['pl', lib.playlists[0].id] : lib.libraries[0] ? ['lib', lib.libraries[0].id] : null;
  if (next) setView(...next); else { lib.view = null; saveLib(); renderService(); }
}

$('sideFold').addEventListener('click', () => toggleFold('sideFold'));
$('tileSide').addEventListener('click', () => toggleFold('sideFold'));
$('contentFold').addEventListener('click', () => toggleFold('contentFold'));
// Правая кнопка по пустому месту «Содержания» — режим задач
$('contentBox').addEventListener('contextmenu', (e) => { if (e.target.closest('.svc-sub')) return; e.preventDefault(); contentMenu(e); });
$('tileContent').addEventListener('click', () => toggleFold('contentFold'));
$('plNew').addEventListener('click', () => createView('pl'));
$('libNew').addEventListener('click', () => createView('lib'));
// Одна кнопка «＋» в верхней строке вместо отдельных кнопок добавления
function inLists(fn) {
  return () => {
    if (!listsTab()) setTab('service');
    if (!findView()) { showNotice('Сначала создайте плейлист или библиотеку', true); return; }
    fn();
  };
}
function openAddMenu() {
  const r = $('addMenu').getBoundingClientRect();
  const isPl = !!lib && !!lib.view && lib.view.kind === 'pl';
  const noNew = isPl && listsTab(); // открыт плейлист: создавать нельзя — только перетаскивать готовое
  const where = findView();
  showMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
    ...(noNew ? [{ label: 'Открыт плейлист: новое — в библиотеке, сюда — перетащить', disabled: true, fn() {} }, '-'] : []),
    { head: 'Добавить' },
    { label: 'Добавить…', key: 'Ctrl+O', icon: 'add',
      title: 'Одно окно для всего: фото, видео, музыка, PowerPoint, песни (текст, ChordPro, OpenLP, EasyWorship, ProPresenter, SongSelect), презентации и темы multiplayerSHOW. Всё — в открытую библиотеку' + (where && !isPl ? ` «${where.name}»` : '') + ', темы — в свои темы',
      fn: () => addAll() },
    { label: 'Live-источник', icon: 'sources', fn: () => { if (!settings.poolOpen) togglePool(); setSrcMode(true); } },
    { label: 'Перевод Библии…', icon: 'bible', fn: () => pickBibles() },
    ...(isPl ? [{ label: 'Из библиотеки в плейлист…', icon: 'library', fn: inLists(openLibPick) }] : []),
    { head: 'Создать' },
    { label: 'Песню', key: 'Ctrl+N', icon: 'music', disabled: noNew, fn: () => { setTab('service'); openSongDialog(null); } },
    { label: 'Презентацию', icon: 'presentation', disabled: noNew, fn: inLists(svcNewPres) },
    { label: 'Слайд — в открытую презентацию', icon: 'slides', fn: inLists(svcAddSlide) },
    { label: 'Тему', icon: 'theme', fn: () => { openThemeTab(); teSlideLeave(); teNewTheme(); } },
    { label: 'Библиотеку', icon: 'library', fn: () => createView('lib') },
    { label: 'Плейлист', icon: 'playlist', fn: () => createView('pl') },
    '-',
    { label: 'Импорт презентации…', title: 'Файл презентации multiplayerSHOW (например, с другого компьютера) — вместе с её темами', disabled: noNew, fn: inLists(importPres) },
    { label: 'Импорт темы…', fn: () => { openThemeTab(); teSlideLeave(); teImport(); } },
    ...addThemeExportItems(),
  ]);
  ctxMenu.dataset.tag = 'add';
}

/* ---------- Презентация в файл и из файла — вместе с темами ----------
   Файл: { app, kind: 'presentation', version, items: [презентация], themes: [темы, которыми они показываются] }.
   Стандартные темы не кладём — они есть в любой программе. Файлы с диска (картинки, видео, шрифты) не переносятся. */
function presThemeIds(items) {
  const ids = new Set();
  for (const it of items) {
    if (it.theme) ids.add(it.theme);
    for (const s of it.slides || []) if (s.theme) ids.add(s.theme);
  }
  return [...ids];
}
async function exportPres(items) {
  if (!items.length) return;
  const themes = presThemeIds(items).map(themeById).filter((t) => t && !t.std);
  const data = { app: 'church-presenter', kind: 'presentation', version: 1, items: clone(items), themes: Themes.exportData(themes).themes.map((t) => { delete t.ext; return t; }) };
  const file = await window.api.saveJson({ name: items.length === 1 ? items[0].name : 'Презентации', data, title: 'Экспорт презентации', label: 'Презентация multiplayerSHOW' });
  if (file) flashStatus('Сохранено: ' + file.split(/[\\/]/).pop() + (themes.length ? ` · тем в файле: ${themes.length}` : ''));
}
async function importPres() {
  if (!findView()) { showNotice('Сначала создайте плейлист или библиотеку', true); return; }
  if (plNoCreate()) return; // как песни — только в библиотеку
  const res = await window.api.openJson({ title: 'Импорт презентации', label: 'Презентация multiplayerSHOW (JSON)' });
  if (!res) return;
  const d = res.ok ? res.data : null;
  if (!d || d.kind !== 'presentation' || !Array.isArray(d.items)) { showNotice('Это не файл презентации multiplayerSHOW', true); return; }
  const { items, ext } = presFromData(d);
  if (!items.length) { showNotice('В файле нет презентаций', true); return; }
  addItems(items, true);
  flashStatus(`Импортировано презентаций: ${items.length}` + (ext ? ` · новых тем: ${ext} — редактор тем, «Из презентаций»: правая кнопка → «Сохранить в темы»` : ''));
}
// Файл презентации → презентации (новые id); её темы, которых здесь нет, — в lib.extThemes (ext — сколько новых)
function presFromData(d) {
  const items = (Array.isArray(d.items) ? d.items : []).filter((it) => it && typeof it === 'object' && Array.isArray(it.slides)).map((it) => {
    const c = Slides.migrate(clone(it));
    c.id = newId();
    c.name = String(c.name || 'Презентация');
    for (const s of c.slides) if (!s.id) s.id = newId();
    return c;
  });
  if (!items.length) return { items, ext: 0 };
  // Темы: своя или стандартная с тем же id уже есть — презентация покажется ею; нет — тема ложится в «Из презентаций»
  // с прежним id (слайды и выбранные вручную шаблоны её находят) и не теряется, пока её не сохранят в темы
  if (!Array.isArray(lib.extThemes)) lib.extThemes = [];
  let ext = 0;
  for (const t of Array.isArray(d.themes) ? d.themes : []) {
    if (!t || typeof t !== 'object' || !t.id || Themes.find(lib.themes, t.id) || lib.extThemes.some((x) => x.id === t.id)) continue;
    const c = Themes.ensure(clone(t));
    delete c.std;
    c.name = String(c.name || 'Тема');
    c.ext = { from: items[0].name };
    lib.extThemes.push(c);
    ext++;
  }
  return { items, ext };
}

/* ---------- «Добавить…»: одно окно для всего ----------
   Фото, видео, музыка, PowerPoint, песни (текст, ChordPro, JSON, OpenLP, EasyWorship, ProPresenter, SongSelect),
   файлы презентаций и тем multiplayerSHOW. Что это — по файлу; всё, кроме тем, — в открытую библиотеку
   (плейлист, медиапул и т. п. не важны: открыта библиотека — туда), темы — в свои темы. */
async function addAll() {
  if (!listsTab()) setTab('service');
  await addAnything(await window.api.addPick({ slideWidth: slideWidth(), groupDecks: true }));
}
// res — main.js add:pick / add:read: { media: { items, errors }, files: [{ name, ext, bytes | db | error }] }
async function addAnything(res, fromDrop) {
  if (!res) return;
  const bad = [...(res.media.errors || [])];
  const songFiles = [];
  const presData = [];
  const themes = [];
  for (const f of res.files || []) {
    if (f.ext === 'json' && f.bytes) {
      let d = null;
      try { d = JSON.parse(decodeText(f.bytes)); } catch { /* не JSON — пусть разберёт песенный импорт */ }
      if (d && d.kind === 'presentation') { presData.push(d); continue; }
      if (d && d.kind === 'theme') { const l = Themes.importData(d); if (l && l.length) themes.push(...l); else bad.push(f.name); continue; }
    }
    songFiles.push(f);
  }
  const media = res.media.items || [];
  if (fromDrop) markPoolFit(media);
  const sr = songFiles.length ? await songItemsFrom(songFiles) : { items: [], bad: [] };
  bad.push(...sr.bad);
  const n = { media: 0, songs: 0, pres: 0, ext: 0 };
  if (media.length || sr.items.length || presData.length) {
    if (!findView()) showNotice('Сначала создайте плейлист или библиотеку', true);
    else if (!plNoCreate()) { // новое — только в библиотеку
      const pres = [];
      for (const d of presData) { const r = presFromData(d); pres.push(...r.items); n.ext += r.ext; }
      addItems([...media.map(fromFileItem), ...sr.items, ...pres], true);
      Object.assign(n, { media: media.length, songs: sr.items.length, pres: pres.length });
    }
  }
  if (themes.length) teAddThemes(themes);
  const parts = [
    n.songs && `песен: ${n.songs}`, n.media && `файлов: ${n.media}`, n.pres && `презентаций: ${n.pres}`,
    themes.length && `тем: ${themes.length}`, n.ext && `тем из презентаций: ${n.ext}`,
  ].filter(Boolean);
  if (bad.length) showNotice((parts.length ? 'Добавлено — ' + parts.join(', ') + '. ' : '') + 'Не получилось: ' + bad.join('; '), true);
  else if (parts.length) flashStatus('Добавлено — ' + parts.join(', ') + (themes.length ? ' · темы — в редакторе тем' : ''));
}

// «Экспорт темы» в меню «＋»: то, что открыто в редакторе тем (выбирать заново не нужно). Открыт свой вид слайда
// («Изменить в редакторе») — его и сохранить как тему или экспортировать; там не открывали — тема песен по умолчанию
function addThemeExportItems() {
  const r = typeof teSlideRef === 'function' ? teSlideRef() : null;
  if (r) {
    const nm = teSlideName(r.item, r.slide);
    return [
      { label: `Сохранить как тему: «${nm}»…`, title: 'Вид слайда, открытый в редакторе тем, станет своей темой — её можно выбрать для любой презентации', fn: () => teSlideSaveTheme(r.item, [r.slide]) },
      { label: `Экспорт как темы: «${nm}»…`, title: 'Вид слайда, открытый в редакторе тем, — в файл темы', fn: () => teSlideExportTheme(r.item, [r.slide]) },
    ];
  }
  const t = (typeof teTheme === 'function' && teTheme()) || themeById(lib && lib.themeFor && lib.themeFor.song);
  if (!t) return [{ label: 'Экспорт темы…', title: 'Сначала откройте тему в редакторе тем', fn: () => { openThemeTab(); flashStatus('Выберите тему слева — и снова «＋» → «Экспорт темы»'); } }];
  return [
    ...(t.ext || t.std ? [{ label: `Сохранить в темы: «${t.name}»`, title: teSaveTitle(t), fn: () => teSaveTheme(t) }] : []),
    { label: `Экспорт темы «${t.name}»…`, title: 'Тема, открытая в редакторе тем, — в файл', fn: () => teExport([t]) },
  ];
}
$('addMenu').addEventListener('click', () => { if (!(menuClosed.tag === 'add' && Date.now() - menuClosed.t < 400)) openAddMenu(); });

document.querySelectorAll('dialog .dlg-x').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

/* Песня (текст, разметка частей, аранжировки) — songs.js */

/* ----- Добавить из библиотеки в плейлист ----- */

function openLibPick() {
  const s = $('libPickSel');
  s.replaceChildren(...lib.libraries.map((l) => Object.assign(document.createElement('option'), { value: l.id, textContent: l.name })));
  $('libPickFilter').value = '';
  renderLibPick();
  $('libPickDialog').showModal();
  $('libPickFilter').focus();
}

function renderLibPick() {
  const l = lib.libraries.find((x) => x.id === $('libPickSel').value);
  const q = $('libPickFilter').value.trim().toLowerCase();
  const box = $('libPickList');
  box.replaceChildren();
  const items = l ? l.items.map((id) => lib.items[id]).filter((it) => it && (!q || it.name.toLowerCase().includes(q))) : [];
  if (!items.length) box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: l ? 'Ничего не найдено' : 'Библиотек пока нет' }));
  for (const it of items) {
    const row = Object.assign(document.createElement('label'), { className: 'pick-row' });
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', value: it.id });
    cb.addEventListener('change', updateLibPickInfo);
    row.append(cb, Object.assign(document.createElement('span'), { className: 'kind', textContent: Slides.PRES_NAMES[it.kind] || '' }), document.createTextNode(it.name));
    row.addEventListener('dblclick', () => { cb.checked = true; $('libPickAdd').click(); });
    box.append(row);
  }
  updateLibPickInfo();
}

function updateLibPickInfo() {
  const n = $('libPickList').querySelectorAll('input:checked').length;
  $('libPickInfo').textContent = n ? `Выбрано: ${n}` : 'Отметьте нужные пункты';
  $('libPickAdd').disabled = !n;
}

$('libPickSel').addEventListener('change', renderLibPick);
$('libPickFilter').addEventListener('input', renderLibPick);
$('libPickAdd').addEventListener('click', () => {
  const pl = findView();
  if (!pl || lib.view.kind !== 'pl') return;
  const first = pl.entries.length;
  $('libPickList').querySelectorAll('input:checked').forEach((cb) => pl.entries.push({ eid: newId(), item: cb.value }));
  if (pl.entries[first]) openIfIdle(pl.entries[first].eid);
  saveLib();
  $('libPickDialog').close();
  renderService();
  if (feedAll() && workIsView()) $('svcFeed').scrollTop = $('svcFeed').scrollHeight;
});

/* ----- Выделение блоков перетаскиванием (резиновая лента) ----- */

let rbState = null;

function rbStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.sl, button, .svc-ihead')) return;
  if (!e.ctrlKey && !e.metaKey) { selItems = []; updatePlaylistLive(); }
  const rb = Object.assign(document.createElement('div'), { className: 'rubber-band' });
  document.body.append(rb);
  const box = e.target.closest('.svc-item');
  rbState = { x0: e.clientX, y0: e.clientY, el: rb, key: box && box.dataset.key, ctrl: e.ctrlKey || e.metaKey };
}

function rbMove(e) {
  if (!rbState) return;
  const x = Math.min(rbState.x0, e.clientX), y = Math.min(rbState.y0, e.clientY);
  const w = Math.abs(e.clientX - rbState.x0), h = Math.abs(e.clientY - rbState.y0);
  Object.assign(rbState.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  if (w < 4 && h < 4) return;
  const inBand = (el) => { const r = el.getBoundingClientRect(); return r.left < x + w && r.right > x && r.top < y + h && r.bottom > y; };
  const add = e.ctrlKey || e.metaKey;
  // Рамка задела слайды — выделяем слайды: Delete уберёт только их, шапка презентации останется
  const slides = [...document.querySelectorAll('#svcFeed .sl')].filter(inBand).map((el) => ({ key: el.dataset.key, sid: el.dataset.sid }));
  if (slides.length) {
    if (!rbState.sel0) rbState.sel0 = add ? sel.slice() : [];
    sel = [...rbState.sel0, ...slides.filter((s) => !rbState.sel0.some((o) => o.key === s.key && o.sid === s.sid))];
    selItems = [];
    selFocus = 'slides';
  } else {
    // Только шапки — выделяем сами пункты
    const hit = [...document.querySelectorAll('#svcFeed .svc-item')].filter(inBand).map((el) => el.dataset.key);
    selItems = add ? [...new Set([...selItems, ...hit])] : hit;
    sel = [];
    selFocus = 'items';
  }
  updatePlaylistLive();
}

function rbEnd(e) {
  if (!rbState) return;
  rbState.el.remove();
  const st = rbState;
  rbState = null;
  // Просто щелчок (без рамки) по свободному месту презентации — выделить её, как щелчком по шапке:
  // Ctrl+V вставит скопированные слайды в её конец
  if (st.key && Math.abs(e.clientX - st.x0) < 4 && Math.abs(e.clientY - st.y0) < 4) {
    browseWork();
    selItems = st.ctrl ? (isItemSelected(st.key) ? selItems.filter((k) => k !== st.key) : selItems.concat([st.key])) : [st.key];
    itemAnchor = st.key;
    selFocus = 'items';
    sel = [];
    updatePlaylistLive();
  }
}

// Заставка ждёт его (splash.js). Начинаем, когда подключены все скрипты: лента нужна songs.js
const serviceReady = (document.readyState === 'loading' ? new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true })) : Promise.resolve()).then(initService);
$('svcFeed').addEventListener('mousedown', rbStart);
window.addEventListener('mousemove', rbMove);
window.addEventListener('mouseup', rbEnd);
