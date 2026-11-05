/* ---------- Окно «Картинка»: правка фото (обрезка, поворот, кисть, текст, цвет) ----------
   Слайды правятся в редакторе тем главного окна (свой вид слайда), старого редактора слайдов больше нет.
   «Сохранить» — новый файл в images/ (исходник не трогаем), результат уходит окну оператора через main.js. */

const $ = (id) => document.getElementById(id);
const W = 1920;
const H = 1080;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = (x) => JSON.parse(JSON.stringify(x));

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

// Шрифты для текста на картинке
document.querySelectorAll('select.font-sel').forEach((sel) => {
  for (const [k, v] of Object.entries(Scene.FONT_NAMES)) sel.append(Object.assign(document.createElement('option'), { value: k, textContent: v }));
});

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
  if (dirty && !window.confirm('Есть несохранённые изменения картинки. Открыть другую?')) return;
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
    imgHistory = [];
    drawWork();
    note(imgTarget ? 'Картинка сохранена и заменена в слайде' : 'Картинка сохранена и добавлена в открытый плейлист');
  } else note('Копия сохранена: ' + file.name);
}
$('imSaveAs').addEventListener('click', () => saveImage(true));


/* ===== Клавиши, закрытие, загрузка ===== */

$('save').addEventListener('click', () => saveImage(false));
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); saveImage(false); return; }
  if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); imgUndo(); }
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
  if (dirty && !window.confirm('Есть несохранённые изменения. Открыть другое без сохранения?')) return;
  // Цвета программы из «Настройки → Оформление»
  const ui = p.ui || {};
  for (const v of ['--ink', '--panel', '--field', '--line', '--text', '--muted', '--live', '--brown', '--warn']) {
    if (ui[v]) document.documentElement.style.setProperty(v, ui[v]); else document.documentElement.style.removeProperty(v);
  }
  document.documentElement.style.setProperty('--live-ink', ui['--ink'] || '#051822');
  document.documentElement.style.colorScheme = ui.scheme || 'dark'; // светлая тема программы — светлые поля и прокрутка
  if (p.image) openImagePath(p.image.path, p.image.name, p.target);
});

setImgTool('none');
updateFx();
$('imBrushSizeVal').textContent = $('imBrushSize').value;
drawWork();
