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
const themeById = (id) => (lib ? (lib.themesLive && lib.themesLive[id]) || Themes.find(lib.themes, id) : null);
const appliedThemes = () => (lib ? lib.themes.map((t) => (lib.themesLive && lib.themesLive[t.id]) || t) : []);

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
  window.api.libSave(lib).catch(() => showNotice('Не удалось сохранить плейлисты и библиотеки', true));
  if (typeof mcLibSaved === 'function') mcLibSaved(); // макросы: «Добавлено в плейлист»
  if (typeof repoTouch === 'function') repoTouch('lib'); // репозиторий (tools.js)
}

/* ----- Отмена и повтор (Ctrl+Z, Ctrl+Shift+Z): снимки содержимого при каждом сохранении ----- */
// Правки за 0,3 с до сохранения — один шаг. Открытый список (view) не входит: отмена не переключает вид.
const HIST_KEYS = ['items', 'libraries', 'playlists', 'themes', 'themeFor', 'tplFor', 'themesLive', 'macros', 'fileMacros', 'screens', 'scenes', 'scenePresets', 'timers', 'verseSplits'];
const HIST_MAX = 30;           // шагов назад
const HIST_CHARS = 80e6;       // и не больше ~80 млн символов на всю историю (большие библиотеки), но не меньше 5 шагов
let histCur = null;            // снимок того, что сохранено сейчас
let histUndo = [];
let histRedo = [];
const histSnap = () => JSON.stringify(HIST_KEYS.map((k) => lib[k]));

function histTake() {
  if (!lib) return;
  const now = histSnap();
  if (histCur === null || now === histCur) { histCur = now; return; }
  histUndo.push(histCur);
  histRedo = [];
  histCur = now;
  let size = histUndo.reduce((n, s) => n + s.length, 0);
  while (histUndo.length > HIST_MAX || (histUndo.length > 5 && size > HIST_CHARS)) size -= histUndo.shift().length;
}

function histApply(snap) {
  const liveWas = JSON.stringify(lib.themesLive || null);
  const splitsWas = JSON.stringify(lib.verseSplits || null);
  JSON.parse(snap).forEach((v, i) => { if (v === undefined || v === null) delete lib[HIST_KEYS[i]]; else lib[HIST_KEYS[i]] = v; });
  histCur = snap;
  window.api.libSave(lib).catch(() => showNotice('Не удалось сохранить плейлисты и библиотеки', true));
  if (!findView()) lib.view = lib.playlists[0] ? { kind: 'pl', id: lib.playlists[0].id } : lib.libraries[0] ? { kind: 'lib', id: lib.libraries[0].id } : null;
  const keys = new Set(viewEntries().map((x) => x.key));
  selItems = selItems.filter((k) => keys.has(k));
  sel = [];
  renderService();
  if (typeof teAfterUndo === 'function') teAfterUndo(); // вкладка «Темы» — по вернувшимся темам
  if (typeof mcAfterUndo === 'function') mcAfterUndo(); // «Макросы» — по вернувшимся макросам
  if (typeof scAfterUndo === 'function') scAfterUndo(); // «Экраны» — экраны и сцены как были
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

function slideThumb(item, slide) {
  // Как в ProPresenter: картинка слайда, под ней полоска с номером и подписью
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
    const m = document.createElement(slide.k === 'video' ? 'video' : 'img');
    if (slide.k === 'video') { m.src = slide.url + '#t=0.1'; m.muted = true; m.preload = 'metadata'; } else { m.src = slide.url; m.loading = 'lazy'; }
    m.draggable = false;
    pic.append(m);
    if (slide.k === 'video') pic.append(Object.assign(document.createElement('span'), { className: 'vbadge', textContent: '▶' }));
  } else {
    // Текст, Библия и свои слайды рисуем той же сценой, что и экран, — с темой
    const content = contentOf(item, slide);
    if (content.style) content.style = { ...content.style, bgVideo: false, bgUrl: content.style.bgVideo ? '' : content.style.bgUrl, still: true };
    pic.append(Scene.build(content));
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
  const isCur = (kind, x) => listsTab() && !!lib.view && lib.view.kind === kind && lib.view.id === x.id;
  const row = (kind, x, count) => {
    const b = Object.assign(document.createElement('button'), { className: 'svc-row' + (isCur(kind, x) ? ' cur' : ''), draggable: true });
    b.dataset.view = kind + ':' + x.id; // сюда бросают файлы из медиапула (poolDrop)
    b.append(ico(kind), document.createTextNode(x.name), Object.assign(document.createElement('span'), { className: 'cnt', textContent: count }));
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
      let itemId = e.dataTransfer.getData('application/x-cp-item');
      const sl = e.dataTransfer.getData('application/x-cp-slides');
      if (sl && !itemId) {
        // Слайды на библиотеку — новой презентацией из их копий; в плейлисте новое не создаётся
        if (kind === 'pl') { e.preventDefault(); e.stopPropagation(); showNotice(PL_ONLY_DRAG, true); return; }
        const slides = draggedSlides(sl);
        if (!slides.length) return;
        const p = { id: newId(), type: 'pres', name: 'Слайды', slides: Slides.copy(slides) };
        p.kind = Slides.presKind(p);
        lib.items[p.id] = p;
        itemId = p.id;
      }
      if (!itemId || !lib.items[itemId]) return;
      e.preventDefault();
      e.stopPropagation();
      if (kind === 'pl') x.entries.push({ eid: newId(), item: itemId });
      else if (!x.items.includes(itemId)) x.items.push(itemId);
      saveLib();
      renderService();
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
  updatePlaylistLive();
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
  if (!entries.length) {
    const empty = Object.assign(document.createElement('div'), { className: 'svc-empty' });
    empty.append(Object.assign(document.createElement('img'), { src: 'brand/icon.svg', alt: '', draggable: false }), document.createTextNode('Нет содержимого'));
    $('contentList').replaceChildren(empty);
    return;
  }
  $('contentList').replaceChildren(...entries.map((x) => {
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
    // Перетащить на другой плейлист — добавить; внутри плейлиста — поменять порядок
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cp-item', item.id);
      if (kind === 'pl') e.dataTransfer.setData('application/x-cp-entry', key);
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    // В плейлисте пункт можно перетащить на другое место; стихи из «Библии», брошенные на пункт, встают перед ним
    b.addEventListener('dragover', (e) => { if ((kind === 'pl' && e.dataTransfer.types.includes('application/x-cp-entry')) || isListDrag(e)) { e.preventDefault(); e.stopPropagation(); b.classList.add('drop'); } });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', (e) => {
      b.classList.remove('drop');
      $('contentBox').classList.remove('drop');
      if (isListDrag(e)) { e.preventDefault(); e.stopPropagation(); dropList(e, kind, v, key); return; }
      const from = kind === 'pl' && e.dataTransfer.getData('application/x-cp-entry');
      if (!from) return;
      e.preventDefault();
      e.stopPropagation();
      reorderEntry(from, key);
    });
    return b;
  }));
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

// Поменять порядок в плейлисте: запись from встаёт на место записи to
function reorderEntry(from, to, view = lib.view) {
  const list = findView(view).entries;
  const a = list.findIndex((x) => x.eid === from);
  const b = list.findIndex((x) => x.eid === to);
  if (a < 0 || b < 0 || a === b) return updatePlaylistLive();
  const [moved] = list.splice(a, 1);
  list.splice(b, 0, moved);
  saveLib();
  renderService();
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
  feed.replaceChildren();
  const v = findView(work);
  const isPl = !!v && work.kind === 'pl';
  $('svcKind').textContent = !v ? '' : isPl ? 'Плейлист' : 'Библиотека';
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
    head.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cp-item', item.id);
      if (isPl) e.dataTransfer.setData('application/x-cp-entry', key);
      e.dataTransfer.effectAllowed = 'copyMove';
    });
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
    // Стихи или источник, брошенные на пункт ленты, встают перед ним
    box.addEventListener('dragover', (e) => { if (isListDrag(e)) { e.preventDefault(); e.stopPropagation(); box.classList.add('drop-item'); } });
    if (!isPl) box.addEventListener('dragleave', () => box.classList.remove('drop-item'));
    box.addEventListener('drop', (e) => {
      if (!isListDrag(e)) return;
      box.classList.remove('drop-item');
      e.preventDefault();
      e.stopPropagation();
      dropList(e, work.kind, findView(work), key);
    });
    if (isPl) {
      box.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-cp-entry')) { e.preventDefault(); e.stopPropagation(); box.classList.add('drop-item'); } });
      box.addEventListener('dragleave', () => box.classList.remove('drop-item'));
      box.addEventListener('drop', (e) => {
        box.classList.remove('drop-item');
        const from = e.dataTransfer.getData('application/x-cp-entry');
        if (!from) return;
        e.preventDefault();
        e.stopPropagation();
        reorderEntry(from, key, work);
      });
    }

    const grid = Object.assign(document.createElement('div'), { className: 'svc-slides' });
    if (!item.slides.length) grid.append(Object.assign(document.createElement('div'), { className: 'svc-noslides', textContent: 'Слайдов нет — вставьте (Ctrl+V) или перетащите сюда' }));
    item.slides.forEach((slide) => {
      const el = slideThumb(item, slide);
      el.dataset.key = key;
      el.dataset.sid = slide.id;
      el.draggable = true;
      el.title = Slides.SLIDE_NAMES[slide.k] + (slide.k === 'audio' ? ' — щелчок включает музыку' : '');
      if (typeof mcSlideBadge === 'function') mcSlideBadge(el, item, slide); // привязанные макросы
      el.addEventListener('click', (e) => slideClick(e, key, slide.id));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); slideMenu(e, key, slide.id); });
      el.addEventListener('dragstart', (e) => {
        const sids = isSelected(key, slide.id) ? sel.filter((x) => x.key === key).map((x) => x.sid) : [slide.id];
        e.dataTransfer.setData('application/x-cp-slides', JSON.stringify({ view: workKey(), key, sids }));
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
  const onSide = plShown && plShown.view === viewKey();  // «Содержание» — список, открытый слева
  const same = workIsView();
  document.querySelectorAll('#svcFeed .sl').forEach((el) => {
    el.classList.toggle('live', !!on && el.dataset.key === plShown.key && el.dataset.sid === plShown.sid);
    el.classList.toggle('live-ov', Object.values(ovShown).some((o) => o.view === workKey() && o.key === el.dataset.key && o.sid === el.dataset.sid));
    el.classList.toggle('sel', isSelected(el.dataset.key, el.dataset.sid));
  });
  document.querySelectorAll('#svcFeed .svc-item').forEach((el) => {
    el.classList.toggle('live-item', !!on && el.dataset.key === plShown.key);
    el.classList.toggle('sel-item', same && isItemSelected(el.dataset.key));
  });
  const many = selItems.length > 1;
  document.querySelectorAll('.svc-sub').forEach((el) => {
    const k = el.dataset.key;
    el.classList.toggle('live', !!onSide && k === plShown.key);
    // Открыт в ленте (рабочий) — рамка; выделен для просмотра, но не открыт — подсветка выбора
    const open = same && (feedAll() ? isItemSelected(k) : k === openKey);
    el.classList.toggle('open', open);
    el.classList.toggle('picked', isItemSelected(k) && (many || tab === 'bible' || !open));
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
  showSlide(key, sid);
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
    updatePlaylistLive(); // триггеры слайдов макросов не трогаем (на Overlay срабатывает «Слой»)
    return;
  }
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
  if (slide.k !== 'audio') autoArm(key, item, slide, vk); // авто-переключение по таймеру (item.auto)
  // Листание дошло до следующего пункта — в режиме «один пункт» открыть его
  if (vk === workKey() && !feedAll() && key !== openKey) { openKey = key; renderFeed(); }
  updatePlaylistLive();
  if (typeof mcSlideShown === 'function') mcSlideShown(entry, slide, vk); // триггеры макросов (macros.js)
  if (typeof stSlideShown === 'function') stSlideShown(entry, slide); // свой сценический макет у слайда (stage.js)
  const el = document.querySelector(`#svcFeed .sl[data-key="${key}"][data-sid="${sid}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function plStep(d) {
  const flat = flatSlides();
  if (!flat.length) return;
  const cur = plShown && plShown.view === workKey() ? flat.findIndex((x) => x.key === plShown.key && x.sid === plShown.sid) : -1;
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

// Слайды, которые тянут мышью
function draggedSlides(data) {
  try {
    const d = JSON.parse(data);
    const e = entryByKey(d.key, keyView(d.view));
    return e ? d.sids.map((sid) => e.item.slides.find((s) => s.id === sid)).filter(Boolean) : [];
  } catch { return []; }
}

// Бросили слайды: внутри той же презентации — переставить, в другую — скопировать
function dropSlides(data, target, beforeSid) {
  let d;
  try { d = JSON.parse(data); } catch { return; }
  const src = entryByKey(d.key, keyView(d.view));
  const slides = draggedSlides(data);
  if (!src || !slides.length) return;
  if (src.item === target) {
    if (slides.some((s) => s.id === beforeSid)) return;
    target.slides = target.slides.filter((s) => !slides.includes(s));
    const at = beforeSid ? target.slides.findIndex((s) => s.id === beforeSid) : target.slides.length;
    target.slides.splice(at < 0 ? target.slides.length : at, 0, ...slides);
  } else {
    const copies = Slides.copy(slides);
    const at = beforeSid ? target.slides.findIndex((s) => s.id === beforeSid) : target.slides.length;
    target.slides.splice(at < 0 ? target.slides.length : at, 0, ...copies);
  }
  touched(target);
  renderService();
}

// Короткое сообщение внизу слева (вместо всплывающих окон), само исчезает
let flashTimer = 0;
function flashStatus(text) {
  const st = $('status');
  clearTimeout(flashTimer);
  st.textContent = text;
  flashTimer = setTimeout(() => { st.textContent = ''; }, 1800);
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
    if (it.key) b.append(Object.assign(document.createElement('span'), { className: 'ctx-key', textContent: it.key }));
    b.addEventListener('click', () => { closeMenu(); it.fn(); });
    ctxMenu.append(b);
  }
  // открыто окно (например, «Настройки → Экран и вывод») — меню внутри него, иначе окажется под ним
  ([...document.querySelectorAll('dialog[open]')].pop() || document.body).append(ctxMenu);
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - r.width - 6) + 'px';
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - r.height - 6) + 'px';
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
    flashStatus((id ? `Слой: «${layerName(layerById(id))}»` : 'Слой выбирается сам') + (list.length > 1 ? ` (пунктов: ${list.length})` : '') + ' · Ctrl+Z — вернуть');
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
  const el = document.querySelector(`#contentList .svc-sub[data-key="${CSS.escape(x.key)}"]`);
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

async function svcAddFiles() {
  if (!findView() || plNoCreate()) return;
  addFileResult(await window.api.pickMedia({ slideWidth: slideWidth(), groupDecks: true }));
}

async function svcAddPaths(paths, fromPool) {
  if (!findView()) return;
  if (!fromPool && plNoCreate()) return; // из Проводника в плейлист — нельзя, из медиапула — можно
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
    return { name: `${refString(main)} (+ ${bSet.x1}-${bSet.x2})`, slides: b.slides };
  }
  const keys = bibleKeysForAction();
  if (!keys.length) { flashStatus('Сначала выберите стихи: щелчок по стиху, в «Слайдах» Ctrl/Shift+щелчок — несколько'); return null; }
  return bibleSlidesFor(keys);
}

// Стихи (ключи «книга:глава:стих» по порядку) → { name, slides }, по слайду на стих (длинный — по слайду на часть).
// extraOf(k) — дополнительный ли стих
function bibleSlidesFor(keys, extraOf) {
  const slides = keys.filter(verseText).flatMap((k) => verseParts(k).map((_, pi) => bibleSlide([k], pi, extraOf && extraOf(k))));
  // Целые главы называем коротко: «Иоанна 3-4», а не «Иоанна 3:1-36; 4:1-54»
  const chs = [];
  for (const k of keys) { const { bi, ci } = unkey(k); if (!chs.some((x) => x[0] === bi && x[1] === ci)) chs.push([bi, ci]); }
  const whole = chapterKeys(chs).length === keys.length;
  return { name: whole ? chaptersTitle(chs) : refString(keys), slides };
}

// Выделенные стихи — в открытый слева плейлист или библиотеку отдельной презентацией, по стиху на слайд
function svcAddBible() {
  const b = bibleSlidesSelected();
  if (!b) return;
  const v = findView();
  if (!v) { showNotice('Сначала создайте плейлист: «＋» у «Плейлистов» слева', true); return; }
  const it = { id: newId(), type: 'pres', kind: 'bible', name: b.name, slides: b.slides };
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
    const it = { id: newId(), type: 'pres', kind: 'bible', name: b.name, slides: b.slides };
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

// Готовая презентация из «Содержания» библиотеки (не запись плейлиста — та переставляется)
const isLibItemDrag = (e) => e.dataTransfer.types.includes('application/x-cp-item') && !e.dataTransfer.types.includes('application/x-cp-entry');

// Пустое место «Содержания» и ленты — стихи, источник или готовая презентация в конец списка
// («Содержание» — открытый слева список, лента — рабочий: можно тянуть из библиотеки прямо в ленту плейлиста)
for (const id of ['contentBox', 'svcFeed']) {
  const el = $(id);
  const target = () => (id === 'svcFeed' && work && findView(work) ? { kind: work.kind, v: findView(work) } : findView() ? { kind: lib.view.kind, v: findView() } : null);
  el.addEventListener('dragover', (e) => { if ((isListDrag(e) || isPoolDrag(e) || isLibItemDrag(e)) && target()) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop');
    const t = target();
    if (!t) return;
    if (isLibItemDrag(e)) {
      const itemId = e.dataTransfer.getData('application/x-cp-item');
      if (!lib.items[itemId]) return;
      e.preventDefault();
      if (t.kind !== 'pl' && t.v.items.includes(itemId)) return;
      putItem(t.kind, t.v, itemId, null);
      saveLib();
      renderService();
      flashStatus(`«${lib.items[itemId].name}» → «${t.v.name}»`);
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
  const name = freeName(kind, (kind === 'pl' ? 'Плейлист ' : 'Библиотека ') + new Date().toLocaleDateString('ru-RU'));
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
  if (!(await askYes(isPl ? `Удалить плейлист «${v.name}»? Песни в библиотеках останутся.` : `Удалить библиотеку «${v.name}»? Презентации, которые стоят в плейлистах, там останутся.`, 'Удалить', true))) return;
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
  showMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
    ...(noNew ? [{ label: 'Открыт плейлист: новое — в библиотеке, сюда — перетащить', disabled: true, fn() {} }, '-'] : []),
    { label: 'Добавить песню', key: 'Ctrl+N', disabled: noNew, fn: () => { setTab('service'); openSongDialog(null); } },
    { label: 'Импортировать песни…', disabled: noNew, fn: inLists(importSongs) },
    { label: 'Добавить Live-источник', fn: () => { if (!settings.poolOpen) togglePool(); setSrcMode(true); } },
    { label: 'Добавить файл…', key: 'Ctrl+O', disabled: noNew, fn: () => (listsTab() ? inLists(svcAddFiles)() : pickFiles()) },
    { label: 'Добавить библиотеку', fn: () => createView('lib') },
    '-',
    { label: 'Свой слайд — в открытую презентацию', fn: inLists(svcAddSlide) },
    { label: 'Новая презентация', disabled: noNew, fn: inLists(svcNewPres) },
    { label: 'Из библиотеки в плейлист…', disabled: !isPl, fn: inLists(openLibPick) },
    { label: 'Новый плейлист', fn: () => createView('pl') },
    { label: 'Перевод Библии…', fn: () => pickBibles() },
  ]);
  ctxMenu.dataset.tag = 'add';
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
  rbState = { x0: e.clientX, y0: e.clientY, el: rb };
}

function rbMove(e) {
  if (!rbState) return;
  const x = Math.min(rbState.x0, e.clientX), y = Math.min(rbState.y0, e.clientY);
  const w = Math.abs(e.clientX - rbState.x0), h = Math.abs(e.clientY - rbState.y0);
  Object.assign(rbState.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  if (w < 4 && h < 4) return;
  const hit = [];
  document.querySelectorAll('#svcFeed .svc-item').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) hit.push(el.dataset.key);
  });
  selItems = e.ctrlKey || e.metaKey ? [...new Set([...selItems, ...hit])] : hit;
  sel = [];
  updatePlaylistLive();
}

function rbEnd() {
  if (!rbState) return;
  rbState.el.remove();
  rbState = null;
}

// Заставка ждёт его (splash.js). Начинаем, когда подключены все скрипты: лента нужна songs.js
const serviceReady = (document.readyState === 'loading' ? new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true })) : Promise.resolve()).then(initService);
$('svcFeed').addEventListener('mousedown', rbStart);
window.addEventListener('mousemove', rbMove);
window.addEventListener('mouseup', rbEnd);
