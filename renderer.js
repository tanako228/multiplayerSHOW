const $ = (id) => document.getElementById(id);
const grid = $('grid');
// Монитор «Основного» и кнопка вывода — без места в окне: выбор монитора — в Редакторе сцен (screens.js), вывод — галочка «Зал»
const displaySel = $('display') || document.createElement('select');
const toggleBtn = $('toggleOutput') || document.createElement('button');
const notice = $('notice');
const prevWrap = $('previewWrap');
const prevStage = $('previewStage');
const peekStage = $('peekStage'); // просмотр без вывода — поверх «Предпросмотра»

/* ---------- Настройки (запоминаются между запусками) ---------- */

const DEFAULTS = {
  fit: 'contain', transType: 'fade', transMs: 600,
  res: 'auto', resW: 3840, resH: 2160,
  videoSound: false, videoLoop: true, outFit: 'fit', outDisplay: 0,
  textFont: 'segoe', textScale: 100, textColor: '#ffffff', textBg: '#000000', showTr: true,
  trShort: false, // переводы сокращённо: «RST» вместо «Russian Synodal Translation»
  bibleId: null,
  // Переводы на экране, до 4 строк { id, text, ref }; первая — открытый перевод (id не нужен).
  // text / ref — куда идут текст стиха и ссылка: 'auto' — обычное место, '' — нет, иначе — имя текстового окна шаблона темы Библии
  bSlots: null,
  // Длинный стих: 'fit' — уменьшать текст, 'split' — делить на слайды 7A, 7B…; пределы — мин. размер текста (% высоты экрана),
  // символов на слайде (0 — без предела), сколько частей самое большее
  vSplit: 'fit', vMinFont: 4, vMaxChars: 0, vMaxParts: 3,
  bmOpen: false, bmDock: 'bottom', bmSizeV: 150, bmSizeH: 260,
  keys: {}, audioSink: '',
  // Звук видео на выводе: громкость, выключен ли (Mute), устройство ({ id, label }; пусто — как в Windows); musicMute — Mute музыки
  videoVol: 1, videoMute: false, videoSink: null, musicMute: false,
  lyFold: false, // панель «Слои» под предпросмотром свёрнута
  prevScreen: '', // какой экран в окне предпросмотра ('' — программа)
  prevH: 0, // высота поля «Предпросмотра», px (0 — по пропорции экрана); картинка в поле — целиком, по центру
  asideOrder: null, // порядок блоков под предпросмотром: ['layers', 'music', 'macros', 'timers']
  tmFold: false, // блок «Таймеры» свёрнут
  outAutoOn: false, // при запуске: вывод на монитор и экраны/сцены — как были (выключено — всё выключено)
  inkKeep: false, poolOpen: false, poolH: 240, poolFolders: [], poolCur: '', poolFit: 'contain',
  poolSrc: false, // в медиапуле открыт раздел «Источники»
  uiTheme: '', uiColors: {}, uiGlow: 0, uiGlass: '', uiRadius: 6, uiAlpha: 16, uiBlur: 18, uiFont: '', uiCaps: false, plFeed: true, // uiGlow/uiGlass/uiRadius/uiAlpha/uiBlur/uiFont/uiCaps — эффекты оформления (tools.js, applyUiColors)
  // uiTheme — тема программы (UI_THEMES в tools.js), пусто — «Тёмно-синяя» sideFold: false, contentFold: false,
  musicRoot: '', musicSrc: null, musicVol: 0.8, fadeOut: 2, fadeIn: 1, autoNext: true,
  scaleBible: 190, scaleScreen: 170, // ширина слайда-миниатюры (Scale под предпросмотром)
  sizes: {}, // ширины панелей, заданные разделителями: { aside: 420, col: 260, … }
  ssOn: false, ssMin: 5, ssKind: 'clock', // заставка от выгорания OLED: включена, через сколько минут, вид
  guardCursor: true, // курсор не уходит на мониторы, где идёт показ (main.js: guardCursor)
};
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('cp.settings') || '{}')); } catch { /* первый запуск */ }
settings.sizes = { ...settings.sizes };
// Перенос: второй перевод и галочки ссылок (до строк переводов) → bSlots
if (!Array.isArray(settings.bSlots) || !settings.bSlots.length) {
  settings.bSlots = [{ id: '', text: 'auto', ref: settings.bRef1 === false ? '' : 'auto' }];
  if (settings.bible2Id) settings.bSlots.push({ id: settings.bible2Id, text: settings.b2Text === false ? '' : 'auto', ref: settings.bRef2 === false ? '' : 'auto' });
}
// Перенос: раньше видео шло без звука по умолчанию — теперь со звуком (выключить — Mute в проигрывателе или галочка в настройках)
if (!settings.vsOn) { settings.videoSound = true; settings.vsOn = 1; }
['bible2Id', 'b2Text', 'bRef1', 'bRef2', 'b2Split', 'b1Size', 'b2Size', 'b1Color', 'b2Color', 'b1Italic', 'b2Italic'].forEach((k) => delete settings[k]);
const saveSettings = () => {
  try { localStorage.setItem('cp.settings', JSON.stringify(settings)); } catch { /* не страшно */ }
  if (typeof repoTouch === 'function') repoTouch(); // репозиторий (tools.js) — записать через несколько секунд
};

// Переходы — из scene.js (общий список для вывода, сцен и своих переходов презентаций/слайдов)
const transOptions = (sel, extra) => sel.replaceChildren(...[...(extra || []), ...Scene.TRANS].map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
transOptions($('transType'));
if (!Scene.TRANS.some(([v]) => v === settings.transType)) settings.transType = 'fade';

const BINDINGS = [
  // Разрешение «Основного» (res resW resH outFit) и «Включать вывод при запуске» — в Редакторе сцен (screens.js: scMainRows)
  ['transType', 'str'], ['transMs', 'num'],
  ['fit', 'str'], ['videoSound', 'check'], ['videoLoop', 'check'],
  // Шрифт, размер и цвета текста Библии без темы (textFont…textBg) — только в настройках; оформление — в темах и окне «Библия»
  ['poolFit', 'str'], ['plFeed', 'check'], ['fadeOut', 'num'], ['fadeIn', 'num'], ['autoNext', 'check'],
  ['ssOn', 'check'], ['ssMin', 'num'], ['ssKind', 'str'], // заставка от выгорания OLED (main.js: saverSet)
  ['guardCursor', 'check'], // защита экранов показа (main.js: guardSync)
];

const VISUAL_KEYS = ['fit', 'videoSound', 'videoLoop', 'textFont', 'textScale', 'textColor', 'textBg', 'showTr', 'trShort'];

BINDINGS.forEach(([key, kind, id]) => {
  const el = $(id || key);
  if (kind === 'check') el.checked = !!settings[key]; else el.value = settings[key];
  if (el.type === 'range' && DEFAULTS[key] != null) el.dataset.def = DEFAULTS[key]; // двойной щелчок — по умолчанию (icons.js)
  el.addEventListener(kind === 'check' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
    settings[key] = kind === 'check' ? el.checked : kind === 'num' ? Number(el.value) : el.value;
    saveSettings();
    onSettingChanged(key);
  });
});
if (!/^(auto|custom|\d+x\d+)$/.test(String(settings.res))) settings.res = 'auto';

// Заставка от выгорания OLED: настройки — в main.js (там видно, сколько не трогали мышь), «Проверить» — показать сразу
// Заставок Windows больше нет (владелец: «только встроенные», см. ПОДРОБНО.md) — выбранная раньше 'win:…' становится часами
if (String(settings.ssKind || '').startsWith('win:')) { settings.ssKind = 'clock'; if ($('ssKind')) $('ssKind').value = 'clock'; }
function sendSaver() {
  if (window.api && window.api.saverSet) window.api.saverSet({ on: settings.ssOn, min: settings.ssMin, kind: settings.ssKind });
}
sendSaver();
// Защита экранов показа: курсор не уходит на мониторы вывода (Win+D окна вывода не сворачивает всегда — main.js)
function sendGuard() { if (window.api && window.api.guardSet) window.api.guardSet({ cursor: !!settings.guardCursor }); }
sendGuard();
$('ssTest').addEventListener('click', async () => {
  if (!window.api || !window.api.saverTest) return;
  const r = await window.api.saverTest();
  if (r === 'busy') flashStatus('На этом мониторе открыт вывод — заставка его не перекрывает');
});

function onSettingChanged(key) {
  $('transMsVal').textContent = (settings.transMs / 1000).toFixed(1) + ' с';
  // Fade In / Fade Out — на кнопке и рядом со шкалой
  const sec = (v) => (v ? v.toFixed(1) + ' с' : 'выкл.');
  $('fadeOutVal').textContent = $('fadeOutVal2').textContent = sec(settings.fadeOut);
  $('fadeInVal').textContent = $('fadeInVal2').textContent = sec(settings.fadeIn);
  if (['res', 'resW', 'resH', 'outFit'].includes(key)) { sendOutputSettings(); layoutPreview(); }
  if (VISUAL_KEYS.includes(key)) refreshLive();
  if (key === 'plFeed' && typeof renderService === 'function') renderService();
  if (['ssOn', 'ssMin', 'ssKind'].includes(key)) sendSaver();
  if (key === 'guardCursor') sendGuard();
  if (key === 'trShort' && typeof renderChips === 'function' && typeof bibleIndex !== 'undefined') renderChips();
  if (key === 'showTr' || key === 'trShort') {
    syncTrShow();
    // Подпись видна и на миниатюрах — перерисовываем их
    if (typeof bible !== 'undefined' && bible && bOpen && slidesMode()) renderVerses();
    if (typeof renderService === 'function' && lib) renderService();
  }
}

// «Под стихами на экране»: место и перевод или только место (окно «Библия»)
function syncTrShow() {
  document.querySelectorAll('input[name=trShow]').forEach((r) => { r.checked = r.value === (settings.showTr ? '1' : '0'); });
  $('trShort').checked = !!settings.trShort;
}
$('trShort').addEventListener('change', () => {
  settings.trShort = $('trShort').checked;
  saveSettings();
  onSettingChanged('trShort');
  flashStatus(settings.trShort ? 'Переводы — сокращённо' : 'Переводы — полным названием');
});

/* Окно «Библия»: какие переводы на экране и в какие окна темы, деление длинных стихов */
const MAX_SLOTS = 4;
function setBibleLook(key, value) {
  settings[key] = value;
  saveSettings();
  syncParUi();
  if (typeof bibleLookChanged === 'function') bibleLookChanged();
}
// Строки переводов поменялись: подгрузить переводы, перерисовать окно, экран и миниатюры
async function slotsChanged() {
  saveSettings();
  await loadSlotBibles();
  syncParUi();
  bibleLookChanged();
}

// Тема и шаблон Библии и текстовые окна шаблона — для списков «Стих» и «Ссылка».
// Окна берём из черновика темы (вкладка «Темы»): только что созданное окно видно сразу, на экране — после «Применить тему»
function bibleTplBoxes() {
  const none = { boxes: [], name: '', theme: null, tpl: null, objs: [], unapplied: false };
  if (typeof lib === 'undefined' || !lib || typeof themeIdFor !== 'function') return none;
  const id = themeIdFor('bible');
  const theme = Themes.find(lib.themes, id);
  if (!theme) return none;
  const st = { ...Themes.style(theme), tpl: tplIdFor('bible') };
  const t = Scene.pickTpl({ type: 'text', verses: [{ n: 1, t: '' }], style: st });
  const objs = t ? t.objs || [] : [];
  return {
    boxes: [...Scene.textLabels(objs).values()], name: theme.name, theme, tpl: t, objs,
    unapplied: typeof teDirty === 'function' && teDirty(theme),
  };
}

// Выбор темы и шаблона Библии прямо в окне «Библия» (то же, что «Тема по умолчанию: Библия» во «Темах»)
function fillBibleThemeSel(B) {
  const ts = $('bThemeSel');
  ts.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'Без темы' }),
    ...Themes.all(lib.themes).map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })));
  ts.value = B.theme ? B.theme.id : '';
  const ps = $('bTplSel');
  const list = Themes.templatesOf(B.theme);
  ps.replaceChildren(...list.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name || 'Шаблон' })));
  ps.disabled = !list.length;
  ps.value = B.tpl ? B.tpl.id : '';
}
function bibleThemeSet(themeId, tplId) {
  lib.themeFor.bible = themeId;
  if (!lib.tplFor) lib.tplFor = {};
  if (themeId && tplId) lib.tplFor.bible = tplId; else delete lib.tplFor.bible;
  saveLib();
  syncParUi();
  bibleLookChanged();
  if (typeof renderService === 'function') renderService();
}
$('bThemeSel').addEventListener('change', (e) => {
  const t = Themes.find(lib.themes, e.target.value);
  // Сразу шаблон для Библии этой темы, если есть
  const list = Themes.templatesOf(t);
  const tp = list.find((x) => x.use === 'bible') || list[0];
  bibleThemeSet(e.target.value, tp ? tp.id : '');
});
$('bTplSel').addEventListener('change', (e) => bibleThemeSet(lib.themeFor.bible || '', e.target.value));

// Старое «Авто» → окно шаблона, привязанное к тексту слайда / ссылке (теперь выбираются только окна темы или «Нет»)
function slotsToBoxes(B) {
  if (!B.boxes.length) return false;
  const labels = Scene.textLabels(B.objs);
  const byBind = (bind) => { const o = B.objs.find((x) => labels.has(x) && x.bind === bind); return o ? labels.get(o) : ''; };
  let changed = false;
  settings.bSlots.forEach((s) => {
    if (s.text === 'auto' || s.text == null) { s.text = byBind('content'); changed = true; }
    if (s.ref === 'auto' || s.ref == null) { s.ref = byBind('ref'); changed = true; }
  });
  if (changed) saveSettings();
  return changed;
}

// Строки «Перевод · Стих · Ссылка»
function renderSlots() {
  const box = $('slotRows');
  box.replaceChildren();
  const B = bibleTplBoxes();
  const { boxes, name } = B;
  if (typeof lib !== 'undefined' && lib) fillBibleThemeSel(B);
  if (slotsToBoxes(B) && typeof bibleLookChanged === 'function') setTimeout(bibleLookChanged);
  const pick = (val) => {
    const sel = document.createElement('select');
    const add = (v, t) => sel.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
    add('', 'Нет');
    boxes.forEach((b) => add(b, b));
    if (val && val !== 'auto' && !boxes.includes(val)) add(val, `${val} (нет в этом шаблоне)`);
    if (val === 'auto' && !boxes.length) add('auto', 'Как в простой теме');
    sel.value = val == null ? '' : val;
    sel.disabled = !boxes.length;
    return sel;
  };
  settings.bSlots.forEach((s, i) => {
    const row = Object.assign(document.createElement('div'), { className: 'slot-row' });
    row.append(Object.assign(document.createElement('span'), { className: 'slot-n', textContent: i + 1 }));
    let tr;
    if (!i) tr = Object.assign(document.createElement('span'), { className: 'slot-main', textContent: `Открытый: ${bibleLabel() || '—'}`, title: 'Первая строка — перевод, открытый в «Библии» (кнопки переводов сверху)' });
    else {
      tr = document.createElement('select');
      tr.append(Object.assign(document.createElement('option'), { value: '', textContent: '— выберите —' }));
      for (const t of bibleIndex) tr.append(Object.assign(document.createElement('option'), { value: t.id, textContent: trLabel(t) }));
      tr.value = bibleIndex.some((t) => t.id === s.id) ? s.id : '';
      tr.addEventListener('change', () => { s.id = tr.value; slotsChanged(); });
    }
    const tx = pick(s.text);
    tx.addEventListener('change', () => { s.text = tx.value; slotsChanged(); });
    const rf = pick(s.ref);
    rf.addEventListener('change', () => { s.ref = rf.value; slotsChanged(); });
    const del = Object.assign(document.createElement('button'), { className: 'remove', textContent: '×', title: 'Убрать перевод с экрана', disabled: !i });
    del.addEventListener('click', () => { settings.bSlots.splice(i, 1); slotsChanged(); });
    row.append(tr, tx, rf, del);
    box.append(row);
  });
  $('slotAdd').disabled = settings.bSlots.length >= MAX_SLOTS;
  $('slotHint').textContent = boxes.length
    ? `Текстовые окна шаблона «${B.tpl.name || 'Шаблон'}» темы «${name}»: ${boxes.join(', ')}. Текст в окне — с оформлением из «Тем» (шрифт, размер, подложка); «Нет» — не показывать. Несколько переводов в одном окне — колонками.`
      + (B.unapplied ? ' Тема изменена, но не применена: на экране новые окна появятся после «Применить тему» во «Темах».' : '')
    : B.theme
      ? `В шаблоне «${(B.tpl && B.tpl.name) || ''}» темы «${name}» нет текстовых окон. Добавьте их во вкладке «Темы» (например, «Стих 1», «Ссылка 1», «Стих 2», «Ссылка 2») или выберите другой шаблон.`
      : 'Выберите тему с шаблоном, в котором есть текстовые окна, — стих и ссылка привязываются только к окнам темы. Окна делаются во вкладке «Темы».';
}$('slotAdd').addEventListener('click', () => {
  if (settings.bSlots.length >= MAX_SLOTS) return;
  const used = new Set(settings.bSlots.map((s) => s.id).concat(bible ? [bible.id] : []));
  const t = bibleIndex.find((x) => !used.has(x.id));
  settings.bSlots.push({ id: t ? t.id : '', text: '', ref: '' }); // окна — выбрать в строке
  slotsChanged();
});

// Быстрый выбор второго перевода — в строке над стихами (вторая строка окна «Библия»)
function fillBible2Selects() {
  const sel = $('bible2Quick');
  sel.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'Второй перевод: нет' }));
  for (const t of bibleIndex) {
    const same = bible && bible.id === t.id;
    sel.append(Object.assign(document.createElement('option'), { value: t.id, textContent: '＋ ' + trLabel(t) + (same ? ' (открыт)' : '') }));
  }
  const s = settings.bSlots[1];
  sel.value = s && bibleIndex.some((t) => t.id === s.id) ? s.id : '';
  sel.title = settings.bSlots.length > 2 ? `На экране переводов: ${settings.bSlots.length}. Все строки — в окне «Библия»` : 'Второй перевод на экране. Сколько переводов и в какие окна темы — в окне «Библия»';
}
$('bible2Quick').addEventListener('change', (e) => {
  const id = e.target.value;
  if (!id) settings.bSlots.splice(1, 1);
  else if (settings.bSlots[1]) settings.bSlots[1].id = id;
  else settings.bSlots.push({ id, text: '', ref: '' }); // окна — выбрать в окне «Библия»
  flashStatus(id ? `Второй перевод: ${trLabel(bibleIndex.find((t) => t.id === id))}` : 'Второй перевод убран');
  slotsChanged();
});

function syncParUi() {
  fillBible2Selects();
  renderSlots();
  document.querySelectorAll('input[name=vSplit]').forEach((r) => { r.checked = r.value === (settings.vSplit === 'split' ? 'split' : 'fit'); });
  $('vMinFont').value = settings.vMinFont;
  $('vMaxChars').value = settings.vMaxChars;
  $('vMaxParts').value = settings.vMaxParts;
  document.querySelectorAll('#splitBox .split-dep').forEach((x) => x.classList.toggle('off', settings.vSplit !== 'split'));
}
// Числа: в пределах полей, пустое — прежнее
const numIn = (el, def) => { const v = Number(el.value); return el.value === '' || !Number.isFinite(v) ? def : Math.max(Number(el.min), Math.min(Number(el.max), v)); };
for (const id of ['vMinFont', 'vMaxChars', 'vMaxParts']) $(id).addEventListener('change', (e) => setBibleLook(id, numIn(e.target, DEFAULTS[id])));
document.querySelectorAll('input[name=vSplit]').forEach((r) => r.addEventListener('change', () => {
  setBibleLook('vSplit', r.value);
  flashStatus(r.value === 'split' ? 'Длинные стихи — частями: 7A, 7B…' : 'Длинные стихи — мельче, одним слайдом');
}));
// Первый раз — из initBible, когда список переводов уже загружен

// Сокращение перевода: своё (t.abbr) или первые буквы слов — «Russian Synodal Translation» → «RST»
function trAbbr(t) {
  if (!t) return '';
  if (t.abbr) return t.abbr;
  const name = String(t.name || '').replace(/\(.*?\)/g, ' ').trim();
  const words = name.split(/[\s\-–—_.,:;/]+/).filter((w) => /[A-Za-zА-Яа-яЁёІіЇїЄєҐґ]/.test(w));
  if (words.length > 1) return words.map((w) => w[0]).join('').toUpperCase().slice(0, 6);
  return name.slice(0, 4).toUpperCase() || name;
}
// Как называть перевод в программе и на экране: полностью или сокращённо (галочка в окне «Библия»)
const trLabel = (t) => (t ? (settings.trShort ? trAbbr(t) : t.name) : '');
// Название открытого перевода (bible — из кэша, сокращение — из списка переводов)
const bibleLabel = () => (typeof bible !== 'undefined' && bible ? trLabel(bibleIndex.find((t) => t.id === bible.id) || bible) : '');
document.querySelectorAll('input[name=trShow]').forEach((r) => r.addEventListener('change', () => {
  settings.showTr = r.value === '1';
  saveSettings();
  onSettingChanged('showTr');
  flashStatus(settings.showTr ? 'На экране: место и название перевода' : 'На экране: только место Писания');
}));

/* ---------- Мониторы и размер вывода ---------- */

let displays = [];
let outputOpen = false;

const clampSize = (n, d) => Math.max(320, Math.min(16384, Math.round(n) || d));

// Монитор «Основного» (его настоящее разрешение — pw × ph, в пикселях)
const mainDisplay = () => displays.find((x) => x.id === Number(displaySel.value)) || displays[0];
// Больше, чем умеет монитор, не ставим
function displayMax(d) { return d ? { W: d.pw || d.bw, H: d.ph || d.bh } : { W: 7680, H: 4320 }; }
function outputSize() {
  const d = mainDisplay();
  let W, H;
  if (settings.res === 'custom') { W = clampSize(settings.resW, 3840); H = clampSize(settings.resH, 2160); }
  else if (settings.res !== 'auto') [W, H] = settings.res.split('x').map(Number);
  else return d ? { W: d.bw, H: d.bh } : { W: 1920, H: 1080 };
  const m = displayMax(d);
  return { W: Math.min(W, m.W), H: Math.min(H, m.H) };
}
// Слайды PowerPoint — в самом высоком качестве: не меньше 4K и не меньше самого большого монитора
function slideWidth() { return Math.min(7680, Math.max(3840, ...displays.map((d) => d.pw || d.bw || 0))); }

function sendOutputSettings() {
  const { W, H } = outputSize();
  window.api.setOutputSettings(settings.res === 'auto' ? { resW: 0, resH: 0 } : { resW: W, resH: H });
  // «Подгонка» (settings.outFit): 'fit' — растянуть под монитор, 'none' — пиксель в пиксель (меньшее разрешение — меньше на экране) — уходит в scConfig
  if (typeof scSend === 'function') scSend(); // размер «Основного» — экранам и сценам (screens.js)
}

function layoutPreview() {
  const { W, H } = outputSize();
  // Поле своей высоты (потянули за полоску снизу) — экран в настоящей пропорции вписан и стоит по центру
  const free = settings.prevH > 0;
  prevWrap.classList.toggle('free', free);
  prevWrap.style.aspectRatio = free ? '' : `${W} / ${H}`;
  prevWrap.style.height = free ? settings.prevH + 'px' : '';
  const cw = prevWrap.clientWidth;
  const ch = free ? prevWrap.clientHeight : cw * H / W;
  const k = Math.min(cw / W, ch / H) || 0;
  prevStage.style.width = W + 'px';
  prevStage.style.height = H + 'px';
  prevStage.style.transform = free ? `translate(${(cw - W * k) / 2}px, ${(ch - H * k) / 2}px) scale(${k})` : `scale(${k})`;
  Scene.refit(prevStage);
  // Просмотр (peek) — того же размера, поверх
  peekStage.style.width = W + 'px';
  peekStage.style.height = H + 'px';
  peekStage.style.transform = prevStage.style.transform;
  Scene.refit(peekStage);
  prevScreenFit();
}
new ResizeObserver(layoutPreview).observe(prevWrap);

// Полоска под «Предпросмотром»: тянуть — выше/ниже поле, двойной щелчок — снова по пропорции экрана
$('prevGrip').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const g = e.currentTarget;
  g.setPointerCapture(e.pointerId);
  g.classList.add('drag');
  const y0 = e.clientY;
  const h0 = prevWrap.clientHeight;
  const move = (ev) => {
    settings.prevH = Math.round(Math.max(80, Math.min(window.innerHeight - 160, h0 + ev.clientY - y0)));
    layoutPreview();
  };
  const up = () => {
    g.classList.remove('drag');
    g.removeEventListener('pointermove', move);
    g.removeEventListener('pointerup', up);
    g.removeEventListener('pointercancel', up);
    saveSettings();
  };
  g.addEventListener('pointermove', move);
  g.addEventListener('pointerup', up);
  g.addEventListener('pointercancel', up);
});
$('prevGrip').addEventListener('dblclick', () => { settings.prevH = 0; saveSettings(); layoutPreview(); });

/* ---------- Что видно в «Предпросмотре»: программа (слои, как раньше), любой экран или сцена из «Экран и вывод» ----------
   settings.prevScreen — id экрана или 'scene:id' сцены ('' — «Основной»; пункта «Программа» больше нет). Рисует compose.js (та же картинка, что на выходе), без звука;
   под ним продолжает работать обычный предпросмотр (звук при выключенном выводе, рисование).
   Правая кнопка по «Предпросмотру» — то же меню + «Открыть в отдельном окне» (плавающее окно поверх остальных, main.js). */
let prevScr = null; // { id, host, h }
// Что за id: экран или сцена — и её название; null — такого нет
function prevTarget(id) {
  const L = typeof lib !== 'undefined' && lib ? lib : null;
  if (!id || !L) return null;
  if (id.startsWith('scene:')) { const sc = (L.scenes || []).find((x) => x.id === id.slice(6)); return sc ? { id, name: sc.name || 'Сцена', scene: sc } : null; }
  const s = (L.screens || []).find((x) => x.id === id);
  return s ? { id, name: s.name || 'Экран', screen: s } : null;
}
function prevScreenSync() {
  const t = prevTarget(settings.prevScreen || 'main') || prevTarget('main');
  const id = t ? t.id : '';
  if ((prevScr ? prevScr.id : '') !== id) {
    if (prevScr) { Compose.unmountScreen(prevScr.h); prevScr.host.remove(); prevScr = null; }
    if (id) {
      const host = Object.assign(document.createElement('div'), { id: 'prevScreen' });
      prevWrap.insertBefore(host, $('peek'));
      prevScr = { id, host, h: Compose.mountScreen(host, id, { preview: true }) };
    }
  }
  const b = $('prevPick');
  if (b) {
    b.textContent = (t ? (t.scene ? 'Сцена: ' : '') + t.name : 'Основной') + ' ▾';
    b.classList.toggle('on', !!t && t.id !== 'main');
    b.title = t ? `В предпросмотре — ${t.scene ? 'сцена' : 'экран'} «${t.name}». Щелчок — выбрать другое, правая кнопка по картинке — отдельное окно` : 'В предпросмотре — программа (что в слоях). Щелчок — показать здесь экран или сцену';
  }
  // Под экраном/сценой обычный предпросмотр работает дальше (звук, рисунок), но его не видно — только один экран
  prevStage.style.visibility = prevScr ? 'hidden' : '';
  prevScreenFit();
}
// Экран своего размера — целиком в окне предпросмотра (по центру, с полями)
function prevScreenFit() {
  if (!prevScr) return;
  const { w, h } = Compose.screenSize(prevScr.id);
  const k = Math.min(prevWrap.clientWidth / w, prevWrap.clientHeight / h) || 0;
  const el = prevScr.h.el;
  el.style.transformOrigin = '0 0';
  el.style.transform = `translate(${(prevWrap.clientWidth - w * k) / 2}px, ${(prevWrap.clientHeight - h * k) / 2}px) scale(${k})`;
}
// Меню «что показывать»: у кнопки над «Предпросмотром» или правой кнопкой по нему (at — где открыть)
function prevScreenMenu(at) {
  const L = typeof lib !== 'undefined' && lib ? lib : null;
  const cur = prevTarget(settings.prevScreen || '') ? settings.prevScreen : 'main';
  const pick = (id) => { settings.prevScreen = id; saveSettings(); prevScreenSync(); };
  const r = $('prevPick').getBoundingClientRect();
  const screens = L && Array.isArray(L.screens) ? L.screens : [];
  const scenes = L && Array.isArray(L.scenes) ? L.scenes : [];
  const mark = (id) => (cur === id ? '✓ ' : '   ');
  const off = (on, has) => (has && !on ? ' · вывод выключен' : '');
  const float = (id, name) => () => { if (window.api.screensFloat) window.api.screensFloat({ id, name }); else flashStatus('Отдельное окно — только в программе'); };
  const t = prevTarget(cur);
  const outs = [
    ...screens.filter((s) => s.id !== 'main' && (s.outputs || []).length).map((s) => ({ label: (s.enabled ? '● Выключить вывод «' : '○ Включить вывод «') + s.name + '»',
      fn: () => { if (typeof scScreenSet === 'function') scScreenSet(s, { enabled: !s.enabled }, true); } })),
    ...scenes.filter((sc) => (sc.outputs || []).length).map((sc) => ({ label: (sc.on ? '● Выключить вывод сцены «' : '○ Включить вывод сцены «') + sc.name + '»',
      fn: () => { sc.on = !sc.on; if (typeof scSceneOutSet === 'function') scSceneOutSet(sc, true); } })),
  ];
  showMenu(at && at.clientX != null ? at : { clientX: r.left, clientY: r.bottom + 4 }, [
    { label: 'Открыть в отдельном окне: ' + (t ? t.name : 'Основной'), fn: float(cur, t ? t.name : 'Основной') },
    '-',
    { label: 'Показывать в предпросмотре', disabled: true, fn() {} },
    ...(screens.length ? ['-', { label: 'Экраны', disabled: true, fn() {} }] : []),
    ...screens.map((s) => ({ label: mark(s.id) + s.name + off(s.enabled, s.id !== 'main' && (s.outputs || []).length), fn: () => pick(s.id) })),
    ...(scenes.length ? ['-', { label: 'Сцены', disabled: true, fn() {} }] : []),
    ...scenes.map((sc) => ({ label: mark('scene:' + sc.id) + sc.name + off(sc.on, (sc.outputs || []).length), fn: () => pick('scene:' + sc.id) })),
    ...(outs.length ? ['-', ...outs] : []),
    '-',
    { label: 'Настроить экраны и сцены…', fn: () => { if (typeof openScreensTab === 'function') openScreensTab(); } },
  ]);
}
$('prevPick').addEventListener('click', () => prevScreenMenu());
prevWrap.addEventListener('contextmenu', (e) => { if (e.target.closest('#peek')) return; e.preventDefault(); prevScreenMenu(e); });

/* ---------- Блоки под «Предпросмотром» (aside > .as-blk): свой порядок — settings.asideOrder ----------
   Тянуть за ⠿ слева от блока выше/ниже или правой кнопкой по ⠿ / шапке блока → «Выше», «Ниже». Порядок — CSS order. */
const BLK_NAMES = { layers: 'Слои', music: 'Проигрыватель', macros: 'Макросы', timers: 'Таймеры', voice: 'Библия по голосу' };
const asideBlocks = () => [...document.querySelectorAll('aside > .as-blk')];
function blkOrder() {
  const all = asideBlocks().map((b) => b.dataset.blk);
  const saved = Array.isArray(settings.asideOrder) ? settings.asideOrder.filter((k) => all.includes(k)) : [];
  return [...saved, ...all.filter((k) => !saved.includes(k))];
}
function blkApply() {
  const order = blkOrder();
  asideBlocks().forEach((b) => { b.style.order = String(order.indexOf(b.dataset.blk) + 1); });
}
function blkMove(key, to) {
  const order = blkOrder().filter((k) => k !== key);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, key);
  settings.asideOrder = order;
  saveSettings();
  blkApply();
}
function blkMenu(e, key) {
  const order = blkOrder();
  const i = order.indexOf(key);
  const last = order.length - 1;
  showMenu(e, [
    { label: `Блок «${BLK_NAMES[key] || key}»`, disabled: true, fn() {} },
    { label: 'Выше', disabled: i <= 0, fn: () => blkMove(key, i - 1) },
    { label: 'Ниже', disabled: i >= last, fn: () => blkMove(key, i + 1) },
    { label: 'В самый верх', disabled: i <= 0, fn: () => blkMove(key, 0) },
    { label: 'В самый низ', disabled: i >= last, fn: () => blkMove(key, last) },
    '-',
    { label: 'Порядок как было', disabled: !settings.asideOrder, fn: () => { settings.asideOrder = null; saveSettings(); blkApply(); } },
  ]);
}
let blkDrag = '';
const blkMarks = () => asideBlocks().forEach((b) => b.classList.remove('blk-before', 'blk-after', 'blk-drag'));
asideBlocks().forEach((b) => {
  const key = b.dataset.blk;
  const g = Object.assign(document.createElement('button'), { className: 'blk-grip', textContent: '⠿', draggable: true, title: `Потяните, чтобы переставить блок «${BLK_NAMES[key] || key}» выше или ниже. Правая кнопка — меню` });
  g.setAttribute('aria-label', `Переставить блок «${BLK_NAMES[key] || key}»`);
  g.addEventListener('dragstart', (e) => {
    blkDrag = key;
    e.dataTransfer.setData('application/x-cp-blk', key);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setDragImage(b, 10, 10); } catch { /* не страшно */ }
    requestAnimationFrame(() => b.classList.add('blk-drag'));
  });
  g.addEventListener('dragend', () => { blkDrag = ''; blkMarks(); });
  g.addEventListener('contextmenu', (e) => { e.preventDefault(); blkMenu(e, key); });
  g.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    e.stopPropagation();
    blkMove(key, blkOrder().indexOf(key) + (e.key === 'ArrowUp' ? -1 : 1));
    g.focus();
  });
  b.prepend(g);
  const head = b.querySelector(':scope > .ly-head');
  if (head) head.addEventListener('contextmenu', (e) => { if (e.defaultPrevented) return; e.preventDefault(); blkMenu(e, key); });
  b.addEventListener('dragover', (e) => {
    if (!blkDrag || !e.dataTransfer.types.includes('application/x-cp-blk')) return;
    e.preventDefault();
    e.stopPropagation();
    blkMarks();
    if (blkDrag === key) return;
    const r = b.getBoundingClientRect();
    b.classList.add(e.clientY > r.top + r.height / 2 ? 'blk-after' : 'blk-before');
  });
  b.addEventListener('drop', (e) => {
    if (!blkDrag || !e.dataTransfer.types.includes('application/x-cp-blk')) return;
    e.preventDefault();
    e.stopPropagation();
    const after = b.classList.contains('blk-after');
    const from = blkDrag;
    blkDrag = '';
    blkMarks();
    if (from === key) return;
    const order = blkOrder().filter((k) => k !== from);
    blkMove(from, order.indexOf(key) + (after ? 1 : 0));
  });
});
blkApply();

/* ---------- Разделители: ширина панелей мышью (запоминается в settings.sizes) ---------- */
// <div class="splitter" data-split="ключ" data-t="prev|next|parent">: какую панель тянем (по умолчанию — ту, что слева);
// data-min / data-max — пределы, data-keep — сколько оставить соседней панели (по умолчанию 260)

const splitTarget = (sp) => (sp.dataset.t === 'next' ? sp.nextElementSibling : sp.dataset.t === 'parent' ? sp.parentElement : sp.previousElementSibling);

function setPaneSize(sp, w) {
  const el = splitTarget(sp);
  if (w == null) { el.style.removeProperty('--w'); el.classList.remove('sized'); return; }
  el.style.setProperty('--w', w + 'px');
  el.classList.add('sized');
}

// Сколько ширины можно забрать у ближайшей видимой соседней панели
function roomBeside(el, dir, keep) {
  const step = (n) => (dir > 0 ? n.nextElementSibling : n.previousElementSibling);
  for (let n = step(el); n; n = step(n)) {
    if (!n.classList.contains('splitter') && n.offsetWidth) return Math.max(0, n.offsetWidth - keep);
  }
  // колонка в «Библии» лежит в обёртке с display: contents — ищем соседа обёртки
  const p = el.parentElement;
  return p && getComputedStyle(p).display === 'contents' ? roomBeside(p, dir, keep) : 0;
}

document.querySelectorAll('.splitter').forEach((sp) => {
  const key = sp.dataset.split;
  sp.title = 'Потяните, чтобы изменить ширину. Двойной щелчок — как было';
  if (settings.sizes[key]) setPaneSize(sp, settings.sizes[key]);
  sp.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = splitTarget(sp);
    const sign = sp.dataset.t === 'next' ? -1 : 1; // панель справа от разделителя шире, когда тянем влево
    const x0 = e.clientX;
    const w0 = Math.round(el.getBoundingClientRect().width);
    const min = Number(sp.dataset.min) || 120;
    const max = Math.max(w0, Math.min(Number(sp.dataset.max) || 4000, w0 + roomBeside(el, sign,Number(sp.dataset.keep) || 260)));
    let w = w0;
    let raf = 0;
    sp.setPointerCapture(e.pointerId);
    sp.classList.add('drag');
    document.body.classList.add('resizing');
    const move = (ev) => {
      w = Math.round(Math.max(min, Math.min(max, w0 + sign * (ev.clientX - x0))));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setPaneSize(sp, w); });
    };
    const up = () => {
      sp.removeEventListener('pointermove', move);
      sp.removeEventListener('pointerup', up);
      sp.removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf);
      sp.classList.remove('drag');
      document.body.classList.remove('resizing');
      if (w === w0) return;
      setPaneSize(sp, w);
      settings.sizes[key] = w;
      saveSettings();
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', up);
    sp.addEventListener('pointercancel', up);
  });
  sp.addEventListener('dblclick', () => {
    setPaneSize(sp, null);
    delete settings.sizes[key];
    saveSettings();
    flashStatus('Ширина панели — как было');
  });
});

// Монитор узнаётся по месту (как в Windows: Параметры → Дисплей), имени и разрешению — dispKey «имя|1920x1080@x,y».
// id у Windows ненадёжный: после перезагрузки два одинаковых монитора могут поменяться id. Порядок поиска:
// то же место и разрешение → тот же id → то же имя и разрешение → то же имя → единственный дополнительный монитор
const dispKey = (d) => (d ? `${d.name || ''}|${d.pw || d.bw}x${d.ph || d.bh}@${d.bx || 0},${d.by || 0}` : '');
function dispFind(id, key) {
  if (!displays.length) return null;
  const [nm = '', size = '', pos = ''] = String(key || '').split(/[|@]/);
  const sz = (d) => `${d.pw || d.bw}x${d.ph || d.bh}`;
  const at = (d) => `${d.bx || 0},${d.by || 0}`;
  const ext = displays.filter((d) => !d.primary);
  return (pos && (displays.find((d) => at(d) === pos && sz(d) === size && d.name === nm) || displays.find((d) => at(d) === pos && sz(d) === size)))
    || displays.find((d) => d.id === Number(id))
    || (size && displays.find((d) => d.name === nm && sz(d) === size))
    || (nm && displays.find((d) => d.name === nm))
    || (ext.length === 1 ? ext[0] : null);
}
// Другой монитор вместо сохранённого id (null — id верный или найти нечего)
function dispMatch(id, key) {
  const d = dispFind(id, key);
  return d && d.id !== Number(id) ? d : null;
}
// Можно ли переписать сохранённый ключ на монитор d: он стоит на том же месте или ключ старый (без места).
// Найденный «на замену» не запоминаем: при запуске Windows не сразу расставляет мониторы (сплиттер, пробуждение) —
// второй одинаковый монитор появляется позже, и свой найдётся по месту. Сменили расположение в Windows — выбрать через «Схему»
function dispSure(d, key) {
  if (!d) return false;
  const [, size = '', pos] = String(key || '').split(/[|@]/);
  if (pos === undefined) return true;
  const [, dsize, dpos] = dispKey(d).split(/[|@]/);
  return dsize === size && dpos === pos;
}
// Переписать сохранённые мониторы выходов (lib.screens, lib.scenes) на те, что подключены сейчас; запомнить имя монитора
function dispFix() {
  if (typeof lib === 'undefined' || !lib || !Array.isArray(lib.screens) || !displays.length) return;
  let ch = 0;
  for (const z of [...lib.screens, ...(lib.scenes || [])]) for (const o of z.outputs || []) {
    if (!o || o.kind !== 'display') continue;
    const d = dispMatch(o.display, o.dkey);
    if (d) { o.display = d.id; ch++; }
    const cur = displays.find((x) => x.id === Number(o.display));
    const k = dispKey(cur);
    if (k && o.dkey !== k && dispSure(cur, o.dkey)) { o.dkey = k; ch++; }
  }
  if (!ch) return;
  // Без шага отмены: это не правка оператора
  if (saveTimer) saveLib();
  else { window.api.libSave(lib).catch(() => {}); if (histCur !== null) histCur = histSnap(); if (typeof repoTouch === 'function') repoTouch('lib'); }
  if (typeof scSend === 'function') scSend();
}

// Выбор монитора по схеме, как в Windows (Параметры → Дисплей): прямоугольники на своих местах, щелчок — выбрать.
// cur — id выбранного сейчас, pick(id) — что делать с выбором. «Показать номера» — номер крупно на каждом мониторе
function dispPick(cur, pick) {
  let dlg = $('dispDialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'dispDialog';
    dlg.innerHTML = `<form method="dialog"><div class="dlg-head"><h2>Выберите монитор</h2></div>
      <div class="dlg-body"><p class="hint" style="margin:0 0 10px">Расположение — как в Windows (Параметры → Система → Дисплей). Не знаете, где какой, — нажмите «Показать номера».</p>
      <div class="disp-map"></div></div>
      <div class="dlg-foot"><button type="button" class="disp-ident" data-icon="screen">Показать номера</button><span class="spacer"></span><button value="cancel">Отмена</button></div></form>`;
    document.body.append(dlg);
    dlg.querySelector('.disp-ident').addEventListener('click', () => window.api.identifyDisplays());
    if (typeof Icons !== 'undefined') Icons.apply(dlg);
  }
  const map = dlg.querySelector('.disp-map');
  map.replaceChildren();
  const x0 = Math.min(...displays.map((d) => d.bx || 0)), y0 = Math.min(...displays.map((d) => d.by || 0));
  const x1 = Math.max(...displays.map((d) => (d.bx || 0) + d.bw)), y1 = Math.max(...displays.map((d) => (d.by || 0) + d.bh));
  const k = Math.min(640 / Math.max(1, x1 - x0), 300 / Math.max(1, y1 - y0));
  map.style.width = Math.round((x1 - x0) * k) + 'px';
  map.style.height = Math.round((y1 - y0) * k) + 'px';
  for (const d of displays) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'disp-box' + (d.id === Number(cur) ? ' on' : '');
    Object.assign(b.style, { left: ((d.bx || 0) - x0) * k + 'px', top: ((d.by || 0) - y0) * k + 'px', width: d.bw * k + 'px', height: d.bh * k + 'px' });
    // Кто уже выводит на этот монитор
    const busy = typeof scDisplayBusy === 'function' && lib ? scDisplayBusy(d.id, '', -1) : [];
    const n = document.createElement('b');
    n.textContent = d.n || '';
    const t = document.createElement('span');
    t.textContent = [d.name, `${d.pw}×${d.ph}`, d.here ? 'здесь программа — выводить нельзя' : '', busy.length ? 'занят: ' + busy.join(', ') : ''].filter(Boolean).join('\n');
    b.append(n, t);
    b.title = d.label;
    if (d.here) b.disabled = true; // монитор программы не выбирается
    else b.addEventListener('click', () => { dlg.close(); pick(d.id); });
    map.append(b);
  }
  if (!displays.length) map.textContent = 'Мониторов нет';
  dlg.showModal();
}

function fillDisplays(list) {
  displays = list;
  const keep = Number(displaySel.value) || Number(settings.outDisplay);
  displaySel.replaceChildren(...list.map((d) => Object.assign(document.createElement('option'), { value: d.id, textContent: d.label })));
  const stillThere = dispFind(keep || -1, settings.outDisplayKey);
  const external = list.find((d) => !d.here && !d.primary) || list.find((d) => !d.here); // не монитор программы
  displaySel.value = (stillThere || external || list[0]).id;
  // Нашёлся свой монитор — запомнить его новый id и место (выбранный «на замену» не запоминаем: вернётся свой — встанет он)
  if (stillThere && dispSure(stillThere, settings.outDisplayKey) && (settings.outDisplay !== stillThere.id || settings.outDisplayKey !== dispKey(stillThere))) {
    settings.outDisplay = stillThere.id;
    settings.outDisplayKey = dispKey(stillThere);
    saveSettings();
  }
  // Вывод зала уже открыт, а свой монитор нашёлся другой (при запуске Windows ещё расставляла мониторы) — перенести вывод туда.
  // Раньше окно оставалось на чужом мониторе до «выключить — включить»
  if (stillThere && outputOpen && outDispNow != null && outDispNow !== stillThere.id) window.api.openOutput(stillThere.id);
  try { dispFix(); } catch { /* библиотека ещё не загружена — dispFix позовёт scInit */ }
  sendOutputSettings();
  layoutPreview();
  if (typeof scOutputChanged === 'function') scOutputChanged(); // список мониторов в Редакторе сцен
}

let outDispNow = null; // на каком мониторе сейчас открыт вывод зала (сообщает main.js)
function setOutputState({ open, displayId }) {
  const changed = outputOpen !== open;
  outputOpen = open;
  outDispNow = open && displayId != null ? Number(displayId) : null;
  if (changed && typeof mcEmit === 'function') queueMicrotask(() => mcEmit('output', { on: open }));
  if (changed && typeof scOutputChanged === 'function') queueMicrotask(scOutputChanged); // точка «выводится» у «Основного»
  if (changed) prevAudio(); // вывод открыли — звук уходит туда, закрыли — звучит предпросмотр
  toggleBtn.textContent = open ? 'Выключить вывод' : 'Включить вывод';
  toggleBtn.classList.toggle('on', open);
  // Галочка в шапке «Предпросмотра»
  if (typeof lib !== 'undefined' && lib) outGroupsSync();
  if (open && displayId != null) displaySel.value = displayId;
  const hint = $('outHint');
  hint.classList.toggle('on', open);
  hint.textContent = open
    ? `Вывод идёт на: ${displaySel.selectedOptions[0] ? displaySel.selectedOptions[0].textContent : 'монитор'}`
    : 'Вывод выключен. Картинка показана только здесь.';
}

// На монитор с окном программы выводить нельзя (решение владельца) — main.js тоже не откроет
const HERE_MSG = 'На этом мониторе окно программы — сюда выводить нельзя. Выберите другой монитор (Редактор сцен → «Основной» → «Схема»)';
const dispHere = (id) => !!(displays.find((d) => d.id === Number(id)) || {}).here;
const toggleOutput = () => {
  if (outputOpen) window.api.closeOutput();
  else if (dispHere(displaySel.value)) flashStatus(HERE_MSG);
  else window.api.openOutput(Number(displaySel.value));
};
toggleBtn.addEventListener('click', toggleOutput);
displaySel.addEventListener('change', () => {
  settings.outDisplay = Number(displaySel.value); // монитор «Основного» запоминается
  settings.outDisplayKey = dispKey(displays.find((d) => d.id === settings.outDisplay)); // и его имя — если Windows сменит id
  saveSettings();
  if (outputOpen) window.api.openOutput(Number(displaySel.value));
  sendOutputSettings();
  layoutPreview();
});

/* ----- Группы вывода «Зал» и «Сцена» — галочки над «Предпросмотром» -----
   У экрана (lib.screens) и сцены (lib.scenes) — group: 'hall' | 'stage' | 'none' (Редактор сцен → «Группа»).
   По умолчанию экраны (и «Основной») — «Зал», сцены — «Сцена». Галочка включает/выключает выход всех из своей группы;
   «Основной» — это его монитор (outputOpen) и дополнительные выходы (s.enabled) вместе. */
const OUT_GROUPS = { hall: 'Зал', stage: 'Сцена' };
function outGroupOf(x, scene) { return x.group || (scene ? 'stage' : 'hall'); }
// Кто в группе: [{ name, on, set(v) }]; экран или сцена без выходов не в счёт («Основной» — всегда: у него есть монитор)
function outGroupMembers(g) {
  const L = typeof lib !== 'undefined' && lib ? lib : null;
  if (!L || !Array.isArray(L.screens)) return [];
  const list = [];
  for (const s of L.screens) {
    if (outGroupOf(s, false) !== g) continue;
    if (s.id === 'main') list.push({ name: s.name || 'Основной', on: mainOutOn(), set: (v) => mainOutSet(v, true) });
    else if ((s.outputs || []).length) list.push({ name: s.name || 'Экран', on: !!s.enabled, set: (v) => { s.enabled = v; } });
  }
  for (const sc of L.scenes || []) {
    if (outGroupOf(sc, true) === g && (sc.outputs || []).length) list.push({ name: sc.name || 'Сцена', on: !!sc.on, set: (v) => { sc.on = v; } });
  }
  return list;
}
// «Основной»: монитор зала + его дополнительные выходы
function mainOutOn() { const m = lib && lib.screens && lib.screens.find((s) => s.id === 'main'); return outputOpen || !!(m && m.enabled && (m.outputs || []).length); }
function mainOutSet(on, quiet) {
  const m = lib && lib.screens && lib.screens.find((s) => s.id === 'main');
  if (on && !outputOpen && displays.length) { if (dispHere(displaySel.value)) flashStatus(HERE_MSG); else window.api.openOutput(Number(displaySel.value)); }
  if (!on && outputOpen) window.api.closeOutput();
  if (m) m.enabled = on;
  if (!quiet) { saveLib(); if (typeof scSend === 'function') scSend(); if (typeof scOutputChanged === 'function') scOutputChanged(); }
}
function outGroupSet(g, on) {
  const list = outGroupMembers(g);
  if (!list.length) return;
  list.forEach((x) => x.set(on));
  saveLib();
  if (typeof scSend === 'function') scSend();
  if (typeof scOutputChanged === 'function') scOutputChanged();
  if (typeof stPanelRefresh === 'function') stPanelRefresh();
  flashStatus(`${OUT_GROUPS[g]}: вывод ${on ? 'включён' : 'выключен'}`);
}
function outGroupsSync() {
  for (const [g, id] of [['hall', 'outToggle'], ['stage', 'stageToggle']]) {
    const b = $(id);
    const list = outGroupMembers(g);
    const on = list.some((x) => x.on);
    b.disabled = !list.length;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    const names = (l) => l.map((x) => '«' + x.name + '»').join(', ');
    b.title = !list.length ? `${OUT_GROUPS[g]}: в группе нет экранов и сцен с выходами — назначьте группу в Редакторе сцен`
      : on ? `${OUT_GROUPS[g]}: выключить вывод (${names(list)})` : `${OUT_GROUPS[g]}: включить вывод (${names(list)})`;
  }
}
$('outToggle').addEventListener('click', () => outGroupSet('hall', !outGroupMembers('hall').some((x) => x.on)));
$('stageToggle').addEventListener('click', () => outGroupSet('stage', !outGroupMembers('stage').some((x) => x.on)));

/* ---------- Что сейчас на экране ---------- */

let liveBuild = null;   // функция, собирающая содержимое экрана (чтобы обновлять при смене настроек)
let liveLabel = '';
let live = -1;          // номер элемента списка «Экран», который сейчас показан
let plShown = null;     // слайд из плейлиста или библиотеки, который сейчас показан: { itemId, entry, slide } (см. playlist.js)
let pv = null;          // видео в предпросмотре (без звука), повторяет то, что идёт на выводе
let videoVol = Number.isFinite(settings.videoVol) ? settings.videoVol : 1; // громкость видео на выводе
// Громкость (с учётом Mute) и устройство звука видео — окнам вывода
function sendVideoAudio() {
  window.api.videoCtl({ cmd: 'volume', value: settings.videoMute ? 0 : videoVol });
  window.api.videoCtl({ cmd: 'sink', value: settings.videoSink || {} });
  if (typeof prevAudio === 'function' && typeof prevStage !== 'undefined') prevAudio();
}
let lastPlayed = '';    // 'video' | 'audio' — что включили последним, то и в проигрывателе

const transition = () => (settings.transType === 'none' ? { type: 'none', ms: 0 } : { type: settings.transType, ms: settings.transMs });
const textStyle = () => ({
  font: settings.textFont, scale: settings.textScale / 100, color: settings.textColor, bg: settings.textBg, showTranslation: settings.showTr,
  bible: bibleLook(),
});
// Как рисовать стихи (scene.js, style.bible): куда идут текст и ссылка каждого перевода (строки окна «Библия»)
const bibleLook = () => ({ slots: settings.bSlots.map((s) => ({ text: s.text, ref: s.ref })) });

/* ---------- Слои вывода (Media Layers) ----------
   Экран — стопка независимых слоёв снизу вверх. Вид слоя (LAYER_KINDS) решает, что в него идёт само;
   набор слоёв и их порядок — settings.layers (можно добавить ещё слой того же вида или новый вид — строкой в LAYER_KINDS).
   Показ в один слой не трогает остальные; очистка — по слою или всех сразу (clearScreen). */
const LAYER_KINDS = {
  source: { name: 'Источники', icon: 'sources', takes: ['live'], sound: true },
  media: { name: 'Медиа', icon: 'image', takes: ['image', 'video'], sound: true },
  pres: { name: 'Презентации', icon: 'text', takes: ['text', 'custom'], sound: false },
  // Overlay — поверх основной презентации; сам сюда ничего не идёт (только пункт/макрос с этим слоем).
  // Показ в Overlay не сбивает выделение слайда на экране (plShown), ленту и авто-переключение основной презентации.
  overlay: { name: 'Overlay', icon: 'layers', takes: [], sound: true, over: true },
  // Нижние плашки и бегущая строка (service.js): поверх всего, как Overlay — не сбивают слайд на экране
  lower: { name: 'Плашки', icon: 'lowerthird', takes: ['lower'], sound: false, over: true },
};
const DEFAULT_LAYERS = [{ id: 'source', kind: 'source' }, { id: 'media', kind: 'media' }, { id: 'pres', kind: 'pres' }];
const layerOn = {}; // слой → { build, label, content, marks } — что в нём сейчас
const ovShown = {}; // слой Overlay → { view, key, sid } — какой слайд в нём (своя подсветка в ленте)

// Слои по порядку снизу вверх (из настроек; неизвестные виды отбрасываем, пусто — три обычных)
function layerDefs() {
  let list = Array.isArray(settings.layers) ? settings.layers.filter((l) => l && l.id && LAYER_KINDS[l.kind]) : [];
  if (!list.length) list = DEFAULT_LAYERS.map((l) => ({ ...l }));
  if (list !== settings.layers) settings.layers = list;
  // Перенос: слой «Презентации», переименованный в «Overlay», становится слоем вида Overlay (один раз)
  if (!settings.ovMig) {
    settings.ovMig = true;
    for (const l of list) if (l.kind === 'pres' && /^\s*overlay/i.test(l.name || '')) l.kind = 'overlay';
  }
  // Слой «Плашки» — сверху, один раз (потом его можно убрать или передвинуть, как любой слой)
  if (!settings.ltMig) {
    settings.ltMig = true;
    if (!list.some((l) => l.kind === 'lower')) list.push({ id: list.some((l) => l.id === 'lower') ? 'lower' + Date.now().toString(36) : 'lower', kind: 'lower' });
  }
  return list;
}
const layerById = (id) => layerDefs().find((l) => l.id === id) || null;
const layerName = (l) => l.name || LAYER_KINDS[l.kind].name;
const isOverlay = (id) => { const l = id && layerById(id); return !!(l && LAYER_KINDS[l.kind].over); };
// Куда идёт содержимое само: первый слой, чей вид его принимает (иначе — верхний не-Overlay)
function autoLayer(content) {
  const defs = layerDefs();
  const main = defs.filter((l) => !LAYER_KINDS[l.kind].over);
  return (defs.find((l) => LAYER_KINDS[l.kind].takes.includes(content.type)) || main[main.length - 1] || defs[defs.length - 1]).id;
}
// Верхний непустой видимый слой — с ним работают рисование и «что на экране» (Overlay — только если больше ничего нет)
function topLayer() {
  const defs = layerDefs();
  let ov = null;
  for (let i = defs.length - 1; i >= 0; i--) {
    if (!layerOn[defs[i].id] || defs[i].hidden) continue;
    if (!LAYER_KINDS[defs[i].kind].over) return defs[i].id;
    if (!ov) ov = defs[i].id;
  }
  return ov;
}
const topContent = () => { const id = topLayer(); return id ? layerOn[id].content : null; };
const videoLayer = () => layerDefs().map((l) => layerOn[l.id]).filter((x) => x && x.content.type === 'video').pop() || null;

// Слои → окно вывода и предпросмотр (порядок, видимость, прозрачность, громкость)
function sendLayers() {
  // over — слой Overlay (окну вывода — чтобы знать, у какого слоя рисунок, compose.js → inkLayer)
  const defs = layerDefs().map(({ id, kind, hidden, opacity, volume }) => ({ id, over: !!LAYER_KINDS[kind].over, hidden: !!hidden, opacity: opacity != null ? opacity : 1, volume: volume != null ? volume : 1 }));
  window.api.layers({ defs });
  prevAudio(defs);
  Compose.progLayers({ defs }); // превью экранов на вкладке «Экраны»
}

// Звук видео идёт из окна вывода; если ни одно окно со звуком не открыто — звучит предпросмотр (без эха)
function outHasSound() {
  if (outputOpen) return true;
  const outs = typeof scOpenOuts !== 'undefined' ? scOpenOuts : [];
  const L = typeof lib !== 'undefined' && lib ? lib : {}; // lib — из playlist.js (грузится позже)
  const screensL = L.screens || [];
  const scenesL = L.scenes || [];
  return outs.some((o) => o.kind !== 'ndi' && (o.screen === 'main'
    || screensL.some((s) => s.id === o.screen && s.sound)
    || scenesL.some((sc) => 'scene:' + sc.id === o.screen && sc.outSound)));
}
let prevSinkWant = null;
function prevAudio(defs) {
  const on = !outHasSound();
  defs = defs || layerDefs().map(({ id, hidden, opacity, volume }) => ({ id, hidden: !!hidden, opacity: opacity != null ? opacity : 1, volume: volume != null ? volume : 1 }));
  prevStage._baseVol = settings.videoMute ? 0 : videoVol;
  Scene.setLayers(prevStage, defs.map((d) => ({ ...d, volume: on ? d.volume : 0 })));
  // Устройство звука видео — то же, что у вывода ({ id, label }; id ищем ещё и по названию)
  const want = settings.videoSink || {};
  const k = (want.id || '') + '|' + (want.label || '');
  if (k === prevSinkWant) return;
  prevSinkWant = k;
  (async () => {
    let id = '';
    if (want.id) {
      try {
        const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
        const d = outs.find((x) => x.deviceId === want.id) || outs.find((x) => want.label && x.label === want.label);
        id = d ? d.deviceId : '';
      } catch { /* как в Windows */ }
    }
    prevStage._sink = id;
    Scene.applyVolume(prevStage);
  })();
}

// Что-то показали или убрали: верхний слой — для рисования, видео — для проигрывателя, подсветка — для списков
function layersChanged() {
  const top = topLayer();
  liveBuild = top ? layerOn[top].build : null;
  liveLabel = top ? layerOn[top].label : '';
  const vl = videoLayer();
  watchPreviewVideo(vl ? vl.content : null);
  if (typeof inkSlideChanged === 'function') inkSlideChanged(topContent());
  if (typeof scStage === 'function') scStage(); // текущий и следующий слайд — элементам сцен
  updateLive();
  if (typeof renderLayers === 'function') renderLayers();
}

/* ---------- Просмотр без вывода (peek): файл из медиапула или пункт «Содержания» ----------
   Показывается поверх «Предпросмотра» с жёлтой рамкой и надписью «Просмотр»; внешний экран не меняется.
   actions — кнопки [{ text, title, fn }] (например, «На экран», «Открыть»). Уходит, когда что-то вывели на экран. */
let peekOn = false;
function peekShow(content, label, actions) {
  Scene.clear(peekStage);
  if (content) Scene.show(peekStage, { ...content, sound: false });
  $('peekName').textContent = label || '';
  $('peekName').title = label || '';
  $('peekBtns').replaceChildren(...(actions || []).map((a) => {
    const b = Object.assign(document.createElement('button'), { textContent: a.text, title: a.title || '' });
    b.addEventListener('click', (e) => { e.stopPropagation(); a.fn(); });
    return b;
  }));
  $('peek').hidden = false;
  peekOn = true;
}
function peekClose() {
  if (!peekOn) return;
  peekOn = false;
  $('peek').hidden = true;
  Scene.clear(peekStage);
  document.querySelectorAll('#poolGrid .pf.cur').forEach((t) => t.classList.remove('cur'));
}
$('peekClose').addEventListener('click', peekClose);

// Свой переход у слайда или презентации ({ type, ms }; нет — общий из строки под лентой)
function ownTransition(item, slide) {
  const t = (slide && slide.trans && slide.trans.type ? slide.trans : null) || (item && item.trans && item.trans.type ? item.trans : null);
  if (!t) return null;
  if (t.type === 'none') return { type: 'none', ms: 0 };
  return { type: Scene.TRANS.some(([v]) => v === t.type) ? t.type : 'fade', ms: Number(t.ms) > 0 ? Number(t.ms) : settings.transMs };
}

// layer — слой вручную (id); без него — сам по виду содержимого; trOwn — свой переход (ownTransition)
function present(build, label, instant, layer, trOwn) {
  if (!instant) peekClose(); // вывели на экран — «Предпросмотр» снова показывает экран
  const content = build();
  const id = layer && layerById(layer) ? layer : autoLayer(content);
  const entry = { build, label, content, marks: null };
  const was = layerOn[id] || null;
  layerOn[id] = entry;
  const tr = instant ? { type: 'none', ms: 0 } : trOwn || transition();
  window.api.show({ content, transition: tr, layer: id });
  // Предпросмотр: звук только у видеофайлов, а слышно его, лишь когда вывод закрыт (prevAudio)
  Scene.show(prevStage, Compose.lookFor('main', { ...content, sound: content.type === 'video' && !!content.sound }), tr, id); // тема «Основного», если задана
  Compose.progShow({ ...content, sound: false }, tr, id);
  // Что подсвечено в списках как «на экране» — запоминаем после того, как вызвавший код это отметит
  // Overlay подсветку основной презентации не ставит и не снимает
  if (isOverlay(id)) entry.marks = {};
  else queueMicrotask(() => { entry.marks = { live, bShown, plShown }; });
  layersChanged();
  // Media Action шаблона темы: вместе со слайдом — свой фон в слой «Медиа» (если там уже не он)
  const tpl = content.style && content.style.tpls ? Scene.pickTpl(content) : null;
  if (tpl && tpl.media && tpl.media.url) mediaAction(tpl.media, instant);
  // Макросы (macros.js): слой включился, новое видео на экране (пересборка после смены настроек — не событие)
  if (!instant && typeof mcLayerEvt === 'function') {
    mcLayerEvt('show', id, !!was, label);
    if (content.type === 'video' && !(was && was.content.url === content.url)) mcVideoEvt('start', label);
  }
  return id;
}

function mediaAction(m, instant) {
  const c = { type: m.type === 'image' ? 'image' : 'video', url: m.url, fit: 'cover', loop: m.loop !== false, sound: !!m.sound, style: {} };
  const id = autoLayer(c);
  if (layerOn[id] && layerOn[id].content.url === c.url) return;
  present(() => c, m.name || 'Фон темы', instant, id);
  queueMicrotask(() => { if (layerOn[id]) layerOn[id].marks = {}; }); // подсветку в списках ставит слайд, а не фон
}

// Объекты шаблона «по команде» (клавиша N): следующий шаг на выводе и в предпросмотре
function buildStep() {
  window.api.layers({ cmd: 'build' });
  Compose.progLayers({ cmd: 'build' });
  if (!Scene.buildNext(prevStage)) flashStatus('Нет объектов темы, ждущих команды');
}

// Тема для текста, картинок или своих слайдов (см. playlist.js); без неё — «Текст Библии» из настроек
const styleOf = (kind, item, slide) => (typeof styleFor === 'function' ? styleFor(kind, item, slide) : textStyle());

// Настройки поменялись — пересобрать слои (кроме живых источников: их не перезапускаем)
function refreshLive() {
  for (const [id, x] of Object.entries(layerOn)) if (x.content.type !== 'live') present(x.build, x.label, true, id);
}

// Очистить один слой; остальные не трогаются
function clearLayer(id, instant) {
  const x = layerOn[id];
  if (!x) return;
  delete layerOn[id];
  const tr = instant ? { type: 'none', ms: 0 } : transition();
  window.api.clear({ transition: tr, layer: id });
  Scene.clear(prevStage, tr, id);
  Compose.progClear(tr, id);
  // Подсветка «на экране» в списках — только если её поставил этот слой
  const m = x.marks || {};
  if (m.plShown && plShown === m.plShown) plShown = null;
  if (m.bShown && bShown === m.bShown) bShown = null;
  if (m.live >= 0 && live === m.live) live = -1;
  delete ovShown[id];
  if (typeof updatePlaylistLive === 'function') updatePlaylistLive();
  layersChanged();
  if (typeof mcLayerEvt === 'function') mcLayerEvt('clear', id, true, x.label);
}

// «Очистить все слои»
function clearScreen() {
  const ids = Object.keys(layerOn);
  for (const id of ids) delete layerOn[id];
  live = -1; bShown = null; plShown = null;
  for (const k of Object.keys(ovShown)) delete ovShown[k];
  const tr = transition();
  window.api.clear({ transition: tr });
  Scene.clear(prevStage, tr);
  Compose.progClear(tr);
  layersChanged();
  if (typeof mcLayerEvt === 'function') ids.forEach((id) => mcLayerEvt('clear', id, true, ''));
}

// Пуск/пауза всего, что играет в слое
function layerPlay(id, play) {
  window.api.layers({ layer: id, cmd: play ? 'play' : 'pause' });
  Scene.layerPlay(prevStage, id, play);
  Compose.progLayers({ layer: id, cmd: play ? 'play' : 'pause' });
  if (typeof renderLayers === 'function') renderLayers();
}

// Очистить все слои одного вида (горячие клавиши F2–F4)
const clearKind = (kind) => layerDefs().filter((l) => l.kind === kind).forEach((l) => clearLayer(l.id));

// Все слои разом на другую сцену (окно рисования): без звука и переходов
function paintLayers(stage) {
  Scene.clear(stage);
  Scene.setLayers(stage, layerDefs().map(({ id, hidden, opacity }) => ({ id, hidden, opacity, volume: 0 })));
  for (const [id, x] of Object.entries(layerOn)) Scene.show(stage, { ...x.content, sound: false }, { type: 'none', ms: 0 }, id);
}

sendLayers();

function updateLive() {
  [...grid.children].forEach((tile, i) => tile.classList.toggle('live', i === live));
  updateBibleHighlight();
  if (typeof updatePlaylistLive === 'function') updatePlaylistLive();
}

/* ---------- Вкладки и уведомления ---------- */

// На вкладке «Экран» открыт плейлист или библиотека (tab = 'service'); старое 'screen' (отдельные файлы) ведёт туда же
let tab = 'service';
let screenPart = 'service';
// Редакторы во вкладке «Редактор»: [вкладка, название, иконка, клавиши, открыть]
const ED_KINDS = [
  ['themes', 'Редактор тем', 'theme', 'Ctrl+4', () => openThemeTab()],
  ['scenes', 'Редактор сцен', 'screens', 'Ctrl+6', () => openScreensTab()],
  ['macros', 'Редактор макросов', 'macro', 'Ctrl+5', () => openMacroTab()],
  ['audio', 'Аудиоредактор', 'wave', 'Ctrl+7', () => openAudioTab()],
];
function setTab(name) {
  if (name === 'screen') name = 'service'; // «Отдельных файлов» больше нет — всё в плейлистах и библиотеках
  if (name === 'screens') name = 'scenes'; // «Экраны» — теперь «Редактор → Редактор сцен»
  if (tab === 'themes' && name !== 'themes' && typeof teSlideTidy === 'function') teSlideTidy(); // нетронутый вид слайда — снова «как в теме»
  tab = name;
  const onScreen = name === 'screen' || name === 'service';
  if (onScreen) screenPart = name;
  $('screenView').hidden = !onScreen;
  $('filesPane').hidden = name !== 'screen';
  $('svcPane').hidden = name !== 'service';
  $('bibleView').hidden = name !== 'bible';
  $('musicView').hidden = name !== 'music';
  $('themesView').hidden = name !== 'themes';
  $('macrosView').hidden = name !== 'macros';
  $('screensView').hidden = name !== 'scenes';
  $('audioView').hidden = name !== 'audio';
  // Редакторы (темы, сцены, макросы) — во всю ширину: «Предпросмотр» справа прячется
  document.body.classList.toggle('te-mode', name === 'themes');
  document.body.classList.toggle('mc-mode', name === 'macros');
  document.body.classList.toggle('sc-mode', name === 'scenes');
  document.body.classList.toggle('ae-mode', name === 'audio');
  if (typeof aeTabOpen === 'function') { if (name === 'audio') aeTabOpen(); else aeTabClose(); }
  if (typeof scTabOpen === 'function') { if (name === 'scenes') scTabOpen(); else scTabClose(); }
  // Все вкладки занимают всю высоту и прокручиваются внутри своих панелей
  document.querySelector('main').classList.add('bible-mode');
  // Колонка «Плейлисты и библиотеки» + «Содержание» одна на «Экран» и «Библию» — переезжает в открытую вкладку
  const col = document.querySelector('.svc-col');
  if (name === 'bible') $('bibleSideSlot').append(col);
  else if (onScreen) $('screenView').prepend(col);
  if (name === 'music' && typeof renderMusic === 'function') renderMusic();
  if ((onScreen || name === 'bible') && typeof renderSide === 'function' && lib) renderSide();
  else document.body.classList.remove('side-folded'); // в «Музыке» колонки нет — предпросмотр обычной ширины
  // Заходим в Библию — все книги свёрнуты
  if (name === 'bible' && typeof bible !== 'undefined' && bible) { navOpen = -1; renderNav(); }
  // Заходим в Библию — курсор сразу в поле «Место» (старый текст выделен: начали печатать — он заменится)
  if (name === 'bible') { const r = $('refInput'); r.focus({ preventScroll: true }); r.select(); }
  $('tabScreen').setAttribute('aria-selected', String(onScreen));
  $('tabBible').setAttribute('aria-selected', String(name === 'bible'));
  $('tabMusic').setAttribute('aria-selected', String(name === 'music'));
  $('tabThemes').setAttribute('aria-selected', String(ED_KINDS.some(([k]) => k === name))); // вкладка «Редактор»
  edPickSync();
  $('viewTitle').hidden = name !== 'service' && name !== 'bible'; // название плейлиста — только где видны списки
  applyScale();
  if (name === 'themes' && typeof teOpen === 'function') teOpen();
  if (typeof mcTabOpen === 'function') { if (name === 'macros') mcTabOpen(); else mcRenderDock(); }
}

/* ---------- Строка под «Предпросмотром»: модули .vb-mod, у каждого data-parts="bible screen" ---------- */

function syncViewBar(part) {
  let any = false;
  for (const m of $('viewBar').querySelectorAll('.vb-mod')) {
    m.hidden = !part || !(m.dataset.parts || '').split(' ').includes(part);
    any = any || !m.hidden;
  }
  $('viewBar').hidden = !any;
}

/* ---------- Scale: размер слайдов-миниатюр на вкладке (только вид, слайды не меняются) ---------- */

const SCALE = { bible: ['scaleBible', '--bible-tile', 'Библия'], screen: ['scaleScreen', '--svc-tile', 'Экран'] };
const scalePart = () => (tab === 'bible' ? 'bible' : tab === 'music' || tab === 'themes' || tab === 'macros' || tab === 'scenes' || tab === 'audio' ? null : 'screen');
const scaleGrid = (part) => (part === 'bible' ? $('verses') : tab === 'screen' ? $('grid') : document.querySelector('#svcFeed .svc-slides'));

// Сколько слайдов помещается в ряд при текущем размере и ширине панели
function scaleCols(part) {
  const g = scaleGrid(part);
  const cols = g && g.clientWidth ? getComputedStyle(g).gridTemplateColumns : 'none';
  if (cols && cols !== 'none') return cols.split(' ').length;
  const w = (part === 'bible' ? $('verses') : $('svcFeed')).clientWidth - 20;
  return Math.max(1, Math.floor((w + 10) / (settings[SCALE[part][0]] + 10)));
}

function applyScale() {
  for (const [key, cssVar] of Object.values(SCALE)) document.documentElement.style.setProperty(cssVar, settings[key] + 'px');
  const part = scalePart();
  syncViewBar(part || (tab === 'themes' || tab === 'macros' || tab === 'scenes' || tab === 'audio' ? tab : 'music')); // в «Музыке» слайдов нет — там только переход, в «Темах» и «Макросах» строки нет
  if (!part) return;
  const [key, , name] = SCALE[part];
  $('scaleRange').value = settings[key];
  $('scaleRange').dataset.def = DEFAULTS[key];
  $('scaleWhere').textContent = '· ' + name;
  const off = part === 'bible' && settings.bibleView !== 'slides';
  $('scaleMod').classList.toggle('off', off);
  $('scaleVal').textContent = off ? 'для «Слайдов»' : `${scaleCols(part)} в ряд`;
}

function setScale(v) {
  const part = scalePart();
  if (!part) return;
  settings[SCALE[part][0]] = Math.max(110, Math.min(640, Math.round(v / 10) * 10));
  saveSettings();
  applyScale();
}
$('scaleRange').addEventListener('input', (e) => setScale(Number(e.target.value)));
$('scaleMinus').addEventListener('click', () => setScale(Number($('scaleRange').value) - 30));
$('scalePlus').addEventListener('click', () => setScale(Number($('scaleRange').value) + 30));
// Ctrl + колёсико над слайдами — крупнее/мельче
['verses', 'svcFeed', 'grid'].forEach((id) => $(id).addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setScale(Number($('scaleRange').value) + (e.deltaY < 0 ? 20 : -20));
}, { passive: false }));
// Ширина панели поменялась — обновляем «N в ряд»
new ResizeObserver(() => { if (!$('viewBar').hidden) applyScale(); }).observe(document.querySelector('main'));
$('tabScreen').addEventListener('click', () => setTab(screenPart));
$('tabBible').addEventListener('click', () => setTab('bible'));
$('tabMusic').addEventListener('click', () => setTab('music'));
/* ---------- Вкладка «Редактор»: редактор тем, сцен, макросов (выбор — меню у вкладки и кнопка слева сверху в каждом; ED_KINDS — выше, у setTab) ---------- */
function edMenu(at) {
  showMenu(at, ED_KINDS.map(([k, name, , key, fn]) => ({ label: (tab === k ? '✓ ' : '   ') + name, key, fn })));
}
const edAt = (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left, clientY: r.bottom + 2 }; };
// Кнопка «Редактор … ▾» — первой строкой в левой колонке каждого редактора
function edPickSync() {
  for (const [k, name, icon] of ED_KINDS) {
    const view = $(k === 'themes' ? 'themesView' : k === 'scenes' ? 'screensView' : k === 'audio' ? 'audioView' : 'macrosView');
    const side = view && view.firstElementChild;
    if (!side || side.querySelector(':scope > .ed-pick')) continue;
    const b = Object.assign(document.createElement('button'), { className: 'ed-pick', title: 'Переключить редактор: темы, сцены, макросы, аудио' });
    b.append(Icons.el(icon), Object.assign(document.createElement('span'), { className: 'ed-v', textContent: name }), '▾');
    b.addEventListener('click', () => edMenu(edAt(b)));
    side.prepend(b);
  }
}
$('tabThemes').addEventListener('click', (e) => edMenu(edAt(e.currentTarget)));

// Строка сверху показывает только ошибки и долгую загрузку (isProgress), а не «готово, добавлено»
function showNotice(text, isError, isProgress) {
  if (text && !isError && !isProgress) return;
  notice.hidden = !text;
  notice.textContent = text || '';
  notice.classList.toggle('error', !!isError);
  notice.title = isError ? 'Нажмите, чтобы скрыть' : '';
}
notice.addEventListener('click', () => { if (notice.classList.contains('error')) showNotice(''); });
window.api.onStatus((text) => showNotice(text, false, true));

/* ---------- Экран: фото, SVG, видео, слайды ---------- */

let media = [];

// Списки «Экран» и «Музыка» помнятся между запусками
const LIST_KEYS = ['type', 'name', 'path', 'url', 'fit', 'theme'];
const pickKeys = (x) => Object.fromEntries(LIST_KEYS.filter((k) => x[k] != null).map((k) => [k, x[k]]));
function saveLists() {
  try {
    localStorage.setItem('cp.media', JSON.stringify(media.map(pickKeys)));
    localStorage.setItem('cp.tracks', JSON.stringify(tracks.map(pickKeys)));
  } catch { /* не страшно */ }
}
function loadList(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((x) => x && x.url) : []; } catch { return []; }
}

/* ---------- Миниатюры: лёгкие картинки вместо тяжёлых фото и видео ---------- */

// Кэш в памяти + папка thumbs/ у main; не больше трёх запросов сразу
const thumbCache = new Map();
const thumbQueue = [];
let thumbBusy = 0;
function getThumb(file) {
  if (!file) return Promise.resolve(null);
  if (!thumbCache.has(file)) {
    thumbCache.set(file, new Promise((resolve) => thumbQueue.push({ file, resolve })));
    pumpThumbs();
  }
  return thumbCache.get(file);
}
function pumpThumbs() {
  while (thumbBusy < 3 && thumbQueue.length) {
    const { file, resolve } = thumbQueue.shift();
    thumbBusy += 1;
    Promise.resolve(window.api.poolThumb(file)).catch(() => null).then((u) => { thumbBusy -= 1; resolve(u || null); pumpThumbs(); });
  }
}
// Миниатюра грузится, когда плитка показалась на экране; не вышло — сам файл (как раньше)
const thumbSeen = new IntersectionObserver((list) => {
  for (const en of list) if (en.isIntersecting) { thumbSeen.unobserve(en.target); en.target.loadThumb(); }
}, { rootMargin: '300px' });
function thumbImg(item, cls) {
  const img = Object.assign(document.createElement('img'), { className: cls || '', draggable: false, alt: '' });
  img.loadThumb = async () => {
    const u = await getThumb(item.path);
    if (u) img.src = u;
    else if (item.type === 'video') img.replaceWith(Object.assign(document.createElement('video'), { className: cls || '', src: item.url + '#t=0.5', muted: true, preload: 'metadata' }));
    else img.src = item.url;
  };
  thumbSeen.observe(img);
  return img;
}

function renderMedia() {
  saveLists();
  grid.replaceChildren();
  $('emptyScreen').hidden = media.length > 0;
  media.forEach((item, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.tabIndex = 0;

    const thumb = thumbImg(item, 'thumb');

    const name = Object.assign(document.createElement('div'), { className: 'name', textContent: item.name, title: item.name });
    const badge = Object.assign(document.createElement('span'), { className: 'badge', textContent: 'На экране' });
    const remove = Object.assign(document.createElement('button'), { className: 'remove', textContent: '×', title: 'Убрать из списка' });
    remove.addEventListener('click', (e) => { e.stopPropagation(); removeMedia(i); });

    // Тема (затемнение и размытие) и правка картинки в редакторе
    const tools = Object.assign(document.createElement('div'), { className: 'tools' });
    const themeBtn = Object.assign(document.createElement('button'), { textContent: '🎨', title: 'Тема: затемнение, размытие' });
    themeBtn.addEventListener('click', (e) => { e.stopPropagation(); openThemePicker({ kind: 'media', media: item, name: item.name }); });
    tools.append(themeBtn);
    if (item.type === 'image') {
      const editBtn = Object.assign(document.createElement('button'), { textContent: '✎', title: 'Изменить картинку в редакторе' });
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openImageEditor(item, { media: true }); });
      tools.append(editBtn);
    }

    tile.append(thumb, name, badge, tools, remove);
    tile.addEventListener('click', () => showItem(i));
    tile.addEventListener('contextmenu', (e) => { e.preventDefault(); mediaMenu(e, item); });
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') showItem(i); });
    grid.append(tile);
  });
  updateLive();
  if (typeof renderSide === 'function' && lib) renderSide(); // число файлов слева
}

function removeMedia(i) {
  media.splice(i, 1);
  if (live === i) { const id = Object.keys(layerOn).find((k) => (layerOn[k].marks || {}).live === i); if (id) clearLayer(id); else live = -1; }
  else if (live > i) live -= 1;
  renderMedia();
}

function showItem(i) {
  if (i < 0 || i >= media.length) return;
  const item = media[i];
  live = i;
  bShown = null;
  plShown = null;
  present(() => ({ type: item.type, url: item.url, fit: item.fit || settings.fit, sound: settings.videoSound, loop: settings.videoLoop, style: styleOf('media', item) }), item.name);
}

function nextMedia() { showItem(live < 0 ? 0 : Math.min(live + 1, media.length - 1)); }
function prevMedia() { showItem(live < 0 ? 0 : Math.max(live - 1, 0)); }

/* ---------- Музыка ---------- */

let tracks = [];       // быстрая очередь (раньше — список «Музыка»)
let curTrack = -1;     // номер песни в списке, который сейчас играет (playList в music.js)
const audio = new Audio();
audio.volume = 0.8;

const fmt = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// Музыка, быстрая очередь и проигрыватель под предпросмотром — в music.js

/* ---------- Библия ---------- */

const versesEl = $('verses');
const resultsEl = $('results');
const resultsBody = $('resultsBody');
const bmVersesEl = $('bmVerses');
const bookNav = $('bookNav');

const LANGS = { ru: 'Русский', uk: 'Українська', en: 'English', et: 'Eesti', de: 'Deutsch', other: 'Другие' };

const bibleCache = new Map();
let bibleIndex = [];  // [{ id, name, lang }] в том порядке, в каком их расставил оператор
let bible = null;
let bBi = 0;          // открытая книга (номер в переводе)
let bCi = 0;          // открытая глава
let navOpen = -1;     // книга, у которой раскрыт список глав
let bOpen = false;    // глава выбрана (до этого справа подсказка «выберите книгу и главу»)
let bShown = null;    // что из Библии показано на экране: { bid, bi, ci, v1, v2, pane }
let anchor = null;    // откуда тянется выделение стихов с Shift: { pane, bi, ci, v }
let bmView = null;    // что открыто во второй половине: { id, bi, ci, v1, v2 }
let refSel = null;    // место, найденное по мере набора в поле «Место» (ещё не на экране): { v1, v2 }
let chSel = [];       // открытые главы [[bi, ci], …] по порядку книг; обычно одна, с Ctrl/Shift — несколько
let chAnchor = null;  // откуда тянется диапазон глав с Shift: [bi, ci]
const vsel = { main: [], bm: [] };       // режим «Слайды»: выделенные слайды-стихи, ключи «bi:ci:v»
const vAnchor = { main: null, bm: null };
let bPane = 'main';   // в какой половине работали последней (для Ctrl+A)
const MAX_CH = 200;   // больше глав разом не открываем — окно станет медленным

const vkey = (bi, ci, v) => `${bi}:${ci}:${v}`;
const unkey = (k) => { const [bi, ci, v] = k.split(':').map(Number); return { bi, ci, v }; };
const rowKey = (row) => vkey(row.dataset.bi, row.dataset.ci, row.dataset.v);
// Порядок книг — синодальный (как в русских Библиях): после Деяний — Иак, 1–2 Пет, 1–3 Ин, Иуд, затем послания Павла.
// canon остаётся протестантским (Рим = 45), меняется только порядок показа; книги вне канона — в конце
const SYNODAL_ORDER = [...Array.from({ length: 44 }, (_, i) => i + 1), 59, 60, 61, 62, 63, 64, 65, ...Array.from({ length: 14 }, (_, i) => i + 45), 66];
const SYNODAL_RANK = new Map(SYNODAL_ORDER.map((c, i) => [c, i + 1]));
const bookOrd = (bi) => SYNODAL_RANK.get(bible.books[bi].canon) || 100 + bi;
const chCmp = (a, b) => bookOrd(a[0]) - bookOrd(b[0]) || a[0] - b[0] || a[1] - b[1];
function sortKeys(keys) {
  return [...new Set(keys)].map(unkey).sort((a, b) => chCmp([a.bi, a.ci], [b.bi, b.ci]) || a.v - b.v).map((k) => vkey(k.bi, k.ci, k.v));
}
const slidesMode = () => settings.bibleView === 'slides';

// Язык перевода угадываем по тексту, потом его можно поправить в настройке переводов
function guessLang(b) {
  const sample = b.books.slice(0, 3).map((bk) => bk.name + ' ' + (bk.chapters.find((c) => c.length) || []).slice(0, 8).join(' ')).join(' ');
  if (/[іїєґ]/i.test(sample)) return 'uk';
  if (/[а-яё]/i.test(sample)) return 'ru';
  if (/õ/i.test(sample) || /\b(ja|ning|jumal)\b/i.test(sample)) return 'et';
  if (/\b(und|der|die|gott)\b/i.test(sample)) return 'de';
  if (/\b(the|and|god)\b/i.test(sample)) return 'en';
  return 'other';
}

async function loadBible(id) {
  let b = bibleCache.get(id);
  if (!b) {
    b = await window.api.bibleLoad(id);
    if (b) bibleCache.set(id, b);
  }
  return b;
}

// Книга с тем же каноническим номером в другом переводе (чтобы переключение перевода не сбивало место)
function sameBook(b, fromBook, fallback) {
  if (fromBook && fromBook.canon) {
    const i = b.books.findIndex((bk) => bk.canon === fromBook.canon);
    if (i >= 0) return i;
  }
  return Math.min(Math.max(0, fallback), b.books.length - 1);
}

function renderChips() {
  const box = $('trChips');
  box.replaceChildren();
  const groups = new Map();
  for (const t of bibleIndex) {
    const lang = LANGS[t.lang] ? t.lang : 'other';
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang).push(t);
  }
  for (const [lang, list] of groups) {
    const g = Object.assign(document.createElement('div'), { className: 'tr-group' });
    if (groups.size > 1) g.append(Object.assign(document.createElement('span'), { className: 'tr-lang', textContent: LANGS[lang] }));
    for (const t of list) {
      const chip = Object.assign(document.createElement('button'), { className: 'chip', textContent: trLabel(t), title: `Перейти на перевод «${t.name}»` });
      chip.setAttribute('aria-pressed', String(!!bible && bible.id === t.id));
      chip.addEventListener('click', () => selectBible(t.id));
      g.append(chip);
    }
    box.append(g);
  }
  // Полный список — выпадающим списком: удобно, когда переводов много
  const sel = $('trSelect');
  sel.replaceChildren();
  sel.hidden = bibleIndex.length < 2;
  for (const [lang, list] of groups) {
    const og = Object.assign(document.createElement('optgroup'), { label: LANGS[lang] });
    for (const t of list) og.append(Object.assign(document.createElement('option'), { value: t.id, textContent: settings.trShort ? `${trAbbr(t)} — ${t.name}` : t.name }));
    sel.append(og);
  }
  if (bible) sel.value = bible.id;
  fillBible2Selects(); // «(основной)» у второго перевода — по новому основному
}
$('trSelect').addEventListener('change', (e) => selectBible(e.target.value));

// Следующий/предыдущий установленный перевод (Ctrl+] / Ctrl+[)
function bibleCycle(d) {
  if (bibleIndex.length < 2) return;
  const i = bibleIndex.findIndex((t) => bible && t.id === bible.id);
  const t = bibleIndex[(i + d + bibleIndex.length) % bibleIndex.length];
  selectBible(t.id).then(() => flashStatus(`Перевод: ${trLabel(t)}`));
}

async function initBible() {
  bibleIndex = await window.api.bibleList();
  // У переводов, добавленных раньше, ещё нет языка — определяем один раз
  if (bibleIndex.some((t) => !t.lang)) {
    for (const t of bibleIndex) {
      if (t.lang) continue;
      const b = await loadBible(t.id);
      t.lang = b ? guessLang(b) : 'other';
    }
    bibleIndex = await window.api.bibleSetIndex(bibleIndex);
  }
  renderChips();
  applyDock();
  renderBookmarks();
  await loadSlotBibles();
  syncParUi();
  const id = bibleIndex.some((b) => b.id === settings.bibleId) ? settings.bibleId : bibleIndex[0] && bibleIndex[0].id;
  if (id) await selectBible(id); else updateBibleEmpty();
}

function updateBibleEmpty() {
  $('emptyBible').hidden = !!bible;
  $('bibleBody').hidden = !bible;
  $('bmToggle').disabled = !bible;
}

async function selectBible(id) {
  const b = await loadBible(id);
  if (!b) { showNotice('Не удалось открыть перевод', true); return; }
  const prev = bible;
  bible = b;
  // Набор с дополнительными стихами — то же место в новом переводе
  if (bSet && prev && bSet.bid === prev.id && prev.books[bSet.bi]) { bSet.bi = sameBook(b, prev.books[bSet.bi], bSet.bi); bSet.bid = b.id; }
  settings.bibleId = id;
  saveSettings();
  resultsEl.hidden = true;
  anchor = null;
  // Раскрытая книга остаётся раскрытой и в новом переводе — список не схлопывается и не прыгает
  navOpen = prev && navOpen >= 0 && prev.books[navOpen] ? sameBook(b, prev.books[navOpen], navOpen) : -1;
  if (prev && bOpen) {
    // Остаёмся на том же месте (и на тех же главах) в новом переводе
    const map = ([pbi, pci]) => {
      const bi = sameBook(b, prev.books[pbi], pbi);
      return [bi, Math.min(pci, Math.max(0, b.books[bi].chapters.length - 1))];
    };
    const list = (chSel.length ? chSel : [[bBi, bCi]]).map(map);
    vsel.main = [];
    const vTop = versesEl.scrollTop; // при смене перевода стихи остаются там же, где были
    if (list.length > 1) openChapters(list);
    else openChapter(...list[0]);
    versesEl.scrollTop = vTop;
    if (bmView) { bmView.bi = sameBook(b, prev.books[bmView.bi], bmView.bi); renderBmPane(); }
  } else {
    // Все книги свёрнуты: сначала книга, потом глава
    bOpen = false;
    bBi = 0;
    bCi = 0;
    chSel = [];
    vsel.main = [];
    renderNav();
    $('mainTitle').textContent = 'Выберите книгу и главу';
    versesEl.classList.remove('as-slides');
    versesEl.replaceChildren(Object.assign(document.createElement('div'), {
      className: 'bible-hint', textContent: 'Слева выберите книгу, затем главу (Ctrl+щелчок — несколько глав, Shift+щелчок — диапазон). Или введите место сверху: «Ин 3:16».',
    }));
  }
  renderChips();
  renderBookmarks();
  updateBibleEmpty();
  renderBset();
}

/* Список книг: сначала книга, под ней номера глав */

function renderNav(reveal) {
  // Прокрутку списка сохраняем: раньше список перестраивался и прыгал в самое начало
  const keep = bookNav.scrollTop;
  let openBtn = null;
  bookNav.replaceChildren();
  const parts = [
    ['Ветхий Завет', (bk) => bk.canon >= 1 && bk.canon <= 39],
    ['Новый Завет', (bk) => bk.canon >= 40 && bk.canon <= 66],
    ['Другие книги', (bk) => !(bk.canon >= 1 && bk.canon <= 66)],
  ];
  for (const [title, test] of parts) {
    const idx = bible.books.map((bk, i) => (test(bk) ? i : -1)).filter((i) => i >= 0).sort((a, b) => bookOrd(a) - bookOrd(b) || a - b);
    if (!idx.length) continue;
    bookNav.append(Object.assign(document.createElement('div'), { className: 'nav-head', textContent: title }));
    for (const i of idx) {
      const bk = bible.books[i];
      const btn = Object.assign(document.createElement('button'), { className: 'book' + (bOpen && chSel.some((x) => x[0] === i) ? ' open' : ''), textContent: bk.name });
      btn.addEventListener('click', (e) => {
        if (bk.chapters.filter((c) => c.length).length === 1) { chapterClick(i, Math.max(0, bk.chapters.findIndex((c) => c.length)), e); return; }
        navOpen = navOpen === i ? -1 : i;
        renderNav(navOpen === i);
      });
      bookNav.append(btn);
      if (i !== navOpen) continue;
      const grid = Object.assign(document.createElement('div'), { className: 'chapters' });
      bk.chapters.forEach((c, ci) => {
        const cb = Object.assign(document.createElement('button'), {
          textContent: ci + 1, disabled: !c.length, title: 'Щелчок — открыть главу · Ctrl+щелчок — добавить или убрать · Shift+щелчок — все главы до этой',
        });
        if (bOpen && chSel.some((x) => x[0] === i && x[1] === ci)) cb.className = 'cur';
        cb.addEventListener('click', (e) => chapterClick(i, ci, e));
        grid.append(cb);
      });
      bookNav.append(grid);
      openBtn = grid;
    }
  }
  bookNav.scrollTop = keep;
  // Только что раскрытая книга: если её главы ушли за низ списка — чуть докручиваем, только внутри списка (не всё окно)
  if (reveal && openBtn) {
    const nav = bookNav.getBoundingClientRect();
    const r = openBtn.getBoundingClientRect();
    if (r.bottom > nav.bottom) bookNav.scrollTop += Math.min(r.bottom - nav.bottom + 6, r.top - nav.top - 40);
  }
}

function openChapter(bi, ci) {
  bBi = bi;
  bCi = ci;
  bOpen = true;
  refSel = null;
  chSel = [[bi, ci]];
  chAnchor = [bi, ci];
  vsel.main = [];
  renderNav(); // список глав раскрывается только по щелчку на книгу
  $('mainTitle').textContent = `${bible.books[bi].name} ${ci + 1}`;
  $('mainTitle').title = '';
  renderVerses();
  versesEl.scrollTop = 0;
}

// Несколько глав подряд в одной половине — как один текст, по порядку книг и глав
function openChapters(list) {
  const seen = new Set();
  list = list.filter((x) => !seen.has(x.join(':')) && seen.add(x.join(':'))).sort(chCmp);
  if (list.length > MAX_CH) { list = list.slice(0, MAX_CH); flashStatus(`Открыто только первых ${MAX_CH} глав`); }
  if (list.length === 1) { openChapter(...list[0]); return; }
  [bBi, bCi] = list[0];
  bOpen = true;
  refSel = null;
  chSel = list;
  vsel.main = vsel.main.filter((k) => { const { bi, ci } = unkey(k); return list.some((x) => x[0] === bi && x[1] === ci); });
  renderNav();
  $('mainTitle').textContent = $('mainTitle').title = chaptersTitle(list);
  renderVerses();
}

// Все непустые главы перевода по порядку книг
function allChapters() {
  const out = [];
  bible.books.map((_, bi) => bi).sort((a, b) => bookOrd(a) - bookOrd(b) || a - b)
    .forEach((bi) => bible.books[bi].chapters.forEach((c, ci) => { if (c.length) out.push([bi, ci]); }));
  return out;
}

// Щелчок по главе: просто — одна глава, Ctrl — добавить/убрать, Shift — все главы от прошлой до этой
function chapterClick(bi, ci, e) {
  const same = (x) => x[0] === bi && x[1] === ci;
  if ((e.ctrlKey || e.metaKey) && bOpen) {
    let list = chSel.some(same) ? chSel.filter((x) => !same(x)) : [...chSel, [bi, ci]];
    if (!list.length) list = [[bi, ci]];
    chAnchor = [bi, ci];
    openChapters(list);
    if (chSel.length > 1) flashStatus(`Глав выбрано: ${chSel.length}`);
  } else if (e.shiftKey && bOpen && chAnchor) {
    const all = allChapters();
    const a = all.findIndex((x) => x[0] === chAnchor[0] && x[1] === chAnchor[1]);
    const b = all.findIndex(same);
    if (a < 0 || b < 0) { openChapter(bi, ci); return; }
    const keep = chAnchor;
    openChapters(all.slice(Math.min(a, b), Math.max(a, b) + 1));
    chAnchor = keep;
    if (chSel.length > 1) flashStatus(`Глав выбрано: ${chSel.length}`);
  } else openChapter(bi, ci);
}

// «Иоанна 3-5, 7; Римлянам 8»
function runs(nums) {
  const out = [];
  let s = nums[0], p = nums[0];
  for (const n of nums.slice(1).concat(NaN)) {
    if (n === p + 1) { p = n; continue; }
    out.push(s === p ? `${s}` : `${s}-${p}`);
    s = p = n;
  }
  return out.join(', ');
}
function chaptersTitle(list) {
  const parts = [];
  for (const [bi, ci] of list) {
    const last = parts[parts.length - 1];
    if (last && last.bi === bi) last.chs.push(ci + 1); else parts.push({ bi, chs: [ci + 1] });
  }
  return parts.map((p) => `${bible.books[p.bi].name} ${runs(p.chs)}`).join('; ');
}
// «Иоанна 3:16-18, 20; 4:1; Римлянам 8:1»
// nameOf — как называть книгу (для второго перевода — его названием)
function refString(keys, nameOf = (bi) => bible.books[bi].name) {
  const books = [];
  for (const k of sortKeys(keys).map(unkey)) {
    let b = books[books.length - 1];
    if (!b || b.bi !== k.bi) { b = { bi: k.bi, chs: [] }; books.push(b); }
    let c = b.chs[b.chs.length - 1];
    if (!c || c.ci !== k.ci) { c = { ci: k.ci, vs: [] }; b.chs.push(c); }
    c.vs.push(k.v);
  }
  return books.map((b) => `${nameOf(b.bi)} ` + b.chs.map((c) => `${c.ci + 1}:${runs(c.vs)}`).join('; ')).join('; ');
}
const verseText = (k) => { const { bi, ci, v } = unkey(k); return ((bible.books[bi] || {}).chapters || [])[ci]?.[v - 1] || ''; };
// Все стихи открытых глав
const chapterKeys = (list) => list.flatMap(([bi, ci]) => (bible.books[bi].chapters[ci] || []).map((t, vi) => (t ? vkey(bi, ci, vi + 1) : null)).filter(Boolean));
// Что сейчас показано на экране — ключами стихов
function shownKeys() {
  if (!bible || !bShown || bShown.bid !== bible.id) return [];
  if (bShown.keys) return bShown.keys;
  const out = [];
  for (let v = bShown.v1; v <= bShown.v2; v++) if (verseText(vkey(bShown.bi, bShown.ci, v))) out.push(vkey(bShown.bi, bShown.ci, v));
  return out;
}

// Соседняя непустая глава (через границы книг)
function chapterStep(bi, ci, d) {
  const books = bible.books;
  for (;;) {
    ci += d;
    if (ci >= books[bi].chapters.length) { bi += 1; ci = 0; if (bi >= books.length) return null; }
    if (ci < 0) { bi -= 1; if (bi < 0) return null; ci = books[bi].chapters.length - 1; }
    if ((books[bi].chapters[ci] || []).length) return [bi, ci];
  }
}

/* Стихи: одинаково в основной половине и в половине закладки */

function fillVerses(container, pane, chapters) {
  container.replaceChildren();
  // Слайдами — каждый стих квадратиком, как он будет выглядеть на экране (с темой Библии)
  const asSlides = slidesMode();
  container.classList.toggle('as-slides', asSlides);
  const style = asSlides ? { ...styleOf('bible'), bgVideo: false, still: true } : null;
  for (const [bi, ci] of chapters) {
    const chapter = bible.books[bi].chapters[ci] || [];
    const book = bible.books[bi].name;
    if (chapters.length > 1) container.append(Object.assign(document.createElement('div'), { className: 'ch-head', textContent: `${book} ${ci + 1}` }));
    chapter.forEach((text, vi) => {
      if (!text) return;
      const n = vi + 1;
      const k = vkey(bi, ci, n);
      // Длинный стих, поделенный на части, в «Слайдах» — слайдом на каждую часть (7A, 7B)
      const parts = asSlides ? verseParts(k) : [text];
      parts.forEach((_, pi) => {
        let row;
        if (asSlides) {
          const d = bibleData([k], pi, parts);
          row = Object.assign(document.createElement('div'), { className: 'vslide', tabIndex: 0, title: d.ref });
          row.append(Scene.build({ type: 'text', ...d, style }),
            Object.assign(document.createElement('span'), { className: 'vn', textContent: n + (parts.length > 1 ? partTag(pi) : '') }));
          row.addEventListener('pointerdown', (e) => slideDragStart(e, pane, container, row));
          row.addEventListener('dragstart', (e) => bibleDragStart(e, pane));
          if (parts.length > 1) row.dataset.part = String(pi);
        } else {
          row = Object.assign(document.createElement('div'), { className: 'verse', tabIndex: 0 });
          row.append(Object.assign(document.createElement('span'), { className: 'n', textContent: n }), document.createTextNode(text));
        }
        row.dataset.bi = String(bi);
        row.dataset.ci = String(ci);
        row.dataset.v = String(n);
        row.addEventListener('click', (e) => verseClick(e, pane, container, bi, ci, n, pi));
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey) { e.stopPropagation(); verseEnter(pane, container, bi, ci, n); } });
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); verseMenu(e, pane, bi, ci, n); });
        container.append(row);
      });
    });
  }
  if (asSlides) requestAnimationFrame(() => container.querySelectorAll('.layer.text').forEach((l) => Scene.fitText(l)));
}

// Правая кнопка по стиху: показать, разделить на части вручную, дополнительные стихи
function verseMenu(e, pane, bi, ci, n) {
  const k = vkey(bi, ci, n);
  const man = !!manualParts(k, verseText(k));
  showMenu(e, [
    { label: 'Показать', fn: () => { anchor = { pane, bi, ci, v: n }; showVerses(bi, ci, n, n, pane); } },
    { label: 'Разделить стих на части…', fn: () => splitDialog(k) },
    { label: 'Делить как сама программа', disabled: !man, fn: () => setManualSplit(k, null) },
  ]);
}

// Ручное деление стиха: «/» в тексте — начало новой части. Сам текст менять нельзя — проверяем
function splitDialog(k) {
  const text = verseText(k);
  const { bi, ci, v } = unkey(k);
  const parts = verseParts(k);
  $('splitTitle').textContent = `Разделить стих: ${bible.books[bi].name} ${ci + 1}:${v}`;
  $('splitText').value = parts.join(' / ');
  $('splitInfo').textContent = '';
  $('splitDialog').showModal();
  $('splitText').focus();
  $('splitOk').onclick = () => {
    const words = (s) => s.trim().split(/\s+/).filter(Boolean);
    const list = $('splitText').value.split('/').map((s) => s.trim()).filter(Boolean);
    if (words(list.join(' ')).join(' ') !== words(text).join(' ')) {
      $('splitInfo').textContent = 'Текст стиха изменился. Можно только ставить и убирать «/» между словами.';
      return;
    }
    if (list.length > 6) { $('splitInfo').textContent = 'Не больше 6 частей.'; return; }
    setManualSplit(k, list.length > 1 ? list.map((s) => words(s).length) : null);
    $('splitDialog').close();
  };
  $('splitAuto').onclick = () => { setManualSplit(k, null); $('splitDialog').close(); };
}
function setManualSplit(k, counts) {
  if (!lib) return;
  const key = splitKey(k);
  lib.verseSplits = { ...(lib.verseSplits || {}) };
  if (counts) lib.verseSplits[key] = counts; else delete lib.verseSplits[key];
  saveLib(); // Ctrl+Z — вернуть
  bibleLookChanged();
  flashStatus(counts ? `Стих поделён на ${counts.length} части — Ctrl+Z, чтобы вернуть` : 'Стих делится сам');
}
$('splitCancel').addEventListener('click', () => $('splitDialog').close());

// Поменялся показ Библии (второй перевод, ссылки, деление стихов): экран, миниатюры, набор
function bibleLookChanged() {
  fitCache.clear();
  if (bShown && bible && bShown.bid === bible.id && !bShown.keys && bShown.v1 === bShown.v2) {
    bShown.parts = verseParts(vkey(bShown.bi, bShown.ci, bShown.v1)).length;
    bShown.part = Math.min(bShown.part || 0, bShown.parts - 1);
  }
  refreshLive();
  if (bible && bOpen && slidesMode()) renderVerses();
  if (bible && bmView && slidesMode()) renderBmPane();
  renderBset();
  if (typeof renderService === 'function' && lib) renderService();
}

// Выделенный мышью текст внутри половины (режим «Список»)
function textSelIn(container) {
  const s = window.getSelection();
  return !!(s && s.rangeCount && !s.isCollapsed && container.contains(s.getRangeAt(0).commonAncestorContainer));
}
const selBox = () => [versesEl, bmVersesEl].find((c) => textSelIn(c)) || null;
const paneBox = (pane) => (pane === 'bm' ? bmVersesEl : versesEl);

/* «Список»: мышь и Shift выделяют текст, щелчок без выделения — стих на экран.
   «Слайды»: щелчок — слайд на экран, Ctrl — добавить к выделению, Shift — диапазон, протянуть мышью — тоже диапазон. */
function verseClick(e, pane, container, bi, ci, n, pi = 0) {
  bPane = pane;
  const k = vkey(bi, ci, n);
  if (slidesMode()) {
    if (slideDrag && slideDrag.moved) { slideDrag = null; return; }
    slideDrag = null;
    if (e.ctrlKey || e.metaKey) {
      vsel[pane] = vsel[pane].includes(k) ? vsel[pane].filter((x) => x !== k) : [...vsel[pane], k];
      vAnchor[pane] = k;
      updateBibleHighlight();
      return;
    }
    if (e.shiftKey && vAnchor[pane]) {
      vsel[pane] = rangeKeys(container, vAnchor[pane], k);
      updateBibleHighlight();
      return;
    }
    vsel[pane] = [k];
    vAnchor[pane] = k;
    anchor = { pane, bi, ci, v: n };
    showVerses(bi, ci, n, n, pane, pi);
    return;
  }
  if (textSelIn(container)) return; // выделяли текст — на экран ничего не уходит
  anchor = { pane, bi, ci, v: n };
  showVerses(bi, ci, n, n, pane);
}

// Enter: в «Списке» с выделенным текстом — эти стихи на экран; в «Слайдах» — выделенные слайды
function verseEnter(pane, container, bi, ci, n) {
  const k = vkey(bi, ci, n);
  if (!slidesMode() && textSelIn(container)) { showKeys(textSelKeys(container), pane); return; }
  if (slidesMode() && vsel[pane].length > 1 && vsel[pane].includes(k)) { showKeys(vsel[pane], pane); return; }
  verseClick({}, pane, container, bi, ci, n);
}

// Ключи слайдов между двумя (по порядку на странице)
function rangeKeys(container, a, b) {
  const keys = [...container.querySelectorAll('[data-v]')].map(rowKey);
  const i = keys.indexOf(a);
  const j = keys.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return keys.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// Протянуть мышью по слайдам — выделить их диапазоном
let slideDrag = null; // { pane, container, start, moved }
function slideDragStart(e, pane, container, row) {
  // Тянут уже выделенный слайд — это перетаскивание выделенного в плейлист (bibleDragStart), а не новое выделение
  row.draggable = vsel[pane].includes(rowKey(row));
  if (row.draggable || e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey) return;
  slideDrag = { pane, container, start: rowKey(row), moved: false };
}

// Выделенные слайды-стихи тянут на плейлист, библиотеку или в «Содержание» слева (по порядку Писания)
function bibleDragStart(e, pane) {
  const keys = sortKeys(vsel[pane]);
  if (!keys.length) { e.preventDefault(); return; }
  slideDrag = null;
  e.dataTransfer.setData('application/x-cp-bible', JSON.stringify({ keys }));
  e.dataTransfer.effectAllowed = 'copy';
  // Под курсором — плашка «N слайдов» вместо картинки одного слайда
  const tag = Object.assign(document.createElement('div'), { className: 'drag-tag', textContent: `${refString(keys)} · ${keys.length} сл.` });
  document.body.append(tag);
  e.dataTransfer.setDragImage(tag, 12, 12);
  requestAnimationFrame(() => tag.remove());
  document.body.classList.add('bible-dragging');
}
// После перетаскивания — никаких следов: подсветка мест сброса, рамка окна, протягивание выделения
document.addEventListener('dragend', () => {
  document.body.classList.remove('bible-dragging', 'dragging');
  document.querySelectorAll('.drag-tag').forEach((t) => t.remove());
  document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
  slideDrag = null;
});
document.addEventListener('pointerover', (e) => {
  if (!slideDrag || !(e.buttons & 1)) return;
  const row = e.target.closest && e.target.closest('.vslide');
  if (!row || !slideDrag.container.contains(row)) return;
  const k = rowKey(row);
  if (k === slideDrag.start && !slideDrag.moved) return;
  slideDrag.moved = true;
  bPane = slideDrag.pane;
  vsel[slideDrag.pane] = rangeKeys(slideDrag.container, slideDrag.start, k);
  vAnchor[slideDrag.pane] = slideDrag.start;
  updateBibleHighlight();
});
// После протягивания щелчок не должен показывать слайд — сбрасываем уже после него
document.addEventListener('pointerup', () => { if (slideDrag && slideDrag.moved) setTimeout(() => { slideDrag = null; }, 0); });

// Стихи, которых касается выделенный текст
function textSelKeys(container) {
  const s = window.getSelection();
  return [...container.querySelectorAll('[data-v]')].filter((row) => s.containsNode(row, true)).map(rowKey);
}

// Несколько стихов (в том числе из разных глав) — на экран одним слайдом
function showKeys(keys, pane = 'main') {
  keys = sortKeys(keys).filter(verseText);
  if (keys.length) showData(keys, pane, 0);
}

// Стихи (ключи по порядку) — на экран одним слайдом; pi — какая часть длинного стиха (-1 — последняя)
function showData(keys, pane, pi) {
  const ks = keys.map(unkey);
  const first = ks[0];
  const last = ks[ks.length - 1];
  const row = ks.every((k, i) => k.bi === first.bi && k.ci === first.ci && k.v === first.v + i); // подряд в одной главе
  const d = bibleData(keys, pi);
  bShown = { bid: bible.id, bi: last.bi, ci: last.ci, v1: row ? first.v : last.v, v2: last.v, pane, part: d.part, parts: d.parts };
  if (!row) bShown.keys = keys;
  live = -1;
  plShown = null;
  // Сборка заново при смене настроек (второй перевод, деление стихов) — часть та же
  present(() => ({ type: 'text', ...bibleData(keys, d.part), style: styleOf('bible') }), d.ref);
  if (typeof mcBibleShown === 'function') mcBibleShown({ ref: d.ref, bi: last.bi, ci: last.ci, v1: first.bi === last.bi && first.ci === last.ci ? first.v : 1, v2: last.v });
  renderBset();
}

// Ctrl+A: в «Слайдах» — все слайды, в «Списке» — весь текст половины
function bibleSelectAll() {
  const box = paneBox(bPane);
  if (slidesMode()) {
    vsel[bPane] = [...box.querySelectorAll('[data-v]')].map(rowKey);
    updateBibleHighlight();
    flashStatus(`Выделено слайдов: ${vsel[bPane].length}`);
  } else {
    const r = document.createRange();
    r.selectNodeContents(box);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
}

// Что брать для копирования и плейлиста: выделенные слайды → показанное → все открытые главы
function bibleKeysForAction() {
  if (!bible) return [];
  if (slidesMode() && vsel[bPane].length) return sortKeys(vsel[bPane]);
  const shown = shownKeys();
  if (shown.length) return shown;
  if (bOpen && chSel.length > 1) return chapterKeys(chSel);
  return [];
}

// «Список»: Ctrl+C без выделенного текста — чистый текст показанных стихов
async function bibleCopyText() {
  const keys = bibleKeysForAction();
  if (!keys.length) { flashStatus('Выделите текст мышью или щёлкните стих'); return; }
  const text = keys.map(verseText).join('\n') + '\n' + refString(keys);
  await window.api.clipSet({ slides: null, text });
  flashStatus(`Скопирован текст: ${keys.length} ст.`);
}

// Ctrl+C с выделенным мышью текстом: без номеров стихов, по строке на стих
document.addEventListener('copy', (e) => {
  if (tab !== 'bible') return;
  const box = selBox();
  if (!box) return;
  const frag = window.getSelection().getRangeAt(0).cloneContents();
  frag.querySelectorAll('.n, .vn, .ch-head').forEach((x) => x.remove());
  const rows = frag.querySelectorAll('.verse');
  const text = rows.length ? [...rows].map((x) => x.textContent.trim()).filter(Boolean).join('\n') : frag.textContent.trim();
  if (!text) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', text);
  flashStatus('Текст скопирован');
});

// Ctrl+V на вкладке «Библия»: место («Ин 3:16») — открыть, иначе — искать вставленные слова
async function biblePaste() {
  const { text } = await window.api.clipGet();
  const t = String(text || '').trim();
  if (!t) { flashStatus('Буфер обмена пуст'); return; }
  const first = t.split(/\r?\n/).pop().trim(); // у скопированных стихов место — последней строкой
  const r = first.length <= 40 ? Bible.parseRef(first) : null;
  if (r && Bible.findBook(bible, r.token) >= 0) { $('refInput').value = first; goRef(); return; }
  $('searchInput').value = t.replace(/\s+/g, ' ').slice(0, 120);
  syncSearchClear();
  doSearch();
}

// Клавиши вкладки «Библия» (раньше общих горячих клавиш)
function bibleKey(e) {
  if (!bible) return false;
  if (e.code === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    const box = !slidesMode() && selBox();
    if (box) { showKeys(textSelKeys(box), box === bmVersesEl ? 'bm' : 'main'); return true; }
    return false;
  }
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  if (e.code === 'KeyA') {
    // Фокус в списке закладок — выделить все закладки
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#bmList')) bmSelectAll();
    else bibleSelectAll();
    return true;
  }
  if (e.code === 'KeyC') {
    if (!slidesMode() && selBox()) return 'native'; // обычное копирование, текст почистит обработчик copy
    if (slidesMode()) bibleCopySlides(); else bibleCopyText();
    return true;
  }
  if (e.code === 'KeyV') { biblePaste(); return true; }
  return false;
}

// Переключатель «Список / Слайды»: выделение меняется вместе с режимом
function applyBibleView() {
  document.querySelectorAll('[data-bview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bview === (settings.bibleView || 'list'))));
  vsel.main = [];
  vsel.bm = [];
  vAnchor.main = vAnchor.bm = null;
  const s = window.getSelection();
  if (s && selBox()) s.removeAllRanges();
  if (bible && bOpen) renderVerses();
  if (bible && bmView) renderBmPane();
  applyScale();
}
document.querySelectorAll('[data-bview]').forEach((b) => b.addEventListener('click', () => {
  settings.bibleView = b.dataset.bview;
  saveSettings();
  applyBibleView();
}));

function renderVerses() {
  fillVerses(versesEl, 'main', chSel.length ? chSel : [[bBi, bCi]]);
  updateBibleHighlight();
}

function isShown(bi, ci, v) {
  if (!bShown || !bible || bShown.bid !== bible.id) return false;
  if (bShown.keys) return bShown.keys.includes(vkey(bi, ci, v));
  return bShown.bi === bi && bShown.ci === ci && v >= bShown.v1 && v <= bShown.v2;
}

function updateBibleHighlight() {
  const mark = (container, pane, extra) => {
    const picked = new Set(slidesMode() ? vsel[pane] : []);
    container.querySelectorAll('[data-v]').forEach((row) => {
      const bi = Number(row.dataset.bi), ci = Number(row.dataset.ci), v = Number(row.dataset.v);
      // У части длинного стиха (7A, 7B) подсвечена только та часть, что на экране
      const partOk = row.dataset.part == null || !bShown || bShown.parts < 2 || Number(row.dataset.part) === bShown.part;
      row.classList.toggle('live', isShown(bi, ci, v) && partOk);
      row.classList.toggle('picked', picked.has(rowKey(row)));
      if (extra) row.classList.toggle('marked', extra(v));
      else row.classList.toggle('sel', !!refSel && bi === bBi && ci === bCi && v >= refSel.v1 && v <= refSel.v2);
    });
  };
  mark(versesEl, 'main', null);
  if (bmView) mark(bmVersesEl, 'bm', (v) => bmView.v1 != null && v >= bmView.v1 && v <= bmView.v2);
}

function scrollToVerse(n, container = versesEl, bi = container === versesEl ? bBi : null, ci = container === versesEl ? bCi : null) {
  const row = container.querySelector(bi == null ? `[data-v="${n}"]` : `[data-bi="${bi}"][data-ci="${ci}"][data-v="${n}"]`);
  if (row) row.scrollIntoView({ block: 'center' });
}

// pi — часть длинного стиха (0 — первая, -1 — последняя), если показывают один стих
function showVerses(bi, ci, v1, v2, pane = 'main', pi = 0) {
  const chapter = bible.books[bi].chapters[ci] || [];
  const keys = [];
  for (let v = v1; v <= v2; v++) if (chapter[v - 1]) keys.push(vkey(bi, ci, v));
  if (keys.length) showData(keys, pane, pi);
}

/* ---------- Слайд Библии: второй перевод рядом и длинные стихи частями ----------
   Всё это — только показ: текст Библии в файле не меняется, стих в базе остаётся целым. */

let slotBibles = []; // переводы строк 2…4 окна «Библия» (settings.bSlots), null — перевод не выбран или удалён
async function loadSlotBibles() {
  slotBibles = await Promise.all(settings.bSlots.slice(1).map((s) => (s.id && bibleIndex.some((t) => t.id === s.id) ? loadBible(s.id) : null)));
}
// Та же книга в другом переводе b — по каноническому номеру (-1 — такой книги в нём нет)
const bookIn = (b, bi) => { const c = bible.books[bi] && bible.books[bi].canon; return c ? b.books.findIndex((bk) => bk.canon === c) : -1; };
const verseIn = (b, k) => { const { bi, ci, v } = unkey(k); const x = bookIn(b, bi); return x < 0 ? '' : (b.books[x].chapters[ci] || [])[v - 1] || ''; };
const nameIn = (b, bi) => { const x = bookIn(b, bi); return x < 0 ? bible.books[bi].name : b.books[x].name; };
const partTag = (i) => String.fromCharCode(65 + i); // 0 → A, 1 → B…

// Текст на n почти равных частей: 2 — половинки, 3 — трети… Режем у точки, «;», «:», запятой или тире,
// если такое место рядом с серединой (третью); иначе — между словами точно посередине.
// Слова не режутся, текст не теряется (все части вместе — тот же стих)
// limit — не длиннее стольких символов, если можно (тогда режем только по равенству, знаки не ищем)
function splitSense(text, n, limit = 0) {
  text = String(text || '').trim();
  if (n < 2 || !text) return [text];
  // Места между словами: pos — откуда начинается следующая часть, pen — насколько место хуже конца предложения
  const cand = [];
  for (const m of text.matchAll(/\s+/g)) {
    const before = text[m.index - 1], after = text[m.index + m[0].length];
    const pen = /[.!?…]/.test(before) ? 0 : /[;:]/.test(before) ? 0.03 : /[,]/.test(before) || /[—–]/.test(after) ? 0.06 : 0.2;
    cand.push({ at: m.index, pos: m.index + m[0].length, pen });
  }
  if (cand.length < n - 1) return [text];
  const L = text.length, part = L / n;
  const pick = (usePen) => {
    // best[k][c] — лучшая сумма штрафов, если k-й разрез — место c (разрезы идут по порядку)
    const m = cand.length;
    const cost = (k, c) => Math.abs(cand[c].pos - part * k) / part + (usePen ? cand[c].pen : 0);
    let prev = cand.map((_, c) => cost(1, c));
    const from = [];
    for (let k = 2; k < n; k++) {
      const cur = new Array(m).fill(Infinity), arg = new Array(m).fill(-1);
      let bi = -1;
      for (let c = 0; c < m; c++) {
        if (c > 0 && (bi < 0 || prev[c - 1] < prev[bi])) bi = c - 1; // лучший предыдущий разрез левее c
        if (bi >= 0) { cur[c] = prev[bi] + cost(k, c); arg[c] = bi; }
      }
      from.push(arg);
      prev = cur;
    }
    let c = prev.reduce((a, v, i) => (v < prev[a] ? i : a), 0);
    const cuts = [c];
    for (let k = from.length - 1; k >= 0; k--) cuts.unshift((c = from[k][c]));
    const out = [];
    let s = 0;
    cuts.forEach((ci) => { out.push(text.slice(s, cand[ci].at)); s = cand[ci].pos; });
    out.push(text.slice(s));
    return out;
  };
  let best = pick(true);
  if (limit && Math.max(...best.map((p) => p.length)) > limit) best = pick(false);
  return best;
}

// Ручное деление стиха (lib.verseSplits): по переводу и месту — сколько слов в каждой части
const splitKey = (k) => { const { bi, ci, v } = unkey(k); return `${bible.id}|${bible.books[bi].canon || 'b' + bi}.${ci + 1}.${v}`; };
function manualParts(k, text) {
  const m = typeof lib !== 'undefined' && lib && lib.verseSplits && lib.verseSplits[splitKey(k)];
  if (!Array.isArray(m) || m.length < 2) return null;
  const words = text.trim().split(/\s+/);
  if (m.reduce((a, b) => a + b, 0) !== words.length) return null; // текст стиха другой — делим сами
  let at = 0;
  return m.map((c) => words.slice(at, (at += c)).join(' '));
}

// Насколько крупным выйдет текст слайда после подгонки: % высоты экрана (меряем на скрытом слайде)
let fitProbe = null;
const fitCache = new Map();
function fittedPct(content) {
  if (!fitProbe) {
    fitProbe = document.createElement('div');
    Object.assign(fitProbe.style, { position: 'fixed', left: '-20000px', top: '0', width: '480px', height: '270px', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' });
    document.body.append(fitProbe);
  }
  const { W, H } = outputSize();
  fitProbe.style.height = Math.round((480 * H) / W) + 'px';
  const layer = Scene.build(content);
  fitProbe.replaceChildren(layer);
  Scene.refit(fitProbe);
  // Окна со стихами (у каждого перевода может быть своё) — берём самый мелкий текст
  const ts = [...layer.querySelectorAll('.ob[data-bv] > .pl > .tx, .body[data-bv]')];
  const px = ts.length ? Math.min(...ts.map((t) => parseFloat(getComputedStyle(t).fontSize) || 0)) : 0;
  const pct = ts.length ? (px / (fitProbe.clientHeight || 270)) * 100 : 100;
  fitProbe.replaceChildren();
  return pct;
}

// Части стиха для показа: [целый текст] или 2…N частей — 7A, 7B… (вручную или сами, если стих слишком длинный)
function verseParts(k) {
  const text = verseText(k);
  if (!text) return [text];
  const man = manualParts(k, text);
  if (man) return man;
  if (settings.vSplit !== 'split') return [text];
  const max = Math.max(2, Math.min(6, Number(settings.vMaxParts) || 3));
  const chars = Number(settings.vMaxChars) || 0;
  let n = chars > 0 ? Math.min(max, Math.ceil(text.length / chars)) : 1;
  const min = Number(settings.vMinFont) || 0;
  if (min > 0 && text.length > 40) {
    // Делим ещё, пока текст самой длинной части выходит мельче заданного
    const style = { ...styleOf('bible'), bgVideo: false, still: true };
    const sig = [bible.id, k, JSON.stringify(style), JSON.stringify(outputSize()), JSON.stringify(settings.bSlots)].join('|');
    for (; n < max; n++) {
      const parts = n > 1 ? splitSense(text, n, chars) : [text];
      if (parts.length < n) break; // делить уже не на что
      const ck = sig + '|' + n;
      let pct = fitCache.get(ck);
      if (pct == null) {
        const longest = parts.reduce((a, t, i) => (t.length > parts[a].length ? i : a), 0);
        pct = fittedPct({ type: 'text', ...bibleData([k], longest, parts), style });
        if (fitCache.size > 4000) fitCache.clear();
        fitCache.set(ck, pct);
      }
      if (pct >= min) break;
    }
  }
  return n > 1 ? splitSense(text, n, chars) : [text];
}

// Что рисовать: стихи (keys по порядку), часть pi длинного стиха, те же стихи в переводах строк 2…4 окна «Библия».
// → { verses, ref, translation, trs?, parts, part }; trs — все переводы по строкам (основной первым),
// parts — на сколько частей поделен стих (1 — целый; другие переводы делятся на столько же частей)
function bibleData(keys, pi = 0, parts = null) {
  const one = keys.length === 1;
  if (one && !parts) parts = verseParts(keys[0]);
  const n = one ? parts.length : 1;
  const i = n > 1 ? (pi < 0 ? n - 1 : Math.min(pi || 0, n - 1)) : 0;
  const tag = n > 1 ? partTag(i) : '';
  const v0 = unkey(keys[0]).v;
  const d = {
    verses: n > 1 ? [{ n: v0, t: parts[i] }] : keys.map((k) => ({ n: unkey(k).v, t: verseText(k) })),
    ref: refString(keys) + tag, translation: bibleLabel(), parts: n, part: i,
  };
  if (settings.bSlots.length > 1) {
    // Строка без перевода — пустая запись: номера строк и переводов совпадают
    d.trs = [{ verses: d.verses, ref: d.ref, translation: d.translation }].concat(slotBibles.map((b) => {
      if (!b) return { verses: [], ref: '', translation: '' };
      const have = keys.filter((k) => verseIn(b, k));
      const vs = n > 1 ? [{ n: v0, t: splitSense(verseIn(b, keys[0]), n)[i] || '' }] : have.map((k) => ({ n: unkey(k).v, t: verseIn(b, k) }));
      return {
        verses: vs.filter((v) => v.t), ref: have.length ? refString(have, (bi) => nameIn(b, bi)) + tag : '',
        translation: trLabel(bibleIndex.find((t) => t.id === b.id) || b),
      };
    }));
  }
  return d;
}

// Слайд Библии для плейлиста: тот же вид, что и на экране; extra — дополнительный стих
function bibleSlide(keys, pi, extra) {
  const d = bibleData(keys, pi);
  const s = { id: Slides.newId(), k: 'bible', label: d.ref.slice(d.ref.lastIndexOf(':') + 1), ref: d.ref, verses: d.verses, translation: d.translation };
  if (d.trs) s.trs = d.trs;
  if (extra) s.extra = true;
  return s;
}

/* ---------- Дополнительные стихи: заранее загруженный диапазон вокруг выбранных ----------
   Выбрали 5–7 и загрузили 3–8: 5–7 — одним слайдом, а 3, 4 и 8 — отдельными слайдами рядом.
   Стрелки и ‹ › листают этот набор, не закрывая показ; «＋» — добавить стихи; в плейлист набор уходит целиком. */
let bSet = null; // { bid, bi, ci, m1, m2 — выбранные, x1, x2 — вместе с дополнительными }

// Слайды набора по порядку: { v1, v2, extra }
function bsetUnits() {
  if (!bSet || !bible || bSet.bid !== bible.id || !bible.books[bSet.bi]) return [];
  const ch = bible.books[bSet.bi].chapters[bSet.ci] || [];
  const out = [];
  for (let v = bSet.x1; v < bSet.m1; v++) if (ch[v - 1]) out.push({ v1: v, v2: v, extra: true });
  out.push({ v1: bSet.m1, v2: bSet.m2, extra: false });
  for (let v = bSet.m2 + 1; v <= bSet.x2; v++) if (ch[v - 1]) out.push({ v1: v, v2: v, extra: true });
  return out;
}
// Какой слайд набора сейчас на экране (-1 — показано не из набора)
function bsetAt() {
  if (!bSet || !bShown || bShown.keys || bShown.bid !== bSet.bid || bShown.bi !== bSet.bi || bShown.ci !== bSet.ci) return -1;
  return bsetUnits().findIndex((u) => u.v1 === bShown.v1 && u.v2 === bShown.v2);
}
function bsetShow(i, pi = 0) {
  const u = bsetUnits()[i];
  if (!u) return false;
  showVerses(bSet.bi, bSet.ci, u.v1, u.v2, 'main', pi);
  if (chSel.some((x) => x[0] === bSet.bi && x[1] === bSet.ci)) scrollToVerse(u.v1, versesEl, bSet.bi, bSet.ci);
  return true;
}
// Стрелка: следующий/предыдущий слайд набора; за краем набора — дальше по главе, как обычно
const bsetStep = (d) => { const i = bsetAt(); return i >= 0 && bsetShow(i + d, d < 0 ? -1 : 0); };

// От чего считать дополнительные стихи: показанное из набора — набор; иначе показанные стихи одной главы
function bsetBase() {
  if (bSet && bsetAt() >= 0) return bSet;
  if (bShown && bible && bShown.bid === bible.id && !bShown.keys) return { bid: bible.id, bi: bShown.bi, ci: bShown.ci, m1: bShown.v1, m2: bShown.v2, x1: bShown.v1, x2: bShown.v2 };
  return bSet && bible && bSet.bid === bible.id ? bSet : null;
}
function bsetMenu(e) {
  if (!bible) return;
  const b = bsetBase();
  if (!b) { flashStatus('Сначала покажите стихи одной главы — «＋» загрузит к ним стихи до и после'); return; }
  const len = (bible.books[b.bi].chapters[b.ci] || []).length;
  const set = (x1, x2) => {
    bSet = { ...b, x1: Math.max(1, Math.min(x1, b.m1)), x2: Math.min(len, Math.max(x2, b.m2)) };
    renderBset();
    flashStatus(`Загружено заранее: ${bible.books[b.bi].name} ${b.ci + 1}:${bSet.x1}-${bSet.x2}`);
  };
  const main = `${bible.books[b.bi].name} ${b.ci + 1}:${b.m1}${b.m2 > b.m1 ? '-' + b.m2 : ''}`;
  showMenu(e, [
    { label: `Стих перед (${b.x1 - 1})`, disabled: b.x1 <= 1, fn: () => set(b.x1 - 1, b.x2) },
    { label: `Стих после (${b.x2 + 1})`, disabled: b.x2 >= len, fn: () => set(b.x1, b.x2 + 1) },
    { label: 'По 2 стиха до и после', fn: () => set(b.x1 - 2, b.x2 + 2) },
    { label: 'Диапазон…', fn: async () => {
      const s = await askName(`Дополнительные стихи к «${main}» — например 3-8`, `${b.x1}-${b.x2}`);
      if (!s) return;
      const m = s.match(/^\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*$/);
      if (!m) { showNotice('Напишите номера стихов, например 3-8', true); return; }
      const a = Number(m[1]);
      const z = Number(m[2] || m[1]);
      set(Math.min(a, z), Math.max(a, z));
    } },
    '-',
    { label: 'Весь набор — в плейлист', key: 'Ctrl+P', disabled: !bSet || bsetAt() < 0, fn: () => svcAddBible() },
    { label: 'Убрать дополнительные стихи', disabled: !bSet, fn: () => { bSet = null; renderBset(); } },
  ]);
}

// Полоска набора под полем «Место»: слайды набора (дополнительные — бледнее), ‹ › — листать
function renderBset() {
  const bar = $('bsetBar');
  const units = bsetUnits();
  bar.hidden = units.length < 2;
  const box = $('bsetChips');
  box.replaceChildren();
  if (bar.hidden) return;
  const at = bsetAt();
  $('bsetTitle').textContent = `${bible.books[bSet.bi].name} ${bSet.ci + 1}:`;
  units.forEach((u, i) => {
    const n = u.v1 === u.v2 ? verseParts(vkey(bSet.bi, bSet.ci, u.v1)).length : 1;
    for (let p = 0; p < n; p++) {
      const chip = Object.assign(document.createElement('button'), {
        className: 'bs-chip' + (u.extra ? ' extra' : ' main') + (at === i && (n < 2 || bShown.part === p) ? ' live' : ''),
        textContent: (u.v1 === u.v2 ? u.v1 : `${u.v1}–${u.v2}`) + (n > 1 ? partTag(p) : ''),
        title: u.extra ? 'Дополнительный стих — показать' : 'Выбранные стихи — показать',
      });
      chip.addEventListener('click', () => bsetShow(i, p));
      box.append(chip);
    }
  });
  $('bsetPrev').disabled = at <= 0 && !(at === 0 && bShown.part > 0);
  $('bsetNext').disabled = at < 0 || (at === units.length - 1 && !(bShown.parts > 1 && bShown.part < bShown.parts - 1));
}
$('bsetAdd').addEventListener('click', bsetMenu);
// Те же шаги, что стрелками: части длинного стиха, потом соседний слайд набора
$('bsetPrev').addEventListener('click', () => { if (bsetAt() >= 0) bibleStep(-1); else if (bSet) bsetShow(0); });
$('bsetNext').addEventListener('click', () => { if (bsetAt() >= 0) bibleStep(1); else if (bSet) bsetShow(0); });
$('bsetClose').addEventListener('click', () => { bSet = null; renderBset(); });

function goRef() {
  if (!bible) return;
  const r = oneChapterFix(Bible.parseRef($('refInput').value));
  if (!r) { showNotice('Не удалось понять место. Пример: Ин 3:16 или 1 Кор 13:4-7', true); return; }
  const bi = Bible.findBook(bible, r.token);
  if (bi < 0) { showNotice(`Книга «${r.token}» не найдена в этом переводе`, true); return; }
  const book = bible.books[bi];
  const chapter = book.chapters[r.ch - 1];
  if (!chapter || !chapter.length) { showNotice(`В книге «${book.name}» нет главы ${r.ch}`, true); return; }
  showNotice('');
  openChapter(bi, r.ch - 1);
  if (!r.v1) return;
  if (!chapter[r.v1 - 1]) { showNotice(`В главе ${r.ch} нет стиха ${r.v1}`, true); return; }
  anchor = { pane: 'main', bi, ci: r.ch - 1, v: r.v1 };
  showVerses(bi, r.ch - 1, r.v1, Math.min(r.v2, chapter.length));
  scrollToVerse(r.v1);
}

// Пока печатают «Ин 3:16», сразу открываем главу и подсвечиваем стихи; на экран — по Enter
function previewRef() {
  if (!bible) return;
  const r = oneChapterFix(Bible.parseRef($('refInput').value));
  if (!r) return;
  const bi = Bible.findBook(bible, r.token);
  if (bi < 0) return;
  const chapter = bible.books[bi].chapters[r.ch - 1];
  if (!chapter || !chapter.length) return;
  if (bi !== bBi || r.ch - 1 !== bCi) openChapter(bi, r.ch - 1);
  refSel = r.v1 && chapter[r.v1 - 1] ? { v1: r.v1, v2: Math.min(r.v2, chapter.length) } : null;
  updateBibleHighlight();
  if (refSel) scrollToVerse(refSel.v1); else versesEl.scrollTop = 0;
}

function debounce(fn, ms) {
  let t = 0;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

function highlight(text, re) {
  const frag = document.createDocumentFragment();
  if (!re) { frag.append(text); return frag; }
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    frag.append(text.slice(last, m.index));
    frag.append(Object.assign(document.createElement('mark'), { textContent: m[0] }));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function doSearch() {
  if (!bible) return;
  const q = $('searchInput').value.trim();
  if (!q) { resultsEl.hidden = true; return; }
  const { results, words, more } = Bible.search(bible, q, 'all');
  const re = Bible.highlightRegex(words);
  resultsBody.replaceChildren();
  resultsEl.hidden = false;
  resultsBody.append(Object.assign(document.createElement('div'), {
    className: 'result-info',
    textContent: !results.length ? 'Ничего не найдено' : more ? `Показаны первые ${results.length}. Уточните запрос.` : `Найдено: ${results.length}`,
  }));
  for (const r of results) {
    const book = bible.books[r.bi];
    const row = Object.assign(document.createElement('div'), { className: 'result', tabIndex: 0 });
    row.append(Object.assign(document.createElement('b'), { textContent: `${book.name} ${r.ci + 1}:${r.v}` }), highlight(r.text, re));
    const open = () => {
      openChapter(r.bi, r.ci);
      anchor = { pane: 'main', bi: r.bi, ci: r.ci, v: r.v };
      showVerses(r.bi, r.ci, r.v, r.v);
      scrollToVerse(r.v);
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    resultsBody.append(row);
  }
}

// Стрелки: следующий/предыдущий стих в той половине, откуда показан текст
function bibleStep(d) {
  if (!bible) return;
  const books = bible.books;
  const inBm = !!(bShown && bShown.pane === 'bm' && bmView && bShown.bid === bible.id);
  // Длинный стих частями: 7A → 7B → 8
  if (bShown && bShown.bid === bible.id && !bShown.keys && bShown.parts > 1) {
    const ni = bShown.part + d;
    if (ni >= 0 && ni < bShown.parts) {
      showVerses(bShown.bi, bShown.ci, bShown.v1, bShown.v2, bShown.pane, ni);
      return;
    }
  }
  if (bsetStep(d)) return; // набор с дополнительными стихами
  let bi, ci, v;
  if (bShown && bShown.bid === bible.id) { bi = bShown.bi; ci = bShown.ci; v = d > 0 ? bShown.v2 : bShown.v1; }
  else if (!bOpen) return; // глава ещё не выбрана — листать нечего
  else { bi = bBi; ci = bCi; v = d > 0 ? 0 : (books[bi].chapters[ci] || []).length + 1; }
  for (;;) {
    v += d;
    const ch = books[bi].chapters[ci] || [];
    if (v > ch.length) {
      ci += 1; v = 0;
      if (ci >= books[bi].chapters.length) { bi += 1; ci = 0; if (bi >= books.length) return; }
      continue;
    }
    if (v < 1) {
      ci -= 1;
      if (ci < 0) { bi -= 1; if (bi < 0) return; ci = books[bi].chapters.length - 1; }
      v = (books[bi].chapters[ci] || []).length + 1;
      continue;
    }
    if (ch[v - 1]) break;
  }
  if (inBm) {
    if (bmView.bi !== bi || bmView.ci !== ci) { bmView.bi = bi; bmView.ci = ci; renderBmPane(); }
    anchor = { pane: 'bm', bi, ci, v };
    showVerses(bi, ci, v, v, 'bm', d < 0 ? -1 : 0);
    scrollToVerse(v, bmVersesEl);
  } else {
    // Открыто несколько глав — листаем внутри них, не сбрасывая выбор
    if (!chSel.some((x) => x[0] === bi && x[1] === ci)) openChapter(bi, ci);
    anchor = { pane: 'main', bi, ci, v };
    showVerses(bi, ci, v, v, 'main', d < 0 ? -1 : 0); // назад — с последней части длинного стиха
    scrollToVerse(v, versesEl, bi, ci);
  }
}

// ‹ › — соседняя глава: от первой открытой назад, от последней вперёд
$('chPrev').addEventListener('click', () => { const s = bible && bOpen && chapterStep(...(chSel[0] || [bBi, bCi]), -1); if (s) openChapter(...s); });
$('chNext').addEventListener('click', () => { const s = bible && bOpen && chapterStep(...(chSel[chSel.length - 1] || [bBi, bCi]), 1); if (s) openChapter(...s); });

/* ---------- Закладки ---------- */

let bookmarks = [];
let bmPick = new Set(); // выделенные закладки (Ctrl/Shift+щелчок, Ctrl+A) — для перетаскивания в плейлист
let bmAnchor = 0;
try { bookmarks = JSON.parse(localStorage.getItem('cp.bookmarks') || '[]'); } catch { bookmarks = []; }
const saveBookmarks = () => { try { localStorage.setItem('cp.bookmarks', JSON.stringify(bookmarks)); } catch { /* не страшно */ } };

// Закладка хранит канонический номер книги, поэтому работает в любом переводе
function bmBook(bm) {
  if (!bible) return -1;
  const i = bm.canon ? bible.books.findIndex((bk) => bk.canon === bm.canon) : -1;
  return i >= 0 ? i : Math.min(bm.bi, bible.books.length - 1);
}

function bmRef(bm) {
  const bi = bmBook(bm);
  const name = bi >= 0 ? bible.books[bi].name : bm.book;
  return `${name} ${bm.ci + 1}` + (bm.v1 ? `:${bm.v1}` + (bm.v2 > bm.v1 ? `-${bm.v2}` : '') : '');
}

function addBookmark() {
  if (!bible) return;
  // Берём то, что выделено (показано) в основной половине, иначе — всю открытую главу
  const s = bShown && bShown.bid === bible.id && bShown.pane === 'main' ? bShown : null;
  if (!s && !bOpen) return;
  const bi = s ? s.bi : bBi;
  const ci = s ? s.ci : bCi;
  const bm = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    canon: bible.books[bi].canon || 0, bi, ci, book: bible.books[bi].name,
    v1: s ? s.v1 : null, v2: s ? s.v2 : null,
  };
  if (!bookmarks.some((b) => b.canon === bm.canon && b.bi === bm.bi && b.ci === bm.ci && b.v1 === bm.v1 && b.v2 === bm.v2)) {
    bookmarks.push(bm);
    saveBookmarks();
  }
  setDockOpen(true);
  renderBookmarks();
}

function renderBookmarks() {
  const list = $('bmList');
  list.replaceChildren();
  if (!bookmarks.length) {
    list.append(Object.assign(document.createElement('div'), {
      className: 'bm-empty',
      textContent: 'Закладок пока нет. Выделите стихи и нажмите «☆ В закладки» или Ctrl+D.',
    }));
  }
  bmPick = new Set([...bmPick].filter((id) => bookmarks.some((b) => b.id === id)));
  bookmarks.forEach((bm, i) => {
    const item = Object.assign(document.createElement('div'), {
      className: 'bm' + (bmView && bmView.id === bm.id ? ' open' : '') + (bmPick.has(bm.id) ? ' picked' : ''),
      draggable: true,
    });
    const ref = Object.assign(document.createElement('button'), {
      className: 'bm-ref', textContent: bible ? bmRef(bm) : bm.book,
      title: 'Открыть рядом. Ctrl/Shift+щелчок — выделить несколько, Ctrl+A — все; выделенные можно перетащить в плейлист',
    });
    ref.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) { // добавить/убрать из выделения
        if (bmPick.has(bm.id)) bmPick.delete(bm.id); else bmPick.add(bm.id);
        bmAnchor = i;
      } else if (e.shiftKey) { // от прошлой до этой
        const a = Math.max(0, Math.min(bmAnchor, bookmarks.length - 1));
        bmPick = new Set(bookmarks.slice(Math.min(a, i), Math.max(a, i) + 1).map((b) => b.id));
      } else {
        bmPick = new Set([bm.id]);
        bmAnchor = i;
        openBookmark(bm);
        ref.focus();
        return;
      }
      renderBookmarks();
      list.querySelectorAll('.bm-ref')[i].focus(); // чтобы Ctrl+A сработал в списке
    });
    item.addEventListener('dragstart', (e) => bmDragStart(e, bm));
    const del = Object.assign(document.createElement('button'), { className: 'remove', textContent: '×', title: 'Удалить закладку' });
    del.addEventListener('click', () => {
      bookmarks = bookmarks.filter((b) => b !== bm);
      saveBookmarks();
      renderBookmarks();
    });
    item.append(ref, del);
    list.append(item);
  });
}

function bmSelectAll() {
  bmPick = new Set(bookmarks.map((b) => b.id));
  renderBookmarks();
  const f = $('bmList').querySelector('.bm-ref');
  if (f) f.focus();
  flashStatus(`Выделено закладок: ${bmPick.size} — перетащите в плейлист`);
}
// Стихи закладки в открытом переводе: место или вся глава
function bmKeys(bm) {
  const bi = bmBook(bm);
  if (bi < 0) return [];
  const ch = bible.books[bi].chapters[bm.ci] || [];
  const v1 = bm.v1 || 1;
  const v2 = bm.v1 ? bm.v2 || bm.v1 : ch.length;
  const keys = [];
  for (let v = v1; v <= v2; v++) if (ch[v - 1]) keys.push(vkey(bi, bm.ci, v));
  return keys;
}
// Тянем выделенные закладки (или одну — ту, за которую взяли): каждая станет своей презентацией в плейлисте
function bmDragStart(e, bm) {
  if (!bible) { e.preventDefault(); return; }
  if (!bmPick.has(bm.id)) { bmPick = new Set([bm.id]); renderBookmarks(); }
  const picked = bookmarks.filter((b) => bmPick.has(b.id));
  const groups = picked.map(bmKeys).filter((k) => k.length);
  if (!groups.length) { e.preventDefault(); return; }
  e.dataTransfer.setData('application/x-cp-bible', JSON.stringify({ groups }));
  e.dataTransfer.effectAllowed = 'copy';
  const tag = Object.assign(document.createElement('div'), {
    className: 'drag-tag', textContent: groups.length > 1 ? `Закладки: ${groups.length}` : bmRef(picked[0]),
  });
  document.body.append(tag);
  e.dataTransfer.setDragImage(tag, 12, 12);
  setTimeout(() => tag.remove());
}

function openBookmark(bm) {
  if (!bible) return;
  const bi = bmBook(bm);
  if (bi < 0) return;
  bmView = { id: bm.id, bi, ci: Math.min(bm.ci, bible.books[bi].chapters.length - 1), v1: bm.v1, v2: bm.v2 };
  renderBmPane();
  if (bm.v1) scrollToVerse(bm.v1, bmVersesEl); else bmVersesEl.scrollTop = 0;
  renderBookmarks();
}

function renderBmPane() {
  $('bmPane').hidden = !bmView;
  if (!bmView) return;
  const bm = bookmarks.find((b) => b.id === bmView.id);
  // Выделение закладки видно, только пока открыта её глава
  if (bm && (bmBook(bm) !== bmView.bi || bm.ci !== bmView.ci)) { bmView.v1 = null; bmView.v2 = null; }
  else if (bm) { bmView.v1 = bm.v1; bmView.v2 = bm.v2; }
  $('bmTitle').replaceChildren(`${bible.books[bmView.bi].name} ${bmView.ci + 1}`,
    Object.assign(document.createElement('span'), { className: 'pane-tag', textContent: 'закладка' }));
  vsel.bm = vsel.bm.filter((k) => { const x = unkey(k); return x.bi === bmView.bi && x.ci === bmView.ci; });
  fillVerses(bmVersesEl, 'bm', [[bmView.bi, bmView.ci]]);
  updateBibleHighlight();
}

function bmChapter(d) {
  if (!bmView) return;
  const s = chapterStep(bmView.bi, bmView.ci, d);
  if (!s) return;
  [bmView.bi, bmView.ci] = s;
  renderBmPane();
  bmVersesEl.scrollTop = 0;
}

$('bmPrev').addEventListener('click', () => bmChapter(-1));
$('bmNext').addEventListener('click', () => bmChapter(1));
$('bmPaneClose').addEventListener('click', () => { bmView = null; renderBmPane(); renderBookmarks(); });

/* Панель закладок: снизу, слева или справа, размер меняется перетаскиванием */

function applyDock() {
  const dock = ['left', 'right', 'bottom'].includes(settings.bmDock) ? settings.bmDock : 'bottom';
  const box = $('bmDock');
  $('bibleBody').className = 'bible-body dock-' + dock;
  box.hidden = !settings.bmOpen;
  if (dock === 'bottom') { box.style.height = settings.bmSizeV + 'px'; box.style.width = ''; }
  else { box.style.width = settings.bmSizeH + 'px'; box.style.height = ''; }
  document.querySelectorAll('.dock-pos button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dock === dock)));
  $('bmToggle').classList.toggle('on-soft', !!settings.bmOpen);
}

function setDockOpen(open) {
  settings.bmOpen = open;
  saveSettings();
  applyDock();
}

document.querySelectorAll('.dock-pos button').forEach((b) => b.addEventListener('click', () => {
  settings.bmDock = b.dataset.dock;
  saveSettings();
  applyDock();
}));
$('bmToggle').addEventListener('click', () => setDockOpen(!settings.bmOpen));
$('bmDockClose').addEventListener('click', () => setDockOpen(false));

$('bmGrip').addEventListener('pointerdown', (e) => {
  const grip = e.currentTarget;
  const dock = settings.bmDock || 'bottom';
  const vertical = dock === 'bottom';
  const body = $('bibleBody');
  const start = vertical ? e.clientY : e.clientX;
  const startSize = vertical ? $('bmDock').offsetHeight : $('bmDock').offsetWidth;
  const max = (vertical ? body.clientHeight : body.clientWidth) - 220;
  grip.setPointerCapture(e.pointerId);
  grip.classList.add('drag');
  const move = (ev) => {
    const pos = vertical ? ev.clientY : ev.clientX;
    const delta = dock === 'left' ? pos - start : start - pos;
    const size = Math.round(Math.max(70, Math.min(max, startSize + delta)));
    if (vertical) settings.bmSizeV = size; else settings.bmSizeH = size;
    applyDock();
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.classList.remove('drag');
    saveSettings();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
});

/* ---------- Переводы: добавить, удалить, порядок ---------- */

async function addBibles(paths) {
  const errors = [];
  const added = [];
  let lastId = null;
  for (const p of paths) {
    const fileName = p.split(/[\\/]/).pop();
    try {
      showNotice(`Загрузка перевода «${fileName}»… большие файлы читаются несколько секунд`, false, true);
      await new Promise((r) => setTimeout(r, 30)); // даём окну перерисоваться
      const file = await window.api.bibleRead(p);
      const parsed = file.rows ? Bible.fromRows(file.rows, file.name) : Bible.parse(file.text, file.name);
      parsed.lang = guessLang(parsed);
      parsed.file = fileName;
      parsed.format = file.format || (file.text ? Bible.formatOf(file.text) : '');
      // Всегда новый перевод рядом с остальными; одинаковое название получит «(2)»
      const res = await window.api.bibleSave(parsed);
      bibleIndex = res.list;
      bibleCache.set(res.id, { ...parsed, id: res.id, name: res.name });
      lastId = res.id;
      added.push(res.name);
    } catch (e) {
      errors.push(`${fileName}: ${e.message}`);
    }
  }
  renderChips();
  renderTrRows();
  if (lastId) await selectBible(lastId);
  showNotice(errors.length ? 'Не удалось добавить: ' + errors.join('; ') : '', errors.length > 0);
  if (added.length) flashStatus(`Добавлено: ${added.join(', ')} · всего переводов: ${bibleIndex.length}`);
}

async function pickBibles() {
  const paths = await window.api.biblePick();
  if (paths.length) addBibles(paths);
}

async function deleteBible(id) {
  const t = bibleIndex.find((x) => x.id === id);
  if (!t || !(await askYes(`Удалить перевод «${t.name}» из программы? Исходный файл не изменится.`, 'Удалить', true))) return;
  bibleIndex = await window.api.bibleDelete(id);
  bibleCache.delete(id);
  renderTrRows();
  if (bible && bible.id === id) {
    bible = null;
    bmView = null;
    renderBmPane();
    versesEl.replaceChildren();
    resultsEl.hidden = true;
    if (bibleIndex.length) await selectBible(bibleIndex[0].id); else updateBibleEmpty();
  }
  renderChips();
}

async function saveTrIndex() {
  bibleIndex = await window.api.bibleSetIndex(bibleIndex);
  for (const t of bibleIndex) { const b = bibleCache.get(t.id); if (b) b.name = t.name; }
  renderChips();
  if (bShown) refreshLive(); // название перевода на экране тоже обновится
}

function renderTrRows() {
  const box = $('trRows');
  box.replaceChildren();
  if (!bibleIndex.length) {
    box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Переводов пока нет. Нажмите «Добавить перевод».' }));
  }
  bibleIndex.forEach((t, i) => {
    const row = Object.assign(document.createElement('div'), { className: 'tr-row' + (bible && bible.id === t.id ? ' cur' : '') });
    const info = Object.assign(document.createElement('div'), { className: 'tr-info' });
    const name = Object.assign(document.createElement('input'), { type: 'text', value: t.name, title: 'Название перевода' });
    name.addEventListener('change', () => { t.name = name.value.trim() || t.name; saveTrIndex(); });
    const meta = [t.format, t.books && `книг: ${t.books}`, t.verses && `стихов: ${t.verses.toLocaleString(I18n.loc)}`,
      t.file && `файл: ${t.file}`, t.added && new Date(t.added).toLocaleDateString(I18n.loc)].filter(Boolean).join(' · ');
    // Сокращение: пусто — из первых букв названия (видно серым)
    const abbr = Object.assign(document.createElement('input'), { type: 'text', value: t.abbr || '', placeholder: trAbbr({ name: t.name }), maxLength: 20, className: 'tr-abbr', title: 'Сокращение (например, RST). Пусто — первые буквы названия' });
    abbr.addEventListener('change', () => { t.abbr = abbr.value.trim(); saveTrIndex(); });
    name.addEventListener('input', () => { abbr.placeholder = trAbbr({ name: name.value }); });
    const top = Object.assign(document.createElement('div'), { className: 'tr-names' });
    top.append(name, abbr);
    info.append(top, Object.assign(document.createElement('span'), { className: 'tr-meta', textContent: meta || 'добавлен раньше', title: meta }));
    const open = Object.assign(document.createElement('button'), { textContent: bible && bible.id === t.id ? 'Открыт' : 'Открыть', disabled: !!bible && bible.id === t.id });
    open.addEventListener('click', () => selectBible(t.id).then(renderTrRows));
    const lang = document.createElement('select');
    lang.title = 'Язык';
    for (const [k, v] of Object.entries(LANGS)) lang.append(Object.assign(document.createElement('option'), { value: k, textContent: v }));
    lang.value = LANGS[t.lang] ? t.lang : 'other';
    lang.addEventListener('change', () => { t.lang = lang.value; saveTrIndex(); });
    const move = (d) => {
      const j = i + d;
      if (j < 0 || j >= bibleIndex.length) return;
      [bibleIndex[i], bibleIndex[j]] = [bibleIndex[j], bibleIndex[i]];
      saveTrIndex().then(renderTrRows);
    };
    const up = Object.assign(document.createElement('button'), { textContent: '↑', title: 'Выше', disabled: i === 0 });
    const down = Object.assign(document.createElement('button'), { textContent: '↓', title: 'Ниже', disabled: i === bibleIndex.length - 1 });
    up.addEventListener('click', () => move(-1));
    down.addEventListener('click', () => move(1));
    const del = Object.assign(document.createElement('button'), { className: 'danger', textContent: 'Удалить' });
    del.addEventListener('click', () => deleteBible(t.id));
    row.append(info, lang, open, up, down, del);
    box.append(row);
  });
}

$('bibleSettings').addEventListener('click', () => { renderTrRows(); syncTrShow(); syncParUi(); $('trDialog').showModal(); });
$('trDlgClose').addEventListener('click', () => $('trDialog').close());
$('trDlgDone').addEventListener('click', () => $('trDialog').close());

$('refGo').addEventListener('click', goRef);
$('refInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') goRef(); });
$('refInput').addEventListener('input', debounce(previewRef, 120));
$('searchInput').addEventListener('input', debounce(() => {
  const q = $('searchInput').value.trim();
  if (!q) resultsEl.hidden = true;
  else if (q.length >= 2) doSearch();
}, 250));
// Крестик в поле поиска: стереть всё и закрыть результаты
const syncSearchClear = () => { $('searchClear').hidden = !$('searchInput').value; };
$('searchInput').addEventListener('input', syncSearchClear);
$('searchClear').addEventListener('click', () => {
  $('searchInput').value = '';
  syncSearchClear();
  resultsEl.hidden = true;
  $('searchInput').focus();
});
$('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
$('resultsClose').addEventListener('click', () => { resultsEl.hidden = true; });
document.querySelectorAll('.bibleAddBtn').forEach((b) => b.addEventListener('click', pickBibles));

/* ---------- Добавление файлов ---------- */

function addResult({ items, errors }) {
  const newMedia = items.filter((it) => it.type !== 'audio');
  const newTracks = items.filter((it) => it.type === 'audio');
  if (newTracks.length) musicAdd(newTracks);
  // Фото и видео — в открытый плейлист или библиотеку
  if (newMedia.length) inLists(() => addFileResult({ items: newMedia, errors: [] }))();
  else if (newTracks.length) setTab('music');
  showNotice(errors.length ? 'Не удалось добавить: ' + errors.join('; ') : '', errors.length > 0);
}

async function pickFiles() {
  if (tab === 'bible') return pickBibles();
  if (tab !== 'music') return inLists(svcAddFiles)();
  addResult(await window.api.pickMedia({ slideWidth: slideWidth() }));
}
document.querySelectorAll('.addBtn').forEach((b) => b.addEventListener('click', pickFiles));

// Рамка «бросьте сюда» — только для файлов из Проводника; песни, слайды и стихи внутри программы её не включают.
// Снимаем на захвате: место броска (плейлист, лента) останавливает событие, и рамка оставалась висеть
const dragOff = () => document.body.classList.remove('dragging');
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.types.includes('Files') && !isPoolDrag(e)) document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dragOff(); });
window.addEventListener('drop', dragOff, true);
window.addEventListener('dragend', dragOff, true);
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
  if (!paths.length) return; // перетаскивали не файлы, а, например, песню внутри программы
  if (poolDrop(e, paths)) return; // файл из медиапула — только в список, над которым отпустили
  if (tab === 'bible') addBibles(paths);
  else if (tab !== 'music') inLists(() => svcAddPaths(paths))();
  else {
    const res = await window.api.describeFiles(paths, { slideWidth: slideWidth() });
    markPoolFit(res.items); // файл перетащили из медиапула — показывать так, как выбрано в настройках
    addResult(res);
  }
});

/* ---------- Кнопки и клавиши ---------- */

function step(d) {
  if (tab === 'service') plStep(d);
  else if (tab === 'bible' && bible) bibleStep(d);
  else if (d > 0) nextMedia();
  else prevMedia();
}

/* ---------- Горячие клавиши (настраиваются в «Настройки → Горячие клавиши») ---------- */

// Сочетание записывается по физической клавише (e.code), поэтому работает в любой раскладке
const ACTIONS = [
  ['Показ', [
    ['next', 'Следующий слайд или стих', ['ArrowRight', 'PageDown', 'Space'], () => step(1)],
    ['prev', 'Предыдущий слайд или стих', ['ArrowLeft', 'PageUp'], () => step(-1)],
    ['clear', 'Очистить все слои', ['Escape', 'KeyB'], () => clearScreen()],
    ['clearPres', 'Очистить слой «Презентации»', ['F2'], () => clearKind('pres')],
    ['clearMedia', 'Очистить слой «Медиа»', ['F3'], () => clearKind('media')],
    ['clearSource', 'Очистить слой «Источники»', ['F4'], () => clearKind('source')],
    ['clearOverlay', 'Очистить слои «Overlay»', [], () => clearKind('overlay')],
    ['clearLower', 'Убрать плашку или бегущую строку', [], () => clearKind('lower')],
    ['svcCheck', 'Проверка перед служением', [], () => svcCheck()],
    ['lowerThirds', 'Плашки и бегущая строка', [], () => ltOpen()],
    ['voiceToggle', 'Библия по голосу: включить или выключить', [], () => vcToggle()],
    ['voiceShow', 'Библия по голосу: показать последнее найденное место', [], () => vcShowTop()],
    ['voiceWords', 'Библия по голосу: поиск места по словам — включить или выключить', [], () => vsToggle()],
    ['output', 'Включить или выключить вывод в зал', ['F9'], () => $('outToggle').click()],
    ['draw', 'Быстрая анимация: крупный план и рисование поверх слайда', ['Ctrl+KeyE'], () => openInk()],
    ['inkClear', 'Стереть рисунок с экрана', ['Ctrl+Shift+KeyE'], () => inkWipeLive()],
    ['animNext', 'Быстрая анимация: NEXT — следующий шаг', [], () => animNext()],
    ['animStep', 'Быстрая анимация: включить или выключить режим «По NEXT»', [], () => setAnimStep(!settings.animStep)],
    ['zoomNext', 'Крупный план: к следующей точке', [], () => zoomStep(1)],
    ['zoomPrev', 'Крупный план: к предыдущей точке', [], () => zoomStep(-1)],
    ['zoomFit', 'Крупный план: плавно весь слайд', [], () => { zoomCur = -1; setViewTo(null); }],
    ['build', 'Анимация темы «по команде»: следующий шаг', ['KeyN'], () => buildStep()],
  ]],
  ['Правка', [
    ['undo', 'Отменить последнее действие', ['Ctrl+KeyZ'], () => libUndo()],
    ['redo', 'Повторить отменённое', ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'], () => libRedo()],
  ]],
  ['Окна', [
    ['pool', 'Медиапул', ['F8'], () => togglePool()],
    ['editor', 'Изменить выделенный слайд (редактор тем)', ['F7'], () => { const s = selectedSlides().pop(); if (!(s && openSlideLook(s.item, s.slide.id))) openThemeTab(); }],
    ['quick', 'Быстрый поиск медиафайлов', ['Ctrl+KeyS'], () => toggleQuick()],
    ['quickFind', 'Быстрый поиск: сразу строка поиска', ['Ctrl+KeyF'], () => openQuick(true)],
  ]],
  ['Вкладки и окна', [
    ['tabScreen', 'Вкладка «Экран»', ['Ctrl+Digit1'], () => setTab(screenPart)],
    ['tabBible', 'Вкладка «Библия»', ['Ctrl+Digit2'], () => setTab('bible')],
    ['tabMusic', 'Вкладка «Музыка»', ['Ctrl+Digit3'], () => setTab('music')],
    ['tabThemes', 'Редактор тем', ['Ctrl+Digit4'], () => openThemeTab()],
    ['tabMacros', 'Редактор макросов', ['Ctrl+Digit5'], () => openMacroTab()],
    ['tabScreens', 'Редактор сцен: экраны, сцены, пресеты сцен', ['Ctrl+Digit6'], () => openScreensTab()],
    ['tabAudio', 'Аудиоредактор', ['Ctrl+Digit7'], () => openAudioTab()],
    ['mcDock', 'Панель макросов на «Экране»', [], () => mcToggleDock()],
    ['stagePanel', 'Сценический экран: макеты, сообщение, таймеры', [], () => stPanelToggle()],
    ['stageMsgClear', 'Сценический экран: убрать сообщение', [], () => stSetMsg('')],
    ['stageOnlyClear', 'Сценический экран: убрать «только для сцены»', [], () => stShowOnly(null)],
    ['addFiles', 'Добавить файлы', ['Ctrl+KeyO'], () => pickFiles()],
    ['settings', 'Открыть настройки', ['Ctrl+Comma'], () => openSettings()],
  ]],
  ['Библия', [
    ['refFocus', 'Ввести место (Ин 3:16)', ['Ctrl+KeyL'], () => { setTab('bible'); $('refInput').select(); $('refInput').focus(); }],
    ['searchFocus', 'Поиск по словам', ['Ctrl+Shift+KeyF'], () => { setTab('bible'); $('searchInput').select(); $('searchInput').focus(); }],
    ['bmAdd', 'Добавить в закладки', ['Ctrl+KeyD'], () => { if (tab === 'bible') addBookmark(); }],
    ['bmToggle', 'Показать или скрыть закладки', ['Ctrl+KeyB'], () => { if (tab === 'bible' && bible) setDockOpen(!settings.bmOpen); }],
    ['bibleToPl', 'Добавить стихи в плейлист', ['Ctrl+KeyP'], () => { if (tab === 'bible') svcAddBible(); }],
    ['trNext', 'Следующий перевод', ['Ctrl+BracketRight'], () => { if (tab === 'bible') bibleCycle(1); }],
    ['trPrev', 'Предыдущий перевод', ['Ctrl+BracketLeft'], () => { if (tab === 'bible') bibleCycle(-1); }],
  ]],
  ['Плейлист', [
    ['newSong', 'Новая песня', ['Ctrl+KeyN'], () => { setTab('service'); openSongDialog(null); }],
    ['nextItem', 'Следующий пункт плейлиста', ['Ctrl+ArrowDown'], () => { if (tab === 'service') plJumpItem(1); }],
    ['prevItem', 'Предыдущий пункт плейлиста', ['Ctrl+ArrowUp'], () => { if (tab === 'service') plJumpItem(-1); }],
  ]],
  ['Музыка', [
    ['playPause', 'Играть или пауза', ['Ctrl+KeyM'], () => $('playPause').click()],
    ['stopMusic', 'Остановить музыку', [], () => $('stop').click()],
    ['musicNext', 'Следующая песня', ['Ctrl+Shift+ArrowRight'], () => musicStep(1)],
    ['musicPrev', 'Предыдущая песня', ['Ctrl+Shift+ArrowLeft'], () => musicStep(-1)],
  ]],
];
const ACTION_LIST = ACTIONS.flatMap(([, list]) => list);
// Ctrl+F теперь — быстрый поиск; поиск по Библии в сохранённых клавишах переезжает на Ctrl+Shift+F
if (settings.keys && settings.keys.searchFocus && !settings.keys.quickFind) {
  settings.keys.searchFocus = settings.keys.searchFocus.map((c) => (c === 'Ctrl+KeyF' ? 'Ctrl+Shift+KeyF' : c));
}
const KEY_SLOTS = 3;

function keymap() {
  const map = {};
  for (const [id, , def] of ACTION_LIST) map[id] = (settings.keys && settings.keys[id]) || def;
  return map;
}

function comboOf(e) {
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return null;
  return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + e.code;
}

const KEY_NAMES = {
  ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Space: 'Пробел', Escape: 'Esc', Enter: 'Enter',
  PageDown: 'Page Down', PageUp: 'Page Up', Comma: ',', Period: '.', Slash: '/', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', Home: 'Home', End: 'End', Insert: 'Insert',
};
function prettyCombo(c) {
  return c.split('+').map((p) => KEY_NAMES[p] || p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')).join(' + ');
}

let keyWait = null; // { id, slot } — ждём новое сочетание в настройках

window.addEventListener('keydown', (e) => {
  if (keyWait) { captureKey(e); return; }
  // В полях ввода работают только сочетания с Ctrl/Alt и клавиши F1–F12, остальное — для текста
  const typing = ['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName);
  const dlgs = document.querySelectorAll('dialog[open]');
  if (dlgs.length) return;
  // «Редактор сцен»: стрелки, Delete, Ctrl+C/V/D/A, Ctrl+Enter — элементы сцены (screens.js)
  if (tab === 'scenes' && (!typing || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) && scKey(e)) { e.preventDefault(); return; }
  // «Аудиоредактор»: пробел, Ctrl+Z/Y, Delete, Ctrl+A, Ctrl+S (audioeditor.js); на ползунке пробел тоже слушает
  if (tab === 'audio' && (!typing || e.target.type === 'range' || e.target.type === 'checkbox') && aeKey(e)) { e.preventDefault(); return; }
  const combo = comboOf(e);
  if (!combo) return;
  // «Содержание» (в «Экране» и в «Библии»): Ctrl+A — выделить все пункты
  if (!typing && combo === 'Ctrl+KeyA' && e.target.closest && e.target.closest('#contentBox')) { e.preventDefault(); selectAllItems(); return; }
  // Delete по выделенным пунктам «Содержания» — и в «Библии» (в «Экране» — через svcKey)
  if (!typing && combo === 'Delete' && tab === 'bible' && selFocus === 'items' && selItems.length) { e.preventDefault(); deleteSelItems(); return; }
  // Слайды: копировать, вырезать, вставить, дублировать, удалить (playlist.js)
  if (!typing && tab === 'service' && svcKey(e)) { e.preventDefault(); return; }
  // «Темы»: стрелки, Delete, Ctrl+C/V/D/G… — объекты шаблона (themeeditor.js)
  if (!typing && tab === 'themes' && teKey(e)) { e.preventDefault(); return; }
  // «Макросы»: Delete, Ctrl+C/V/D/A/G, F — ноды на холсте (macros.js)
  if (!typing && tab === 'macros' && mcEdKey(e)) { e.preventDefault(); return; }
  // Библия: в «Списке» Ctrl+A/C/V работают с текстом, в «Слайдах» — со слайдами
  if (!typing && tab === 'bible') {
    const r = bibleKey(e);
    if (r === 'native') return;
    if (r) { e.preventDefault(); return; }
  }
  // Файл на вкладке «Экран»: Ctrl+C — копировать показанный файл как слайд
  if (!typing && tab === 'screen' && e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyC' && media[live]) {
    e.preventDefault();
    copySlides(Slides.fromFile(media[live]).slides).then((ok) => ok && flashStatus('Скопировано: вставьте в любую презентацию (Ctrl+V)'));
    return;
  }
  if (typing && !e.ctrlKey && !e.altKey && !/^F\d+$/.test(e.code)) return;
  // Горячая клавиша макроса сильнее команды программы с тем же сочетанием
  if (typeof mcKey === 'function' && mcKey(combo)) { e.preventDefault(); return; }
  const map = keymap();
  const action = ACTION_LIST.find(([id]) => map[id].includes(combo));
  if (!action) return;
  if (typing && (action[0] === 'undo' || action[0] === 'redo')) return; // в поле ввода — отмена набранного текста
  e.preventDefault();
  action[3]();
});

function captureKey(e) {
  e.preventDefault();
  e.stopPropagation();
  const { id, slot } = keyWait;
  if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { keyWait = null; renderKeys(); return; }
  const combo = comboOf(e);
  if (!combo) return; // нажали только Ctrl/Shift — ждём основную клавишу
  const map = keymap();
  const keys = { ...map };
  if (e.code === 'Delete' || e.code === 'Backspace') {
    keys[id] = map[id].filter((_, i) => i !== slot);
  } else {
    // Одно сочетание — одно действие: убираем его у других
    for (const k of Object.keys(keys)) keys[k] = keys[k].filter((c) => c !== combo);
    const list = keys[id].slice();
    if (slot < list.length) list[slot] = combo; else list.push(combo);
    keys[id] = list.slice(0, KEY_SLOTS);
  }
  settings.keys = keys;
  saveSettings();
  keyWait = null;
  renderKeys();
}

function renderKeys() {
  const box = $('keyRows');
  box.replaceChildren();
  const map = keymap();
  for (const [group, list] of ACTIONS) {
    const head = Object.assign(document.createElement('div'), { className: 'key-row' });
    head.append(Object.assign(document.createElement('span'), { className: 'grp', textContent: group }));
    box.append(head);
    for (const [id, label] of list) {
      const row = Object.assign(document.createElement('div'), { className: 'key-row' });
      row.append(Object.assign(document.createElement('span'), { className: 'act', textContent: label }));
      for (let s = 0; s < KEY_SLOTS; s++) {
        const combo = map[id][s];
        const waiting = keyWait && keyWait.id === id && keyWait.slot === s;
        const b = Object.assign(document.createElement('button'), {
          className: 'key' + (waiting ? ' wait' : combo ? '' : ' empty-key'),
          textContent: waiting ? 'Нажмите…' : combo ? prettyCombo(combo) : '—',
          title: combo ? 'Нажмите, чтобы изменить' : 'Нажмите, чтобы добавить сочетание',
        });
        b.addEventListener('click', () => { keyWait = { id, slot: Math.min(s, map[id].length) }; renderKeys(); });
        row.append(b);
      }
      box.append(row);
    }
  }
}

$('keysReset').addEventListener('click', async () => {
  if (!(await askYes('Вернуть все горячие клавиши к начальным? Ваши сочетания пропадут.', 'Вернуть', true))) return;
  settings.keys = {};
  saveSettings();
  renderKeys();
});

/* ---------- Окно настроек ---------- */

function showSettingsSection(sec) {
  document.querySelectorAll('.set-nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.sec === sec)));
  document.querySelectorAll('.set-sec').forEach((s) => { s.hidden = s.dataset.sec !== sec; });
  if (sec === 'keys') renderKeys();
  if (sec === 'output') fillAudioSinks();   // звук — в «Экран и вывод»
  if (sec === 'look') { renderUiColors(); renderPresets(); } // tools.js (пресеты настроек — в «Оформлении»)
  if (sec === 'data') renderRepo();         // tools.js
  if (sec === 'profiles') renderProfiles(); // profpanel.js
  if (sec === 'update') renderUpdate();     // tools.js
}

function openSettings(sec) {
  keyWait = null;
  if (!$('setDialog').open) $('setDialog').showModal();
  const cur = document.querySelector('.set-nav button[aria-current=true]');
  showSettingsSection(typeof sec === 'string' ? sec : cur ? cur.dataset.sec : 'output');
}

document.querySelectorAll('.set-nav button').forEach((b) => b.addEventListener('click', () => { keyWait = null; showSettingsSection(b.dataset.sec); }));
$('openSettings').addEventListener('click', () => openSettings());
$('setClose').addEventListener('click', () => $('setDialog').close());
$('setDialog').addEventListener('cancel', (e) => { if (keyWait) e.preventDefault(); }); // Esc при записи клавиши не закрывает окно
$('setDialog').addEventListener('close', () => { keyWait = null; });
// Ждём сочетание, а щёлкнули не по кнопке сочетания или ушли из окна — перестать ждать:
// иначе следующая буква в любом поле пропадала бы и становилась горячей клавишей
window.addEventListener('pointerdown', (e) => {
  if (!keyWait || (e.target.closest && e.target.closest('#keyRows button'))) return;
  keyWait = null;
  renderKeys();
}, true);
window.addEventListener('blur', () => { if (keyWait) { keyWait = null; renderKeys(); } });

/* ---------- Звуковой выход для музыки ---------- */

async function fillAudioSinks() {
  const sel = $('audioSink');
  let devices = [];
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch { /* нет доступа */ }
  sel.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'Как в Windows (по умолчанию)' }));
  for (const d of devices) {
    if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
    sel.append(Object.assign(document.createElement('option'), { value: d.deviceId, textContent: d.label || 'Устройство ' + (sel.options.length) }));
  }
  sel.value = [...sel.options].some((o) => o.value === settings.audioSink) ? settings.audioSink : '';
  // Звук видео: тот же список; устройство запомнено по id и названию (id может смениться)
  const vs = $('videoSink');
  vs.replaceChildren(...[...sel.options].map((o) => o.cloneNode(true)));
  const want = settings.videoSink || {};
  const hit = [...vs.options].find((o) => want.id && o.value === want.id) || [...vs.options].find((o) => want.label && o.value && o.textContent === want.label);
  if (want.id && !hit) vs.append(Object.assign(document.createElement('option'), { value: want.id, textContent: (want.label || 'Устройство') + ' (не подключено)' }));
  vs.value = hit ? hit.value : want.id || '';
}

$('videoSink').addEventListener('change', () => {
  const o = $('videoSink').selectedOptions[0];
  settings.videoSink = o && o.value ? { id: o.value, label: o.textContent.replace(/ \(не подключено\)$/, '') } : null;
  saveSettings();
  sendVideoAudio();
  flashStatus('Звук видео: ' + (o ? o.textContent : 'как в Windows'));
});

function applyAudioSink() {
  if (typeof audio.setSinkId !== 'function') return;
  audio.setSinkId(settings.audioSink || '').catch(() => {
    showNotice('Выбранное устройство для музыки не найдено, звук идёт в устройство по умолчанию', true);
  });
}

$('audioSink').addEventListener('change', () => {
  settings.audioSink = $('audioSink').value;
  saveSettings();
  applyAudioSink();
});
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => { if ($('setDialog').open) fillAudioSinks(); });

/* ---------- Старт ---------- */

window.api.onDisplays(fillDisplays);
window.api.onOutputState(setOutputState);
// Закрыть программу (крестик окна, Alt+F4): свой вопрос без звука Windows (main.js: app:ask-close → app:close-ok)
if (window.api.onAskClose) window.api.onAskClose(() => {
  const dlg = $('closeDialog');
  if (dlg.open) return;
  dlg.returnValue = '';
  // Скачано обновление — оно ставится после закрытия; пока ставится, ярлык программы не работает
  const u = typeof updLast !== 'undefined' ? updLast : null; // tools.js
  const upd = $('closeUpd');
  if (upd) {
    upd.hidden = !(u && u.state === 'ready');
    if (!upd.hidden) upd.textContent = `После закрытия установится новая версия ${u.version || ''}. Подождите около минуты и только потом запускайте программу снова.`;
  }
  dlg.showModal();
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    // Последняя правка — на диск и в репозиторий, потом закрыть (не дольше 15 с, чтобы не зависнуть на отключённой флешке)
    if (typeof repoFinal === 'function') await Promise.race([repoFinal(), new Promise((r) => setTimeout(r, 15000))]).catch(() => {});
    window.api.closeOk();
  }, { once: true });
});
window.api.getDisplays().then((list) => {
  fillDisplays(list);
  // «Включать вывод при запуске»: только на отдельный монитор — главный (где окно оператора) не закрываем
  const d = list.find((x) => x.id === Number(displaySel.value));
  if (settings.outAutoOn && !outputOpen && d && !d.here) toggleOutput();
});
onSettingChanged('init');
media = loadList('cp.media');
tracks = loadList('cp.tracks');
renderMedia();
setTab('service');
applyBibleView();
const bibleReady = initBible(); // заставка ждёт его (splash.js)
if (settings.audioSink) applyAudioSink();
sendVideoAudio(); // громкость, Mute и устройство звука видео — окнам вывода
