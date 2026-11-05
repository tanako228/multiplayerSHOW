/* ===== Быстрый поиск медиафайлов (Ctrl+S — окно, Ctrl+F — сразу поиск) =====
   Всё сразу: песни и презентации всех библиотек и плейлистов + файлы закреплённых папок
   медиапула и папки «Музыки» со всеми подпапками. Стрелки — выбор и предпросмотр,
   Ctrl+Enter — в выбранный плейлист (только плейлисты). Щелчок мимо окна — закрыть.
   В строке — библиотека пункта; правая кнопка — «Открыть в библиотеке» (gotoItem) и «Показать в проводнике». */

const Q_ROW = 30; // высота строки списка (список рисуется только видимой частью — песен тысячи)
const Q_KINDS = [['all', 'Все'], ['song', 'Песни'], ['pres', 'Презентации'], ['image', 'Фото'], ['video', 'Видео'], ['audio', 'Музыка']];

let qAll = [];        // все пункты: { item } из библиотеки или { file } с диска
let qFiles = null;    // файлы с диска (читаются при открытии окна)
let qRes = [];        // найденное, по порядку
let qSel = 0;         // выбранная строка
let qKind = 'all';
let qPlId = '';       // в какой плейлист добавлять
let qText = new WeakMap(); // песня → её текст для поиска (считается раз за открытие окна)

const quickOpen = () => !$('quick').hidden;
const qNorm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

// Вид пункта для фильтра: песня, презентация, фото, видео, музыка
function qKindOf(r) {
  if (r.file) return r.file.type === 'presentation' ? 'pres' : r.file.type;
  const k = r.item.kind;
  if (k === 'song') return 'song';
  if (k === 'audio') return 'audio';
  if (k === 'media') return r.item.slides.some((s) => s.k === 'video') ? 'video' : 'image';
  return 'pres';
}

// Подпись в строке: библиотека (или плейлист, если ни в одной библиотеке нет) и жанр
function qWhereShort(item) {
  const pl = itemPlaces(item);
  const libs = pl.filter((p) => p.kind === 'lib');
  const shown = libs.length ? libs : pl.slice(0, 1);
  const place = shown.length ? shown[0].name + (shown.length > 1 ? ` +${shown.length - 1}` : '') : '';
  return [place, item.song && item.song.genre].filter(Boolean).join(' · ') || Slides.PRES_NAMES[item.kind] || '';
}

// Закрыть поиск и показать пункт в его библиотеке
function qGoto(kind, id, item) {
  closeQuick();
  gotoItem(kind, id, item.id);
}

// Правая кнопка по строке
function qMenu(e, i) {
  qPick(i);
  const r = qRes[i];
  if (!r) return;
  const pl = lib.playlists.find((p) => p.id === qPlId);
  const add = pl ? [{ label: `Добавить в плейлист «${pl.name}»`, key: 'Ctrl+Enter', fn: quickAdd }] : [];
  if (r.file) { showMenu(e, [...add, ...revealItems(r.file.path)]); return; }
  const places = itemPlaces(r.item).map((p) => ({ label: `${p.kind === 'lib' ? 'Открыть в библиотеке' : 'Открыть в плейлисте'} «${p.name}»`, fn: () => qGoto(p.kind, p.id, r.item) }));
  showMenu(e, [
    ...(places.length ? places : [{ label: 'Нет ни в одной библиотеке', disabled: true, fn() {} }]),
    ...(add.length ? ['-', ...add] : []),
    ...(r.kind === 'song' ? [{ label: 'Изменить песню…', fn: () => { closeQuick(); openSongDialog(r.item); } }] : []),
    ...revealItems(itemPath(r.item)),
  ]);
}

function qCollect() {
  const items = Object.values(lib.items).filter((it) => it && Array.isArray(it.slides)).map((item) => ({ item, name: item.name || '' }));
  const files = (qFiles || []).map((file) => ({ file, name: file.name }));
  qAll = items.concat(files);
  qText = new WeakMap();
  for (const r of qAll) {
    r.kind = qKindOf(r);
    r.key = qNorm(r.name + ' ' + (r.item && r.item.song ? (r.item.song.number || '') + ' ' + (r.item.song.genre || '') : ''));
  }
  qAll.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
}

function qSongText(item) {
  if (!item.song && item.kind !== 'song') return '';
  if (!qText.has(item)) qText.set(item, qNorm(item.song ? item.song.text : item.slides.map((s) => s.text || '').join('\n')));
  return qText.get(item);
}

// Поиск: сначала точный номер песни, потом название с начала, потом в названии, потом в словах песни
function qSearch() {
  const q = qNorm($('qInput').value.trim());
  const words = q.split(/\s+/).filter(Boolean);
  const pool = qKind === 'all' ? qAll : qAll.filter((r) => r.kind === qKind);
  if (!words.length) qRes = pool;
  else {
    const tiers = [[], [], [], []];
    for (const r of pool) {
      if (r.item && r.item.song && r.item.song.number === q) tiers[0].push(r);
      else if (r.key.startsWith(q)) tiers[1].push(r);
      else if (words.every((w) => r.key.includes(w))) tiers[2].push(r);
      else if (r.item && words.every((w) => qSongText(r.item).includes(w))) tiers[3].push(r);
    }
    qRes = tiers.flat();
  }
  qSel = 0;
  $('qList').scrollTop = 0;
  qRenderKinds();
  qRenderList();
  qPreview();
}

function qRenderKinds() {
  $('qKinds').replaceChildren(...Q_KINDS.map(([k, name]) => {
    const n = k === 'all' ? qAll.length : qAll.filter((r) => r.kind === k).length;
    const b = Object.assign(document.createElement('button'), { className: 'q-kind' + (k === qKind ? ' on' : ''), textContent: `${name} ${n}` });
    b.addEventListener('click', () => { qKind = k; qSearch(); $('qInput').focus(); });
    return b;
  }));
  $('qCount').textContent = qFiles ? `Найдено: ${qRes.length}` : `Найдено: ${qRes.length} · читаю папки…`;
}

function qIcon(r) {
  if (r.item) return itemIcon(r.item);
  return ico({ image: 'image', video: 'video', audio: 'audio', presentation: 'deck' }[r.file.type] || 'custom');
}

// Рисуем только видимые строки
function qRenderList() {
  const list = $('qList');
  const box = $('qRows');
  box.style.height = qRes.length * Q_ROW + 'px';
  const from = Math.max(0, Math.floor(list.scrollTop / Q_ROW) - 5);
  const to = Math.min(qRes.length, from + Math.ceil(list.clientHeight / Q_ROW) + 10);
  const rows = [];
  for (let i = from; i < to; i++) {
    const r = qRes[i];
    const row = Object.assign(document.createElement('div'), { className: 'q-row' + (i === qSel ? ' sel' : '') });
    row.style.top = i * Q_ROW + 'px';
    const where = r.item ? qWhereShort(r.item) : baseName(r.file.dir || '');
    row.append(qIcon(r), Object.assign(document.createElement('span'), { className: 'n', textContent: r.name }),
      Object.assign(document.createElement('span'), { className: 'w', textContent: where }));
    row.addEventListener('mousedown', (e) => { e.preventDefault(); if (e.button === 0) qPick(i); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); qMenu(e, i); });
    row.addEventListener('dblclick', () => quickAdd());
    rows.push(row);
  }
  if (!qRes.length) rows.push(Object.assign(document.createElement('div'), { className: 'q-none', textContent: qAll.length ? 'Ничего не найдено' : 'Пока нет ни песен, ни файлов' }));
  box.replaceChildren(...rows);
}

function qPick(i) {
  if (!qRes.length) return;
  qSel = Math.max(0, Math.min(qRes.length - 1, i));
  const list = $('qList');
  const top = qSel * Q_ROW;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + Q_ROW > list.scrollTop + list.clientHeight) list.scrollTop = top + Q_ROW - list.clientHeight;
  qRenderList();
  qPreview();
}

const qEl = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || '', textContent: text || '' });

// Состав аранжировки: цветные части по порядку
function qChips(order) {
  const box = qEl('div', 'q-chips');
  for (const l of order) {
    const c = qEl('span', 'q-chip', l);
    const col = partColor(l);
    if (col) c.style.setProperty('--part', col);
    box.append(c);
  }
  return box;
}

function qSongPreview(box, item) {
  const s = item.song || { text: Songs.fromSlides(item.slides), arrangements: [], arr: '' };
  box.append(qEl('div', 'q-meta', [s.number ? '№ ' + s.number : '', s.genre ? 'Жанр: ' + s.genre : 'Жанр не указан'].filter(Boolean).join(' · ')));
  const arrs = s.arrangements || [];
  box.append(qEl('div', 'q-sub', arrs.length ? 'Аранжировки' : 'Порядок частей (по тексту)'));
  if (!arrs.length) box.append(qChips(Songs.parse(s.text).seq));
  for (const a of arrs) {
    const r = qEl('div', 'q-arr' + (a.id === s.arr ? ' cur' : ''));
    r.append(qEl('span', 'q-arrname', a.name + (a.id === s.arr ? ' — выбрана' : '')), qChips(a.order));
    box.append(r);
  }
  box.append(qEl('div', 'q-sub', 'Текст'));
  const text = qEl('div', 'q-text');
  for (const line of s.text.split('\n')) {
    const m = line.trim().match(Songs.MARK_RE);
    const d = qEl('div', m ? 'q-lbl' : '', line || ' ');
    if (m) { const col = partColor(m[1]); if (col) d.style.color = col; }
    text.append(d);
  }
  box.append(text);
}

function qPreview() {
  const box = $('qPrev');
  box.replaceChildren();
  const r = qRes[qSel];
  if (!r) return;
  box.append(qEl('h3', 'q-title', r.name));
  if (r.item) {
    // Где лежит — ссылки: щелчок открывает библиотеку (плейлист) и показывает в ней этот пункт
    const places = itemPlaces(r.item);
    const where = qEl('div', 'q-where', places.length ? '' : 'Нет ни в одной библиотеке');
    places.forEach((p) => {
      const a = qEl('button', 'q-place', (p.kind === 'lib' ? 'Библиотека «' : 'Плейлист «') + p.name + '»');
      a.title = 'Открыть и показать, где лежит';
      a.addEventListener('click', () => qGoto(p.kind, p.id, r.item));
      where.append(a);
    });
    box.append(where);
    if (r.kind === 'song') qSongPreview(box, r.item);
    else {
      box.append(qEl('div', 'q-meta', `${Slides.PRES_NAMES[r.item.kind] || 'Презентация'} · слайдов: ${r.item.slides.length}`));
      const grid = qEl('div', 'svc-slides q-slides');
      r.item.slides.slice(0, 12).forEach((sl) => grid.append(slideThumb(r.item, sl)));
      box.append(grid);
      if (r.item.slides.length > 12) box.append(qEl('div', 'q-meta', `и ещё ${r.item.slides.length - 12}`));
    }
    return;
  }
  const f = r.file;
  if (f.type === 'image') box.append(Object.assign(document.createElement('img'), { className: 'q-media', src: f.url, alt: '' }));
  else if (f.type === 'video') box.append(Object.assign(document.createElement('video'), { className: 'q-media', src: f.url + '#t=0.1', muted: true, controls: true, preload: 'metadata' }));
  else if (f.type === 'audio') { box.append(qEl('div', 'q-big', '♪')); box.append(Object.assign(document.createElement('audio'), { src: f.url, controls: true, preload: 'none' })); }
  else box.append(qEl('div', 'q-big', '▤'), qEl('div', 'q-meta', 'Презентация PowerPoint — слайды появятся после добавления'));
  const w = qEl('div', 'q-where');
  const a = qEl('button', 'q-place', f.path);
  a.title = 'Показать в проводнике';
  a.addEventListener('click', () => revealFile(f.path));
  w.append(a);
  box.append(w);
}

function qRenderPl() {
  const s = $('qPl');
  if (!lib.playlists.some((p) => p.id === qPlId)) { const p = curPl(); qPlId = p ? p.id : ''; }
  s.replaceChildren(...lib.playlists.map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.name })));
  s.value = qPlId;
  s.disabled = !lib.playlists.length;
  $('qAdd').disabled = !lib.playlists.length;
}

// Выбранный пункт — в конец выбранного плейлиста, без вопросов
async function quickAdd() {
  const r = qRes[qSel];
  const pl = lib.playlists.find((p) => p.id === qPlId);
  if (!r) return;
  if (!pl) { qMsg('Сначала создайте плейлист'); return; }
  let added = [];
  if (r.item) added = [r.item];
  else {
    const res = await window.api.describeFiles([r.file.path], { slideWidth: settings.slideW, groupDecks: true });
    res.items.forEach((i) => { if (i.type === 'image' || i.type === 'video') i.fit = poolFitValue(); });
    if (res.errors.length) showNotice('Не удалось добавить: ' + res.errors.join('; '), true);
    added = res.items.map(fromFileItem);
    for (const it of added) { if (!it.kind) it.kind = Slides.presKind(it); lib.items[it.id] = it; }
  }
  if (!added.length) return;
  for (const it of added) pl.entries.push({ eid: newId(), item: it.id });
  lib.lastPl = pl.id;
  saveLib();
  renderService();
  qMsg(`Добавлено в «${pl.name}»: ${r.name}`);
  flashStatus(`«${r.name}» → плейлист «${pl.name}»`);
}

let qMsgTimer = 0;
function qMsg(t) {
  $('qMsg').textContent = t;
  clearTimeout(qMsgTimer);
  qMsgTimer = setTimeout(() => { $('qMsg').textContent = ''; }, 3000);
}

async function openQuick(focusSearch) {
  const was = quickOpen();
  $('quick').hidden = false;
  if (!was) {
    qCollect();
    qRenderPl();
    qSearch();
    // Файлы с диска — каждый раз заново (папки могли поменяться), список песен виден сразу
    const roots = [...(settings.poolFolders || []), settings.musicRoot].filter(Boolean);
    window.api.poolScan(roots).then((files) => {
      qFiles = files || [];
      if (!quickOpen()) return;
      const cur = qRes[qSel];
      qCollect();
      qSearch();
      const i = cur ? qRes.indexOf(qRes.find((r) => (r.item && r.item === cur.item) || (r.file && cur.file && r.file.path === cur.file.path))) : -1;
      if (i > 0) qPick(i);
    });
  }
  $('qInput').focus();
  if (focusSearch) $('qInput').select();
}

function closeQuick() {
  if (!quickOpen()) return;
  $('quick').hidden = true;
  $('qPrev').replaceChildren(); // остановить видео и звук предпросмотра
  if (document.activeElement && $('quick').contains(document.activeElement)) document.activeElement.blur();
}

const toggleQuick = () => (quickOpen() ? closeQuick() : openQuick(false));

$('qInput').addEventListener('input', qSearch);
$('qList').addEventListener('scroll', qRenderList);
$('qPl').addEventListener('change', () => { qPlId = $('qPl').value; $('qInput').focus(); });
$('qAdd').addEventListener('click', () => { quickAdd(); $('qInput').focus(); });

// Клавиши, пока окно открыто: стрелки, Ctrl+Enter, Esc, Tab — вид; остальное без Ctrl — в строку поиска
window.addEventListener('keydown', (e) => {
  if (!quickOpen() || document.querySelector('dialog[open]')) return;
  const page = Math.max(1, Math.floor($('qList').clientHeight / Q_ROW) - 1);
  const own = {
    ArrowDown: () => qPick(qSel + 1),
    ArrowUp: () => qPick(qSel - 1),
    PageDown: () => qPick(qSel + page),
    PageUp: () => qPick(qSel - page),
    Escape: () => closeQuick(),
    Tab: () => { const i = Q_KINDS.findIndex(([k]) => k === qKind); qKind = Q_KINDS[(i + (e.shiftKey ? Q_KINDS.length - 1 : 1)) % Q_KINDS.length][0]; qSearch(); },
  };
  let fn = !e.ctrlKey && !e.altKey ? own[e.code] || own[e.key] : null;
  if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.code === 'Enter' || e.code === 'NumpadEnter')) fn = quickAdd;
  if (fn) { e.preventDefault(); e.stopPropagation(); fn(); return; }
  if (e.ctrlKey || e.altKey || /^F\d+$/.test(e.code)) return; // Ctrl+S, Ctrl+F и прочие сочетания — как обычно
  e.stopPropagation(); // пробел, стрелки влево/вправо и т. п. не листают слайды за окном
  if (e.target !== $('qInput') && e.target !== $('qPl')) $('qInput').focus();
}, true);

// Щелчок мимо окна — закрыть
document.addEventListener('pointerdown', (e) => {
  if (quickOpen() && !$('quick').contains(e.target) && !e.target.closest('dialog, .ctx-menu')) closeQuick();
}, true);
