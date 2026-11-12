/* ---------- Редактор тем (Theme Editor, как в ProPresenter) — вкладка «Темы» окна оператора ----------
   Слева — темы и их шаблоны слайдов, под ними объекты шаблона (порядок наложения, скрыть, замок, перетаскивание);
   по центру — холст: мышью выбрать, двигать, менять размер, поворачивать (привязка к центру, краям, другим объектам,
   безопасной зоне, сетке и направляющим; Alt — без привязки), линейки — потянуть, будет направляющая;
   справа — свойства выбранного (текст, фигура, картинка, видео или сам шаблон).
   Модель — themes.js, отрисовка — scene.js. Темы лежат в lib.themes и сохраняются через saveLib,
   поэтому Ctrl+Z / Ctrl+Shift+Z — общая отмена программы. Стандартные (Themes.BUILTIN) только читаются.
   Пользуется: lib, saveLib, flashStatus, showMenu, newId, clone, THEME_DEFAULTS, setTab, tab, histUndo/histRedo. */

let teThemeId = '';
let teTplId = '';
let teSel = [];        // id выделенных объектов
let teClip = null;     // скопированные объекты — вставляются в любой шаблон любой темы
let teSysFonts = null; // шрифты Windows (main.js: fonts:system)
// Холст — по формату темы (Themes.size: высота 1080, ширина по формату 16:9, 1:1…)
const teSize = () => Themes.size(teTheme());
const teOpenSecs = {}; // какие разделы свойств открыты
const teOpt = (() => {
  const def = { snap: true, grid: false, gridStep: 5, safe: true, rulers: true, keepRatio: false, under: 'check', underUrl: '', underVideo: false, sample: '', sampleText: '', recentFonts: [] };
  try { return { ...def, ...JSON.parse(localStorage.getItem('cp.themeEditor') || '{}') }; } catch { return def; }
})();
const teSaveOpt = () => { try { localStorage.setItem('cp.themeEditor', JSON.stringify(teOpt)); } catch { /* без памяти — не страшно */ } };

/* Режим слайда: правится не тема, а свой вид одного слайда (slide.look — шаблон темы только для него, slides.js).
   teSlide = { item, sid, fresh?, els?, saved? }: fresh — вид только что снят с темы и ещё не менялся (тогда при уходе
   его убираем — слайд остаётся «как в теме»), els — элементы своего слайда до переноса в объекты вида. */
let teSlide = null;
const TE_SLIDE_KINDS = ['text', 'bible', 'custom'];
function teSlideRef() {
  if (!teSlide || !lib) return null;
  const item = lib.items[teSlide.item];
  const slide = item && item.slides.find((s) => s.id === teSlide.sid);
  return slide && TE_SLIDE_KINDS.includes(slide.k) ? { item, slide } : null;
}
// Слайд как «тема» из одного шаблона — так весь редактор работает с ним без переделок
function teSlideTheme() {
  const r = teSlideRef();
  return r ? { id: '', name: r.item.name, style: {}, templates: r.slide.look ? [r.slide.look] : [], slide: r.slide, item: r.item } : null;
}

const teThemes = () => (lib ? lib.themes : []);
const teTheme = () => (teSlide ? teSlideTheme() : Themes.find(teThemes(), teThemeId));
const teTpl = () => {
  const t = teTheme();
  if (t && t.slide) return t.slide.look || null;
  return t ? (t.templates || []).find((x) => x.id === teTplId) || null : null;
};
const teObjs = () => (teTpl() ? teTpl().objs : []);
const teObj = (id) => teObjs().find((o) => o.id === id) || null;
const teSelObjs = () => teSel.map(teObj).filter(Boolean);
const teRO = () => !!(teTheme() && teTheme().std);
const r1 = (v) => Math.round(v * 10) / 10;
const teEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const teIconBtn = (icon, title, fn, cls) => {
  const b = teEl('button', 'icon-only' + (cls ? ' ' + cls : ''));
  b.title = title;
  b.dataset.icon = icon;
  b.prepend(Icons.el(icon));
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
  return b;
};

const TE_SAMPLES = {
  song: { type: 'text', text: 'Велик наш Бог, достоин хвалы\nОн Царь царей и Господь господ' },
  bible: { type: 'text', verses: [{ n: 16, t: 'Ибо так возлюбил Бог мир, что отдал Сына Своего Единородного, дабы всякий верующий в Него не погиб, но имел жизнь вечную.' }], ref: 'Иоанна 3:16', translation: 'Синодальный' },
  long: { type: 'text', text: 'Господь — Пастырь мой; я ни в чём не буду нуждаться:\nОн покоит меня на злачных пажитях\nи водит меня к водам тихим,\nподкрепляет душу мою, направляет меня на стези правды\nради имени Своего.' },
  short: { type: 'text', text: 'Аллилуйя' },
  title: { type: 'text', text: 'Велик наш Бог', ref: 'Псалом 22', translation: 'Синодальный' },
};
const TE_META = { title: 'Велик наш Бог', ccli: 'CCLI 1234567 · Слова и музыка: Имя Фамилия', number: '125', label: 'Куплет 1' };

// Пример для холста и миниатюр: текст по назначению шаблона, выбранный внизу или свой
function teContent(t, tpl, still) {
  if (t && t.slide) { // режим слайда — настоящий текст слайда
    const c = contentOf(t.item, t.slide);
    return { ...c, tpl: tpl.id, style: { ...c.style, tpls: [tpl], tpl: tpl.id, still } };
  }
  let s = teOpt.sample;
  if (s === 'own' && !teOpt.sampleText.trim()) s = '';
  const base = s === 'own' ? { type: 'text', text: teOpt.sampleText.split('|').map((x) => x.trim()).join('\n') }
    : TE_SAMPLES[s] || TE_SAMPLES[{ bible: 'bible', ref: 'bible', title: 'title' }[tpl.use] || 'song'];
  return { ...base, tpl: tpl.id, meta: TE_META, style: { ...THEME_DEFAULTS, ...t.style, tpls: [tpl], showTranslation: true, still } };
}
// Миниатюра: та же сцена, только маленькая
function teMini(content, t) {
  const box = teEl('div', 'te-mini');
  if (t && Themes.aspectOf(t) !== '16:9') box.style.aspectRatio = Themes.aspectOf(t).replace(':', ' / ');
  if (content.style) content = { ...content, style: { ...content.style, bgVideo: false, bgUrl: content.style.bgVideo ? '' : content.style.bgUrl, still: true } };
  box.append(Scene.build(content));
  return box;
}
const teFitMinis = (root) => requestAnimationFrame(() => root.querySelectorAll('.te-mini').forEach((m) => Scene.refit(m)));

/* ===== Открыть вкладку, сохранить ===== */

// Открыть вкладку «Темы» (с нужной темой, если указана) — вместо отдельного окна
function openThemeTab(id) {
  if (id && Themes.find(teThemes(), id)) {
    if (teSlide) { teSlideLeave(); teSel = []; }
    if (id !== teThemeId) { teThemeId = id; teTplId = ''; teSel = []; }
  }
  setTab('themes');
}

/* ===== Режим слайда: свой вид одного слайда ===== */

// Блок своего слайда (старые «элементы») → объект шаблона, чтобы его можно было править как всё остальное
function teElToObj(e, st) {
  const box = { x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot || 0, opacity: e.opacity != null ? e.opacity : 1, radius: e.radius || 0 };
  if (e.kind === 'image') return Themes.obj('image', { ...box, name: 'Картинка', url: e.url || '', path: e.path || '', fit: e.fit === 'cover' ? 'cover' : 'contain' });
  const size = Number(e.size) || 6;
  return Themes.obj('text', {
    ...box, name: String(e.text || 'Текст').split('\n')[0].slice(0, 24) || 'Текст', bind: 'static', text: e.text || '',
    font: e.font || st.font || 'segoe', size, max: size, min: 1, fit: 'shrink', pad: 0, weight: Number(e.weight) || Number(st.weight) || 500,
    italic: !!e.italic, align: e.align || 'center', valign: e.valign || 'middle',
    tfill: { type: 'color', color: e.color || st.color || '#ffffff' }, tshadow: { on: !!st.shadow },
    fill: e.bgColor ? { type: 'color', color: e.bgColor } : { type: 'none' },
  });
}

// Вид слайда «как сейчас по теме»: копия шаблона, который выбрался бы для слайда (у темы без шаблонов — из её оформления)
function teMakeLook(item, slide) {
  const c = contentOf(item, { ...slide, look: undefined });
  const t = Scene.pickTpl(c);
  const base = t ? clone(t) : Themes.fromStyle(c.style || {});
  let objs = (base.objs || []).map((o) => ({ ...clone(o), id: '' }));
  // У своего слайда текст — в его блоках: «Текст слайда» темы ему не нужен, блоки становятся объектами
  if (slide.k === 'custom') objs = objs.filter((o) => !(o.kind === 'text' && o.bind === 'content')).concat((slide.elements || []).map((e) => teElToObj(e, c.style || {})));
  return Themes.tpl({ ...base, id: '', name: 'Свой вид слайда', use: 'any', guides: base.guides || [], objs });
}

// Есть ли у слайда вид; нет — снять с темы (пока не тронут — не сохраняется)
function teSlideEnsure() {
  const r = teSlideRef();
  if (!r) return false;
  if (!r.slide.look) {
    const els = r.slide.elements;
    r.slide.look = teMakeLook(r.item, r.slide);
    if (r.slide.k === 'custom') r.slide.elements = [];
    teSlide.fresh = JSON.stringify(r.slide.look);
    teSlide.els = els;
  } else if (teSlide.fresh && JSON.stringify(r.slide.look) !== teSlide.fresh) {
    delete teSlide.fresh; // вид вернулся отменой/повтором — он сохранён, не убирать
    delete teSlide.els;
  }
  return true;
}
// Нетронутый вид убрать: слайд снова «как в теме» и дальше меняется вместе с ней
function teSlideTidy() {
  const r = teSlideRef();
  if (!r || !teSlide.fresh || !r.slide.look || JSON.stringify(r.slide.look) !== teSlide.fresh) return;
  delete r.slide.look;
  if (teSlide.els) r.slide.elements = teSlide.els;
  delete teSlide.fresh;
  delete teSlide.els;
  if (teSlide.saved) saveLib();
  if (typeof renderService === 'function') renderService();
}
function teSlideLeave() {
  if (!teSlide) return;
  teSlideTidy();
  teSlide = null;
}
// Открыть слайд в редакторе тем («Изменить в редакторе»); sid нет — первый подходящий слайд презентации
function openSlideLook(item, sid) {
  const it = item && lib.items[item.id];
  const slide = it && (it.slides.find((s) => s.id === sid) || (!sid && it.slides.find((s) => TE_SLIDE_KINDS.includes(s.k))));
  if (!slide || !TE_SLIDE_KINDS.includes(slide.k)) return false;
  if (!teSlide || teSlide.item !== it.id || teSlide.sid !== slide.id) {
    teSlideLeave();
    teSlide = { item: it.id, sid: slide.id };
    teSel = [];
  }
  setTab('themes');
  return true;
}
function teSlideGo(sid) {
  const r = teSlideRef();
  if (!r || sid === teSlide.sid) return;
  const item = r.item;
  teSlideLeave();
  teSlide = { item: item.id, sid };
  teSel = [];
  teOpen();
}
function teSlideBack() {
  teSlideLeave();
  teSel = [];
  teOpen();
}
// Слайд сейчас на экране — показать его заново с правками
function teSlideOnAir() {
  if (!teSlide || !plShown || plShown.sid !== teSlide.sid) return null;
  const e = entryByKey(plShown.key, keyView(plShown.view));
  return e && e.item.id === teSlide.item ? plShown : null;
}
// «Как в теме»: убрать свой вид; у своего слайда блоки — его содержимое, поэтому из темы берётся только фон
function teSlideReset() {
  const r = teSlideRef();
  if (!r || !r.slide.look) return;
  if (r.slide.k === 'custom') {
    const c = contentOf(r.item, { ...r.slide, look: undefined });
    const t = Scene.pickTpl(c);
    const base = t || Themes.fromStyle(c.style || {});
    teEdit(() => { r.slide.look.bg = clone(base.bg); r.slide.look.media = base.media ? clone(base.media) : null; }, { insp: true });
    flashStatus('Фон слайда — как в теме · Ctrl+Z — вернуть');
    return;
  }
  delete r.slide.look;
  teSel = [];
  teSave();
  flushLib(); // сохранить без вида, пока редактор не снял новую копию с темы
  teOpen();
  flashStatus('Слайд снова как в теме · Ctrl+Z — вернуть');
}

// Вид слайда из любого шаблона любой темы
function teSlideFromTpl(e) {
  const r = teSlideRef();
  if (!r) return;
  const items = [];
  for (const x of Themes.all(teThemes())) for (const tpl of Themes.templatesOf(x)) {
    items.push({ label: `${x.name} · ${tpl.name}`, fn: () => teEdit(() => {
      const look = r.slide.look;
      if (r.slide.k === 'custom') { // у своего слайда свои блоки остаются, из шаблона — фон
        look.bg = clone(tpl.bg);
        look.media = tpl.media ? clone(tpl.media) : null;
      } else {
        const c = Themes.tpl({ ...clone(tpl), id: look.id, name: 'Свой вид слайда', use: 'any', objs: tpl.objs.map((o) => ({ ...clone(o), id: '' })) });
        r.slide.look = c;
      }
      teSel = [];
    }, { insp: true }) });
  }
  showMenu(e, items);
}

function teOpen() {
  if (!lib) return;
  if (teSlide) {
    if (teSlideEnsure()) { teSel = teSel.filter(teObj); teRenderAll(); return; }
    teSlide = null;
    teSel = [];
    flashStatus('Этого слайда больше нет — открыты темы');
  }
  let t = teTheme();
  if (!t) { t = teThemes()[0] || Themes.BUILTIN[0]; teThemeId = t.id; }
  if (!t.std) { Themes.ensure(t); teFreeze(t); } // старая тема → шаблон из её оформления (перенос); копия для экрана
  if (!teTpl()) teTplId = t.templates[0].id;
  teSel = teSel.filter(teObj);
  teRenderAll();
}
function teRenderAll() { teRenderList(); teLayout(); teRenderCanvas(); teRenderObjs(); teRenderInsp(); teSyncBar(); }

// После общей отмены (Ctrl+Z) темы могли вернуться к прошлому виду
function teAfterUndo() {
  window.api.sendThemes(clone(appliedThemes()));
  if (tab === 'themes') teOpen();
}

/* Черновик и «Применить тему»: правки идут в lib.themes, а экран, миниатюры слайдов и окно редактора слайдов
   берут lib.themesLive[id] — копию на момент открытия темы или последнего «Применить» (themeById в playlist.js).
   Копия снимается при открытии темы, до первой правки; одинаковые с черновиком копии убираются. */
function teFreeze(t) {
  if (!lib.themesLive) lib.themesLive = {};
  const live = lib.themesLive;
  for (const id of Object.keys(live)) {
    const x = lib.themes.find((y) => y.id === id);
    if (!x) delete live[id];
    else if (id !== t.id && JSON.stringify(x) === JSON.stringify(live[id])) delete live[id];
  }
  if (!live[t.id]) live[t.id] = clone(t);
}
// Есть ли у темы неприменённые правки
const teDirty = (t) => !!(t && !t.std && lib.themesLive && lib.themesLive[t.id] && JSON.stringify(lib.themesLive[t.id]) !== JSON.stringify(t));

function teApply() {
  if (teSlide) { // свой вид слайда сохраняется сразу; на экран — по кнопке, если слайд сейчас показан
    const on = teSlideOnAir();
    if (!on) { flashStatus('Этого слайда сейчас нет на экране — правки уже сохранены в слайде'); return; }
    showSlide(on.key, on.sid, on.view);
    flashStatus('Слайд обновлён на экране');
    return;
  }
  const t = teTheme();
  if (!teDirty(t)) { flashStatus('Изменений нет — на экране уже эта тема'); return; }
  lib.themesLive[t.id] = clone(t);
  saveLib();
  window.api.sendThemes(clone(appliedThemes()));
  if (typeof scSend === 'function') scSend(); // экраны со своей темой (screens.js: scLook)
  refreshLive();   // то, что сейчас на экране, — с новой темой
  renderService(); // миниатюры слайдов
  teRenderList();
  teSyncBar();
  flashStatus(`Тема «${t.name}» применена · Ctrl+Z — вернуть`);
}
// Вернуть тему к применённому виду (выбросить черновик)
function teRevert() {
  if (teSlide) { teSlideReset(); return; }
  const t = teTheme();
  if (!teDirty(t)) return;
  const i = lib.themes.indexOf(t);
  lib.themes[i] = clone(lib.themesLive[t.id]);
  teSel = [];
  saveLib();
  teOpen();
  flashStatus('Правки темы сброшены · Ctrl+Z — вернуть');
}

let teSaveTimer = 0;
function teSave() {
  const r = teSlideRef();
  if (r) { // режим слайда: правка — в презентацию (у песни текст слайда уходит и в песню)
    teSlide.saved = true;
    delete teSlide.fresh; // тронут — уже не убираем
    delete teSlide.els;
    touched(r.item);
  } else saveLib();
  clearTimeout(teSaveTimer);
  // Экран не трогаем — правки увидят зрители только после «Применить тему»
  teSaveTimer = setTimeout(() => { renderService(); teSyncBar(); }, 600); // «Тема по умолчанию» могла смениться
}

// Любая правка шаблона: нельзя у стандартной темы; потом — холст, список, сохранение
function teEdit(fn, how = {}) {
  if (teRO()) { flashStatus('Стандартную тему менять нельзя — сделайте свою копию'); return false; }
  fn();
  teRenderCanvas();
  if (how.list !== false) teRenderObjs();
  if (how.insp) teRenderInsp();
  teThumbSoon();
  teSave();
  return true;
}
let teThumbTimer = 0;
function teThumbSoon() {
  clearTimeout(teThumbTimer);
  teThumbTimer = setTimeout(() => { if (tab === 'themes' && !$('teThemes').querySelector('input.rn')) teRenderList(); }, 400);
}

/* ===== Слева: темы и шаблоны ===== */

// Режим слайда: вместо тем — слайды этой презентации; щелчок — править другой слайд
function teRenderSlides(box) {
  const r = teSlideRef();
  if (!r) return;
  const head = teEl('div', 'te-slide-head');
  const back = teEl('button', null, 'Все темы');
  back.prepend(Icons.el('theme'));
  back.title = 'Вернуться к редактору тем';
  back.addEventListener('click', teSlideBack);
  head.append(back, teEl('b', null, r.item.name));
  head.title = 'Свой вид у каждого слайда: правки — только этому слайду, тема и другие слайды не меняются';
  box.append(head);
  const list = teEl('div', 'te-tpls');
  r.item.slides.forEach((s, i) => {
    const ok = TE_SLIDE_KINDS.includes(s.k);
    const row = teEl('div', 'te-tpl' + (s.id === teSlide.sid ? ' sel' : '') + (ok ? '' : ' off'));
    const n = teEl('span', 'nm', `${i + 1}. ${s.label || Slides.SLIDE_NAMES[s.k] || 'Слайд'}`);
    n.append(teEl('small', null, s.id === teSlide.sid && teSlide.fresh ? 'как в теме' : s.look ? 'свой вид' : ok ? 'как в теме' : 'не текстовый слайд'));
    row.append(ok || ['image', 'video'].includes(s.k) ? teMini(contentOf(r.item, s)) : teEl('div', 'te-mini'), n);
    row.title = ok ? 'Щелчок — править этот слайд' : 'Картинку, видео и источник в редакторе тем не правят: у них нет текста темы';
    if (ok) row.addEventListener('click', () => teSlideGo(s.id));
    list.append(row);
  });
  box.append(list);
  teFitMinis(box);
}

function teRenderList() {
  const box = $('teThemes');
  const top = box.scrollTop;
  box.replaceChildren();
  if (teSlide) { teRenderSlides(box); box.scrollTop = top; return; }
  const card = (t) => {
    const c = teEl('div', 'te-theme' + (t.id === teThemeId ? ' sel' : ''));
    const h = teEl('div', 'th-head');
    h.title = t.std ? 'Стандартная тема: только чтение — правьте свою копию' : 'Двойной щелчок — переименовать, правая кнопка — меню';
    const nm = teEl('span', 'nm', t.name);
    const tpl0 = Themes.templatesOf(t)[0];
    h.append(teMini(tpl0 ? teContent(t, tpl0, true) : { ...TE_SAMPLES.song, style: { ...THEME_DEFAULTS, ...t.style } }, t), nm);
    if (t.std) h.append(teEl('span', 'std', 'стандартная'));
    else if (teDirty(t)) h.append(Object.assign(teEl('span', 'std dirty', 'не применена'), { title: 'Есть правки, которых ещё нет на экране — «Применить тему»' }));
    h.addEventListener('click', () => { if (teThemeId === t.id) return; teThemeId = t.id; teTplId = ''; teSel = []; teOpen(); });
    h.addEventListener('dblclick', () => { if (!t.std) teRename(nm, t.name, (v) => { t.name = v; }); });
    h.addEventListener('contextmenu', (e) => { e.preventDefault(); teThemeMenu(e, t); });
    c.append(h);
    if (t.id === teThemeId) {
      const list = teEl('div', 'te-tpls');
      for (const tpl of Themes.templatesOf(t)) {
        const r = teEl('div', 'te-tpl' + (tpl.id === teTplId ? ' sel' : ''));
        r.title = 'Двойной щелчок — переименовать, правая кнопка — копия, порядок, удалить';
        const n = teEl('span', 'nm', tpl.name);
        n.append(teEl('small', null, Themes.USES[tpl.use] || ''));
        r.append(teMini(teContent(t, tpl, true), t), n);
        r.addEventListener('click', () => { if (teTplId === tpl.id) return; teTplId = tpl.id; teSel = []; teRenderAll(); });
        r.addEventListener('dblclick', () => { if (!t.std) teRename(n, tpl.name, (v) => { tpl.name = v; }); });
        r.addEventListener('contextmenu', (e) => { e.preventDefault(); teTplMenu(e, t, tpl); });
        list.append(r);
      }
      if (!t.std) {
        const add = teEl('div', 'te-tpl add', '+ Шаблон');
        add.title = 'Новый шаблон слайда в этой теме (правая кнопка — взять из другой темы)';
        add.addEventListener('click', teAddTpl);
        add.addEventListener('contextmenu', (e) => { e.preventDefault(); teTplFromMenu(e); });
        list.append(add);
      }
      c.append(list);
    }
    box.append(c);
  };
  if (teThemes().length) box.append(teEl('div', 'te-group-title', 'Свои темы'));
  teThemes().forEach(card);
  box.append(teEl('div', 'te-group-title', 'Стандартные'));
  Themes.BUILTIN.forEach(card);
  teFitMinis(box);
  box.scrollTop = top;
}

// Переименовать на месте (не window.prompt)
function teRename(span, value, apply) {
  const inp = Object.assign(document.createElement('input'), { type: 'text', className: 'rn', value });
  span.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (ok && v && v !== value) teEdit(() => apply(v), { insp: true });
    teRenderList();
    teRenderObjs();
  };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('click', (e) => e.stopPropagation());
  inp.addEventListener('dblclick', (e) => e.stopPropagation());
}

const teBody = (p = {}) => Themes.obj('text', { name: 'Текст слайда', bind: 'content', x: 8, y: 10, w: 84, h: 80, size: 9, max: 9, fit: 'both', weight: 600, ...p });

function teNewTheme() {
  const t = Themes.ensure({ id: newId(), name: 'Новая тема', style: { ...THEME_DEFAULTS }, templates: [Themes.tpl({ name: 'Текст песни', use: 'any', objs: [teBody({ tshadow: { on: true } })] })] });
  lib.themes.push(t);
  teThemeId = t.id;
  teTplId = t.templates[0].id;
  teSel = [];
  teSave();
  teOpen();
}
// Своя копия (в т.ч. стандартной): id шаблонов те же — слайды, где шаблон выбран вручную, найдут его и в копии
// aspect — копия сразу под другой формат экрана (1:1, 9:16…)
function teCopyTheme(t, aspect) {
  const c = Themes.ensure({ ...Themes.copy(t), name: t.name.replace(/ \(стандартная\)$/, '') + (aspect ? ` ${aspect}` : t.std ? '' : ' (копия)') });
  if (aspect) Themes.reshape(c, aspect);
  lib.themes.push(c);
  teThemeId = c.id;
  teTplId = '';
  teSel = [];
  teSave();
  teOpen();
  flashStatus(`Создана тема «${c.name}» — её можно менять`);
}
// Переделать тему под другой формат экрана (все шаблоны)
function teReshape(t, aspect) {
  if (Themes.aspectOf(t) === aspect) return;
  if (!teEdit(() => Themes.reshape(t, aspect), { insp: true })) { teRenderInsp(); return; }
  teLayout();
  teRenderList();
  flashStatus(`Тема «${t.name}» — формат ${aspect} · Ctrl+Z — вернуть`);
}
function teDelTheme(t) {
  if (t.std) return;
  lib.themes = lib.themes.filter((x) => x !== t);
  for (const k of Object.keys(lib.themeFor)) if (lib.themeFor[k] === t.id) lib.themeFor[k] = '';
  teThemeId = '';
  teSel = [];
  teSave();
  teOpen();
  flashStatus(`Тема «${t.name}» удалена · Ctrl+Z — вернуть`);
}
function teAddTpl() {
  const t = teTheme();
  if (!t || t.std) { flashStatus('Шаблоны добавляются в свою тему — сделайте копию стандартной'); return; }
  const cur = teTpl();
  const tpl = Themes.tpl({ name: 'Новый шаблон', use: 'any', bg: cur ? clone(cur.bg) : undefined, objs: [teBody({ weight: 500 })] });
  t.templates.push(tpl);
  teTplId = tpl.id;
  teSel = [];
  teSave();
  teRenderAll();
}
// Шаблон из любой темы (в т.ч. стандартной) — копией в открытую
function teTplFromMenu(e) {
  const t = teTheme();
  if (!t || t.std) return;
  const items = [];
  for (const x of Themes.all(teThemes())) for (const tpl of Themes.templatesOf(x)) {
    items.push({ label: `${x.name} · ${tpl.name}`, fn: () => {
      const c = Themes.tpl({ ...clone(tpl), id: '', objs: tpl.objs.map((o) => ({ ...clone(o), id: '', group: '' })) });
      t.templates.push(c);
      teTplId = c.id;
      teSel = [];
      teSave();
      teRenderAll();
    } });
  }
  showMenu(e, items);
}

function teThemeMenu(e, t) {
  const useFor = (k, name) => ({ label: `Тема по умолчанию: ${name}${lib.themeFor[k] === t.id ? ' ✓' : ''}`, fn: () => { lib.themeFor[k] = t.id; teSave(); teRenderInsp(); flashStatus(`«${t.name}» — тема по умолчанию: ${name}`); } });
  showMenu(e, [
    { label: t.std ? 'Сделать свою копию' : 'Копия темы', fn: () => teCopyTheme(t) },
    ...(t.std ? [] : [{ label: 'Переименовать', fn: () => { const n = $('teThemes').querySelector('.te-theme.sel .th-head .nm'); if (n) teRename(n, t.name, (v) => { t.name = v; }); } }]),
    '-',
    useFor('song', 'песни'), useFor('bible', 'Библия'), useFor('media', 'картинки и видео'), useFor('custom', 'свои слайды'),
    '-',
    { label: 'Экспорт темы в файл…', fn: () => teExport([t]) },
    { label: 'Импорт тем из файла…', fn: teImport },
    ...(teThemes().length ? [{ label: 'Экспорт всех своих тем…', fn: () => teExport(teThemes()) }] : []),
    ...(t.std ? [] : ['-', { label: 'Удалить тему', fn: () => teDelTheme(t) }]),
  ]);
}
function teTplMenu(e, t, tpl) {
  const list = t.templates;
  const i = list.indexOf(tpl);
  if (t.std) { showMenu(e, [{ label: 'Сделать свою копию темы', fn: () => teCopyTheme(t) }]); return; }
  showMenu(e, [
    { label: 'Копия шаблона', fn: () => { teEdit(() => { const c = Themes.tpl({ ...clone(tpl), id: '', name: tpl.name + ' (копия)', objs: tpl.objs.map((o) => ({ ...clone(o), id: '', group: '' })) }); list.splice(i + 1, 0, c); teTplId = c.id; teSel = []; }, { insp: true }); teRenderAll(); } },
    { label: 'Взять шаблон из другой темы…', fn: () => teTplFromMenu(e) },
    { label: 'Переименовать', fn: () => { const n = $('teThemes').querySelector('.te-tpl.sel .nm'); if (n && tpl.id === teTplId) teRename(n, tpl.name, (v) => { tpl.name = v; }); } },
    { label: 'Левее', disabled: i === 0, fn: () => { teEdit(() => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; }); teRenderList(); } },
    { label: 'Правее', disabled: i === list.length - 1, fn: () => { teEdit(() => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; }); teRenderList(); } },
    '-',
    { label: 'Удалить шаблон', disabled: list.length < 2, fn: () => { teEdit(() => { list.splice(i, 1); if (teTplId === tpl.id) teTplId = list[Math.max(0, i - 1)].id; teSel = []; }, { insp: true }); teRenderAll(); } },
  ]);
}

async function teExport(list) {
  const file = await window.api.saveJson({ name: list.length === 1 ? list[0].name : 'Темы', data: Themes.exportData(list), title: 'Экспорт темы', label: 'Тема MP Show' });
  if (file) flashStatus('Сохранено: ' + file.split(/[\\/]/).pop());
}
async function teImport() {
  const res = await window.api.openJson({ title: 'Импорт темы', label: 'Тема (JSON)' });
  if (!res) return;
  const list = res.ok ? Themes.importData(res.data) : null;
  if (!list || !list.length) { showNotice('В файле нет тем', true); return; }
  lib.themes.push(...list);
  teThemeId = list[0].id;
  teTplId = '';
  teSel = [];
  teSave();
  teOpen();
  flashStatus(`Добавлено тем: ${list.length}`);
}

$('teAddTheme').addEventListener('click', () => { teSlideLeave(); teNewTheme(); });
$('teImport').addEventListener('click', () => { teSlideLeave(); teImport(); });
$('teExport').addEventListener('click', () => { const t = teTheme(); if (t) teExport([t]); });

/* ===== По центру: холст ===== */

// Масштаб холста: 1 — по размеру места, меньше — мельче, больше — крупнее (тогда холст прокручивается).
// Кнопки «−»/«+» под холстом, Ctrl + колёсико над холстом, щелчок по процентам — по размеру окна
const TE_ZOOM_MIN = 0.1;
const TE_ZOOM_MAX = 4;
let teZoom = Math.max(TE_ZOOM_MIN, Math.min(TE_ZOOM_MAX, Number(settings.teZoom) || 1));
function teSetZoom(z, at) {
  const wrap = $('teWrap');
  z = Math.max(TE_ZOOM_MIN, Math.min(TE_ZOOM_MAX, Math.round(z * 100) / 100));
  if (Math.abs(z - 1) < 0.04) z = 1; // рядом с «по размеру» — прилипает
  // точка под курсором (доля холста) остаётся под курсором
  const R = $('teHost').getBoundingClientRect();
  const W = wrap.getBoundingClientRect();
  const px = at ? at.clientX : W.left + W.width / 2;
  const py = at ? at.clientY : W.top + W.height / 2;
  const fx = R.width ? (px - R.left) / R.width : 0.5;
  const fy = R.height ? (py - R.top) / R.height : 0.5;
  teZoom = z;
  settings.teZoom = z;
  saveSettings();
  teLayout();
  const R2 = $('teHost').getBoundingClientRect();
  wrap.scrollLeft += R2.left + fx * R2.width - px;
  wrap.scrollTop += R2.top + fy * R2.height - py;
}
$('teZoomOut').addEventListener('click', () => teSetZoom(teZoom / 1.25));
$('teZoomIn').addEventListener('click', () => teSetZoom(teZoom * 1.25));
$('teZoomFit').addEventListener('click', () => teSetZoom(1));
$('teWrap').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  teSetZoom(teZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e);
}, { passive: false });

// Сцена (1920×1080 или по формату темы) под место (× teZoom); линейки — вдоль холста
function teLayout() {
  const { w: TE_W, h: TE_H } = teSize();
  const wrap = $('teWrap');
  const host = $('teHost');
  const stage = $('teStage');
  if (!wrap.clientWidth) return;
  wrap.classList.toggle('zoomed', teZoom > 1);
  const fit = Math.min(wrap.clientWidth / TE_W, wrap.clientHeight / TE_H) || 0.1;
  const s = fit * teZoom;
  const w = TE_W * s;
  const h = TE_H * s;
  const pad = teZoom > 1 ? 24 : 0; // крупнее места — поля для линеек и прокрутка
  const left = Math.max(pad, (wrap.clientWidth - w) / 2);
  const top = Math.max(pad, (wrap.clientHeight - h) / 2);
  Object.assign(host.style, { width: w + 'px', height: h + 'px', left: left + 'px', top: top + 'px' });
  Object.assign($('teSpace').style, { left: left + w + pad - 1 + 'px', top: top + h + pad - 1 + 'px' });
  $('teZoomFit').textContent = Math.round(teZoom * 100) + '%';
  $('teZoomOut').disabled = teZoom <= TE_ZOOM_MIN;
  $('teZoomIn').disabled = teZoom >= TE_ZOOM_MAX;
  Object.assign(stage.style, { width: TE_W + 'px', height: TE_H + 'px', transform: `scale(${s})` });
  Scene.refit(stage);
  const rh = $('teRulerH');
  const rv = $('teRulerV');
  rh.hidden = rv.hidden = !teOpt.rulers;
  Object.assign(rh.style, { left: left + 'px', top: top - 18 + 'px', width: w + 'px' });
  Object.assign(rv.style, { left: left - 18 + 'px', top: top + 'px', height: h + 'px' });
  if (!rh.children.length) {
    for (let v = 0; v < 100; v += 10) {
      const a = teEl('span', null, String(v));
      a.style.left = v + '%';
      rh.append(a);
      const b = teEl('span', null, String(v));
      b.style.top = v + '%';
      rv.append(b);
    }
  }
  teRenderOverlay();
}
new ResizeObserver(() => { if (tab === 'themes') teLayout(); }).observe($('teWrap'));

// play — с анимациями появления, иначе спокойная картинка для правки
function teRenderCanvas(play) {
  const t = teTheme();
  const tpl = teTpl();
  if (!t || !tpl) return;
  teRenderUnder();
  const c = teContent(t, tpl, false);
  if (!play) c.edit = true;
  else Scene.clear($('teStage')); // анимации — как при первом показе
  Scene.show($('teStage'), c, { type: 'none', ms: 0 });
  teRenderOverlay();
}

// Что под темой (в тему не сохраняется): шахматка, чёрный, белый, своё фото или видео
function teRenderUnder() {
  const host = $('teHost');
  host.classList.toggle('u-black', teOpt.under === 'black');
  host.classList.toggle('u-white', teOpt.under === 'white');
  const box = $('teUnder');
  const url = teOpt.under === 'file' ? teOpt.underUrl : '';
  if (box.dataset.url === url) return;
  box.dataset.url = url;
  if (!url) { box.replaceChildren(); return; }
  const m = document.createElement(teOpt.underVideo ? 'video' : 'img');
  m.src = url;
  if (teOpt.underVideo) Object.assign(m, { autoplay: true, muted: true, loop: true, playsInline: true });
  box.replaceChildren(m);
}

// Прямоугольник объекта на экране (у «блок по тексту» высота — по отрисованному тексту)
function teRect(o) {
  const r = { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.kind === 'text' && o.fit === 'box') {
    const el = $('teStage').querySelector(`.ob[data-oid="${o.id}"]`);
    if (el && $('teStage').clientHeight) r.h = (el.offsetHeight / $('teStage').clientHeight) * 100;
  }
  return r;
}

let teSnaps = []; // линии привязки, видные во время перетаскивания
function teRenderOverlay() {
  const ov = $('teOverlay');
  const tpl = teTpl();
  ov.replaceChildren();
  if (!tpl) return;
  if (teOpt.grid) {
    const g = teEl('div', 'grid');
    const st = Number(teOpt.gridStep) || 5;
    g.style.backgroundImage = 'linear-gradient(to right, rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.6) 1px, transparent 1px)';
    g.style.backgroundSize = `${st}% ${st}%`;
    ov.append(g);
  }
  const sf = Number(tpl.safe) || 0;
  if (teOpt.safe && sf > 0) {
    const s = teEl('div', 'safe');
    Object.assign(s.style, { left: sf + '%', top: sf + '%', right: sf + '%', bottom: sf + '%' });
    ov.append(s);
  }
  const ro = teRO();
  const one = teSel.length === 1;
  for (const o of tpl.objs) {
    if (o.hidden) continue;
    const r = teRect(o);
    const sel = teSel.includes(o.id);
    const box = teEl('div', 'box' + (sel ? ' sel' : '') + (o.locked ? ' locked' : '') + (o.group ? ' grp' : ''));
    Object.assign(box.style, { left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%', transform: o.rot ? `rotate(${o.rot}deg)` : '' });
    if (sel) box.append(teEl('span', 'bl', o.name + (o.locked ? ' · замок' : '')));
    if (sel && one && !o.locked && !ro) for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rot']) {
      const d = teEl('div', 'handle ' + h);
      d.title = h === 'rot' ? 'Повернуть (Shift — по 15°)' : 'Размер (Shift — с пропорциями)';
      box.append(d);
    }
    box.addEventListener('pointerdown', (ev) => teDown(ev, o));
    box.addEventListener('dblclick', () => { const v = $('teTextVal'); if (v) { v.focus(); v.select(); } });
    box.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (!teSel.includes(o.id)) { teSel = [o.id]; teSelChanged(); } teObjMenu(ev); });
    ov.append(box);
  }
  // Направляющие: тянуть — двигать, за край холста или двойной щелчок — убрать
  (tpl.guides || []).forEach((g, i) => {
    const d = teEl('div', 'guide ' + g.d);
    d.title = 'Направляющая: тяните, чтобы сдвинуть; за край холста или двойной щелчок — убрать';
    if (g.d === 'v') d.style.left = g.v + '%'; else d.style.top = g.v + '%';
    d.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); teGuideDrag(ev, i); });
    d.addEventListener('dblclick', () => teEdit(() => { tpl.guides.splice(i, 1); }, { list: false }));
    ov.append(d);
  });
  for (const g of teSnaps) {
    const d = teEl('div', 'snapline ' + g.d);
    if (g.d === 'v') d.style.left = g.v + '%'; else d.style.top = g.v + '%';
    ov.append(d);
  }
  tePosInfo();
}

// Внизу справа — положение и размер выделенного
function tePosInfo(p) {
  const sel = teSelObjs();
  let s = '';
  if (p) s = `X ${r1(p.x)}%  Y ${r1(p.y)}%`;
  if (sel.length === 1) { const r = teRect(sel[0]); s = (s ? s + '   ·   ' : '') + `${sel[0].name}: ${r1(r.x)}, ${r1(r.y)} — ${r1(r.w)} × ${r1(r.h)}%  (${Math.round(r.w * teSize().w / 100)} × ${Math.round(r.h * teSize().h / 100)} px)`; }
  else if (sel.length > 1) s = (s ? s + '   ·   ' : '') + `Выделено: ${sel.length}`;
  $('tePos').textContent = s;
}
$('teOverlay').addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  const R = $('teOverlay').getBoundingClientRect();
  tePosInfo({ x: ((e.clientX - R.left) / R.width) * 100, y: ((e.clientY - R.top) / R.height) * 100 });
});
$('teOverlay').addEventListener('pointerleave', () => tePosInfo());

function teSelChanged() { teRenderOverlay(); teRenderObjs(); teRenderInsp(); teSyncBar(); }

// Куда можно «прилипнуть»: центр и края экрана, безопасная зона, направляющие, другие объекты, сетка
function teTargets(skip) {
  const xs = [0, 50, 100];
  const ys = [0, 50, 100];
  const tpl = teTpl();
  const sf = Number(tpl.safe) || 0;
  if (teOpt.safe && sf > 0) { xs.push(sf, 100 - sf); ys.push(sf, 100 - sf); }
  for (const g of tpl.guides || []) (g.d === 'v' ? xs : ys).push(g.v);
  for (const o of teObjs()) {
    if (o.hidden || skip.includes(o)) continue;
    const r = teRect(o);
    xs.push(r.x, r.x + r.w / 2, r.x + r.w);
    ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  const st = Number(teOpt.gridStep) || 5;
  if (teOpt.grid) for (let v = 0; v <= 100; v += st) { xs.push(v); ys.push(v); }
  return { xs, ys };
}
const teNear = (v, list, thr) => { let best = null; for (const t of list) if (Math.abs(t - v) <= thr && (best == null || Math.abs(t - v) < Math.abs(best - v))) best = t; return best; };
// Сдвиг блока: прилипает левый край, центр или правый край — что ближе
function teSnapSpan(pos, size, list, thr) {
  let best = null;
  for (const k of [0, 0.5, 1]) {
    const t = teNear(pos + size * k, list, thr);
    if (t != null && (best == null || Math.abs(t - pos - size * k) < Math.abs(best.d))) best = { d: t - pos - size * k, line: t };
  }
  return best;
}

function teDown(ev, o) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  const ids = o.group ? teObjs().filter((x) => x.group === o.group).map((x) => x.id) : [o.id];
  if (ev.shiftKey || ev.ctrlKey) {
    if (teSel.includes(o.id)) teSel = teSel.filter((id) => !ids.includes(id)); else teSel = [...teSel, ...ids];
    teSelChanged();
    return;
  }
  if (!teSel.includes(o.id)) { teSel = ids; teSelChanged(); }
  if (teRO()) return;
  const mode = ev.target.classList.contains('handle') ? [...ev.target.classList].find((c) => c !== 'handle') : 'move';
  const moving = teSelObjs().filter((x) => !x.locked);
  if (!moving.length) return;
  const ov = $('teOverlay');
  const R = ov.getBoundingClientRect();
  const start = moving.map((x) => ({ o: x, x: x.x, y: x.y, w: x.w, h: x.h, rot: x.rot || 0 }));
  const tg = teTargets(moving);
  const thrX = (6 / R.width) * 100;
  const thrY = (6 / R.height) * 100;
  const sx = ev.clientX;
  const sy = ev.clientY;
  let moved = false;
  ov.setPointerCapture(ev.pointerId);
  const move = (m) => {
    if (!moved && Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 3) return;
    moved = true;
    const dx = ((m.clientX - sx) / R.width) * 100;
    const dy = ((m.clientY - sy) / R.height) * 100;
    const snap = teOpt.snap && !m.altKey;
    teSnaps = [];
    if (mode === 'move') {
      const bx = Math.min(...start.map((s) => s.x));
      const by = Math.min(...start.map((s) => s.y));
      const bw = Math.max(...start.map((s) => s.x + s.w)) - bx;
      const bh = Math.max(...start.map((s) => s.y + s.h)) - by;
      let mx = dx;
      let my = dy;
      if (snap) {
        const a = teSnapSpan(bx + dx, bw, tg.xs, thrX);
        if (a) { mx += a.d; teSnaps.push({ d: 'v', v: a.line }); }
        const b = teSnapSpan(by + dy, bh, tg.ys, thrY);
        if (b) { my += b.d; teSnaps.push({ d: 'h', v: b.line }); }
      }
      if (m.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) my = 0; else mx = 0; } // Shift — только по одной оси
      for (const s of start) { s.o.x = r1(s.x + mx); s.o.y = r1(s.y + my); }
    } else if (mode === 'rot') {
      const s = start[0];
      const cx = R.left + ((s.x + s.w / 2) / 100) * R.width;
      const cy = R.top + ((s.y + s.h / 2) / 100) * R.height;
      let a = (Math.atan2(m.clientY - cy, m.clientX - cx) * 180) / Math.PI + 90;
      if (a > 180) a -= 360;
      if (m.shiftKey) a = Math.round(a / 15) * 15;
      else if (snap) for (const q of [-180, -90, 0, 90, 180]) if (Math.abs(a - q) < 3) a = q;
      s.o.rot = Math.round(a);
    } else {
      const s = start[0];
      let { x, y, w, h } = s;
      if (mode.includes('e')) w = s.w + dx;
      if (mode.includes('w')) { w = s.w - dx; x = s.x + dx; }
      if (mode.includes('s')) h = s.h + dy;
      if (mode.includes('n')) { h = s.h - dy; y = s.y + dy; }
      if (snap) {
        if (mode.includes('e')) { const v = teNear(x + w, tg.xs, thrX); if (v != null) { w = v - x; teSnaps.push({ d: 'v', v }); } }
        if (mode.includes('w')) { const v = teNear(x, tg.xs, thrX); if (v != null) { w += x - v; x = v; teSnaps.push({ d: 'v', v }); } }
        if (mode.includes('s')) { const v = teNear(y + h, tg.ys, thrY); if (v != null) { h = v - y; teSnaps.push({ d: 'h', v }); } }
        if (mode.includes('n')) { const v = teNear(y, tg.ys, thrY); if (v != null) { h += y - v; y = v; teSnaps.push({ d: 'h', v }); } }
      }
      if ((m.shiftKey || teOpt.keepRatio) && mode.length === 2 && s.h) {
        const nh = w / (s.w / s.h);
        if (mode.includes('n')) y = s.y + s.h - nh;
        h = nh;
      }
      if (w < 0.5) { if (mode.includes('w')) x -= 0.5 - w; w = 0.5; }
      if (h < 0.5) { if (mode.includes('n')) y -= 0.5 - h; h = 0.5; }
      Object.assign(s.o, { x: r1(x), y: r1(y), w: r1(w), h: r1(h) });
    }
    teRenderCanvas();
  };
  const up = () => {
    ov.removeEventListener('pointermove', move);
    ov.removeEventListener('pointerup', up);
    ov.removeEventListener('pointercancel', up);
    teSnaps = [];
    teRenderOverlay();
    if (moved) { teRenderInsp(); teThumbSoon(); teSave(); }
  };
  ov.addEventListener('pointermove', move);
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', up);
}

// Пустое место холста: снять выделение или выделить рамкой
$('teOverlay').addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || ev.target.closest('.box') || ev.target.closest('.guide')) return;
  const ov = $('teOverlay');
  const R = ov.getBoundingClientRect();
  const p0 = { x: ((ev.clientX - R.left) / R.width) * 100, y: ((ev.clientY - R.top) / R.height) * 100 };
  const add = ev.shiftKey || ev.ctrlKey;
  const before = add ? [...teSel] : [];
  const marq = teEl('div', 'marq');
  let moved = false;
  ov.setPointerCapture(ev.pointerId);
  const move = (m) => {
    const p = { x: ((m.clientX - R.left) / R.width) * 100, y: ((m.clientY - R.top) / R.height) * 100 };
    if (!moved && Math.abs(p.x - p0.x) + Math.abs(p.y - p0.y) < 0.6) return;
    if (!moved) { moved = true; ov.append(marq); }
    const r = { x: Math.min(p.x, p0.x), y: Math.min(p.y, p0.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
    Object.assign(marq.style, { left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%' });
    const hit = teObjs().filter((o) => { if (o.hidden) return false; const b = teRect(o); return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y; }).map((o) => o.id);
    teSel = [...new Set([...before, ...hit])];
  };
  const up = () => {
    ov.removeEventListener('pointermove', move);
    ov.removeEventListener('pointerup', up);
    if (!moved && !add) teSel = [];
    teSelChanged();
  };
  ov.addEventListener('pointermove', move);
  ov.addEventListener('pointerup', up);
});

/* ===== Линейки и направляющие (хранятся в шаблоне: tpl.guides = [{ d: 'v'|'h', v: % }]) ===== */

function teGuideDrag(ev, i) {
  const tpl = teTpl();
  if (teRO()) { flashStatus('Направляющие — только в своей теме'); return; }
  const R = $('teOverlay').getBoundingClientRect();
  const g = tpl.guides[i];
  const el = ev.currentTarget;
  el.setPointerCapture(ev.pointerId);
  const at = (m) => (g.d === 'v' ? ((m.clientX - R.left) / R.width) * 100 : ((m.clientY - R.top) / R.height) * 100);
  const move = (m) => {
    let v = at(m);
    if (teOpt.snap && !m.altKey) { const n = teNear(v, [0, 50, 100], 1); if (n != null) v = n; }
    g.v = r1(v);
    if (g.d === 'v') el.style.left = g.v + '%'; else el.style.top = g.v + '%';
    tePosInfo(g.d === 'v' ? { x: g.v, y: 0 } : { x: 0, y: g.v });
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    teEdit(() => { if (g.v < 0 || g.v > 100) tpl.guides.splice(tpl.guides.indexOf(g), 1); }, { list: false });
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
}
// Потянуть от линейки — новая направляющая
for (const [id, d] of [['teRulerH', 'h'], ['teRulerV', 'v']]) {
  $(id).title = 'Потяните на холст — получится направляющая';
  $(id).addEventListener('pointerdown', (ev) => {
    const tpl = teTpl();
    if (!tpl || teRO()) { flashStatus('Направляющие — только в своей теме'); return; }
    if (!Array.isArray(tpl.guides)) tpl.guides = [];
    tpl.guides.push({ d, v: -1 });
    teRenderOverlay();
    const el = [...$('teOverlay').querySelectorAll('.guide')].pop();
    teGuideDrag({ currentTarget: el, pointerId: ev.pointerId }, tpl.guides.length - 1);
  });
}

/* ===== Добавить объект ===== */

async function teAddObj(kind, e) {
  if (teRO()) { flashStatus('Стандартную тему менять нельзя — сделайте свою копию'); return; }
  if (kind === 'poly' && e) {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu({ clientX: r.left, clientY: r.bottom + 4 }, Object.entries(Themes.POLYS).map(([k, p]) => ({ label: p.name, fn: () => teAddObj('poly:' + k) })));
    return;
  }
  let patch = {};
  if (kind.startsWith('poly:')) { const k = kind.slice(5); patch = { shape: k, pts: clone(Themes.POLYS[k].pts), name: Themes.POLYS[k].name, w: 20, h: 35.5 }; kind = 'poly'; }
  if (kind === 'image' || kind === 'video') {
    const [f] = await window.api.pickFile({ kinds: [kind], title: kind === 'image' ? 'Картинка в шаблон' : 'Видео в шаблон' });
    if (!f) return;
    patch = { url: f.url, path: f.path, name: f.name, w: 40, h: 40, fit: 'cover' };
  }
  if (kind === 'text') patch = { text: 'Текст', bind: 'static', w: 60, h: 14, size: 6 };
  if (kind === 'rect') patch = { w: 40, h: 25, fill: { type: 'color', color: '#000000', op: 0.5 }, radius: 1 };
  if (kind === 'ellipse') patch = { w: 20, h: 35.5, fill: { type: 'color', color: '#aa7452', op: 0.8 } };
  if (kind === 'line' || kind === 'arrow') patch = { w: 30, h: 4 };
  teInsert([Themes.obj(kind, patch)], true);
}
// Новые объекты — по центру (center) или как есть; выделить их
function teInsert(list, center) {
  teEdit(() => {
    for (const o of list) {
      if (center) { o.x = r1(50 - o.w / 2); o.y = r1(50 - o.h / 2); }
      teTpl().objs.push(o);
    }
    teSel = list.map((o) => o.id);
  }, { insp: true });
  teRenderOverlay();
  teSyncBar();
}
document.querySelectorAll('#teAdd [data-add]').forEach((b) => b.addEventListener('click', (e) => teAddObj(b.dataset.add, e)));

// Картинку или видео можно бросить на холст из Проводника
$('teWrap').addEventListener('dragover', (e) => { e.preventDefault(); $('teWrap').classList.add('drop'); });
$('teWrap').addEventListener('dragleave', () => $('teWrap').classList.remove('drop'));
$('teWrap').addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation(); // не в плейлист
  document.body.classList.remove('dragging');
  $('teWrap').classList.remove('drop');
  if (teRO()) { flashStatus('Стандартную тему менять нельзя — сделайте свою копию'); return; }
  const R = $('teOverlay').getBoundingClientRect();
  const px = ((e.clientX - R.left) / R.width) * 100;
  const py = ((e.clientY - R.top) / R.height) * 100;
  const list = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter((p) => p && /\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|m4v|ogv)$/i.test(p))
    .map((p, i) => Themes.obj(/\.(mp4|webm|mov|m4v|ogv)$/i.test(p) ? 'video' : 'image', { url: window.api.fileUrl(p), path: p, name: p.split(/[\\/]/).pop(), w: 40, h: 40, x: r1(Math.max(0, px - 20 + i * 2)), y: r1(Math.max(0, py - 20 + i * 2)) }));
  if (list.length) teInsert(list, false);
});

/* ===== Правка выделенного: выровнять, размер, порядок, группа, копировать ===== */

// Один объект — по экрану, несколько — по общей рамке (screen — всё равно по экрану)
function teAlign(how, screen) {
  const sel = teSelObjs().filter((o) => !o.locked);
  if (!sel.length) { flashStatus('Сначала выделите объект'); return; }
  teEdit(() => {
    const rs = sel.map((o) => ({ o, r: teRect(o) }));
    const whole = screen || rs.length === 1;
    const L = whole ? 0 : Math.min(...rs.map((x) => x.r.x));
    const T = whole ? 0 : Math.min(...rs.map((x) => x.r.y));
    const Rr = whole ? 100 : Math.max(...rs.map((x) => x.r.x + x.r.w));
    const B = whole ? 100 : Math.max(...rs.map((x) => x.r.y + x.r.h));
    if (how === 'dh' || how === 'dv') {
      if (rs.length < 3) { flashStatus('Распределить можно от трёх объектов'); return; }
      const k = how === 'dh' ? ['x', 'w'] : ['y', 'h'];
      rs.sort((a, b) => a.r[k[0]] - b.r[k[0]]);
      const L2 = Math.min(...rs.map((x) => x.r[k[0]]));
      const R2 = Math.max(...rs.map((x) => x.r[k[0]] + x.r[k[1]]));
      const span = R2 - L2 - rs.reduce((s, x) => s + x.r[k[1]], 0);
      let pos = L2;
      for (const x of rs) { x.o[k[0]] = r1(pos); pos += x.r[k[1]] + span / (rs.length - 1); }
      return;
    }
    if (how === 'sw' || how === 'sh') { // одинаковая ширина / высота — как у первого выделенного
      const k = how === 'sw' ? 'w' : 'h';
      for (const { o } of rs) o[k] = rs[0].o[k];
      return;
    }
    if (how === 'full') { for (const { o } of rs) Object.assign(o, { x: 0, y: 0, w: 100, h: 100, rot: 0 }); return; }
    if (how === 'safe') { const s = Number(teTpl().safe) || 0; for (const { o } of rs) Object.assign(o, { x: s, y: s, w: r1(100 - 2 * s), h: r1(100 - 2 * s) }); return; }
    for (const { o, r } of rs) {
      if (how === 'l') o.x = r1(L);
      if (how === 'c') o.x = r1((L + Rr) / 2 - r.w / 2);
      if (how === 'r') o.x = r1(Rr - r.w);
      if (how === 't') o.y = r1(T);
      if (how === 'm') o.y = r1((T + B) / 2 - r.h / 2);
      if (how === 'b') o.y = r1(B - r.h);
    }
  }, { insp: true });
  teRenderOverlay();
}
document.querySelectorAll('#teAlign [data-al]').forEach((b) => b.addEventListener('click', (e) => teAlign(b.dataset.al, e.altKey)));

function teDelete() {
  if (!teSel.length) return;
  const n = teSel.length;
  teEdit(() => { const tpl = teTpl(); tpl.objs = tpl.objs.filter((o) => !teSel.includes(o.id)); teSel = []; }, { insp: true });
  teRenderOverlay();
  teSyncBar();
  flashStatus(`Удалено объектов: ${n} · Ctrl+Z — вернуть`);
}
// d: +1 — вперёд на шаг, -1 — назад, 'front' / 'back' — на передний / задний план
function teZ(d) {
  const tpl = teTpl();
  const sel = teSelObjs();
  if (!sel.length) return;
  teEdit(() => {
    if (d === 'front' || d === 'back') { const rest = tpl.objs.filter((o) => !sel.includes(o)); tpl.objs = d === 'front' ? [...rest, ...sel] : [...sel, ...rest]; return; }
    const list = tpl.objs;
    const order = d > 0 ? [...sel].reverse() : sel;
    for (const o of order) {
      const i = list.indexOf(o);
      const j = i + d;
      if (j < 0 || j >= list.length || sel.includes(list[j])) continue;
      [list[i], list[j]] = [list[j], list[i]];
    }
  });
  teRenderOverlay();
}
function teGroup(on) {
  const sel = teSelObjs();
  if (on && sel.length < 2) { flashStatus('Для группы выделите два объекта или больше (Shift+щелчок)'); return; }
  const g = on ? newId() : '';
  teEdit(() => sel.forEach((o) => { o.group = g; }), { insp: true });
  teRenderOverlay();
  flashStatus(on ? 'Сгруппировано — двигаются вместе' : 'Группа разобрана');
}
function teCopy(cut) {
  const sel = teSelObjs();
  if (!sel.length) return;
  teClip = clone(sel);
  flashStatus(`${cut ? 'Вырезано' : 'Скопировано'} объектов: ${sel.length} — можно вставить в другой шаблон или тему`);
  if (cut) teDelete();
}
// Вставка: новые id, группы тоже новые; в тот же шаблон — со сдвигом
function teClone(list, shift) {
  const groups = {};
  return list.map((o) => {
    const c = Themes.norm({ ...clone(o), id: '' });
    if (c.group) c.group = groups[c.group] || (groups[c.group] = newId());
    if (shift) { c.x = r1(c.x + 2); c.y = r1(c.y + 2); }
    return c;
  });
}
function tePaste() {
  if (!teClip || !teClip.length) { flashStatus('Сначала скопируйте объекты (Ctrl+C)'); return; }
  const here = teClip.some((o) => teObj(o.id) || teObjs().some((x) => x.x === o.x && x.y === o.y && x.kind === o.kind));
  teInsert(teClone(teClip, here), false);
}
function teDup() { const sel = teSelObjs(); if (sel.length) teInsert(teClone(sel, true), false); }
function teToggle(key) {
  const sel = teSelObjs();
  if (!sel.length) return;
  const v = !sel.every((o) => o[key]);
  teEdit(() => sel.forEach((o) => { o[key] = v; }), { insp: true });
  if (key === 'hidden' && v) teSel = [];
  teSelChanged();
}
// Отразить: у текста буквы тоже отразятся
function teFlip(key) { const sel = teSelObjs(); if (sel.length) { teEdit(() => sel.forEach((o) => { o[key] = !o[key]; }), { insp: true }); teRenderOverlay(); } }

function teObjMenu(e) {
  const sel = teSelObjs();
  showMenu(e, [
    { label: 'Копировать', key: 'Ctrl+C', fn: () => teCopy(false) },
    { label: 'Вырезать', key: 'Ctrl+X', fn: () => teCopy(true) },
    { label: 'Вставить', key: 'Ctrl+V', fn: tePaste },
    { label: 'Дублировать', key: 'Ctrl+D', fn: teDup },
    '-',
    { label: 'На передний план', key: 'Ctrl+Shift+]', fn: () => teZ('front') },
    { label: 'Вперёд', key: 'Ctrl+]', fn: () => teZ(1) },
    { label: 'Назад', key: 'Ctrl+[', fn: () => teZ(-1) },
    { label: 'На задний план', key: 'Ctrl+Shift+[', fn: () => teZ('back') },
    '-',
    { label: 'По центру экрана', fn: () => { teAlign('c', true); teAlign('m', true); } },
    { label: 'Во весь экран', fn: () => teAlign('full') },
    { label: 'По безопасной зоне', fn: () => teAlign('safe') },
    { label: 'Отразить по горизонтали', fn: () => teFlip('flipX') },
    { label: 'Отразить по вертикали', fn: () => teFlip('flipY') },
    '-',
    ...(sel.length > 1 ? [{ label: 'Сгруппировать', key: 'Ctrl+G', fn: () => teGroup(true) }] : []),
    ...(sel.some((o) => o.group) ? [{ label: 'Разгруппировать', key: 'Ctrl+Shift+G', fn: () => teGroup(false) }] : []),
    { label: sel.every((o) => o.locked) ? 'Снять замок' : 'Замок', key: 'Ctrl+L', fn: () => teToggle('locked') },
    { label: 'Скрыть', key: 'Ctrl+H', fn: () => teToggle('hidden') },
    '-',
    { label: 'Удалить', key: 'Delete', fn: teDelete },
  ]);
}
$('teFront').addEventListener('click', () => teZ('front'));
$('teBack').addEventListener('click', () => teZ('back'));
$('teGroupBtn').addEventListener('click', () => { const sel = teSelObjs(); teGroup(!(sel.length && sel.every((o) => o.group && o.group === sel[0].group))); });
$('teDelBtn').addEventListener('click', teDelete);

/* ===== Слева внизу: объекты (сверху — передний план) ===== */

const TE_KIND_ICON = { text: 'text', rect: 'rect', ellipse: 'oval', line: 'line', arrow: 'arrow', poly: 'star', image: 'image', video: 'video' };
let teDragObj = null;
function teRenderObjs() {
  const box = $('teObjs');
  box.replaceChildren();
  const tpl = teTpl();
  $('teObjCount').textContent = tpl ? String(tpl.objs.length) : '';
  if (!tpl) return;
  if (!tpl.objs.length) box.append(teEl('div', 'te-empty', 'Пусто. Добавьте текст или фигуру кнопками над холстом.'));
  const ro = teRO();
  tpl.objs.slice().reverse().forEach((o) => {
    const row = teEl('div', 'te-obj' + (teSel.includes(o.id) ? ' sel' : '') + (o.hidden ? ' off' : ''));
    row.draggable = !ro;
    const nm = teEl('span', 'nm', o.name);
    if (o.kind === 'text' && o.bind !== 'static') nm.append(teEl('small', null, (Themes.BINDS[o.bind] || '').split(' (')[0]));
    row.append(Icons.el(TE_KIND_ICON[o.kind] || 'rect'), nm);
    if (o.group) { const g = teEl('span', 'gp', 'группа'); g.title = 'В группе — двигаются вместе. Ctrl+Shift+G — разгруппировать'; row.append(g); }
    const b1 = teIconBtn('eye', o.hidden ? 'Скрыт — показать' : 'Скрыть (Ctrl+H)', () => { teEdit(() => { o.hidden = !o.hidden; }); if (o.hidden) teSel = teSel.filter((id) => id !== o.id); teSelChanged(); }, o.hidden ? '' : 'on');
    const b2 = teIconBtn('lock', o.locked ? 'Замок: не двигается мышью — снять' : 'Замок: не двигать мышью (Ctrl+L)', () => { teEdit(() => { o.locked = !o.locked; }, { insp: true }); teRenderOverlay(); }, o.locked ? 'on' : '');
    b1.disabled = b2.disabled = ro;
    row.append(b1, b2);
    row.addEventListener('click', (e) => {
      if (e.ctrlKey || e.shiftKey) teSel = teSel.includes(o.id) ? teSel.filter((id) => id !== o.id) : [...teSel, o.id];
      else teSel = [o.id];
      teSelChanged();
    });
    row.addEventListener('dblclick', () => { if (!ro) teRename(nm, o.name, (v) => { o.name = v; }); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!teSel.includes(o.id)) { teSel = [o.id]; teSelChanged(); } teObjMenu(e); });
    // Перетащить строку — поменять порядок наложения
    row.addEventListener('dragstart', (e) => { teDragObj = o; e.dataTransfer.setData('application/x-cp-teobj', o.id); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { teDragObj = null; box.querySelectorAll('.te-obj').forEach((r) => r.classList.remove('drop-before', 'drop-after')); });
    row.addEventListener('dragover', (e) => {
      if (!teDragObj || teDragObj === o) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      row.classList.toggle('drop-after', after);
      row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      if (!teDragObj) return;
      e.preventDefault();
      e.stopPropagation();
      const after = row.classList.contains('drop-after');
      const moving = teDragObj;
      teEdit(() => {
        const list = tpl.objs.filter((x) => x !== moving);
        // Список показан сверху вниз = с конца массива: «ниже в списке» — раньше в массиве
        const i = list.indexOf(o);
        list.splice(after ? i : i + 1, 0, moving);
        tpl.objs = list;
      });
      teRenderOverlay();
    });
    box.append(row);
  });
}

/* ===== Справа: свойства ===== */

// Значение по пути «plate.op»; недостающие вложенные объекты создаются
function tePath(o, path) {
  const ks = path.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) { if (!x[k] || typeof x[k] !== 'object') x[k] = {}; x = x[k]; }
  return [x, ks[ks.length - 1]];
}
const teGet = (o, path, d) => { const [x, k] = tePath(o, path); return x[k] != null ? x[k] : d; };
const teSet = (o, path, v) => { const [x, k] = tePath(o, path); x[k] = v; };

// Маленькие значки для переключателей текста (встроенный SVG)
const TE_GLYPH = {
  left: 'M2 4h12M2 8h8M2 12h10', center: 'M2 4h12M4 8h8M3 12h10', right: 'M2 4h12M6 8h8M4 12h10', justify: 'M2 4h12M2 8h12M2 12h12',
  top: 'M2 2.5h12M5.5 5.5h5v6h-5z', middle: 'M2 8h2.5M11.5 8H14M5.5 5h5v6h-5z', bottom: 'M2 13.5h12M5.5 4.5h5v6h-5z',
};
const teGlyph = (k) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${TE_GLYPH[k]}" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Мини-конструктор формы: разделы, строки, поля — каждое поле сразу правит объект
const teUi = {
  sec(parent, title, open, mark) {
    const d = teEl('details', 'te-sec');
    d.open = title in teOpenSecs ? teOpenSecs[title] : !!open;
    d.addEventListener('toggle', () => { teOpenSecs[title] = d.open; });
    const sm = teEl('summary', null, title);
    if (mark) sm.append(teEl('span', 'dot')); // в разделе что-то включено
    const body = teEl('div', 'bd');
    d.append(sm, body);
    parent.append(d);
    return body;
  },
  row(body, label, ...els) {
    const r = teEl('div', 'te-row');
    const ct = teEl('div', 'ct');
    ct.append(...els.filter(Boolean));
    r.append(teEl('span', 'lb', label), ct);
    body.append(r);
    return r;
  },
  hint(body, text) { body.append(teEl('p', 'te-hint', text)); },
  btns(body, list) {
    const b = teEl('div', 'te-btns');
    for (const [text, fn, title, icon] of list) {
      const x = teEl('button', null, text);
      x.title = title || '';
      if (icon) x.prepend(Icons.el(icon));
      x.addEventListener('click', fn);
      b.append(x);
    }
    body.append(b);
    return b;
  },
  num(o, path, d, opt = {}) {
    const k = opt.k || 1;
    const i = Object.assign(document.createElement('input'), { type: 'number', step: opt.step || 0.5, value: r1(teGet(o, path, d) * k) });
    if (opt.min != null) i.min = opt.min;
    if (opt.max != null) i.max = opt.max;
    i.addEventListener('input', () => {
      if (i.value === '' || Number.isNaN(Number(i.value))) return;
      const v = Number(i.value) / k;
      teEdit(() => { teSet(o, path, v); if (opt.after) opt.after(v); }, { list: false });
      teRenderOverlay();
    });
    return i;
  },
  // Ползунок и рядом точное число
  range(o, path, d, opt = {}) {
    const k = opt.k || 1;
    const wrap = teEl('span');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;min-width:0';
    const val = teGet(o, path, d) * k;
    const r = Object.assign(document.createElement('input'), { type: 'range', min: opt.min, max: opt.max, step: opt.step || 1, value: val });
    if (Number.isFinite(Number(d))) r.dataset.def = Number(d) * k; // двойной щелчок — по умолчанию (icons.js)
    const n = Object.assign(document.createElement('input'), { type: 'number', min: opt.min, step: opt.step || 1, value: r1(val) });
    n.title = opt.unit || '';
    const set = (v) => { teEdit(() => teSet(o, path, v / k), { list: false }); teRenderOverlay(); };
    r.addEventListener('input', () => { n.value = r1(Number(r.value)); set(Number(r.value)); });
    n.addEventListener('input', () => { if (n.value === '' || Number.isNaN(Number(n.value))) return; r.value = n.value; set(Number(n.value)); });
    wrap.append(r, n);
    return wrap;
  },
  // Цвет: образец, код #rrggbb и пипетка (взять цвет с экрана)
  // Образец открывает общее окно «Цвета» (colorpicker.js) с прозрачностью 0–100 %. У цвета есть парное поле
  // прозрачности (.color → .op, .a → .opA, .b → .opB); у фона шаблона (bg.*) прозрачности нет.
  color(o, path, d) {
    const wrap = teEl('span');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px';
    const base = path.replace(/\.[^.]+$/, '');
    const opPath = path.startsWith('bg.') ? null : path.endsWith('.color') ? base + '.op' : path.endsWith('.a') ? base + '.opA' : path.endsWith('.b') ? base + '.opB' : null;
    const opNow = () => { const v = teGet(o, opPath, teGet(o, base + '.op', 1)); return Number.isFinite(Number(v)) ? Number(v) : 1; };
    const hex = Object.assign(document.createElement('input'), { type: 'text', className: 'hex', value: teGet(o, path, d), maxLength: 7 });
    const f = ColorPicker.field(hex.value, opPath ? opNow() : null, (v, op) => {
      hex.value = v;
      teEdit(() => { teSet(o, path, v); if (opPath && op != null) teSet(o, opPath, Math.round(op * 100) / 100); }, { list: false });
    }, { onClose: () => { if (opPath) teRenderInsp(); } }); // закрыли — перерисовать, чтобы «Непрозрачность» ниже совпала
    hex.addEventListener('change', () => {
      const v = ColorPicker.norm(hex.value);
      if (v) { hex.value = v; f.set(v, opPath ? opNow() : null); teEdit(() => teSet(o, path, v), { list: false }); } else hex.value = teGet(o, path, d);
    });
    wrap.append(f, hex);
    return wrap;
  },
  sel(o, path, d, opts, re) {
    const s = document.createElement('select');
    for (const [v, t] of opts) s.append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
    s.value = String(teGet(o, path, d));
    s.addEventListener('change', () => { const v = opts.find(([x]) => String(x) === s.value)[0]; teEdit(() => teSet(o, path, v), { insp: !!re }); teRenderOverlay(); });
    return s;
  },
  text(o, path, d, ph) {
    const i = Object.assign(document.createElement('input'), { type: 'text', value: teGet(o, path, d), placeholder: ph || '' });
    i.addEventListener('input', () => { teEdit(() => teSet(o, path, i.value), { list: path === 'name' }); });
    return i;
  },
  chk(o, path, label, re) {
    const l = teEl('label');
    l.style.fontSize = '12px';
    const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!teGet(o, path, false) });
    c.addEventListener('change', () => { teEdit(() => teSet(o, path, c.checked), { insp: !!re }); teRenderOverlay(); });
    l.append(c, document.createTextNode(label));
    return l;
  },
  // Кнопки-переключатели: один вариант из нескольких; в тексте кнопки может быть значок TE_GLYPH (glyph:имя)
  seg(o, path, d, opts, re, after) {
    const b = teEl('span', 'te-seg');
    const cur = teGet(o, path, d);
    for (const [v, t, title] of opts) {
      const x = teEl('button');
      if (String(t).startsWith('glyph:')) x.innerHTML = teGlyph(t.slice(6)); else x.textContent = t;
      x.title = title || '';
      x.setAttribute('aria-pressed', String(cur === v));
      x.addEventListener('click', () => {
        teEdit(() => { teSet(o, path, v); if (after) after(v); }, { insp: !!re });
        teRenderOverlay();
        if (!re) b.querySelectorAll('button').forEach((y, i) => y.setAttribute('aria-pressed', String(opts[i][0] === v)));
      });
      b.append(x);
    }
    return b;
  },
  toggle(o, path, text, title, css) {
    const x = teEl('button', null, text);
    x.title = title || '';
    if (css) x.style.cssText = css;
    x.setAttribute('aria-pressed', String(!!teGet(o, path, false)));
    x.addEventListener('click', () => { const v = !teGet(o, path, false); teEdit(() => teSet(o, path, v), { list: false }); x.setAttribute('aria-pressed', String(v)); });
    return x;
  },
  file(kinds, title, apply) {
    const x = teEl('button', null, 'Выбрать…');
    x.title = title;
    x.addEventListener('click', async () => {
      const [f] = await window.api.pickFile({ kinds, title });
      if (f) teEdit(() => apply(f), { insp: true });
    });
    return x;
  },
};
const pct = { min: 0, max: 100, k: 100, step: 5, unit: '%' };

function teRenderInsp() {
  const box = $('teInsp');
  const keep = box.scrollTop;
  box.replaceChildren();
  const t = teTheme();
  const tpl = teTpl();
  if (!t || !tpl) return;
  if (t.std) {
    const ro = teEl('div', 'te-ro', `«${t.name}» — стандартная тема: её можно смотреть и применять. Чтобы менять, сделайте свою копию.`);
    const b = teEl('button', 'primary', 'Сделать свою копию');
    b.addEventListener('click', () => teCopyTheme(t));
    ro.append(document.createElement('br'), b);
    box.append(ro);
  }
  const fs = document.createElement('fieldset');
  fs.disabled = !!t.std;
  box.append(fs);
  const sel = teSelObjs();
  if (!sel.length) teInspTemplate(fs, t, tpl);
  else if (sel.length === 1) teInspObj(fs, sel[0]);
  else teInspMulti(fs, sel);
  box.scrollTop = keep;
}

function teTitle(parent, icon, text, extra = []) {
  const h = teEl('div', 'te-title');
  h.append(Icons.el(icon), teEl('b', null, text), ...extra);
  parent.append(h);
}

// Режим слайда: подпись, текст и откуда взят вид
function teInspSlide(fs, t, tpl) {
  const U = teUi;
  const s = t.slide;
  const i = t.item.slides.indexOf(s);
  teTitle(fs, 'slides', `Слайд ${i + 1} · ${t.item.name}`);
  const b = U.sec(fs, 'Слайд', true);
  U.row(b, 'Подпись', U.text(s, 'label', '', 'Куплет 1, Припев…'));
  if (s.k === 'text') {
    const ta = Object.assign(document.createElement('textarea'), { rows: 4, value: s.text || '' });
    ta.addEventListener('input', () => teEdit(() => { s.text = ta.value; }, { list: false }));
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    U.row(b, 'Текст слайда', ta);
  }
  if (s.k === 'bible') U.hint(b, `Стих: ${s.ref || ''}. Текст стиха берётся из Библии — здесь меняется только вид.`);
  if (s.k === 'custom') U.hint(b, 'Текст и картинки этого слайда — объекты слева: выберите и правьте, «T» — добавить текст.');
  U.row(b, 'Безопасная зона', U.range(tpl, 'safe', 5, { min: 0, max: 15, step: 0.5, unit: '%' }));
  U.hint(b, 'Правки — только этому слайду: тема и другие слайды не меняются. Сохраняется сразу; если слайд на экране — «Обновить на экране».');
  const bt = U.btns(b, [['Взять шаблон из темы…', (e) => teSlideFromTpl(e), s.k === 'custom' ? 'Фон из любого шаблона любой темы' : 'Вид слайда — копия любого шаблона любой темы', 'theme']]);
  if (s.look && !teSlide.fresh) {
    const x = teEl('button', null, s.k === 'custom' ? 'Фон как в теме' : 'Как в теме');
    x.title = s.k === 'custom' ? 'Фон слайда — снова из темы' : 'Убрать свой вид: слайд снова оформлен темой';
    x.prepend(Icons.el('undo'));
    x.addEventListener('click', teSlideReset);
    bt.append(x);
  }
}

function teInspTemplate(fs, t, tpl) {
  const U = teUi;
  let b;
  if (t.slide) teInspSlide(fs, t, tpl);
  else {
    teTitle(fs, 'slides', 'Шаблон · ' + tpl.name);
    b = U.sec(fs, 'Шаблон', true);
    U.row(b, 'Название', U.text(tpl, 'name', '', 'Например, Песня с подложкой'));
    U.row(b, 'Сам берётся для', U.sel(tpl, 'use', 'any', Object.entries(Themes.USES)));
    U.row(b, 'Безопасная зона', U.range(tpl, 'safe', 5, { min: 0, max: 15, step: 0.5, unit: '%' }));
    U.hint(b, 'Шаблон «Текст песни» берётся сам для песен, «Библия» — для стихов. Любой другой выбирается у слайда вручную: правая кнопка по слайду → «Шаблон темы…».');
  }

  b = U.sec(fs, 'Фон', true, tpl.bg.type !== 'none');
  const bg = tpl.bg;
  U.row(b, 'Вид', U.seg(tpl, 'bg.type', 'none', [['none', 'Нет', 'Прозрачный: видно слои «Медиа» и «Источники»'], ['color', 'Цвет'], ['gradient', 'Градиент'], ['image', 'Фото'], ['video', 'Видео']], true));
  if (bg.type === 'none') U.hint(b, 'Фон прозрачный: под слайдом видно то, что идёт в слоях «Медиа» и «Источники» (видео, фото, камера).');
  if (bg.type === 'color') U.row(b, 'Цвет', U.color(tpl, 'bg.color', '#000000'));
  if (bg.type === 'gradient') {
    U.row(b, 'Цвет 1', U.color(tpl, 'bg.a', '#0b2a3a'));
    U.row(b, 'Цвет 2', U.color(tpl, 'bg.b', '#000000'));
    U.row(b, 'Угол', U.range(tpl, 'bg.angle', 180, { min: 0, max: 360, unit: '°' }));
    U.row(b, '', U.chk(tpl, 'bg.radial', 'из центра (круговой)'));
  }
  if (bg.type === 'image' || bg.type === 'video') {
    U.row(b, 'Файл', teEl('span', 'te-hint', bg.name || (bg.url ? decodeURI(bg.url.split('/').pop()) : 'не выбран')), U.file([bg.type], 'Фон шаблона', (f) => { Object.assign(tpl.bg, { url: f.url, path: f.path, name: f.name }); }));
    U.row(b, 'Вписать', U.sel(tpl, 'bg.fit', 'cover', [['cover', 'заполнить'], ['contain', 'целиком'], ['fill', 'растянуть']]));
    U.row(b, 'Размытие', U.range(tpl, 'bg.blur', 0, { min: 0, max: 5, step: 0.1 }));
    U.row(b, 'Насыщенность', U.range(tpl, 'bg.sat', 1, { ...pct, max: 300 }));
    U.row(b, 'Яркость', U.range(tpl, 'bg.bright', 1, { ...pct, min: 20, max: 200 }));
  }
  if (bg.type !== 'none') {
    U.row(b, 'Непрозрачность', U.range(tpl, 'bg.op', 1, pct));
    U.row(b, 'Затемнение', U.range(tpl, 'bg.dim', 0, { ...pct, max: 90 }));
  }

  b = U.sec(fs, 'Media Action — фон в слой «Медиа»', false, !!tpl.media);
  U.hint(b, 'Не объект слайда: при показе слайда с этим шаблоном файл сам включается в слое «Медиа» (если там уже не он) и не перезапускается при смене слайдов.');
  const m = tpl.media;
  U.row(b, 'Файл', teEl('span', 'te-hint', m ? m.name || 'файл' : 'нет'), U.file(['video', 'image'], 'Фон в слой «Медиа»', (f) => { tpl.media = { type: f.type === 'image' ? 'image' : 'video', url: f.url, path: f.path, name: f.name, loop: true }; }));
  if (m) {
    U.row(b, '', U.chk(tpl, 'media.loop', 'по кругу'));
    U.btns(b, [['Убрать', () => teEdit(() => { tpl.media = null; }, { insp: true })]]);
  }

  b = U.sec(fs, 'Сетка и направляющие', false);
  const gs = document.createElement('select');
  for (const v of [1, 2, 2.5, 5, 10, 12.5, 25]) gs.append(Object.assign(document.createElement('option'), { value: v, textContent: v + '%' }));
  gs.value = String(teOpt.gridStep);
  gs.addEventListener('change', () => { teOpt.gridStep = Number(gs.value); teOpt.grid = true; teSaveOpt(); teSyncBar(); teRenderOverlay(); });
  U.row(b, 'Шаг сетки', gs);
  const ng = (tpl.guides || []).length;
  U.hint(b, `Направляющих: ${ng}. Потяните от линейки над или слева от холста; объекты к ним прилипают.`);
  U.btns(b, [
    ['По центру', () => teEdit(() => { tpl.guides = [...(tpl.guides || []), { d: 'v', v: 50 }, { d: 'h', v: 50 }]; }, { insp: true }), 'Две направляющие через центр'],
    ['Треть', () => teEdit(() => { tpl.guides = [...(tpl.guides || []), { d: 'v', v: 33.3 }, { d: 'v', v: 66.7 }, { d: 'h', v: 33.3 }, { d: 'h', v: 66.7 }]; }, { insp: true }), 'Правило третей'],
    ...(ng ? [['Убрать все', () => teEdit(() => { tpl.guides = []; }, { insp: true })]] : []),
  ]);

  const outer = $('teInsp');
  if (t.slide) { teInspFonts(outer); return; }
  b = U.sec(fs, 'Тема', false);
  U.row(b, 'Название темы', U.text(t, 'name', ''));
  const asp = document.createElement('select');
  for (const [k, n] of Object.entries(Themes.ASPECTS)) asp.append(Object.assign(document.createElement('option'), { value: k, textContent: n }));
  asp.value = Themes.aspectOf(t);
  asp.addEventListener('change', () => teReshape(t, asp.value));
  U.row(b, 'Формат', asp);
  U.hint(b, 'Под какой экран тема: 16:9, квадрат 1:1… Смена формата переделывает все шаблоны: места объектов сохраняются, круги и фигуры не сплющиваются. Ctrl+Z — вернуть.');
  U.btns(b, [['Копия темы', () => teCopyTheme(t), '', 'copy'], ['Копия под формат…', (e) => showMenu(e, Object.entries(Themes.ASPECTS).filter(([k]) => k !== Themes.aspectOf(t)).map(([k, n]) => ({ label: n, fn: () => teCopyTheme(t, k) }))), 'Новая тема — копия этой, переделанная под другой экран', 'copy'], ['Экспорт', () => teExport([t]), 'Сохранить тему в файл', 'export']]);

  // Не правка самой темы: можно и у стандартной (поэтому вне fieldset)
  b = U.sec(outer, 'Тема по умолчанию', false);
  U.hint(b, 'Тема презентации или слайда важнее этой:');
  const opts = [['', 'без темы (из настроек)'], ...Themes.all(teThemes()).map((x) => [x.id, x.name])];
  for (const [k, label] of [['song', 'Песни'], ['bible', 'Библия'], ['media', 'Картинки, видео'], ['custom', 'Свои слайды']]) {
    const s = document.createElement('select');
    for (const [v, n] of opts) s.append(Object.assign(document.createElement('option'), { value: v, textContent: n }));
    s.value = lib.themeFor[k] || '';
    s.addEventListener('change', () => { lib.themeFor[k] = s.value; teSave(); });
    U.row(b, label, s);
  }
  teInspFonts(outer);
  b = U.sec(outer, 'Подсказки', false);
  U.hint(b, 'Мышью: щелчок — выбрать, Shift/Ctrl — добавить к выбору, рамка по пустому месту — выбрать несколько. Углы — размер (Shift — с пропорциями), кружок сверху — поворот, Alt — без привязки.');
  U.hint(b, 'Клавиши: T — текст, R — прямоугольник, O — эллипс, L — линия; Delete — удалить; стрелки — сдвиг (Shift — крупнее); Ctrl+C/X/V/D — копировать, вырезать, вставить, дублировать; Ctrl+G — группа; Ctrl+] / Ctrl+[ — выше/ниже; Ctrl+L — замок; Ctrl+H — скрыть; Ctrl+Z — отмена; Esc — снять выбор.');
}

// Свои шрифты: файлы копируются в папку программы (main.js: fonts:add) и видны во всех окнах
function teInspFonts(parent) {
  const U = teUi;
  const list = Scene.fontsList();
  const b = U.sec(parent, 'Шрифты', false);
  U.hint(b, `Доступны все шрифты Windows${teSysFonts ? ` (${teSysFonts.length})` : ''} и свои файлы TTF, OTF, WOFF. Файл копируется в папку программы — оригинал не трогается.`);
  const box = teEl('div', 'te-fonts-list');
  for (const f of list) {
    const r = teEl('div', 'fr');
    const n = teEl('span', null, f.family + (f.weight !== 400 ? ` ${f.weight}` : '') + (f.italic ? ' курсив' : ''));
    n.style.fontFamily = Scene.family(f.family);
    n.style.fontWeight = f.weight;
    n.title = f.name || '';
    r.append(n, teIconBtn('close', 'Убрать из списка (копия файла останется в папке программы)', async () => { await window.api.fontsRemove(f.file); flashStatus(`Шрифт «${f.family}» убран`); }));
    box.append(r);
  }
  if (!list.length) box.append(teEl('p', 'te-hint', 'Своих шрифтов пока нет.'));
  b.append(box);
  U.btns(b, [['Добавить файл шрифта…', teAddFont, 'TTF, OTF, WOFF', 'add']]);
}
async function teAddFont() {
  const res = await window.api.fontsAdd();
  if (!res) return;
  if (res.added.length) flashStatus(`Добавлено шрифтов: ${res.added.length} — ${res.added.map((f) => f.family).join(', ')}`);
  else if (res.skipped.length) flashStatus('Такой шрифт уже есть: ' + res.skipped.join(', '));
  return res.added;
}
window.api.onFonts(() => { if (tab === 'themes') teRenderInsp(); });

function teInspObj(fs, o) {
  const U = teUi;
  const name = Object.assign(document.createElement('input'), { type: 'text', value: o.name });
  name.style.cssText = 'flex:1;min-width:0;font-weight:600';
  name.addEventListener('input', () => teEdit(() => { o.name = name.value; }));
  const h = teEl('div', 'te-title');
  h.append(Icons.el(TE_KIND_ICON[o.kind] || 'rect'), name,
    teIconBtn('copy', 'Дублировать (Ctrl+D)', teDup), teIconBtn('trash', 'Удалить (Delete)', teDelete));
  fs.append(h);

  let b = U.sec(fs, 'Расположение', true);
  const xy = teEl('div', 'te-xy');
  const ratio = () => (o.h ? o.w / o.h : 1);
  for (const [k, l, tt] of [['x', 'X', 'Слева, % ширины экрана'], ['y', 'Y', 'Сверху, % высоты экрана'], ['w', 'Ш', 'Ширина, %'], ['h', 'В', 'Высота, %']]) {
    const lab = teEl('label');
    lab.title = tt;
    const r0 = ratio();
    lab.append(teEl('b', null, l), U.num(o, k, 0, { step: 0.1, after: (v) => { if (!teOpt.keepRatio) return; if (k === 'w') o.h = r1(v / r0); if (k === 'h') o.w = r1(v * r0); } }));
    xy.append(lab);
  }
  b.append(xy);
  const kr = teEl('label');
  kr.style.fontSize = '12px';
  const krc = Object.assign(document.createElement('input'), { type: 'checkbox', checked: teOpt.keepRatio });
  krc.addEventListener('change', () => { teOpt.keepRatio = krc.checked; teSaveOpt(); });
  kr.append(krc, document.createTextNode('сохранять пропорции'));
  U.row(b, '', kr);
  U.row(b, 'Поворот', U.range(o, 'rot', 0, { min: -180, max: 180, unit: '°' }));
  const fl = teEl('span', 'te-seg');
  for (const [k, txt, tt] of [['flipX', 'Зеркально ↔', 'Отразить по горизонтали'], ['flipY', 'Зеркально ↕', 'Отразить по вертикали']]) {
    const x = teEl('button', null, txt);
    x.title = tt;
    x.setAttribute('aria-pressed', String(!!o[k]));
    x.addEventListener('click', () => teFlip(k));
    fl.append(x);
  }
  U.row(b, 'Отражение', fl);
  U.btns(b, [
    ['По центру', () => { teAlign('c', true); teAlign('m', true); }, 'По центру экрана'],
    ['Во весь экран', () => teAlign('full')],
    ['В безопасную зону', () => teAlign('safe')],
  ]);
  U.row(b, '', U.chk(o, 'locked', 'замок', true), U.chk(o, 'hidden', 'скрыт', true));

  b = U.sec(fs, 'Вид', false, o.opacity < 1 || (o.blend && o.blend !== 'normal'));
  U.row(b, 'Непрозрачность', U.range(o, 'opacity', 1, pct));
  U.row(b, 'Наложение', U.sel(o, 'blend', 'normal', [['normal', 'обычное'], ['multiply', 'умножение'], ['screen', 'осветление'], ['overlay', 'перекрытие'], ['soft-light', 'мягкий свет'], ['hard-light', 'жёсткий свет'], ['color-dodge', 'осветление основы'], ['difference', 'разница'], ['luminosity', 'яркость'], ['color', 'цветность']]));

  if (o.kind === 'text') teInspText(fs, o);
  if (['rect', 'ellipse', 'poly'].includes(o.kind)) {
    b = U.sec(fs, 'Фигура', true);
    if (o.kind === 'poly') {
      const s = U.sel(o, 'shape', 'star', Object.entries(Themes.POLYS).map(([k, p]) => [k, p.name]), true);
      s.addEventListener('change', () => { if (Themes.POLYS[o.shape]) teEdit(() => { o.pts = clone(Themes.POLYS[o.shape].pts); }); });
      U.row(b, 'Форма', s);
    }
    tePaintRows(b, o, 'fill', true);
    if (o.kind === 'rect') U.row(b, 'Скругление', U.range(o, 'radius', 0, { min: 0, max: 20, step: 0.2 }));
    b = U.sec(fs, 'Обводка', o.stroke.w > 0, o.stroke.w > 0);
    U.row(b, 'Толщина', U.range(o, 'stroke.w', 0, { min: 0, max: 2, step: 0.05 }));
    U.row(b, 'Цвет', U.color(o, 'stroke.color', '#ffffff'));
    U.row(b, 'Непрозрачность', U.range(o, 'stroke.op', 1, pct));
    teShadowRows(U.sec(fs, 'Тень', !!o.shadow.on, !!o.shadow.on), o, 'shadow');
  }
  if (o.kind === 'line' || o.kind === 'arrow') {
    b = U.sec(fs, o.kind === 'arrow' ? 'Стрелка' : 'Линия', true);
    U.row(b, 'Толщина', U.range(o, 'stroke.w', 0.5, { min: 0.05, max: 3, step: 0.05 }));
    U.row(b, 'Цвет', U.color(o, 'stroke.color', '#ffffff'));
    U.row(b, 'Непрозрачность', U.range(o, 'stroke.op', 1, pct));
    U.hint(b, 'Наклон — поворотом (кружок над рамкой).');
    teShadowRows(U.sec(fs, 'Тень', !!o.shadow.on, !!o.shadow.on), o, 'shadow');
  }
  if (o.kind === 'image' || o.kind === 'video') {
    b = U.sec(fs, o.kind === 'video' ? 'Видео' : 'Картинка', true);
    U.row(b, 'Файл', teEl('span', 'te-hint', o.name || 'файл'), U.file([o.kind], 'Заменить файл', (f) => { Object.assign(o, { url: f.url, path: f.path, name: f.name }); }));
    U.row(b, 'Вписать', U.sel(o, 'fit', 'cover', [['cover', 'заполнить (обрезать)'], ['contain', 'целиком'], ['fill', 'растянуть']]));
    const crop = teEl('div', 'te-xy');
    for (const [k, l] of [['l', 'Слева'], ['t', 'Сверху'], ['r', 'Справа'], ['b', 'Снизу']]) {
      const lab = teEl('label', null, 'Обрезать ' + l.toLowerCase());
      lab.append(U.num(o, 'crop.' + k, 0, { step: 1, min: 0, max: 90 }));
      crop.append(lab);
    }
    b.append(crop);
    U.row(b, 'Скругление', U.range(o, 'radius', 0, { min: 0, max: 20, step: 0.2 }));
    U.row(b, 'Рамка', U.range(o, 'stroke.w', 0, { min: 0, max: 2, step: 0.05 }));
    U.row(b, 'Цвет рамки', U.color(o, 'stroke.color', '#ffffff'));
    if (o.kind === 'video') U.row(b, '', U.chk(o, 'loop', 'по кругу'), U.chk(o, 'mute', 'без звука'));
    b = U.sec(fs, 'Фильтры', false);
    U.row(b, 'Размытие', U.range(o, 'filt.blur', 0, { min: 0, max: 5, step: 0.1 }));
    U.row(b, 'Яркость', U.range(o, 'filt.bright', 1, { ...pct, min: 20, max: 200 }));
    U.row(b, 'Контраст', U.range(o, 'filt.contrast', 1, { ...pct, min: 20, max: 200 }));
    U.row(b, 'Насыщенность', U.range(o, 'filt.sat', 1, { ...pct, max: 300 }));
    U.row(b, 'Оттенок', U.range(o, 'filt.hue', 0, { min: -180, max: 180, unit: '°' }));
    U.row(b, 'Ч/б', U.range(o, 'filt.gray', 0, pct));
    teShadowRows(U.sec(fs, 'Тень', !!o.shadow.on, !!o.shadow.on), o, 'shadow');
  }
  teGlowRows(fs, o);
  if (o.kind !== 'line' && o.kind !== 'arrow') {
    b = U.sec(fs, 'Эффекты фона под объектом', false, backdropOn(o));
    U.hint(b, 'Действуют на то, что ПОД объектом: видео, фото, камеру. Например, прямоугольник без заливки с размытием — видео размыто только за текстом.');
    U.row(b, 'Размытие', U.range(o, 'fx.blur', 0, { min: 0, max: 6, step: 0.1 }));
    U.row(b, 'Насыщенность', U.range(o, 'fx.sat', 1, { ...pct, max: 300 }));
    U.row(b, 'Яркость', U.range(o, 'fx.bright', 1, { ...pct, max: 200 }));
    U.row(b, '', U.chk(o, 'fx.invert', 'инверсия цветов'));
  }
  teInspAnim(fs, o);
}
// Внешнее свечение (как Outer Glow в Photoshop) и растушёвка — у любого объекта
function teGlowRows(fs, o) {
  const U = teUi;
  const g = o.glow || {};
  let b = U.sec(fs, 'Внешнее свечение', !!g.on, !!g.on);
  U.row(b, '', U.chk(o, 'glow.on', 'свечение', true));
  if (g.on) {
    U.row(b, 'Цвет', U.color(o, 'glow.color', '#ffd27a'));
    U.row(b, 'Непрозрачность', U.range(o, 'glow.op', 0.9, pct));
    U.row(b, 'Размер', U.range(o, 'glow.size', 1.5, { min: 0.1, max: 8, step: 0.1 }));
    U.row(b, 'Сила', U.range(o, 'glow.power', 2, { min: 1, max: 4, step: 1 }));
  }
  const media = o.kind === 'image' || o.kind === 'video';
  const fe = Number(o.feather) > 0;
  b = U.sec(fs, 'Растушёвка', fe, fe);
  U.row(b, 'Растушёвка', U.range(o, 'feather', 0, media ? { min: 0, max: 25, step: 0.5 } : { min: 0, max: 5, step: 0.1 }));
  if (media) U.row(b, '', U.chk(o, 'featherRound', 'по овалу (виньетка)'));
  U.hint(b, media ? 'Края картинки плавно уходят в прозрачность.' : 'Мягкие, размытые края объекта.');
}
const backdropOn = (o) => !!(o.fx && (o.fx.blur > 0 || o.fx.invert || o.fx.sat !== 1 || o.fx.bright !== 1));

// Заливка: нет, цвет, градиент, картинка (у текста — ещё «вырезать»)
function tePaintRows(b, o, key, withNone, withCut) {
  const U = teUi;
  const f = o[key];
  const opts = [...(withNone ? [['none', 'Нет']] : []), ['color', 'Цвет'], ['gradient', 'Градиент'], ['media', 'Картинка'], ...(withCut ? [['cut', 'Вырезать', 'Сквозь буквы видно то, что под подложкой']] : [])];
  U.row(b, 'Заливка', U.seg(o, key + '.type', 'color', opts, true));
  if (f.type === 'color') U.row(b, 'Цвет', U.color(o, key + '.color', '#ffffff'));
  if (f.type === 'gradient') {
    U.row(b, 'Цвет 1', U.color(o, key + '.a', '#ffffff'));
    U.row(b, 'Цвет 2', U.color(o, key + '.b', '#7c5841'));
    U.row(b, 'Угол', U.range(o, key + '.angle', 90, { min: 0, max: 360, unit: '°' }));
    if (!withCut) U.row(b, '', U.chk(o, key + '.radial', 'из центра'));
  }
  if (f.type === 'media') U.row(b, 'Картинка', teEl('span', 'te-hint', f.url ? decodeURI(f.url.split('/').pop()) : 'не выбрана'), U.file(['image'], 'Картинка для заливки', (x) => { f.url = x.url; }));
  if (f.type === 'cut') {
    U.hint(b, 'Буквы прозрачные: сквозь них видно видео или фото под слайдом. Нужна подложка (раздел ниже).');
    if (!o.plate.on) U.btns(b, [['Включить подложку', () => teEdit(() => { o.plate.on = true; }, { insp: true })]]);
  }
  if (f.type !== 'none' && f.type !== 'cut') U.row(b, 'Непрозрачность', U.range(o, key + '.op', 1, pct));
}

// spread — ещё «Размер» (тень больше или меньше самого объекта; только у box-shadow)
function teShadowRows(b, o, key, spread) {
  const U = teUi;
  U.row(b, '', U.chk(o, key + '.on', 'тень', true));
  if (!teGet(o, key + '.on', false)) return;
  U.row(b, 'Цвет', U.color(o, key + '.color', '#000000'));
  U.row(b, 'Непрозрачность', U.range(o, key + '.op', 0.6, pct));
  U.row(b, 'Размытие', U.range(o, key + '.blur', 1.5, { min: 0, max: 6, step: 0.1 }));
  if (spread) U.row(b, 'Размер', U.range(o, key + '.spread', 0, { min: -3, max: 6, step: 0.1 }));
  U.row(b, 'Угол', U.range(o, key + '.angle', 90, { min: 0, max: 360, unit: '°' }));
  U.row(b, 'Смещение', U.range(o, key + '.dist', 0.5, { min: 0, max: 4, step: 0.05 }));
}

/* ----- Выбор шрифта: свои, основные, недавние и все шрифты Windows; поиск, имя — самим шрифтом ----- */

const teFontName = (f) => Scene.FONT_NAMES[f] || f;
async function teLoadSysFonts() {
  if (teSysFonts) return teSysFonts;
  try { teSysFonts = (await window.api.fontsSystem()) || []; } catch { teSysFonts = []; }
  return teSysFonts;
}
let tePop = null;
function teClosePop() { if (tePop) { tePop.remove(); tePop = null; } }
window.addEventListener('pointerdown', (e) => { if (tePop && !tePop.contains(e.target) && !e.target.closest('.te-fontbtn')) teClosePop(); }, true);

function teFontPicker(anchor, cur, pick) {
  teClosePop();
  const pop = teEl('div', 'te-pop');
  const q = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'Поиск шрифта…' });
  const list = teEl('div', 'fl');
  pop.append(q, list);
  document.body.append(pop);
  tePop = pop;
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 306)) + 'px';
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 6) + 'px';
  const choose = (f) => {
    teOpt.recentFonts = [f, ...teOpt.recentFonts.filter((x) => x !== f)].slice(0, 6);
    teSaveOpt();
    teClosePop();
    pick(f);
  };
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const ok = (f) => !s || teFontName(f).toLowerCase().includes(s);
    list.replaceChildren();
    const group = (title, fonts, btn) => {
      const shown = fonts.filter(ok);
      if (!shown.length && !btn) return;
      const h = teEl('div', 'fh', title);
      if (btn) h.append(btn);
      list.append(h);
      for (const f of shown.slice(0, 400)) {
        const row = teEl('div', 'fr' + (f === cur ? ' on' : ''), teFontName(f));
        row.style.fontFamily = Scene.family(f);
        row.addEventListener('click', () => choose(f));
        list.append(row);
      }
    };
    const add = teEl('button', null, '+ файл…');
    add.title = 'Добавить свой файл шрифта (TTF, OTF, WOFF)';
    add.addEventListener('click', async () => { const a = await teAddFont(); if (a && a.length) choose(a[0].family); });
    group('Недавние', teOpt.recentFonts);
    group('Свои', [...new Set(Scene.fontsList().map((f) => f.family))], add);
    group('Основные', Object.keys(Scene.FONT_NAMES));
    if (teSysFonts) group(`Шрифты Windows (${teSysFonts.length})`, teSysFonts);
    else list.append(teEl('div', 'fh', 'Шрифты Windows — загрузка…'));
    if (s && !list.querySelector('.fr')) {
      const any = teEl('div', 'fr', `Использовать «${q.value.trim()}»`);
      any.addEventListener('click', () => choose(q.value.trim()));
      list.append(any);
    }
  };
  q.addEventListener('input', draw);
  q.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') teClosePop();
    if (e.key === 'Enter') { const f = list.querySelector('.fr'); if (f) f.click(); }
  });
  draw();
  q.focus();
  if (!teSysFonts) teLoadSysFonts().then(() => { if (tePop === pop) draw(); });
}

function teInspText(fs, o) {
  const U = teUi;
  let b = U.sec(fs, 'Текст', true);
  U.row(b, 'Что выводить', U.sel(o, 'bind', 'static', Object.entries(Themes.BINDS), true));
  if (o.bind === 'static') {
    const ta = Object.assign(document.createElement('textarea'), { id: 'teTextVal', rows: 3, value: o.text || '' });
    ta.addEventListener('input', () => teEdit(() => { o.text = ta.value; }, { list: false }));
    b.append(ta);
  } else if (o.bind === 'timer') {
    // Какой таймер выводить (те же, что в блоке «Таймеры» и на сцене — stage.js) и как писать время
    const list = (typeof lib !== 'undefined' && lib && lib.timers) || [];
    U.row(b, 'Таймер', U.sel(o, 'timer', '', [['', '— выберите —'], ...list.map((t) => [t.id, t.name])], true),
      teIconBtn('add', 'Новый таймер (обратный отсчёт 5:00) — и сразу сюда', () => { const id = stNewTimer({ dur: 300 }); teEdit(() => { o.timer = id; }, { insp: true }); }));
    U.row(b, 'Вид', U.sel(o, 'tmFmt', '', [['', 'Сам (05:00 или 1:05:00)'], ['ms', 'ММ:СС (65:00)'], ['hms', 'ЧЧ:ММ:СС'], ['over', 'Сам, после нуля — с минусом']]));
    U.hint(b, 'Здесь идёт время выбранного таймера. Запускать, останавливать и настраивать его — в блоке «Таймеры» под предпросмотром. Таймер можно и сам вывести в поле любой презентации: в таймере «⋯ → Вывести в текстовое поле…».');
  } else if (o.bind === 'content' && teSlideRef() && teSlideRef().slide.k === 'text') {
    // Режим слайда: текст этого слайда правится прямо здесь (у песни — уходит и в её текст)
    const s = teSlideRef().slide;
    const ta = Object.assign(document.createElement('textarea'), { id: 'teTextVal', rows: 4, value: s.text || '' });
    ta.addEventListener('input', () => teEdit(() => { s.text = ta.value; }, { list: false }));
    b.append(ta);
  } else U.hint(b, o.bind === 'content' && teSlide ? 'Сюда встаёт текст слайда.' : o.bind === 'content' ? 'Сюда встаёт текст слайда: строки песни или стих. Пример — выбор «Пример» под холстом.' : 'Данные берутся из программы. Если их нет (например, у песни не указан CCLI), поле просто не выводится.');
  const fb = teEl('button', 'te-fontbtn', teFontName(o.font));
  fb.style.fontFamily = Scene.family(o.font);
  fb.title = 'Шрифт: свои, основные и все шрифты Windows';
  fb.addEventListener('click', () => teFontPicker(fb, o.font, (f) => { teEdit(() => { o.font = f; }, { list: false, insp: true }); }));
  U.row(b, 'Шрифт', fb);
  U.row(b, 'Размер', U.num(o, 'size', 7, { step: 0.5, min: 0.5, max: 60 }), teEl('span', 'te-hint', '% высоты экрана'));
  U.row(b, 'Жирность', U.sel(o, 'weight', 500, [[100, 'Сверхтонкий'], [200, 'Очень тонкий'], [300, 'Тонкий'], [400, 'Обычный'], [500, 'Средний'], [600, 'Полужирный'], [700, 'Жирный'], [800, 'Очень жирный'], [900, 'Чёрный']]));
  const st = teEl('span', 'te-seg');
  st.append(U.toggle(o, 'italic', 'К', 'Курсив', 'font-style:italic'), U.toggle(o, 'underline', 'Ч', 'Подчёркнутый', 'text-decoration:underline'), U.toggle(o, 'strike', 'З', 'Зачёркнутый', 'text-decoration:line-through'));
  U.row(b, 'Начертание', st);
  U.row(b, 'Регистр', U.seg(o, 'case', '', [['', 'Аа', 'Как написано'], ['upper', 'АА', 'ВСЕ ЗАГЛАВНЫЕ'], ['lower', 'аа', 'все строчные'], ['title', 'Аа Бб', 'Каждое Слово С Заглавной']], false, (v) => { o.upper = v === 'upper'; }));
  U.row(b, 'По ширине', U.seg(o, 'align', 'center', [['left', 'glyph:left', 'Слева'], ['center', 'glyph:center', 'По центру'], ['right', 'glyph:right', 'Справа'], ['justify', 'glyph:justify', 'По ширине']]));
  U.row(b, 'По высоте', U.seg(o, 'valign', 'middle', [['top', 'glyph:top', 'Сверху'], ['middle', 'glyph:middle', 'По центру'], ['bottom', 'glyph:bottom', 'Снизу']]));
  U.row(b, 'Межстрочный', U.range(o, 'lh', 1.25, { min: 0.7, max: 3, step: 0.05 }));
  U.row(b, 'Межбуквенный', U.range(o, 'ls', 0, { min: -10, max: 60, k: 100, step: 1, unit: 'сотые em' }));
  U.row(b, 'Поля внутри', U.range(o, 'pad', 1, { min: 0, max: 10, step: 0.1 }));

  b = U.sec(fs, 'Подгонка текста', false);
  U.row(b, 'Не помещается', U.sel(o, 'fit', 'shrink', [['shrink', 'уменьшать'], ['grow', 'увеличивать до заполнения'], ['both', 'подгонять в пределах'], ['box', 'блок по размеру текста'], ['none', 'как задано']], true));
  if (o.fit === 'shrink' || o.fit === 'both') U.row(b, 'Не меньше', U.num(o, 'min', 1, { step: 0.5, min: 0.2 }), teEl('span', 'te-hint', '% высоты'));
  if (o.fit === 'grow' || o.fit === 'both') U.row(b, 'Не больше', U.num(o, 'max', 14, { step: 0.5, min: 0.5 }), teEl('span', 'te-hint', '% высоты'));
  U.hint(b, { shrink: 'Длинный текст уменьшается, пока не поместится в блок.', grow: 'Короткий текст увеличивается до «не больше», чтобы заполнить блок.', both: 'Текст сам становится как можно крупнее в пределах «не меньше» — «не больше».', box: 'Высота блока — по тексту: больше строк — блок и подложка выше.', none: 'Размер не меняется.' }[o.fit] || '');

  b = U.sec(fs, 'Цвет и заливка текста', true);
  tePaintRows(b, o, 'tfill', false, true);

  b = U.sec(fs, 'Обводка текста', false, o.tstroke.w > 0);
  U.row(b, 'Толщина', U.range(o, 'tstroke.w', 0, { min: 0, max: 1, step: 0.02 }));
  U.row(b, 'Цвет', U.color(o, 'tstroke.color', '#000000'));
  U.row(b, 'Непрозрачность', U.range(o, 'tstroke.op', 1, pct));
  teShadowRows(U.sec(fs, 'Тень текста', false, o.tshadow.on), o, 'tshadow');

  b = U.sec(fs, 'Подложка под текстом', false, o.plate.on);
  U.row(b, '', U.chk(o, 'plate.on', 'подложка', true));
  if (o.plate.on) {
    const pm = o.plate.mode || 'block';
    U.row(b, 'Вид', U.seg(o, 'plate.mode', 'block', [['block', 'Под текст', 'Одна подложка под весь текст — растёт вместе с ним'], ['lines', 'По строкам', 'Отдельная полоса под каждой строкой'], ['fixed', 'Размер', 'Подложка своего размера'], ['wide', 'Экран', 'Во всю ширину экрана, по высоте — как текст']], true));
    // Ширина подложки (и полос по строкам): по тексту или от края до края текстового блока
    const canFull = pm === 'block' || pm === 'lines';
    const full = canFull && !!o.plate.full;
    if (canFull) {
      U.row(b, 'Ширина', U.seg(o, 'plate.full', false, pm === 'lines'
        ? [[false, 'По строке', 'Каждая полоса — длиной со свою строку'], [true, 'Во весь блок', 'Полосы от края до края текстового блока']]
        : [[false, 'По тексту', 'Подложка — по ширине текста'], [true, 'Во весь блок', 'Подложка от края до края текстового блока']], true));
    }
    U.row(b, 'Цвет', U.color(o, 'plate.color', '#000000'));
    U.row(b, 'Непрозрачность', U.range(o, 'plate.op', 0.5, pct));
    if (pm !== 'lines' || full) U.row(b, 'Размытие за ней', U.range(o, 'plate.blur', 0, { min: 0, max: 5, step: 0.1 }));
    if (pm === 'lines' && full) {
      U.row(b, 'Зазор', U.range(o, 'plate.gap', 0.8, { min: 0, max: 5, step: 0.1 }));
      U.hint(b, 'Полоса — во всю высоту строки: толще полосы — больше «Межстрочный» выше, тоньше — больше «Зазор».');
    } else U.row(b, full ? 'Поля сверху/снизу' : 'Поля от текста', U.range(o, 'plate.pad', 1.5, { min: 0, max: 8, step: 0.1 }));
    if (full && o.scroll.on) U.hint(b, 'У бегущей строки подложка — по тексту.');
    U.row(b, 'Скругление', U.range(o, 'plate.radius', 1, { min: 0, max: 10, step: 0.1 }));
    if (o.plate.mode === 'fixed') {
      U.row(b, 'Ширина, %', U.num(o, 'plate.w', 80, { step: 1, min: 1, max: 100 }));
      U.row(b, 'Высота, %', U.num(o, 'plate.h', 20, { step: 1, min: 1, max: 100 }));
    }
    U.row(b, 'Сдвиг X / Y', U.num(o, 'plate.dx', 0, { step: 0.2 }), U.num(o, 'plate.dy', 0, { step: 0.2 }));
    U.row(b, 'Обводка', U.range(o, 'plate.stroke.w', 0, { min: 0, max: 1, step: 0.02 }));
    U.row(b, 'Цвет обводки', U.color(o, 'plate.stroke.color', '#ffffff'));
  }
  // Тень подложки — своим разделом (как «Тень текста»); у полос — у каждой полосы
  if (o.plate.on) {
    b = U.sec(fs, 'Тень подложки', false, o.plate.shadow.on);
    teShadowRows(b, o, 'plate.shadow', true);
    if (o.plate.shadow.on && teGet(o, 'tfill.type', '') === 'cut') U.hint(b, 'У вырезанного текста тени подложки не видно.');
  }

  b = U.sec(fs, 'Бегущая строка', false, o.scroll.on);
  U.row(b, '', U.chk(o, 'scroll.on', 'текст бежит', true));
  if (o.scroll.on) {
    U.row(b, 'Куда', U.seg(o, 'scroll.dir', 'left', [['left', '← Влево'], ['up', '↑ Вверх']]));
    U.row(b, 'Скорость', U.range(o, 'scroll.speed', 10, { min: 1, max: 40, step: 0.5 }));
    U.row(b, 'Растворение', U.range(o, 'scroll.fade', 6, { min: 0, max: 30, unit: '%' }));
  }
}

function teInspAnim(fs, o) {
  const U = teUi;
  const a = o.anim;
  const b = U.sec(fs, 'Анимация', false, a.in.type !== 'none' || a.out.type !== 'none');
  const types = [['none', 'нет'], ['fade', 'проявление'], ['move', 'выезд'], ['scale', 'масштаб'], ['blur', 'из размытия']];
  U.row(b, 'Появление', U.sel(o, 'anim.in.type', 'none', types, true));
  if (a.in.type !== 'none') {
    if (o.kind === 'text') U.row(b, 'Как', U.sel(o, 'anim.in.by', 'all', [['all', 'целиком'], ['lines', 'по строкам'], ['words', 'по словам'], ['chars', 'по буквам']]));
    U.row(b, 'Длительность', U.num(o, 'anim.in.ms', 600, { step: 50, min: 0 }), teEl('span', 'te-hint', 'мс'));
    U.row(b, 'Задержка', U.num(o, 'anim.in.delay', 0, { step: 50, min: 0 }), teEl('span', 'te-hint', 'мс'));
    if (a.in.type === 'move') U.row(b, 'Откуда', U.seg(o, 'anim.in.dir', 'up', [['up', '↑', 'Снизу вверх'], ['down', '↓', 'Сверху вниз'], ['left', '←', 'Справа налево'], ['right', '→', 'Слева направо']]));
    U.row(b, 'Запуск', U.sel(o, 'anim.in.trigger', 'slide', [['slide', 'вместе со слайдом'], ['cmd', 'по команде (клавиша N)']], true));
    if (a.in.trigger === 'cmd') U.row(b, 'Порядок', U.num(o, 'anim.in.order', 1, { step: 1, min: 1 }));
  }
  U.row(b, 'Исчезновение', U.sel(o, 'anim.out.type', 'none', types, true));
  if (a.out.type !== 'none') {
    U.row(b, 'Длительность', U.num(o, 'anim.out.ms', 400, { step: 50, min: 0 }), teEl('span', 'te-hint', 'мс'));
    U.row(b, 'Задержка', U.num(o, 'anim.out.delay', 0, { step: 50, min: 0 }), teEl('span', 'te-hint', 'мс'));
    if (a.out.type === 'move') U.row(b, 'Куда', U.seg(o, 'anim.out.dir', 'down', [['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→']]));
  }
  U.hint(b, '«По команде» — объект ждёт: клавиша N показывает следующий по порядку. Исчезновение играет, когда слайд убирают или меняют шаблон.');
  U.btns(b, [['Проверить', () => teRenderCanvas(true), 'Проиграть анимации на холсте', 'show']]);
}

function teInspMulti(fs, sel) {
  const U = teUi;
  teTitle(fs, 'group', `Выделено объектов: ${sel.length}`);
  let b = U.sec(fs, 'Выровнять', true);
  const al = teEl('div', 'te-btns');
  for (const [k, ic, tt] of [['l', 'alignL', 'По левому краю'], ['c', 'alignC', 'По центру'], ['r', 'alignR', 'По правому краю'], ['t', 'alignT', 'По верху'], ['m', 'alignM', 'По центру по высоте'], ['b', 'alignB', 'По низу'], ['dh', 'distH', 'Распределить по ширине'], ['dv', 'distV', 'Распределить по высоте']]) {
    al.append(teIconBtn(ic, tt, (e) => teAlign(k, e.altKey)));
  }
  b.append(al);
  U.hint(b, 'Выравнивание — по общей рамке выделенных; с Alt — по экрану.');
  U.btns(b, [['Одной ширины', () => teAlign('sw'), 'Как у первого выделенного', 'sameW'], ['Одной высоты', () => teAlign('sh'), 'Как у первого выделенного']]);
  b = U.sec(fs, 'Действия', true);
  U.btns(b, [['Сгруппировать', () => teGroup(true), 'Ctrl+G', 'group'], ['Разгруппировать', () => teGroup(false)]]);
  U.btns(b, [['Копировать', () => teCopy(false), 'Ctrl+C', 'copy'], ['Дублировать', teDup, 'Ctrl+D'], ['Удалить', teDelete, 'Delete', 'trash']]);
  U.btns(b, [['Замок', () => teToggle('locked'), 'Ctrl+L', 'lock'], ['Скрыть', () => teToggle('hidden'), 'Ctrl+H', 'eye']]);
  b = U.sec(fs, 'Вид всех', true);
  const r = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, step: 5, value: Math.round((sel[0].opacity != null ? sel[0].opacity : 1) * 100) });
  r.dataset.def = 100;
  r.addEventListener('input', () => teEdit(() => sel.forEach((o) => { o.opacity = Number(r.value) / 100; }), { list: false }));
  U.row(b, 'Непрозрачность', r);
  const texts = sel.filter((o) => o.kind === 'text');
  if (texts.length) {
    const fb = teEl('button', 'te-fontbtn', 'Шрифт для всех текстов…');
    fb.addEventListener('click', () => teFontPicker(fb, texts[0].font, (f) => teEdit(() => texts.forEach((o) => { o.font = f; }), { list: false })));
    U.row(b, 'Шрифт', fb);
    const c = ColorPicker.field((texts[0].tfill && texts[0].tfill.color) || '#ffffff', texts[0].tfill && texts[0].tfill.op != null ? texts[0].tfill.op : 1,
      (v, op) => teEdit(() => texts.forEach((o) => { o.tfill.type = o.tfill.type === 'cut' ? 'cut' : 'color'; o.tfill.color = v; if (op != null) o.tfill.op = Math.round(op * 100) / 100; }), { list: false }));
    U.row(b, 'Цвет текста', c);
  }
  U.hint(b, 'Тяните любой из выделенных — двигаются все. Группа (Ctrl+G) выделяется одним щелчком.');
}

/* ===== Кнопки над холстом и под ним ===== */

function teSyncBar() {
  for (const [id, k] of [['teSnap', 'snap'], ['teGrid', 'grid'], ['teSafe', 'safe'], ['teRulers', 'rulers']]) $(id).setAttribute('aria-pressed', String(!!teOpt[k]));
  $('teUnderSel').value = teOpt.under === 'file' && !teOpt.underUrl ? 'check' : teOpt.under;
  $('teSample').value = teOpt.sample;
  $('teSampleText').hidden = teOpt.sample !== 'own';
  $('teSampleText').value = teOpt.sampleText;
  $('teUndo').disabled = !histUndo.length && !saveTimer;
  $('teRedo').disabled = !histRedo.length;
  const ro = teRO();
  const none = !teSel.length;
  document.querySelectorAll('#teAdd button').forEach((b) => { b.disabled = ro; });
  document.querySelectorAll('#teAlign button, #teOrder button').forEach((b) => { b.disabled = ro || none; });
  $('teExport').disabled = !teTheme() || !!teSlide;
  $('teSample').disabled = !!teSlide; // в режиме слайда на холсте — его настоящий текст
  if (teSlide) { // свой вид слайда: сохраняется сразу; «Обновить на экране» — если слайд сейчас показан
    const on = !!teSlideOnAir();
    const r = teSlideRef();
    Icons.label($('teApply'), 'Обновить на экране');
    $('teApply').title = on ? 'Показать правки на экране (Ctrl+Enter)' : 'Этого слайда сейчас нет на экране — правки уже в слайде';
    $('teApply').disabled = !on;
    $('teApply').classList.toggle('primary', on);
    Icons.label($('teRevert'), r && r.slide.k === 'custom' ? 'Фон как в теме' : 'Как в теме');
    $('teRevert').title = 'Убрать свой вид слайда: снова как в теме';
    $('teRevert').disabled = !(r && r.slide.look && !teSlide.fresh);
    return;
  }
  Icons.label($('teApply'), 'Применить тему');
  $('teApply').title = 'Показать правки на экране и в слайдах (Ctrl+Enter)';
  Icons.label($('teRevert'), 'Сбросить');
  $('teRevert').title = 'Выбросить правки и вернуть тему к тому виду, что на экране';
  const dirty = teDirty(teTheme());
  $('teApply').disabled = !dirty;
  $('teRevert').disabled = !dirty;
  $('teApply').classList.toggle('primary', dirty);
}
for (const [id, k] of [['teSnap', 'snap'], ['teGrid', 'grid'], ['teSafe', 'safe'], ['teRulers', 'rulers']]) {
  $(id).addEventListener('click', () => { teOpt[k] = !teOpt[k]; teSaveOpt(); teSyncBar(); teLayout(); });
}
$('teSample').addEventListener('change', () => {
  teOpt.sample = $('teSample').value;
  teSaveOpt();
  teSyncBar();
  if (teOpt.sample === 'own') $('teSampleText').focus();
  teRenderCanvas();
  teRenderList();
});
$('teSampleText').addEventListener('input', () => { teOpt.sampleText = $('teSampleText').value; teSaveOpt(); teRenderCanvas(); teThumbSoon(); });
$('teSampleText').addEventListener('keydown', (e) => e.stopPropagation());
$('teUnderSel').addEventListener('change', async () => {
  const v = $('teUnderSel').value;
  if (v === 'file') {
    const [f] = await window.api.pickFile({ kinds: ['image', 'video'], title: 'Что показать под темой (только для просмотра)' });
    if (f) Object.assign(teOpt, { under: 'file', underUrl: f.url, underVideo: f.type === 'video' });
  } else teOpt.under = v;
  teSaveOpt();
  teSyncBar();
  teRenderUnder();
});
$('tePlay').addEventListener('click', () => teRenderCanvas(true));
$('teApply').addEventListener('click', teApply);
$('teRevert').addEventListener('click', teRevert);
$('teUndo').addEventListener('click', () => libUndo());
$('teRedo').addEventListener('click', () => libRedo());

/* ===== Клавиши (renderer.js зовёт teKey раньше общих горячих клавиш; true — нажатие обработано) ===== */

let teArrowTimer = 0;
function teKey(e) {
  if (e.altKey) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.code;
  const has = teSel.length > 0;
  if (ctrl) {
    if (k === 'Enter' || k === 'NumpadEnter') { teApply(); return true; }
    if (k === 'KeyA') { teSel = teObjs().filter((o) => !o.hidden).map((o) => o.id); teSelChanged(); return true; }
    if (k === 'KeyC' && has) { teCopy(false); return true; }
    if (k === 'KeyX' && has) { teCopy(true); return true; }
    if (k === 'KeyV' && !e.shiftKey) { tePaste(); return true; }
    if (k === 'KeyD' && has) { teDup(); return true; }
    if (k === 'KeyG') { teGroup(!e.shiftKey); return true; }
    if (k === 'KeyL' && has) { teToggle('locked'); return true; }
    if (k === 'KeyH' && has) { teToggle('hidden'); return true; }
    if (k === 'BracketRight' && has) { teZ(e.shiftKey ? 'front' : 1); return true; }
    if (k === 'BracketLeft' && has) { teZ(e.shiftKey ? 'back' : -1); return true; }
    return false;
  }
  if (e.key === 'Escape' && (has || tePop)) { teClosePop(); teSel = []; teSelChanged(); return true; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && has) { teDelete(); return true; }
  if (!e.shiftKey && { KeyT: 1, KeyR: 1, KeyO: 1 }[k]) { teAddObj({ KeyT: 'text', KeyR: 'rect', KeyO: 'ellipse' }[k]); return true; }
  if (!e.shiftKey && k === 'KeyL') { teAddObj('line'); return true; }
  if (e.key.startsWith('Arrow') && has) {
    const st = e.shiftKey ? 2 : 0.2;
    const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0;
    const dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
    teEdit(() => teSelObjs().filter((o) => !o.locked).forEach((o) => { o.x = r1(o.x + dx); o.y = r1(o.y + dy); }), { list: false });
    teRenderOverlay();
    clearTimeout(teArrowTimer);
    teArrowTimer = setTimeout(teRenderInsp, 300);
    return true;
  }
  return false;
}
