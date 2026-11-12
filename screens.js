/* ===== Редактор сцен («Редактор → Редактор сцен», Ctrl+6): экраны, сцены и макеты — как Screens / Screen Scenes в ProPresenter =====
   Модель (library.json):
   lib.screens — [{ id, name, w, h, hz, enabled, outputs: [{ kind: 'display'|'window'|'ndi', display?, name?, off? }],
     mode: 'program', layers (null — все слои), fit, ink, sound, trans, fx, rotate, flipX, flipY, alpha }].
     Экран 'main' — «Основной»: его монитор и разрешение — в Настройках (как было); здесь — что он показывает и доп. выходы.
     enabled у экрана включает его выходы (у «Основного» — только дополнительные, главный — галочкой вывода).
     alpha — «Прозрачный фон»: без фона темы и шаблонов (видно только текст и элементы; в сцене — просвечивает, NDI — альфа).
   lib.scenes — [{ id, name, w, h, bg, hz, alpha, outputs, outSound, on, layout, follow }] — СЦЕНА = ВЫХОД + применённый макет.
     bg — цвет или 'transparent'; layout — id макета; для main.js сцена — экран 'scene:id' с mode 'scene' (scSceneScreen).
     Свойства сцены правятся сразу (без «Применить»).
   lib.scenePresets — МАКЕТЫ («Пресеты сцен»): [{ id, name, w, h, bg?, trans, items, guides, layers? }], элемент — см. SC_ITEMS и compose.js.
     Макет правится на холсте; правка — черновик, на выходы идёт применённая копия scLive[id макета] («Применить», Ctrl+Enter), как у тем.
     Один макет может стоять в нескольких сценах; размер макета вписывается в размер сцены.
   Отрисовка — compose.js (общая с окнами вывода), окна выходов — main.js (screens:config).
   Схема (решение владельца, ноябрь 2026):
     Экран — всегда программа: свои выходы, какие слои идут (layers), своя тема для текстов (theme, themeTpl → look),
       вписывание, переход, поворот, цвет, прозрачный фон.
     Сцена — только выход: разрешение, фон, выходы (on), альфа-канал, частота, какой макет. Сам макет — в «Пресетах сцен».
       Сценических макетов отдельно нет: инфоблоки (SC_ITEMS с info: true) есть в любом макете.
       follow — макет меняется по слайдам (slide.stage / item.stage — id макета, stage.js); scAuto[id сцены] — какой макет сейчас
       на её выходах вместо своего (слайд, панель «Сцена», макрос; не в library.json и не в отмене).
     Выходы экранов и сцен включаются только вручную (enabled / on), при запуске все выключены.
     Старые данные переносит scMigrate: экран со сценой, сценический экран, kind 'stage'; у старой сцены макет был внутри —
       он становится макетом с тем же id, что у сцены (старые ссылки slide.stage и макросов остаются верными). */

const SC_FORMATS = [['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1080, 1080], ['4:3', 1440, 1080], ['21:9', 2560, 1080]];
// Разрешения 16:9 — для «Основного» и сцен (больше, чем умеет монитор выхода, не предлагаются)
const SC_RES = [['HD', 1280, 720], ['Full HD', 1920, 1080], ['2K', 2560, 1440], ['4K', 3840, 2160], ['5K', 5120, 2880], ['8K', 7680, 4320]];
const SC_ITEMS = {
  screen: { name: 'Экран / сцена', icon: 'screens', tip: 'Картинка другого экрана или другой сцены — как они идут сейчас' },
  program: { name: 'Программа', icon: 'layers', tip: 'Слои вывода: тексты, медиа, источники — можно выбрать какие' },
  cur: { name: 'Текущий слайд', icon: 'slides', tip: 'Слайд, который сейчас на экране (слой «Презентации»)' },
  next: { name: 'Следующий слайд', icon: 'show', tip: 'Следующий слайд плейлиста — для монитора на сцене' },
  media: { name: 'Фото / видео', icon: 'image', tip: 'Файл картинки или видео' },
  source: { name: 'Источник', icon: 'camera', tip: 'Камера, карта захвата, экран компьютера, NDI, телефон' },
  text: { name: 'Текст', icon: 'text', tip: 'Надпись' },
  clock: { name: 'Часы', icon: 'timer', tip: 'Текущее время или дата' },
  // Фигуры — кнопка «Фигура» (shape, more — не отдельной кнопкой)
  rect: { name: 'Прямоугольник', icon: 'rect', tip: 'Фигура: цвет, градиент, рамка, скругление', shape: true, more: true },
  ellipse: { name: 'Эллипс', icon: 'oval', tip: 'Круг или эллипс', shape: true, more: true },
  line: { name: 'Линия', icon: 'line', tip: 'Полоса: толщина — высота элемента', shape: true, more: true },
  arrow: { name: 'Стрелка', icon: 'arrow', tip: 'Стрелка вправо (поворот — за кружок над рамкой)', shape: true, more: true },
  triangle: { name: 'Треугольник', icon: 'rect', tip: 'Треугольник', shape: true, more: true },
  rhombus: { name: 'Ромб', icon: 'rect', tip: 'Ромб', shape: true, more: true },
  hexagon: { name: 'Шестиугольник', icon: 'rect', tip: 'Шестиугольник', shape: true, more: true },
  star: { name: 'Звезда', icon: 'star', tip: 'Пятиконечная звезда', shape: true, more: true },
  // Инфоблоки (сценический экран) — обновляются сами по тому, что идёт в программе (stage.js)
  curText: { name: 'Текст слайда', icon: 'text', tip: 'Текст текущего слайда крупно — размер подбирается сам', info: true },
  nextText: { name: 'Текст следующего', icon: 'text', tip: 'Текст следующего слайда — размер подбирается сам', info: true },
  notes: { name: 'Заметки к слайду', icon: 'note', tip: 'Заметка к слайду: правой кнопкой по слайду → «Заметка к слайду…»', info: true },
  opnote: { name: 'Заметка оператора', icon: 'note', tip: 'Заметка к презентации — «?» у пункта в «Содержании»', info: true },
  msg: { name: 'Сообщение', icon: 'message', tip: 'Сообщение для сцены — пишет оператор (кнопка «Сцена» под предпросмотром)', info: true },
  plist: { name: 'Плейлист', icon: 'playlist', tip: 'Что сейчас и что дальше в плейлисте', info: true },
  part: { name: 'Часть песни', icon: 'parts', tip: 'Какая часть песни идёт: Куплет 1, Припев, Проигрыш… (подпись слайда)', info: true },
  queue: { name: 'Очередь', icon: 'list', tip: 'Список плейлиста: что уже было (зачёркнуто), что идёт, что дальше', info: true },
  count: { name: 'Номер слайда', icon: 'counter', tip: 'Номер слайда и сколько всего: 3 / 12', info: true },
  chords: { name: 'Аккорды', icon: 'chord', tip: 'Аккорды текущего слайда (поле «Аккорды» в окне песни)', info: true },
  timer: { name: 'Таймер', icon: 'timer', tip: 'Таймер оператора: обратный отсчёт или секундомер', info: true },
  countdown: { name: 'Отсчёт до времени', icon: 'timer', tip: 'Сколько осталось до заданного времени, например до 10:00', info: true },
  vcd: { name: 'Остаток видео', icon: 'video', tip: 'Сколько осталось до конца видео на экране', info: true },
  cap: { name: 'Запись и эфир', icon: 'rec', tip: 'Идёт ли запись и трансляция (отмечает оператор), NDI-выходы', info: true },
  only: { name: 'Только для сцены', icon: 'stage', tip: 'Слайд или файл, который оператор отправил только на сценические экраны', info: true },
};
const SC_NATIVE = ['screen', 'program', 'cur', 'next', 'media', 'source', 'only']; // у них своё разрешение: обрезка и вписывание
const SC_TEXTY = ['text', 'clock', 'curText', 'nextText', 'notes', 'opnote', 'msg', 'plist', 'count', 'chords', 'timer', 'countdown', 'vcd', 'cap', 'part', 'queue']; // у них шрифт и цвет текста
const SC_TRANS = Scene.TRANS; // все переходы — список в scene.js
// Виды презентаций для блока «Очередь» (stage.js stKindOf)
const SC_QKINDS = [['song', 'Песни'], ['bible', 'Библия'], ['custom', 'Слайды'], ['deck', 'Презентации'], ['media', 'Фото и видео'], ['audio', 'Музыка']];

let scSel = { kind: 'screen', id: 'main' }; // что открыто: экран ('screen'), сцена ('scene') или макет ('layout')
let scIt = null;      // id выделенного элемента макета
let scLive = {};      // применённые макеты: id → копия (на выходы идёт она)
let scOpenOuts = [];  // открытые окна выходов (main.js): [{ key, screen, kind }]
let scTabOn = false;
let scH = null;       // что смонтировано в холсте: { kind: 'screen' (экран или сцена 'scene:id') | 'scene' (редактор макета), id, h }
let scK = 1;          // масштаб холста
const scSecOpen = {}; // какие разделы свойств раскрыты

const scClone = (x) => JSON.parse(JSON.stringify(x));
const scScreen = (id) => (lib && lib.screens ? lib.screens.find((s) => s.id === id) : null) || null;
const scScene = (id) => (lib && lib.scenes ? lib.scenes.find((s) => s.id === id) : null) || null;
// Макеты — «Пресеты сцен» (lib.scenePresets)
const scPresets = () => (Array.isArray(lib.scenePresets) ? lib.scenePresets : (lib.scenePresets = []));
const scLay = (id) => (id && lib ? scPresets().find((p) => p.id === id) : null) || null;
const scCurSc = () => (scSel.kind === 'scene' ? scScene(scSel.id) : null); // открытая сцена (свойства выхода)
// Открытый на холсте макет (весь редактор элементов работает с ним; имя осталось с тех пор, когда макет был внутри сцены)
const scCurScene = () => (scSel.kind === 'layout' ? scLay(scSel.id) : null);
const scCurItem = () => { const s = scCurScene(); return s && scIt ? s.items.find((i) => i.id === scIt) || null : null; };
// «Есть правки» у макета: направляющие и название на выход не влияют
const scBody = (l) => (l ? { ...l, guides: undefined, name: undefined } : null);
const scDirty = (l) => !!l && JSON.stringify(scBody(l)) !== JSON.stringify(scBody(scLive[l.id]));
const scMainSize = () => { const { W, H } = outputSize(); return { w: W, h: H }; };
// Какой макет сейчас на выходах сцены: свой (sc.layout) или временно другой (scAuto — слайд, панель «Сцена», макрос)
let scAuto = {};
const scLayoutOf = (sc) => (scAuto[sc.id] && scLay(scAuto[sc.id]) ? scAuto[sc.id] : sc.layout || '');
const scUsers = (l) => lib.scenes.filter((sc) => sc.layout === l.id); // в каких сценах стоит макет

function scNewScreen(over) {
  return {
    id: newId(), name: 'Экран', w: 1920, h: 1080, hz: 0, enabled: false, outputs: [], mode: 'program', layers: null, fit: 'native',
    theme: '', themeTpl: '', ink: true, sound: false, trans: null, fx: {}, rotate: 0, flipX: false, flipY: false, ...over,
  };
}
// Сцена = выход + макет: из макета берутся размер и фон (фон уходит сцене — макет без своего фона)
function scNewScene(l, over) {
  return {
    id: newId(), name: (l && l.name) || 'Сцена', w: (l && l.w) || 1920, h: (l && l.h) || 1080, bg: (l && l.bg) || '#000000',
    hz: 0, alpha: false, outputs: [], outSound: false, on: false, layout: l ? l.id : '', ...over,
  };
}
// Макет из шаблона или файла: только то, что относится к макету
const SC_LAY_K = ['w', 'h', 'bg', 'trans', 'items', 'guides', 'layers', 'fitV'];
function scLayoutFrom(src, over) {
  const l = { id: newId(), name: src.name || 'Макет' };
  for (const k of SC_LAY_K) if (src[k] !== undefined) l[k] = scClone(src[k]);
  if (!Array.isArray(l.items)) l.items = [];
  return Object.assign(l, over);
}

// Перенос старой схемы: экран со сценой → его выходы уходят сцене; сценический экран без макета → новая сцена с его выходами;
// макет внутри сцены (items…) → отдельный макет в «Пресетах сцен» с тем же id, сцена ссылается на него (sc.layout)
function scMigrate() {
  let ch = false;
  for (const s of [...lib.screens]) {
    const stage = s.kind === 'stage';
    if (s.mode !== 'scene' && !stage) { if (s.mode === 'blank') { s.mode = 'program'; ch = true; } delete s.kind; continue; }
    ch = true;
    if (s.id === 'main') { Object.assign(s, { mode: 'program' }); delete s.kind; continue; }
    let sc = s.mode === 'scene' ? scScene(s.scene) : null;
    if (!sc && stage && (s.outputs || []).length) {
      const l = scLayoutFrom(scTemplate('st-empty'), { w: s.w || 1920, h: s.h || 1080 });
      scPresets().push(l);
      sc = scNewScene(l, { name: s.name || 'Сцена' });
      lib.scenes.push(sc);
    }
    if (sc) {
      sc.outputs = [...(sc.outputs || []), ...(s.outputs || [])];
      if (s.hz && !sc.hz) sc.hz = s.hz;
      if (s.sound) sc.outSound = true;
      if (stage && s.follow !== false) sc.follow = true;
      lib.screens = lib.screens.filter((x) => x !== s);
    } else { s.mode = 'program'; delete s.kind; }
  }
  for (const sc of lib.scenes) if (sc.kind) { delete sc.kind; ch = true; }
  for (const s of lib.screens) for (const k of ['scene', 'sceneTrans', 'follow']) delete s[k];
  // Макет внутри сцены → «Пресеты сцен»; id тот же, что у сцены, — slide.stage, item.stage и макросы, где стоял id сцены, ведут на её макет
  let moved = 0;
  for (const sc of lib.scenes) {
    if ('layout' in sc) continue;
    ch = true;
    const id = scLay(sc.id) ? newId() : sc.id;
    scPresets().push(scLayoutFrom(sc, { id, name: sc.name || 'Макет', bg: undefined }));
    sc.layout = id;
    if (!sc.bg) sc.bg = '#000000';
    for (const k of ['items', 'trans', 'guides', 'layers']) delete sc[k];
    moved++;
  }
  // У старых пресетов «следить за слайдами» было в макете — теперь это свойство сцены
  for (const p of scPresets()) if ('follow' in p) { delete p.follow; ch = true; }
  // Блок «Программа» раньше всегда вписывался «целиком» в разрешении монитора «Основного» — при мониторе 16:10 в сцене 16:9
  // по бокам были поля. Один раз (fitV) ставим ему «Своё разрешение» — без полей; дальше выбор оператора не трогаем
  for (const p of scPresets()) {
    if (p.fitV) continue;
    for (const it of p.items || []) if (it.type === 'program' && (!it.fit || it.fit === 'contain')) it.fit = 'native';
    p.fitV = 2;
    ch = true;
  }
  if (ch) { saveLib(); flashStatus(moved ? `Сцены — по новой схеме: макеты (${moved}) перенесены в «Пресеты сцен», сцена — выход и выбранный макет` : 'Экраны и сцены — по новой схеме: экраны показывают программу, у сцен свои выходы'); }
}

function scInit() {
  if (!Array.isArray(lib.screens)) lib.screens = [];
  if (!lib.screens.some((s) => s.id === 'main')) lib.screens.unshift(scNewScreen({ id: 'main', name: 'Основной', outputs: [] }));
  if (!Array.isArray(lib.scenes)) lib.scenes = [];
  scMigrate();
  for (const l of scPresets()) if (!Array.isArray(l.items)) l.items = [];
  // При запуске выходы экранов и сцен закрыты — оператор включает их сам;
  // «Включать вывод при запуске» (settings.outAutoOn) — остаются как были, когда программу закрыли
  if (!settings.outAutoOn) {
    for (const s of lib.screens) s.enabled = false;
    for (const sc of lib.scenes) sc.on = false;
  }
  scLive = {};
  for (const l of scPresets()) scLive[l.id] = scClone(l); // что было при запуске — то и на выходах
  if (typeof dispFix === 'function') dispFix(); // мониторы выходов — на подключённые сейчас (renderer.js)
  scSend();
  if (window.api.screensState) window.api.screensState().then((st) => { scOpenOuts = st || []; scRenderLists(); }, () => {});
  if (typeof stInit === 'function') stInit(); // сценический экран: таймеры, сообщения (stage.js)
}
function scOutputChanged() { if (scTabOn) { scRenderLists(); scRenderBar(); if (scSel.id === 'main' && !scIt) scRenderInsp(); } }
if (window.api.onScreensState) window.api.onScreensState((st) => { scOpenOuts = st || []; if (typeof prevAudio === 'function') prevAudio();if (scTabOn) { scRenderLists(); if (scSel.kind === 'screen') scRenderBar(); } });

/* ----- Отправка настроек: окнам выходов (main.js) и превью здесь ----- */

let scSendT = 0;
// Каждая сцена для окон вывода — экран 'scene:id' (её выходы, предпросмотр, плавающее окно): свой размер и фон, макет — свой или выбранный
const scSceneSid = (sc) => 'scene:' + sc.id;
function scSceneScreen(sc, main) {
  return scNewScreen({
    id: scSceneSid(sc), name: sc.name || 'Сцена', w: sc.w || main.w, h: sc.h || main.h, hz: sc.hz || 0, enabled: !!sc.on, bg: sc.bg || '#000000',
    outputs: scClone(sc.outputs || []), mode: 'scene', scene: scLayoutOf(sc), ink: false, sound: !!sc.outSound, alpha: !!sc.alpha, outFit: sc.outFit || 'fit',
  });
}
// Тема экрана: все тексты программы (песни, Библия, текстовые слайды) на этом экране — в её оформлении
function scLook(s) {
  const t = s.theme && typeof themeById === 'function' ? themeById(s.theme) : null;
  if (!t) return null;
  return { ...THEME_DEFAULTS, ...Themes.style(t), showTranslation: settings.showTr, bible: bibleLook(), tpl: s.themeTpl || undefined };
}
function scConfig() {
  const main = scMainSize();
  const scenes = {}; // макеты для compose.js: применённые копии
  for (const l of scPresets()) scenes[l.id] = scLive[l.id] || l;
  const screens = scClone(lib.screens).map((s) => ({ ...s, mode: 'program', look: scLook(s), ...(s.id === 'main' ? { w: main.w, h: main.h, outFit: settings.res === 'auto' ? 'fit' : settings.outFit || 'fit' } : {}) }));
  for (const sc of lib.scenes) screens.push(scSceneScreen(sc, main));
  return { screens, scenes: scClone(scenes), main };
}
// Свойства сцены (выход, размер, фон, макет) поменялись — сразу на выходы, без «Применить»
function scSceneOutSet(sc, rerenderInsp) {
  saveLib();
  scSend();
  if (typeof stPanelRefresh === 'function') stPanelRefresh();
  if (!scTabOn) return;
  scRenderLists();
  scRenderBar();
  if (rerenderInsp) scRenderInsp();
  if (scSel.kind === 'scene' && scSel.id === sc.id) scLayout();
}
// Макет на выходах сцены: свой (layoutId — её sc.layout или '') или временно другой; quiet — без строки состояния
function scSetLayout(sceneId, layoutId, quiet) {
  const sc = scScene(sceneId);
  if (!sc) return;
  const l = layoutId && layoutId !== sc.layout ? scLay(layoutId) : null;
  if (l) { scAuto[sc.id] = l.id; if (!scLive[l.id]) scLive[l.id] = scClone(l); } else delete scAuto[sc.id];
  scSend();
  if (scTabOn) { scRenderLists(); if (scSel.id === sc.id) scRenderInsp(); }
  if (typeof stPanelRefresh === 'function') stPanelRefresh();
  if (!quiet) flashStatus(`«${sc.name}»: ` + (l ? `макет «${l.name}»` : 'свой макет'));
}
function scSend() {
  if (!lib || !lib.screens) return;
  const cfg = scConfig();
  Compose.setConfig(cfg); // превью — сразу
  if (scTabOn && scH && scH.kind === 'scene' && scCurScene()) Compose.updateScene(scH.h, scCurScene()); // макет в редакторе (размер «Основного» мог смениться)
  clearTimeout(scSendT);
  scSendT = setTimeout(() => window.api.screensConfig && window.api.screensConfig(scConfig()), 40);
  if (typeof prevScreenSync === 'function') prevScreenSync(); // экран в «Предпросмотре» (renderer.js)
  if (typeof outGroupsSync === 'function') outGroupsSync(); // галочки «Зал» и «Сцена» над «Предпросмотром» (renderer.js)
}

// Текущий и следующий слайд и данные инфоблоков — собирает stage.js (stSend)
let scStageT = 0;
function scStage() { clearTimeout(scStageT); scStageT = setTimeout(() => { if (lib && typeof stSend === 'function') stSend(); }, 0); }

function scAfterUndo() {
  if (!Array.isArray(lib.screens) || !lib.screens.some((s) => s.id === 'main')) scInitKeepLive();
  if (!Array.isArray(lib.scenes)) lib.scenes = [];
  if (scSel.kind === 'screen' && !scScreen(scSel.id)) scSel = { kind: 'screen', id: 'main' };
  if (scSel.kind === 'scene' && !scScene(scSel.id)) scSel = { kind: 'screen', id: 'main' };
  if (scSel.kind === 'layout' && !scLay(scSel.id)) scSel = { kind: 'screen', id: 'main' };
  for (const k of Object.keys(scAuto)) if (!scLay(scAuto[k])) delete scAuto[k];
  if (!scCurItem()) scIt = null;
  scSend();
  if (scTabOn) scRenderAll(true);
  if (typeof stAfterUndo === 'function') stAfterUndo(); // таймеры как были
}
function scInitKeepLive() {
  if (!Array.isArray(lib.screens)) lib.screens = [];
  if (!lib.screens.some((s) => s.id === 'main')) lib.screens.unshift(scNewScreen({ id: 'main', name: 'Основной' }));
  if (!Array.isArray(lib.scenes)) lib.scenes = [];
}

/* ----- Вкладка ----- */

// Экраны и сцены — «Редактор → Редактор сцен» (вкладка 'scenes', renderer.js setTab)
function openScreensTab(sel) {
  if (sel) { scSel = sel; scIt = null; }
  const was = scTabOn;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  setTab('scenes');
  if (sel && was) scRenderAll(true);
}
function scTabOpen() {
  if (scTabOn) return;
  scTabOn = true;
  requestAnimationFrame(() => { if (scTabOn) scRenderAll(true); }); // окно уже показано — размеры холста известны
}
function scTabClose() {
  if (!scTabOn) return;
  scTabOn = false;
  scUnmountView();
}

function scRenderAll(remount) {
  scRenderLists();
  scRenderBar();
  scRenderInsp();
  if (remount) scMountView(); else scUpdateView();
}

function scPick(sel) {
  scSel = sel;
  scIt = null;
  scRenderAll(true);
}

/* ----- Левая колонка: экраны, сцены, элементы ----- */

const scEl = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function scOutsOf(id) { return scOpenOuts.filter((o) => o.screen === id); }

function scRenderLists() {
  if (!lib || !lib.screens) return;
  const sb = $('scScreens');
  sb.replaceChildren(...lib.screens.map((s) => {
    const row = scEl('div', 'sc-row' + (scSel.kind === 'screen' && scSel.id === s.id ? ' sel' : '') + ((s.id === 'main' ? mainOutOn() : s.enabled) ? '' : ' off'));
    const nm = scEl('div', 'nm', s.name || 'Экран');
    const sz = s.id === 'main' ? scMainSize() : { w: s.w, h: s.h };
    const th = s.theme && typeof themeById === 'function' && themeById(s.theme);
    const ly = Array.isArray(s.layers) ? ` · слоёв: ${s.layers.length}` : '';
    nm.append(scEl('small', '', `${sz.w}×${sz.h} · программа${ly}` + scGroupTag(s, false) + (s.alpha ? ' · прозрачный фон' : '') + (th ? ` · тема «${th.name}»` : '')));
    const outs = s.id === 'main' ? outputOpen || scOutsOf(s.id).length : scOutsOf(s.id).length;
    const dot = scEl('span', 'dot' + (outs ? ' on' : ''));
    dot.title = outs ? 'Выводится' : (s.outputs || []).length ? 'Выходы закрыты' : 'Виртуальный экран (без выходов)';
    row.append(Icons.el('screens'), nm, dot);
    row.addEventListener('click', () => scPick({ kind: 'screen', id: s.id }));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); scScreenMenu(e, s); });
    return row;
  }));
  scRenderSceneList($('scScenes'));
  scRenderPresets();
  scRenderItems();
}

/* ----- Макеты — «Пресеты сцен» (lib.scenePresets) -----
   Макет: { id, name, w, h, bg?, trans, items, guides, layers? }. Щелчок — открыть на холсте и править (черновик до «Применить»),
   правая кнопка — меню: поставить в сцену, новая сцена с макетом, переименовать, дублировать, файл, удалить. В отмене (HIST_KEYS) — Ctrl+Z. */
const scFreshItems = (items) => (items || []).map((x) => ({ ...scClone(x), id: newId() }));

// Новый макет (пустой, из шаблона или файла); open — сразу открыть на холсте
function scAddLayout(l, open = true) {
  if (!l.fitV) l.fitV = 2; // новый макет — перенос «Программы» (scMigrate) ему не нужен
  scPresets().push(l);
  scLive[l.id] = scClone(l);
  saveLib();
  scSend();
  if (open) scPick({ kind: 'layout', id: l.id }); else scRenderLists();
  return l;
}
// Поставить макет в сцену (сразу на её выходы)
function scUseLayout(l, sc) {
  if (!sc || !l) return;
  sc.layout = l.id;
  delete scAuto[sc.id];
  scSceneOutSet(sc, scSel.id === sc.id);
  flashStatus(`В сцене «${sc.name}» — макет «${l.name}» · Ctrl+Z — вернуть`);
}
function scRenderPresets() {
  const box = $('scPresets');
  if (!box) return;
  const list = scPresets();
  if (!list.length) {
    box.replaceChildren(scEl('div', 'te-empty', 'Макетов пока нет. «＋» — новый макет: пустой или из шаблона. Макет ставится в сцену в её свойствах.'));
    return;
  }
  box.replaceChildren(...list.map((p) => {
    const row = scEl('div', 'sc-row' + (scSel.kind === 'layout' && scSel.id === p.id ? ' sel' : ''));
    const nm = scEl('div', 'nm', p.name || 'Макет');
    const users = scUsers(p);
    nm.append(scEl('small', '', `${p.w || 1920}×${p.h || 1080} · ${(p.items || []).length} эл.` + (users.length ? ' · в сценах: ' + users.map((x) => x.name).join(', ') : '')));
    row.append(Icons.el('presets'), nm);
    if (scDirty(p)) { const d = scEl('span', 'dirty', 'изменён'); d.title = 'Есть неприменённые правки — «Применить» (Ctrl+Enter)'; row.append(d); }
    row.title = 'Щелчок — править макет. Правая кнопка — поставить в сцену и другое';
    row.addEventListener('click', () => scPick({ kind: 'layout', id: p.id }));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); scPresetMenu(e, p); });
    return row;
  }));
}
function scPresetMenu(e, p) {
  const list = scPresets();
  const i = list.indexOf(p);
  showMenu(e, [
    { label: 'Править макет', fn: () => scPick({ kind: 'layout', id: p.id }) },
    { label: 'Применить правки', disabled: !scDirty(p), key: 'Ctrl+Enter', fn: () => scApply(p) },
    ...(lib.scenes.length ? ['-', { label: 'Поставить в сцену', disabled: true, fn() {} },
      ...lib.scenes.map((sc) => ({ label: (sc.layout === p.id ? '   ● ' : '      ') + sc.name, fn: () => scUseLayout(p, sc) }))] : []),
    { label: 'Новая сцена с этим макетом', fn: () => scAddScene(scNewScene(p)) },
    '-',
    { label: 'Переименовать…', fn: async () => { const n = await askName('Название макета', p.name); if (n) { p.name = n; saveLib(); scRenderAll(); } } },
    { label: 'Дублировать', fn: () => { const c = { ...scClone(p), id: newId(), name: p.name + ' (копия)', items: scFreshItems(p.items) }; list.splice(i + 1, 0, c); scLive[c.id] = scClone(c); saveLib(); scPick({ kind: 'layout', id: c.id }); } },
    { label: 'Сохранить в файл…', fn: () => scExport(p) },
    '-',
    { label: 'Выше', disabled: i <= 0, fn: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); saveLib(); scRenderLists(); } },
    { label: 'Ниже', disabled: i >= list.length - 1, fn: () => { list.splice(i + 1, 0, list.splice(i, 1)[0]); saveLib(); scRenderLists(); } },
    '-',
    { label: 'Удалить макет', fn: () => {
      const used = scUsers(p).length;
      lib.scenePresets = list.filter((x) => x !== p);
      delete scLive[p.id];
      for (const k of Object.keys(scAuto)) if (scAuto[k] === p.id) delete scAuto[k];
      saveLib(); scSend();
      if (scSel.kind === 'layout' && scSel.id === p.id) scSel = { kind: 'screen', id: 'main' };
      scRenderAll(true);
      flashStatus(`Макет «${p.name}» удалён` + (used ? ` (в сценах: ${used} — там теперь пусто)` : '') + ' · Ctrl+Z — вернуть');
    } },
  ]);
}
// «＋» у «Пресетов сцен»: новый макет
$('scAddPreset').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu({ clientX: r.left, clientY: r.bottom + 2 }, scTplMenu((kind) => scAddLayout(scLayoutFrom(scTemplate(kind)))));
});
// Шаблоны макетов — одно меню для «＋» у макетов и у сцен
function scTplMenu(fn) {
  return [
    { label: 'Пустой 16:9', fn: () => fn('empty') },
    { label: 'Пустой 9:16 (вертикальный)', fn: () => fn('vertical') },
    '-',
    { label: 'Для сцены (музыкантам, ведущим)', disabled: true, fn() {} },
    ...SC_STAGE_TPL.map(([k, name]) => ({ label: '   ' + name, fn: () => fn(k) })),
    '-',
    { label: 'Для зрителей и трансляции', disabled: true, fn() {} },
    { label: '   Мультиэкран: слайды, следующий, камера', fn: () => fn('multi') },
    { label: '   Три экрана: 1:1 · 16:9 · 9:16', fn: () => fn('three') },
    { label: '   Трансляция: камера + текст песни', fn: () => fn('broadcast') },
  ];
}

// Галочка «вывод включён» в строке списка (щелчок по ней строку не выбирает)
// Группа вывода (галочки «Зал»/«Сцена» над «Предпросмотром», renderer.js: outGroupOf) — подпись в списке и строка в свойствах
function scGroupTag(x, scene) { const g = outGroupOf(x, scene); return OUT_GROUPS[g] ? ` · ${OUT_GROUPS[g].toLowerCase()}` : ''; }
function scGroupRows(x, scene, set) {
  const g = outGroupOf(x, scene);
  return [
    scRow('Группа', scSelect([['hall', 'Зал'], ['stage', 'Сцена'], ['none', 'Без группы']], g, (v) => set(v))),
    scNote(OUT_GROUPS[g] ? `Галочка «${OUT_GROUPS[g]}» над «Предпросмотром» включает и выключает этот выход вместе с остальными из группы.`
      : 'Галочки над «Предпросмотром» этот выход не трогают — только кнопка «Вывод» здесь.'),
  ];
}
function scRenderSceneList(lb) {
  if (!lib.scenes.length) {
    lb.replaceChildren(scEl('div', 'te-empty', 'Сцен пока нет. «＋» — новая сцена (выход: монитор на сцене, окно, NDI) с макетом из «Пресетов сцен» или из шаблона.'));
    return;
  }
  lb.replaceChildren(...lib.scenes.map((sc) => {
    const has = (sc.outputs || []).length > 0;
    const row = scEl('div', 'sc-row' + (scSel.kind === 'scene' && scSel.id === sc.id ? ' sel' : '') + (has && !sc.on ? ' off' : ''));
    const nm = scEl('div', 'nm', sc.name || 'Сцена');
    const own = scLay(sc.layout);
    const now = scLayoutOf(sc) !== (sc.layout || '') ? scLay(scLayoutOf(sc)) : null;
    nm.append(scEl('small', '', `${sc.w}×${sc.h}` + (has ? scGroupTag(sc, true) : '') + ' · ' + (own ? `макет «${own.name}»` : 'без макета') + (has ? ` · выходов: ${sc.outputs.length}` : ' · без выхода') + (now ? ` · сейчас «${now.name}»` : '')));
    row.append(Icons.el('scene'), nm);
    if (has) {
      const open = scOutsOf(scSceneSid(sc)).length;
      const dot = scEl('span', 'dot' + (open ? ' on' : ''));
      dot.title = open ? 'Сцена выводится' : 'Выходы сцены закрыты';
      row.append(dot);
    }
    row.addEventListener('click', () => scPick({ kind: 'scene', id: sc.id }));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); scSceneMenu(e, sc); });
    return row;
  }));
}

function scRenderItems() {
  const sc = scCurScene();
  $('scItemsHead').hidden = $('scItems').hidden = !sc;
  if (!sc) return;
  const box = $('scItems');
  if (!sc.items.length) { box.replaceChildren(scEl('div', 'te-empty', 'Пусто. Добавьте элементы кнопками над холстом или перетащите файл из Проводника на холст.')); return; }
  box.replaceChildren(...[...sc.items].reverse().map((it) => {
    const row = scEl('div', 'sc-row' + (scSelIds().includes(it.id) ? ' sel' : '') + (it.hidden ? ' off' : ''));
    row.draggable = true;
    const nm = scEl('div', 'nm', it.name || SC_ITEMS[it.type].name);
    const eye = scEl('button', it.hidden ? '' : 'on');
    eye.title = it.hidden ? 'Показать' : 'Скрыть';
    eye.append(Icons.el('eye'));
    eye.addEventListener('click', (e) => { e.stopPropagation(); scItemSet(it, { hidden: !it.hidden }); });
    const lock = scEl('button', it.locked ? 'on' : '');
    lock.title = it.locked ? 'Разблокировать' : 'Закрепить (не двигается мышью)';
    lock.append(Icons.el('lock'));
    lock.addEventListener('click', (e) => { e.stopPropagation(); scItemSet(it, { locked: !it.locked }); });
    row.append(Icons.el(SC_ITEMS[it.type].icon), nm, eye, lock);
    // Ctrl / Shift — добавить к выделению
    row.addEventListener('click', (e) => scSelectItem(it.id, e.ctrlKey || e.metaKey || e.shiftKey));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!scSelIds().includes(it.id)) scSelectItem(it.id); scItemMenu(e, it); });
    // Порядок — перетаскиванием (верхняя строка — поверх всех)
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-cp-scitem', it.id); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-cp-scitem')) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      row.classList.toggle('drop-before', e.clientY < r.top + r.height / 2);
      row.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-cp-scitem');
      row.classList.remove('drop-before', 'drop-after');
      if (!id || id === it.id) return;
      e.preventDefault();
      e.stopPropagation();
      const above = e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2; // выше в списке = поверх
      const moved = sc.items.find((x) => x.id === id);
      sc.items = sc.items.filter((x) => x.id !== id);
      const at = sc.items.indexOf(it);
      sc.items.splice(above ? at + 1 : at, 0, moved);
      scSceneTouch(false);
    });
    return row;
  }));
}

function scScreenMenu(e, s) {
  const i = lib.screens.indexOf(s);
  showMenu(e, [
    { label: s.enabled ? 'Выключить вывод' : 'Включить вывод', disabled: s.id === 'main', fn: () => scScreenSet(s, { enabled: !s.enabled }, true) },
    { label: 'Показать в «Предпросмотре»', fn: () => scPreviewOn(s.id) },
    { label: 'Открыть в отдельном окне', fn: () => scFloat(s.id) },
    '-',
    { label: 'Переименовать…', fn: async () => { const n = await askName('Название экрана', s.name); if (n) scScreenSet(s, { name: n }, true); } },
    { label: 'Дублировать', disabled: s.id === 'main', fn: () => { const c = { ...scClone(s), id: newId(), name: s.name + ' (копия)', outputs: [], enabled: false }; lib.screens.splice(i + 1, 0, c); saveLib(); scSend(); scPick({ kind: 'screen', id: c.id }); } },
    '-',
    { label: 'Выше', disabled: i <= 1, fn: () => { lib.screens.splice(i - 1, 0, lib.screens.splice(i, 1)[0]); saveLib(); scSend(); scRenderLists(); } },
    { label: 'Ниже', disabled: s.id === 'main' || i >= lib.screens.length - 1, fn: () => { lib.screens.splice(i + 1, 0, lib.screens.splice(i, 1)[0]); saveLib(); scSend(); scRenderLists(); } },
    '-',
    { label: 'Удалить экран', disabled: s.id === 'main', fn: () => {
      lib.screens = lib.screens.filter((x) => x !== s);
      // элементы «Экран» в сценах, ссылавшиеся на него, покажут «Экран удалён»
      saveLib(); scSend();
      if (scSel.id === s.id) scSel = { kind: 'screen', id: 'main' };
      scRenderAll(true);
      flashStatus(`Экран «${s.name}» удалён · Ctrl+Z — вернуть`);
    } },
  ]);
}

function scSceneMenu(e, sc) {
  const i = lib.scenes.indexOf(sc);
  const l = scLay(sc.layout);
  showMenu(e, [
    { label: sc.on ? 'Выключить вывод' : 'Включить вывод', disabled: !(sc.outputs || []).length, fn: () => { sc.on = !sc.on; scSceneOutSet(sc, true); } },
    { label: 'Показать в «Предпросмотре»', fn: () => scPreviewOn(scSceneSid(sc)) },
    { label: 'Открыть в отдельном окне', fn: () => scFloat(scSceneSid(sc)) },
    '-',
    { label: l ? `Править макет «${l.name}»` : 'Править макет (не выбран)', disabled: !l, fn: () => scPick({ kind: 'layout', id: l.id }) },
    { label: 'Переименовать…', fn: async () => { const n = await askName('Название сцены', sc.name); if (n) { sc.name = n; scSceneOutSet(sc, true); } } },
    { label: 'Дублировать', fn: () => scAddScene({ ...scClone(sc), id: newId(), name: sc.name + ' (копия)', outputs: [], on: false }) },
    '-',
    { label: 'Выше', disabled: i <= 0, fn: () => { lib.scenes.splice(i - 1, 0, lib.scenes.splice(i, 1)[0]); saveLib(); scRenderLists(); } },
    { label: 'Ниже', disabled: i >= lib.scenes.length - 1, fn: () => { lib.scenes.splice(i + 1, 0, lib.scenes.splice(i, 1)[0]); saveLib(); scRenderLists(); } },
    '-',
    { label: 'Удалить сцену', fn: () => {
      lib.scenes = lib.scenes.filter((x) => x !== sc);
      delete scAuto[sc.id];
      saveLib(); scSend();
      if (scSel.id === sc.id) scSel = { kind: 'screen', id: 'main' };
      scRenderAll(true);
      flashStatus(`Сцена «${sc.name}» удалена (макет остался в «Пресетах сцен») · Ctrl+Z — вернуть`);
    } },
  ]);
}

// Показать экран или сцену ('scene:id') в «Предпросмотре» окна оператора
function scPreviewOn(id) {
  settings.prevScreen = id;
  saveSettings();
  if (typeof prevScreenSync === 'function') prevScreenSync();
  flashStatus('В «Предпросмотре»: ' + scNameOf(id));
}
// Отдельное плавающее окно (поверх остальных) с экраном или сценой — main.js: screens:float
function scFloat(id) {
  if (!window.api.screensFloat) { flashStatus('Отдельное окно — только в программе'); return; }
  window.api.screensFloat({ id, name: scNameOf(id) });
}
function scNameOf(id) {
  if (!id || id === 'main') return (scScreen('main') || {}).name || 'Основной';
  if (id.startsWith('scene:')) return 'сцена «' + ((scScene(id.slice(6)) || {}).name || '?') + '»';
  return (scScreen(id) || {}).name || '?';
}

/* ----- Правка ----- */

function scScreenSet(s, patch, rerenderInsp) {
  Object.assign(s, patch);
  saveLib();
  scSend();
  // Тема «Основного» сменилась — «Предпросмотр» перерисовать сразу (окна выходов перерисуются сами)
  if (s.id === 'main' && ('theme' in patch || 'themeTpl' in patch) && typeof refreshLive === 'function') refreshLive();
  if (!scTabOn) return;
  scRenderLists();
  if (scSel.kind === 'screen' && scSel.id === s.id) {
    scRenderBar();
    if (rerenderInsp) scRenderInsp();
    if ('w' in patch || 'h' in patch) scLayout();
  }
}

// Сцена изменилась (черновик): превью, рамки, списки; на экраны — только по «Применить»
function scSceneTouch(rerenderInsp, sc = scCurScene()) {
  saveLib();
  if (sc && scH && scH.kind === 'scene' && scH.id === sc.id) Compose.updateScene(scH.h, sc);
  scLayout();
  scRenderLists();
  scRenderBar();
  if (rerenderInsp) scRenderInsp();
}
function scItemSet(it, patch, rerenderInsp) {
  Object.assign(it, patch);
  scSceneTouch(rerenderInsp);
}
const scSub = (obj, key, sub, v) => { obj[key] = { ...(obj[key] || {}), [sub]: v }; };

function scApply(l = scCurScene()) {
  if (!l) return;
  scLive[l.id] = scClone(l);
  scSend();
  scRenderLists();
  scRenderBar();
  const users = scUsers(l);
  flashStatus(`Макет «${l.name}» применён` + (users.length ? ' — в сценах: ' + users.map((x) => x.name).join(', ') : ' (пока ни в одной сцене)'));
}
function scRevert(l = scCurScene()) {
  if (!l || !scLive[l.id]) return;
  Object.assign(l, scClone(scLive[l.id]));
  if (!scCurItem()) scIt = null;
  scSceneTouch(true, l);
  if (scH && scH.kind === 'scene') scMountView();
  flashStatus('Правки макета сброшены · Ctrl+Z — вернуть');
}

function scAddScreen(fmt) {
  const [name, w, h] = fmt || ['', 1920, 1080];
  const s = scNewScreen({ name: `Экран ${lib.screens.length + 1}` + (name ? ` (${name})` : ''), w, h });
  lib.screens.push(s);
  saveLib();
  scSend();
  scPick({ kind: 'screen', id: s.id });
  flashStatus('Новый экран — программа. Выход (монитор, окно, NDI) — справа в «Выходах», потом включите вывод');
}
$('scAddScreen').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
    ...SC_FORMATS.map((f) => ({ label: `${f[0]} — ${f[1]}×${f[2]}`, fn: () => scAddScreen(f) })),
    { label: 'Своё разрешение…', fn: () => scAddScreen(['', 1920, 1080]) },
  ]);
});

function scAddScene(sc) {
  lib.scenes.push(sc);
  saveLib();
  scSend();
  scPick({ kind: 'scene', id: sc.id });
}
// Новая сцена из шаблона: шаблон становится новым макетом в «Пресетах сцен», фон шаблона — фон сцены
function scSceneFromTpl(kind) {
  const t = scTemplate(kind);
  const l = scAddLayout(scLayoutFrom(t, { bg: undefined }), false);
  scAddScene(scNewScene(l, { bg: t.bg || '#000000', follow: !!t.follow }));
  flashStatus(`Новая сцена «${l.name}» — её макет в «Пресетах сцен». Выход — справа в «Выходах»`);
}
// Готовые макеты для сцены (музыкантам, ведущим) — как Stage Layouts в ProPresenter
const SC_STAGE_TPL = [
  ['st-curnext', 'Текущий и следующий слайд'],
  ['st-timer', 'Текущий + следующий слайд + таймер'],
  ['st-chords', 'Текущий слайд + аккорды'],
  ['st-screens', 'Основной экран + экран трансляции'],
  ['st-multi', 'Мониторинг всех экранов'],
  ['st-host', 'Ведущему: заметки и таймер'],
];
// «＋» у «Сцен»: сцена с готовым макетом из «Пресетов сцен» или с новым — из шаблона
$('scAddScene').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const list = scPresets();
  showMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
    ...(list.length ? [{ label: 'С макетом из «Пресетов сцен»', disabled: true, fn() {} }, ...list.map((p) => ({ label: '   ' + p.name, fn: () => scAddScene(scNewScene(p)) })), '-',
      { label: 'С новым макетом', disabled: true, fn() {} }] : []),
    ...scTplMenu(scSceneFromTpl),
  ]);
});
$('scImport').addEventListener('click', scImport);

// Какой макет сейчас на выходах сцены: свой или временно другой (как смена макета на сценическом экране)
function scLayoutPick(sc) {
  const own = scLay(sc.layout);
  return scSelect([['', own ? `Свой: «${own.name}»` : 'Свой (не выбран)'], ...scPresets().filter((x) => x !== own).map((x) => [x.id, x.name])],
    scLayoutOf(sc) === (sc.layout || '') ? '' : scLayoutOf(sc), (v) => scSetLayout(sc.id, v));
}

/* ----- Примеры сцен ----- */

function scItem(type, x, y, w, h, over) {
  // Блок «Программа» по умолчанию — своё разрешение (без полей при любом мониторе «Основного»)
  return { id: newId(), type, name: '', x, y, w, h, rot: 0, opacity: 100, fit: type === 'program' ? 'native' : 'contain', ...over };
}
function scTemplate(kind) {
  const pres = layerDefs().filter((l) => l.kind === 'pres').map((l) => l.id);
  const t = (text, x, y, w, h, over) => scItem('text', x, y, w, h, { text, size: 40, color: '#ffffff', align: 'left', valign: 'middle', ...over });
  const base = { id: newId(), w: 1920, h: 1080, bg: '#000000', trans: { type: 'fade', ms: 600 }, items: [] };
  if (kind === 'vertical') return { ...base, name: 'Вертикальная сцена', w: 1080, h: 1920 };
  if (kind === 'multi') return { ...base, name: 'Мультиэкран', bg: '#0b0f16', items: [
    scItem('program', 40, 70, 1240, 698, { name: 'Основная программа', radius: 12 }),
    t('Сейчас на экране', 40, 16, 600, 50, { size: 30, color: '#9fb6dc' }),
    scItem('next', 1320, 70, 560, 315, { name: 'Следующий слайд', radius: 10 }),
    t('Далее', 1320, 16, 300, 50, { size: 30, color: '#9fb6dc' }),
    scItem('source', 1320, 453, 560, 315, { name: 'Камера', fit: 'cover', radius: 10 }),
    t('Камера', 1320, 400, 300, 50, { size: 30, color: '#9fb6dc' }),
    scItem('clock', 40, 820, 600, 200, { size: 150, color: '#ffffff', align: 'left', bold: true }),
  ] };
  if (kind === 'three') return { ...base, name: 'Три экрана', w: 3608, h: 1080, items: [
    scItem('media', 0, 0, 1080, 1080, { name: 'Левый 1:1', fit: 'cover' }),
    scItem('program', 1080, 0, 1920, 1080, { name: 'Центр 16:9' }),
    scItem('program', 3000, 0, 608, 1080, { name: 'Правый 9:16', fit: 'cover', layers: layerDefs().filter((l) => l.kind !== 'pres').map((l) => l.id) }),
  ] };
  if (kind === 'broadcast') return { ...base, name: 'Трансляция', items: [
    scItem('source', 0, 0, 1920, 1080, { name: 'Камера', fit: 'cover' }),
    scItem('rect', 0, 660, 1920, 420, { name: 'Затемнение снизу', fill: 'rgba(0,0,0,0)', fill2: '#000000', fillA: 180, opacity: 85 }),
    scItem('program', 0, 0, 1920, 1080, { name: 'Текст песни', layers: pres.length ? pres : null }),
    t('Прямая трансляция', 60, 40, 700, 70, { size: 34, bold: true, bg: '#e5484d', pad: 14, align: 'center', radius: 8 }),
    scItem('clock', 1560, 40, 300, 70, { size: 44, color: '#ffffff', align: 'right', tshadow: true }),
  ] };
  if (kind.startsWith('st-')) return scStageTemplate(kind, base, t);
  return { ...base, name: 'Новая сцена' };
}

// Сценические макеты: инфоблоки + слайды + экраны; сообщение для сцены — полосой снизу (скрыто, пока пусто)
function scStageTemplate(kind, base0, t) {
  const base = { ...base0, trans: { type: 'fade', ms: 300 }, follow: true };
  const info = (type, x, y, w, h, over) => scItem(type, x, y, w, h, { size: 64, color: '#ffffff', align: 'center', valign: 'middle', auto: true, minSize: 14, ...over });
  const cap = (text, x, y, color) => t(text, x, y, 560, 46, { size: 30, color, bold: true });
  const msg = (y = 950) => info('msg', 0, y, 1920, 130, { name: 'Сообщение', size: 72, bold: true, bg: '#c81e2e', pad: 10, hideEmpty: true, blink: true });
  const timer = () => (typeof stEnsureTimer === 'function' ? stEnsureTimer() : '');
  const now = () => [cap('СЕЙЧАС', 40, 16, '#4fe08a')];
  const curBox = (x, y, w, h) => scItem('cur', x, y, w, h, { name: 'Текущий слайд', border: { w: 3, c: '#4fe08a' } });
  const nextBox = (x, y, w, h) => scItem('next', x, y, w, h, { name: 'Следующий слайд', border: { w: 3, c: '#f5a524' } });
  const clock = (x, y, w, h, size) => scItem('clock', x, y, w, h, { size, bold: true, color: '#ffffff', align: 'center' });
  if (kind === 'st-curnext') return { ...base, name: 'Текущий и следующий', items: [
    ...now(), curBox(40, 72, 1150, 647),
    cap('ДАЛЕЕ', 1230, 16, '#f5a524'), nextBox(1230, 72, 650, 366),
    clock(1230, 470, 650, 160, 140),
    info('count', 1230, 640, 650, 80, { size: 44, color: '#9fb6dc', prefix: 'Слайд' }),
    info('plist', 40, 750, 1840, 190, { size: 48, align: 'left' }),
    msg(),
  ] };
  if (kind === 'st-timer') return { ...base, name: 'Слайды и таймер', items: [
    ...now(), curBox(40, 72, 1150, 647),
    cap('ДАЛЕЕ', 1230, 16, '#f5a524'), nextBox(1230, 72, 650, 366),
    cap('ТАЙМЕР', 1230, 466, '#9fb6dc'),
    info('timer', 1230, 515, 650, 200, { size: 180, bold: true, ref: timer() }),
    clock(40, 750, 600, 180, 120),
    info('plist', 680, 750, 1200, 180, { size: 44, align: 'left' }),
    msg(),
  ] };
  if (kind === 'st-chords') return { ...base, name: 'Слайд и аккорды', items: [
    ...now(), curBox(40, 72, 760, 428),
    cap('ДАЛЕЕ', 40, 520, '#f5a524'),
    info('nextText', 40, 570, 760, 300, { size: 56, color: '#b8c4d6', label: true }),
    info('chords', 840, 20, 1040, 900, { size: 64, align: 'left', valign: 'top', chordC: '#ffd84a', nextToo: true }),
    clock(40, 880, 380, 70, 56),
    info('count', 420, 880, 380, 70, { size: 44, color: '#9fb6dc' }),
    msg(),
  ] };
  if (kind === 'st-screens') {
    const other = lib.screens.find((s) => s.id !== 'main' && /трансл|stream|эфир|ndi/i.test(s.name))
      || lib.screens.find((s) => s.id !== 'main' && (s.outputs || []).some((o) => o.kind === 'ndi'))
      || lib.screens.find((s) => s.id !== 'main');
    return { ...base, name: 'Основной и трансляция', items: [
      cap('ОСНОВНОЙ ЭКРАН', 40, 16, '#4fe08a'),
      scItem('screen', 40, 72, 900, 506, { name: 'Основной экран', ref: 'main', border: { w: 2, c: '#4fe08a' } }),
      cap('ТРАНСЛЯЦИЯ', 980, 16, '#e5484d'),
      scItem('screen', 980, 72, 900, 506, { name: other ? other.name : 'Трансляция — выберите экран справа', ref: other ? other.id : 'main', border: { w: 2, c: '#e5484d' } }),
      cap('ДАЛЕЕ', 40, 610, '#f5a524'), nextBox(40, 660, 520, 293),
      info('timer', 600, 660, 640, 160, { size: 140, bold: true, ref: timer() }),
      clock(600, 830, 640, 120, 96),
      info('cap', 1280, 660, 600, 290, { size: 56, bold: true, align: 'left' }),
      msg(),
    ] };
  }
  if (kind === 'st-multi') {
    const cells = lib.screens.map((s) => ({ type: 'screen', ref: s.id, name: s.name }));
    cells.push({ type: 'next', name: 'Следующий слайд' });
    const n = cells.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const gap = 30;
    const top = 20;
    const availH = 940 - top;
    let w = (1920 - gap * (cols + 1)) / cols;
    let h = (w * 9) / 16;
    if (rows * (h + 46 + gap) > availH) { h = availH / rows - 46 - gap; w = (h * 16) / 9; }
    const x0 = (1920 - (cols * w + (cols - 1) * gap)) / 2;
    const items = [];
    cells.forEach((c, i) => {
      const x = Math.round(x0 + (i % cols) * (w + gap));
      const y = Math.round(top + Math.floor(i / cols) * (h + 46 + gap));
      items.push(t(c.name.toUpperCase(), x, y, Math.round(w), 40, { size: 26, color: '#9fb6dc', bold: true }));
      items.push(scItem(c.type, x, y + 44, Math.round(w), Math.round(h), { name: c.name, ref: c.ref, border: { w: 2, c: '#3a4658' } }));
    });
    items.push(clock(40, 960, 420, 100, 80), info('cap', 500, 960, 900, 100, { size: 40, bold: true, align: 'left' }), info('timer', 1440, 960, 440, 100, { size: 80, bold: true, ref: timer() }), msg(0));
    return { ...base, name: 'Мониторинг экранов', bg: '#07090d', items };
  }
  if (kind === 'st-host') return { ...base, name: 'Ведущему', items: [
    ...now(), curBox(40, 72, 880, 495),
    info('timer', 960, 40, 920, 260, { size: 220, bold: true, ref: timer() }),
    clock(960, 310, 920, 120, 90),
    cap('ЗАМЕТКИ К СЛАЙДУ', 960, 450, '#ffe066'),
    info('notes', 960, 500, 920, 300, { size: 56, align: 'left', valign: 'top', color: '#ffe066' }),
    cap('ЗАМЕТКА ОПЕРАТОРА', 40, 590, '#7fd3ff'),
    info('opnote', 40, 640, 880, 290, { size: 48, align: 'left', valign: 'top', color: '#9fe0ff' }),
    info('plist', 960, 820, 920, 110, { size: 40, align: 'left' }),
    msg(),
  ] };
  return { ...base, name: 'Пустой макет' };
}

// Макет в файл: формат тот же, что у старых сцен ('screen-scene', поле scene) — старые файлы открываются как макеты
async function scExport(l) {
  const data = scLayoutFrom(l, { id: l.id, name: l.name });
  const file = await window.api.saveJson({ name: l.name, data: { app: 'church-presenter', kind: 'screen-scene', version: 2, scene: data }, title: 'Сохранить макет сцены', label: 'Макет сцены MP Show' });
  if (file) flashStatus('Сохранено: ' + file.split(/[\\/]/).pop());
}
async function scImport() {
  const res = await window.api.openJson({ title: 'Загрузить макет сцены', label: 'Макет сцены (JSON)' });
  if (!res) return;
  const sc = res.ok && res.data && res.data.kind === 'screen-scene' && res.data.scene;
  if (!sc || !Array.isArray(sc.items)) { showNotice('В файле нет макета сцены', true); return; }
  // выходы и мониторы другого компьютера не берём — только макет; ссылки на чужие экраны и слои остаются пустыми
  const l = scLayoutFrom(sc);
  l.items = l.items.filter((x) => x && SC_ITEMS[x.type]).map((x) => ({ ...x, id: newId() }));
  scAddLayout(l);
  flashStatus(`Макет «${l.name}» загружен — поставьте его в сцену (правая кнопка по макету или свойства сцены)`);
}

/* ----- Холст: превью экрана или редактор сцены ----- */

function scUnmountView() {
  if (scH) { if (scH.kind === 'screen') Compose.unmountScreen(scH.h); else Compose.unmountScene(scH.h); }
  scH = null;
  $('scView').replaceChildren();
  $('scOv').replaceChildren();
}
function scMountView() {
  scUnmountView();
  if (!scTabOn) return;
  const view = $('scView');
  if (scSel.kind === 'screen' && scScreen(scSel.id)) scH = { kind: 'screen', id: scSel.id, h: Compose.mountScreen(view, scSel.id, { preview: true }) };
  // Сцена — как она идёт на выходы: применённый макет в её размере и фоне
  else if (scCurSc()) scH = { kind: 'screen', id: scSceneSid(scCurSc()), h: Compose.mountScreen(view, scSceneSid(scCurSc()), { preview: true }) };
  else if (scCurScene()) scH = { kind: 'scene', id: scSel.id, h: Compose.mountScene(view, scCurScene(), { preview: true, chain: [], edit: true }) };
  scLayout();
}
function scUpdateView() {
  const sc = scCurScene();
  if (sc && scH && scH.kind === 'scene') Compose.updateScene(scH.h, sc);
  scLayout();
}
function scViewSize() {
  const sc = scCurScene();
  if (sc) return { W: Math.max(16, sc.w), H: Math.max(16, sc.h) };
  const { w, h } = Compose.screenSize(scSel.kind === 'scene' ? 'scene:' + scSel.id : scSel.id);
  return { W: w, H: h };
}
// Масштаб холста (как в редакторе тем): 1 — вписать в окно, меньше — мельче, больше — крупнее (холст прокручивается).
// Кнопки «−»/«+» под холстом, Ctrl + колёсико над холстом, щелчок по процентам — вписать. Один на все холсты редактора сцен
const SC_ZOOM_MIN = 0.1;
const SC_ZOOM_MAX = 6;
let scZoom = Math.max(SC_ZOOM_MIN, Math.min(SC_ZOOM_MAX, Number(settings.scZoom) || 1));
function scSetZoom(z, at) {
  const cv = $('scCanvas');
  z = Math.max(SC_ZOOM_MIN, Math.min(SC_ZOOM_MAX, Math.round(z * 100) / 100));
  if (Math.abs(z - 1) < 0.04) z = 1; // рядом с «вписать» — прилипает
  // точка под курсором (доля холста) остаётся под курсором
  const R = $('scHost').getBoundingClientRect();
  const C = cv.getBoundingClientRect();
  const px = at ? at.clientX : C.left + C.width / 2;
  const py = at ? at.clientY : C.top + C.height / 2;
  const fx = R.width ? (px - R.left) / R.width : 0.5;
  const fy = R.height ? (py - R.top) / R.height : 0.5;
  scZoom = z;
  settings.scZoom = z;
  saveSettings();
  scLayout();
  const R2 = $('scHost').getBoundingClientRect();
  cv.scrollLeft += R2.left + fx * R2.width - px;
  cv.scrollTop += R2.top + fy * R2.height - py;
}
$('scZoomOut').addEventListener('click', () => scSetZoom(scZoom / 1.25));
$('scZoomIn').addEventListener('click', () => scSetZoom(scZoom * 1.25));
$('scZoomFit').addEventListener('click', () => scSetZoom(1));
$('scCanvas').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  scSetZoom(scZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e);
}, { passive: false });

function scLayout() {
  if (!scTabOn) return;
  const cv = $('scCanvas');
  const host = $('scHost');
  const view = $('scView');
  const { W, H } = scViewSize();
  // размер места — без полос прокрутки (иначе масштаб «прыгает», когда они появляются)
  const cw = cv.offsetWidth;
  const ch = cv.offsetHeight;
  if (!cw || !ch) return;
  const zoomed = scZoom > 1;
  cv.classList.toggle('zoomed', zoomed);
  scK = Math.min(cw / W, ch / H) * scZoom;
  const pad = zoomed ? 24 : 0; // крупнее места — поля и прокрутка
  const left = Math.max(pad, (cw - W * scK) / 2);
  const top = Math.max(pad, (ch - H * scK) / 2);
  host.style.width = W * scK + 'px';
  host.style.height = H * scK + 'px';
  host.style.left = left + 'px';
  host.style.top = top + 'px';
  let sp = cv.querySelector(':scope > .sc-space');
  if (!sp) { sp = scEl('div', 'sc-space'); cv.append(sp); }
  sp.style.left = left + W * scK + pad - 1 + 'px';
  sp.style.top = top + H * scK + pad - 1 + 'px';
  if (!zoomed) { cv.scrollLeft = 0; cv.scrollTop = 0; }
  $('scZoomFit').textContent = Math.round(scZoom * 100) + '%';
  $('scZoomOut').disabled = scZoom <= SC_ZOOM_MIN;
  $('scZoomIn').disabled = scZoom >= SC_ZOOM_MAX;
  view.style.width = W + 'px';
  view.style.height = H + 'px';
  view.style.transform = `scale(${scK})`;
  scDrawOverlay();
  const it = scCurItem();
  $('scFoot').textContent = scCurScene()
    ? `${W}×${H} · ${Math.round(scK * 100)}%` + (it ? ` · ${it.name || SC_ITEMS[it.type].name}: ${Math.round(it.x)}, ${Math.round(it.y)} · ${Math.round(it.w)}×${Math.round(it.h)}` : '') + ' · Стрелки — сдвиг (Shift — ×10), Delete, Ctrl+D, Ctrl+Enter — применить'
    : scSel.kind === 'scene' ? `${W}×${H} · Так сцена выглядит сейчас на выходе (без звука). Макет правится в «Пресетах сцен» слева`
    : `${W}×${H} · Так экран выглядит сейчас на выходе (без звука)`;
}
new ResizeObserver(() => scLayout()).observe($('scCanvas'));

/* ----- Рамки элементов: выбор, перенос, размер, поворот ----- */

const SC_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function scDrawOverlay(snaps) {
  const ov = $('scOv');
  ov.replaceChildren();
  const sc = scCurScene();
  if (!sc) { scStretchHandle(ov); return; }
  const k = scK;
  // Сетка и безопасная зона (только в редакторе, на выход не идут)
  if (scOpt.grid) {
    const g = scEl('div', 'grid');
    const st = Number(scOpt.gridStep) || 5;
    g.style.backgroundImage = 'linear-gradient(to right, rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.6) 1px, transparent 1px)';
    g.style.backgroundSize = `${st}% ${st}%`;
    ov.append(g);
  }
  if (scOpt.safe) {
    const p = (Number(scOpt.safePct) || 0) + '%';
    const s = scEl('div', 'safe');
    Object.assign(s.style, { left: p, top: p, right: p, bottom: p });
    ov.append(s);
  }
  const ids = scSelIds();
  const single = ids.length === 1;
  for (const it of sc.items) {
    if (it.hidden) continue;
    const sel = ids.includes(it.id);
    const b = scEl('div', 'box' + (sel ? ' sel' : '') + (it.locked ? ' locked' : ''));
    b.style.left = it.x * k + 'px';
    b.style.top = it.y * k + 'px';
    b.style.width = it.w * k + 'px';
    b.style.height = it.h * k + 'px';
    if (it.rot) b.style.transform = `rotate(${it.rot}deg)`;
    b.dataset.id = it.id;
    if (sel) {
      b.append(scEl('span', 'bl', it.name || SC_ITEMS[it.type].name));
      if (!it.locked && single) {
        for (const h of SC_HANDLES) { const d = scEl('div', 'handle ' + h); d.dataset.h = h; b.append(d); }
        const r = scEl('div', 'handle rot');
        r.dataset.h = 'rot';
        r.title = 'Повернуть (Shift — по 15°)';
        b.append(r);
      }
    }
    b.addEventListener('pointerdown', (e) => scBoxDown(e, it));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!scSelIds().includes(it.id)) scSelectItem(it.id); scItemMenu(e, it); });
    ov.append(b);
  }
  // Направляющие сцены (sc.guides, px): тянуть — сдвинуть, за край или двойной щелчок — убрать
  (sc.guides || []).forEach((g, i) => {
    const d = scEl('div', 'guide ' + g.d);
    d.title = 'Направляющая: тяните, чтобы сдвинуть; за край холста или двойной щелчок — убрать';
    if (g.d === 'v') d.style.left = g.p * k + 'px'; else d.style.top = g.p * k + 'px';
    d.addEventListener('pointerdown', (e) => scGuideDrag(e, sc, i));
    d.addEventListener('dblclick', () => { sc.guides.splice(i, 1); scGuidesSaved(sc); });
    ov.append(d);
  });
  for (const s of snaps || []) {
    const l = scEl('div', 'snapline ' + s.d);
    if (s.d === 'v') l.style.left = s.p * k + 'px'; else l.style.top = s.p * k + 'px';
    ov.append(l);
  }
}

// Превью экрана: полоска снизу — вытянуть или сжать по вертикали под настоящий экран (меняет высоту разрешения).
// Пока тянем — меняется только рамка; на выходы и в отмену (Ctrl+Z) — одним шагом, когда отпустили.
function scStretchHandle(ov) {
  const s = scScreen(scSel.id);
  if (!s || s.id === 'main') return; // у «Основного» разрешение — в настройках вывода
  const hd = scEl('div', 'sc-stretch');
  hd.title = 'Потяните вниз или вверх — подогнать высоту экрана под настоящий (ширина не меняется)';
  hd.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hd.setPointerCapture(e.pointerId);
    const host = $('scHost');
    const view = $('scView');
    const cv = $('scCanvas');
    const k0 = scK;
    const y0 = e.clientY;
    const h0 = s.h;
    let h = h0;
    // Рамка вписывается в холст заново: высокий экран уменьшается, но виден целиком
    const move = (ev) => {
      h = Math.max(16, Math.min(16384, Math.round((h0 + (ev.clientY - y0) / k0) / 2) * 2));
      const cw = cv.clientWidth;
      const ch = cv.clientHeight;
      const k = Math.min(cw / s.w, ch / h);
      host.style.width = s.w * k + 'px';
      host.style.height = h * k + 'px';
      host.style.left = (cw - s.w * k) / 2 + 'px';
      host.style.top = (ch - h * k) / 2 + 'px';
      view.style.height = h + 'px';
      view.style.transform = `scale(${k})`;
      $('scFoot').textContent = `${s.w}×${h} · отпустите — экран станет такой высоты`;
    };
    const up = () => {
      hd.removeEventListener('pointermove', move);
      hd.removeEventListener('pointerup', up);
      hd.removeEventListener('pointercancel', up);
      if (h !== h0) { scScreenSet(s, { h }, true); flashStatus(`«${s.name}»: ${s.w}×${h}`); } else scLayout();
    };
    hd.addEventListener('pointermove', move);
    hd.addEventListener('pointerup', up);
    hd.addEventListener('pointercancel', up);
  });
  ov.append(hd);
}

// Пустое место холста: протянуть — рамка выделения (Ctrl/Shift — добавить), щелчок — снять выделение
$('scOv').addEventListener('pointerdown', (e) => {
  const ov = $('scOv');
  if (e.target !== ov || !scCurScene() || e.button !== 0) return;
  const add = e.ctrlKey || e.metaKey || e.shiftKey;
  const r = ov.getBoundingClientRect();
  const x0 = (e.clientX - r.left) / scK;
  const y0 = (e.clientY - r.top) / scK;
  const was = add ? scSelIds() : [];
  let box = null;
  ov.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const x1 = (ev.clientX - r.left) / scK;
    const y1 = (ev.clientY - r.top) / scK;
    if (!box && Math.abs(x1 - x0) + Math.abs(y1 - y0) < 4 / scK) return;
    const L = Math.min(x0, x1), T = Math.min(y0, y1), R = Math.max(x0, x1), B = Math.max(y0, y1);
    const hit = scCurScene().items.filter((it) => !it.hidden && it.x < R && it.x + it.w > L && it.y < B && it.y + it.h > T).map((it) => it.id);
    scSetSel([...new Set([...was, ...hit])], true);
    box = scEl('div', 'marq');
    Object.assign(box.style, { left: L * scK + 'px', top: T * scK + 'px', width: (R - L) * scK + 'px', height: (B - T) * scK + 'px' });
    ov.append(box);
  };
  const up = () => {
    ov.removeEventListener('pointermove', move);
    ov.removeEventListener('pointerup', up);
    ov.removeEventListener('pointercancel', up);
    if (!box && !add) scSetSel([]);
    else scSetSel(scSelIds());
  };
  ov.addEventListener('pointermove', move);
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', up);
});

// Выделение: scIt — главный элемент (его свойства справа), scMore — ещё выделенные (Ctrl/Shift, рамка)
let scMore = [];
const scSelIds = () => (scIt ? [scIt, ...scMore.filter((x) => x !== scIt)] : []);
function scSelItems() {
  const sc = scCurScene();
  if (!sc) return [];
  const ids = scSelIds();
  return sc.items.filter((i) => ids.includes(i.id));
}
// fast — только рамки (во время протягивания рамки выделения)
function scSetSel(ids, fast) {
  scIt = ids[0] || null;
  scMore = ids.slice(1);
  scDrawOverlay();
  if (fast) return;
  scRenderItems();
  scRenderInsp();
  scRenderBar();
  scLayout();
}
// add — Ctrl/Shift: добавить к выделению или убрать из него
function scSelectItem(id, add) {
  const ids = scSelIds();
  if (add && id) { scSetSel(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]); return; }
  if (scIt === id && !scMore.length) return;
  scSetSel(id ? [id] : []);
}

// Направляющие сцены (sc.guides = [{ d: 'v'|'h', p: px }]): не содержимое — на выходы не идут, «Применить» не нужно
function scGuidesSaved(sc) {
  if (scLive[sc.id]) scLive[sc.id].guides = scClone(sc.guides || []);
  saveLib();
  scDrawOverlay();
  scRenderBar();
}
function scGuideAdd(d, p) {
  const sc = scCurScene();
  if (!sc) return;
  sc.guides = [...(sc.guides || []), { d, p: Math.round(p) }];
  scGuidesSaved(sc);
}
function scGuideDrag(e, sc, i) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const ov = $('scOv');
  const r = ov.getBoundingClientRect();
  const g = sc.guides[i];
  ov.setPointerCapture(e.pointerId);
  const move = (ev) => {
    let p = g.d === 'v' ? (ev.clientX - r.left) / scK : (ev.clientY - r.top) / scK;
    if (scOpt.snap && !ev.altKey) { const c = scNear(p, g.d === 'v' ? [0, sc.w / 2, sc.w] : [0, sc.h / 2, sc.h], 7 / scK); if (c != null) p = c; }
    g.p = Math.round(p);
    scDrawOverlay();
  };
  const up = () => {
    ov.removeEventListener('pointermove', move);
    ov.removeEventListener('pointerup', up);
    ov.removeEventListener('pointercancel', up);
    const max = g.d === 'v' ? sc.w : sc.h;
    if (g.p < 0 || g.p > max) sc.guides.splice(sc.guides.indexOf(g), 1);
    scGuidesSaved(sc);
  };
  ov.addEventListener('pointermove', move);
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', up);
}

// Настройки привязки редактора сцен и макетов (как в редакторе тем): общий магнит и к чему прилипать.
// Хранятся у оператора (localStorage), не в сцене. Alt при перетаскивании — без привязки.
const scOpt = (() => {
  const def = { snap: true, sEdges: true, sItems: true, sGrid: true, sSafe: true, sGuides: true, grid: false, gridStep: 5, safe: false, safePct: 5 };
  try { return { ...def, ...JSON.parse(localStorage.getItem('cp.sceneEditor') || '{}') }; } catch { return def; }
})();
const scSaveOpt = () => { try { localStorage.setItem('cp.sceneEditor', JSON.stringify(scOpt)); } catch { /* без памяти — не страшно */ } };

// Куда можно прилипнуть (px сцены): края и центр, другие элементы, сетка, безопасная зона — что включено
function scTargets(sc, it) {
  const xs = [];
  const ys = [];
  if (scOpt.sEdges) { xs.push(0, sc.w / 2, sc.w); ys.push(0, sc.h / 2, sc.h); }
  if (scOpt.sItems) for (const o of sc.items) {
    if (o === it || (it && it.skip && it.skip.includes(o)) || o.hidden || o.rot) continue; // skip — сдвигаемая группа
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  if (scOpt.grid && scOpt.sGrid) {
    const st = Number(scOpt.gridStep) || 5;
    for (let v = 0; v <= 100.001; v += st) { xs.push((sc.w * v) / 100); ys.push((sc.h * v) / 100); }
  }
  if (scOpt.sGuides) for (const g of sc.guides || []) (g.d === 'v' ? xs : ys).push(g.p);
  if (scOpt.safe && scOpt.sSafe) {
    const p = (Number(scOpt.safePct) || 0) / 100;
    xs.push(sc.w * p, sc.w * (1 - p));
    ys.push(sc.h * p, sc.h * (1 - p));
  }
  return { xs, ys };
}
const scNear = (v, list, tol) => { let best = null; for (const c of list) if (Math.abs(c - v) < tol && (best == null || Math.abs(c - v) < Math.abs(best - v))) best = c; return best; };

// Прилипание при сдвиге: левый край, центр или правый край — что ближе (без поворота)
function scSnap(sc, it, x, y) {
  const tol = 7 / scK;
  const { xs, ys } = scTargets(sc, it);
  const lines = [];
  const pick = (pos, size, cands, d) => {
    let best = null;
    for (const off of [0, size / 2, size]) for (const c of cands) {
      const dd = Math.abs(pos + off - c);
      if (dd < tol && (!best || dd < best.dd)) best = { dd, v: c - off, c };
    }
    if (best) { lines.push({ d, p: best.c }); return best.v; }
    return pos;
  };
  return { x: pick(x, it.w, xs, 'v'), y: pick(y, it.h, ys, 'h'), lines };
}

function scBoxDown(e, it) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const sc = scCurScene();
  const mode = e.target.dataset && e.target.dataset.h ? e.target.dataset.h : 'move';
  // Ctrl/Shift — добавить к выделению или убрать; щелчок по невыделенному — выделить только его
  if (e.ctrlKey || e.metaKey || e.shiftKey) { scSelectItem(it.id, true); return; }
  if (!scSelIds().includes(it.id)) scSelectItem(it.id);
  if (it.locked) return;
  const ov = $('scOv');
  const k = scK;
  const s0 = { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0 };
  // Сдвиг нескольких: все выделенные незакреплённые, привязка — по общей рамке
  const group = mode === 'move' ? scSelItems().filter((x) => !x.locked) : [it];
  const g0 = group.map((x) => ({ x, sx: x.x, sy: x.y }));
  const gb = { x: Math.min(...group.map((x) => x.x)), y: Math.min(...group.map((x) => x.y)) };
  gb.w = Math.max(...group.map((x) => x.x + x.w)) - gb.x;
  gb.h = Math.max(...group.map((x) => x.y + x.h)) - gb.y;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const or = ov.getBoundingClientRect();
  const cx0 = s0.x + s0.w / 2;
  const cy0 = s0.y + s0.h / 2;
  let moved = false;
  ov.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dx = (ev.clientX - x0) / k;
    const dy = (ev.clientY - y0) / k;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2 / k) return;
    moved = true;
    let snaps = [];
    if (mode === 'move') {
      let mx = dx;
      let my = dy;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) my = 0; else mx = 0; } // Shift — только по одной оси
      if (scOpt.snap && !ev.altKey && (group.length > 1 || !s0.rot)) {
        const r = scSnap(sc, group.length > 1 ? { ...gb, skip: group } : it, gb.x + mx, gb.y + my);
        mx = r.x - gb.x; my = r.y - gb.y; snaps = r.lines;
      }
      for (const q of g0) { q.x.x = Math.round(q.sx + mx); q.x.y = Math.round(q.sy + my); }
    } else if (mode === 'rot') {
      const px = (ev.clientX - or.left) / k;
      const py = (ev.clientY - or.top) / k;
      let a = (Math.atan2(py - cy0, px - cx0) * 180) / Math.PI + 90;
      a = ev.shiftKey ? Math.round(a / 15) * 15 : a;
      for (const q of [0, 90, 180, 270, 360, -90]) if (Math.abs(a - q) < 3) a = q;
      it.rot = Math.round((((a % 360) + 540) % 360) - 180);
    } else {
      // Размер — в осях самого элемента (он может быть повёрнут); противоположная сторона стоит на месте
      const th = (s0.rot * Math.PI) / 180;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const sx = mode.includes('e') ? 1 : mode.includes('w') ? -1 : 0;
      const sy = mode.includes('s') ? 1 : mode.includes('n') ? -1 : 0;
      let w = Math.max(8, s0.w + sx * lx);
      let h = Math.max(8, s0.h + sy * ly);
      if (ev.shiftKey && sx && sy) { const r = s0.w / s0.h; if (w / h > r) h = w / r; else w = h * r; }
      if (!sx) w = s0.w;
      if (!sy) h = s0.h;
      const cxl = (sx * (w - s0.w)) / 2;
      const cyl = (sy * (h - s0.h)) / 2;
      const cx = cx0 + cxl * cos - cyl * sin;
      const cy = cy0 + cxl * sin + cyl * cos;
      it.w = Math.round(w);
      it.h = Math.round(h);
      it.x = Math.round(cx - w / 2);
      it.y = Math.round(cy - h / 2);
      // Привязка тянущейся стороны (без поворота; с Shift — пропорции важнее)
      if (scOpt.snap && !ev.altKey && !ev.shiftKey && !s0.rot) {
        const tol = 7 / k;
        const { xs, ys } = scTargets(sc, it);
        let L = it.x, R = it.x + it.w, T = it.y, B = it.y + it.h;
        const n = (v, list, d) => { const c = scNear(v, list, tol); if (c == null) return v; snaps.push({ d, p: c }); return c; };
        if (sx > 0) R = n(R, xs, 'v'); else if (sx < 0) L = n(L, xs, 'v');
        if (sy > 0) B = n(B, ys, 'h'); else if (sy < 0) T = n(T, ys, 'h');
        if (R - L >= 8 && B - T >= 8) Object.assign(it, { x: Math.round(L), y: Math.round(T), w: Math.round(R - L), h: Math.round(B - T) });
      }
    }
    if (scH && scH.kind === 'scene') Compose.updateScene(scH.h, sc);
    scDrawOverlay(snaps);
  };
  const up = () => {
    ov.removeEventListener('pointermove', move);
    ov.removeEventListener('pointerup', up);
    ov.removeEventListener('pointercancel', up);
    if (moved) scSceneTouch(true); else scDrawOverlay();
  };
  ov.addEventListener('pointermove', move);
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', up);
}

// Файл из Проводника — на холст сцены элементом «Фото / видео»
$('scCanvas').addEventListener('dragover', (e) => {
  if (!scCurScene() || !e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  $('scCanvas').classList.add('drop');
});
$('scCanvas').addEventListener('dragleave', () => $('scCanvas').classList.remove('drop'));
$('scCanvas').addEventListener('drop', (e) => {
  $('scCanvas').classList.remove('drop');
  const sc = scCurScene();
  if (!sc || !e.dataTransfer.files.length) return;
  e.preventDefault();
  e.stopPropagation();
  const r = $('scOv').getBoundingClientRect();
  let x = (e.clientX - r.left) / scK;
  let y = (e.clientY - r.top) / scK;
  for (const f of e.dataTransfer.files) {
    const p = window.api.pathForFile(f);
    if (!p || !/\.(jpe?g|png|gif|webp|bmp|svg|mp4|webm|mov|m4v|ogv)$/i.test(p)) continue;
    const w = Math.round(sc.w * 0.4);
    const h = Math.round((w * 9) / 16);
    const it = scItem('media', Math.round(x - w / 2), Math.round(y - h / 2), w, h, { url: window.api.fileUrl(p), name: p.split(/[\\/]/).pop() });
    sc.items.push(it);
    scIt = it.id;
    x += 40; y += 40;
  }
  scSceneTouch(true);
});

/* ----- Добавление элементов ----- */

function scAddItem(type) {
  const sc = scCurScene();
  if (!sc) return;
  const main = scMainSize();
  let w = Math.round(sc.w * 0.45);
  let h = Math.round(w * (main.h / main.w));
  const over = {};
  if (type === 'text') { h = Math.round(sc.h * 0.14); over.text = 'Текст'; over.size = Math.round(sc.h / 14); over.color = '#ffffff'; }
  if (type === 'clock') { w = Math.round(sc.w * 0.25); h = Math.round(sc.h * 0.14); over.size = Math.round(sc.h / 10); over.color = '#ffffff'; over.bold = true; }
  if (SC_ITEMS[type].shape) {
    w = h = Math.round(Math.min(sc.w, sc.h) * 0.3);
    over.fill = '#3e8bff';
    if (type === 'line') { w = Math.round(sc.w * 0.4); h = Math.max(4, Math.round(sc.h / 120)); over.fill = '#ffffff'; }
    if (type === 'arrow') { w = Math.round(sc.w * 0.25); h = Math.round(w * 0.45); }
  }
  if (type === 'screen') {
    const other = lib.screens.find((s) => s.mode !== 'scene' || s.scene !== sc.id) || lib.screens[0];
    over.ref = other.id;
    const z = Compose.screenSize(other.id);
    h = Math.round(w * (z.h / z.w));
  }
  if (type === 'source') over.fit = 'cover';
  // Инфоблоки: текст крупно, размер подбирается сам
  if (SC_ITEMS[type].info && type !== 'only') {
    w = Math.round(sc.w * 0.4);
    h = Math.round(sc.h * (['curText', 'nextText', 'notes', 'opnote', 'chords'].includes(type) ? 0.32 : 0.15));
    Object.assign(over, { size: Math.round(sc.h / (['timer', 'countdown', 'vcd'].includes(type) ? 6 : 12)), color: '#ffffff', align: 'center', valign: 'middle', auto: true, minSize: 14 });
    if (type === 'chords' || type === 'notes' || type === 'opnote') Object.assign(over, { align: 'left', valign: 'top' });
    if (type === 'chords') Object.assign(over, { chordC: '#ffd84a', nextToo: true });
    if (type === 'timer' || type === 'countdown' || type === 'vcd') over.bold = true;
    if (type === 'timer') over.ref = typeof stEnsureTimer === 'function' ? stEnsureTimer() : '';
    if (type === 'countdown') over.to = '10:00';
    if (type === 'msg') { w = sc.w; h = Math.round(sc.h * 0.12); Object.assign(over, { bg: '#c81e2e', pad: 10, bold: true, hideEmpty: true, blink: true }); }
    // Часть песни — плашка цветом части; очередь — столбик сбоку
    if (type === 'part') { w = Math.round(sc.w * 0.25); h = Math.round(sc.h * 0.1); Object.assign(over, { bold: true, case: 'upper', pcol: 'bg', bg: '#2a3240', bgR: 12, pad: 8, hideEmpty: true }); }
    if (type === 'queue') { w = Math.round(sc.w * 0.3); h = Math.round(sc.h * 0.5); Object.assign(over, { size: Math.round(sc.h / 18), align: 'left', valign: 'top', past: 1, ahead: 3, curC: '#ffd84a', title: 'Очередь' }); }
  }
  if (h > sc.h * 0.9) { const k = (sc.h * 0.9) / h; h = Math.round(h * k); w = Math.round(w * k); }
  const it = scItem(type, Math.round((sc.w - w) / 2), Math.round((sc.h - h) / 2), w, h, over);
  sc.items.push(it);
  scIt = it.id;
  scSceneTouch(true);
  if (type === 'media') scPickMedia(it);
}

// Удалить, дублировать — всё выделенное
function scDeleteSel() {
  const sc = scCurScene();
  const sel = scSelItems();
  if (!sc || !sel.length) return;
  sc.items = sc.items.filter((x) => !sel.includes(x));
  scIt = null;
  scMore = [];
  scSceneTouch(true);
  flashStatus((sel.length > 1 ? `Удалено элементов: ${sel.length}` : 'Элемент удалён') + ' · Ctrl+Z — вернуть');
}
function scDeleteItem(it) { scSetSel([it.id], true); scDeleteSel(); }
function scDupSel() {
  const sc = scCurScene();
  const sel = scSelItems();
  if (!sc || !sel.length) return;
  const made = sel.map((it) => { const c = { ...scClone(it), id: newId(), x: it.x + 30, y: it.y + 30 }; sc.items.splice(sc.items.indexOf(it) + 1, 0, c); return c.id; });
  scIt = made[0];
  scMore = made.slice(1);
  scSceneTouch(true);
}
function scDupItem(it) { scSetSel([it.id], true); scDupSel(); }
function scOrder(it, d) {
  const sc = scCurScene();
  const i = sc.items.indexOf(it);
  const j = d === 'top' ? sc.items.length - 1 : d === 'bottom' ? 0 : Math.max(0, Math.min(sc.items.length - 1, i + d));
  if (i === j) return;
  sc.items.splice(j, 0, sc.items.splice(i, 1)[0]);
  scSceneTouch(false);
}

// Копировать / вставить элементы — между сценами тоже (в памяти, пока программа открыта)
let scClip = null;
function scCopySel() {
  const sel = scSelItems();
  if (!sel.length) return;
  scClip = scClone(sel);
  flashStatus(sel.length > 1 ? `Скопировано элементов: ${sel.length}` : 'Элемент скопирован');
}
function scPaste() {
  const sc = scCurScene();
  if (!sc || !scClip || !scClip.length) return;
  const made = scClip.map((it) => { const c = { ...scClone(it), id: newId(), x: it.x + 30, y: it.y + 30 }; sc.items.push(c); return c.id; });
  scClip = scClip.map((it) => ({ ...it, x: it.x + 30, y: it.y + 30 })); // следующая вставка — ещё правее
  scIt = made[0];
  scMore = made.slice(1);
  scSceneTouch(true);
}

// Выровнять и распределить: один элемент — по сцене, несколько — друг по другу (или по сцене, если выбрано)
function scAlign(how, toScene) {
  const sc = scCurScene();
  const sel = scSelItems().filter((x) => !x.locked);
  if (!sc || !sel.length) return;
  const by = sel.length === 1 || toScene ? { x: 0, y: 0, w: sc.w, h: sc.h } : (() => {
    const x = Math.min(...sel.map((i) => i.x));
    const y = Math.min(...sel.map((i) => i.y));
    return { x, y, w: Math.max(...sel.map((i) => i.x + i.w)) - x, h: Math.max(...sel.map((i) => i.y + i.h)) - y };
  })();
  const R = Math.round;
  if (how === 'l') sel.forEach((i) => { i.x = R(by.x); });
  if (how === 'c') sel.forEach((i) => { i.x = R(by.x + (by.w - i.w) / 2); });
  if (how === 'r') sel.forEach((i) => { i.x = R(by.x + by.w - i.w); });
  if (how === 't') sel.forEach((i) => { i.y = R(by.y); });
  if (how === 'm') sel.forEach((i) => { i.y = R(by.y + (by.h - i.h) / 2); });
  if (how === 'b') sel.forEach((i) => { i.y = R(by.y + by.h - i.h); });
  if (how === 'full') sel.forEach((i) => Object.assign(i, { x: 0, y: 0, w: sc.w, h: sc.h, rot: 0 }));
  if (how === 'safe') { const p = (Number(scOpt.safePct) || 5) / 100; sel.forEach((i) => Object.assign(i, { x: R(sc.w * p), y: R(sc.h * p), w: R(sc.w * (1 - 2 * p)), h: R(sc.h * (1 - 2 * p)), rot: 0 })); }
  if (how === 'sameW' || how === 'sameH') { const m = scCurItem() || sel[0]; sel.forEach((i) => { if (how === 'sameW') i.w = m.w; else i.h = m.h; }); }
  // Распределить: крайние стоят, между остальными — равные промежутки
  if ((how === 'dh' || how === 'dv') && sel.length > 2) {
    const h = how === 'dh';
    const s = [...sel].sort((a, b) => (h ? a.x - b.x : a.y - b.y));
    const first = s[0];
    const last = s[s.length - 1];
    const span = h ? last.x + last.w - first.x : last.y + last.h - first.y;
    const sum = s.reduce((a, i) => a + (h ? i.w : i.h), 0);
    const gap = (span - sum) / (s.length - 1);
    let p = h ? first.x : first.y;
    for (const i of s) { if (h) { i.x = R(p); p += i.w + gap; } else { i.y = R(p); p += i.h + gap; } }
  }
  scSceneTouch(true);
}
function scAlignMenu(e) {
  const many = scSelItems().length > 1;
  const pre = many ? 'друг по другу' : 'по сцене';
  scMenuAt(e, [
    { label: `Выровнять (${pre})`, disabled: true, fn() {} },
    { label: 'По левому краю', fn: () => scAlign('l') },
    { label: 'По центру ↔', fn: () => scAlign('c') },
    { label: 'По правому краю', fn: () => scAlign('r') },
    { label: 'По верху', fn: () => scAlign('t') },
    { label: 'По середине ↕', fn: () => scAlign('m') },
    { label: 'По низу', fn: () => scAlign('b') },
    ...(many ? ['-',
      { label: 'По центру сцены ↔', fn: () => scAlign('c', true) },
      { label: 'По середине сцены ↕', fn: () => scAlign('m', true) },
      '-',
      { label: 'Распределить по горизонтали', disabled: scSelItems().length < 3, fn: () => scAlign('dh') },
      { label: 'Распределить по вертикали', disabled: scSelItems().length < 3, fn: () => scAlign('dv') },
      { label: 'Одинаковая ширина (как у главного)', fn: () => scAlign('sameW') },
      { label: 'Одинаковая высота (как у главного)', fn: () => scAlign('sameH') },
    ] : []),
    '-',
    { label: 'Во весь экран', fn: () => scAlign('full') },
    { label: 'В безопасную зону', fn: () => scAlign('safe') },
  ]);
}

function scItemMenu(e, it) {
  const many = scSelItems().length > 1;
  showMenu(e, [
    ...(many ? [] : [
      { label: 'Поверх всех', fn: () => scOrder(it, 'top') },
      { label: 'Выше', fn: () => scOrder(it, 1) },
      { label: 'Ниже', fn: () => scOrder(it, -1) },
      { label: 'Под всеми', fn: () => scOrder(it, 'bottom') },
      '-',
    ]),
    { label: 'Выровнять…', fn: () => scAlignMenu(e) },
    { label: it.hidden ? 'Показать' : 'Скрыть', fn: () => { const v = !it.hidden; scSelItems().forEach((x) => { x.hidden = v; }); scSceneTouch(true); } },
    { label: it.locked ? 'Разблокировать' : 'Закрепить', fn: () => { const v = !it.locked; scSelItems().forEach((x) => { x.locked = v; }); scSceneTouch(true); } },
    '-',
    { label: 'Копировать', key: 'Ctrl+C', fn: scCopySel },
    { label: 'Вставить', key: 'Ctrl+V', disabled: !scClip, fn: scPaste },
    { label: 'Дублировать', key: 'Ctrl+D', fn: scDupSel },
    { label: many ? 'Удалить выделенные' : 'Удалить', key: 'Delete', fn: scDeleteSel },
  ]);
}

async function scPickMedia(it) {
  const r = await window.api.pickMedia({});
  const f = r && r.items.find((x) => x.type === 'image' || x.type === 'video');
  if (!f) { if (r && r.items.length) flashStatus('Нужна картинка или видео'); return; }
  scItemSet(it, { url: f.url, name: it.name || f.name }, true);
}

async function scPickSource(e, on) {
  flashStatus('Ищу источники…');
  const kinds = SOURCE_KINDS.filter((k) => ['camera', 'screen', 'ndi', 'cast'].includes(k.type));
  const lists = await Promise.all(kinds.map((k) => k.find().catch(() => [])));
  const items = [];
  kinds.forEach((k, i) => {
    const l = (lists[i] || []).filter((s) => !s.noAdd);
    if (!l.length) return;
    if (items.length) items.push('-');
    items.push({ label: k.title, disabled: true, fn() {} });
    l.forEach((s) => items.push({ label: '   ' + s.label, fn: () => on({ type: s.type, id: s.id, label: s.label }) }));
  });
  if (!items.length) { flashStatus('Источники не найдены'); return; }
  flashStatus('');
  showMenu(e, items);
}

/* ----- Клавиши на вкладке ----- */

function scKey(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  const sc = scCurScene();
  if (ctrl && e.key === 'Enter' && sc) { scApply(); return true; }
  if (!sc) return false;
  // В полях ввода — их собственные клавиши (копировать текст и т. п.)
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
  if (ctrl && e.code === 'KeyA') { scSetSel(sc.items.filter((x) => !x.hidden).map((x) => x.id)); return true; }
  if (ctrl && e.code === 'KeyV') { scPaste(); return true; }
  const sel = scSelItems();
  if (!sel.length) return false;
  if (!ctrl && (e.key === 'Delete' || e.key === 'Backspace')) { scDeleteSel(); return true; }
  if (ctrl && e.code === 'KeyD') { scDupSel(); return true; }
  if (ctrl && e.code === 'KeyC') { scCopySel(); return true; }
  if (ctrl && e.code === 'KeyX') { scCopySel(); scDeleteSel(); return true; }
  if (e.key === 'Escape') { scSetSel([]); return true; }
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (d && !ctrl) {
    const m = e.shiftKey ? 10 : 1;
    for (const it of sel) if (!it.locked) { it.x += d[0] * m; it.y += d[1] * m; }
    scSceneTouch(true);
    return true;
  }
  return false;
}

/* ----- Строка над холстом ----- */

// Меню под кнопкой; у пункта может быть title — подсказка
function scMenuAt(e, items) {
  const r = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
  showMenu({ clientX: r.left, clientY: r.bottom + 2 }, items);
  const m = document.querySelector('.ctx-menu');
  const flat = items.filter((x) => x !== '-');
  if (m) [...m.children].filter((x) => !x.classList.contains('ctx-sep')).forEach((row, i) => { if (flat[i] && flat[i].title) row.title = flat[i].title; });
}
// Кнопка «Вывод: включён / выключен» — выходы экрана или сцены включаются только вручную
function scOutBtn(on, fn) {
  return scBtn(on ? 'Вывод включён' : 'Вывод выключен', on ? 'done' : 'output', fn, on ? 'Щелчок — закрыть выходы' : 'Щелчок — открыть выходы (монитор, окно, NDI)', on ? 'sc-onair' : '');
}

function scBtn(text, icon, fn, title, cls) {
  const b = scEl('button', cls || '');
  if (icon) b.dataset.icon = icon;
  if (text) b.textContent = text;
  if (title) b.title = title;
  b.addEventListener('click', fn);
  return b;
}

// Меню «▾» у магнита: к чему прилипать, шаг сетки, безопасная зона
function scSnapMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const re = () => { scSaveOpt(); scRenderBar(); scDrawOverlay(); };
  const chk = (key, label) => ({ label: (scOpt[key] ? '✓ ' : '   ') + label, fn: () => { scOpt[key] = !scOpt[key]; if (scOpt[key]) scOpt.snap = true; re(); } });
  const pick = (key, v, label, show) => ({ label: (Number(scOpt[key]) === v ? '● ' : '   ') + label, fn: () => { scOpt[key] = v; scOpt[show] = true; re(); } });
  showMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
    { label: (scOpt.snap ? '✓ ' : '   ') + 'Привязка включена', fn: () => { scOpt.snap = !scOpt.snap; re(); } },
    '-',
    { label: 'Прилипать к:', disabled: true, fn() {} },
    chk('sEdges', 'Краям и центру экрана'),
    chk('sItems', 'Другим элементам (края и центр)'),
    chk('sGrid', 'Сетке (когда она видна)'),
    chk('sSafe', 'Безопасной зоне (когда она видна)'),
    chk('sGuides', 'Направляющим'),
    '-',
    { label: 'Направляющие:', disabled: true, fn() {} },
    { label: '   ＋ Вертикальная по центру', fn: () => { const sc = scCurScene(); scGuideAdd('v', sc.w / 2); } },
    { label: '   ＋ Горизонтальная по центру', fn: () => { const sc = scCurScene(); scGuideAdd('h', sc.h / 2); } },
    { label: '   ＋ Трети (4 линии)', fn: () => { const sc = scCurScene(); scGuideAdd('v', sc.w / 3); scGuideAdd('v', (sc.w * 2) / 3); scGuideAdd('h', sc.h / 3); scGuideAdd('h', (sc.h * 2) / 3); } },
    { label: '   Убрать все', disabled: !((scCurScene() || {}).guides || []).length, fn: () => { const sc = scCurScene(); sc.guides = []; scGuidesSaved(sc); } },
    '-',
    { label: 'Шаг сетки:', disabled: true, fn() {} },
    ...[[2.5, '2,5 %'], [5, '5 %'], [10, '10 %'], [12.5, '12,5 % (8 клеток)'], [25, '25 % (4 клетки)']].map(([v, l]) => pick('gridStep', v, l, 'grid')),
    '-',
    { label: 'Безопасная зона:', disabled: true, fn() {} },
    ...[[3, '3 %'], [5, '5 %'], [10, '10 %']].map(([v, l]) => pick('safePct', v, l, 'safe')),
    '-',
    { label: 'Alt при перетаскивании — без привязки', disabled: true, fn() {} },
  ]);
}

function scRenderBar() {
  const bar = $('scBar');
  bar.replaceChildren();
  const sc = scCurScene();
  if (sc) {
    const add = scEl('span', 'te-grp');
    for (const [type, x] of Object.entries(SC_ITEMS)) if (!x.info && !x.more) add.append(scBtn('', x.icon, () => scAddItem(type), `Добавить: ${x.name} — ${x.tip}`, 'icon-only'));
    // Фигуры и инфоблоки — меню (их много)
    add.append(scBtn('Фигура', 'rect', (e) => scMenuAt(e, Object.entries(SC_ITEMS).filter(([, x]) => x.shape).map(([type, x]) => ({ label: x.name, fn: () => scAddItem(type) }))),
      'Прямоугольник, эллипс, линия, стрелка, треугольник, звезда'));
    add.append(scBtn('Инфоблок', 'stage', (e) => {
      const list = [...['cur', 'next'], ...Object.keys(SC_ITEMS).filter((k) => SC_ITEMS[k].info), 'clock', 'screen'];
      scMenuAt(e, list.map((type) => ({ label: SC_ITEMS[type].name, title: SC_ITEMS[type].tip, fn: () => scAddItem(type) })));
    }, 'Блоки, которые обновляются сами: текущий и следующий слайд, текст слайда, заметки, таймер, сообщение, аккорды, плейлист…', 'sc-info'));
    const sel = scSelItems();
    const one = sel.length === 1 ? sel[0] : null;
    const ed = scEl('span', 'te-grp');
    const b1 = scBtn('', 'front', () => one && scOrder(one, 1), 'Выше (поверх соседа)', 'icon-only');
    const b2 = scBtn('', 'back', () => one && scOrder(one, -1), 'Ниже', 'icon-only');
    const b3 = scBtn('', 'copy', () => scDupSel(), 'Дублировать (Ctrl+D)', 'icon-only');
    const b4 = scBtn('', 'trash', () => scDeleteSel(), 'Удалить (Delete)', 'icon-only');
    const b5 = scBtn('Выровнять', 'alignC', (e) => scAlignMenu(e), 'Выровнять и распределить выделенное (по сцене или друг по другу)');
    [b1, b2].forEach((b) => { b.disabled = !one; });
    [b3, b4, b5].forEach((b) => { b.disabled = !sel.length; });
    ed.append(b1, b2, b3, b4, b5);
    // Привязка, сетка, безопасная зона, направляющие — как в редакторе тем; «▾» — к чему прилипать
    const help = scEl('span', 'te-grp');
    const tog = (icon, key, title) => {
      const b = scBtn('', icon, () => { scOpt[key] = !scOpt[key]; scSaveOpt(); scRenderBar(); scDrawOverlay(); }, title, 'icon-only');
      b.setAttribute('aria-pressed', String(!!scOpt[key]));
      return b;
    };
    help.append(
      tog('magnet', 'snap', 'Привязка: прилипание к краям, центру, другим элементам, сетке, направляющим (Alt при перетаскивании — без привязки)'),
      scBtn('▾', '', scSnapMenu, 'К чему прилипать, шаг сетки, размер безопасной зоны, направляющие'),
      tog('grid', 'grid', 'Сетка'),
      tog('safe', 'safe', 'Безопасная зона'),
    );
    const ap = scEl('span', 'te-apply');
    const dirty = scDirty(sc);
    const rv = scBtn('Сбросить', '', () => scRevert(sc), 'Вернуть макет как на выходах');
    rv.disabled = !dirty;
    const ok = scBtn('Применить', 'done', () => scApply(sc), 'Отправить правки макета на выходы всех сцен с ним (Ctrl+Enter)');
    ok.disabled = !dirty;
    ap.append(rv, ok);
    bar.append(add, scEl('span', 'te-sep'), ed, scEl('span', 'te-sep'), help, ap);
  } else if (scCurSc()) {
    // Сцена: превью выхода; макет — кнопкой «Править макет»
    const c = scCurSc();
    const l = scLay(scLayoutOf(c));
    bar.append(scEl('b', 'sc-bar-name', c.name), scEl('span', 'te-sub', 'сцена' + (l ? ` · макет «${l.name}»` : ' · макет не выбран')));
    if (scLay(c.layout)) bar.append(scBtn('Править макет', 'pen', () => scPick({ kind: 'layout', id: c.layout }), 'Открыть макет этой сцены в «Пресетах сцен»'));
    bar.append(scEl('span', 'spacer'));
    for (const o of scOutsOf(scSceneSid(c))) bar.append(scBtn({ display: 'Монитор', window: 'Окно', ndi: 'NDI' }[o.kind] || o.kind, '', () => window.api.screensFocus(o.key), o.kind === 'window' ? 'Показать окно сцены' : 'Выход открыт', 'sc-chip'));
    if ((c.outputs || []).length) bar.append(scOutBtn(!!c.on, () => { c.on = !c.on; scSceneOutSet(c, true); }));
  } else {
    const s = scScreen(scSel.id);
    if (!s) return;
    bar.append(scEl('b', 'sc-bar-name', s.name), scEl('span', 'te-sub', 'программа' + (scLook(s) ? ' · своя тема' : '')));
    bar.append(scEl('span', 'spacer'));
    const outs = scOutsOf(s.id);
    if (s.id === 'main') bar.append(scOutBtn(mainOutOn(), () => mainOutSet(!mainOutOn())));
    for (const o of outs) {
      const b = scBtn({ display: 'Монитор', window: 'Окно', ndi: 'NDI' }[o.kind] || o.kind, '', () => window.api.screensFocus(o.key), o.kind === 'window' ? 'Показать окно экрана' : 'Выход открыт', 'sc-chip');
      bar.append(b);
    }
    if (s.id !== 'main' && (s.outputs || []).length) bar.append(scOutBtn(!!s.enabled, () => scScreenSet(s, { enabled: !s.enabled }, true)));
  }
  Icons.apply(bar);
}

/* ----- Свойства справа ----- */

function scSec(title, kids, open = true) {
  const d = scEl('details', 'te-sec');
  d.open = scSecOpen[title] != null ? scSecOpen[title] : open;
  d.addEventListener('toggle', () => { scSecOpen[title] = d.open; });
  d.append(scEl('summary', '', title));
  const bd = scEl('div', 'bd');
  bd.append(...kids.filter(Boolean));
  d.append(bd);
  return d;
}
function scRow(label, ...ct) {
  const r = scEl('div', 'te-row');
  r.append(scEl('span', 'lb', label));
  const c = scEl('div', 'ct');
  c.append(...ct.filter(Boolean));
  r.append(c);
  return r;
}
function scNum(v, on, o = {}) {
  const i = scEl('input');
  i.type = 'number';
  i.value = v != null ? Math.round(v * 100) / 100 : '';
  if (o.min != null) i.min = o.min;
  if (o.max != null) i.max = o.max;
  i.step = o.step || 1;
  i.addEventListener('input', () => { const x = Number(i.value); if (i.value !== '' && Number.isFinite(x)) on(x); });
  return i;
}
// Число, которое применяется только по Enter (пока печатаете — ничего не меняется и фокус не слетает); Esc или ушли из поля — как было
function scNumEnter(v, on, o = {}) {
  const i = scNum(v, () => {}, o);
  let cur = i.value;
  i.title = 'Введите число и нажмите Enter';
  i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const x = Number(i.value);
      if (i.value === '' || !Number.isFinite(x)) { i.value = cur; return; }
      const r = on(x);
      i.value = cur = r != null ? r : i.value;
    } else if (e.key === 'Escape') { e.stopPropagation(); i.value = cur; i.blur(); }
  });
  i.addEventListener('blur', () => { i.value = cur; });
  return i;
}
// Монитор выхода: самое большое разрешение, которое на него можно вывести (несколько мониторов — меньшее из них)
function scMaxOf(outputs) {
  const ds = (outputs || []).filter((o) => o.kind === 'display' && !o.off).map((o) => displays.find((d) => d.id === Number(o.display))).filter(Boolean);
  if (!ds.length) return null;
  const m = ds.map(displayMax);
  return { W: Math.min(...m.map((x) => x.W)), H: Math.min(...m.map((x) => x.H)) };
}
// Строка «Подгонка» (fit mode): как картинка своего разрешения ложится на монитор
function scFitRow(v, on) {
  return [
    scRow('Подгонка', scSelect([['fit', 'Вписать (на весь монитор)'], ['none', 'Пиксель в пиксель']], v || 'fit', on)),
    scNote(v === 'none' ? 'Картинка показывается в своём размере по центру: 2K на мониторе 4K займёт половину по ширине и высоте.'
      : 'Картинка растягивается (с сохранением пропорций) на весь монитор, даже если её разрешение меньше.'),
  ];
}
// def — значение по умолчанию: двойной щелчок по ползунку (общий обработчик в icons.js)
function scRange(v, min, max, step, on, unit = '', def) {
  const w = scEl('span', 'sc-range');
  const r = scEl('input');
  r.type = 'range';
  r.min = min; r.max = max; r.step = step; r.value = v;
  if (def != null) r.dataset.def = def;
  const out = scEl('span', 'te-sub', v + unit);
  r.addEventListener('input', () => { out.textContent = r.value + unit; on(Number(r.value)); });
  w.append(r, out);
  return w;
}
function scColor(v, on) {
  return ColorPicker.field(/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000', null, (h) => on(h));
}
function scSelect(opts, v, on) {
  const s = scEl('select');
  for (const [val, label, off] of opts) s.append(Object.assign(scEl('option', '', label), { value: val, disabled: !!off }));
  s.value = v != null ? v : '';
  s.addEventListener('change', () => on(s.value));
  return s;
}
function scCheck(label, v, on, title) {
  const l = scEl('label', 'check');
  const i = scEl('input');
  i.type = 'checkbox';
  i.checked = !!v;
  i.addEventListener('change', () => on(i.checked));
  l.append(i, document.createTextNode(label));
  if (title) l.title = title;
  return l;
}
function scText(v, on, ph) {
  const i = scEl('input');
  i.type = 'text';
  i.value = v || '';
  if (ph) i.placeholder = ph;
  i.addEventListener('change', () => on(i.value.trim()));
  return i;
}
const scNote = (text, warn) => scEl('div', 'sc-note' + (warn ? ' warn' : ''), text);

function scRenderInsp() {
  const box = $('scInsp');
  if (!scTabOn) return;
  const keep = box.scrollTop;
  box.replaceChildren();
  const it = scCurItem();
  const sc = scCurScene();
  if (scSelItems().length > 1) box.append(...scMultiInsp(scSelItems(), sc).filter(Boolean));
  else if (it) box.append(...scItemInsp(it, sc).filter(Boolean));
  else if (sc) box.append(...scLayoutInsp(sc).filter(Boolean));
  else if (scCurSc()) box.append(...scSceneInsp(scCurSc()).filter(Boolean));
  else if (scSel.kind === 'screen' && scScreen(scSel.id)) box.append(...scScreenInsp(scScreen(scSel.id)).filter(Boolean));
  Icons.apply(box);
  box.scrollTop = keep;
}

function scTitle(icon, text, sub) {
  const t = scEl('div', 'te-title');
  t.append(Icons.el(icon), scEl('b', '', text));
  if (sub) t.append(scEl('span', 'te-sub', sub));
  return t;
}

// Формат и разрешение: готовые пропорции или свои числа
// max — { W, H } монитора выхода: больше него не поставить (null — без ограничения)
function scSizeRows(obj, on, max) {
  const ok = (w, h) => !max || (w <= max.W && h <= max.H);
  const list = [...SC_FORMATS, ...SC_RES.filter((r) => !SC_FORMATS.some((f) => f[1] === r[1] && f[2] === r[2]))].filter((f) => ok(f[1], f[2]));
  if (max && !list.some((f) => f[1] === max.W && f[2] === max.H)) list.push(['монитор', max.W, max.H]);
  const key = () => (list.find((f) => f[1] === obj.w && f[2] === obj.h) ? obj.w + 'x' + obj.h : 'custom');
  const fmt = scSelect([...list.map((f) => [f[1] + 'x' + f[2], `${f[0]} — ${f[1]}×${f[2]}`]), ['custom', 'Своё разрешение']], key(), (v) => {
    const f = list.find((x) => x[1] + 'x' + x[2] === v);
    if (f) on({ w: f[1], h: f[2] }, true);
  });
  const lim = (v, m) => Math.max(16, Math.min(m || 16384, Math.round(v)));
  // Enter — применить (без перерисовки свойств: фокус остаётся в поле)
  const put = (p) => { on(p, false); fmt.value = key(); return p.w != null ? p.w : p.h; };
  const big = max && (obj.w > max.W || obj.h > max.H);
  return [
    scRow('Формат', fmt),
    scRow('Ширина × высота',
      scNumEnter(obj.w, (v) => put({ w: lim(v, max && max.W) }), { min: 16, max: max ? max.W : 16384 }),
      scEl('span', 'te-sub', '×'),
      scNumEnter(obj.h, (v) => put({ h: lim(v, max && max.H) }), { min: 16, max: max ? max.H : 16384 }),
      scBtn('⇄', '', () => on({ w: obj.h, h: obj.w }, true), 'Повернуть: поменять ширину и высоту')),
    scNote('Ширина и высота применяются по Enter.'),
    max ? scNote(`Монитор выхода — до ${max.W}×${max.H}: больше не поставить.`) : null,
    big ? scRow('', scNote(`Сейчас ${obj.w}×${obj.h} — больше монитора.`, true), scBtn('Под монитор', '', () => {
      const k = Math.min(max.W / obj.w, max.H / obj.h);
      on({ w: Math.round(obj.w * k), h: Math.round(obj.h * k) }, true);
    }, 'Уменьшить разрешение под монитор, пропорции те же')) : null,
  ].filter(Boolean);
}

// «Основной»: монитор Windows, вывод, разрешение (не больше монитора) и подгонка — settings (renderer.js: outputSize)
function scMainRows() {
  const d = mainDisplay();
  const max = displayMax(d);
  const { W, H } = outputSize();
  const changed = () => { saveSettings(); onSettingChanged('res'); scRenderInsp(); };
  const res = settings.res || 'auto';
  const list = SC_RES.filter((r) => r[1] <= max.W && r[2] <= max.H);
  if (d && !list.some((r) => r[1] === max.W && r[2] === max.H)) list.push(['монитор', max.W, max.H]);
  const opts = [['auto', d ? `Как у монитора — ${max.W}×${max.H}` : 'Как у монитора'], ...list.map((r) => [r[1] + 'x' + r[2], `${r[0]} — ${r[1]}×${r[2]}`])];
  if (res !== 'auto' && res !== 'custom' && !opts.some((o) => o[0] === res)) opts.push([res, res.replace('x', '×') + ' — больше монитора']);
  opts.push(['custom', 'Своё…']);
  const rows = [
    (() => {
      const set = (v) => { displaySel.value = v; displaySel.dispatchEvent(new Event('change')); scRenderInsp(); };
      return scRow('Монитор', scSelect(displays.length ? displays.map((x) => [String(x.id), x.label, x.here]) : [['', 'Мониторов нет']], String(displaySel.value || ''), set),
        scBtn('Схема', 'screen', () => dispPick(displaySel.value, (id) => set(String(id))), 'Выбрать монитор по расположению, как в Windows'));
    })(),
    d && d.here ? scNote('Здесь окно программы — на этот монитор выводить нельзя. Выберите другой монитор.', true) : null,
    scRow('Вывод', scOutBtn(mainOutOn(), () => mainOutSet(!mainOutOn()))),
    ...scGroupRows(scScreen('main'), false, (v) => scScreenSet(scScreen('main'), { group: v }, true)),
    scCheck('Включать вывод при запуске', !!settings.outAutoOn, (v) => { settings.outAutoOn = v; saveSettings(); },
      'При запуске сразу включается вывод на монитор (если там нет окна программы), а сцены — как были включены, когда программу закрыли'),
    scRow('Разрешение', scSelect(opts, res, (v) => {
      settings.res = v;
      if (v === 'custom') { settings.resW = Math.min(W, max.W); settings.resH = Math.min(H, max.H); }
      changed();
    })),
  ];
  if (res === 'custom') {
    rows.push(scRow('Ширина × высота',
      scNumEnter(settings.resW, (v) => { settings.resW = Math.max(320, Math.min(max.W, Math.round(v))); changed(); }, { min: 320, max: max.W }),
      scEl('span', 'te-sub', '×'),
      scNumEnter(settings.resH, (v) => { settings.resH = Math.max(240, Math.min(max.H, Math.round(v))); changed(); }, { min: 240, max: max.H })));
    rows.push(scNote(`Введите число и нажмите Enter. Не больше монитора: ${max.W}×${max.H}.`));
  }
  if (res !== 'auto') rows.push(...scFitRow(settings.outFit, (v) => { settings.outFit = v; saveSettings(); sendOutputSettings(); scRenderInsp(); }));
  rows.push(scNote(`Картинка «Основного» строится в ${W}×${H}` + (d ? `, монитор — ${max.W}×${max.H}.` : '.') + ' В этом же разрешении строятся блоки «Программа» и слайды в сценах. Разрешение самого монитора меняет Windows.'));
  return rows;
}

// Цвет: яркость, контраст, насыщенность, оттенок, гамма, температура, размытие
function scFxSec(obj, apply) {
  const fx = obj.fx || {};
  const set = (k, v) => { obj.fx = { ...(obj.fx || {}), [k]: v }; apply(false); };
  const r = (label, k, min, max, step, def, unit) => {
    const w = scRange(fx[k] != null ? fx[k] : def, min, max, step, (v) => set(k, v), unit, def);
    return scRow(label, w);
  };
  return scSec('Цвет и эффекты', [
    r('Яркость', 'b', 0, 200, 1, 100, '%'),
    r('Контраст', 'c', 0, 200, 1, 100, '%'),
    r('Насыщенность', 's', 0, 300, 1, 100, '%'),
    r('Оттенок', 'h', -180, 180, 1, 0, '°'),
    r('Гамма', 'g', 0.2, 3, 0.05, 1, ''),
    r('Температура', 'temp', -100, 100, 1, 0, ''),
    r('Зелёный ↔ пурпур', 'tint', -100, 100, 1, 0, ''),
    r('Размытие', 'blur', 0, 40, 0.5, 0, ' px'),
    r('Ч/б', 'gray', 0, 100, 1, 0, '%'),
    r('Сепия', 'sepia', 0, 100, 1, 0, '%'),
    scCheck('Инверсия цветов', !!fx.inv, (v) => set('inv', v)),
    scRow('', scBtn('Сбросить цвет', '', () => { obj.fx = {}; apply(true); })),
  ], false);
}

function scLayerChecks(cur, on) {
  const defs = layerDefs();
  const all = !Array.isArray(cur);
  const wrap = scEl('div', 'sc-checks');
  wrap.append(scCheck('Все слои', all, (v) => on(v ? null : defs.map((l) => l.id)), 'Всё, что выводится'));
  if (!all) for (const l of [...defs].reverse()) {
    wrap.append(scCheck(layerName(l), cur.includes(l.id), (v) => on(v ? [...new Set([...cur, l.id])] : cur.filter((x) => x !== l.id))));
  }
  return wrap;
}

function scTransRows(tr, on, none) {
  const t = tr && tr.type ? tr : null;
  return [
    scRow('Переход', scSelect([...(none ? [['', none]] : []), ...SC_TRANS], t ? t.type : '', (v) => on(v ? { type: v, ms: t ? t.ms : 600 } : null, true))),
    t && t.type !== 'none' ? scRow('Время', scRange(t.ms || 600, 100, 3000, 100, (v) => on({ ...t, ms: v }), ' мс', 600)) : null,
  ];
}

// Карточки выходов: монитор/проектор (HDMI, SDI, DisplayPort — всё, что Windows видит монитором), окно, NDI.
// sid — id экрана в окнах выходов (у сцены — 'scene:id'), put(list, re) — сохранить список, added() — после «＋ Выход»
function scOutputRows(sid, name, outs, put, added) {
  const rows = [];
  outs.forEach((o, i) => {
    const setO = (p, re) => put(outs.map((x, j) => (j === i ? { ...x, ...p } : x)), re);
    const card = scEl('div', 'sc-out');
    const open = scOutsOf(sid).some((x) => x.key.startsWith(`${sid}|${i}|`));
    const head = scEl('div', 'te-row');
    const kind = scSelect([['display', 'Монитор / проектор (HDMI, SDI, DP)'], ['window', 'Окно на рабочем столе'], ['ndi', 'NDI-выход в сеть']], o.kind, (v) => setO({ kind: v }, true));
    const rm = scBtn('', 'trash', () => put(outs.filter((_, j) => j !== i), true), 'Убрать выход', 'icon-only');
    const st = scEl('span', 'dot' + (open ? ' on' : ''));
    st.title = open ? 'Открыт' : 'Закрыт';
    head.append(st, kind, rm);
    card.append(head);
    if (o.kind === 'display') {
      const opts = displays.map((d) => [String(d.id), d.label + (d.hz ? ` · ${d.hz} Гц` : ''), d.here]);
      const setD = (v) => setO({ display: Number(v), dkey: dispKey(displays.find((d) => d.id === Number(v))) });
      card.append(scRow('Монитор', scSelect(opts.length ? opts : [['', 'Мониторов нет']], String(o.display || ''), setD),
        scBtn('Схема', 'screen', () => dispPick(o.display, setD), 'Выбрать монитор по расположению, как в Windows')));
      // Сам выход выключен (галочка, сцена или экран выключены) — он никому не мешает, не предупреждаем
      const sc = sid.startsWith('scene:') ? lib.scenes.find((x) => scSceneSid(x) === sid) : null;
      const z = sc ? null : scScreen(sid);
      const on = !o.off && (sc ? !!sc.on : sid === 'main' ? mainOutOn() : !!(z && z.enabled));
      const busy = on ? scDisplayBusy(Number(o.display), sid, i) : [];
      if (busy.length) card.append(scNote('Этот монитор уже занят: ' + busy.join(', ') + '. Окна лягут друг на друга.', true));
      if ((displays.find((d) => d.id === Number(o.display)) || {}).here) card.append(scNote('Здесь окно программы — на этот монитор выводить нельзя, выход не откроется. Выберите другой монитор.', true));
      if (!displays.some((d) => d.id === Number(o.display))) card.append(scNote('Монитор не подключён — выход откроется, когда он появится.', true));
      card.append(scNote('SDI (Blackmagic DeckLink и т. п.) — выберите карту здесь, если в Windows она видна как монитор (Desktop Video → «Использовать как монитор»).'));
    } else if (o.kind === 'ndi') {
      card.append(scRow('Имя в сети', scText(o.name, (v) => setO({ name: v }), `MP Show — ${name}`)));
      if (!Scene.LIVE.ndi) card.append(scNote('Для NDI-выхода установите бесплатные NDI Tools (ndi.video) и перезапустите программу.', true));
      else card.append(scNote('Принимать — в OBS, vMix, NDI Studio Monitor. Звук по NDI пока не идёт.'));
    } else {
      card.append(scNote('Окно можно растянуть, перенести на любой монитор или захватить в OBS. Закрыли окно — откроется снова при следующей правке.'));
    }
    card.append(scCheck('Выход включён', !o.off, (v) => setO({ off: !v })));
    rows.push(card);
  });
  rows.push(scRow('', scBtn('＋ Выход', '', () => {
    // Новый выход: второй монитор (не главный), а если его нет — окно. У сцены — выключенным (у экрана есть общий «Вывод»)
    const free = displays.find((d) => !d.here && !d.primary) || displays.find((d) => !d.here);
    put([...outs, { kind: free ? 'display' : 'window', display: free ? free.id : undefined, dkey: free ? dispKey(free) : undefined, ...(sid.startsWith('scene:') ? { off: true } : {}) }], true);
    if (added) added();
  }, 'Добавить выход: монитор (HDMI, SDI), окно или NDI')));
  return rows;
}

// Кто ещё выводит на этот монитор (кроме выхода i у sid). Считаются только включённые: экран — enabled, сцена — on, выход — не off
function scDisplayBusy(display, sid, i) {
  const busy = [];
  if (outputOpen && display === Number(displaySel.value)) busy.push('«Основной» (зал)');
  for (const z of lib.screens) (z.outputs || []).forEach((y, j) => { if (z.enabled && !y.off && y.kind === 'display' && Number(y.display) === display && !(z.id === sid && j === i)) busy.push(`«${z.name}»`); });
  for (const sc of lib.scenes) (sc.outputs || []).forEach((y, j) => { if (sc.on && !y.off && y.kind === 'display' && Number(y.display) === display && !(scSceneSid(sc) === sid && j === i)) busy.push(`сцена «${sc.name}»`); });
  return busy;
}

// Прозрачный фон экрана / альфа-канал сцены (s.alpha): фона темы, шаблонов и сцены нет — остаются текст, фигуры, фото и видео.
// В «Предпросмотре» — шахматка, внутри сцены (блок «Экран») — просвечивает, NDI — с альфой, окно — прозрачное без рамки, монитор — чёрный
function scAlphaRows(on, fn, label = 'Прозрачный фон') {
  return [
    scCheck(label, on, fn, 'Видно только текст и элементы, остальное прозрачное: для наложения на другой экран, NDI в OBS / vMix'),
    ...(on ? [scNote('Фон темы, шаблона и сцены убран — остаются текст, фигуры, фото и видео. В «Предпросмотре» прозрачное — шахматкой; внутри сцены (блок «Экран») сквозь него видно то, что ниже. '
      + 'NDI-выход — с альфа-каналом. Выход «Окно» — прозрачное окно без рамки (переносится мышью за любое место, размер не меняется). На мониторе прозрачности нет — там чёрный.')] : []),
  ];
}

function scScreenInsp(s) {
  const set = (patch, re) => scScreenSet(s, patch, re);
  const main = s.id === 'main';
  const out = [scTitle('screens', s.name, main ? 'основной · программа' : 'программа')];
  if (main) out.push(scSec('Монитор и разрешение', scMainRows().filter(Boolean)));
  out.push(scSec('Экран', [
    scRow('Название', scText(s.name, (v) => v && set({ name: v }))),
    ...(main ? [] : scSizeRows(s, (p, re) => set(p, re !== false), scMaxOf(s.outputs))),
    scRow('Частота', scSelect([['0', 'Как у выхода'], ['24', '24 кадр/с'], ['25', '25'], ['30', '30'], ['50', '50'], ['60', '60']], String(s.hz || 0), (v) => set({ hz: Number(v) }))),
    scNote('Частоту монитора меняет Windows (Параметры → Дисплей); здесь она задаёт NDI-выход.'),
  ]));
  // Выходы
  const rows = [];
  if (main) rows.push(scNote('Главный выход — монитор выше. Ниже — дополнительные: тот же экран ещё на проектор, в окно или NDI. Кнопка «Вывод» выше включает их все вместе с монитором.'));
  // Включить/выключить вывод — только вручную (новый выход экран не включает)
  if (!main && (s.outputs || []).length) rows.push(scRow('Вывод', scOutBtn(!!s.enabled, () => set({ enabled: !s.enabled }, true))), ...scGroupRows(s, false, (v) => set({ group: v }, true)));
  rows.push(...scOutputRows(s.id, s.name, s.outputs || [], (list, re) => { s.outputs = list; set({}, re); }));
  if (!(s.outputs || []).length && !main) rows.push(scNote('Выходов нет — экран виртуальный: его можно показывать в «Предпросмотре», в отдельном окне и внутри сцен (блок «Экран»).'));
  if (!main && (s.outputs || []).length) rows.push(...scFitRow(s.outFit, (v) => set({ outFit: v }, true)));
  out.push(scSec('Выходы', rows));
  // Что идёт: слои и тема
  const th = lib.themes || [];
  const t = s.theme && typeof themeById === 'function' ? themeById(s.theme) : null;
  const tpls = t && Array.isArray(t.templates) ? t.templates : [];
  const cont = [
    scRow('Слои', scLayerChecks(s.layers, (v) => set({ layers: v }, true))),
    scNote('Какие слои программы идут на этот экран. Например, на трансляцию — только «Презентации» (текст без фона).'),
    ...scAlphaRows(!!s.alpha, (v) => set({ alpha: v }, true)),
    scRow('Тема', scSelect([['', 'Как у слайдов (обычные темы)'], ...th.map((x) => [x.id, x.name || 'Тема'])], s.theme || '', (v) => set({ theme: v, themeTpl: '' }, true))),
    t && tpls.length > 1 ? scRow('Шаблон', scSelect([['', 'По виду: песня, Библия…'], ...tpls.map((x) => [x.id, x.name || 'Шаблон'])], s.themeTpl || '', (v) => set({ themeTpl: v }))) : null,
    scNote(t ? `Все тексты на этом экране — песни, Библия, текстовые слайды — в оформлении темы «${t.name}», в её текстовом окне. Фото, видео и PowerPoint — как есть.`
      : 'Своя тема экрана: все тексты программы (песни, Библия) встанут в текстовое окно этой темы — как «Look» в ProPresenter. Другие экраны не меняются.'),
    t ? scRow('', scBtn('Открыть тему', 'theme', () => { const d = document.querySelector('dialog[open]'); if (d) d.close(); openThemeTab(t.id); })) : null,
  ];
  if (!main) cont.push(scRow('Размер', scSelect([['native', 'Своё разрешение (текст подстроится)'], ['contain', 'Вписать «Основной»'], ['cover', 'Заполнить «Основным» (обрезать)'], ['stretch', 'Растянуть «Основной»']], s.fit || 'native', (v) => set({ fit: v }))));
  cont.push(scCheck('Рисунок поверх слайда', s.ink !== false, (v) => set({ ink: v })));
  if (!main) cont.push(scCheck('Звук видео и источников', !!s.sound, (v) => set({ sound: v }), 'Обычно звук идёт только с «Основного» — иначе будет эхо'));
  cont.push(...scTransRows(s.trans, (v, re) => set({ trans: v }, re), 'Как в программе'));
  out.push(scSec('Что идёт на экран', cont.filter(Boolean)));
  out.push(scSec('Поворот и отражение', [
    scRow('Поворот', scSelect([['0', 'Нет'], ['90', '90° по часовой'], ['180', '180°'], ['270', '90° против часовой']], String(s.rotate || 0), (v) => set({ rotate: Number(v) }))),
    scCheck('Отразить по горизонтали (обратная проекция)', s.flipX, (v) => set({ flipX: v })),
    scCheck('Отразить по вертикали', s.flipY, (v) => set({ flipY: v })),
    scNote('Поворот и отражение — только на выходах; превью здесь — без них.'),
  ], false));
  out.push(scFxSec(s, (re) => set({}, re)));
  return out;
}

// Свойства СЦЕНЫ — только выход: разрешение, фон, выходы, альфа-канал, частота и какой макет. Всё — сразу на выходы
function scSceneInsp(sc) {
  const set = (patch, re) => { Object.assign(sc, patch); scSceneOutSet(sc, re); };
  const has = (sc.outputs || []).length > 0;
  const own = scLay(sc.layout);
  const now = scLayoutOf(sc);
  const clear = sc.bg === 'transparent';
  const newLay = (k) => scUseLayout(scAddLayout(scLayoutFrom(scTemplate(k)), false), sc);
  return [
    scTitle('scene', sc.name, 'сцена = выход + макет'),
    scSec('Сцена', [
      scRow('Название', scText(sc.name, (v) => v && set({ name: v }, false))),
      ...scSizeRows(sc, (p, re) => set(p, re !== false), scMaxOf(sc.outputs)),
      scRow('Фон', scSelect([['color', 'Цвет'], ['transparent', 'Прозрачный']], clear ? 'transparent' : 'color', (v) => set({ bg: v === 'transparent' ? 'transparent' : '#000000' }, true)),
        clear ? null : scColor(sc.bg || '#000000', (v) => set({ bg: v }))),
      clear && !sc.alpha ? scNote('Фон прозрачный. Чтобы прозрачность ушла в NDI или окно — включите «Альфа-канал» ниже; на мониторе прозрачное — чёрное.') : null,
      scRow('Частота', scSelect([['0', '30 кадр/с'], ['24', '24'], ['25', '25'], ['50', '50'], ['60', '60']], String(sc.hz || 0), (v) => set({ hz: Number(v) }, false))),
      scNote('Частота — для NDI-выхода; частоту монитора меняет Windows (Параметры → Дисплей).'),
    ].filter(Boolean)),
    scSec('Макет', [
      scRow('Макет', scSelect([['', '— не выбран —'], ...scPresets().map((p) => [p.id, p.name || 'Макет'])], own ? own.id : '', (v) => { delete scAuto[sc.id]; set({ layout: v }, true); })),
      scRow('', own ? scBtn('Править макет', 'pen', () => scPick({ kind: 'layout', id: own.id }), 'Открыть макет в «Пресетах сцен»') : null,
        scBtn(own ? 'Новый…' : 'Новый макет…', 'add', (e) => scMenuAt(e, scTplMenu(newLay)), 'Новый макет из шаблона — сразу в эту сцену')),
      scNote('Макеты (что и где на экране) настраиваются в «Пресетах сцен» слева. Один макет можно поставить в несколько сцен; если его размер другой — он впишется.'),
      scCheck('Менять макет по слайдам', !!sc.follow, (v) => { if (!v) delete scAuto[sc.id]; set({ follow: v }, true); },
        'Слайд или презентация с выбранным макетом (правая кнопка в ленте → «Макет сцены…») включает его на выходах этой сцены'),
      sc.follow || now !== (sc.layout || '') ? scRow('Сейчас', scLayoutPick(sc)) : null,
      now !== (sc.layout || '') ? scNote(`На выходах сейчас макет «${(scLay(now) || {}).name}» (по слайду, панели «Сцена» или макросу). Вернуть свой — выберите «Свой».`) : null,
    ].filter(Boolean)),
    scSec('Выход', [
      scNote('Куда идёт сцена: монитор или телевизор на сцене (HDMI, SDI), окно или NDI в сеть.'),
      has ? scRow('Вывод', scOutBtn(!!sc.on, () => set({ on: !sc.on }, true))) : null,
      ...(has ? scGroupRows(sc, true, (v) => set({ group: v }, true)) : []),
      ...scOutputRows(scSceneSid(sc), sc.name, sc.outputs || [], (list, re) => set({ outputs: list }, re)),
      ...(has ? scFitRow(sc.outFit, (v) => set({ outFit: v }, true)) : []),
      has ? scCheck('Звук элементов сцены', !!sc.outSound, (v) => set({ outSound: v }, false), 'Обычно звук идёт только с «Основного» — иначе будет эхо') : null,
      ...scAlphaRows(!!sc.alpha, (v) => set({ alpha: v }, true), 'Альфа-канал (прозрачный фон)'),
    ].filter(Boolean)),
  ];
}

// Свойства МАКЕТА («Пресеты сцен»): размер, фон, переход, слои; элементы — на холсте. Черновик до «Применить»
function scLayoutInsp(l) {
  const set = (patch, re) => { Object.assign(l, patch); scSceneTouch(re); };
  const users = scUsers(l);
  return [
    scTitle('presets', l.name, scDirty(l) ? 'есть правки' : 'макет'),
    scSec('Макет', [
      scRow('Название', scText(l.name, (v) => { if (v) { l.name = v; saveLib(); scRenderLists(); scRenderBar(); } })),
      ...scSizeRows(l, (p, re) => set(p, re)),
      scRow('Фон', scSelect([['', 'Нет — фон сцены'], ['color', 'Свой цвет']], l.bg ? 'color' : '', (v) => set({ bg: v ? '#000000' : undefined }, true)),
        l.bg ? scColor(l.bg, (v) => set({ bg: v })) : null),
      ...scTransRows(l.trans, (v, re) => set({ trans: v }, re)),
      scRow('Слои', scLayerChecks(l.layers, (v) => set({ layers: v }, true))),
      scNote('Какие слои программы видны в блоках «Программа» этого макета (если у блока не выбраны свои).'),
      scNote('Элементы — кнопками над холстом или перетащите файл из Проводника. На выходы — после «Применить» (Ctrl+Enter).'),
    ].filter(Boolean)),
    scSec('Где стоит', [
      users.length ? scNote('В сценах: ' + users.map((x) => `«${x.name}»`).join(', ') + '.') : scNote('Пока ни в одной сцене. Поставить — правая кнопка по макету слева или «Макет» в свойствах сцены.'),
      ...users.map((x) => scRow('', scBtn(`Сцена «${x.name}»`, 'scene', () => scPick({ kind: 'scene', id: x.id }), 'Открыть свойства сцены'))),
      scRow('', scBtn('Новая сцена с этим макетом', 'add', () => scAddScene(scNewScene(l)))),
    ]),
    scSec('Файл', [
      scRow('Файл', scBtn('Сохранить…', 'export', () => scExport(l)), scBtn('Загрузить…', 'import', scImport)),
    ], false),
  ];
}

// Шрифт и вид текста: у надписи, часов и инфоблоков
function scTextRows(it, set) {
  const fonts = [...Object.entries(Scene.FONT_NAMES), ...Scene.fontsList().map((f) => [f.family, f.family])];
  const fm = ['none', 'shrink', 'grow', 'both'].includes(it.tfit) ? it.tfit : (['text', 'clock'].includes(it.type) ? it.auto : it.auto !== false) ? 'shrink' : 'none';
  return [
    scRow('Шрифт', scSelect(fonts.filter((f, i, a) => a.findIndex((x) => x[0] === f[0]) === i), it.font || 'segoe', (v) => set({ font: v }))),
    scRow(fm === 'none' || fm === 'both' ? 'Размер' : fm === 'grow' ? 'Размер (наименьший)' : 'Размер (наибольший)', scNum(it.size || 64, (v) => set({ size: Math.max(4, v) }), { min: 4, max: 2000 }),
      scCheck('Ж', it.bold, (v) => set({ bold: v }), 'Жирный'), scCheck('К', it.italic, (v) => set({ italic: v }), 'Курсив')),
    scRow('Не помещается', scSelect([['none', 'Как задано'], ['shrink', 'Уменьшать'], ['grow', 'Увеличивать до заполнения'], ['both', 'Подгонять в пределах']], fm, (v) => set({ tfit: v }, true))),
    fm === 'shrink' || fm === 'both' ? scRow('Не меньше', scNum(it.minSize || 14, (v) => set({ minSize: Math.max(4, v) }), { min: 4, max: 400 }), scEl('span', 'te-sub', 'px')) : null,
    fm === 'grow' || fm === 'both' ? scRow('Не больше', scNum(it.maxSize || 400, (v) => set({ maxSize: Math.max(4, v) }), { min: 4, max: 2000 }), scEl('span', 'te-sub', 'px')) : null,
    scRow('Выравнивание', scSelect([['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа'], ['justify', 'По ширине']], it.align || 'center', (v) => set({ align: v })),
      scSelect([['top', 'Сверху'], ['middle', 'Посередине'], ['bottom', 'Снизу']], it.valign || 'middle', (v) => set({ valign: v }))),
    scRow('Насыщенность', scSelect([['', 'Как «Ж»'], ['100', 'Сверхтонкий'], ['200', 'Очень тонкий'], ['300', 'Тонкий'], ['400', 'Обычный'], ['500', 'Средний'], ['600', 'Полужирный'], ['700', 'Жирный'], ['800', 'Очень жирный'], ['900', 'Чёрный']], String(it.weight || ''), (v) => set({ weight: v ? Number(v) : 0 })),
      scCheck('Ч', it.underline, (v) => set({ underline: v }), 'Подчёркнутый'), scCheck('З', it.strike, (v) => set({ strike: v }), 'Зачёркнутый')),
    scRow('Регистр', scSelect([['', 'Как написано'], ['upper', 'ВСЕ ЗАГЛАВНЫЕ'], ['lower', 'все строчные'], ['title', 'Каждое Слово С Заглавной']], it.case || '', (v) => set({ case: v }))),
    scRow('Межстрочный', scRange(it.lineH || 1.2, 0.7, 2.5, 0.05, (v) => set({ lineH: v }), '', 1.2), scEl('span', 'te-sub', 'буквы'), scNum(it.spacing || 0, (v) => set({ spacing: v }), { min: -20, max: 100 })),
    scRow('Поля внутри', scNum(it.pad || 0, (v) => set({ pad: Math.max(0, v) }), { min: 0, max: 400 }), scEl('span', 'te-sub', 'px')),
  ];
}

// Цвет букв, градиент, обводка, тень, подложка, бегущая строка — как в редакторе тем
function scTextLookSecs(it, set) {
  const gradOk = it.type === 'text' || it.type === 'clock';
  const tg = it.tgrad || {};
  const tgSet = (k, v, re) => { scSub(it, 'tgrad', k, v); scSceneTouch(re); };
  const run = it.run || {};
  const runSet = (k, v, re) => { scSub(it, 'run', k, v); scSceneTouch(re); };
  const op = (v, on) => scRange(v != null ? v : 100, 0, 100, 1, on, '%', 100);
  const secs = [
    scSec('Цвет и заливка текста', [
      scRow('Цвет', scColor(it.color || '#ffffff', (v) => set({ color: v })), op(it.colorO, (v) => set({ colorO: v }))),
      gradOk ? scRow('Градиент', scCheck('', !!tg.on, (v) => tgSet('on', v, true), 'Буквы переливаются от «Цвета» ко второму цвету')) : null,
      gradOk && tg.on ? scRow('Второй цвет', scColor(tg.c2 || '#ffd27a', (v) => tgSet('c2', v)), scCheck('из центра', !!tg.radial, (v) => tgSet('radial', v, true))) : null,
      gradOk && tg.on && !tg.radial ? scRow('Угол', scRange(tg.a != null ? tg.a : 90, 0, 360, 1, (v) => tgSet('a', v), '°', 90)) : null,
    ], true),
    scSec('Обводка текста', [
      scRow('Толщина', scRange(it.stroke || 0, 0, 40, 0.5, (v) => set({ stroke: v }), ' px', 0)),
      scRow('Цвет', scColor(it.strokeC || '#000000', (v) => set({ strokeC: v })), op(it.strokeO, (v) => set({ strokeO: v }))),
      scCheck('Снаружи букв (не делает буквы тоньше)', !!it.strokeOut, (v) => set({ strokeOut: v })),
    ], (it.stroke || 0) > 0),
    scSec('Тень текста', [
      scRow('', scCheck('тень', !!it.tshadow, (v) => set({ tshadow: v }, true))),
      ...(it.tshadow ? [
        scRow('Цвет', scColor(it.tshadowC || '#000000', (v) => set({ tshadowC: v })), op(it.tshadowO != null ? it.tshadowO : 70, (v) => set({ tshadowO: v }))),
        scRow('Размытие', scRange(it.tshadowB != null ? it.tshadowB : 8, 0, 80, 1, (v) => set({ tshadowB: v }), ' px', 8)),
        scRow('Сдвиг X, Y', scNum(it.tshadowX || 0, (v) => set({ tshadowX: v }), { min: -200, max: 200 }), scNum(it.tshadowY != null ? it.tshadowY : 2, (v) => set({ tshadowY: v }), { min: -200, max: 200 })),
      ] : []),
    ], !!it.tshadow),
    scSec('Подложка под текстом', [
      scRow('', scCheck('подложка', !!it.bg, (v) => set({ bg: v ? '#000000' : '' }, true))),
      ...(it.bg ? [
        scRow('Цвет', scColor(it.bg, (v) => set({ bg: v })), op(it.bgO, (v) => set({ bgO: v }))),
        scRow('Скругление', scNum(it.bgR || 0, (v) => set({ bgR: Math.max(0, v) }), { min: 0, max: 400 }), scEl('span', 'te-sub', 'px')),
        scNote('Размыть то, что под подложкой, — «Эффекты фона под элементом» ниже.'),
      ] : []),
    ], !!it.bg),
  ];
  if (it.type === 'text') {
    secs.push(scSec('Бегущая строка', [
      scRow('', scCheck('текст бежит', !!run.on, (v) => runSet('on', v, true))),
      ...(run.on ? [
        scRow('Куда', scSelect([['left', '← Влево (в одну строку)'], ['up', '↑ Вверх (титры)']], run.dir || 'left', (v) => runSet('dir', v))),
        scRow('Скорость', scRange(run.speed || 120, 10, 1000, 10, (v) => runSet('speed', v), ' px/с', 120)),
        scRow('Растворение', scRange(run.fade != null ? run.fade : 6, 0, 30, 1, (v) => runSet('fade', v), '%', 6)),
      ] : []),
    ], !!run.on));
  }
  return secs;
}

// Настройки инфоблоков сценического экрана
function scInfoRows(it, set) {
  const out = [];
  const st = typeof stApi === 'object' ? stApi : null; // stage.js: таймеры, сообщение, запись
  const time = (over) => [
    scRow('Вид', scSelect([['auto', '05:00 или 1:05:00'], ['ms', 'мм:сс (65:00)'], ['hms', 'чч:мм:сс']], it.fmt || 'auto', (v) => set({ fmt: v }))),
    scRow('Подпись', scText(it.prefix, (v) => set({ prefix: v }), 'например: До начала')),
    scRow('Предупредить за', scNum(it.warn != null ? it.warn : 60, (v) => set({ warn: Math.max(0, v) }), { min: 0, max: 36000 }), scEl('span', 'te-sub', 'с'), scColor(it.warnC || '#f5a524', (v) => set({ warnC: v }))),
    scRow('Время вышло', scColor(it.overC || '#ff4d4f', (v) => set({ overC: v })), over ? scCheck('Считать дальше (−0:12)', it.over !== false, (v) => set({ over: v })) : null),
  ];
  switch (it.type) {
    case 'curText': case 'nextText':
      out.push(scCheck('Подпись части сверху (Куплет 1, Припев)', !!it.label, (v) => set({ label: v })));
      out.push(scNote(it.type === 'curText' ? 'Текст слайда, который сейчас на экране: песня, стих (со ссылкой), свой слайд.' : 'Текст следующего слайда плейлиста.'));
      break;
    case 'notes': out.push(scNote('Заметка к слайду: правой кнопкой по слайду в ленте → «Заметка к слайду…». Зрители её не видят.')); break;
    case 'opnote': out.push(scNote('Заметка к презентации — «?» у пункта в «Содержании». Видна, пока идут слайды этой презентации.')); break;
    case 'msg':
      out.push(scCheck('Мигать, когда приходит новое', it.blink !== false, (v) => set({ blink: v })));
      out.push(scNote('Сообщение пишет оператор: кнопка «Сцена» под предпросмотром или макрос «Сообщение на сцену».'));
      if (st) out.push(scRow('', scBtn('Написать…', 'message', async () => { const t = await askName('Сообщение для сцены', st.msg()); if (t != null) st.setMsg(t); }), scBtn('Убрать', '', () => st.setMsg(''))));
      break;
    case 'plist': out.push(scRow('Показывать', scSelect([['both', 'Сейчас и далее'], ['cur', 'Только что сейчас'], ['next', 'Только что далее']], it.show || 'both', (v) => set({ show: v })))); break;
    case 'part':
      out.push(scRow('Показывать', scSelect([['cur', 'Часть, которая идёт'], ['both', 'Идёт и следующая'], ['next', 'Только следующая']], it.show || 'cur', (v) => set({ show: v }, true))));
      if ((it.show || 'cur') === 'both') out.push(scRow('Расположение', scSelect([['col', 'Одна под другой'], ['row', 'В строку (→)']], it.dir === 'row' ? 'row' : 'col', (v) => set({ dir: v }))));
      out.push(scCheck('С номером (Куплет 1, Куплет 2)', it.num !== false, (v) => set({ num: v }), 'Без галочки — только «Куплет»'));
      out.push(scRow('Цвет части', scSelect([['', 'Нет — как в «Тексте»'], ['bg', 'Подложка'], ['text', 'Буквы']], it.pcol || '', (v) => set({ pcol: v }, true)),
        typeof openPartTypes === 'function' ? scBtn('Цвета…', 'parts', () => openPartTypes(), 'Типы частей песни: название и цвет') : null));
      out.push(scRow('Подпись', scText(it.prefix, (v) => set({ prefix: v }), 'например: Сейчас')));
      out.push(scNote('Часть — это подпись слайда песни: [Куплет 1], [Припев], [Проигрыш] в окне песни. Цвет — у типа части (окно песни → «Типы…»). У стихов Библии, медиа и слайдов без подписи — пусто.'));
      break;
    case 'queue': {
      const kinds = Array.isArray(it.kinds) ? it.kinds : null;
      const kindSet = (k, on) => {
        const now = new Set(kinds || SC_QKINDS.map((x) => x[0]));
        if (on) now.add(k); else now.delete(k);
        set({ kinds: now.size === SC_QKINDS.length ? undefined : SC_QKINDS.map((x) => x[0]).filter((x) => now.has(x)) }, true);
      };
      const grid = scEl('div', 'sc-kinds');
      for (const [k, name] of SC_QKINDS) grid.append(scCheck(name, !kinds || kinds.includes(k), (v) => kindSet(k, v)));
      out.push(scRow('Что показывать', grid));
      out.push(scRow('Из библиотеки', scSelect([['', 'Любой'], ...lib.libraries.map((l) => [l.id, l.name])], it.lib && lib.libraries.some((l) => l.id === it.lib) ? it.lib : '', (v) => set({ lib: v || undefined }))));
      const cnt = [[0, 'нет'], [1, '1'], [2, '2'], [3, '3'], [5, '5'], [10, '10'], [-1, 'все']];
      out.push(scRow('Прошедших', scSelect(cnt.map(([v, n]) => [String(v), n]), String(it.past != null ? it.past : 1), (v) => set({ past: Number(v) })),
        scEl('span', 'te-sub', 'следующих'), scSelect(cnt.filter(([v]) => v).map(([v, n]) => [String(v), n]), String(it.ahead != null ? it.ahead : 3), (v) => set({ ahead: Number(v) }))));
      out.push(scRow('Расположение', scSelect([['col', 'Столбик (сверху вниз)'], ['row', 'Полоска (в строку →)']], it.dir === 'row' ? 'row' : 'col', (v) => set({ dir: v }))));
      out.push(scRow('Что идёт', scColor(it.curC || '#ffd84a', (v) => set({ curC: v })), scCheck('▶', it.mark !== false, (v) => set({ mark: v }), 'Значок ▶ перед тем, что идёт')));
      out.push(scCheck('Зачёркивать прошедшие', it.strike2 !== false, (v) => set({ strike2: v })));
      out.push(scCheck('Номера (1. 2. 3.)', !!it.nums, (v) => set({ nums: v })));
      out.push(scRow('Заголовок', scText(it.title, (v) => set({ title: v }), 'например: Очередь')));
      out.push(scNote('Пункты плейлиста, из которого показали последний слайд (до первого показа — рабочий плейлист). Что идёт — подсвечено, прошедшие — зачёркнуты. Листание другого плейлиста очередь не меняет.'));
      break;
    }
    case 'count':
      out.push(scRow('Вид', scSelect([['nt', '3 / 12'], ['n', 'только номер']], it.fmt === 'n' ? 'n' : 'nt', (v) => set({ fmt: v }))));
      out.push(scRow('Подпись', scText(it.prefix, (v) => set({ prefix: v }), 'например: Слайд')));
      break;
    case 'chords':
      out.push(scRow('Цвет аккордов', scColor(it.chordC || '#ffd84a', (v) => set({ chordC: v }))));
      out.push(scCheck('И следующий слайд (бледнее)', !!it.nextToo, (v) => set({ nextToo: v })));
      out.push(scNote('Аккорды — в окне песни, поле «Аккорды для сцены»: [Am]Слава [G]Богу или аккорды строкой над словами. Из ChordPro подставляются сами.'));
      break;
    case 'timer': {
      const list = st ? st.timers() : [];
      out.push(scRow('Таймер', list.length ? scSelect(list.map((t) => [t.id, t.name]), it.ref || '', (v) => set({ ref: v }, true)) : scEl('span', 'te-sub', 'таймеров нет'),
        st ? scBtn('＋', '', () => set({ ref: st.newTimer() }, true), 'Новый таймер') : null));
      if (st && it.ref && list.some((t) => t.id === it.ref)) out.push(scRow('', scBtn('▶ ❚❚', '', () => st.toggle(it.ref), 'Пуск / пауза'), scBtn('Сброс', '', () => st.reset(it.ref), 'Сначала'), scBtn('Время…', '', () => st.editTimer(it.ref), 'Сколько минут отсчитывать')));
      out.push(...time(true));
      out.push(scNote('Таймерами управляет оператор: кнопка «Сцена» под предпросмотром, макрос «Таймер».'));
      break;
    }
    case 'countdown': {
      const inp = scEl('input');
      inp.type = 'time';
      inp.value = /^\d{1,2}:\d{2}$/.test(it.to || '') ? String(it.to).padStart(5, '0') : '10:00';
      inp.addEventListener('change', () => inp.value && set({ to: inp.value }));
      out.push(scRow('До времени', inp));
      out.push(...time(true));
      break;
    }
    case 'vcd':
      out.push(scRow('Показывать', scSelect([['left', 'Сколько осталось'], ['elapsed', 'Сколько прошло']], it.show === 'elapsed' ? 'elapsed' : 'left', (v) => set({ show: v }))));
      out.push(...time(false));
      out.push(scNote('Видео, которое сейчас на экране (слой «Медиа» и другие). На паузе цифры бледнее.'));
      break;
    case 'cap':
      out.push(scNote('Запись и трансляцию программа сама не ведёт (это OBS, vMix…) — отмечает оператор кнопками в панели «Сцена». Ещё показывается, сколько открыто NDI-выходов.'));
      if (st) out.push(scRow('', scBtn(st.cap().rec ? '■ Запись идёт' : '● Запись', '', () => { st.toggleCap('rec'); scRenderInsp(); }), scBtn(st.cap().live ? '■ Эфир идёт' : '● Эфир', '', () => { st.toggleCap('live'); scRenderInsp(); })));
      break;
    default: break;
  }
  out.push(scCheck('Скрывать, когда пусто', !!it.hideEmpty, (v) => set({ hideEmpty: v }), 'Нет данных — блока (и его подложки) не видно'));
  return out;
}

// Выделено несколько: выравнивание, общие прозрачность, видимость, закрепление; текстовым — общий шрифт и цвет
function scMultiInsp(sel, sc) {
  const all = (patch, re) => { sel.forEach((x) => Object.assign(x, patch)); scSceneTouch(re); };
  const ab = (how, icon, title, scene) => scBtn('', icon, () => scAlign(how, scene), title, 'icon-only');
  const texty = sel.filter((x) => SC_TEXTY.includes(x.type));
  const shapes = sel.filter((x) => SC_ITEMS[x.type].shape);
  const fonts = [...Object.entries(Scene.FONT_NAMES), ...Scene.fontsList().map((f) => [f.family, f.family])].filter((f, i, a) => a.findIndex((x) => x[0] === f[0]) === i);
  const out = [scTitle('group', `Выделено: ${sel.length}`, 'Ctrl/Shift — добавить или убрать')];
  out.push(scSec('Выровнять', [
    scRow('Друг по другу', ab('l', 'alignL', 'По левому краю'), ab('c', 'alignC', 'По центру ↔'), ab('r', 'alignR', 'По правому краю'),
      ab('t', 'alignT', 'По верху'), ab('m', 'alignM', 'По середине ↕'), ab('b', 'alignB', 'По низу')),
    scRow('По сцене', ab('c', 'alignC', 'По центру сцены ↔', true), ab('m', 'alignM', 'По середине сцены ↕', true)),
    scRow('Распределить', ab('dh', 'distH', 'Равные промежутки по горизонтали (от трёх)'), ab('dv', 'distV', 'Равные промежутки по вертикали (от трёх)'),
      ab('sameW', 'sameW', 'Одинаковая ширина — как у главного (выделен первым)')),
  ]));
  out.push(scSec('Вид', [
    scRow('Прозрачность', scRange(sel[0].opacity != null ? sel[0].opacity : 100, 0, 100, 1, (v) => all({ opacity: v }), '%', 100)),
    scRow('', scBtn('Скрыть', 'eye', () => all({ hidden: true }, true)), scBtn('Показать', 'eye', () => all({ hidden: false }, true)),
      scBtn('Закрепить', 'lock', () => all({ locked: true }, true)), scBtn('Открепить', 'lock', () => all({ locked: false }, true))),
  ]));
  if (texty.length) {
    const t0 = texty[0];
    const allT = (patch, re) => { texty.forEach((x) => Object.assign(x, patch)); scSceneTouch(re); };
    out.push(scSec(`Текст (${texty.length})`, [
      scRow('Шрифт', scSelect(fonts, t0.font || 'segoe', (v) => allT({ font: v }))),
      scRow('Цвет', scColor(t0.color || '#ffffff', (v) => allT({ color: v })), scCheck('Ж', t0.bold, (v) => allT({ bold: v })), scCheck('К', t0.italic, (v) => allT({ italic: v }))),
      scRow('Выравнивание', scSelect([['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']], t0.align || 'center', (v) => allT({ align: v }))),
    ]));
  }
  if (shapes.length) out.push(scSec(`Фигуры (${shapes.length})`, [scRow('Цвет', scColor(shapes[0].fill || '#3e8bff', (v) => { shapes.forEach((x) => { x.fill = v; }); scSceneTouch(false); }))]));
  out.push(scSec('Действия', [scRow('', scBtn('Копировать', 'copy', scCopySel), scBtn('Дублировать', 'copy', scDupSel), scBtn('Удалить', 'trash', scDeleteSel))]));
  return out;
}

// Пропорции содержимого блока (программа, слайды — разрешение «Основного»; экран — свой размер) не как у рамки — объяснить поля
function scFitNote(it) {
  const z = it.type === 'screen' ? Compose.screenSize(it.ref) : ['program', 'cur', 'next', 'only'].includes(it.type) ? scMainSize() : null;
  if (!z || !it.w || !it.h || Math.abs(z.w / z.h - it.w / it.h) < 0.01 || (it.fit && it.fit !== 'contain')) return null;
  const who = it.type === 'screen' ? 'Показанный экран' : '«Основной» (Редактор сцен → Основной → Разрешение)';
  return scNote(`${who} — ${z.w}×${z.h}, а рамка блока — ${Math.round(it.w)}×${Math.round(it.h)}: пропорции разные, поэтому ${z.w / z.h < it.w / it.h ? 'по бокам' : 'сверху и снизу'} поля. `
    + (it.type === 'screen' ? 'Без полей — «Заполнить» (края обрежутся) или «Растянуть».' : 'Без полей — «Своё разрешение», «Заполнить» (края обрежутся) или «Растянуть».'), true);
}

function scItemInsp(it, sc) {
  const set = (patch, re) => scItemSet(it, patch, re);
  const out = [scTitle(SC_ITEMS[it.type].icon, it.name || SC_ITEMS[it.type].name, SC_ITEMS[it.type].name)];
  const c = [scRow('Название', scText(it.name, (v) => set({ name: v }, true), SC_ITEMS[it.type].name))];
  if (it.type === 'screen') {
    // Любой экран или другая сцена (как она идёт на свои выходы)
    c.push(scRow('Показывает', scSelect([...lib.screens.map((s) => [s.id, 'Экран: ' + s.name]), ...lib.scenes.filter((x) => x.layout !== sc.id).map((x) => [scSceneSid(x), 'Сцена: ' + x.name])], it.ref, (v) => set({ ref: v }, true))));
  } else if (it.type === 'program') {
    c.push(scRow('Слои', scLayerChecks(it.layers, (v) => set({ layers: v }, true))));
    c.push(scCheck('Рисунок поверх слайда', it.ink !== false, (v) => set({ ink: v })));
    c.push(scCheck('Звук', !!it.sound, (v) => set({ sound: v }), 'Если экран со звуком'));
  } else if (it.type === 'cur' || it.type === 'next') {
    c.push(scNote(it.type === 'cur' ? 'Слайд из слоя «Презентации», который сейчас на экране.' : 'Следующий слайд рабочего плейлиста (после того, что на экране).'));
    c.push(scCheck('Только текст — крупно, размер подбирается сам', !!it.plain, (v) => set(v ? { plain: true, size: it.size || 72, color: it.color || '#ffffff', auto: true, minSize: it.minSize || 14 } : { plain: false }, true),
      'Без фона и оформления темы: длинный текст уменьшается, чтобы влезть'));
    if (it.type === 'cur' && !it.plain) c.push(scCheck('Рисунок поверх слайда', it.ink !== false, (v) => set({ ink: v }), 'Когда здесь тот же слайд, на котором рисуют'));
  } else if (it.type === 'only') {
    c.push(scNote('Оператор отправляет сюда слайд правой кнопкой в ленте → «Только на сцену». Зрители этого не видят. Убрать — кнопка «Сцена» под предпросмотром.'));
  } else if (SC_ITEMS[it.type] && SC_ITEMS[it.type].info) {
    c.push(...scInfoRows(it, set));
  } else if (it.type === 'media') {
    c.push(scRow('Файл', scEl('span', 'te-sub sc-file', it.url ? decodeURIComponent(it.url.split('/').pop()) : 'не выбран'), scBtn('Выбрать…', '', () => scPickMedia(it))));
    if (it.url && !/\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(it.url)) {
      c.push(scCheck('По кругу', it.loop !== false, (v) => set({ loop: v })));
      c.push(scCheck('Звук', !!it.sound, (v) => set({ sound: v })));
    }
  } else if (it.type === 'source') {
    c.push(scRow('Источник', scEl('span', 'te-sub sc-file', it.src ? it.src.label : 'не выбран'), scBtn('Выбрать…', '', (e) => scPickSource(e, (src) => set({ src, name: it.name || src.label }, true)))));
  } else if (it.type === 'text' || it.type === 'clock') {
    if (it.type === 'text') {
      const ta = scEl('textarea');
      ta.rows = 3;
      ta.value = it.text || '';
      ta.addEventListener('input', () => set({ text: ta.value }));
      c.push(ta);
    } else c.push(scRow('Показывать', scSelect([['hm', 'Часы:минуты'], ['hms', 'Часы:минуты:секунды'], ['date', 'Дату']], it.fmt || 'hm', (v) => set({ fmt: v }))));
  } else if (SC_ITEMS[it.type].shape) {
    c.push(scRow('Фигура', scSelect(Object.entries(SC_ITEMS).filter(([, x]) => x.shape).map(([k, x]) => [k, x.name]), it.type, (v) => set({ type: v }, true))));
    c.push(scRow('Цвет', scColor(it.fill || '#3e8bff', (v) => set({ fill: v })), scCheck('Градиент', !!it.fill2, (v) => set({ fill2: v ? '#000000' : '' }, true))));
    if (it.fill2) {
      c.push(scRow('Второй цвет', scColor(it.fill2, (v) => set({ fill2: v })), scCheck('из центра', !!it.fillR, (v) => set({ fillR: v }, true))));
      if (!it.fillR) c.push(scRow('Угол', scRange(it.fillA != null ? it.fillA : 180, 0, 360, 1, (v) => set({ fillA: v }), '°', 180)));
    }
    c.push(scRow('Непрозрачность заливки', scRange(it.fillO != null ? it.fillO : 100, 0, 100, 1, (v) => set({ fillO: v }), '%', 100)));
    if (it.type === 'line') c.push(scNote('Толщина линии — высота элемента. Наклон — поворот (кружок над рамкой).'));
  }
  out.push(scSec('Содержимое', c));
  if (SC_TEXTY.includes(it.type) || ((it.type === 'cur' || it.type === 'next') && it.plain)) out.push(scSec('Текст', scTextRows(it, set)), ...scTextLookSecs(it, set));
  out.push(scSec('Положение и размер', [
    scRow('X, Y', scNum(it.x, (v) => set({ x: v })), scNum(it.y, (v) => set({ y: v }))),
    scRow('Ширина, высота', scNum(it.w, (v) => set({ w: Math.max(1, v) }), { min: 1 }), scNum(it.h, (v) => set({ h: Math.max(1, v) }), { min: 1 })),
    scRow('Поворот', scRange(it.rot || 0, -180, 180, 1, (v) => set({ rot: v }), '°', 0)),
    scRow('', scCheck('Отразить ↔', it.flipX, (v) => set({ flipX: v })), scCheck('↕', it.flipY, (v) => set({ flipY: v }))),
    scRow('', scBtn('Во весь экран', '', () => set({ x: 0, y: 0, w: sc.w, h: sc.h, rot: 0 }, true)), scBtn('По центру', '', () => set({ x: Math.round((sc.w - it.w) / 2), y: Math.round((sc.h - it.h) / 2) }, true))),
  ]));
  if (SC_NATIVE.includes(it.type) && !it.plain) {
    const cr = it.crop || {};
    const cset = (k, v) => { scSub(it, 'crop', k, Math.max(0, Math.min(45, v))); scSceneTouch(false); };
    out.push(scSec('Вписывание и обрезка', [
      scRow('Вписать', scSelect([
        ...(['program', 'cur', 'next', 'only'].includes(it.type) ? [['native', 'Своё разрешение (без полей, текст подстроится)']] : []),
        ['contain', 'Целиком (поля)'], ['cover', 'Заполнить (обрезать)'], ['stretch', 'Растянуть']], it.fit || 'contain', (v) => set({ fit: v }, true))),
      scFitNote(it),
      scRow('Слева, справа', scNum(cr.l || 0, (v) => cset('l', v), { min: 0, max: 45 }), scNum(cr.r || 0, (v) => cset('r', v), { min: 0, max: 45 }), scEl('span', 'te-sub', '%')),
      scRow('Сверху, снизу', scNum(cr.t || 0, (v) => cset('t', v), { min: 0, max: 45 }), scNum(cr.b || 0, (v) => cset('b', v), { min: 0, max: 45 }), scEl('span', 'te-sub', '%')),
      scRow('', scBtn('Без обрезки', '', () => set({ crop: {} }, true))),
    ], !!(cr.l || cr.r || cr.t || cr.b)));
  }
  out.push(...scLookSecs(it, set));
  out.push(scFxSec(it, (re) => scSceneTouch(re)));
  return out;
}

// Вид элемента — как в редакторе тем: прозрачность и наложение, маска, рамка, тень, внешнее свечение, мягкие края,
// градиент поверх, эффекты фона под элементом (compose.js: applyNode)
function scLookSecs(it, set) {
  const sub = (key) => (k, v, re) => { scSub(it, key, k, v); scSceneTouch(re); };
  const sh = it.shadow || {}; const shS = sub('shadow');
  const g = it.grad || {}; const gS = sub('grad');
  const bd = it.border || {}; const bdS = sub('border');
  const gl = it.glow || {}; const glS = sub('glow');
  const bk = it.back || {}; const bkS = sub('back');
  const op = (v, on, d = 100) => scRange(v != null ? v : d, 0, 100, 1, on, '%', d);
  const shadowOn = (sh.blur || 0) + Math.abs(sh.x || 0) + Math.abs(sh.y || 0) > 0;
  const backOn = !!(bk.blur || bk.inv || (bk.s != null && bk.s !== 100) || (bk.b != null && bk.b !== 100));
  return [
    scSec('Вид', [
      scRow('Прозрачность', op(it.opacity, (v) => set({ opacity: v }))),
      scRow('Наложение', scSelect(Compose.BLENDS.map((b) => [b, ({ normal: 'Обычное', multiply: 'Умножение', screen: 'Экран', overlay: 'Перекрытие', darken: 'Темнее', lighten: 'Светлее', 'color-dodge': 'Осветление основы', 'color-burn': 'Затемнение основы', difference: 'Разница', exclusion: 'Исключение', 'soft-light': 'Мягкий свет', 'hard-light': 'Жёсткий свет', hue: 'Цветовой тон', saturation: 'Насыщенность', luminosity: 'Яркость', color: 'Цветность' })[b] || b]), it.blend || 'normal', (v) => set({ blend: v }))),
      scRow('Маска', scSelect([['none', 'Нет'], ['ellipse', 'Круг / эллипс'], ['fade', 'Мягкие края (прямоугольник)'], ['vignette', 'Виньетка (по овалу)']], it.mask || 'none', (v) => set({ mask: v }, true))),
      it.mask === 'fade' || it.mask === 'vignette' ? scRow('Ширина края', scRange(it.feather || 12, 1, 50, 1, (v) => set({ feather: v }), '%', 12)) : null,
      it.mask !== 'ellipse' && it.type !== 'ellipse' ? scRow('Скругление', scNum(it.radius || 0, (v) => set({ radius: Math.max(0, v) }), { min: 0, max: 2000 }), scEl('span', 'te-sub', 'px')) : null,
    ], false),
    scSec('Рамка', [
      scRow('Толщина', scRange(bd.w || 0, 0, 100, 1, (v) => bdS('w', v), ' px', 0)),
      scRow('Цвет', scColor(bd.c || '#ffffff', (v) => bdS('c', v)), op(bd.op, (v) => bdS('op', v))),
      scRow('Линия', scSelect([['solid', 'Сплошная'], ['dashed', 'Штрихи'], ['dotted', 'Точки'], ['double', 'Двойная']], bd.s || 'solid', (v) => bdS('s', v))),
    ], (bd.w || 0) > 0),
    scSec('Тень', [
      scRow('Размытие', scRange(sh.blur || 0, 0, 300, 1, (v) => shS('blur', v), ' px', 0)),
      scRow('Сдвиг X, Y', scNum(sh.x || 0, (v) => shS('x', v), { min: -2000, max: 2000 }), scNum(sh.y || 0, (v) => shS('y', v), { min: -2000, max: 2000 })),
      scRow('Цвет', scColor(sh.c || '#000000', (v) => shS('c', v)), op(sh.op, (v) => shS('op', v), sh.c ? 100 : 60)),
      scRow('', scBtn('Без тени', '', () => set({ shadow: {} }, true))),
    ], shadowOn),
    scSec('Внешнее свечение', [
      scRow('', scCheck('свечение', !!gl.on, (v) => glS('on', v, true), 'Сияние вокруг всего, что нарисовано (как Outer Glow в Photoshop)')),
      ...(gl.on ? [
        scRow('Цвет', scColor(gl.c || '#ffd27a', (v) => glS('c', v)), op(gl.op, (v) => glS('op', v), 90)),
        scRow('Размер', scRange(gl.size != null ? gl.size : 20, 1, 200, 1, (v) => glS('size', v), ' px', 20)),
        scRow('Сила', scRange(gl.power || 2, 1, 4, 1, (v) => glS('power', v), '', 2)),
      ] : []),
    ], !!gl.on),
    scSec('Мягкие края', [
      scRow('Размытие краёв', scRange(it.soft || 0, 0, 40, 0.5, (v) => set({ soft: v }), ' px', 0)),
      scNote('Весь элемент становится мягким, с размытыми краями. Плавно растворить края картинки — «Маска» → «Мягкие края» или «Виньетка».'),
    ], (it.soft || 0) > 0),
    scSec('Градиент поверх', [
      scRow('', scCheck('градиент', !!g.on, (v) => gS('on', v, true), 'Затемнение или подсветка поверх содержимого')),
      ...(g.on ? [
        scRow('Цвета', scColor(g.c1 || '#000000', (v) => gS('c1', v)), scColor(g.c2 || '#000000', (v) => gS('c2', v)), scCheck('из центра', !!g.radial, (v) => gS('radial', v, true))),
        g.radial ? null : scRow('Угол', scRange(g.a != null ? g.a : 180, 0, 360, 1, (v) => gS('a', v), '°', 180)),
        scRow('Сила', op(g.o, (v) => gS('o', v))),
      ] : []),
    ], !!g.on),
    scSec('Эффекты фона под элементом', [
      scNote('Действуют на то, что ПОД элементом: видео, фото, камеру. Например, прямоугольник без заливки с размытием — видео размыто только за текстом.'),
      scRow('Размытие', scRange(bk.blur || 0, 0, 60, 0.5, (v) => bkS('blur', v), ' px', 0)),
      scRow('Насыщенность', scRange(bk.s != null ? bk.s : 100, 0, 300, 1, (v) => bkS('s', v), '%', 100)),
      scRow('Яркость', scRange(bk.b != null ? bk.b : 100, 0, 200, 1, (v) => bkS('b', v), '%', 100)),
      scCheck('Инверсия цветов', !!bk.inv, (v) => bkS('inv', v)),
    ], backOn),
  ];
}
