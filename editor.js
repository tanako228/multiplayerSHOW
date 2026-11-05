/* ---------- Окно редактора: слайды (песни и свои слайды) и картинки (темы — вкладка «Темы» главного окна) ----------
   Редактор правит копию. «Сохранить» отправляет результат окну оператора (через main.js),
   а оно сохраняет библиотеку. Список тем приходит из окна оператора (editor:themes). */

const $ = (id) => document.getElementById(id);
const W = 1920;
const H = 1080;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = (x) => JSON.parse(JSON.stringify(x));

const THEME_DEFAULTS = {
  font: 'segoe', scale: 1, color: '#ffffff', bg: '#000000', bgUrl: '', bgVideo: false, blur: 0, dim: 0,
  weight: 500, italic: false, align: 'center', valign: 'middle', shadow: false, upper: false, lineHeight: 1.25, pad: 5,
};

let themes = [];
let themeFor = {};
let tplFor = {}; // шаблон темы, выбранный в окне темы для всех слайдов вида (у презентации — it.tpl)
let base = {};          // «Текст Библии» из настроек — когда темы нет
let item = null;        // песня или свои слайды
let slideIdx = 0;
let selEl = null;       // id выбранного блока на своём слайде
let dirty = false;

function setDirty(on) {
  dirty = on;
  const st = $('status');
  st.textContent = on ? 'Есть несохранённые изменения' : st.dataset.saved || '';
  st.classList.toggle('dirty', on);
}
function savedNote(text) {
  $('status').dataset.saved = text;
  setDirty(false);
  setTimeout(() => { if (!dirty && $('status').dataset.saved === text) $('status').textContent = ''; }, 4000);
}
// Короткая надпись, которая не трогает отметку о несохранённых изменениях
function note(text) {
  const st = $('status');
  st.textContent = text;
  setTimeout(() => { if (st.textContent === text) setDirty(dirty); }, 2500);
}

/* ===== Вкладки ===== */

let view = 'slides';
function setView(v) {
  view = v;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === v)));
  document.querySelectorAll('section.view').forEach((s) => { s.hidden = s.dataset.view !== v; });
  requestAnimationFrame(layoutAll);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

/* ===== Общее: сцена 1920×1080, уменьшенная под место ===== */

function fitHost(wrap, host, stage) {
  const s = Math.min(wrap.clientWidth / W, wrap.clientHeight / H) || 0.1;
  Object.assign(host.style, { width: W * s + 'px', height: H * s + 'px', left: (wrap.clientWidth - W * s) / 2 + 'px', top: (wrap.clientHeight - H * s) / 2 + 'px' });
  Object.assign(stage.style, { width: W + 'px', height: H + 'px', transform: `scale(${s})` });
  Scene.refit(stage);
}
function layoutAll() {
  if (view === 'slides') fitHost($('slWrap'), $('slHost'), $('slStage'));
}
new ResizeObserver(layoutAll).observe(document.body);

function styleFor(kind, it, slide) {
  const id = (slide && slide.theme) || (it && it.theme) || themeFor[kind] || '';
  const t = Themes.find(themes, id); // свои и стандартные темы
  if (!t) return kind === 'custom' ? { ...THEME_DEFAULTS, ...base } : base;
  return { ...THEME_DEFAULTS, ...Themes.style(t), showTranslation: base.showTranslation, tpl: (it && it.tpl) || tplFor[kind] || undefined };
}

// Слайд любого вида (slides.js) → то, что рисует сцена
const contentFor = (it, slide) => Slides.content(slide, styleFor(Slides.themeKind(slide), it, slide),
  { fit: 'contain', sound: false, loop: true, meta: { title: it.name, ccli: it.song && it.song.ccli, number: it.song && it.song.number } });

// Миниатюра: та же сцена, только маленькая
function miniScene(content) {
  const box = Object.assign(document.createElement('div'), { className: 'thumb' });
  if (content.style) content = { ...content, style: { ...content.style, bgVideo: false, bgUrl: content.style.bgVideo ? '' : content.style.bgUrl, still: true } };
  box.append(Scene.build(content));
  return box;
}
const fitMinis = (root) => requestAnimationFrame(() => (root.classList.contains('thumb') ? [root] : root.querySelectorAll('.thumb')).forEach((t) => Scene.refit(t)));

function fillThemeSelects() {
  const first = { itTheme: 'Общая (по умолчанию)', slTheme: 'Как у пункта' };
  document.querySelectorAll('select.theme-sel').forEach((sel) => {
    const keep = sel.value;
    sel.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: first[sel.id] || 'Без темы (из настроек)' }),
      ...Themes.all(themes).map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })));
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
  });
}

document.querySelectorAll('select.font-sel').forEach((sel) => {
  for (const [k, v] of Object.entries(Scene.FONT_NAMES)) sel.append(Object.assign(document.createElement('option'), { value: k, textContent: v }));
  if (sel.id === 'thFont') sel.append(Object.assign(document.createElement('option'), { value: '__other', textContent: 'Другой…' }));
});

/* ===== Слайды ===== */

const curSlide = () => (item ? item.slides[slideIdx] : null);
const curEl = () => { const s = curSlide(); return s && s.elements ? s.elements.find((e) => e.id === selEl) : null; };

function renderSlides() {
  const has = !!item;
  $('slEmpty').hidden = has;
  $('slHost').hidden = !has;
  $('slProps').style.visibility = has ? 'visible' : 'hidden';
  ['slAdd', 'slDup', 'slUp', 'slDown', 'slDel'].forEach((id) => { $(id).disabled = !has; });
  const list = $('slideList');
  list.replaceChildren();
  if (!has) return;
  item.slides.forEach((s, i) => {
    const t = s.k === 'image' ? Object.assign(document.createElement('div'), { className: 'thumb' }) : miniScene(contentFor(item, s));
    if (s.k === 'image') t.append(Object.assign(document.createElement('img'), { src: s.url, style: 'width:100%;height:100%;object-fit:contain;display:block' }));
    t.classList.toggle('sel', i === slideIdx);
    t.classList.toggle('multi', multi.has(i) && multi.size > 1);
    t.append(Object.assign(document.createElement('span'), { className: 'n', textContent: (i + 1) + (s.label ? ' · ' + s.label : '') }),
      Object.assign(document.createElement('span'), { className: 'k', textContent: Slides.SLIDE_NAMES[s.k] || '' }));
    t.addEventListener('click', (e) => pickSlide(i, e));
    t.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!multi.has(i)) pickSlide(i, {});
      showMenu(e, [
        { label: 'Копировать', key: 'Ctrl+C', fn: () => edCopy(false) },
        { label: 'Вырезать', key: 'Ctrl+X', fn: () => edCopy(true) },
        { label: 'Вставить после', key: 'Ctrl+V', fn: edPaste },
        { label: 'Дублировать', fn: () => $('slDup').click() },
        '-',
        { label: 'Удалить', fn: () => $('slDel').click() },
      ]);
    });
    list.append(t);
  });
  fitMinis(list);
  $('slUp').disabled = slideIdx === 0;
  $('slDown').disabled = slideIdx >= item.slides.length - 1;
  $('slDel').disabled = item.slides.length <= multi.size;
  renderCanvas();
  renderProps();
}

let thumbTimer = 0;
function refreshThumb() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    const t = $('slideList').children[slideIdx];
    if (!t || !item) return;
    const fresh = miniScene(contentFor(item, curSlide()));
    t.replaceChildren(...fresh.childNodes, t.querySelector('.n'), t.querySelector('.k'));
    const s = curSlide();
    t.querySelector('.n').textContent = (slideIdx + 1) + (s.label ? ' · ' + s.label : '');
    fitMinis(t);
  }, 150);
}

function renderCanvas() {
  if (!item) return;
  fitHost($('slWrap'), $('slHost'), $('slStage'));
  Scene.show($('slStage'), contentFor(item, curSlide()), { type: 'none', ms: 0 });
  renderOverlay();
}

function changed() {
  setDirty(true);
  renderCanvas();
  refreshThumb();
}

/* Блоки своего слайда: выбор, перетаскивание, размер */

function renderOverlay() {
  const ov = $('slOverlay');
  ov.replaceChildren();
  const s = curSlide();
  if (!s || s.k !== 'custom') return;
  for (const e of s.elements) {
    const box = Object.assign(document.createElement('div'), { className: 'box' + (e.id === selEl ? ' sel' : '') });
    Object.assign(box.style, { left: e.x + '%', top: e.y + '%', width: e.w + '%', height: e.h + '%', transform: e.rot ? `rotate(${e.rot}deg)` : '' });
    if (e.id === selEl) for (const h of ['nw', 'ne', 'sw', 'se']) box.append(Object.assign(document.createElement('div'), { className: 'handle ' + h }));
    box.addEventListener('pointerdown', (ev) => startDrag(ev, e));
    box.addEventListener('dblclick', () => { if (e.kind === 'text') { $('elValue').focus(); $('elValue').select(); } });
    ov.append(box);
  }
}

$('slOverlay').addEventListener('pointerdown', (ev) => {
  if (ev.target === $('slOverlay') && selEl) { selEl = null; renderOverlay(); renderProps(); }
});

function startDrag(ev, e) {
  ev.preventDefault();
  ev.stopPropagation();
  if (selEl !== e.id) { selEl = e.id; renderOverlay(); renderProps(); }
  const mode = ev.target.classList.contains('handle') ? [...ev.target.classList].find((c) => c !== 'handle') : 'move';
  const ov = $('slOverlay');
  const sx = ev.clientX;
  const sy = ev.clientY;
  const o = { x: e.x, y: e.y, w: e.w, h: e.h };
  const target = ov;
  target.setPointerCapture(ev.pointerId);
  let moved = false;
  const move = (m) => {
    const dx = ((m.clientX - sx) / ov.clientWidth) * 100;
    const dy = ((m.clientY - sy) / ov.clientHeight) * 100;
    if (Math.abs(dx) + Math.abs(dy) > 0.1) moved = true;
    const r = (v) => Math.round(v * 10) / 10;
    if (mode === 'move') { e.x = r(o.x + dx); e.y = r(o.y + dy); }
    else {
      if (mode.includes('e')) e.w = r(Math.max(2, o.w + dx));
      if (mode.includes('s')) e.h = r(Math.max(2, o.h + dy));
      if (mode.includes('w')) { e.w = r(Math.max(2, o.w - dx)); e.x = r(o.x + o.w - e.w); }
      if (mode.includes('n')) { e.h = r(Math.max(2, o.h - dy)); e.y = r(o.y + o.h - e.h); }
    }
    Scene.show($('slStage'), contentFor(item, curSlide()), { type: 'none', ms: 0 });
    renderOverlay();
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    if (moved) { setDirty(true); refreshThumb(); }
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
}

/* Свойства справа */

function renderProps() {
  if (!item) return;
  const s = curSlide();
  if (!s) return;
  const isText = s.k === 'text' || s.k === 'bible';
  const isMedia = s.k === 'image' || s.k === 'video' || s.k === 'audio';
  $('itName').value = item.name;
  $('itTheme').value = item.theme || '';
  $('slKind').textContent = Slides.SLIDE_NAMES[s.k] || '';
  $('slLabel').value = s.label || '';
  $('slTheme').value = s.theme || '';
  $('slTheme').disabled = s.k === 'audio';
  fillTplSelect(s);
  $('songProps').hidden = !isText;
  $('customProps').hidden = s.k !== 'custom';
  $('mediaProps').hidden = !isMedia;
  $('slRefRow').hidden = s.k !== 'bible';
  if (isText && document.activeElement !== $('slText')) {
    $('slText').value = s.k === 'bible' ? (s.verses || []).map((v) => v.t).join(' ') : s.text || '';
  }
  if (s.k === 'bible' && document.activeElement !== $('slRef')) $('slRef').value = s.ref || '';
  if (isMedia) {
    $('slFile').textContent = (s.k === 'audio' ? '♪ ' : '') + (s.name || '') + (s.path ? `\n${s.path}` : '');
    $('slFitRow').hidden = s.k === 'audio';
    $('slFit').value = s.fit || '';
    $('slEditImage').hidden = s.k !== 'image';
    $('slAudioHint').hidden = s.k !== 'audio';
  }
  const e = curEl();
  $('elProps').hidden = s.k !== 'custom' || !e;
  if (!e) return;
  const isTextEl = e.kind === 'text';
  $('elText').hidden = !isTextEl;
  $('elImage').hidden = isTextEl;
  if (isTextEl) {
    if (document.activeElement !== $('elValue')) $('elValue').value = e.text || '';
    $('elFont').value = e.font || 'segoe';
    $('elSize').value = e.size || 6;
    $('elColor').value = e.color || '#ffffff';
    $('elBold').setAttribute('aria-pressed', String((e.weight || 500) >= 700));
    $('elItalic').setAttribute('aria-pressed', String(!!e.italic));
    $('elShadow').setAttribute('aria-pressed', String(!!e.shadow));
    $('elUpper').setAttribute('aria-pressed', String(!!e.upper));
    document.querySelectorAll('#elAlign button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === (e.align || 'center'))));
    document.querySelectorAll('#elValign button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === (e.valign || 'middle'))));
    $('elBgOn').checked = !!e.bgColor;
    $('elBg').value = e.bgColor || '#000000';
  } else {
    $('elFit').value = e.fit || 'contain';
    $('elRadius').value = e.radius || 0;
    $('elRadiusVal').textContent = e.radius || 0;
  }
  $('elOpacity').value = Math.round((e.opacity != null ? e.opacity : 1) * 100);
  $('elOpacityVal').textContent = $('elOpacity').value + '%';
  $('elRot').value = e.rot || 0;
  $('elRotVal').textContent = (e.rot || 0) + '°';
}

const onEl = (fn) => () => { const e = curEl(); if (!e) return; fn(e); changed(); renderProps(); };
$('elValue').addEventListener('input', onEl((e) => { e.text = $('elValue').value; }));
$('elFont').addEventListener('change', onEl((e) => { e.font = $('elFont').value; }));
$('elSize').addEventListener('input', onEl((e) => { e.size = Number($('elSize').value) || 6; }));
$('elColor').addEventListener('input', onEl((e) => { e.color = $('elColor').value; }));
$('elBold').addEventListener('click', onEl((e) => { e.weight = (e.weight || 500) >= 700 ? 500 : 700; }));
$('elItalic').addEventListener('click', onEl((e) => { e.italic = !e.italic; }));
$('elShadow').addEventListener('click', onEl((e) => { e.shadow = !e.shadow; }));
$('elUpper').addEventListener('click', onEl((e) => { e.upper = !e.upper; }));
document.querySelectorAll('#elAlign button').forEach((b) => b.addEventListener('click', onEl((e) => { e.align = b.dataset.v; })));
document.querySelectorAll('#elValign button').forEach((b) => b.addEventListener('click', onEl((e) => { e.valign = b.dataset.v; })));
$('elBgOn').addEventListener('change', onEl((e) => { e.bgColor = $('elBgOn').checked ? $('elBg').value : ''; }));
$('elBg').addEventListener('input', onEl((e) => { if ($('elBgOn').checked) e.bgColor = $('elBg').value; }));
$('elFit').addEventListener('change', onEl((e) => { e.fit = $('elFit').value; }));
$('elRadius').addEventListener('input', onEl((e) => { e.radius = Number($('elRadius').value); }));
$('elOpacity').addEventListener('input', onEl((e) => { e.opacity = Number($('elOpacity').value) / 100; }));
$('elRot').addEventListener('input', onEl((e) => { e.rot = Number($('elRot').value); }));

function moveLayer(d) {
  const s = curSlide();
  const i = s.elements.findIndex((e) => e.id === selEl);
  if (i < 0) return;
  const [e] = s.elements.splice(i, 1);
  s.elements.splice(d > 0 ? s.elements.length : 0, 0, e);
  changed();
}
function dupEl() {
  const e = curEl();
  if (!e) return;
  const c = { ...clone(e), id: newId(), x: e.x + 2, y: e.y + 2 };
  curSlide().elements.push(c);
  selEl = c.id;
  changed();
  renderProps();
}
function delEl() {
  const s = curSlide();
  if (!s || !s.elements || !selEl) return;
  s.elements = s.elements.filter((e) => e.id !== selEl);
  selEl = null;
  changed();
  renderProps();
}
$('elFront').addEventListener('click', () => moveLayer(1));
$('elBack').addEventListener('click', () => moveLayer(-1));
$('elDup').addEventListener('click', dupEl);
$('elDel').addEventListener('click', delEl);

$('itName').addEventListener('input', () => { item.name = $('itName').value; setDirty(true); });
$('itTheme').addEventListener('change', () => { item.theme = $('itTheme').value || undefined; changed(); renderSlides(); });
$('slLabel').addEventListener('input', () => { curSlide().label = $('slLabel').value; setDirty(true); refreshThumb(); });
$('slTheme').addEventListener('change', () => { curSlide().theme = $('slTheme').value || undefined; changed(); renderProps(); });
$('slTpl').addEventListener('change', () => { const s = curSlide(); if ($('slTpl').value) s.tpl = $('slTpl').value; else delete s.tpl; changed(); });

// Шаблоны темы, которая действует на слайд (у темы без шаблонов — только «сам»)
function fillTplSelect(s) {
  const id = s.theme || item.theme || themeFor[Slides.themeKind(s)] || '';
  const list = Themes.templatesOf(Themes.find(themes, id));
  $('slTplRow').hidden = !['text', 'bible', 'custom'].includes(s.k) || !list.length;
  $('slTpl').replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'Сам — по виду слайда' }),
    ...list.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })));
  $('slTpl').value = list.some((t) => t.id === s.tpl) ? s.tpl : '';
}
$('slText').addEventListener('input', () => {
  const s = curSlide();
  if (s.k === 'bible') s.verses = [{ n: (s.verses && s.verses[0] && s.verses[0].n) || 1, t: $('slText').value }];
  else s.text = $('slText').value;
  changed();
});
$('slRef').addEventListener('input', () => { curSlide().ref = $('slRef').value; changed(); });

// Текст или стих → свой слайд с блоком текста, который можно двигать и оформлять вручную
$('slToCustom').addEventListener('click', () => {
  const s = curSlide();
  const text = s.k === 'bible' ? (s.verses || []).map((v) => v.t).join(' ') : s.text || '';
  const els = [{ id: newId(), kind: 'text', x: 8, y: 15, w: 84, h: s.k === 'bible' ? 55 : 70, text, size: 7, align: 'center', valign: 'middle' }];
  if (s.k === 'bible' && s.ref) els.push({ id: newId(), kind: 'text', x: 8, y: 74, w: 84, h: 10, text: s.ref, size: 4, weight: 700, align: 'center', valign: 'middle' });
  item.slides[slideIdx] = { id: s.id, k: 'custom', label: s.label, theme: s.theme, elements: els };
  selEl = null;
  setDirty(true);
  renderSlides();
});

$('slFit').addEventListener('change', () => { const s = curSlide(); if ($('slFit').value) s.fit = $('slFit').value; else delete s.fit; changed(); });
$('slReplace').addEventListener('click', async () => {
  const s = curSlide();
  const kinds = s.k === 'audio' ? ['audio'] : ['image', 'video'];
  const [f] = await window.api.pickFile({ kinds, title: 'Заменить файл слайда' });
  if (!f) return;
  Object.assign(s, { k: f.type, url: f.url, path: f.path, name: f.name });
  setDirty(true);
  renderSlides();
});
// Картинку слайда правим на вкладке «Картинка»; после «Сохранить» она заменится в слайде
$('slEditImage').addEventListener('click', () => {
  const s = curSlide();
  if (!s.path) return;
  openImagePath(s.path, (s.name || item.name).replace(/\.[^.]+$/, ''), { itemId: item.id, slideId: s.id });
  setView('image');
});

function addTextBox() {
  const e = { id: newId(), kind: 'text', x: 15, y: 40, w: 70, h: 20, text: 'Новый текст', size: 7, align: 'center', valign: 'middle' };
  curSlide().elements.push(e);
  selEl = e.id;
  changed();
  renderProps();
  $('elValue').focus();
  $('elValue').select();
}

function addImageBox(url, x = 25, y = 20) {
  const e = { id: newId(), kind: 'image', x, y, w: 50, h: 60, url, fit: 'contain' };
  curSlide().elements.push(e);
  selEl = e.id;
  changed();
  renderProps();
}

$('addText').addEventListener('click', addTextBox);
$('addImage').addEventListener('click', async () => {
  const [f] = await window.api.pickFile({ kinds: ['image'], title: 'Картинка на слайд' });
  if (f) addImageBox(f.url);
});

// Картинку можно бросить на слайд из Проводника или медиапула
const wrap = $('slWrap');
const FILE_KIND = (p) => (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p) ? 'image' : /\.(mp4|webm|mov|m4v|ogv)$/i.test(p) ? 'video'
  : /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(p) ? 'audio' : '');
const fileSlide = (p) => ({ id: newId(), k: FILE_KIND(p), url: window.api.fileUrl(p), path: p, name: p.split(/[\\/]/).pop() });

// На свой слайд картинка встаёт блоком; на другие слайды файлы встают новыми слайдами после текущего
wrap.addEventListener('dragover', (e) => { e.preventDefault(); if (item) wrap.classList.add('drop'); });
wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
wrap.addEventListener('drop', (e) => {
  e.preventDefault();
  wrap.classList.remove('drop');
  if (!item) return;
  const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter((p) => p && FILE_KIND(p));
  if (curSlide().k === 'custom') {
    const r = $('slOverlay').getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 100;
    const py = ((e.clientY - r.top) / r.height) * 100;
    for (const p of paths) if (FILE_KIND(p) === 'image') addImageBox(window.api.fileUrl(p), Math.max(0, Math.min(75, px - 25)), Math.max(0, Math.min(70, py - 30)));
  } else insertSlides(paths.map(fileSlide));
});
const list = $('slideList');
list.addEventListener('dragover', (e) => { e.preventDefault(); if (item) list.classList.add('drop'); });
list.addEventListener('dragleave', () => list.classList.remove('drop'));
list.addEventListener('drop', (e) => {
  e.preventDefault();
  list.classList.remove('drop');
  if (item) insertSlides([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter((p) => p && FILE_KIND(p)).map(fileSlide));
});

// Вставить слайды после текущего и выделить их
function insertSlides(slides) {
  if (!item || !slides.length) return;
  item.slides.splice(slideIdx + 1, 0, ...slides);
  slideIdx += 1;
  multi = new Set(slides.map((_, i) => slideIdx + i));
  selEl = null;
  setDirty(true);
  renderSlides();
}

$('slAdd').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const at = { clientX: r.left, clientY: r.top - 190 };
  const pickFiles = async (kinds, title) => {
    const files = await window.api.pickFile({ kinds, title, multi: true });
    insertSlides(files.map((f) => ({ id: newId(), k: f.type, url: f.url, path: f.path, name: f.name })));
  };
  showMenu(at, [
    { label: 'Текст (песня, объявление)', fn: () => { insertSlides([{ id: newId(), k: 'text', label: '', text: '' }]); $('slText').focus(); } },
    { label: 'Свой слайд (текст и картинки где угодно)', fn: () => insertSlides([{ id: newId(), k: 'custom', elements: [] }]) },
    { label: 'Картинка или видео…', fn: () => pickFiles(['image', 'video'], 'Картинка или видео на слайд') },
    { label: 'Музыка…', fn: () => pickFiles(['audio'], 'Музыка на слайд') },
    '-',
    { label: 'Вставить из буфера', key: 'Ctrl+V', fn: edPaste },
  ]);
});
$('slDup').addEventListener('click', () => {
  const idx = [...multi].sort((a, b) => a - b);
  insertSlidesAfter(idx[idx.length - 1], Slides.copy(idx.map((i) => item.slides[i])));
});
function insertSlidesAfter(i, slides) { slideIdx = i; insertSlides(slides); }
const moveSlide = (d) => {
  const j = slideIdx + d;
  if (j < 0 || j >= item.slides.length) return;
  [item.slides[slideIdx], item.slides[j]] = [item.slides[j], item.slides[slideIdx]];
  slideIdx = j;
  setDirty(true);
  renderSlides();
};
$('slUp').addEventListener('click', () => moveSlide(-1));
$('slDown').addEventListener('click', () => moveSlide(1));
$('slDel').addEventListener('click', () => {
  const n = multi.size;
  if (item.slides.length <= n || !window.confirm(n > 1 ? `Удалить выделенные слайды (${n})?` : 'Удалить этот слайд?')) return;
  item.slides = item.slides.filter((_, i) => !multi.has(i));
  slideIdx = Math.min(Math.min(...multi), item.slides.length - 1);
  multi = new Set([slideIdx]);
  selEl = null;
  setDirty(true);
  renderSlides();
});

/* Выделение слайдов в списке: щелчок, Ctrl+щелчок, Shift+щелчок */

let multi = new Set([0]);
function pickSlide(i, e) {
  if (e.ctrlKey || e.metaKey) {
    if (multi.has(i) && multi.size > 1) multi.delete(i); else multi.add(i);
  } else if (e.shiftKey) {
    multi = new Set();
    for (let k = Math.min(i, slideIdx); k <= Math.max(i, slideIdx); k++) multi.add(k);
  } else multi = new Set([i]);
  slideIdx = i;
  selEl = null;
  renderSlides();
}

// Буфер обмена общий с окном оператора: можно копировать слайды туда и обратно
async function edCopy(cut) {
  const idx = [...multi].sort((a, b) => a - b);
  const slides = idx.map((i) => item.slides[i]).filter(Boolean);
  if (!slides.length) return;
  await window.api.clipSet({ slides: clone(slides), text: Slides.toText(slides) });
  if (cut && item.slides.length > slides.length) {
    item.slides = item.slides.filter((_, i) => !multi.has(i));
    slideIdx = Math.min(idx[0], item.slides.length - 1);
    multi = new Set([slideIdx]);
    setDirty(true);
    renderSlides();
  }
  note(`${cut ? 'Вырезано' : 'Скопировано'} слайдов: ${slides.length}`);
}

async function edPaste() {
  if (!item) return;
  const clip = await window.api.clipGet();
  const slides = clip.slides ? Slides.copy(clip.slides) : clip.text && clip.text.trim() ? Slides.parseText(clip.text) : [];
  if (!slides.length) { note('В буфере обмена нет слайдов или текста'); return; }
  insertSlides(slides);
}

let menuEl = null;
function showMenu(e, items) {
  if (menuEl) menuEl.remove();
  menuEl = Object.assign(document.createElement('div'), { className: 'ctx-menu' });
  for (const it of items) {
    if (it === '-') { menuEl.append(Object.assign(document.createElement('div'), { className: 'ctx-sep' })); continue; }
    const b = Object.assign(document.createElement('button'), { textContent: it.label });
    if (it.key) b.append(Object.assign(document.createElement('span'), { className: 'ctx-key', textContent: it.key }));
    b.addEventListener('click', () => { menuEl.remove(); menuEl = null; it.fn(); });
    menuEl.append(b);
  }
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - r.width - 6)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - r.height - 6)) + 'px';
}
window.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) { menuEl.remove(); menuEl = null; } }, true);

function saveItem() {
  if (!item) return;
  item.slides = item.slides.filter((s) => s.k !== 'text' || (s.text || '').trim() || s.label);
  if (!item.slides.length) item.slides.push({ id: newId(), k: 'text', label: '', text: ' ' });
  item.kind = Slides.presKind(item);
  window.api.editorSave({ kind: 'item', item: clone(item) });
  slideIdx = Math.min(slideIdx, item.slides.length - 1);
  multi = new Set([slideIdx]);
  savedNote(`«${item.name}» сохранено`);
  renderSlides();
}

/* ===== Темы — редактор тем в themeeditor.js ===== */

/* ===== Картинка ===== */

const imgCanvas = $('imgCanvas');
let work = null;        // холст с картинкой в полном размере
let imgHistory = [];
let imgName = 'картинка';
let imgTarget = null;
let imgTool = 'none';
let crop = null;        // { x, y, w, h } в пикселях картинки

function copyCanvas(src, w = src.width, h = src.height) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  return c;
}

function drawWork() {
  const has = !!work;
  $('imgEmpty').hidden = has;
  imgCanvas.hidden = !has;
  ['imUndo', 'imSaveAs', 'imRotL', 'imRotR', 'imFlipH', 'imFlipV', 'imFxApply', 'imFxReset', 'imResize'].forEach((id) => { $(id).disabled = !has; });
  $('imUndo').disabled = !imgHistory.length;
  if (!has) return;
  if (imgCanvas.width !== work.width || imgCanvas.height !== work.height) { imgCanvas.width = work.width; imgCanvas.height = work.height; }
  imgCanvas.getContext('2d').clearRect(0, 0, work.width, work.height);
  imgCanvas.getContext('2d').drawImage(work, 0, 0);
  $('imInfo').textContent = `${imgName} — ${work.width}×${work.height}`;
  if (document.activeElement !== $('imW')) $('imW').value = work.width;
  if (document.activeElement !== $('imH')) $('imH').value = work.height;
  drawCropBox();
}

function pushHistory() {
  imgHistory.push(copyCanvas(work));
  if (imgHistory.length > 25) imgHistory.shift();
  setDirty(true);
}

function loadImageData(dataUrl, name, target) {
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth || 1920;
    const h = img.naturalHeight || 1080;
    work = document.createElement('canvas');
    work.width = w; work.height = h;
    work.getContext('2d').drawImage(img, 0, 0, w, h);
    imgHistory = [];
    imgName = name || 'картинка';
    imgTarget = target || null;
    resetFx();
    setImgTool('none');
    drawWork();
  };
  img.onerror = () => { $('imInfo').textContent = 'Не удалось открыть картинку'; };
  img.src = dataUrl;
}

async function openImagePath(p, name, target) {
  const data = await window.api.loadImage(p);
  if (!data) { $('imInfo').textContent = 'Не удалось открыть картинку'; return; }
  loadImageData(data, name, target);
}

$('imOpen').addEventListener('click', async () => {
  if (dirty && view === 'image' && !window.confirm('Есть несохранённые изменения картинки. Открыть другую?')) return;
  const [f] = await window.api.pickFile({ kinds: ['image'], title: 'Открыть картинку' });
  if (f) openImagePath(f.path, f.name.replace(/\.[^.]+$/, ''), null);
});

function setImgTool(t) {
  imgTool = t;
  document.querySelectorAll('#imTools button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  $('imCropOpts').hidden = t !== 'crop';
  $('imBrushOpts').hidden = t !== 'brush';
  $('imTextOpts').hidden = t !== 'text';
  imgCanvas.style.cursor = t === 'none' ? 'default' : t === 'text' ? 'text' : 'crosshair';
  if (t !== 'crop') { crop = null; drawCropBox(); }
}
document.querySelectorAll('#imTools button').forEach((b) => b.addEventListener('click', () => setImgTool(b.dataset.tool)));

function imgPoint(e) {
  const r = imgCanvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * work.width, y: ((e.clientY - r.top) / r.height) * work.height, scale: work.width / r.width };
}

function drawCropBox() {
  const box = $('cropBox');
  if (!crop || !work) { box.hidden = true; return; }
  const r = imgCanvas.getBoundingClientRect();
  const hr = $('imgHost').getBoundingClientRect();
  const k = r.width / work.width;
  Object.assign(box.style, { left: r.left - hr.left + crop.x * k + 'px', top: r.top - hr.top + crop.y * k + 'px', width: crop.w * k + 'px', height: crop.h * k + 'px' });
  box.hidden = false;
}

let brushLast = null;
imgCanvas.addEventListener('pointerdown', (e) => {
  if (!work || imgTool === 'none') return;
  const p = imgPoint(e);
  if (imgTool === 'text') {
    const text = $('imTextValue').value;
    if (!text.trim()) { $('imTextValue').focus(); return; }
    pushHistory();
    const ctx = work.getContext('2d');
    const size = Number($('imTextSize').value) || 72;
    ctx.font = `${$('imTextBold').getAttribute('aria-pressed') === 'true' ? 700 : 400} ${size}px ${Scene.FONTS[$('imTextFont').value] || 'sans-serif'}`;
    ctx.fillStyle = $('imTextColor').value;
    ctx.textBaseline = 'top';
    if ($('imTextShadow').getAttribute('aria-pressed') === 'true') { ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = size * 0.15; ctx.shadowOffsetY = size * 0.05; }
    text.split('\n').forEach((line, i) => ctx.fillText(line, p.x, p.y + i * size * 1.2));
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    drawWork();
    return;
  }
  imgCanvas.setPointerCapture(e.pointerId);
  if (imgTool === 'crop') { crop = { x: p.x, y: p.y, w: 0, h: 0, sx: p.x, sy: p.y }; drawCropBox(); }
  if (imgTool === 'brush') {
    pushHistory();
    brushLast = p;
    const ctx = work.getContext('2d');
    ctx.fillStyle = $('imBrushColor').value;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Number($('imBrushSize').value) / 2, 0, Math.PI * 2);
    ctx.fill();
    drawWork();
  }
});
imgCanvas.addEventListener('pointermove', (e) => {
  if (!work || !(e.buttons & 1)) return;
  const p = imgPoint(e);
  if (imgTool === 'crop' && crop) {
    const x2 = Math.max(0, Math.min(work.width, p.x));
    const y2 = Math.max(0, Math.min(work.height, p.y));
    crop = { ...crop, x: Math.min(crop.sx, x2), y: Math.min(crop.sy, y2), w: Math.abs(x2 - crop.sx), h: Math.abs(y2 - crop.sy) };
    drawCropBox();
  }
  if (imgTool === 'brush' && brushLast) {
    const ctx = work.getContext('2d');
    ctx.strokeStyle = $('imBrushColor').value;
    ctx.lineWidth = Number($('imBrushSize').value);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(brushLast.x, brushLast.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    brushLast = p;
    drawWork();
  }
});
imgCanvas.addEventListener('pointerup', () => { brushLast = null; });

$('imCropApply').addEventListener('click', () => {
  if (!crop || crop.w < 2 || crop.h < 2) return;
  pushHistory();
  const c = document.createElement('canvas');
  c.width = Math.round(crop.w); c.height = Math.round(crop.h);
  c.getContext('2d').drawImage(work, -Math.round(crop.x), -Math.round(crop.y));
  work = c;
  crop = null;
  drawWork();
});
$('imCropCancel').addEventListener('click', () => { crop = null; drawCropBox(); });

function transform(rot, flipH, flipV) {
  pushHistory();
  const swap = rot % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = swap ? work.height : work.width;
  c.height = swap ? work.width : work.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(work, -work.width / 2, -work.height / 2);
  work = c;
  drawWork();
}
$('imRotL').addEventListener('click', () => transform(-90));
$('imRotR').addEventListener('click', () => transform(90));
$('imFlipH').addEventListener('click', () => transform(0, true, false));
$('imFlipV').addEventListener('click', () => transform(0, false, true));

// Коррекция: сначала просмотр (CSS-фильтр на холсте), «Применить» — в саму картинку
function fxString(forExport) {
  const v = (id) => Number($(id).value);
  const blurPx = forExport && work ? v('imBlur') * (work.width / imgCanvas.getBoundingClientRect().width || 1) : v('imBlur');
  return `brightness(${v('imBright')}%) contrast(${v('imContrast')}%) saturate(${v('imSat')}%) hue-rotate(${v('imHue')}deg) blur(${blurPx}px) sepia(${v('imSepia')}%)`;
}
function updateFx() {
  document.querySelectorAll('.imf').forEach((r) => { r.nextElementSibling.textContent = r.value; });
  imgCanvas.style.filter = fxString(false);
}
function resetFx() {
  for (const [id, v] of [['imBright', 100], ['imContrast', 100], ['imSat', 100], ['imHue', 0], ['imBlur', 0], ['imSepia', 0]]) $(id).value = v;
  updateFx();
}
document.querySelectorAll('.imf').forEach((r) => r.addEventListener('input', updateFx));
$('imFxReset').addEventListener('click', resetFx);
$('imFxApply').addEventListener('click', () => {
  if (!work) return;
  pushHistory();
  const c = document.createElement('canvas');
  c.width = work.width; c.height = work.height;
  const ctx = c.getContext('2d');
  ctx.filter = fxString(true);
  ctx.drawImage(work, 0, 0);
  work = c;
  resetFx();
  drawWork();
});

$('imW').addEventListener('input', () => { if ($('imKeep').checked && work) $('imH').value = Math.round((Number($('imW').value) * work.height) / work.width) || 1; });
$('imH').addEventListener('input', () => { if ($('imKeep').checked && work) $('imW').value = Math.round((Number($('imH').value) * work.width) / work.height) || 1; });
$('imResize').addEventListener('click', () => {
  const w = Math.max(1, Math.min(16384, Number($('imW').value) | 0));
  const h = Math.max(1, Math.min(16384, Number($('imH').value) | 0));
  if (!work || (w === work.width && h === work.height)) return;
  pushHistory();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(work, 0, 0, w, h);
  work = c;
  drawWork();
});

function imgUndo() {
  if (!imgHistory.length) return;
  work = imgHistory.pop();
  drawWork();
}
$('imUndo').addEventListener('click', imgUndo);
$('imBrushSize').addEventListener('input', () => { $('imBrushSizeVal').textContent = $('imBrushSize').value; });
['imTextBold', 'imTextShadow'].forEach((id) => $(id).addEventListener('click', () => $(id).setAttribute('aria-pressed', String($(id).getAttribute('aria-pressed') !== 'true'))));

async function saveImage(saveAs) {
  if (!work) return;
  const file = await window.api.saveImage({ dataUrl: work.toDataURL('image/png'), name: imgName, saveAs });
  if (!file) return;
  if (!saveAs) {
    window.api.editorSave({ kind: 'image', file: { ...file, name: imgName + '.png' }, target: imgTarget });
    // Картинка слайда из открытой здесь презентации — заменить и в ней, чтобы «Сохранить» слайдов её не вернул
    const s = imgTarget && item && imgTarget.itemId === item.id ? item.slides.find((x) => x.id === imgTarget.slideId) : null;
    if (s) { Object.assign(s, { url: file.url, path: file.path }); renderSlides(); }
    imgHistory = [];
    drawWork();
    note(imgTarget ? 'Картинка сохранена и заменена в слайде' : 'Картинка сохранена и добавлена в открытый плейлист');
  } else note('Копия сохранена: ' + file.name);
}
$('imSaveAs').addEventListener('click', () => saveImage(true));

/* ===== Сохранение, клавиши, загрузка ===== */

function save() {
  if (view === 'slides') saveItem();
  else if (view === 'image') saveImage(false);
}
$('save').addEventListener('click', save);

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); save(); return; }
  if (view === 'image' && e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); imgUndo(); return; }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
  // Слайды целиком: копировать, вырезать, вставить (когда не выбран блок на слайде)
  if (!typing && view === 'slides' && item && !curEl() && e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (e.code === 'KeyC') { e.preventDefault(); edCopy(false); return; }
    if (e.code === 'KeyX') { e.preventDefault(); edCopy(true); return; }
    if (e.code === 'KeyV') { e.preventDefault(); edPaste(); return; }
    if (e.code === 'KeyD') { e.preventDefault(); $('slDup').click(); return; }
  }
  if (typing || view !== 'slides' || !curEl()) return;
  const el = curEl();
  const step = e.shiftKey ? 2 : 0.5;
  if (e.key === 'Delete') { e.preventDefault(); delEl(); }
  else if (e.ctrlKey && e.code === 'KeyD') { e.preventDefault(); dupEl(); }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    if (e.key === 'ArrowLeft') el.x -= step;
    if (e.key === 'ArrowRight') el.x += step;
    if (e.key === 'ArrowUp') el.y -= step;
    if (e.key === 'ArrowDown') el.y += step;
    changed();
  }
});

// Окно закрывают с несохранёнными правками — спрашиваем
let closing = false;
window.addEventListener('beforeunload', (e) => {
  if (!dirty || closing) return;
  e.returnValue = false;
  setTimeout(() => {
    if (window.confirm('Есть несохранённые изменения. Закрыть редактор без сохранения?')) { closing = true; window.close(); }
  }, 0);
});

window.api.onEditorLoad((p) => {
  if (!p) return;
  if (dirty && p.mode !== 'themes' && !window.confirm('Есть несохранённые изменения. Открыть другое без сохранения?')) return;
  themes = p.themes || [];
  themeFor = p.themeFor || {};
  tplFor = p.tplFor || {};
  base = p.base || {};
  // Цвета программы из «Настройки → Оформление»
  const ui = p.ui || {};
  for (const v of ['--ink', '--panel', '--field', '--line', '--text', '--muted', '--live', '--brown', '--warn']) {
    if (ui[v]) document.documentElement.style.setProperty(v, ui[v]); else document.documentElement.style.removeProperty(v);
  }
  document.documentElement.style.setProperty('--live-ink', ui['--ink'] || '#051822');
  document.documentElement.style.colorScheme = ui.scheme || 'dark'; // светлая тема программы — светлые поля и прокрутка
  fillThemeSelects();
  if (p.mode === 'slides' && p.item) {
    item = p.item;
    slideIdx = Math.max(0, item.slides.findIndex((s) => s.id === p.sid));
    multi = new Set([slideIdx]);
    selEl = null;
    setDirty(false);
    document.title = `${item.name} — Редактор`;
  }
  if (p.mode === 'image' && p.image) openImagePath(p.image.path, p.image.name, p.target);
  setView(p.mode === 'image' ? 'image' : 'slides'); // темы правятся во вкладке «Темы» главного окна
  renderSlides();
});

window.api.onEditorThemes((t) => { themes = t || []; fillThemeSelects(); renderSlides(); });

setImgTool('none');
updateFx();
$('imBrushSizeVal').textContent = $('imBrushSize').value;
drawWork();
renderSlides();
setView('slides');
