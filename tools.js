/* ---------- Выбор темы, связь с редактором, рисование поверх слайда, медиапул ----------
   Подключается последним: пользуется функциями renderer.js и playlist.js. */

/* ===== Выбор темы (кнопка 🎨) ===== */

let themeTarget = null; // { kind: 'item'|'items'|'slides'|'media'|'bible', item?, items?, slides?: [{ item, slide }], media?, name }

function openThemePicker(target) {
  if (!lib) return;
  themeTarget = target;
  // song | bible | media | custom; у нескольких пунктов разного вида — mixed
  const kinds = target.kind === 'items' ? [...new Set(target.items.map(kindOfItem))] : target.kind === 'slides' ? [...new Set(target.slides.map((x) => Slides.themeKind(x.slide)))] : null;
  const kind = target.kind === 'item' ? kindOfItem(target.item) : kinds ? (kinds.length === 1 ? kinds[0] : 'mixed') : target.kind;
  $('themeDlgTitle').textContent = `Тема: ${target.name || ''}`;
  // Какие варианты «применить ко всем» имеют смысл для этого пункта
  const show = { song: ['song', 'text'], bible: ['bible', 'text'], media: ['media'], custom: ['custom'] }[kind] || ['song', 'bible', 'text', 'media', 'custom'];
  document.querySelectorAll('.theme-scope label[data-for]').forEach((l) => { l.hidden = !show.includes(l.dataset.for); });
  const single = target.kind === 'bible';
  $('themeScopeOne').parentElement.hidden = single;
  document.querySelector(`input[name=themeScope][value=${single ? 'bible' : 'one'}]`).checked = true;
  $('themeScopeOne').textContent = target.kind === 'media' ? 'только к этой картинке'
    : kinds ? `только к выделенным (${(target.items || target.slides).length})` : 'только сюда';
  // У выделенных одна тема — подсветим её, разные — ни одну
  const ids = target.kind === 'slides' ? [...new Set(target.slides.map((x) => themeIdFor(Slides.themeKind(x.slide), x.item, x.slide)))]
    : kinds ? [...new Set(target.items.map((it) => themeIdFor(kindOfItem(it), it)))] : null;
  const curId = target.kind === 'bible' ? lib.themeFor.bible || ''
    : target.kind === 'media' ? themeIdFor('media', target.media)
      : ids ? (ids.length === 1 ? ids[0] : null) : themeIdFor(kind, target.item);
  // Шаблон, выбранный вручную (у всех выделенных один — покажем его на карточке)
  const tpls = target.kind === 'slides' ? target.slides.map((x) => x.slide.tpl || '')
    : target.kind === 'bible' ? [(lib.tplFor && lib.tplFor.bible) || '']
      : target.kind === 'media' ? null : (target.items || [target.item]).map((it) => it.tpl || '');
  themeCurTpl = tpls && new Set(tpls).size === 1 ? tpls[0] : '';
  renderThemeCards(curId, kind, !!tpls);
  $('themeDialog').showModal();
}
let themeCurTpl = '';

function themeSample(kind, style) {
  if (kind === 'media') return { type: 'text', text: 'Картинка\nс темой', style };
  if (kind === 'bible') return { type: 'text', verses: [{ n: 16, t: 'Ибо так возлюбил Бог мир…' }], ref: 'Ин 3:16', style };
  return { type: 'text', text: 'Велик наш Бог\nДостоин хвалы', style };
}

function renderThemeCards(curId, kind, withTpl) {
  const box = $('themeCards');
  box.replaceChildren();
  const card = (id, name, style) => {
    const b = Object.assign(document.createElement('button'), { className: 'theme-card' + (id === curId ? ' cur' : '') });
    const mini = Object.assign(document.createElement('div'), { className: 'mini' });
    const list = id && withTpl ? style.tpls || [] : [];
    const tpl = id === curId ? list.find((x) => x.id === themeCurTpl) : null;
    mini.append(Scene.build({ ...themeSample(kind, { ...style, bgVideo: false }), tpl: tpl ? tpl.id : undefined }));
    b.append(mini, Object.assign(document.createElement('span'), { className: 'tname', textContent: name }));
    b.addEventListener('click', () => applyTheme(id));
    // Несколько шаблонов — выбрать вручную: тема применяется сразу с этим шаблоном
    if (list.length > 1) {
      const tb = Object.assign(document.createElement('span'), { className: 'ttpl', role: 'button', textContent: (tpl ? tpl.name : `Шаблон: сам (${list.length})`) + ' ▾', title: 'Выбрать шаблон темы вручную — тема применится сразу с ним' });
      tb.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = tb.getBoundingClientRect();
        const cur = tpl ? tpl.id : '';
        showMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
          { label: (cur ? '' : '✓ ') + 'Сам — по виду слайда', fn: () => applyTheme(id, '') },
          '-',
          ...list.map((x) => ({ label: (cur === x.id ? '✓ ' : '') + x.name + (Themes.USES[x.use] && x.use !== 'any' && Themes.USES[x.use] !== x.name ? ` · ${Themes.USES[x.use]}` : ''), fn: () => applyTheme(id, x.id) })),
        ]);
      });
      b.append(tb);
    }
    // Карандаш на карточке — открыть эту тему во вкладке «Темы»
    if (id) {
      const ed = Object.assign(document.createElement('span'), { className: 'tedit', title: 'Изменить эту тему во вкладке «Темы»' });
      ed.dataset.icon = 'editor';
      ed.addEventListener('click', (e) => { e.stopPropagation(); $('themeDialog').close(); openThemeTab(id); });
      b.append(ed);
    }
    box.append(b);
  };
  card('', 'Без темы (из настроек)', textStyle());
  for (const t of Themes.all(appliedThemes())) card(t.id, t.name, { ...THEME_DEFAULTS, ...Themes.style(t), still: true });
  Icons.apply(box);
  themeCurId = curId || '';
  requestAnimationFrame(() => box.querySelectorAll('.mini').forEach((m) => Scene.refit(m)));
}

// tpl: шаблон темы, выбранный вручную ('' — сам по виду слайда; не передан — шаблон не трогаем)
function applyTheme(id, tpl) {
  const scope = document.querySelector('input[name=themeScope]:checked').value;
  const t = themeTarget;
  const setTpl = (o) => { if (tpl === undefined) return; if (tpl && id) o.tpl = tpl; else delete o.tpl; };
  const clearItems = (pred) => Object.values(lib.items).forEach((it) => { if (pred(it)) { delete it.theme; delete it.tpl; } });
  if (scope === 'one') {
    for (const it of t.kind === 'item' ? [t.item] : t.kind === 'items' ? t.items : []) {
      if (id) it.theme = id; else delete it.theme;
      setTpl(it);
      // Шаблон для всей презентации — выбранные раньше у отдельных слайдов больше не мешают
      if (tpl !== undefined) it.slides.forEach((s) => { delete s.tpl; });
    }
    // Тема слайда важнее темы презентации; текст слайдов не меняется
    // Свой вид слайда (редактор тем) уступает выбранной теме; у своего слайда в виде его блоки — остаётся
    if (t.kind === 'slides') { t.slides.forEach((x) => { if (id) x.slide.theme = id; else delete x.slide.theme; setTpl(x.slide); if (x.slide.k !== 'custom') delete x.slide.look; }); flashStatus(`Тема применена к слайдам: ${t.slides.length} · Ctrl+Z — вернуть`); }
    if (t.kind === 'items') flashStatus(`Тема применена к пунктам: ${t.items.length}`);
    else if (t.kind === 'media') { if (id) t.media.theme = id; else delete t.media.theme; }
  } else {
    const kinds = scope === 'text' ? ['song', 'bible'] : [scope];
    if (!lib.tplFor) lib.tplFor = {};
    for (const k of kinds) {
      lib.themeFor[k] = id;
      if (tpl !== undefined) { if (tpl && id) lib.tplFor[k] = tpl; else delete lib.tplFor[k]; }
      clearItems((it) => kindOfItem(it) === k);
    }
    if (scope === 'media') media.forEach((m) => { delete m.theme; });
  }
  saveLists();
  saveLib();
  $('themeDialog').close();
  renderService();
  refreshLive();
  if (bible && bOpen && settings.bibleView === 'slides') renderVerses(); // стихи-слайды с новой темой
}

// «Изменить тему…» — вкладка «Темы» с темой, которая сейчас у выбранного (отдельного окна для тем больше нет)
let themeCurId = '';
$('themeEdit').addEventListener('click', () => { $('themeDialog').close(); openThemeTab(themeCurId); });
// Тема для выделенных пунктов «Содержания» (одна на все); false — ничего не выделено
function openThemeForSelected() {
  const chosen = selectedItems();
  if (!chosen.length) return false;
  if (chosen.length === 1) openThemePicker({ kind: 'item', item: chosen[0].item, name: chosen[0].item.name });
  else openThemePicker({ kind: 'items', items: chosen.map((x) => x.item), name: `выделено ${chosen.length}` });
  return true;
}

// Кнопка «Тема» в «Библии»: выделенные пункты слева, иначе весь текст Библии
// Кнопка «Тема» в строке вкладок: выделенные пункты, иначе то, что на экране (в «Библии» — весь её текст)
$('svcTheme').addEventListener('click', () => {
  if (openThemeForSelected()) return;
  if (tab === 'bible') return openThemePicker({ kind: 'bible', name: 'Библия' });
  if (plShown) {
    const e = entryByKey(plShown.key, keyView(plShown.view));
    if (e) return openThemePicker({ kind: 'item', item: e.item, name: e.item.name });
  }
  if (bShown) return openThemePicker({ kind: 'bible', name: 'Библия' });
  if (live >= 0 && media[live]) return openThemePicker({ kind: 'media', media: media[live], name: media[live].name });
  flashStatus('Выделите пункты в «Содержании» (Ctrl/Shift+щелчок, Ctrl+A) или выведите что-нибудь на экран');
});

/* ===== Окно «Картинка» (editor.html): правка фото. Слайды правятся в редакторе тем (свой вид слайда),
   старого редактора слайдов больше нет (решение владельца). ===== */

const clone = (x) => JSON.parse(JSON.stringify(x));

function openImageEditor(item, target) {
  window.api.openEditor({
    image: { url: item.url, path: item.path, name: item.name.replace(/\.[^.]+$/, '') },
    target: target.media ? { mediaUrl: item.url } : target, ui: uiPalette(),
  });
}

window.api.onEditorSaved((msg) => {
  if (!lib || !msg) return;
  if (msg.kind === 'image' && msg.file) {
    // Отредактированная картинка сохраняется отдельным файлом, исходник не трогаем
    const tg = msg.target || {};
    const it = tg.itemId && lib.items[tg.itemId];
    const slide = it && it.slides.find((s) => s.id === tg.slideId);
    if (slide) Object.assign(slide, { url: msg.file.url, path: msg.file.path });
    if (tg.mediaUrl) {
      media.forEach((m) => { if (m.url === tg.mediaUrl) Object.assign(m, { url: msg.file.url, path: msg.file.path }); });
      renderMedia();
    }
    if (!tg.itemId && !tg.mediaUrl && findView()) addItems([fromFileItem({ ...msg.file, name: msg.file.name })], false, 'rescue');
  }
  saveLib();
  renderService();
  // То, что на экране, перерисуем с новыми данными
  if (plShown) {
    const e = entryByKey(plShown.key, keyView(plShown.view));
    const still = e && e.item.slides.find((s) => s.id === plShown.sid);
    if (still && still.k !== 'audio') showSlide(plShown.key, plShown.sid, plShown.view);
  } else refreshLive();
});


// Новый свой слайд: блок текста посередине; оформление — тема «Свои слайды», правится в редакторе тем
const newCustomSlide = () => ({ id: newId(), k: 'custom', elements: [{ id: newId(), kind: 'text', x: 10, y: 35, w: 80, h: 30, text: 'Новый слайд', size: 10, weight: 700, align: 'center', valign: 'middle' }] });

// «＋ → Свой слайд»: новый слайд в уже существующую презентацию — после выделенного слайда, иначе в конец
// выделенной или открытой в ленте презентации
function svcAddSlide() {
  if (!lib) return;
  if (tab !== 'service') setTab('service');
  const last = selectedSlides().pop();
  const key = last ? last.key : selItems.length ? selItems[selItems.length - 1] : openKey;
  const e = key && workEntry(key);
  if (!e) { showNotice('Выделите презентацию или слайд в ней — новый слайд добавится туда. Новая презентация — «＋ → Новая презентация»', true); return; }
  const item = e.item;
  const s = newCustomSlide();
  const at = last ? item.slides.indexOf(last.slide) + 1 : item.slides.length;
  item.slides.splice(at, 0, s);
  touched(item);
  sel = [{ key: e.key, sid: s.id }];
  selAnchor = sel[0];
  renderService();
  flashStatus(`Слайд добавлен в «${item.name}» · правая кнопка → «Изменить в редакторе» · Ctrl+Z — вернуть`);
}

// «＋ → Новая презентация»: только в библиотеке; сразу спросить название
async function svcNewPres() {
  if (!findView() || plNoCreate()) return;
  const it = { id: newId(), type: 'pres', kind: 'custom', name: 'Новая презентация', slides: [newCustomSlide()] };
  addItems([it], true);
  const name = await askName('Название презентации', it.name);
  if (name && name !== it.name && lib.items[it.id]) {
    lib.items[it.id].name = name;
    saveLib();
    renderService();
  }
}

/* ===== Быстрая анимация: крупный план (камера с ключевыми точками), рисование и маркер поверх слайда ===== */

let inkStore = {};
try { inkStore = JSON.parse(localStorage.getItem('cp.ink') || '{}'); } catch { inkStore = {}; }
const saveInkStore = () => { try { localStorage.setItem('cp.ink', JSON.stringify(inkStore)); } catch { /* не страшно */ } };

let inkKey = null;    // какой слайд сейчас на экране
let inkShapes = [];   // что уже показано зрителям поверх слайда
let inkPending = [];  // подготовлено в окне рисования, зрители ещё не видят — до «Готово» или пробела
let inkTool = 'pen';
let inkColor = '#ff3b30';
let mkColor = '#ffe600'; // у маркера свой цвет
let inkWidth = 0.008;
let inkDraft = null;  // фигура, которую рисуют прямо сейчас
const INK_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#aa7452', '#ffffff', '#000000'];
const MK_COLORS = ['#ffe600', '#7cff4f', '#ff5fd2', '#4fd9ff', '#ff9f2e', '#b18cff'];
// Ширина полосы маркера (доля высоты экрана) для кнопок «тонко / средне / толсто» — примерно строка текста
const MK_WIDTH = { 0.004: 0.04, 0.008: 0.065, 0.014: 0.1 };

/* ----- Крупный план: вид { x, y, z } — центр в долях слайда и увеличение; null — весь слайд.
   inkView — камера в окне «Быстрая анимация», airView — что видят зрители.
   Два режима (settings.zoomLive): «Сразу в эфир» — камера сразу плавно едет у зрителей;
   «Подготовить» — движения камеры встают в очередь inkPending шагами { t: 'view', v } вперемешку с рисунками,
   «Готово» / пробел проигрывает всё по порядку: наплыв → прорисовка → перелёт…
   Ключевые точки (готовые крупные планы) — у каждого слайда свои, в cp.zoomPts по slideKey. Рисунок — в координатах слайда. */
let inkView = null;
let airView = null;
let zoomCur = -1;      // к какой точке перелетели последней
let zoomDrag = null;   // рамка лупы { t: 'zoom', a, b } или перетаскивание { t: 'pan', a, v }
let zoomPushT = 0;
let zoomUndo = null;   // удалённые точки { key, pts } — Ctrl+Z в окне возвращает
let playTok = 0;       // номер проигрывания: сменили слайд или вышли — старое проигрывание останавливается
const ZOOM_MAX = 8;
let zoomStore = {};
try { zoomStore = JSON.parse(localStorage.getItem('cp.zoomPts') || '{}'); } catch { zoomStore = {}; }
const saveZoomStore = () => { try { localStorage.setItem('cp.zoomPts', JSON.stringify(zoomStore)); } catch { /* не страшно */ } };
if (!Number(settings.zoomMs)) settings.zoomMs = 1000;
const zoomMsVal = () => Number(settings.zoomMs) || 1000;
// Окно закрыто (горячие клавиши, макросы) — всегда сразу в эфир
const zoomLive = () => settings.zoomLive !== false || !$('inkDialog').open;

function clampView(v) {
  if (!v) return null;
  const z = Math.max(1, Math.min(ZOOM_MAX, Number(v.z) || 1));
  if (z < 1.01) return null;
  const h = 0.5 / z; // край крупного плана не выходит за слайд
  return { x: Math.max(h, Math.min(1 - h, Number(v.x))), y: Math.max(h, Math.min(1 - h, Number(v.y))), z };
}
const camZ = () => (inkView ? inkView.z : 1);
// Точка окна (доли видимого) → точка слайда
const toSlide = (fx, fy) => (inkView ? [inkView.x + (fx - 0.5) / inkView.z, inkView.y + (fy - 0.5) / inkView.z] : [fx, fy]);

// Только в окне (без зрителей): пока тянут «Двигать» или крутят колесо
function viewLocal(ms) {
  if ($('inkDialog').open) { Scene.setView($('inkStage'), inkView, ms); camSvg(ms); }
  renderZoomBar();
}
// Зрителям: предпросмотр, экраны — плавно за ms
function sendAir(v, ms) {
  airView = v ? { ...v } : null;
  Scene.setView(prevStage, airView, ms);
  window.api.setView(airView, ms);
  Compose.progView({ view: airView, ms });
  syncInkButtons();
}
// Камера едет туда: в эфире — сразу и у зрителей, в подготовке — шагом в очередь (до «Готово»)
function setViewTo(v, ms) {
  if (ms == null) ms = zoomMsVal();
  clearTimeout(zoomPushT);
  inkView = clampView(v);
  if (zoomLive()) sendAir(inkView, ms);
  else { inkPending.push({ t: 'view', v: inkView ? { ...inkView } : null }); drawInkSvg(); }
  viewLocal(ms);
}
// Выйти совсем: зрителям весь слайд, очередь и проигрывание — прочь
function viewReset(ms) {
  playTok++;
  zoomCur = -1;
  inkView = null;
  sendAir(null, ms);
  viewLocal(ms);
}

// Рисунок в окне двигается вместе со слайдом
function camSvg(ms) {
  const { W, H } = outputSize();
  const g = $('inkCam');
  const v = inkView;
  g.style.transition = ms > 0 ? `transform ${ms}ms cubic-bezier(.45,0,.25,1)` : 'none';
  g.style.transform = v ? `translate(${(0.5 - v.x * v.z) * W}px, ${(0.5 - v.y * v.z) * H}px) scale(${v.z})` : '';
}

const zoomPts = () => (inkKey && zoomStore[inkKey]) || [];
function renderZoomBar() {
  $('zoomLevel').textContent = Math.round(camZ() * 100) + '%';
  $('zoomFit').disabled = !inkView;
  const pts = zoomPts();
  $('zoomNext').disabled = !pts.length;
  $('zoomClearPts').hidden = !pts.length;
  const live = settings.zoomLive !== false;
  $('zoomLiveOn').setAttribute('aria-pressed', String(live));
  $('zoomLiveOff').setAttribute('aria-pressed', String(!live));
  $('zoomPts').replaceChildren(...pts.map((p, i) => {
    const b = Object.assign(document.createElement('button'), { className: 'zp', textContent: String(i + 1), title: `Точка ${i + 1}: ${p.z > 1.01 ? '×' + p.z.toFixed(1) : 'весь слайд'} — щелчок: плавно перелететь (клавиша ${i + 1}). Крестик или Delete — удалить, правая кнопка — заменить` });
    b.setAttribute('aria-pressed', String(i === zoomCur));
    b.addEventListener('click', () => zoomGo(i));
    // Крестик — удалить сразу, без вопросов (Ctrl+Z в окне — вернуть)
    const x = Object.assign(document.createElement('span'), { className: 'zp-x', textContent: '×', title: 'Удалить точку' });
    x.addEventListener('click', (e) => { e.stopPropagation(); zoomDelete(i); });
    b.append(x);
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu(e, [
        { label: 'Заменить текущим крупным планом', fn: () => { pts[i] = inkView ? { ...inkView } : { x: 0.5, y: 0.5, z: 1 }; zoomStore[inkKey] = pts; saveZoomStore(); zoomCur = i; renderZoomBar(); } },
        { label: 'Удалить точку', key: 'Delete', fn: () => zoomDelete(i) },
        { label: 'Удалить все точки слайда', fn: zoomClearAll },
      ]);
    });
    return b;
  }));
}
function zoomSavePts(pts) {
  if (pts.length) zoomStore[inkKey] = pts; else delete zoomStore[inkKey];
  saveZoomStore();
  renderZoomBar();
}
function zoomDelete(i) {
  const pts = zoomPts().slice();
  if (!pts[i]) return;
  zoomUndo = { key: inkKey, pts: pts.slice() };
  pts.splice(i, 1);
  zoomCur = zoomCur === i ? -1 : zoomCur > i ? zoomCur - 1 : zoomCur;
  zoomSavePts(pts);
  flashStatus(`Точка ${i + 1} удалена. Ctrl+Z — вернуть`);
}
function zoomClearAll() {
  const pts = zoomPts();
  if (!pts.length) return;
  zoomUndo = { key: inkKey, pts: pts.slice() };
  zoomCur = -1;
  zoomSavePts([]);
  flashStatus(`Удалено точек: ${pts.length}. Ctrl+Z — вернуть`);
}
function zoomRestore() {
  if (!zoomUndo || zoomUndo.key !== inkKey) return false;
  const { pts } = zoomUndo;
  zoomUndo = null;
  zoomSavePts(pts);
  flashStatus('Точки возвращены');
  return true;
}
function zoomGo(i) {
  const pts = zoomPts();
  if (!pts[i]) return;
  zoomCur = i;
  setViewTo(pts[i]);
}
function zoomStep(d) {
  const n = zoomPts().length;
  if (!n) { flashStatus('Точек нет: сделайте крупный план лупой и нажмите «Точка»'); return; }
  zoomGo(zoomCur < 0 ? (d > 0 ? 0 : n - 1) : (zoomCur + d + n) % n);
}
function zoomAdd() {
  if (!inkKey) return;
  const pts = zoomPts().slice();
  pts.push(inkView ? { ...inkView } : { x: 0.5, y: 0.5, z: 1 });
  zoomUndo = null;
  zoomCur = pts.length - 1;
  zoomSavePts(pts);
  flashStatus(`Точка ${pts.length} запомнена на этом слайде`);
}

// Рамка лупы — в координатах окна (не двигается вместе с камерой)
function drawZoomSel() {
  const g = $('inkSel');
  if (!zoomDrag || zoomDrag.t !== 'zoom') { g.replaceChildren(); return; }
  const { W, H } = outputSize();
  const [a, b] = [zoomDrag.a, zoomDrag.b];
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  r.setAttribute('class', 'zoom-sel');
  r.setAttribute('x', Math.min(a[0], b[0]) * W); r.setAttribute('y', Math.min(a[1], b[1]) * H);
  r.setAttribute('width', Math.abs(b[0] - a[0]) * W); r.setAttribute('height', Math.abs(b[1] - a[1]) * H);
  r.setAttribute('stroke-width', H / 300);
  g.replaceChildren(r);
}
// Отпустили лупу: рамка — увеличить её во весь экран; щелчок — ×2 к этой точке.
// Лупа «минус» (или Alt) — уменьшить в 2 раза от этого места (рамка не нужна)
function zoomFinish() {
  const { a, b, alt, out } = zoomDrag;
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  zoomCur = -1;
  if (out || alt || (w < 0.015 && h < 0.015)) {
    if ((out || alt) && !inkView) { flashStatus('Уже весь слайд — меньше некуда'); return; }
    const c = toSlide((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    setViewTo({ x: c[0], y: c[1], z: camZ() * (out || alt ? 0.5 : 2) });
    return;
  }
  const p0 = toSlide(Math.min(a[0], b[0]), Math.min(a[1], b[1]));
  const p1 = toSlide(Math.max(a[0], b[0]), Math.max(a[1], b[1]));
  setViewTo({ x: (p0[0] + p1[0]) / 2, y: (p0[1] + p1[1]) / 2, z: Math.min(1 / (p1[0] - p0[0]), 1 / (p1[1] - p0[1])) });
}
// Клавиши + / − : ступенькой от центра того, что видно
function zoomBy(k) {
  if (k < 1 && !inkView) return;
  const c = inkView || { x: 0.5, y: 0.5 };
  zoomCur = -1;
  setViewTo({ x: c.x, y: c.y, z: camZ() * k });
}

// Ключ слайда: по нему запомненный рисунок находится снова, когда к слайду возвращаются
function slideKey(c) {
  const raw = c.type + '|' + (c.url || '') + '|' + (c.text || '') + '|' + (c.ref || '') + '|' +
    (c.verses ? c.verses.map((v) => v.n).join(',') : '') + '|' + (c.elements ? JSON.stringify(c.elements) : '');
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36) + raw.length.toString(36);
}

// На экран и в предпросмотр — только показанное; animFrom — с какой фигуры прорисовать анимацией
// Возвращает, сколько мс идёт прорисовка (по предпросмотру)
function pushInk(animFrom) {
  const opts = Number.isInteger(animFrom) ? { animFrom } : undefined;
  const ms = Scene.setInk(prevStage, inkShapes, opts) || 0;
  window.api.setInk(inkShapes, opts);
  Compose.progInk(opts && inkShapes && inkShapes.length ? { shapes: inkShapes, animFrom: opts.animFrom } : inkShapes);
  syncInkButtons();
  if ($('inkDialog').open) drawInkSvg();
  return ms;
}

// Включено (окно открыто, рисунок или крупный план на экране) — карандаш подсвечен, рядом крестик «выйти»
function syncInkButtons() {
  const on = inkShapes.length > 0 || $('inkDialog').open || !!airView;
  $('inkOpen').classList.toggle('on', on);
  $('inkClear').hidden = !on;
}

/* ----- Пошаговая анимация (settings.animStep, «По NEXT»): после «Готово» шаги ждут в playQueue,
   каждый щелчок NEXT над предпросмотром (или пробел в окне) проигрывает один шаг: движение камеры или один рисунок */
let playQueue = [];
function syncNextBtn() {
  const on = !!settings.animStep;
  const n = playQueue.length;
  $('animNext').hidden = !on;
  $('animNext').classList.toggle('ready', n > 0);
  $('animNextN').textContent = n ? String(n) : '';
  $('animStepMode').setAttribute('aria-pressed', String(on));
}
function animNext() {
  if (!playQueue.length) { flashStatus('Шагов нет: подготовьте анимацию в «Быстрой анимации» и нажмите «Готово»'); return false; }
  const s = playQueue.shift();
  playTok++; // если что-то проигрывалось подряд — остановить
  if (s.t === 'view') sendAir(s.v, zoomMsVal());
  else {
    const from = inkShapes.length;
    inkShapes = inkShapes.concat([s]);
    rememberInk();
    pushInk(from);
  }
  syncNextBtn();
  if ($('inkDialog').open) drawInkSvg();
  if (!playQueue.length) flashStatus('Это был последний шаг');
  return true;
}
function setAnimStep(on) {
  settings.animStep = on;
  saveSettings();
  // Выключили, а шаги ещё ждут — проиграть их подряд, чтобы не пропали
  if (!on && playQueue.length) { inkPending = playQueue.concat(inkPending); playQueue = []; inkConfirm(); }
  syncNextBtn();
  if ($('inkDialog').open) drawInkSvg();
  flashStatus(on ? 'По NEXT: после «Готово» каждый шаг — по кнопке NEXT над предпросмотром' : 'Пошаговый режим выключен: «Готово» играет всё подряд');
}
$('animNext').addEventListener('click', animNext);
$('animNext').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showMenu(e, [
    { label: 'Выключить пошаговый режим (NEXT)', fn: () => setAnimStep(false) },
    { label: `Сбросить оставшиеся шаги (${playQueue.length})`, disabled: !playQueue.length, fn: () => { playQueue = []; syncNextBtn(); if ($('inkDialog').open) drawInkSvg(); flashStatus('Оставшиеся шаги сброшены'); } },
  ]);
});
$('animStepMode').addEventListener('click', () => setAnimStep(!settings.animStep));
syncNextBtn();

// «Готово» / пробел: подготовленное проигрывается зрителям по порядку —
// движение камеры (ждём наплыв), подряд идущие рисунки (ждём прорисовку), снова камера…
// В режиме «По NEXT» — только встаёт в очередь, играет по кнопке NEXT
function inkConfirm() {
  if (!inkPending.length) return false;
  if (settings.animStep) {
    playQueue = playQueue.concat(inkPending);
    inkPending = [];
    syncNextBtn();
    if ($('inkDialog').open) drawInkSvg();
    flashStatus(`Готово к показу шагов: ${playQueue.length} — жмите NEXT`);
    return true;
  }
  const steps = inkPending;
  inkPending = [];
  const tok = ++playTok;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    for (let i = 0; i < steps.length;) {
      if (tok !== playTok) return; // сменили слайд или вышли — дальше не играем
      if (steps[i].t === 'view') {
        const ms = zoomMsVal();
        sendAir(steps[i++].v, ms);
        if (i < steps.length) await sleep(ms + 120);
        continue;
      }
      const batch = [];
      while (i < steps.length && steps[i].t !== 'view') batch.push(steps[i++]);
      const from = inkShapes.length;
      inkShapes = inkShapes.concat(batch);
      rememberInk();
      const ms = pushInk(from);
      if (i < steps.length) await sleep(ms + 120);
    }
  })();
  if ($('inkDialog').open) drawInkSvg();
  return true;
}

function rememberInk() {
  if (!inkKey) return;
  if (settings.inkKeep && inkShapes.length) inkStore[inkKey] = inkShapes;
  else delete inkStore[inkKey];
  saveInkStore();
}

function inkSlideChanged(content) {
  const key = content ? slideKey(content) : null;
  if (key === inkKey) return; // тот же слайд (например, поменяли настройку) — рисунок остаётся
  inkKey = key;
  inkShapes = key && inkStore[key] ? clone(inkStore[key]) : [];
  inkPending = [];
  inkDraft = null;
  pushInk();
  // Новый слайд — сразу целиком (крупный план прошлого слайда к нему не относится)
  zoomDrag = null;
  zoomUndo = null;
  playQueue = [];
  syncNextBtn();
  viewReset(0);
  if ($('inkDialog').open) {
    if (key) inkLayout(); else $('inkDialog').close();
  }
}

function inkWipeLive() {
  inkShapes = [];
  // Убрали и подготовленные движения камеры — камера окна к тому, что видят зрители
  if (inkPending.some((s) => s.t === 'view')) { inkView = airView ? { ...airView } : null; viewLocal(300); }
  inkPending = [];
  playQueue = [];
  syncNextBtn();
  rememberInk();
  pushInk();
}

function openInk() {
  if (!liveBuild) { showNotice('Сначала выведите слайд на экран, потом увеличивайте и рисуйте поверх него', true); return; }
  document.querySelectorAll('input[name=inkMode]').forEach((r) => { r.checked = r.value === (settings.inkKeep ? 'keep' : 'temp'); });
  $('zoomMs').value = String(settings.zoomMs);
  if (!$('zoomMs').value) $('zoomMs').value = '1000';
  $('inkDialog').showModal();
  syncInkButtons();
  inkLayout();
}

// Большая копия экрана в окне рисования
function inkLayout() {
  const { W, H } = outputSize();
  const stage = $('inkStage');
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  const area = $('inkArea');
  const s = Math.min(area.clientWidth / W, area.clientHeight / H) || 0.1;
  const left = (area.clientWidth - W * s) / 2;
  const top = (area.clientHeight - H * s) / 2;
  stage.style.transform = `scale(${s})`;
  stage.style.left = left + 'px';
  stage.style.top = top + 'px';
  const svg = $('inkSvg');
  Object.assign(svg.style, { left: left + 'px', top: top + 'px', width: W * s + 'px', height: H * s + 'px' });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  paintLayers(stage); // все слои: источник, медиа и слайд — как на экране
  Scene.setView(stage, inkView, 0);
  camSvg(0);
  renderZoomBar();
  drawInkSvg();
}
new ResizeObserver(() => { if ($('inkDialog').open) inkLayout(); }).observe($('inkArea'));

// В окне рисования видно всё: показанное и подготовленное (оно с пунктирной рамкой-подсказкой)
function drawInkSvg() {
  const { W, H } = outputSize();
  const shown = inkShapes.map((s) => Scene.shapeNode(s, W, H)).filter(Boolean);
  // Шаги камеры в очереди не рисуются (shapeNode их пропускает)
  // Ждущие NEXT — тоже мерцают: зрители их ещё не видели
  const prep = playQueue.concat(inkPending, inkDraft ? [inkDraft] : []).map((s) => Scene.shapeNode(s, W, H)).filter(Boolean);
  prep.forEach((n) => n.classList.add('ink-prep'));
  $('inkCam').replaceChildren(...shown, ...prep);
  const nv = inkPending.filter((s) => s.t === 'view').length;
  const n = inkPending.length - nv;
  const parts = [n ? `рисунков: ${n}` : '', nv ? `движений камеры: ${nv}` : ''].filter(Boolean).join(', ');
  const wait = playQueue.length ? ` Ждут NEXT: ${playQueue.length}.` : '';
  $('inkState').textContent = parts ? `Подготовлено — ${parts}. Зрители пока не видят. «Готово» или пробел — ${settings.animStep ? 'в очередь для NEXT' : 'проиграть по порядку'}.${wait}`
    : wait ? `Ждут NEXT: ${playQueue.length} — кнопка NEXT над предпросмотром или пробел здесь`
      : settings.zoomLive !== false ? 'Лупа — крупный план сразу у зрителей. Рисунок и маркер — после «Готово» или пробела'
        : 'Подготовка: увеличивайте, рисуйте, двигайте — зрители увидят всё по порядку после «Готово» или пробела';
  $('inkState').classList.toggle('on', !!(parts || wait));
}

// Где мышь в окне (доли видимого)
function inkFrac(e) {
  const r = $('inkSvg').getBoundingClientRect();
  return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
}
// Где мышь на слайде (с учётом крупного плана)
function inkPoint(e) {
  const [x, y] = toSlide(...inkFrac(e));
  return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
}

$('inkSvg').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (e.button !== 0) return;
  $('inkSvg').setPointerCapture(e.pointerId);
  if (inkTool === 'zoom' || inkTool === 'zoomout') { const f = inkFrac(e); zoomDrag = { t: 'zoom', a: f, b: f, alt: e.altKey, out: inkTool === 'zoomout' }; drawZoomSel(); return; }
  if (inkTool === 'pan') {
    if (!inkView) { flashStatus('Сначала увеличьте: «Лупа» — обведите рамкой, что показать крупно'); return; }
    clearTimeout(zoomPushT);
    zoomDrag = { t: 'pan', a: inkFrac(e), v: { ...inkView } };
    $('inkSvg').classList.add('drag');
    return;
  }
  const p = inkPoint(e);
  const mk = inkTool === 'mk';
  // При увеличении линия на экране той же толщины, что без него
  const w = (mk ? MK_WIDTH[inkWidth] : inkWidth) / camZ();
  inkDraft = { t: inkTool, c: mk ? mkColor : inkColor, w, p: inkTool === 'pen' || mk ? [p] : [p, p] };
  drawInkSvg();
});
$('inkSvg').addEventListener('pointermove', (e) => {
  if (zoomDrag) {
    const f = inkFrac(e);
    if (zoomDrag.t === 'zoom') { zoomDrag.b = f; drawZoomSel(); return; }
    const v = zoomDrag.v;
    inkView = clampView({ x: v.x - (f[0] - zoomDrag.a[0]) / v.z, y: v.y - (f[1] - zoomDrag.a[1]) / v.z, z: v.z });
    zoomDrag.moved = true;
    zoomCur = -1;
    viewLocal(0);
    return;
  }
  if (!inkDraft) return;
  const p = inkPoint(e);
  if (inkDraft.t === 'pen' || inkDraft.t === 'mk') {
    const last = inkDraft.p[inkDraft.p.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002 / camZ()) return;
    inkDraft.p.push(p);
  } else inkDraft.p[1] = p;
  drawInkSvg();
});

// Маркер ведут вдоль строки: если рука почти не уходила вверх-вниз — полоса выравнивается в ровную
function straightenMarker(s) {
  const W = outputSize().W / outputSize().H; // ширина экрана в долях высоты
  const ys = s.p.map((p) => p[1]);
  const xs = s.p.map((p) => p[0]);
  const dx = (Math.max(...xs) - Math.min(...xs)) * W;
  if (s.p.length < 2 || Math.max(...ys) - Math.min(...ys) > s.w * 0.8 || dx < s.w) return;
  const y = ys.reduce((a, b) => a + b, 0) / ys.length;
  const [a, b] = [s.p[0][0], s.p[s.p.length - 1][0]];
  s.p = [[a, y], [b, y]];
}

// Маркер по тексту: слова слайда, через которые прошла полоса, — по строкам, точно по их границам.
// Возвращает фигуру 'mt' или null, если текста под полосой нет (картинка, текст на фото)
function markerOnText(s) {
  const box = $('inkSvg').getBoundingClientRect();
  if (!box.width || !box.height) return null;
  // Точки почаще — чтобы при быстром движении короткие слова («и», «в») не проскакивали
  const pts = [];
  s.p.forEach((p, i) => {
    const q = s.p[i - 1];
    const n = q ? Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / (0.003 / camZ())) : 1;
    for (let k = 1; k <= n; k++) pts.push(q ? [q[0] + (p[0] - q[0]) * k / n, q[1] + (p[1] - q[1]) * k / n] : p);
  });
  const hit = [];
  const walk = document.createTreeWalker($('inkStage'), NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node; (node = walk.nextNode());) {
    for (const m of node.data.matchAll(/\S+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      for (const rc of range.getClientRects()) {
        if (rc.width < 1 || rc.height < 1) continue;
        // Рамка слова на экране окна → на слайде (при крупном плане слова увеличены)
        const [x0, y0] = toSlide((rc.left - box.left) / box.width, (rc.top - box.top) / box.height);
        const [x1, y1] = toSlide((rc.right - box.left) / box.width, (rc.bottom - box.top) / box.height);
        const r = [x0, y0, x1, y1];
        const pad = (r[3] - r[1]) * 0.2; // чуть выше или ниже строки — тоже попали
        if (pts.some(([x, y]) => x >= r[0] && x <= r[2] && y >= r[1] - pad && y <= r[3] + pad)) hit.push(r);
      }
    }
  }
  if (!hit.length) return null;
  // Слова одной строки — в одну полосу (с пробелами между ними)
  const lines = [];
  for (const w of hit.sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const cy = (w[1] + w[3]) / 2;
    const L = lines.find((l) => cy > l[1] && cy < l[3]);
    if (L) { L[0] = Math.min(L[0], w[0]); L[1] = Math.min(L[1], w[1]); L[2] = Math.max(L[2], w[2]); L[3] = Math.max(L[3], w[3]); } else lines.push([...w]);
  }
  const k = box.height / box.width; // поля по бокам — в долях ширины
  return { t: 'mt', c: s.c, l: lines.map(([x0, y0, x1, y1]) => { const h = y1 - y0; return [x0 - h * 0.12 * k, x1 + h * 0.12 * k, (y0 + y1) / 2, h]; }) };
}

const inkEnd = () => {
  if (zoomDrag) {
    const d = zoomDrag;
    if (d.t === 'zoom') zoomFinish();
    zoomDrag = null;
    drawZoomSel();
    $('inkSvg').classList.remove('drag');
    if (d.t === 'pan' && d.moved) setViewTo(inkView); // зрители плавно переезжают (или шаг в подготовку)
    return;
  }
  if (!inkDraft) return;
  if (inkDraft.t === 'mk') inkDraft = markerOnText(inkDraft) || (straightenMarker(inkDraft), inkDraft);
  inkPending.push(inkDraft);
  inkDraft = null;
  drawInkSvg();
};
$('inkSvg').addEventListener('pointerup', inkEnd);
$('inkSvg').addEventListener('pointercancel', inkEnd);

// Отменить: сначала подготовленное, потом уже показанное.
// Отменили шаг камеры — камера в окне возвращается к прошлому подготовленному виду (или к тому, что у зрителей)
function inkUndo() {
  if (inkPending.length) {
    const s = inkPending.pop();
    if (s.t === 'view') {
      const prev = inkPending.filter((x) => x.t === 'view').pop();
      inkView = prev ? clampView(prev.v) : airView ? { ...airView } : null;
      zoomCur = -1;
      viewLocal(400);
    }
    drawInkSvg();
    return;
  }
  if (playQueue.length) { playQueue.pop(); syncNextBtn(); drawInkSvg(); return; } // убрать последний шаг, ждущий NEXT
  inkShapes.pop();
  rememberInk();
  pushInk();
}
$('inkUndo').addEventListener('click', inkUndo);
$('inkWipe').addEventListener('click', inkWipeLive);
// Крестик: выйти из быстрой анимации — окно закрыть, рисунок убрать, плавно вернуть весь слайд
$('inkClear').addEventListener('click', () => {
  if ($('inkDialog').open) $('inkDialog').close();
  inkWipeLive();
  viewReset(zoomMsVal());
});

// Колесо мыши — плавное увеличение к курсору (точка под мышью остаётся на месте); зрителям — когда колесо остановится
$('inkArea').addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = inkFrac(e);
  const c = toSlide(...f);
  const z = Math.max(1, Math.min(ZOOM_MAX, camZ() * Math.exp(-e.deltaY * 0.0015)));
  inkView = clampView({ x: c[0] - (f[0] - 0.5) / z, y: c[1] - (f[1] - 0.5) / z, z });
  zoomCur = -1;
  viewLocal(0);
  clearTimeout(zoomPushT);
  zoomPushT = setTimeout(() => setViewTo(inkView), 250);
}, { passive: false });
$('zoomFit').addEventListener('click', () => { zoomCur = -1; setViewTo(null); });
$('zoomAdd').addEventListener('click', zoomAdd);
$('zoomClearPts').addEventListener('click', zoomClearAll);
// Режим: «Сразу в эфир» или «Подготовить» (проиграть по «Готово»)
function setZoomLive(on) {
  settings.zoomLive = on;
  saveSettings();
  renderZoomBar();
  drawInkSvg();
  flashStatus(on ? 'Крупный план — сразу у зрителей' : 'Подготовка: зрители увидят всё по «Готово» или пробелу');
}
$('zoomLiveOn').addEventListener('click', () => setZoomLive(true));
$('zoomLiveOff').addEventListener('click', () => setZoomLive(false));
$('zoomNext').addEventListener('click', () => zoomStep(1));
$('zoomMs').addEventListener('change', () => { settings.zoomMs = Number($('zoomMs').value) || 1000; saveSettings(); });
$('inkOpen').addEventListener('click', openInk);
$('inkDone').addEventListener('click', () => { inkConfirm(); $('inkDialog').close(); });
$('inkDialog').addEventListener('keydown', (e) => {
  // Ctrl+Z: сначала вернуть только что удалённые точки, иначе — отменить рисунок / шаг
  if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); if (!zoomRestore()) inkUndo(); }
  // Крупный план: 1–9 — к точке, 0 — весь слайд, P — запомнить точку, Delete — удалить текущую точку,
  // + / − — ближе / дальше, стрелки / PageUp-PageDown — по точкам
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.target.type !== 'radio';
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !typing) {
    const dg = /^(Digit|Numpad)([0-9])$/.exec(e.code);
    let ok = true;
    if (dg && dg[2] === '0') { zoomCur = -1; setViewTo(null); } else if (dg) zoomGo(Number(dg[2]) - 1);
    else if (e.code === 'KeyP') zoomAdd();
    else if (e.code === 'Delete') { if (zoomCur >= 0) zoomDelete(zoomCur); else flashStatus('Сначала выберите точку (щелчок по номеру)'); }
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') zoomBy(1.5);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoomBy(1 / 1.5);
    else if (e.code === 'ArrowRight' || e.code === 'PageDown') zoomStep(1);
    else if (e.code === 'ArrowLeft' || e.code === 'PageUp') zoomStep(-1);
    else ok = false;
    if (ok) { e.preventDefault(); e.stopPropagation(); return; }
  }
  // Пробел — показать подготовленное, окно остаётся открытым
  if (e.code === 'Space' && !e.ctrlKey && !e.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    e.preventDefault();
    // Подготовленного нет, а шаги ждут NEXT — пробел и есть NEXT
    if (!inkConfirm() && !(playQueue.length && animNext())) flashStatus('Нечего показывать — сначала увеличьте, нарисуйте или выделите маркером');
  }
});
$('inkDialog').addEventListener('close', () => {
  Scene.clear($('inkStage'));
  // Закрыли без «Готово» — неподтверждённое так и не показали
  if (inkPending.length) flashStatus(`Не показано и убрано: ${inkPending.length} (не нажали «Готово»)`);
  inkPending = [];
  inkDraft = null;
  clearTimeout(zoomPushT);
  // Камера окна снова совпадает с тем, что видят зрители (подготовленное движение не показали)
  inkView = airView ? { ...airView } : null;
  syncInkButtons();
});
document.querySelectorAll('input[name=inkMode]').forEach((r) => r.addEventListener('change', () => {
  settings.inkKeep = r.value === 'keep';
  saveSettings();
  rememberInk();
}));

// У маркера своя палитра (яркие полупрозрачные), у остальных инструментов — своя
function setInkTool(tool) {
  inkTool = tool;
  document.querySelectorAll('#inkTools button, #zoomTools button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  $('inkSvg').classList.toggle('tool-zoom', tool === 'zoom');
  $('inkSvg').classList.toggle('tool-zoomout', tool === 'zoomout');
  $('inkSvg').classList.toggle('tool-pan', tool === 'pan');
  renderInkColors();
}
function setInkWidth(w) {
  inkWidth = w;
  document.querySelectorAll('#inkWidths button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.w) === w)));
}
function setInkColor(c) {
  if (inkTool === 'mk') mkColor = c; else inkColor = c;
  renderInkColors();
}
function renderInkColors() {
  const mk = inkTool === 'mk';
  const cur = mk ? mkColor : inkColor;
  $('inkColors').classList.toggle('mk', mk);
  $('inkColors').replaceChildren(...(mk ? MK_COLORS : INK_COLORS).map((c) => {
    const b = Object.assign(document.createElement('button'), { className: 'swatch', title: mk ? 'Цвет маркера' : c });
    b.dataset.c = c;
    b.style.background = c;
    b.setAttribute('aria-pressed', String(c === cur));
    b.addEventListener('click', () => setInkColor(c));
    return b;
  }));
}
document.querySelectorAll('#inkTools button, #zoomTools button').forEach((b) => b.addEventListener('click', () => setInkTool(b.dataset.tool)));
document.querySelectorAll('#inkWidths button').forEach((b) => b.addEventListener('click', () => setInkWidth(Number(b.dataset.w))));
setInkTool('pen');
setInkColor(inkColor);
setInkWidth(inkWidth);

/* ===== Медиапул: закреплённые папки компьютера ===== */

if (!Array.isArray(settings.poolFolders)) settings.poolFolders = [];
const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const parentDir = (p) => {
  const up = p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
  return /^[A-Za-z]:$/.test(up) ? up + '\\' : up;
};
let poolData = { dirs: [], files: [] };
const poolSeen = new Map(); // папка → её список (открывается мгновенно)
let poolWatched = null; // за какой папкой следит main.js (pool:watch)
let poolDrag = null; // { path, until } — какой файл сейчас тянут из медиапула
// Тянут файл из медиапула (бросок разбирает poolDrop)
const isPoolDrag = (e) => !!poolDrag && Date.now() < poolDrag.until && e.dataTransfer.types.includes('Files');

// Как показывать файлы из медиапула (Настройки → Показ и звук); пусто — как общий «Размер картинки»
const poolFitValue = () => settings.poolFit || settings.fit;

// Если среди добавленных файлов есть тот, что перетащили из медиапула, — запомнить ему способ вписывания
function markPoolFit(items) {
  if (!poolDrag || Date.now() > poolDrag.until || !items) return;
  for (const i of items) if (i.path === poolDrag.path && (i.type === 'image' || i.type === 'video')) i.fit = poolFitValue();
  poolDrag = null;
}

function applyPool() {
  $('pool').hidden = !settings.poolOpen;
  $('pool').style.height = (settings.poolH || 240) + 'px';
  $('poolToggle').classList.toggle('on-soft', !!settings.poolOpen);
}

function togglePool() {
  settings.poolOpen = !settings.poolOpen;
  saveSettings();
  applyPool();
  if (settings.poolOpen) renderPool();
}

function renderPoolFolders() {
  const box = $('poolFolders');
  box.replaceChildren();
  for (const f of settings.poolFolders) {
    const row = Object.assign(document.createElement('div'), { className: 'svc-row' + (settings.poolCur && settings.poolCur.startsWith(f) ? ' cur' : ''), title: f, tabIndex: 0 });
    row.append(document.createTextNode('📁 ' + baseName(f)));
    const del = Object.assign(document.createElement('button'), { className: 'remove', textContent: '×', title: 'Открепить папку (файлы не удаляются)' });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      settings.poolFolders = settings.poolFolders.filter((x) => x !== f);
      if (settings.poolCur && settings.poolCur.startsWith(f)) settings.poolCur = settings.poolFolders[0] || '';
      saveSettings();
      renderPool();
    });
    row.append(del);
    row.addEventListener('click', () => poolOpenDir(f));
    box.append(row);
  }
  if (!settings.poolFolders.length) {
    box.append(Object.assign(document.createElement('p'), { className: 'svc-tip', textContent: 'Нажмите «＋», чтобы закрепить папку с фото, видео или музыкой.' }));
  }
}

function poolOpenDir(dir) {
  settings.poolCur = dir;
  saveSettings();
  $('poolFilter').value = '';
  renderPool();
}

async function renderPool() {
  renderPoolFolders();
  const cur = settings.poolCur || settings.poolFolders[0] || '';
  $('poolPath').textContent = cur;
  $('poolPath').title = cur;
  // Выше закреплённой папки не поднимаемся
  $('poolUp').disabled = !cur || settings.poolFolders.some((f) => f.replace(/[\\/]+$/, '') === cur.replace(/[\\/]+$/, ''));
  if (poolWatched !== cur && window.api.poolWatch) { poolWatched = cur; window.api.poolWatch(cur); }
  if (!cur) { poolData = { dirs: [], files: [] }; drawPoolGrid(''); return; }
  // Уже открывали эту папку — сразу показываем, что было, потом сверяем с диском
  const old = poolSeen.get(cur);
  if (old) { poolData = old; drawPoolGrid(''); }
  const res = await window.api.poolList(cur);
  if ((settings.poolCur || settings.poolFolders[0] || '') !== cur) return; // пока читали, открыли другую папку
  poolSeen.set(cur, res);
  if (old && res.ok && JSON.stringify(res) === JSON.stringify(old)) return;
  poolData = res;
  drawPoolGrid(res.ok ? '' : `Не удалось открыть: ${res.error}`);
}

function drawPoolGrid(msg) {
  const grid = $('poolGrid');
  grid.replaceChildren();
  if (msg) { grid.append(Object.assign(document.createElement('div'), { className: 'pool-msg', textContent: msg })); return; }
  const q = $('poolFilter').value.trim().toLowerCase();
  const match = (n) => !q || n.toLowerCase().includes(q);
  for (const d of poolData.dirs.filter((x) => match(x.name))) {
    const t = Object.assign(document.createElement('div'), { className: 'pf dir', title: d.name, tabIndex: 0 });
    t.append(Object.assign(document.createElement('div'), { className: 'pv icon', textContent: '📁' }), Object.assign(document.createElement('div'), { className: 'pn', textContent: d.name }));
    t.addEventListener('click', () => poolOpenDir(d.path));
    grid.append(t);
  }
  for (const f of poolData.files.filter((x) => match(x.name))) {
    const vis = f.type === 'image' || f.type === 'video';
    const t = Object.assign(document.createElement('div'), { className: 'pf', title: `${f.name}\n${vis ? 'Щелчок — на экран (слой «Медиа», под текстом)' : f.type === 'audio' ? 'Enter — включить' : 'Enter — в открытый список'}, правая кнопка — меню и «Предпросмотр», перетащите — в плейлист или библиотеку`, draggable: true, tabIndex: 0 });
    // Превью в настоящих пропорциях: высота одна, ширина — как у самого файла
    const pv = Object.assign(document.createElement('div'), { className: 'pv' + (f.type === 'video' ? ' vid' : '') });
    // Лёгкая миниатюра; на экран и в плейлист идёт сам файл в полном качестве
    if (f.type === 'image' || f.type === 'video') pv.append(thumbImg(f));
    else { pv.classList.add('icon'); pv.textContent = f.type === 'audio' ? '♪' : '▤'; }
    const add = Object.assign(document.createElement('button'), { className: 'padd', textContent: '＋', title: 'Добавить в открытую вкладку' });
    add.addEventListener('click', (e) => { e.stopPropagation(); poolAdd(f); });
    t.append(pv, Object.assign(document.createElement('div'), { className: 'pn', textContent: f.name }), add);
    t.dataset.path = f.path; // сюда можно бросить макрос (macros.js)
    if (typeof mcFileBadge === 'function') mcFileBadge(t, f.path);
    // Настоящее перетаскивание файла — его примут плейлист, вкладка «Экран» и редактор
    t.addEventListener('dragstart', (e) => {
      e.preventDefault();
      // Порог сдвига уже проверила Windows (4 px) — свой порог больше не нужен: с ним плавное перетаскивание считалось щелчком
      poolDrag = { path: f.path, until: Date.now() + 120000 };
      window.api.startDrag(f.path);
    });
    // Щелчок — фото и видео сразу на экран (слой «Медиа»); музыка и прочее — только выбор
    t.addEventListener('click', () => poolClick(f, t));
    t.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      mediaMenu(e, f, [
        ...(vis ? [{ label: 'Предпросмотр', fn: () => poolPopup(f, e) }] : []),
        { label: f.type === 'audio' ? 'Включить музыку' : 'Показать на экране', key: 'Enter', fn: () => poolShow(f) },
        { label: 'Добавить в открытый список', fn: () => poolAdd(f) },
        ...(f.type === 'audio' ? [{ label: 'Открыть в аудиоредакторе', fn: () => openAudioEditor(f, { kind: 'file' }) }] : []), '-']);
    });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); poolShow(f); } });
    grid.append(t);
  }
  if (!grid.children.length) grid.append(Object.assign(document.createElement('div'), { className: 'pool-msg', textContent: q ? 'Ничего не найдено' : 'В этой папке нет фото, видео, музыки и презентаций' }));
}

function poolClick(f, tile) {
  if (tile) tile.focus();
  if (f.type === 'image' || f.type === 'video') poolShow(f);
}

// Маленькое окошко просмотра (меню → «Предпросмотр»), как у источников; экран не трогает
function poolPopup(f, e) {
  popOpen('file:' + f.path, f.name, { ...poolContent(f), sound: false }, e, [
    { text: 'На экран', title: 'Показать на внешнем экране (слой «Медиа»)', fn: () => poolShow(f) },
    { text: 'В плейлист', title: 'Добавить в открытый плейлист или библиотеку', fn: () => poolAdd(f) },
  ]);
}

const poolContent = (f) => ({ type: f.type, url: f.url, fit: poolFitValue(), sound: settings.videoSound, loop: settings.videoLoop, style: styleOf('media', f) });

// Фото и видео — в слой «Медиа», под презентацией: текст на экране и лента остаются
function poolShow(f) {
  if (f.type === 'audio') return playAudioItem(f);
  if (f.type !== 'image' && f.type !== 'video') return poolAdd(f);
  const id = autoLayer(poolContent(f));
  const old = layerOn[id];
  if (old && old.content.url === f.url) return; // уже на экране — видео не начинается сначала
  // Подсветку «на экране» снимаем, только если её ставил прежний пункт этого слоя
  const m = (old && old.marks) || {};
  if (m.plShown && plShown === m.plShown) plShown = null;
  if (m.bShown && bShown === m.bShown) bShown = null;
  if (m.live >= 0 && live === m.live) live = -1;
  present(() => poolContent(f), f.name, false, id);
  queueMicrotask(() => { if (layerOn[id]) layerOn[id].marks = {}; });
  if (typeof mcMediaShown === 'function') mcMediaShown(f); // триггеры и привязанные макросы (macros.js)
}

// Бросили файл из медиапула: добавить, только если отпустили над списком (строка слева, «Содержание», лента).
// true — бросок разобран (в том числе «мимо» — тогда ничего не добавляется)
function poolDrop(e, paths) {
  if (!isPoolDrag(e) || !paths.includes(poolDrag.path)) return false;
  poolDrag = null;
  const row = e.target.closest && e.target.closest('.svc-row[data-view]');
  const into = row || (e.target.closest && e.target.closest('#contentBox, #svcFeed'));
  if (!into) return true;
  if (row) {
    const v = keyView(row.dataset.view);
    if (row.dataset.view !== viewKey()) setView(v.kind, v.id);
  } else if (into.id === 'svcFeed') browseWork(); // в ленту — в её список
  svcAddPaths(paths, true);
  return true;
}

async function poolAdd(f) {
  if (tab === 'service') return svcAddPaths([f.path], true);
  if (tab === 'music' || f.type === 'audio') { musicAdd([f]); return; }
  inLists(() => svcAddPaths([f.path], true))();
}

// В открытой папке появился или пропал файл — медиапул обновляется сам
if (window.api.onPoolChanged) window.api.onPoolChanged((dir) => {
  poolSeen.delete(dir);
  if (dir !== (settings.poolCur || settings.poolFolders[0] || '') || $('pool').hidden) return;
  const foc = document.activeElement && document.activeElement.closest && document.activeElement.closest('#poolGrid .pf');
  const keep = foc && foc.dataset.path;
  const top = $('poolGrid').scrollTop;
  renderPool().then(() => {
    $('poolGrid').scrollTop = top; // прокрутку не сбрасываем
    if (keep) { const t = [...$('poolGrid').children].find((x) => x.dataset.path === keep); if (t) t.focus({ preventScroll: true }); }
  });
});

$('poolToggle').addEventListener('click', togglePool);
$('poolClose').addEventListener('click', togglePool);
$('poolAdd').addEventListener('click', async () => {
  const dir = await window.api.poolPickFolder();
  if (!dir) return;
  if (!settings.poolFolders.includes(dir)) settings.poolFolders.push(dir);
  poolOpenDir(dir);
});
$('poolUp').addEventListener('click', () => { if (settings.poolCur) poolOpenDir(parentDir(settings.poolCur)); });
$('poolFilter').addEventListener('input', () => drawPoolGrid(''));

$('poolGrip').addEventListener('pointerdown', (e) => {
  const grip = e.currentTarget;
  const start = e.clientY;
  const startH = $('pool').offsetHeight;
  grip.setPointerCapture(e.pointerId);
  grip.classList.add('drag');
  const move = (ev) => {
    settings.poolH = Math.round(Math.max(130, Math.min(window.innerHeight - 260, startH + start - ev.clientY)));
    applyPool();
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

applyPool();
if (settings.poolOpen) renderPool();

/* ===== Список мест Писания → закладки ===== */

// Делим текст на места: строки, «;», и запятая, если после неё начинается новая книга («Ин 3:16, Рим 8:28»)
function splitRefList(text) {
  return String(text)
    .replace(/[–—]/g, '-')
    .split(/\r?\n|;|,(?=\s*(?:[1-3]\s*)?[A-Za-zА-Яа-яЁё])/)
    .map((s) => s.replace(/^\s*[-•*·]\s*/, '').trim())
    .filter(Boolean);
}

// В книгах из одной главы (Флм, Иуд, 2–3 Ин) «Флм 3» — это стих 3, а не глава 3
function oneChapterFix(r) {
  if (!r || r.v1 || r.ch <= 1 || !bible) return r;
  const bi = Bible.findBook(bible, r.token);
  if (bi < 0 || bible.books[bi].chapters.filter((c) => c.length).length !== 1) return r;
  return { ...r, ch: 1, v1: r.ch, v2: r.ch };
}

function importRefList(text, replace) {
  if (!bible) return { added: [], bad: ['сначала добавьте перевод Библии'] };
  if (replace) bookmarks = [];
  const added = [];
  const bad = [];
  let lastBook = '';
  for (const part of splitRefList(text)) {
    // «12:1-2» без книги — та же книга, что в предыдущем месте
    const src = /^\d+(\s*[:.]\s*\d+)?(\s*-\s*\d+)?$/.test(part) && lastBook ? `${lastBook} ${part}` : part;
    const r = oneChapterFix(Bible.parseRef(src));
    const bi = r ? Bible.findBook(bible, r.token) : -1;
    const chapter = bi >= 0 ? bible.books[bi].chapters[r.ch - 1] : null;
    if (!chapter || !chapter.length || (r.v1 && !chapter[r.v1 - 1])) { bad.push(part); continue; }
    lastBook = r.token;
    const bm = {
      id: newId(), canon: bible.books[bi].canon || 0, bi, ci: r.ch - 1, book: bible.books[bi].name,
      v1: r.v1 || null, v2: r.v1 ? Math.min(r.v2, chapter.length) : null,
    };
    if (!bookmarks.some((b) => b.canon === bm.canon && b.bi === bm.bi && b.ci === bm.ci && b.v1 === bm.v1 && b.v2 === bm.v2)) bookmarks.push(bm);
    added.push(bmRef(bm));
  }
  saveBookmarks();
  renderBookmarks();
  return { added, bad };
}

function openRefList() {
  if (!bible) { showNotice('Сначала добавьте перевод Библии', true); return; }
  $('refListResult').replaceChildren();
  $('refListDialog').showModal();
  $('refListText').focus();
}

$('bmImport').addEventListener('click', openRefList);
$('bmClearAll').addEventListener('click', async () => {
  if (!bookmarks.length || !(await askYes(`Удалить все закладки (${bookmarks.length})?`, 'Удалить все', true))) return;
  bookmarks = [];
  saveBookmarks();
  renderBookmarks();
});
$('refListAdd').addEventListener('click', () => {
  const { added, bad } = importRefList($('refListText').value, $('refListReplace').checked);
  const box = $('refListResult');
  box.replaceChildren();
  if (added.length) box.append(Object.assign(document.createElement('div'), { textContent: `✓ Добавлено в закладки (${added.length}): ${added.join(', ')}` }));
  if (bad.length) box.append(Object.assign(document.createElement('div'), { className: 'bad', textContent: `✗ Не удалось понять (${bad.length}): ${bad.join(' · ')}` }));
  if (!added.length && !bad.length) box.append(Object.assign(document.createElement('div'), { className: 'bad', textContent: 'Список пуст' }));
  if (added.length) {
    setDockOpen(true);
    if (!bad.length) { $('refListText').value = ''; $('refListReplace').checked = false; }
  }
});
// Текстовый файл со списком можно бросить прямо в окно
$('refListDialog').addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
$('refListDialog').addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const f = e.dataTransfer.files[0];
  if (f) $('refListText').value = ($('refListText').value ? $('refListText').value + '\n' : '') + (await f.text());
  else $('refListText').value += e.dataTransfer.getData('text/plain');
});

/* ===== Цвета программы (Настройки → Оформление) ===== */

const UI_COLORS = [
  ['--ink', 'Фон окна', '#051822'],
  ['--panel', 'Панели', '#0d212b'],
  ['--field', 'Поля и кнопки', '#12272f'],
  ['--line', 'Рамки', '#2d383e'],
  ['--text', 'Текст', '#d4c9c7'],
  ['--muted', 'Подписи', '#969a9e'],
  ['--live', 'Акцент: кнопки и выделение', '#aa7452'],
  ['--brown', 'Второй акцент', '#7c5841'],
  ['--warn', 'Ошибки', '#e07a6a'],
];

// Готовые темы программы (settings.uiTheme). Цвета по порядку UI_COLORS: фон, панели, поля, рамки, текст, подписи, акцент, второй акцент, ошибки.
// Свои цвета (settings.uiColors) кладутся поверх выбранной темы. Новая тема — строка здесь.
const UI_THEMES = [
  { id: 'navy', name: 'Тёмно-синяя', c: ['#051822', '#0d212b', '#12272f', '#2d383e', '#d4c9c7', '#969a9e', '#aa7452', '#7c5841', '#e07a6a'] },
  { id: 'graphite', name: 'Графит', c: ['#1b1c1f', '#232529', '#2c2f34', '#3c4047', '#e3e4e6', '#9a9ea6', '#4f8cff', '#3a64b8', '#ff6b6b'] },
  { id: 'midnight', name: 'Полночь', c: ['#000000', '#0b0b0d', '#151518', '#2a2a30', '#f0f0f0', '#8c8c95', '#f5c400', '#b38f00', '#ff5c5c'] },
  { id: 'forest', name: 'Лес', c: ['#0e1a14', '#14241b', '#1b2e23', '#2c4234', '#dce8df', '#93a89a', '#4cbf7a', '#2f8a55', '#ef7d6d'] },
  { id: 'wine', name: 'Бордо', c: ['#1a0f13', '#24151b', '#2e1b22', '#46293a', '#ecdfe2', '#a8949a', '#d4566f', '#9b3a4f', '#ff8a65'] },
  { id: 'violet', name: 'Сирень', c: ['#140f22', '#1c1630', '#241d3b', '#3a3058', '#e6e0f5', '#a197bb', '#9b7bff', '#6a4fd0', '#ff7a8a'] },
  { id: 'light', name: 'Светлая', c: ['#eef1f5', '#ffffff', '#f4f6f9', '#cfd6df', '#1d2733', '#5f6b7a', '#2f6fe0', '#8a5a2b', '#c8372d'], light: true },
  // Спокойные темы: мягкий контраст, без ярких цветов — меньше устают глаза на долгих служениях
  { id: 'mono', name: 'Монохром', c: ['#1e1e1e', '#252525', '#2d2d2d', '#3a3a3a', '#c8c8c8', '#8a8a8a', '#a8a8a8', '#6e6e6e', '#c98a8a'] },
  { id: 'monoDeep', name: 'Монохром ночь', c: ['#121212', '#181818', '#1f1f1f', '#2b2b2b', '#b4b4b4', '#767676', '#9a9a9a', '#5c5c5c', '#b47c7c'] },
  { id: 'monoLight', name: 'Монохром светлая', c: ['#e4e4e2', '#ededeb', '#f4f4f2', '#c6c6c3', '#2e2e2e', '#6a6a68', '#4a4a4a', '#7a7a78', '#a8443c'], light: true },
  { id: 'sepia', name: 'Сепия', c: ['#1d1a16', '#25211c', '#2d2822', '#3f382f', '#d8ccb8', '#9a8e7c', '#c49a5e', '#8c6c40', '#d2826c'] },
  { id: 'paper', name: 'Бумага', c: ['#ebe4d6', '#f4eee2', '#faf6ee', '#d3c8b4', '#3b3328', '#75695a', '#8a5f2e', '#a07a50', '#b0463a'], light: true },
  { id: 'slate', name: 'Сланец', c: ['#161b20', '#1c232a', '#232b33', '#334049', '#cdd5dc', '#8796a2', '#6fa3c4', '#4a7590', '#d98478'] },
  { id: 'ocean', name: 'Океан', c: ['#071a1f', '#0c242b', '#112e36', '#21444e', '#d2e6ea', '#8aa9b0', '#3cb4c8', '#257a8a', '#ef8070'] },
  { id: 'contrast', name: 'Контраст', c: ['#000000', '#000000', '#111111', '#5a5a5a', '#ffffff', '#c8c8c8', '#ffd400', '#00b3ff', '#ff4a4a'] },
  // «Свечение» (deco: 'aura', index.html): чёрный фон, тёплое свечение снизу, матовое стекло, кнопки-«таблетки» с градиентом.
  // fx — эффекты, которые ставятся вместе с темой (потом их можно поменять ползунками)
  { id: 'ember', name: 'Жар', deco: 'aura', fx: { uiGlass: 'glass', uiAlpha: 24, uiGlow: 45, uiRadius: 12 },
    c: ['#0a0a0b', '#141416', '#1c1c1f', '#2c2c31', '#f2f0ee', '#8e8c93', '#ff6a1f', '#ffb347', '#ff4d5e'] },
  { id: 'neon', name: 'Неон', deco: 'aura', fx: { uiGlass: 'glass', uiAlpha: 24, uiGlow: 40, uiRadius: 12 },
    c: ['#0b0b0b', '#151515', '#1d1d1d', '#2c2c2c', '#ffffff', '#a7a7a7', '#1ed760', '#3cc8c8', '#ff5c5c'] },
  // «Янтарь» (deco: 'amber', index.html): серая, акцент жёлтый. Ползунок — линия со шкалой и тёмной ручкой в жёлтом ореоле,
  // перемотка — «таблетка», громкость и крутилки — шкала из рисок, переключатели — белая таблетка
  { id: 'amber', name: 'Янтарь', deco: 'amber', fx: { uiGlass: '', uiAlpha: 16, uiGlow: 30, uiRadius: 10 },
    c: ['#1f2023', '#28292d', '#313237', '#43454b', '#ededed', '#9c9ea5', '#ffc21a', '#f08c1e', '#ff5a5f'] },
];

// Правка тем владельцем (localStorage cp.uiThemes): over — изменённые готовые темы {id: {c, fx, light}},
// mine — свои темы {id: 'u…', name, deco, c, fx, light, mine: true}, hide — удалённые из списка (id темы или 'p:'+id пресета).
// Готовые темы не стираются: «Вернуть удалённые» показывает их снова, «Вернуть исходную» снимает правку.
let uiUser = { hide: [], over: {}, mine: [] };
try { uiUser = { ...uiUser, ...JSON.parse(localStorage.getItem('cp.uiThemes') || '{}') }; } catch { /* нет — стандартные */ }
const saveUiUser = () => { try { localStorage.setItem('cp.uiThemes', JSON.stringify(uiUser)); } catch { showNotice('Не удалось сохранить темы', true); } };
const uiThemesAll = () => [...UI_THEMES.map((t) => (uiUser.over[t.id] ? { ...t, ...uiUser.over[t.id], edited: true } : t)), ...uiUser.mine];
const uiTheme = () => { const all = uiThemesAll(); return all.find((t) => t.id === settings.uiTheme) || all[0]; };
// Итоговые цвета: тема + свои поправки; scheme — светлая или тёмная (для полей ввода и полос прокрутки)
function uiPalette() {
  const t = uiTheme();
  const c = settings.uiColors || {};
  const out = {};
  UI_COLORS.forEach(([v], i) => { out[v] = c[v] || t.c[i]; });
  out.scheme = t.light && !c['--ink'] ? 'light' : uiBright(out['--ink']) ? 'light' : 'dark';
  return out;
}
const uiBright = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b > 150; };

function applyUiColors() {
  const p = uiPalette();
  const root = document.documentElement.style;
  for (const [v] of UI_COLORS) root.setProperty(v, p[v]);
  root.setProperty('--live-ink', p['--ink']);
  root.colorScheme = p.scheme;
  // Логотип: на светлом фоне программы — тёмные буквы (logo-light-…), на тёмном — светлые
  $('brandLogo').src = p.scheme === 'light' ? 'brand/logo-light-transparent.svg' : 'brand/logo-dark-transparent.svg';
  applyUiFx(p);
  // Запасная копия оформления: если настройки когда-нибудь испортятся, тема не пропадёт
  const fx = Object.fromEntries(UI_FX.map((k) => [k, settings[k]]));
  try { localStorage.setItem('cp.look', JSON.stringify({ uiTheme: uiTheme().id, uiColors: settings.uiColors || {}, ...fx })); } catch { /* не страшно */ }
}

// Эффекты оформления: свечение акцента (uiGlow 0–100), панели (uiGlass: '' | 'glass' | 'liquid', старое true = 'glass'),
// прозрачность панелей (uiAlpha 0–60 %), скругление углов (uiRadius, px у кнопок), шрифт (uiFont, UI_FONTS), заглавные (uiCaps)
const UI_FX = ['uiGlow', 'uiGlass', 'uiRadius', 'uiAlpha', 'uiFont', 'uiCaps'];
// Шрифты — только системные Windows (внешние подключать нельзя): Bahnschrift — техничный DIN, Cascadia Mono — моноширинный
const UI_FONTS = [
  ['', 'Обычный (Segoe UI)'],
  ['tech', 'Технический (Bahnschrift)'],
  ['narrow', 'Технический узкий'],
  ['geo', 'Геометрический (Century Gothic)'], // есть, где стоит Office; нет — Segoe UI Variable Display
  ['mono', 'Моноширинный (Cascadia Mono)'],
];
const uiGlassMode = () => (settings.uiGlass === 'liquid' ? 'liquid' : settings.uiGlass ? 'glass' : '');
function applyUiFx(p) {
  const html = document.documentElement;
  const root = html.style;
  const r = Number.isFinite(+settings.uiRadius) ? +settings.uiRadius : 6;
  root.setProperty('--rk', String(r / 6)); // все углы в index.html — calc(Npx * var(--rk))
  const k = Math.max(0, Math.min(100, +settings.uiGlow || 0)) / 100;
  html.classList.toggle('ui-glow', k > 0);
  root.setProperty('--glow', k > 0 ? `0 0 ${Math.round(4 + 16 * k)}px color-mix(in srgb, var(--live) ${Math.round(35 + 50 * k)}%, transparent)` : '0 0 0 transparent');
  root.setProperty('--glow-px', Math.round(3 + 8 * k) + 'px');
  // Стекло / Liquid glass: панели и поля полупрозрачные поверх мягкого градиента окна; прозрачность — uiAlpha
  const mode = uiGlassMode();
  html.classList.toggle('ui-glass', !!mode);
  html.classList.toggle('ui-liquid', mode === 'liquid');
  if (mode) {
    const a = Math.max(0, Math.min(60, Number.isFinite(+settings.uiAlpha) ? +settings.uiAlpha : 16));
    root.setProperty('--panel', `color-mix(in srgb, ${p['--panel']} ${100 - a}%, transparent)`);
    root.setProperty('--field', `color-mix(in srgb, ${p['--field']} ${Math.max(20, 100 - a * 1.4)}%, transparent)`);
  }
  html.dataset.uiFont = UI_FONTS.some(([id]) => id === settings.uiFont) ? settings.uiFont : '';
  html.dataset.uiDeco = uiTheme().deco || ''; // особое оформление темы (свечение, «таблетки»)
  html.classList.toggle('ui-caps', !!settings.uiCaps);
  const ctl = ['aura', 'amber'].includes(html.dataset.uiDeco); // темы со своими ползунками, переключателями и крутилками
  html.classList.toggle('ui-ctl', ctl);
  auraRun(ctl);
}

/* ===== Элементы управления тем «Жар»/«Неон» (deco 'aura'; CSS — index.html, «Элементы управления aura») =====
   Ползунки: заливка до значения (--pct). Крутилки — круглая ручка-шкала вместо ползунка у Fade In/Out и плагинов
   аудиоредактора: сам ползунок прячется (класс knobbed), крутилка двигает его и шлёт обычные input/change —
   вся старая логика работает как была. Тянуть вверх/вправо — больше, колесо — по шагу, двойной щелчок — по умолчанию. */
const KNOB_SEL = '.ae-prm input[type=range], .fade-box input[type=range]';
let auraTimer = 0;
const rangePct = (r) => { const min = +r.min || 0, max = r.max === '' ? 100 : +r.max; return max > min ? ((+r.value - min) / (max - min)) * 100 : 0; };
function auraSyncRanges() {
  for (const r of document.querySelectorAll('input[type=range]')) {
    const p = rangePct(r).toFixed(1) + '%';
    if (r.style.getPropertyValue('--pct') !== p) r.style.setProperty('--pct', p);
    if (r.matches(KNOB_SEL) && !r.classList.contains('knobbed')) makeKnob(r);
    if (r._knob) knobShow(r, p);
  }
}
// Крутилка показывает значение: --pct — дуга шкалы, --ang — поворот ручки (−135°…+135°)
function knobShow(r, p) {
  const k = r._knob;
  k.style.setProperty('--pct', p);
  k.style.setProperty('--ang', (parseFloat(p) * 2.7 - 135).toFixed(1) + 'deg');
  k.classList.toggle('off', r.disabled);
}
function auraRun(on) {
  clearInterval(auraTimer);
  auraTimer = 0;
  if (!on) return;
  auraSyncRanges();
  auraTimer = setInterval(auraSyncRanges, 200); // перемотка песни и прочие значения меняются из кода — догоняем
}
document.addEventListener('input', (e) => {
  const r = e.target;
  if (r && r.type === 'range' && auraTimer) { const p = rangePct(r).toFixed(1) + '%'; r.style.setProperty('--pct', p); if (r._knob) knobShow(r, p); }
}, true);

function makeKnob(r) {
  r.classList.add('knobbed');
  const k = Object.assign(document.createElement('span'), { className: 'ui-knob', tabIndex: 0, title: 'Тяните вверх/вниз или крутите колесом; двойной щелчок — по умолчанию' });
  k.setAttribute('role', 'slider');
  if (r.getAttribute('aria-label')) k.setAttribute('aria-label', r.getAttribute('aria-label'));
  k.innerHTML = '<i class="kn-ticks"></i><i class="kn-arc"></i><i class="kn-cap"><b></b></i>';
  r._knob = k;
  r.after(k);
  const lim = () => ({ min: +r.min || 0, max: r.max === '' ? 100 : +r.max, step: r.step === 'any' ? 0 : +r.step || 1 });
  const set = (v, fin) => {
    const { min, max, step } = lim();
    v = Math.max(min, Math.min(max, v));
    if (step) v = Math.round((v - min) / step) * step + min;
    v = +v.toFixed(4);
    if (String(v) !== r.value) { r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }
    if (fin) r.dispatchEvent(new Event('change', { bubbles: true }));
  };
  k.addEventListener('pointerdown', (e) => {
    if (r.disabled || e.button !== 0) return;
    e.preventDefault();
    k.focus();
    k.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, v0 = +r.value, { min, max } = lim();
    const move = (ev) => set(v0 + ((y0 - ev.clientY + ev.clientX - x0) / 160) * (max - min));
    const up = () => { k.removeEventListener('pointermove', move); k.removeEventListener('pointerup', up); k.removeEventListener('pointercancel', up); set(+r.value, true); };
    k.addEventListener('pointermove', move);
    k.addEventListener('pointerup', up);
    k.addEventListener('pointercancel', up);
  });
  k.addEventListener('wheel', (e) => {
    if (r.disabled) return;
    e.preventDefault();
    const { min, max, step } = lim();
    set(+r.value + (e.deltaY < 0 ? 1 : -1) * (step || (max - min) / 100), true);
  }, { passive: false });
  k.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation(); // стрелки не листают слайды
    const { min, max, step } = lim();
    set(+r.value + d * (step || (max - min) / 100), true);
  });
  k.addEventListener('dblclick', () => r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); // общий сброс из icons.js
}

// Карточка темы: маленький образец окна (c — 9 цветов по порядку UI_COLORS) и название
function uiThemeCard(name, c, deco, pressed, onClick, title, sub) {
  const b = Object.assign(document.createElement('button'), { className: 'ui-theme', title });
  b.setAttribute('aria-pressed', String(pressed));
  const pv = Object.assign(document.createElement('span'), { className: 'ui-th-pv' });
  pv.style.cssText = `--a:${c[0]};--b:${c[1]};--c:${c[3]};--d:${c[4]};--e:${c[6]};--f:${c[7]}`;
  if (deco) pv.dataset.deco = deco;
  pv.innerHTML = '<i></i><i></i><i></i>';
  const lab = Object.assign(document.createElement('span'), { textContent: name });
  if (sub) lab.append(Object.assign(document.createElement('small'), { className: 'ui-th-sub', textContent: sub }));
  b.append(pv, lab);
  b.addEventListener('click', onClick);
  return b;
}

// Пресеты настроек с оформлением (есть uiTheme) — тоже темы программы: карточкой в «Теме программы»
const lookPresets = () => presets.filter((p) => p && p.settings && p.settings.uiTheme);
// «Отпечаток» оформления — чтобы подсветить карточку пресета, который сейчас включён
function lookKey(s) {
  const c = s.uiColors || {};
  return JSON.stringify([s.uiTheme || '', Object.keys(c).sort().map((k) => [k, c[k]]), UI_FX.map((k) => s[k] ?? null)]);
}
// Включить только оформление пресета (тема, свои цвета, эффекты) — без перезагрузки окна
function applyLookPreset(p) {
  const s = p.settings;
  settings.uiPreset = p.id; // «Сохранить в тему» тогда пишет в этот пресет
  settings.uiTheme = s.uiTheme;
  settings.uiColors = clone(s.uiColors || {});
  for (const k of UI_FX) if (s[k] !== undefined) settings[k] = clone(s[k]);
  saveSettings();
  applyUiColors();
  renderUiColors();
  flashStatus(`Тема программы: «${p.name}» (пресет)`);
}

function renderUiColors() {
  // Готовые темы и пресеты с оформлением — карточками с маленьким образцом окна
  const cards = $('uiThemes');
  const cur = uiLookCur();
  const hide = new Set(uiUser.hide);
  const all = uiThemesAll();
  const tip = ' · правый щелчок — изменить, удалить';
  cards.replaceChildren(
    ...all.filter((t) => !hide.has(t.id)).map((t) => {
      const b = uiThemeCard(t.name, t.c, t.deco, !cur.preset && t.id === cur.theme.id, () => setUiTheme(t.id),
        `Тема программы «${t.name}»${tip}`, t.mine ? 'своя' : t.edited ? 'изменена' : '');
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); uiThemeMenu(e, t, null); });
      return b;
    }),
    ...lookPresets().filter((p) => !hide.has('p:' + p.id)).map((p) => {
      const t = all.find((x) => x.id === p.settings.uiTheme) || all[0];
      const c = UI_COLORS.map(([v], i) => (p.settings.uiColors || {})[v] || t.c[i]);
      const b = uiThemeCard(p.name, c, t.deco, cur.preset === p, () => applyLookPreset(p),
        `Пресет «${p.name}»: включить только его оформление (остальные настройки не меняются)${tip}`, 'пресет');
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); uiThemeMenu(e, t, p); });
      return b;
    }),
  );
  const n = uiUser.hide.length;
  $('uiThemeSave').textContent = `Сохранить в «${cur.preset ? cur.preset.name : cur.theme.name}»`;
  $('uiThemeRestore').hidden = !n;
  $('uiThemeRestore').textContent = `Вернуть удалённые (${n})`;
  const box = $('uiColors');
  box.replaceChildren();
  const pal = uiPalette();
  for (const [v, label] of UI_COLORS) {
    const row = Object.assign(document.createElement('div'), { className: 'ui-color' });
    const input = Object.assign(document.createElement('input'), { type: 'color', value: pal[v] });
    const code = Object.assign(document.createElement('code'), { textContent: input.value + ((settings.uiColors || {})[v] ? ' · свой' : '') });
    input.addEventListener('input', () => {
      settings.uiColors = { ...settings.uiColors, [v]: input.value };
      code.textContent = input.value + ' · свой';
      applyUiColors();
    });
    input.addEventListener('change', saveSettings);
    row.append(Object.assign(document.createElement('span'), { textContent: label }), Object.assign(document.createElement('span'), { className: 'btns-row', style: 'margin:0;align-items:center' }));
    row.lastChild.append(code, input);
    box.append(row);
  }
  // Эффекты
  $('uiGlow').value = +settings.uiGlow || 0;
  $('uiRadius').value = Number.isFinite(+settings.uiRadius) ? +settings.uiRadius : 6;
  $('uiGlass').value = uiGlassMode();
  $('uiAlpha').value = Number.isFinite(+settings.uiAlpha) ? +settings.uiAlpha : 16;
  $('uiFont').value = settings.uiFont || '';
  $('uiCaps').checked = !!settings.uiCaps;
  uiFxLabels();
}
function uiFxLabels() {
  $('uiGlowVal').textContent = +$('uiGlow').value ? $('uiGlow').value + '%' : 'выкл.';
  $('uiRadiusVal').textContent = $('uiRadius').value + ' px';
  $('uiAlphaVal').textContent = $('uiAlpha').value + '%';
  $('uiAlpha').disabled = !$('uiGlass').value; // прозрачность — только у стеклянных панелей
}
$('uiFont').replaceChildren(...UI_FONTS.map(([v, t]) => new Option(t, v)));
for (const id of ['uiGlow', 'uiRadius', 'uiAlpha']) {
  $(id).addEventListener('input', () => { settings[id] = +$(id).value; uiFxLabels(); applyUiColors(); });
  $(id).addEventListener('change', saveSettings);
}
$('uiGlass').addEventListener('change', () => { settings.uiGlass = $('uiGlass').value; uiFxLabels(); applyUiColors(); saveSettings(); });
$('uiFont').addEventListener('change', () => { settings.uiFont = $('uiFont').value; applyUiColors(); saveSettings(); });
$('uiCaps').addEventListener('change', () => { settings.uiCaps = $('uiCaps').checked; applyUiColors(); saveSettings(); });

// Выбрать готовую тему: свои поправки цветов прежней темы убираются
function setUiTheme(id) {
  const had = Object.keys(settings.uiColors || {}).length > 0;
  delete settings.uiPreset;
  settings.uiTheme = id;
  settings.uiColors = {};
  const fx = uiTheme().fx;
  if (fx) Object.assign(settings, fx); // тема со своими эффектами — стекло, свечение, углы
  saveSettings();
  applyUiColors();
  renderUiColors();
  flashStatus(`Тема программы: «${uiTheme().name}»` + (fx ? ' · с эффектами темы' : '') + (had ? ' · свои цвета сброшены' : ''));
}

$('uiReset').addEventListener('click', () => {
  settings.uiColors = {};
  saveSettings();
  applyUiColors();
  renderUiColors();
});

/* ===== Правка тем программы: сохранить изменения, новая тема, удалить, вернуть ===== */

// Что сейчас включено: тема и, если включали карточку пресета, сам пресет (туда и сохраняем)
function uiLookCur() {
  const ps = lookPresets();
  const preset = ps.find((p) => p.id === settings.uiPreset && p.settings.uiTheme === settings.uiTheme)
    || ps.find((p) => lookKey(p.settings) === lookKey(settings)) || null;
  return { theme: uiTheme(), preset };
}
// Текущий вид целиком: итоговые цвета (тема + свои) и эффекты
function uiLookNow() {
  const pal = uiPalette();
  const c = UI_COLORS.map(([v]) => pal[v]);
  return { c, fx: Object.fromEntries(UI_FX.filter((k) => settings[k] != null).map((k) => [k, clone(settings[k])])), light: uiBright(c[0]) };
}
// Сделать тему (или пресет) текущей без своих поправок — они уже вписаны в неё
function uiUseLook(t, p) {
  settings.uiTheme = t.id;
  settings.uiColors = p ? clone(p.settings.uiColors || {}) : {};
  if (p) settings.uiPreset = p.id; else delete settings.uiPreset;
  saveSettings();
  applyUiColors();
  renderUiColors();
}
function uiThemeSaveTo(t, p) {
  const look = uiLookNow();
  if (p) {
    Object.assign(p.settings, { uiTheme: settings.uiTheme, uiColors: clone(settings.uiColors || {}) }, look.fx);
    savePresets();
    uiUseLook(uiTheme(), p);
    flashStatus(`Оформление сохранено в пресет «${p.name}»`);
    return;
  }
  const rec = { c: look.c, fx: look.fx, light: look.light };
  if (t.mine) Object.assign(uiUser.mine.find((x) => x.id === t.id), rec);
  else uiUser.over[t.id] = rec;
  saveUiUser();
  uiUseLook(t, null);
  flashStatus(`Тема «${t.name}» сохранена` + (t.mine ? '' : ' · правый щелчок по ней — «Вернуть исходную»'));
}
function uiThemeDelete(t, p) {
  const key = p ? 'p:' + p.id : t.id;
  const shown = uiThemesAll().filter((x) => !uiUser.hide.includes(x.id) && x.id !== key);
  if (!shown.length) { flashStatus('Последнюю тему удалить нельзя'); return; }
  const cur = uiLookCur();
  const was = p ? cur.preset === p : !cur.preset && cur.theme.id === t.id;
  uiUser.hide.push(key);
  saveUiUser();
  if (was) setUiTheme(shown[0].id); else renderUiColors();
  flashStatus(`Тема «${p ? p.name : t.name}» убрана из списка · «Вернуть удалённые» — показать снова`);
}
function uiThemeMenu(e, t, p) {
  const items = [
    { label: 'Включить', fn: () => (p ? applyLookPreset(p) : setUiTheme(t.id)) },
    { label: 'Сохранить сюда текущий вид', fn: () => uiThemeSaveTo(t, p) },
  ];
  if (!p && t.mine) items.push({ label: 'Переименовать…', fn: async () => {
    const name = await askName('Название темы', t.name);
    if (!name) return;
    uiUser.mine.find((x) => x.id === t.id).name = name;
    saveUiUser();
    renderUiColors();
  } });
  if (!p && t.edited) items.push({ label: 'Вернуть исходную', fn: () => {
    delete uiUser.over[t.id];
    saveUiUser();
    if (uiTheme().id === t.id) uiUseLook(uiTheme(), null); else renderUiColors();
    flashStatus(`Тема «${t.name}» — снова как была`);
  } });
  items.push('-', { label: 'Удалить из списка', fn: () => uiThemeDelete(t, p) });
  showMenu(e, items);
}
$('uiThemeSave').addEventListener('click', () => { const cur = uiLookCur(); uiThemeSaveTo(cur.theme, cur.preset); });
$('uiThemeNew').addEventListener('click', async () => {
  const cur = uiLookCur();
  const name = await askName('Название новой темы', (cur.preset ? cur.preset.name : cur.theme.name) + ' — моя');
  if (!name) return;
  const t = { id: 'u' + Date.now().toString(36), name, deco: cur.theme.deco || '', mine: true, ...uiLookNow() };
  uiUser.mine.push(t);
  saveUiUser();
  uiUseLook(t, null);
  flashStatus(`Новая тема «${name}» сохранена`);
});
$('uiThemeDel').addEventListener('click', () => { const cur = uiLookCur(); uiThemeDelete(cur.theme, cur.preset); });
$('uiThemeRestore').addEventListener('click', () => {
  const n = uiUser.hide.length;
  uiUser.hide = [];
  saveUiUser();
  renderUiColors();
  flashStatus(`Возвращено тем: ${n}`);
});

// Настройки пропали или испортились, а запасная копия оформления есть — вернуть тему из неё
if (!settings.uiTheme) {
  try {
    const look = JSON.parse(localStorage.getItem('cp.look') || 'null');
    if (look && look.uiTheme) {
      settings.uiTheme = look.uiTheme;
      if (!Object.keys(settings.uiColors || {}).length && look.uiColors) settings.uiColors = look.uiColors;
      for (const k of UI_FX) if (look[k] != null) settings[k] = look[k];
      saveSettings();
    }
  } catch { /* нет копии — стандартная тема */ }
}

/* ===== Пресеты настроек: сохранить, включить, перенести файлом ===== */

// Эти настройки привязаны к компьютеру — в пресет не попадают
const PRESET_SKIP = ['audioSink', 'poolCur', 'bibleId', 'repo', 'backupParts'];

let presets = [];
try { presets = JSON.parse(localStorage.getItem('cp.presets') || '[]'); } catch { presets = []; }
const savePresets = () => { try { localStorage.setItem('cp.presets', JSON.stringify(presets)); } catch { showNotice('Не удалось сохранить пресеты', true); } };

function settingsSnapshot() {
  const s = clone(settings);
  for (const k of PRESET_SKIP) delete s[k];
  return s;
}

function renderPresets() {
  const box = $('presetRows');
  box.replaceChildren();
  if (!presets.length) box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Пресетов пока нет.' }));
  for (const p of presets) {
    const row = Object.assign(document.createElement('div'), { className: 'preset-row' });
    const name = Object.assign(document.createElement('div'), { className: 'pname', textContent: p.name });
    name.append(Object.assign(document.createElement('small'), {
      textContent: new Date(p.date).toLocaleString('ru-RU') + (p.themes ? ` · с темами слайдов (${p.themes.length})` : ''),
    }));
    const b = (text, fn, cls) => { const x = Object.assign(document.createElement('button'), { textContent: text, className: cls || '' }); x.addEventListener('click', fn); return x; };
    row.append(name,
      b('Включить', () => applyPreset(p), 'primary'),
      b('В файл…', () => exportPreset(p)),
      b('Удалить', async () => {
        if (!(await askYes(`Удалить пресет «${p.name}»?`, 'Удалить', true))) return;
        presets = presets.filter((x) => x !== p);
        savePresets();
        renderPresets();
      }));
    box.append(row);
  }
  renderUiColors(); // пресеты с оформлением — ещё и карточками в «Теме программы»
}

$('presetSave').addEventListener('click', async () => {
  const name = await askName('Название пресета', 'Мои настройки ' + new Date().toLocaleDateString('ru-RU'));
  if (!name) return;
  const p = { id: newId(), name, date: Date.now(), settings: settingsSnapshot() };
  if ($('presetWithThemes').checked && lib) { p.themes = clone(lib.themes); p.themeFor = clone(lib.themeFor); }
  presets.push(p);
  savePresets();
  renderPresets();
});

async function applyPreset(p) {
  if (!(await askYes(`Включить пресет «${p.name}»? Текущие настройки заменятся, окно программы обновится.`, 'Включить'))) return;
  const keep = {};
  for (const k of PRESET_SKIP) keep[k] = settings[k];
  // Меняется только то, что есть в пресете: пресет «только цвета» не трогает мониторы, клавиши и прочее.
  // Оформление — только из пресетов с темой программы (uiTheme); старые пресеты тему не сбрасывают
  const ps = clone(p.settings);
  if (!ps.uiTheme) for (const k of ['uiTheme', 'uiColors', ...UI_FX]) delete ps[k];
  Object.assign(settings, ps, keep);
  saveSettings();
  if (p.themes && lib) {
    // Темы из пресета добавляются к своим; с тем же id — заменяются
    for (const t of p.themes) {
      const i = lib.themes.findIndex((x) => x.id === t.id);
      if (i >= 0) lib.themes[i] = clone(t); else lib.themes.push(clone(t));
      if (lib.themesLive) delete lib.themesLive[t.id]; // тема из пресета — сразу применённая
    }
    if (p.themeFor) lib.themeFor = { ...lib.themeFor, ...p.themeFor };
    await window.api.libSave(lib);
  }
  location.reload(); // проще всего заново собрать окно с новыми настройками
}

async function exportPreset(p) {
  const file = await window.api.saveJson({ name: p.name, data: { app: 'church-presenter', kind: 'settings-preset', version: 1, preset: p } });
  if (file) savedFlash($('presetImport'), 'Сохранено в файл');
}

$('presetImport').addEventListener('click', async () => {
  const res = await window.api.openJson();
  if (!res) return;
  const list = res.ok && res.data ? (res.data.preset ? [res.data.preset] : Array.isArray(res.data.presets) ? res.data.presets : []) : [];
  const good = list.filter((p) => p && typeof p.settings === 'object' && p.settings);
  if (!good.length) { showNotice('В этом файле нет пресета multiplayerSHOW', true); return; }
  for (const p of good) presets.push({ ...clone(p), id: newId(), name: String(p.name || 'Пресет'), date: p.date || Date.now() });
  savePresets();
  renderPresets();
  savedFlash($('presetImport'), `Загружено: ${good.length}`);
});

// Короткая надпись на кнопке вместо всплывающего сообщения
function savedFlash(btn, text) {
  const old = btn.textContent;
  btn.textContent = '✓ ' + text;
  setTimeout(() => { btn.textContent = old; }, 1800);
}

applyUiColors();

/* ===== Репозиторий: папка, куда программа сама складывает все данные (main.js, «Репозиторий») ===== */

// Части репозитория — те же id, что REPO_PARTS в main.js
const REPO_NAMES = [
  ['library', 'Библиотеки, плейлисты, презентации', 'песни, слайды, места из Библии, типы частей песни'],
  ['files', 'Медиафайлы и шрифты', 'фото, видео, музыка, слайды PowerPoint — может быть много'],
  ['themes', 'Темы слайдов', 'темы и шаблоны для песен, Библии, картинок'],
  ['macros', 'Макросы', ''],
  ['screens', 'Экраны, сцены, таймеры', 'выходы, макеты, пресеты сцен'],
  ['bibles', 'Переводы Библии', ''],
  ['bibleSet', 'Настройки Библии', 'переводы на экране, деление стихов'],
  ['bookmarks', 'Закладки Библии', ''],
  ['settings', 'Настройки программы', 'экран и вывод, показ, звук, музыка'],
  ['layout', 'Расположение панелей', 'ширины, порядок блоков, свёрнутое'],
  ['look', 'Оформление программы', 'тема и цвета'],
  ['keys', 'Горячие клавиши', ''],
  ['presets', 'Пресеты настроек', ''],
  ['ink', 'Рисунки на слайдах', ''],
  ['lists', 'Списки «Медиа» и «Музыка»', ''],
  ['pool', 'Папки медиапула и музыки', ''],
];
// Старые резервные копии (до репозитория) — только восстановить
const OLD_PARTS = [
  ['library', 'Библиотеки, плейлисты и презентации', ''], ['themes', 'Темы слайдов', ''], ['bibles', 'Переводы Библии', ''],
  ['files', 'Сами файлы', ''], ['settings', 'Настройки', ''], ['keys', 'Горячие клавиши', ''], ['look', 'Оформление', ''],
  ['presets', 'Пресеты настроек', ''], ['bookmarks', 'Закладки Библии', ''], ['ink', 'Рисунки на слайдах', ''],
  ['lists', 'Списки «Экран» и «Музыка»', ''], ['pool', 'Папки медиапула', ''],
];
const REPO_ALL = REPO_NAMES.map(([id]) => id);

// settings.repo = { dir, parts, auto, hold } — hold: в выбранной папке уже есть данные, пишем только после решения владельца
if (!settings.repo || typeof settings.repo !== 'object') settings.repo = { dir: '', parts: REPO_ALL.slice(), auto: true, hold: false };
if (!Array.isArray(settings.repo.parts)) settings.repo.parts = REPO_ALL.slice();
const repo = () => settings.repo;
let repoLast = null; // { date, files } — последнее сохранение (не в настройках, чтобы не зацикливать запись)
try { repoLast = JSON.parse(localStorage.getItem('cp.repoLast') || 'null'); } catch { repoLast = null; }

function partBoxes(box, table, ids, checked, onChange) {
  box.replaceChildren();
  for (const [id, name, note] of table.filter(([x]) => ids.includes(x))) {
    const l = Object.assign(document.createElement('label'), { className: 'check', title: note });
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', value: id, checked: checked.includes(id) });
    if (onChange) cb.addEventListener('change', onChange);
    l.append(cb, document.createTextNode(' ' + name));
    if (note) l.append(Object.assign(document.createElement('small'), { textContent: ` (${note})` }));
    box.append(l);
  }
}
const checkedParts = (box) => [...box.querySelectorAll('input:checked')].map((c) => c.value);

// Всё из localStorage, что принадлежит программе (кроме служебной отметки о сохранении)
function lsSnapshot() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('cp.') && k !== 'cp.repoLast') out[k] = localStorage.getItem(k);
  }
  return out;
}

let repoTimer = 0;
let repoLibDirty = true; // библиотека менялась с последней записи (в начале — да: догнать)
let repoLastLs = '';
let repoBusy = false;
let repoWarned = false;
// Что-то поменялось — записать через несколько секунд (lib — из flushLib, остальное — из saveSettings и раз в полминуты)
function repoTouch(kind) {
  if (kind === 'lib') repoLibDirty = true;
  const r = repo();
  if (!r.dir || !r.auto || r.hold) return;
  clearTimeout(repoTimer);
  repoTimer = setTimeout(() => repoSyncNow(false), 1500); // почти сразу: правки за 1,5 с — одна запись
}

// Перед закрытием: несохранённая библиотека — на диск, дождаться идущей записи и записать последнее
async function repoFinal() {
  if (typeof saveTimer !== 'undefined' && saveTimer) flushLib();
  else if (typeof lib !== 'undefined' && lib) await window.api.libSave(lib).catch(() => {});
  const r = repo();
  if (!r.dir || !r.auto || r.hold) return;
  while (repoBusy) await new Promise((ok) => setTimeout(ok, 100));
  repoClosing = true; // beforeunload уже не нужен
  await repoSyncNow(false);
}
let repoClosing = false;

// mode: '' — точная копия программы (удалённое убирается и из папки), 'add' — дополнить (ничего не удаляется), 'replace' — очистить и записать заново (по кнопке)
async function repoSyncNow(manual, mode) {
  clearTimeout(repoTimer);
  const r = repo();
  if (!r.dir || repoBusy) { if (repoBusy) repoTimer = setTimeout(() => repoSyncNow(manual, mode), 3000); return null; }
  const ls = lsSnapshot();
  const lsStr = JSON.stringify(ls);
  if (!manual && !repoLibDirty && lsStr === repoLastLs) return null; // ничего нового
  if (typeof saveTimer !== 'undefined' && saveTimer) flushLib(); // свежая библиотека — на диск
  repoBusy = true;
  repoLibDirty = false;
  repoLastLs = lsStr;
  if (manual) $('repoState').textContent = 'Сохраняю в репозиторий…';
  let res = null;
  try { res = await window.api.repoSync({ dir: r.dir, parts: r.parts, ls, mode }); } catch (err) { res = { ok: false, error: String(err) }; }
  repoBusy = false;
  if (res && res.ok) {
    repoWarned = false;
    repoLast = { date: res.date, files: res.files };
    try { localStorage.setItem('cp.repoLast', JSON.stringify(repoLast)); } catch { /* не страшно */ }
  } else {
    repoLibDirty = true;
    repoLastLs = '';
    if (!repoWarned || manual) {
      repoWarned = true;
      showNotice(res && res.missing
        ? `Папка репозитория не найдена: ${r.dir}. Подключите флешку или диск, или выберите папку заново (Настройки → Репозиторий).`
        : 'Не удалось сохранить в репозиторий' + (res && res.error ? ': ' + res.error : ''), true);
    }
  }
  if ($('setDialog').open) renderRepoState();
  return res;
}

function renderRepoState() {
  const r = repo();
  const st = $('repoState');
  st.classList.toggle('off', !r.dir || r.hold);
  if (!r.dir) st.textContent = 'Репозиторий не подключён. Нажмите «Выбрать папку…» — например, папку на флешке или в облачном диске.';
  else if (r.hold) st.textContent = `Папка: ${r.dir}. В ней уже есть данные — возьмите нужное ниже («Восстановить») или нажмите «Отправить в репозиторий»: ваши данные добавятся к тем, что в папке, ничего не удалится.`;
  else {
    const when = repoLast && repoLast.date ? new Date(repoLast.date).toLocaleString('ru-RU') : 'ещё не сохранялось';
    st.textContent = `Папка: ${r.dir} · последнее сохранение: ${when}` + (repoLast && repoLast.files ? ` · файлов: ${repoLast.files}` : '') + (r.auto ? '' : ' · автосохранение выключено');
  }
  for (const id of ['repoNow', 'repoOpen', 'repoOff', 'repoReplace']) $(id).disabled = !r.dir;
  $('repoAuto').checked = !!r.auto;
  $('repoAuto').disabled = !r.dir;
}

async function renderRepo() {
  renderRepoState();
  partBoxes($('repoParts'), REPO_NAMES, REPO_ALL, repo().parts, () => {
    repo().parts = checkedParts($('repoParts'));
    saveSettings();
  });
  $('dataPath').textContent = await window.api.dataPath();
}

$('repoAll').addEventListener('click', () => { repo().parts = REPO_ALL.slice(); saveSettings(); renderRepo(); });
$('repoNone').addEventListener('click', () => { repo().parts = []; saveSettings(); renderRepo(); });
$('repoAuto').addEventListener('change', () => {
  repo().auto = $('repoAuto').checked;
  saveSettings();
  renderRepoState();
  if (repo().auto) repoTouch('lib');
});

$('repoPick').addEventListener('click', async () => {
  const res = await window.api.repoPick();
  if (!res) return;
  const r = repo();
  r.dir = res.dir;
  r.hold = !!res.existing;
  saveSettings();
  renderRepoState();
  if (res.existing) { openRestore({ ok: true, kind: 'repo', dir: res.dir, date: res.existing.date, parts: res.existing.parts }); return; }
  const done = await repoSyncNow(true);
  if (done && done.ok) flashStatus('Репозиторий подключён — данные сохранены в папку');
});

$('repoNow').addEventListener('click', async () => {
  // Папка с чужими данными (hold): первый раз — дополнить, ничего из неё не убирая; дальше — точная копия программы
  const first = repo().hold;
  repo().hold = false;
  saveSettings();
  const res = await repoSyncNow(true, first ? 'add' : '');
  if (res && res.ok) savedFlash($('repoNow'), res.changed ? 'Отправлено' : 'Уже всё в папке');
});
// Заменить содержимое папки: всё, что в ней было от программы, удаляется, пишется только текущее
$('repoReplace').addEventListener('click', async () => {
  const r = repo();
  if (!r.dir) return;
  if (!(await askYes(`Вы точно хотите заменить содержимое репозитория?\n\n${r.dir}\n\nВсё, что сейчас лежит в этой папке (песни, темы, файлы — в том числе с других компьютеров), будет удалено, и туда запишется только то, что есть в программе сейчас. Вернуть удалённое из папки будет нельзя.`, 'Заменить', true))) return;
  r.hold = false;
  saveSettings();
  const res = await repoSyncNow(true, 'replace');
  if (res && res.ok) flashStatus('Репозиторий записан заново — в нём только текущие данные программы');
});
$('repoOpen').addEventListener('click', () => window.api.repoReveal(repo().dir));
$('repoOff').addEventListener('click', () => {
  repo().dir = '';
  repo().hold = false;
  saveSettings();
  renderRepoState();
  flashStatus('Репозиторий отключён — папка с данными осталась на месте');
});

// Раз в полминуты — не поменялось ли что-то, что пишется мимо saveSettings (закладки, рисунки, списки)
setInterval(() => repoTouch(), 10000);
setTimeout(() => repoTouch('lib'), 8000); // после запуска — догнать то, что было до него
// Окно закрывается не через свой вопрос (перезагрузка окна и т. п.): отправить что есть, main.js дождётся записи
window.addEventListener('beforeunload', () => {
  if (typeof saveTimer !== 'undefined' && saveTimer) flushLib();
  const r = repo();
  if (!repoClosing && r.dir && r.auto && !r.hold) window.api.repoSync({ dir: r.dir, parts: r.parts, ls: lsSnapshot() }).catch(() => {});
});

/* ----- Восстановить из репозитория или старой резервной копии ----- */

let restoreSrc = null; // { kind, dir }
function openRestore(res) {
  restoreSrc = { kind: res.kind, dir: res.dir };
  const table = res.kind === 'repo' ? REPO_NAMES : OLD_PARTS;
  $('restoreInfo').textContent = (res.kind === 'repo' ? 'Репозиторий' : 'Резервная копия') + ` от ${new Date(res.date).toLocaleString('ru-RU')} (${res.dir}). Что в нём есть:`;
  partBoxes($('restoreParts'), table, res.parts, res.parts);
  $('restoreReplace').hidden = res.kind !== 'repo'; // старые копии — только как раньше
  $('restoreGo').textContent = res.kind === 'repo' ? 'Добавить в программу' : 'Восстановить выбранное';
  $('restoreBox').hidden = false;
}

$('restorePick').addEventListener('click', async () => {
  const res = await window.api.repoOpen();
  if (!res) return;
  if (!res.ok) { showNotice('В этой папке нет репозитория или резервной копии multiplayerSHOW', true); return; }
  openRestore(res);
});

// mode: 'add' — добавить к своему (ничего не удаляется), 'replace' — у отмеченного оставить только то, что в папке
async function restoreRun(mode) {
  const parts = checkedParts($('restoreParts'));
  if (!restoreSrc || !parts.length) { if (restoreSrc) flashStatus('Отметьте, что восстановить'); return; }
  const table = restoreSrc.kind === 'repo' ? REPO_NAMES : OLD_PARTS;
  const list = parts.map((p) => '• ' + (table.find(([id]) => id === p) || [p, p])[1]).join('\n');
  const ask = restoreSrc.kind === 'backup'
    ? `Восстановить из копии:\n${list}\n\n${parts.includes('library') ? 'Текущие библиотеки и плейлисты будут заменены.\n' : ''}Окно программы обновится.`
    : mode === 'replace'
      ? `Вы точно хотите ЗАМЕНИТЬ данные программы?\n\n${list}\n\nУ этих пунктов в программе останется только то, что есть в папке репозитория, — всё остальное уберётся. Прежние данные программа отложит в папку «прежние данные <дата>» рядом со своими данными. Окно программы обновится.`
      : `Добавить в программу из папки:\n${list}\n\nВаше не удаляется: новое добавится, то же самое обновится. Окно программы обновится.`;
  if (!(await askYes(ask, restoreSrc.kind === 'backup' ? 'Восстановить' : mode === 'replace' ? 'Заменить' : 'Добавить', mode === 'replace'))) return;
  if (!restoreSrc) return; // пока спрашивали, источник сбросили
  clearTimeout(saveTimer); // чтобы старая библиотека из памяти не перезаписала восстановленную
  saveTimer = 0;
  clearTimeout(repoTimer);
  repoClosing = true; // и при перезагрузке окна старое не ушло в репозиторий (beforeunload)
  if (restoreSrc.kind === 'backup') { await restoreOldBackup(restoreSrc.dir, parts); return; }
  const res = await window.api.repoRestore({ dir: restoreSrc.dir, parts, mode, ls: lsSnapshot() });
  if (!res || !res.ok) { repoClosing = false; showNotice('Не удалось восстановить из этой папки', true); return; }
  const keep = settings.repo;
  Object.assign(settings, res.set || {});
  for (const k of res.dropSet || []) delete settings[k];
  settings.repo = keep;
  // Репозиторий не подключён или это он и есть — дальше программа пишет в эту папку
  if (!keep.dir || keep.dir === restoreSrc.dir) { keep.dir = restoreSrc.dir; keep.hold = false; }
  saveSettings();
  try {
    for (const [k, v] of Object.entries(res.ls || {})) if (k.startsWith('cp.') && k !== 'cp.settings') localStorage.setItem(k, v);
    for (const k of res.dropLs || []) if (k.startsWith('cp.') && k !== 'cp.settings') localStorage.removeItem(k);
  } catch { showNotice('Часть настроек не удалось записать', true); }
  location.reload();
}
$('restoreGo').addEventListener('click', () => restoreRun('add'));
$('restoreReplace').addEventListener('click', () => restoreRun('replace'));

// Старая резервная копия (manifest.json, local.json)
async function restoreOldBackup(dir, parts) {
  const res = await window.api.backupRestore({ dir, parts });
  if (!res || !res.ok) { showNotice('Не удалось восстановить из этой копии', true); return; }
  const l = res.local || {};
  const has = (p) => parts.includes(p);
  if (has('settings') && l.settings) {
    const s = { ...l.settings };
    for (const k of ['uiTheme', 'uiColors', ...UI_FX, 'repo']) delete s[k]; // оформление — только пунктом «Оформление»
    Object.assign(settings, s);
  }
  if (has('keys') && l.keys) settings.keys = l.keys;
  if (has('look') && l.uiColors) settings.uiColors = l.uiColors;
  if (has('look') && l.uiTheme) settings.uiTheme = l.uiTheme;
  if (has('look')) for (const k of UI_FX) if (l[k] != null) settings[k] = l[k];
  if (has('pool') && l.poolFolders) settings.poolFolders = [...new Set([...(settings.poolFolders || []), ...l.poolFolders])];
  saveSettings();
  try {
    if (has('presets') && l.presets) {
      for (const p of l.presets) { const i = presets.findIndex((x) => x.id === p.id); if (i >= 0) presets[i] = p; else presets.push(p); }
      savePresets();
    }
    if (has('bookmarks') && l.bookmarks) {
      const keyOf = (b) => [b.canon, b.bi, b.ci, b.v1, b.v2].join('|');
      const seen = new Set(bookmarks.map(keyOf));
      localStorage.setItem('cp.bookmarks', JSON.stringify(bookmarks.concat(l.bookmarks.filter((b) => !seen.has(keyOf(b))))));
    }
    if (has('ink') && l.ink) localStorage.setItem('cp.ink', JSON.stringify({ ...inkStore, ...l.ink }));
    if (has('lists')) {
      if (l.media) localStorage.setItem('cp.media', JSON.stringify(l.media));
      if (l.tracks) localStorage.setItem('cp.tracks', JSON.stringify(l.tracks));
      if (l.musicLists) localStorage.setItem('cp.musicLists', JSON.stringify(l.musicLists));
    }
  } catch { showNotice('Часть настроек не удалось записать', true); }
  location.reload();
}

$('dataOpen').addEventListener('click', () => window.api.dataOpen());

/* ===== Обновление программы: новые версии с GitHub (main.js, «Обновление программы») ===== */

if (settings.updAuto === undefined) settings.updAuto = true; // по умолчанию — проверять при запуске

// Состояние из main.js: { state: dev|checking|none|loading|ready|error, version, percent, error }
function updText(u) {
  switch (u && u.state) {
    case 'dev': return 'Обновление работает только в установленной программе (не при запуске через npm start).';
    case 'checking': return 'Проверяю…';
    case 'none': return 'У вас последняя версия.';
    case 'loading': return `Скачиваю версию ${u.version || ''}… ${u.percent ? u.percent + '%' : ''}`;
    case 'ready': return `Версия ${u.version} скачана. Она установится, когда вы закроете программу, или нажмите «Перезапустить и обновить».`;
    case 'error': return 'Не удалось проверить обновления (нет интернета?)' + (u.error ? ': ' + u.error.split('\n')[0].slice(0, 160) : '');
    default: return 'Новые версии берутся с GitHub.';
  }
}
let updLast = null;
function showUpd(u) {
  const was = updLast && updLast.state;
  updLast = u;
  $('updState').textContent = updText(u);
  $('updReady').hidden = !(u && u.state === 'ready');
  $('updCheck').disabled = !!u && (u.state === 'checking' || u.state === 'loading');
  if (u && u.state === 'ready' && was !== 'ready') flashStatus(`Скачана новая версия ${u.version} — установится при закрытии программы`);
}

async function renderUpdate() {
  $('updVer').textContent = await window.api.appVersion().catch(() => '—');
  $('updAuto').checked = !!settings.updAuto;
  showUpd(window.api.updGet ? await window.api.updGet().catch(() => null) : null);
}
$('updAuto').addEventListener('change', () => { settings.updAuto = $('updAuto').checked; saveSettings(); });
$('updCheck').addEventListener('click', () => window.api.updCheck());
$('updInstall').addEventListener('click', () => window.api.updInstall());
if (window.api.onUpdate) window.api.onUpdate(showUpd);
// При запуске — проверить через полминуты (не мешать загрузке)
setTimeout(() => { if (settings.updAuto && window.api.updCheck) window.api.updCheck(); }, 30000);
