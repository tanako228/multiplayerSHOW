/* ---------- Вкладка «Карты» (Ctrl+8): свои карты-картинки с точками, маршрутами и карточками для экрана ----------
   Модель и отрисовка на экране — mapview.js (MapView), данные — lib.maps (library.json, Ctrl+Z, репозиторий),
   файлы картинок — userData\maps (main.js: mapImport). Слева — библиотека карт, поиск, точки, маршруты, слои;
   по центру — карта (колёсико — масштаб, тянуть пустое место — сдвиг, точки тянутся мышью); справа — свойства и «Вывод на экран».
   Редактор и экран разделены: выбор, правка точки или маршрута экран не меняют. На экран — только «Отобразить на экране»
   (Enter) → present() в слой «Презентации», как любой слайд; та же карта с другой точкой или компоновкой меняется плавно,
   без перезагрузки (scene.js → MapView.update). Что на экране сейчас — layerOn (renderer.js), у содержимого есть tgt —
   какая карта, точка, маршрут и компоновка. Правки после показа — кнопка «Обновить на экране».
   В плейлист точка уходит слайдом { k: 'map', map, pt, route, layout } (slides.js) — содержимое собирает mapsSlideContent. */

const MP_LAY_SVG = {
  side: '<rect x="1" y="1" width="20" height="20" rx="2" fill="currentColor" opacity=".35"/><circle cx="11" cy="10" r="2.2" fill="currentColor"/><rect x="23" y="1" width="10" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M25 6h6M25 9h4M25 12h6" stroke="currentColor" stroke-width="1.2"/>',
  over: '<rect x="1" y="1" width="32" height="20" rx="2" fill="currentColor" opacity=".35"/><circle cx="10" cy="11" r="2.2" fill="currentColor"/><rect x="20" y="3.5" width="11" height="15" rx="2" fill="var(--panel)" stroke="currentColor" stroke-width="1.2"/><path d="M22.5 8h6M22.5 11h4" stroke="currentColor" stroke-width="1.2"/>',
  map: '<rect x="1" y="1" width="32" height="20" rx="2" fill="currentColor" opacity=".35"/><circle cx="9" cy="8" r="1.8" fill="currentColor"/><circle cx="21" cy="14" r="1.8" fill="currentColor"/><circle cx="26" cy="6" r="1.8" fill="currentColor"/><path d="M9 8l12 6 5-8" stroke="currentColor" stroke-width="1" fill="none"/>',
  card: '<rect x="1" y="1" width="32" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 6h12M5 10h18M5 13h14M5 16h16" stroke="currentColor" stroke-width="1.4"/><rect x="24" y="5" width="6" height="12" rx="1" fill="currentColor" opacity=".45"/>',
  focus: '<rect x="1" y="1" width="32" height="20" rx="2" fill="currentColor" opacity=".35"/><circle cx="11" cy="11" r="3" fill="currentColor"/><circle cx="11" cy="11" r="5.5" fill="none" stroke="currentColor" stroke-width="1"/><rect x="17" y="7" width="13" height="8" rx="1.5" fill="var(--panel)" stroke="currentColor" stroke-width="1.1"/><path d="M19 10h8M19 12.5h5" stroke="currentColor" stroke-width="1.1"/>',
};
const MP_LAY_SHORT = { side: 'Панель', over: 'Поверх', map: 'Карта', card: 'Карточка', focus: 'Подпись' };
const MP_COLORS = ['#f5a524', '#e5484d', '#2f80ed', '#12a594', '#8e4ec6', '#9a6b45', '#ff6aa8', '#ffffff'];
const MP_RT_COLORS = ['#e5484d', '#2f80ed', '#f5a524', '#12a594', '#8e4ec6', '#ff6aa8'];

let mpId = null;        // открытая карта
let mpSel = null;       // выбрано в редакторе: { kind: 'pt' | 'rt', id } или null (карта)
let mpTool = 'sel';     // sel — выбор и перемещение, pt — новая точка, rt — остановки маршрута
let mpLay = null;       // выбранная компоновка для показа (null — как у карты)
let mpCam = { cx: 0.5, cy: 0.5, z: 1 }; // вид редактора: центр (доли картинки) и приближение (1 — вся карта)
const mpCams = new Map(); // вид у каждой карты, пока программа открыта
let mpOpen = false;
let mpFindQ = '';
let mpImgSrc = '';
let mpNormed = null;    // lib.maps, которые уже приведены к модели (normMap)
let mpBack = null;      // { map, sel } — откуда ушли в Библию
const mpMk = new Map(); // id точки → маркер в редакторе (не пересоздаются при правке одной точки)
const mpCv = $('mpCanvas');
MapView.useCss(); // вид маркеров — тот же, что на экране

const mpMaps = () => { if (!Array.isArray(lib.maps)) lib.maps = []; return lib.maps; };
const mpMap = (id = mpId) => (lib && id ? mpMaps().find((m) => m.id === id) : null) || null;
const mpPt = (m, id) => (m && id ? m.points.find((p) => p.id === id) : null) || null;
const mpRt = (m, id) => (m && id ? m.routes.find((r) => r.id === id) : null) || null;
const mpSelPt = () => (mpSel && mpSel.kind === 'pt' ? mpPt(mpMap(), mpSel.id) : null);
const mpSelRt = () => (mpSel && mpSel.kind === 'rt' ? mpRt(mpMap(), mpSel.id) : null);
const mpEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const mpDot = (color, icon, cls = 'mp-dot') => { const d = mpEl('span', cls); d.style.setProperty('--c', color); d.innerHTML = MapView.glyph(icon); return d; };

// Все карты — в модели (старые и вернувшиеся по Ctrl+Z — тоже); один раз на каждый массив lib.maps
function mpNorm() {
  if (!lib) return;
  if (mpNormed === lib.maps && Array.isArray(lib.maps)) return;
  lib.maps = mpMaps().map(MapView.normMap);
  mpNormed = lib.maps;
}

let mpSyncT = 0;
function mpSave() {
  saveLib();
  clearTimeout(mpSyncT);
  mpSyncT = setTimeout(mpRenderOut, 250); // «Обновить на экране» — если показанное разошлось с правками
}

/* ----- Вкладка ----- */
function mpTabOpen() {
  mpOpen = true;
  if (!lib) { setTimeout(() => { if (mpOpen && tab === 'maps') mpTabOpen(); }, 200); return; } // программа открылась сразу на «Картах» — библиотека ещё грузится
  mpNorm();
  if (!mpMap()) mpId = (mpMaps()[0] || {}).id || null;
  if (mpBack) mpBackHide();
  mpRenderAll();
  mpStudioUi();
}
function mpTabClose() {
  mpOpen = false;
  if (mpTool !== 'sel') mpSetTool('sel');
  mpStudioUi(); // окно студии прячется, её карта выгружается
}
function mpAfterUndo() {
  mpNormed = null;
  if (!mpOpen) return;
  mpNorm();
  if (!mpMap()) { mpId = (mpMaps()[0] || {}).id || null; mpSel = null; }
  const m = mpMap();
  if (mpSel && !(mpSel.kind === 'pt' ? mpPt(m, mpSel.id) : mpRt(m, mpSel.id))) mpSel = null;
  mpRenderAll();
}

function mpRenderAll() {
  const m = mpMap();
  $('mpTitle').textContent = m ? m.name : '';
  $('mpEmpty').hidden = !!m;
  $('mpEmpty').textContent = mpMaps().length ? 'Выберите карту слева' : 'Добавьте карту: кнопка ＋ слева или перетащите сюда PNG или JPEG. Точки и маршруты ставятся поверх картинки и хранятся отдельно от неё.';
  for (const id of ['mpPtAdd', 'mpRtAdd', 'mpToolSel', 'mpToolPt', 'mpToolRt', 'mpZoomIn', 'mpZoomOut', 'mpFit']) $(id).disabled = !m;
  mpRenderMaps();
  mpRenderPts();
  mpRenderRts();
  mpRenderLayers();
  mpLoadImage();
  mpRenderMarks();
  mpRenderProps();
  mpRenderOut();
  mpToolUi();
  mpPaint();
}

function mpOpenMap(id) {
  if (mpId === id) return;
  if (mpId) mpCams.set(mpId, { ...mpCam });
  mpId = id;
  mpSel = null;
  mpCam = mpCams.get(id) || { cx: 0.5, cy: 0.5, z: 1 };
  if (mpTool === 'rt') mpTool = 'sel';
  for (const el of mpMk.values()) el.remove();
  mpMk.clear();
  mpRenderAll();
}

/* ----- Левая панель: карты и поиск ----- */
function mpRow(cls, onClick) {
  const r = mpEl('div', 'mp-row' + (cls ? ' ' + cls : ''));
  if (onClick) r.addEventListener('click', onClick);
  return r;
}
function mpPtText(p) { return [p.name, p.short, p.desc, p.history, p.dates, ...p.refs, ...p.events.map((e) => e.t + ' ' + e.ref)].join('\n').toLowerCase(); }

function mpRenderMaps() {
  const box = $('mpMaps');
  const q = mpFindQ.trim().toLowerCase();
  const air = mpAir();
  const frag = document.createDocumentFragment();
  const maps = mpMaps();
  const list = q ? maps.filter((m) => m.name.toLowerCase().includes(q)) : maps;
  if (q) frag.append(mpEl('div', 'mp-find-h', `Карты: ${list.length}`));
  for (const m of list) {
    const r = mpRow((m.id === mpId ? 'sel' : '') + (air && air.key === m.id ? ' live' : ''), () => mpOpenMap(m.id));
    const th = mpEl('img', 'mp-th');
    th.alt = '';
    th.loading = 'lazy';
    th.src = (m.t || m.p || m.img || {}).url || '';
    r.append(th, mpEl('span', 'nm', m.name), mpEl('span', 'sub', String(m.points.length)));
    r.title = `${m.name} · ${m.w}×${m.h} · точек: ${m.points.length}, маршрутов: ${m.routes.length}`;
    r.addEventListener('dblclick', () => mpRenameMap(m));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); mpMapMenu(e, m); });
    frag.append(r);
  }
  if (q) {
    // Точки на всех картах: название, описание, история, события, места Писания
    const hits = [];
    for (const m of maps) for (const p of m.points) if (mpPtText(p).includes(q)) hits.push([m, p]);
    frag.append(mpEl('div', 'mp-find-h', `Точки: ${hits.length}`));
    for (const [m, p] of hits.slice(0, 120)) {
      const r = mpRow(m.id === mpId && mpSel && mpSel.id === p.id ? 'sel' : '', () => { mpOpenMap(m.id); mpSelect({ kind: 'pt', id: p.id }, { center: true }); });
      r.append(mpDot(MapView.colorOf(p), MapView.iconOf(p)), mpEl('span', 'nm', p.name), mpEl('span', 'sub', m.name));
      frag.append(r);
    }
    if (hits.length > 120) frag.append(mpEl('div', 'mp-empty-l', `…и ещё ${hits.length - 120}`));
  } else if (!maps.length) frag.append(mpEl('div', 'mp-empty-l', 'Карт пока нет. ＋ — добавить PNG или JPEG.'));
  box.replaceChildren(frag);
}

/* ----- Точки, маршруты, слои ----- */
function mpRenderPts() {
  const m = mpMap();
  const box = $('mpPts');
  $('mpPtCount').textContent = m ? String(m.points.length) : '';
  if (!m) { box.replaceChildren(); return; }
  const q = mpFindQ.trim().toLowerCase();
  const air = mpAir();
  const liveId = air && air.key === m.id && air.point ? air.point.id : null;
  const frag = document.createDocumentFragment();
  for (const p of m.points) {
    if (q && !mpPtText(p).includes(q)) continue;
    const r = mpRow((mpSel && mpSel.kind === 'pt' && mpSel.id === p.id ? 'sel' : '') + (MapView.visible(m, p) ? '' : ' off') + (p.id === liveId ? ' live' : ''));
    r.dataset.id = p.id;
    r.append(mpDot(MapView.colorOf(p), MapView.iconOf(p)), mpEl('span', 'nm', p.name), mpEl('span', 'sub', MapView.TYPES[p.type].name));
    frag.append(r);
  }
  if (!m.points.length) frag.append(mpEl('div', 'mp-empty-l', 'Точек нет. Кнопка с булавкой (P) — и щёлкните по карте; или двойной щелчок по карте.'));
  box.replaceChildren(frag);
}
$('mpPts').addEventListener('click', (e) => { const r = e.target.closest('.mp-row'); if (r && r.dataset.id) mpSelect({ kind: 'pt', id: r.dataset.id }, { center: true }); });
$('mpPts').addEventListener('dblclick', (e) => { const r = e.target.closest('.mp-row'); if (r && r.dataset.id) mpZoomTo(mpPt(mpMap(), r.dataset.id), 2.5); });
$('mpPts').addEventListener('contextmenu', (e) => {
  const r = e.target.closest('.mp-row');
  if (!r || !r.dataset.id) return;
  e.preventDefault();
  mpSelect({ kind: 'pt', id: r.dataset.id });
  mpPtMenu(e, mpPt(mpMap(), r.dataset.id));
});

function mpRenderRts() {
  const m = mpMap();
  const box = $('mpRts');
  if (!m) { box.replaceChildren(); return; }
  const frag = document.createDocumentFragment();
  for (const r of m.routes) {
    const row = mpRow((mpSel && mpSel.kind === 'rt' && mpSel.id === r.id ? 'sel' : '') + (r.hidden ? ' off' : ''), () => mpSelect({ kind: 'rt', id: r.id }));
    const sw = mpEl('span', 'mp-sw');
    sw.style.setProperty('--c', r.color);
    const eye = Object.assign(mpEl('button', 'icon-only'), { title: r.hidden ? 'Показать маршрут на карте' : 'Скрыть маршрут с карты' });
    eye.append(Icons.el(r.hidden ? 'close' : 'eye'));
    eye.addEventListener('click', (e) => { e.stopPropagation(); r.hidden = !r.hidden; if (!r.hidden) delete r.hidden; mpSave(); mpRenderRts(); mpPaint(); });
    row.append(sw, mpEl('span', 'nm', r.name), mpEl('span', 'sub', String(r.stops.length)), eye);
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); mpSelect({ kind: 'rt', id: r.id }); mpRtMenu(e, r); });
    frag.append(row);
  }
  if (!m.routes.length) frag.append(mpEl('div', 'mp-empty-l', 'Маршрутов нет. ＋ — новый, потом щёлкайте по точкам по порядку.'));
  box.replaceChildren(frag);
}

function mpRenderLayers() {
  const m = mpMap();
  const box = $('mpLayers');
  if (!m) { box.replaceChildren(); return; }
  const cnt = {};
  for (const p of m.points) cnt[p.type] = (cnt[p.type] || 0) + 1;
  const frag = document.createDocumentFragment();
  const check = (text, on, fn, dot) => {
    const l = mpEl('label');
    const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on });
    i.addEventListener('change', () => { fn(i.checked); mpSave(); mpRenderMarks(); mpRenderPts(); mpPaint(); });
    l.append(i);
    if (dot) l.append(dot);
    l.append(text);
    frag.append(l);
  };
  for (const [k, t] of Object.entries(MapView.TYPES)) {
    if (!cnt[k]) continue;
    check(`${t.name} · ${cnt[k]}`, !m.layers.hide[k], (on) => { if (on) delete m.layers.hide[k]; else m.layers.hide[k] = true; }, mpDot(t.color, t.icon));
  }
  check('Подписи точек', m.layers.labels, (on) => { m.layers.labels = on; });
  check('Маршруты', m.layers.routes, (on) => { m.layers.routes = on; });
  box.replaceChildren(frag);
}

/* ----- Центр: картинка, маркеры, маршруты ----- */
function mpGeo() {
  const m = mpMap();
  const W = mpCv.clientWidth;
  const H = mpCv.clientHeight;
  if (!m || !W || !H) return null;
  const s = Math.min(W / m.w, H / m.h) * 0.94 * mpCam.z;
  return { m, W, H, s, tx: W / 2 - mpCam.cx * m.w * s, ty: H / 2 - mpCam.cy * m.h * s };
}
const mpToScr = (g, x, y) => [g.tx + x * g.m.w * g.s, g.ty + y * g.m.h * g.s];
const mpToImg = (g, px, py) => [(px - g.tx) / (g.m.w * g.s), (py - g.ty) / (g.m.h * g.s)];

// Сначала лёгкое превью (≤ 2048), при сильном приближении — большая копия, когда загрузится (выбор точки картинку не трогает)
function mpLoadImage(big) {
  const m = mpMap();
  const img = $('mpImg');
  if (!m) { img.removeAttribute('src'); mpImgSrc = ''; img.hidden = true; return; }
  img.hidden = false;
  const want = (big && m.b ? m.b : m.p || m.img).url;
  if (want === mpImgSrc) return;
  if (!mpImgSrc || !big) { mpImgSrc = want; img.src = want; return; }
  mpImgSrc = want;
  const im = new Image();
  im.src = want;
  (im.decode ? im.decode() : Promise.resolve()).then(() => { if (mpImgSrc === want) img.src = want; }, () => {});
}

const mpData = (p) => ({ id: p.id, name: p.name, color: MapView.colorOf(p), icon: MapView.iconOf(p) });
function mpMarkState(el, m, p) {
  el.hidden = !MapView.visible(m, p) && !(mpSel && mpSel.id === p.id);
  el.classList.toggle('sel', !!(mpSel && mpSel.kind === 'pt' && mpSel.id === p.id));
  const air = mpAir();
  el.classList.toggle('out', !!(air && air.key === m.id && air.point && air.point.id === p.id));
}
// Маркеры: новые — добавить, удалённые — убрать, остальные — только обновить
function mpRenderMarks() {
  const m = mpMap();
  const box = $('mpMarks');
  if (!m) { box.replaceChildren(); mpMk.clear(); return; }
  box.style.setProperty('--s', Math.round(24 * Math.min(2, Math.max(0.6, m.look.marker || 1))) + 'px');
  const seen = new Set();
  for (const p of m.points) {
    seen.add(p.id);
    let el = mpMk.get(p.id);
    if (!el) { el = MapView.pin(mpData(p), m.layers.labels); mpMk.set(p.id, el); box.append(el); }
    else MapView.pinSet(el, mpData(p), m.layers.labels);
    mpMarkState(el, m, p);
  }
  for (const [id, el] of mpMk) if (!seen.has(id)) { el.remove(); mpMk.delete(id); }
  mpBadges();
  mpPaint();
}
// Одна точка поменялась — только её маркер и строка в списке
function mpPtChanged(p) {
  const m = mpMap();
  const el = mpMk.get(p.id);
  if (el) { MapView.pinSet(el, mpData(p), m.layers.labels); mpMarkState(el, m, p); }
  const row = $('mpPts').querySelector(`.mp-row[data-id="${CSS.escape(p.id)}"]`);
  if (row) {
    row.querySelector('.nm').textContent = p.name;
    row.querySelector('.sub').textContent = MapView.TYPES[p.type].name;
    row.firstChild.replaceWith(mpDot(MapView.colorOf(p), MapView.iconOf(p)));
  }
  mpPaint();
}
// Номера остановок — у выбранного маршрута
function mpBadges() {
  const r = mpSelRt();
  const n = new Map();
  if (r) r.stops.forEach((id, i) => { if (!n.has(id)) n.set(id, [i + 1]); else n.get(id).push(i + 1); });
  for (const [id, el] of mpMk) {
    let b = el.querySelector(':scope > .mv-num');
    const v = n.get(id);
    if (v && !b) { b = mpEl('div', 'mv-num'); el.append(b); }
    if (!v && b) b.remove();
    if (v) { b.textContent = v.join(','); b.style.setProperty('--rc', r.color); }
    el.classList.toggle('ghost', !!r && mpTool === 'rt' && !v);
  }
}

let mpRaf = 0;
function mpPaint() { if (!mpRaf) mpRaf = requestAnimationFrame(mpPaintNow); }
function mpPaintNow() {
  mpRaf = 0;
  const g = mpGeo();
  const svg = $('mpRoutes');
  if (!g) { svg.replaceChildren(); return; }
  const is = $('mpImg').style;
  is.left = g.tx + 'px'; is.top = g.ty + 'px'; is.width = g.m.w * g.s + 'px'; is.height = g.m.h * g.s + 'px';
  for (const p of g.m.points) {
    const el = mpMk.get(p.id);
    if (!el || el.hidden) continue;
    const [x, y] = mpToScr(g, p.x, p.y);
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  }
  // Маршруты: линия, стрелки, невидимая широкая линия для щелчка
  const byId = new Map(g.m.points.map((p) => [p.id, p]));
  const sel = mpSelRt();
  const nodes = [];
  for (const r of g.m.routes) {
    if ((r.hidden || !g.m.layers.routes) && r !== sel) continue;
    const pts = r.stops.map((id) => byId.get(id)).filter(Boolean).map((p) => mpToScr(g, p.x, p.y));
    if (pts.length < 2) continue;
    const d = MapView.routePath(pts);
    const w = Math.max(1.5, r.width * 0.7);
    const on = r === sel;
    const mk = (attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'path'); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    if (on) nodes.push(mk({ d, fill: 'none', stroke: 'rgba(255,255,255,.85)', 'stroke-width': w + 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    nodes.push(mk({ d, fill: 'none', stroke: 'rgba(0,0,0,.35)', 'stroke-width': w + 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    nodes.push(mk({ d, fill: 'none', stroke: r.color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...(r.style === 'dash' ? { 'stroke-dasharray': `${w * 2.6} ${w * 2}` } : {}), opacity: sel && !on ? 0.55 : 1 }));
    if (r.arrows) nodes.push(mk({ d: MapView.arrowsPath(pts, Math.max(4, w * 1.4)), fill: r.color, opacity: sel && !on ? 0.55 : 1 }));
    const hit = mk({ d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(12, w + 8), class: 'rt-hit' });
    hit.dataset.id = r.id;
    nodes.push(hit);
  }
  svg.replaceChildren(...nodes);
  $('mpZoom').textContent = Math.round(g.s * 100) + '%';
  // Сильно приблизили — большая копия картинки
  const shown = Math.min(2048, Math.max(g.m.w, g.m.h));
  if (g.m.b && g.m.b.url !== (g.m.p || {}).url && Math.max(g.m.w, g.m.h) * g.s * (window.devicePixelRatio || 1) > shown * 1.2) mpLoadImage(true);
}
new ResizeObserver(() => { if (mpOpen) mpPaint(); }).observe(mpCv);

function mpZoomBy(f, px, py) {
  const g = mpGeo();
  if (!g) return;
  if (px == null) { px = g.W / 2; py = g.H / 2; }
  const [ix, iy] = mpToImg(g, px, py);
  const z = Math.min(24, Math.max(0.4, mpCam.z * f));
  const s = (g.s / mpCam.z) * z;
  mpCam = { z, cx: ix - (px - g.W / 2) / (g.m.w * s), cy: iy - (py - g.H / 2) / (g.m.h * s) };
  mpPaint();
}
function mpFit() { mpCam = { cx: 0.5, cy: 0.5, z: 1 }; mpPaint(); }
// Плавно подвести вид к точке (z — приближение; без него — то же, если точка и так видна)
let mpAnimRaf = 0;
function mpZoomTo(p, z) {
  if (!p) return;
  const g = mpGeo();
  if (!g) return;
  const [x, y] = mpToScr(g, p.x, p.y);
  if (!z && x > 40 && y > 40 && x < g.W - 40 && y < g.H - 40) return;
  const from = { ...mpCam };
  const to = { cx: p.x, cy: p.y, z: z ? Math.max(mpCam.z, z) : mpCam.z };
  const t0 = performance.now();
  cancelAnimationFrame(mpAnimRaf);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 320);
    const e = 1 - Math.pow(1 - t, 3);
    mpCam = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, z: from.z + (to.z - from.z) * e };
    mpPaintNow();
    if (t < 1) mpAnimRaf = requestAnimationFrame(step);
  };
  mpAnimRaf = requestAnimationFrame(step);
}

mpCv.addEventListener('wheel', (e) => {
  if (!mpMap()) return;
  e.preventDefault();
  const r = mpCv.getBoundingClientRect();
  mpZoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.004 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

mpCv.addEventListener('pointerdown', (e) => {
  const m = mpMap();
  if (!m || (e.button !== 0 && e.button !== 1)) return;
  mpCv.focus({ preventScroll: true });
  const r0 = mpCv.getBoundingClientRect();
  const px = e.clientX - r0.left;
  const py = e.clientY - r0.top;
  const g = mpGeo();
  const mk = e.button === 0 && e.target.closest('.mv-pt');
  if (mk) {
    const p = mpPt(m, mk.dataset.id);
    if (!p) return;
    if (mpTool === 'rt') { mpStopToggle(p.id, e.shiftKey); return; }
    mpSelect({ kind: 'pt', id: p.id });
    // Перетащить точку: координаты — доли картинки, сохраняются по отпусканию
    const [sx, sy] = mpToScr(g, p.x, p.y);
    const ox = px - sx;
    const oy = py - sy;
    let moved = false;
    mpCv.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const x = ev.clientX - r0.left - ox;
      const y = ev.clientY - r0.top - oy;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      moved = true;
      mk.classList.add('dragging');
      const [ix, iy] = mpToImg(mpGeo(), x, y);
      p.x = Math.min(1, Math.max(0, ix));
      p.y = Math.min(1, Math.max(0, iy));
      delete p.auto; // поставлена вручную — опора для расстановки по координатам
      mpPaint();
    };
    const up = () => {
      mpCv.removeEventListener('pointermove', move);
      mpCv.removeEventListener('pointerup', up);
      mpCv.removeEventListener('pointercancel', up);
      mk.classList.remove('dragging');
      if (moved) { mpSave(); mpRenderProps(); }
    };
    mpCv.addEventListener('pointermove', move);
    mpCv.addEventListener('pointerup', up);
    mpCv.addEventListener('pointercancel', up);
    return;
  }
  const hit = e.button === 0 && e.target.closest('.rt-hit');
  if (hit && mpTool !== 'pt') { mpSelect({ kind: 'rt', id: hit.dataset.id }); return; }
  if (e.button === 0 && mpTool === 'pt') {
    const [ix, iy] = mpToImg(g, px, py);
    if (ix >= 0 && iy >= 0 && ix <= 1 && iy <= 1) mpAddPoint(ix, iy);
    return;
  }
  // Сдвиг карты; щелчок без сдвига по пустому месту — снять выбор
  const cam0 = { ...mpCam };
  let moved = false;
  mpCv.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dx = ev.clientX - e.clientX;
    const dy = ev.clientY - e.clientY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    mpCv.classList.add('panning');
    mpCam = { ...cam0, cx: cam0.cx - dx / (g.m.w * g.s), cy: cam0.cy - dy / (g.m.h * g.s) };
    mpPaint();
  };
  const up = () => {
    mpCv.removeEventListener('pointermove', move);
    mpCv.removeEventListener('pointerup', up);
    mpCv.removeEventListener('pointercancel', up);
    mpCv.classList.remove('panning');
    if (!moved && e.button === 0 && mpTool === 'sel' && mpSel) mpSelect(null);
  };
  mpCv.addEventListener('pointermove', move);
  mpCv.addEventListener('pointerup', up);
  mpCv.addEventListener('pointercancel', up);
});
mpCv.addEventListener('dblclick', (e) => {
  const m = mpMap();
  if (!m || mpTool !== 'sel') return;
  const mk = e.target.closest('.mv-pt');
  if (mk) { mpZoomTo(mpPt(m, mk.dataset.id), 2.5); return; }
  if (e.target.closest('.rt-hit')) return;
  const r = mpCv.getBoundingClientRect();
  const [ix, iy] = mpToImg(mpGeo(), e.clientX - r.left, e.clientY - r.top);
  if (ix >= 0 && iy >= 0 && ix <= 1 && iy <= 1) mpAddPoint(ix, iy);
});
mpCv.addEventListener('contextmenu', (e) => {
  const m = mpMap();
  if (!m) return;
  e.preventDefault();
  const mk = e.target.closest('.mv-pt');
  if (mk) { mpSelect({ kind: 'pt', id: mk.dataset.id }); mpPtMenu(e, mpPt(m, mk.dataset.id)); return; }
  const hit = e.target.closest('.rt-hit');
  if (hit) { mpSelect({ kind: 'rt', id: hit.dataset.id }); mpRtMenu(e, mpRt(m, hit.dataset.id)); return; }
  const r = mpCv.getBoundingClientRect();
  const [ix, iy] = mpToImg(mpGeo(), e.clientX - r.left, e.clientY - r.top);
  const inside = ix >= 0 && iy >= 0 && ix <= 1 && iy <= 1;
  showMenu(e, [
    { label: 'Новая точка здесь', fn: () => mpAddPoint(ix, iy), disabled: !inside },
    { label: 'Вся карта', key: 'F', fn: mpFit },
    '-',
    { label: 'Показать всю карту на экране', fn: () => mpShow({ map: m.id, layout: 'map' }) },
  ]);
});

/* ----- Инструменты ----- */
function mpSetTool(t) {
  mpTool = t;
  if (t === 'rt' && !mpSelRt()) {
    const m = mpMap();
    if (m && m.routes.length) mpSelect({ kind: 'rt', id: m.routes[m.routes.length - 1].id });
    else if (m) { mpAddRoute(); return; }
  }
  mpToolUi();
  mpBadges();
}
function mpToolUi() {
  $('mpToolSel').classList.toggle('on', mpTool === 'sel');
  $('mpToolPt').classList.toggle('on', mpTool === 'pt');
  $('mpToolRt').classList.toggle('on', mpTool === 'rt');
  mpCv.classList.toggle('add-pt', mpTool === 'pt');
  mpCv.classList.toggle('add-rt', mpTool === 'rt');
  const hint = $('mpMode');
  const r = mpSelRt();
  hint.hidden = mpTool === 'sel' || !mpMap();
  const done = Object.assign(mpEl('button', '', 'Готово'), { title: 'Esc' });
  done.addEventListener('click', () => mpSetTool('sel'));
  if (mpTool === 'pt') hint.replaceChildren('Щёлкните по карте — там встанет новая точка', done);
  else if (mpTool === 'rt') hint.replaceChildren(`Маршрут «${r ? r.name : ''}»: щёлкайте по точкам по порядку · щелчок по остановке — убрать · Shift — та же точка ещё раз`, done);
}
$('mpToolSel').addEventListener('click', () => mpSetTool('sel'));
$('mpToolPt').addEventListener('click', () => mpSetTool(mpTool === 'pt' ? 'sel' : 'pt'));
$('mpToolRt').addEventListener('click', () => mpSetTool(mpTool === 'rt' ? 'sel' : 'rt'));
$('mpPtAdd').addEventListener('click', () => mpSetTool('pt'));
$('mpRtAdd').addEventListener('click', () => mpAddRoute());
$('mpZoomIn').addEventListener('click', () => mpZoomBy(1.4));
$('mpZoomOut').addEventListener('click', () => mpZoomBy(1 / 1.4));
$('mpFit').addEventListener('click', mpFit);

/* ----- Выбор ----- */
function mpSelect(sel, opts = {}) {
  const was = mpSel;
  mpSel = sel;
  const m = mpMap();
  // Маркеры: только прежний и новый
  for (const id of [was && was.id, sel && sel.id]) {
    const p = mpPt(m, id);
    const el = p && mpMk.get(id);
    if (el) mpMarkState(el, m, p);
  }
  if ((was && was.kind === 'rt') || (sel && sel.kind === 'rt')) { mpBadges(); mpRenderRts(); }
  if (mpTool === 'rt' && !(sel && sel.kind === 'rt')) mpTool = 'sel';
  mpToolUi();
  mpRenderPts();
  if (mpFindQ) mpRenderMaps();
  mpRenderProps();
  mpRenderOut();
  if (opts.center && sel && sel.kind === 'pt') mpZoomTo(mpPt(m, sel.id));
  mpPaint();
}

/* ----- Точки ----- */
function mpFreeName(list, base) {
  const names = new Set(list.map((x) => x.name));
  for (let i = list.length + 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
let mpLastType = 'city';
function mpAddPoint(x, y) {
  const m = mpMap();
  if (!m) return;
  const p = MapView.normPoint({ name: mpFreeName(m.points, 'Точка'), x, y, type: mpLastType });
  m.points.push(p);
  mpSave();
  mpRenderMarks();
  mpRenderLayers();
  mpSelect({ kind: 'pt', id: p.id });
  const n = $('mpProps').querySelector('input[data-f="name"]');
  if (n) { n.focus(); n.select(); }
}
function mpDupPoint(p) {
  const m = mpMap();
  if (!m || !p) return;
  const c = MapView.normPoint({ ...JSON.parse(JSON.stringify(p)), id: MapView.newId(), name: p.name + ' (копия)', x: Math.min(1, p.x + 0.02), y: Math.min(1, p.y + 0.02) });
  m.points.splice(m.points.indexOf(p) + 1, 0, c);
  mpSave();
  mpRenderMarks();
  mpRenderLayers();
  mpSelect({ kind: 'pt', id: c.id });
}
function mpDelPoint(p) {
  const m = mpMap();
  if (!m || !p) return;
  m.points = m.points.filter((x) => x !== p);
  for (const r of m.routes) r.stops = r.stops.filter((id) => id !== p.id);
  mpSave();
  mpSel = null;
  mpRenderMarks();
  mpRenderLayers();
  mpRenderRts();
  mpSelect(null);
  flashStatus(`Точка «${p.name}» удалена · Ctrl+Z — вернуть. Экран не меняется`);
}
function mpPtMenu(e, p) {
  if (!p) return;
  showMenu(e, [
    { label: 'Отобразить на экране', key: 'Enter', fn: () => mpShow({ map: mpId, pt: p.id, layout: mpLayNow() }) },
    { label: 'В плейлист', fn: () => mpToPlaylist({ map: mpId, pt: p.id, layout: mpLayNow() }) },
    '-',
    { label: 'Приблизить', fn: () => mpZoomTo(p, 2.5) },
    { label: 'Дублировать', key: 'Ctrl+D', fn: () => mpDupPoint(p) },
    { label: 'Удалить', key: 'Delete', fn: () => mpDelPoint(p) },
  ]);
}

/* ----- Маршруты ----- */
function mpAddRoute() {
  const m = mpMap();
  if (!m) return;
  const r = MapView.normRoute({ name: mpFreeName(m.routes, 'Маршрут'), color: MP_RT_COLORS[m.routes.length % MP_RT_COLORS.length] });
  m.routes.push(r);
  mpSave();
  mpSel = { kind: 'rt', id: r.id };
  mpTool = 'rt';
  mpRenderRts();
  mpSelect({ kind: 'rt', id: r.id });
  mpTool = 'rt';
  mpToolUi();
  mpBadges();
}
// Щелчок по точке в режиме маршрута: добавить остановку в конец; уже есть — убрать; Shift — добавить ещё раз
function mpStopToggle(id, again) {
  const r = mpSelRt();
  if (!r) return;
  const i = r.stops.lastIndexOf(id);
  if (i >= 0 && !again) r.stops.splice(i, 1);
  else r.stops.push(id);
  mpSave();
  mpBadges();
  mpRenderRts();
  mpRenderProps();
  mpPaint();
}
function mpDupRoute(r) {
  const m = mpMap();
  if (!m || !r) return;
  const c = MapView.normRoute({ ...JSON.parse(JSON.stringify(r)), id: MapView.newId(), name: r.name + ' (копия)' });
  m.routes.splice(m.routes.indexOf(r) + 1, 0, c);
  mpSave();
  mpSelect({ kind: 'rt', id: c.id });
}
function mpDelRoute(r) {
  const m = mpMap();
  if (!m || !r) return;
  m.routes = m.routes.filter((x) => x !== r);
  mpSave();
  mpSel = null;
  mpRenderRts();
  mpSelect(null);
  flashStatus(`Маршрут «${r.name}» удалён · Ctrl+Z — вернуть. Экран не меняется`);
}
function mpRtMenu(e, r) {
  if (!r) return;
  showMenu(e, [
    { label: 'Показать маршрут на экране', fn: () => mpShow({ map: mpId, route: r.id, layout: 'map' }) },
    { label: 'В плейлист', fn: () => mpToPlaylist({ map: mpId, route: r.id, layout: 'map' }) },
    '-',
    { label: 'Добавлять остановки', key: 'R', fn: () => { mpSelect({ kind: 'rt', id: r.id }); mpSetTool('rt'); } },
    { label: 'Дублировать', fn: () => mpDupRoute(r) },
    { label: 'Удалить', key: 'Delete', fn: () => mpDelRoute(r) },
  ]);
}

/* ----- Карты: добавить, заменить картинку, переименовать, удалить ----- */
function mpAddFiles(res) {
  if (!res) return;
  if (res.errors && res.errors.length) showNotice('Не добавлено: ' + res.errors.join('; '), true);
  if (!res.maps || !res.maps.length) return;
  mpNorm();
  let last = null;
  for (const f of res.maps) { last = MapView.newMap(f); mpMaps().push(last); }
  mpSave();
  mpOpenMap(last.id);
  mpRenderMaps();
  requestAnimationFrame(mpFit);
  flashStatus(res.maps.length > 1 ? `Добавлено карт: ${res.maps.length}` : `Карта «${last.name}» добавлена · двойной щелчок или P — точка`);
}
$('mpAdd').addEventListener('click', async () => {
  if (!window.api.mapsPick) return;
  showNotice('Карты: готовлю превью…', false, true);
  try { mpAddFiles(await window.api.mapsPick({})); } finally { showNotice(''); }
});
async function mpReplaceImage(m) {
  const res = await window.api.mapsPick({});
  const f = res && res.maps && res.maps[0];
  if (!f) { if (res && res.errors && res.errors.length) showNotice(res.errors.join('; '), true); return; }
  Object.assign(m, { w: f.w, h: f.h, img: f.img, p: f.p, b: f.b, t: f.t });
  mpImgSrc = '';
  mpSave();
  mpRenderAll();
  flashStatus('Картинка заменена — точки и маршруты остались на своих местах (они хранятся в долях картинки)');
}
async function mpRenameMap(m) {
  const n = await askName('Название карты', m.name);
  if (!n) return;
  m.name = n;
  mpSave();
  mpRenderAll();
}
function mpDupMap(m) {
  const c = MapView.normMap({ ...JSON.parse(JSON.stringify(m)), id: MapView.newId(), name: m.name + ' (копия)' });
  mpMaps().splice(mpMaps().indexOf(m) + 1, 0, c);
  mpSave();
  mpOpenMap(c.id);
}
async function mpDelMap(m) {
  if (!(await askYes(`Удалить карту «${m.name}»?\nТочки (${m.points.length}) и маршруты (${m.routes.length}) этой карты тоже удалятся. Ctrl+Z вернёт. Экран не меняется.`, 'Удалить', true))) return;
  lib.maps = mpMaps().filter((x) => x !== m);
  mpNormed = lib.maps;
  if (mpId === m.id) { mpId = (lib.maps[0] || {}).id || null; mpSel = null; mpCam = { cx: 0.5, cy: 0.5, z: 1 }; }
  mpSave();
  mpRenderAll();
}
function mpMapMenu(e, m) {
  showMenu(e, [
    { label: 'Показать всю карту на экране', fn: () => mpShow({ map: m.id, layout: 'map' }) },
    { label: 'В плейлист: все точки по порядку', fn: () => mpAllToPlaylist(m), disabled: !m.points.length },
    '-',
    { label: 'Переименовать…', fn: () => mpRenameMap(m) },
    { label: 'Заменить картинку…', fn: () => mpReplaceImage(m) },
    { label: 'Дублировать', fn: () => mpDupMap(m) },
    { label: 'Удалить карту…', fn: () => mpDelMap(m) },
  ]);
}
$('mpPropsMenu').addEventListener('click', (e) => {
  const m = mpMap();
  if (!m) return;
  const r = e.currentTarget.getBoundingClientRect();
  const at = { clientX: r.left, clientY: r.bottom + 2 };
  const p = mpSelPt();
  const rt = mpSelRt();
  if (p) mpPtMenu(at, p); else if (rt) mpRtMenu(at, rt); else mpMapMenu(at, m);
});

// Файлы, брошенные на вкладку
$('mapsView').addEventListener('dragover', (e) => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  mpCv.classList.add('drop');
});
$('mapsView').addEventListener('dragleave', (e) => { if (!e.relatedTarget || !$('mapsView').contains(e.relatedTarget)) mpCv.classList.remove('drop'); });
$('mapsView').addEventListener('drop', async (e) => {
  mpCv.classList.remove('drop');
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter((p) => /\.(png|jpe?g)$/i.test(p || ''));
  if (!paths.length) { showNotice('Для карт подходят PNG и JPEG', true); return; }
  showNotice('Карты: готовлю превью…', false, true);
  try { mpAddFiles(await window.api.mapsImport({ paths })); } finally { showNotice(''); }
});

/* ----- Поиск ----- */
$('mpFind').addEventListener('input', () => { mpFindQ = $('mpFind').value; mpRenderMaps(); mpRenderPts(); });
$('mpFind').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('mpFind').value) { e.stopPropagation(); $('mpFind').value = ''; mpFindQ = ''; mpRenderMaps(); mpRenderPts(); } });

/* ----- Правая панель: свойства ----- */
function mpField(label, input, hint) {
  const f = mpEl('label', 'mp-f');
  const s = mpEl('span', '', label);
  f.append(s, input);
  if (hint) f.append(mpEl('small', '', hint));
  return f;
}
function mpInput(val, onInput, opts = {}) {
  const i = document.createElement(opts.area ? 'textarea' : 'input');
  if (!opts.area) i.type = opts.type || 'text';
  if (opts.area) i.rows = opts.rows || 3;
  if (opts.f) i.dataset.f = opts.f;
  if (opts.ph) i.placeholder = opts.ph;
  for (const k of ['min', 'max', 'step']) if (opts[k] != null) i[k] = opts[k];
  i.value = val == null ? '' : val;
  i.addEventListener('input', () => onInput(i.value, i));
  return i;
}
function mpSelect2(options, val, onChange) {
  const s = document.createElement('select');
  for (const [v, t] of options) s.append(new Option(t, v, false, v === val));
  s.value = val;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function mpRange(label, val, min, max, step, fmt, onInput) {
  const i = mpInput(val, (v) => { em.textContent = fmt(+v); onInput(+v); }, { type: 'range', min, max, step });
  i.dataset.def = String(val);
  const f = mpField(label, i);
  const em = mpEl('em', '', fmt(+val));
  f.firstChild.append(em);
  return f;
}
const mpSec = (text, ...btns) => { const h = mpEl('div', 'mp-sec', text); h.append(mpEl('span', 'spacer'), ...btns); return h; };
const mpBtn = (text, title, fn, icon) => { const b = mpEl('button', icon && !text ? 'icon-only' : '', text); if (icon) b.prepend(Icons.el(icon)); b.title = title || ''; b.type = 'button'; b.addEventListener('click', fn); return b; };

function mpRenderProps() {
  const box = $('mpProps');
  const m = mpMap();
  $('mpPropsMenu').hidden = !m;
  if (!m) { $('mpPropsTitle').textContent = 'Свойства'; box.replaceChildren(mpEl('p', 'mc-tip', 'Карта — ваша картинка (PNG, JPEG): точки и маршруты ставятся поверх и хранятся отдельно от файла.')); return; }
  const p = mpSelPt();
  const r = mpSelRt();
  $('mpPropsTitle').textContent = p ? 'Точка' : r ? 'Маршрут' : 'Карта';
  box.replaceChildren(...(p ? mpPointProps(m, p) : r ? mpRouteProps(m, r) : mpMapProps(m)));
}

// «Нейросеть»: скопировать промпт (про точку или про все места карты) и вставить ответ
function mpAiRow(m, p) {
  const row = mpEl('div', 'mp-outrow mp-ai');
  const ask = mpBtn('Промпт для ИИ', p ? `Скопировать задание для нейросети (ChatGPT, Claude и др.) про «${p.name}» — вставьте его в чат` : `Скопировать задание: все места для карты «${m.name}» — вставьте в чат нейросети`, () => mpAiCopy(m, p, ask), 'copy');
  const put = mpBtn('Вставить ответ', 'Вставить ответ нейросети (JSON) — поля заполнятся сами', () => mpAiOpen(m, p), 'import');
  row.append(ask, put);
  return row;
}

function mpPointProps(m, p) {
  const out = [];
  const touch = () => { mpPtChanged(p); mpSave(); };
  out.push(mpField('Название', mpInput(p.name, (v) => { p.name = v.trim() || 'Точка'; touch(); }, { f: 'name' })));
  out.push(mpAiRow(m, p));
  out.push(mpField('Тип', mpSelect2(Object.entries(MapView.TYPES).map(([k, t]) => [k, t.name]), p.type, (v) => { p.type = v; mpLastType = v; touch(); mpRenderLayers(); mpRenderProps(); })));
  // Значок: первый — как у типа
  const icons = mpEl('div', 'mp-icons');
  const iconBtn = (name, title) => {
    const b = mpEl('button');
    b.type = 'button';
    b.title = title;
    b.classList.toggle('on', (p.icon || '') === name);
    b.append(mpDot(MapView.colorOf(p), name || MapView.TYPES[p.type].icon));
    b.addEventListener('click', () => { p.icon = name; touch(); mpRenderProps(); });
    icons.append(b);
  };
  iconBtn('', 'Как у типа');
  for (const [k, t] of Object.entries(MapView.ICON_NAMES)) iconBtn(k, t);
  out.push(mpField('Значок', icons));
  // Цвет: как у типа, готовые, свой
  const col = mpEl('div', 'mp-color');
  for (const c of ['', ...MP_COLORS]) {
    const b = mpEl('button', 'sw');
    b.type = 'button';
    b.title = c ? c : 'Как у типа';
    b.style.setProperty('--c', c || MapView.TYPES[p.type].color);
    if ((p.color || '') === c) b.style.borderColor = 'var(--live)';
    if (!c) b.textContent = '';
    b.addEventListener('click', () => { p.color = c; touch(); mpRenderProps(); });
    col.append(b);
  }
  if (typeof ColorPicker !== 'undefined') {
    const own = ColorPicker.field(p.color || MapView.TYPES[p.type].color, null, (hex) => { p.color = hex; touch(); });
    own.title = 'Свой цвет';
    col.append(own);
  }
  out.push(mpField('Цвет', col));
  out.push(mpField('Даты', mpInput(p.dates, (v) => { p.dates = v; mpSave(); }, { ph: 'например: ок. 1000 г. до Р. Х.' })));
  out.push(mpField('Кратко', mpInput(p.short, (v) => { p.short = v; mpSave(); }, { area: true, rows: 2, ph: 'одна-две строки — для подписи у точки' })));
  out.push(mpField('Описание', mpInput(p.desc, (v) => { p.desc = v; mpSave(); }, { area: true, rows: 4 })));
  out.push(mpField('История', mpInput(p.history, (v) => { p.history = v; mpSave(); }, { area: true, rows: 4 })));

  // Библейские события: текст и место Писания
  const evBox = mpEl('div', 'mp-items');
  const evPaint = () => {
    evBox.replaceChildren(...p.events.map((ev, i) => {
      const row = mpEl('div', 'mp-item');
      row.append(mpInput(ev.t, (v) => { ev.t = v; mpSave(); }, { ph: 'Событие' }));
      const ref = mpInput(ev.ref, (v) => { ev.ref = v.trim(); mpSave(); go.hidden = !ev.ref; }, { ph: 'Ин 2:1' });
      ref.className = 'ref';
      const go = mpBtn('', 'Открыть в «Библии»', () => mpOpenRef(ev.ref), 'bible');
      go.hidden = !ev.ref;
      row.append(ref, go, mpBtn('✕', 'Убрать событие', () => { p.events.splice(i, 1); mpSave(); evPaint(); }));
      return row;
    }));
  };
  evPaint();
  out.push(mpSec('Библейские события', mpBtn('＋', 'Добавить событие', () => { p.events.push({ t: '', ref: '' }); mpSave(); evPaint(); const i = evBox.querySelector('.mp-item:last-child input'); if (i) i.focus(); })));
  out.push(evBox);

  // Места Писания: щелчок — открыть в «Библии»
  const refs = mpEl('div', 'mp-chips');
  const refsPaint = () => {
    refs.replaceChildren(...p.refs.map((x, i) => {
      const c = mpEl('span', 'mp-chip');
      const go = mpBtn(x, 'Открыть в «Библии»: книга, глава и стих. Вернуться к карте — кнопкой внизу', () => mpOpenRef(x));
      go.className = 'go';
      const del = mpBtn('✕', 'Убрать', () => { p.refs.splice(i, 1); mpSave(); refsPaint(); });
      del.className = 'x';
      c.append(go, del);
      return c;
    }));
  };
  refsPaint();
  const add = mpEl('div', 'mp-item');
  const inp = mpInput('', () => {}, { ph: 'Ин 4:5; Быт 12:6' });
  const addRefs = (text) => {
    const list = String(text || '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
    const bad = list.filter((s) => !Bible.parseRef(s));
    const ok = list.filter((s) => Bible.parseRef(s) && !p.refs.includes(s));
    if (bad.length) showNotice('Не удалось понять: ' + bad.join('; ') + ' — пример: Ин 3:16 или 1 Кор 13:4-7', true);
    if (!ok.length) return false;
    p.refs.push(...ok);
    mpSave();
    refsPaint();
    return true;
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (addRefs(inp.value)) inp.value = ''; } });
  add.append(inp, mpBtn('＋', 'Добавить место (Enter)', () => { if (addRefs(inp.value)) inp.value = ''; }));
  add.append(mpBtn('', 'Взять место из поля «Место» во вкладке «Библия»', () => {
    const v = $('refInput').value.trim();
    if (!v) { showNotice('В «Библии» поле «Место» пустое', true); return; }
    addRefs(v);
  }, 'bible'));
  out.push(mpSec('Места Писания'), refs, add);

  // Картинки к точке — на карточке экрана
  const pics = mpEl('div', 'mp-pics');
  for (const [i, im] of p.images.entries()) {
    const d = mpEl('div', 'pic');
    d.style.backgroundImage = `url("${String(im.t || im.url).replace(/"/g, '%22')}")`;
    d.append(mpBtn('✕', 'Убрать картинку', () => { p.images.splice(i, 1); mpSave(); mpRenderProps(); }));
    pics.append(d);
  }
  out.push(mpSec('Картинки', mpBtn('＋', 'Добавить картинки (PNG, JPEG) — первая крупно на карточке', async () => {
    const res = await window.api.mapsPick({ small: true });
    if (!res) return;
    if (res.errors && res.errors.length) showNotice(res.errors.join('; '), true);
    for (const f of res.maps || []) p.images.push({ path: f.p.path, url: f.p.url, t: f.t.url });
    mpSave();
    mpRenderProps();
  })));
  if (p.images.length) out.push(pics);

  // Где стоит: доли картинки
  const two = mpEl('div', 'mp-two');
  const xy = (k) => mpInput((p[k] * 100).toFixed(2), (v) => { const n = Math.min(100, Math.max(0, +v)); if (!Number.isFinite(n)) return; p[k] = n / 100; delete p.auto; mpPtChanged(p); mpSave(); }, { type: 'number', min: 0, max: 100, step: 0.1 });
  two.append(mpField('X, %', xy('x')), mpField('Y, %', xy('y')));
  out.push(mpSec('Положение'), two, mpEl('small', 'mc-tip', 'Положение хранится в долях картинки — не в пикселях: при замене картинки или другом экране точка остаётся на месте.'));

  // Координаты (широта, долгота) — для расстановки мест по карте; на экран не идут
  const geo = mpEl('div', 'mp-two');
  const gv = (k) => (p.geo ? String(p.geo[k]) : '');
  const gset = (k, v) => {
    const n = parseFloat(String(v).replace(',', '.'));
    const g = { lat: p.geo ? p.geo.lat : NaN, lon: p.geo ? p.geo.lon : NaN };
    g[k] = Number.isFinite(n) ? n : NaN;
    if (Number.isFinite(g.lat) && Number.isFinite(g.lon)) p.geo = { lat: Math.max(-90, Math.min(90, g.lat)), lon: Math.max(-180, Math.min(180, g.lon)) };
    else if (!String(v).trim() && p.geo) delete p.geo;
    else if (Number.isFinite(g[k])) p.geo = { lat: g.lat, lon: g.lon }; // вторая половина ещё не введена
    mpSave();
  };
  geo.append(mpField('Широта', mpInput(gv('lat'), (v) => gset('lat', v), { ph: '31.7767' })), mpField('Долгота', mpInput(gv('lon'), (v) => gset('lon', v), { ph: '35.2345' })));
  out.push(mpSec('Координаты'), geo, mpEl('small', 'mc-tip', p.auto ? 'Точка поставлена сама (по ответу нейросети) — передвиньте её на место, если нужно.' : 'Широта и долгота места (десятичные градусы). Две-три такие точки на своих местах — и остальные места из нейросети встанут по координатам сами.'));

  // Источники сведений — для проверки; на экран не идут
  out.push(mpSec('Источники'), mpField('', mpInput(p.sources.join('\n'), (v) => { p.sources = v.split(/\n+/).map((x) => x.trim()).filter(Boolean); mpSave(); }, { area: true, rows: 3, ph: 'Издание — статья; по одному на строку' })));
  return out;
}

function mpRouteProps(m, r) {
  const out = [];
  const touch = () => { mpSave(); mpRenderRts(); mpBadges(); mpPaint(); };
  out.push(mpField('Название', mpInput(r.name, (v) => { r.name = v.trim() || 'Маршрут'; touch(); mpToolUi(); }, { f: 'name' })));
  const col = mpEl('div', 'mp-color');
  for (const c of MP_RT_COLORS) {
    const b = mpEl('button', 'sw');
    b.type = 'button';
    b.style.setProperty('--c', c);
    if (r.color === c) b.style.borderColor = 'var(--live)';
    b.addEventListener('click', () => { r.color = c; touch(); mpRenderProps(); });
    col.append(b);
  }
  if (typeof ColorPicker !== 'undefined') col.append(ColorPicker.field(r.color, null, (hex) => { r.color = hex; touch(); }));
  out.push(mpField('Цвет линии', col));
  out.push(mpRange('Толщина', r.width, 1, 20, 0.5, (v) => v + ' px', (v) => { r.width = v; touch(); }));
  out.push(mpField('Линия', mpSelect2([['solid', 'Сплошная'], ['dash', 'Пунктир']], r.style, (v) => { r.style = v; touch(); })));
  const chk = (text, k) => {
    const l = mpEl('label', 'mp-check');
    const i = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!r[k] });
    i.addEventListener('change', () => { r[k] = i.checked; touch(); });
    l.append(i, text);
    return l;
  };
  out.push(chk('Стрелки направления', 'arrows'), chk('Номера остановок', 'numbers'));
  out.push(mpRange('Появление на экране', r.ms, 0, 8000, 100, (v) => (v ? (v / 1000).toFixed(1) + ' с' : 'сразу'), (v) => { r.ms = v; mpSave(); }));

  // Остановки: порядок — перетаскиванием
  const stops = mpEl('div', 'mp-stops');
  r.stops.forEach((id, i) => {
    const p = mpPt(m, id);
    const row = mpEl('div', 'mp-stop');
    row.draggable = true;
    row.dataset.i = String(i);
    const n = mpEl('b', '', String(i + 1));
    n.style.setProperty('--c', r.color);
    row.append(n, mpEl('span', '', p ? p.name : '?'));
    row.append(mpBtn('✕', 'Убрать остановку', () => { r.stops.splice(i, 1); touch(); mpRenderProps(); }));
    row.addEventListener('click', (e) => { if (p && !e.target.closest('button')) mpZoomTo(p); });
    stops.append(row);
  });
  let dragI = -1;
  stops.addEventListener('dragstart', (e) => { const row = e.target.closest('.mp-stop'); dragI = row ? +row.dataset.i : -1; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'stop'); });
  stops.addEventListener('dragover', (e) => {
    if (dragI < 0) return;
    e.preventDefault();
    stops.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
    const row = e.target.closest('.mp-stop');
    if (row) row.classList.add('drop-before');
  });
  stops.addEventListener('drop', (e) => {
    if (dragI < 0) return;
    e.preventDefault();
    const row = e.target.closest('.mp-stop');
    let to = row ? +row.dataset.i : r.stops.length;
    const [x] = r.stops.splice(dragI, 1);
    if (to > dragI) to -= 1;
    r.stops.splice(to, 0, x);
    dragI = -1;
    touch();
    mpRenderProps();
  });
  stops.addEventListener('dragend', () => { dragI = -1; stops.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before')); });
  const addB = mpBtn(mpTool === 'rt' ? 'Готово' : 'Добавлять', mpTool === 'rt' ? 'Закончить (Esc)' : 'Щёлкайте по точкам на карте по порядку (R)', () => mpSetTool(mpTool === 'rt' ? 'sel' : 'rt'));
  out.push(mpSec(`Остановки · ${r.stops.length}`, addB));
  out.push(r.stops.length ? stops : mpEl('small', 'mc-tip', 'Нажмите «Добавлять» и щёлкайте по точкам на карте по порядку. Порядок меняется перетаскиванием.'));
  return out;
}

function mpMapProps(m) {
  const out = [];
  const L = m.look;
  const touch = () => mpSave();
  out.push(mpField('Название', mpInput(m.name, (v) => { m.name = v.trim() || 'Карта'; $('mpTitle').textContent = m.name; mpSave(); mpRenderMaps(); }, { f: 'name' })));
  const info = mpEl('div', 'mp-item');
  info.append(mpEl('small', 'mc-tip', `${m.w} × ${m.h} px · точек: ${m.points.length} · маршрутов: ${m.routes.length}`));
  out.push(info, mpBtn('Заменить картинку…', 'Новая картинка той же карты: точки и маршруты останутся на своих местах', () => mpReplaceImage(m), 'image'));
  out.push(mpSec('Нейросеть'), mpAiRow(m, null));
  const autos = m.points.filter((p) => p.auto && p.geo).length;
  if (autos) {
    const b = mpBtn(`Расставить по координатам (${autos})`, 'Точки, поставленные нейросетью, — по широте и долготе. Опора — точки с координатами, которые вы поставили вручную (хотя бы две)', () => mpAiPlace(m), 'pin');
    b.disabled = !MapsAI.calib(m.points);
    out.push(b);
    if (b.disabled) out.push(mpEl('small', 'mc-tip', 'Чтобы расставить, поставьте на свои места хотя бы две точки с координатами.'));
  }
  out.push(mpSec('Вид на экране'));
  out.push(mpField('Компоновка по умолчанию', mpSelect2(MapView.LAYOUTS, L.layout, (v) => { L.layout = v; touch(); mpRenderOut(); })));
  out.push(mpField('Оформление панели', mpSelect2(MapView.THEMES, L.theme, (v) => { L.theme = v; touch(); })));
  const fonts = [['', 'Как у программы (Segoe UI)'], ...Object.entries(Scene.FONT_NAMES).filter(([k]) => k !== 'segoe')];
  out.push(mpField('Шрифт', mpSelect2(fonts, L.font || '', (v) => { L.font = v; touch(); })));
  out.push(mpRange('Ширина панели', L.panel, 20, 60, 1, (v) => v + ' %', (v) => { L.panel = v; touch(); }));
  out.push(mpRange('Длительность анимации', L.ms, 0, 3000, 50, (v) => (v ? (v / 1000).toFixed(2) + ' с' : 'сразу'), (v) => { L.ms = v; touch(); }));
  out.push(mpField('Плавность', mpSelect2(MapView.EASE_NAMES, L.ease, (v) => { L.ease = v; touch(); })));
  out.push(mpRange('Приближение к точке', L.pz, 1, 5, 0.1, (v) => '×' + v.toFixed(1), (v) => { L.pz = v; touch(); }));
  out.push(mpRange('Приближение «Точка с подписью»', L.zoom, 1, 8, 0.1, (v) => '×' + v.toFixed(1), (v) => { L.zoom = v; touch(); }));
  out.push(mpRange('Размер точек', L.marker, 0.4, 2.5, 0.05, (v) => Math.round(v * 100) + ' %', (v) => { L.marker = v; touch(); mpRenderMarks(); }));
  out.push(mpRange('Размер подписей', L.label, 0.4, 2.5, 0.05, (v) => Math.round(v * 100) + ' %', (v) => { L.label = v; touch(); }));
  if (typeof ColorPicker !== 'undefined') out.push(mpField('Фон вокруг карты', ColorPicker.field(L.bg || '#000000', null, (hex) => { L.bg = hex; touch(); })));
  out.push(mpEl('small', 'mc-tip', 'Настройки вида меняют экран только при следующем показе («Отобразить» или «Обновить на экране»). В «Студии» (S) они видны сразу.'));
  return out;
}

/* ----- Вывод на экран (Output State) ----- */
// Что из карт сейчас на экране: содержимое слоя (у него tgt — карта, точка, маршрут, компоновка)
function mpAirEntry() {
  if (typeof layerOn === 'undefined') return null;
  for (const [id, x] of Object.entries(layerOn)) if (x && x.content && x.content.type === 'map') return { id, c: x.content };
  return null;
}
const mpAir = () => { const e = mpAirEntry(); return e ? e.c : null; };
const mpLayNow = () => mpLay || (mpMap() || {}).look?.layout || 'side';

function mpContentFor(t) {
  const m = t && mpMap(t.map);
  if (!m) return null;
  const o = { point: t.pt || null, layout: t.layout, family: m.look.font ? Scene.family(m.look.font) : '' };
  const r = t.route && mpRt(m, t.route);
  if (r) {
    o.routes = [r.id];
    const pts = r.stops.map((id) => mpPt(m, id)).filter(Boolean);
    o.fit = MapView.bounds(pts);
  }
  const c = MapView.content(m, o);
  c.tgt = { map: m.id, pt: t.pt || null, route: t.route || null, layout: c.layout };
  return c;
}
// Что хочет показать редактор: выбранная точка, выбранный маршрут или вся карта
function mpTarget() {
  const m = mpMap();
  if (!m) return null;
  const p = mpSelPt();
  const r = mpSelRt();
  if (p) return { map: m.id, pt: p.id, layout: mpLayNow() };
  if (r) return { map: m.id, route: r.id, layout: 'map' };
  return { map: m.id, layout: 'map' };
}
function mpLabel(c) {
  const m = mpMap(c.tgt.map);
  const r = c.tgt.route && mpRt(m, c.tgt.route);
  return 'Карта: ' + (m ? m.name : '') + (c.point ? ' — ' + c.point.name : r ? ' — ' + r.name : '');
}
function mpShow(t = mpTarget()) {
  const c = mpContentFor(t);
  if (!c) return;
  const id = autoLayer(c);
  // Карта сменяет слайд в слое: подсветку «на экране» в списках, которую ставил этот слой, снимаем
  const was = layerOn[id];
  const mk = (was && was.marks) || {};
  if (mk.plShown && plShown === mk.plShown) plShown = null;
  if (mk.bShown && bShown === mk.bShown) bShown = null;
  if (mk.live >= 0 && live === mk.live) live = -1;
  present(() => c, mpLabel(c), false, id); // снимок: правки после показа экран не трогают
  queueMicrotask(() => { if (layerOn[id] && layerOn[id].content === c) layerOn[id].marks = {}; });
  if (typeof updatePlaylistLive === 'function') updatePlaylistLive();
}
function mpUnshow() { const e = mpAirEntry(); if (e) clearLayer(e.id); }

// Слайд карты из плейлиста (slides.js)
function mapsSlideContent(slide) {
  if (!lib || !slide || !slide.map) return null;
  mpNorm();
  return mpContentFor({ map: slide.map, pt: slide.pt, route: slide.route, layout: slide.layout });
}
function mpSlideOf(t) {
  const m = mpMap(t.map);
  const p = mpPt(m, t.pt);
  const r = mpRt(m, t.route);
  const label = p ? p.name : r ? r.name : m.name;
  return { id: newId(), k: 'map', map: m.id, pt: t.pt || undefined, route: t.route || undefined, layout: t.layout, name: m.name + (label !== m.name ? ' — ' + label : ''), label };
}
function mpToPlaylist(t = mpTarget()) {
  if (!t) return;
  const s = mpSlideOf(t);
  addItems([{ id: newId(), type: 'pres', kind: 'map', name: s.name, slides: [s] }], true, 'pool');
  flashStatus(`«${s.name}» — в плейлисте`);
}
function mpAllToPlaylist(m) {
  const lay = mpLay || m.look.layout;
  const slides = [mpSlideOf({ map: m.id, layout: 'map' }), ...m.points.filter((p) => MapView.visible(m, p)).map((p) => mpSlideOf({ map: m.id, pt: p.id, layout: lay }))];
  addItems([{ id: newId(), type: 'pres', kind: 'map', name: m.name, slides }], true, 'pool');
  flashStatus(`Карта «${m.name}»: ${slides.length} слайдов — в плейлисте`);
}

function mpRenderOut() {
  if (!mpOpen) return;
  const m = mpMap();
  const air = mpAir();
  const mine = !!(air && m && air.key === m.id);
  const lay = mpLayNow();
  const pt = mpSelPt();
  for (const box of [$('mpLays'), $('mpStLays')]) {
    if (!box.children.length) {
      for (const [k] of MapView.LAYOUTS) {
        const b = mpEl('button');
        b.type = 'button';
        b.dataset.k = k;
        b.innerHTML = `<svg viewBox="0 0 34 22">${MP_LAY_SVG[k]}</svg>`;
        b.append(mpEl('span', '', MP_LAY_SHORT[k]));
        b.addEventListener('click', () => mpLayPick(k));
        box.append(b);
      }
    }
    for (const b of box.children) {
      const k = b.dataset.k;
      b.classList.toggle('on', k === lay);
      b.classList.toggle('live', mine && air.layout === k);
      b.disabled = !m;
      const name = MapView.LAYOUTS.find(([x]) => x === k)[1];
      b.title = name + (mpStudioOn ? ' — в студии; на экран — «Вывести на экран»' : mine && air.point ? ' — эта карта на экране: компоновка сменится сразу, плавно' : '') + (!pt && !mine && k !== 'map' ? ' (нужна выбранная точка)' : '');
    }
  }
  $('mpShow').disabled = !m;
  const r = mpSelRt();
  const showText = pt ? 'Отобразить на экране' : r ? 'Показать маршрут' : 'Показать карту';
  if ($('mpShow').textContent !== showText) Icons.label($('mpShow'), showText);
  $('mpToPl').disabled = !m;
  $('mpClear').disabled = !air;
  $('mpLive').textContent = air ? '● ' + mpLabel(air).replace(/^Карта: /, '') : '';
  $('mpLive').title = air ? 'Сейчас на экране' : '';
  // Показанное разошлось с правками — «Обновить на экране»
  let stale = false;
  if (air && air.tgt) { const now = mpContentFor(air.tgt); stale = !now || JSON.stringify(now) !== JSON.stringify(air); }
  $('mpUpd').hidden = !stale;
  $('mpStudioBtn').classList.toggle('on', mpStudioOn);
  mpStudioSync();
}
function mpLayPick(k) {
  mpLay = k;
  const air = mpAir();
  const m = mpMap();
  // Эта карта с точкой на экране — новая компоновка сразу (явное действие с выводом), для показанной точки.
  // В студии — только в окне студии: пробуем, на экран — кнопкой «Вывести на экран»
  if (!mpStudioOn && air && m && air.key === m.id && air.tgt && air.tgt.pt && air.layout !== k) mpShow({ ...air.tgt, layout: k });
  mpRenderOut();
}
// Что-то показали или убрали (renderer.js: layersChanged)
function mpLiveChanged() {
  if (!mpOpen || !lib) return;
  mpRenderOut();
  const m = mpMap();
  if (!m) return;
  for (const p of m.points) { const el = mpMk.get(p.id); if (el) el.classList.toggle('out', false); }
  const air = mpAir();
  if (air && air.key === m.id && air.point) { const el = mpMk.get(air.point.id); if (el) el.classList.add('out'); }
  mpRenderPts();
  mpRenderMaps();
}
$('mpShow').addEventListener('click', () => mpShow());
$('mpClear').addEventListener('click', mpUnshow);
$('mpUpd').addEventListener('click', () => { const air = mpAir(); if (air && air.tgt) mpShow(air.tgt); });
$('mpToPl').addEventListener('click', () => mpToPlaylist());
$('mpStudioBtn').addEventListener('click', () => mpStudio(!mpStudioOn));

/* ----- Студия (как в OBS): своё окно предпросмотра — попробовать компоновку и анимацию, экран зала не меняется.
   Показывает то же, что ушло бы на экран (mpTarget → mpContentFor), и следует за выбором, компоновкой и правками с анимацией
   (MapView.update). «Повторить» (T) — проиграть переход ещё раз, «Вывести на экран» — mpShow того же. Окно .ui-pop, двигается
   за шапку, ширина тянется за край (resize), место и ширина — settings.mpStudio; включена ли — settings.mpStudioOn ----- */
let mpStudioOn = !!(typeof settings !== 'undefined' && settings.mpStudioOn);
let mpStL = null;     // слой MapView в окне студии
let mpStPrev = null;  // что было в студии до последней смены — откуда «Повторить»
function mpStudio(on) {
  mpStudioOn = !!on;
  settings.mpStudioOn = mpStudioOn;
  saveSettings();
  mpStudioUi();
  mpRenderOut();
}
function mpStudioDrop() {
  if (!mpStL) return;
  if (mpStL._mvStop) mpStL._mvStop();
  mpStL.remove();
  mpStL = null;
}
function mpStudioUi() {
  const box = $('mpStudio');
  const show = mpStudioOn && mpOpen;
  box.hidden = !show;
  if (!show) { mpStudioDrop(); mpStPrev = null; return; }
  mpStudioPlace();
  mpStudioFit();
}
// Сцена студии — экран зала в настоящем размере (outputSize), уменьшенный под ширину окна: вид как на экране один в один
function mpStudioFit() {
  const wrap = $('mpStWrap');
  const st = $('mpStStage');
  const { W, H } = outputSize();
  wrap.style.aspectRatio = W + ' / ' + H;
  st.style.width = W + 'px';
  st.style.height = H + 'px';
  st.style.transform = 'scale(' + (wrap.clientWidth / W || 0) + ')';
}
let mpStSaveT = 0;
new ResizeObserver(() => {
  if ($('mpStudio').hidden) return;
  mpStudioFit();
  clearTimeout(mpStSaveT);
  mpStSaveT = setTimeout(() => { const b = $('mpStudio'); if (!b.hidden) { settings.mpStudio = { ...(settings.mpStudio || {}), w: b.offsetWidth }; saveSettings(); } }, 400);
}).observe($('mpStWrap'));
function mpStudioPlace(x, y) {
  const b = $('mpStudio');
  const s = settings.mpStudio || {};
  if (s.w && !b.style.width) b.style.width = s.w + 'px';
  const cv = mpCv.getBoundingClientRect();
  if (x == null) x = s.x != null ? s.x : cv.right - b.offsetWidth - 12;
  if (y == null) y = s.y != null ? s.y : cv.top + 12;
  b.style.left = Math.max(4, Math.min(innerWidth - b.offsetWidth - 4, x)) + 'px';
  b.style.top = Math.max(4, Math.min(innerHeight - 60, y)) + 'px';
}
$('mpStHead').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  const head = e.currentTarget;
  const box = $('mpStudio');
  const dx = e.clientX - box.offsetLeft;
  const dy = e.clientY - box.offsetTop;
  head.setPointerCapture(e.pointerId);
  const move = (ev) => mpStudioPlace(ev.clientX - dx, ev.clientY - dy);
  const up = () => {
    head.removeEventListener('pointermove', move);
    head.removeEventListener('pointerup', up);
    settings.mpStudio = { ...(settings.mpStudio || {}), x: box.offsetLeft, y: box.offsetTop };
    saveSettings();
  };
  head.addEventListener('pointermove', move);
  head.addEventListener('pointerup', up);
});
addEventListener('resize', () => { if (!$('mpStudio').hidden) mpStudioPlace(); });

// Студия догоняет редактор: новое содержимое — плавно (та же карта) или заново (другая карта)
function mpStudioSync() {
  if (!mpStudioOn || !mpOpen) return;
  const t = mpTarget();
  const c = t && mpContentFor(t);
  if (!c) {
    mpStudioDrop();
    $('mpStStage').replaceChildren();
    $('mpStWhat').textContent = '';
    $('mpStOut').disabled = $('mpStReplay').disabled = true;
    return;
  }
  const key = JSON.stringify(c);
  $('mpStWhat').textContent = (MapView.LAYOUTS.find(([k]) => k === c.layout) || ['', ''])[1] + ' · ' + mpLabel(c).replace(/^Карта: /, '');
  $('mpStOut').disabled = $('mpStReplay').disabled = false;
  if (mpStL && mpStL._mpKey === key) return;
  const old = mpStL && mpStL._mpC;
  if (mpStL && MapView.update(mpStL, c)) mpStPrev = old;
  else {
    mpStudioDrop();
    mpStPrev = null;
    mpStL = MapView.build(c);
    $('mpStStage').replaceChildren(mpStL);
  }
  mpStL._mpC = c;
  mpStL._mpKey = key;
}
// «Повторить»: вернуть студию к прежнему виду (нет его — ко всей карте) без анимации и проиграть переход ещё раз
function mpStudioReplay() {
  if (!mpStL) return;
  const c = mpStL._mpC;
  const same = (x) => !x || JSON.stringify(x) === mpStL._mpKey;
  let from = mpStPrev && mpStPrev.key === c.key ? mpStPrev : null;
  if (same(from)) from = mpContentFor({ map: c.tgt.map, layout: 'map' });
  if (same(from) && c.tgt.pt) from = mpContentFor({ map: c.tgt.map, pt: c.tgt.pt, layout: 'card' });
  if (same(from)) return;
  const prev = from;
  mpStudioDrop();
  const L = MapView.build(from);
  mpStL = L;
  $('mpStStage').replaceChildren(L);
  L._mpC = from;
  L._mpKey = JSON.stringify(from);
  // Пара кадров: первый вид встал на место — дальше переход, как на экране
  setTimeout(() => {
    if (mpStL !== L) return;
    if (MapView.update(L, c)) { L._mpC = c; L._mpKey = JSON.stringify(c); mpStPrev = prev; }
    else mpStudioSync();
  }, 120);
}
$('mpStReplay').addEventListener('click', mpStudioReplay);
$('mpStOut').addEventListener('click', () => { if (mpStL && mpStL._mpC) mpShow(mpStL._mpC.tgt); });
$('mpStClose').addEventListener('click', () => mpStudio(false));

/* ----- Нейросеть: промпт (mapsai.js ← промпты/ПРОМПТ-КАРТЫ.md) и ответ — JSON в окне #mpAiDlg.
   Для точки — её карточка; для карты — все места по теме карты (новые точки ставятся по координатам, если на карте
   есть две-три точки с координатами, поставленные вручную; иначе — в кучку в центре, с меткой auto) ----- */
let mpAiFor = null; // { map, pt } — куда вставлять ответ (pt нет — список мест для карты)
async function mpAiCopy(m, p, btn) {
  const text = p ? MapsAI.prompt('pt', p.name, m.name) : MapsAI.prompt('list', m.name);
  let ok = true;
  try { await navigator.clipboard.writeText(text); } catch { ok = false; }
  if (!ok) { showNotice('Не удалось скопировать промпт в буфер обмена', true); return; }
  // Отклик на самой кнопке — без островка
  if (btn) {
    const kids = [...btn.childNodes];
    btn.replaceChildren(Icons.el('done'), 'Скопировано');
    btn.classList.add('on');
    setTimeout(() => { if (btn.isConnected) { btn.replaceChildren(...kids); btn.classList.remove('on'); } }, 2200);
  }
}
const mpAiIsDefault = (name) => /^Точка( \d+)?$/.test(String(name || '').trim());
async function mpAiOpen(m, p) {
  mpAiFor = { map: m.id, pt: p ? p.id : null };
  $('mpAiTitle').textContent = p ? `Ответ нейросети — «${p.name}»` : `Ответ нейросети — места для карты «${m.name}»`;
  $('mpAiHint').textContent = p
    ? 'Вставьте ответ нейросети целиком. Тексты карточки заменятся, события, места Писания и источники добавятся. Название точки останется вашим.'
    : 'Вставьте ответ нейросети целиком. Места с теми же названиями дополнятся, новые станут точками. С координатами они встанут на карту сами, если на ней есть хотя бы две точки с координатами, поставленные вручную.';
  $('mpAiErr').hidden = true;
  const ta = $('mpAiText');
  ta.value = '';
  // В буфере уже JSON — подставим сразу
  try { const clip = await navigator.clipboard.readText(); if (/^\s*(```|[[{])/.test(clip) && /"name"\s*:/.test(clip)) ta.value = clip; } catch { /* нет доступа — вставят сами */ }
  $('mpAiDlg').showModal();
  ta.focus();
}
function mpAiErr(text) { const e = $('mpAiErr'); e.textContent = text; e.hidden = false; }
// Куда ставить новые точки без привязки: кучкой у центра, по спирали
function mpAiSpot(i) {
  const a = i * 2.39996;
  const r = 0.035 * Math.sqrt(i + 1);
  return [Math.min(0.95, Math.max(0.05, 0.5 + r * Math.cos(a))), Math.min(0.95, Math.max(0.05, 0.5 + r * Math.sin(a)))];
}
function mpAiApply() {
  const m = mpMap(mpAiFor && mpAiFor.map);
  if (!m) { $('mpAiDlg').close(); return; }
  let res;
  try { res = MapsAI.parse($('mpAiText').value); } catch (e) { mpAiErr('Не получилось прочитать ответ: ' + e.message + '. Скопируйте ответ нейросети целиком — вместе с { }.'); return; }
  const cal = MapsAI.calib(m.points);
  const one = mpAiFor.pt && !res.many ? mpPt(m, mpAiFor.pt) : null;
  const touched = [];
  let added = 0;
  let loose = 0;
  let noGeo = 0;
  if (one) {
    MapsAI.merge(one, res.places[0], !mpAiIsDefault(one.name));
    if (one.auto && one.geo && cal) [one.x, one.y] = cal(one.geo).map((v) => Math.min(1, Math.max(0, v)));
    touched.push(one);
  } else {
    for (const o of res.places) {
      let p = MapsAI.findByName(m.points, o.name);
      if (p) { MapsAI.merge(p, o, true); touched.push(p); continue; }
      p = MapView.normPoint({ name: o.name, type: o.type || 'place', auto: true });
      MapsAI.merge(p, o, true);
      if (p.geo && cal) [p.x, p.y] = cal(p.geo).map((v) => Math.min(1, Math.max(0, v)));
      else { [p.x, p.y] = mpAiSpot(loose); loose++; if (!p.geo) noGeo++; }
      m.points.push(p);
      touched.push(p);
      added++;
    }
  }
  // Места Писания, которые программа не поняла, — оставляем, но говорим
  const bad = [];
  for (const p of touched) for (const r of [...p.refs, ...p.events.map((e) => e.ref).filter(Boolean)]) if (!Bible.parseRef(r) && !bad.includes(r)) bad.push(r);
  $('mpAiDlg').close();
  mpSave();
  mpRenderAll();
  if (touched[0]) mpSelect({ kind: 'pt', id: touched[0].id });
  if (loose > noGeo) flashStatus(`Нет привязки к координатам — мест в центре карты: ${loose}. Поставьте 2–3 места с координатами на свои места — остальные встанут кнопкой «Расставить по координатам»`);
  else if (noGeo) flashStatus(`Нет координат у мест: ${noGeo} — они в центре карты, поставьте их вручную`);
  else if (added) flashStatus(`Добавлено мест: ${added}`);
  if (bad.length) showNotice('Не удалось понять места Писания: ' + bad.join('; ') + ' — проверьте их в карточке', true);
}
$('mpAiApply').addEventListener('click', mpAiApply);
$('mpAiCancel').addEventListener('click', () => $('mpAiDlg').close());
$('mpAiX').addEventListener('click', () => $('mpAiDlg').close());
$('mpAiCopy').addEventListener('click', (e) => { const m = mpMap(mpAiFor && mpAiFor.map); if (m) mpAiCopy(m, mpPt(m, mpAiFor.pt), e.currentTarget); });
$('mpAiText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); mpAiApply(); } });
// Расставить точки, поставленные сами (auto), по координатам — опора: точки с координатами, поставленные вручную
function mpAiPlace(m) {
  const cal = MapsAI.calib(m.points);
  if (!cal) { showNotice('Сначала поставьте на свои места хотя бы две точки с координатами (широта и долгота в свойствах точки)', true); return; }
  for (const p of m.points) if (p.auto && p.geo) [p.x, p.y] = cal(p.geo).map((v) => Math.min(1, Math.max(0, v)));
  mpSave();
  mpRenderAll();
}

/* ----- Библия: место Писания → вкладка «Библия» → обратно к карте ----- */
function mpOpenRef(ref) {
  if (!ref) return;
  if (typeof bible === 'undefined' || !bible) { showNotice('Библия ещё не загружена', true); return; }
  if (!Bible.parseRef(ref)) { showNotice(`Не удалось понять место «${ref}». Пример: Ин 3:16 или 1 Кор 13:4-7`, true); return; }
  mpBack = { map: mpId, sel: mpSel, cam: { ...mpCam } };
  setTab('bible');
  $('refInput').value = ref;
  previewRef();
  mpBackShow();
}
function mpBackShow() {
  let b = $('mpBack');
  if (!b) {
    b = mpEl('div', 'ui-pop mp-back');
    b.id = 'mpBack';
    const t = mpEl('span');
    t.id = 'mpBackText';
    const go = mpBtn('К карте', 'Вернуться во вкладку «Карты» — к той же карте и точке', mpBackGo, 'map');
    go.className = 'primary';
    b.append(t, go, mpBtn('✕', 'Убрать подсказку', mpBackHide));
    $('bibleView').append(b);
  }
  const m = mpMap(mpBack.map);
  const p = mpBack.sel && mpBack.sel.kind === 'pt' ? mpPt(m, mpBack.sel.id) : null;
  $('mpBackText').textContent = 'Из карты «' + (m ? m.name : '') + '»' + (p ? ' — ' + p.name : '');
  b.hidden = false;
}
function mpBackHide() { const b = $('mpBack'); if (b) b.hidden = true; }
function mpBackGo() {
  const back = mpBack;
  mpBack = null;
  mpBackHide();
  if (!back) return;
  setTab('maps');
  if (mpMap(back.map)) {
    mpOpenMap(back.map);
    mpCam = back.cam || mpCam;
    if (back.sel) mpSelect(back.sel);
  }
}

/* ----- Клавиши (renderer.js зовёт, когда открыта вкладка и фокус не в поле ввода) ----- */
function mpKey(e) {
  const m = mpMap();
  if (!m) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const p = mpSelPt();
  const r = mpSelRt();
  if (e.key === 'Escape') {
    if (mpTool !== 'sel') { mpSetTool('sel'); return true; }
    if (mpSel) { mpSelect(null); return true; }
    return false;
  }
  if (!ctrl && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
    if (p) { mpDelPoint(p); return true; }
    if (r) { mpDelRoute(r); return true; }
    return false;
  }
  if (ctrl && e.code === 'KeyD' && p) { mpDupPoint(p); return true; }
  if (ctrl || e.altKey) return false;
  if (e.key === 'Enter') { mpShow(); return true; }
  if (e.code === 'KeyS') { mpStudio(!mpStudioOn); return true; }
  if (e.code === 'KeyT' && mpStudioOn) { mpStudioReplay(); return true; }
  if (e.code === 'KeyF') { mpFit(); return true; }
  if (e.code === 'KeyP') { mpSetTool(mpTool === 'pt' ? 'sel' : 'pt'); return true; }
  if (e.code === 'KeyV') { mpSetTool('sel'); return true; }
  if (e.code === 'KeyR') { mpSetTool(mpTool === 'rt' ? 'sel' : 'rt'); return true; }
  if (e.key === '+' || e.key === '=') { mpZoomBy(1.25); return true; }
  if (e.key === '-' || e.key === '_') { mpZoomBy(1 / 1.25); return true; }
  // Стрелки — сдвинуть выбранную точку (Shift — сильнее)
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir && p) {
    const g = mpGeo();
    const step = (e.shiftKey ? 10 : 1) / (g ? g.s : 1);
    p.x = Math.min(1, Math.max(0, p.x + (dir[0] * step) / m.w));
    p.y = Math.min(1, Math.max(0, p.y + (dir[1] * step) / m.h));
    delete p.auto;
    mpPtChanged(p);
    mpSave();
    return true;
  }
  return false;
}
