/* ---------- Песни и аранжировки (как Arrangements в ProPresenter) ----------
   Песня — обычная презентация (kind: 'song') с полем song:
     { text, number?, arrangements: [{ id, name, order: ['Куплет 1', 'Припев', …] }], arr, loose? }
   text — исходный текст, хранится один раз. Части размечены строками [Куплет 1], [Припев]…:
   текст после обозначения — эта часть до следующего обозначения, пустая строка внутри части — новый слайд,
   [Припев] без текста — повторить уже размеченный припев.
   Аранжировка — только порядок частей (по названию), копий текста нет; arr — выбранная ('' — как в тексте).
   item.slides собираются из текста и аранжировки (Songs.build), поэтому плейлисты, вывод и копирование
   работают как раньше. Слайды поправили в обход песни: текст возвращается в песню (Songs.absorb),
   а если менялся порядок слайдов — song.loose, пока песню не пересоберут.
   Типы частей (название, цвет, клавиша, нумерация) — lib.partTypes, отдельно от песен. */

const Songs = (() => {
  const MARK_RE = /^\[([^\]\n]+)\]$/;
  const TITLE_RE = /^(?:@@|title\s*:)\s*(.+)$/i;
  const ARR_RE = /^(?:arrangement|аранжировка)\s*:\s*(.+?)\s*=\s*(.*)$/i;
  const GENRE_RE = /^(?:genre|жанр)\s*:\s*(.+)$/i;
  const CCLI_RE = /^(?:ccli|авторы)\s*:\s*(.+)$/i; // CCLI и авторы — для поля шаблона темы
  // Тональность, темп, размер (для телефонов группы и сцены): строки «key: G», «tempo: 72», «time: 4/4» или ChordPro {key: G}
  const META_RE = /^\{?\s*(key|тональность|tempo|темп|time|размер)\s*:\s*([^}]+?)\s*\}?$/i;
  const META_KEY = { key: 'key', тональность: 'key', tempo: 'tempo', темп: 'tempo', time: 'time', размер: 'time' };
  // Поля песни → song (пустые не пишем); tempo — число 20–400
  function songMeta(song, m) {
    const k = String(m.key || '').trim().slice(0, 8);
    const t = Math.round(Number(String(m.tempo || '').replace(',', '.')));
    const z = String(m.time || '').trim().slice(0, 8);
    if (k) song.key = k; else delete song.key;
    if (t >= 20 && t <= 400) song.tempo = t; else delete song.tempo;
    if (/^\d{1,2}\/\d{1,2}$/.test(z)) song.time = z; else delete song.time;
    return song;
  }

  // Текст → части по порядку: blocks [{ label, slides: [текст слайда] }], groups — части с текстом по названию,
  // seq — порядок частей, как в тексте (с повторами)
  function parse(text) {
    const raw = [];
    let cur = null;
    for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
      const m = line.trim().match(MARK_RE);
      if (m) { cur = { label: m[1].trim(), lines: [] }; raw.push(cur); continue; }
      if (!cur) { cur = { label: '', lines: [] }; raw.push(cur); }
      cur.lines.push(line);
    }
    const blocks = raw.map((b) => ({
      label: b.label,
      slides: b.lines.join('\n').split(/\n[ \t]*\n/).map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n')).filter(Boolean),
    })).filter((b) => b.label || b.slides.length);
    const groups = new Map();
    const warnings = [];
    for (const b of blocks) {
      if (!b.slides.length) continue;
      if (groups.has(b.label)) {
        let n = 2;
        while (groups.has(`${b.label} (${n})`)) n++;
        warnings.push(`Часть «${b.label || 'без обозначения'}» с текстом встречается дважды — вторая считается «${b.label} (${n})». Чтобы повторить часть, оставьте только [${b.label}] без текста.`);
        b.label = `${b.label} (${n})`;
      }
      groups.set(b.label, b);
    }
    for (const b of blocks) if (!b.slides.length && !groups.has(b.label)) warnings.push(`У части «${b.label}» нет текста.`);
    return { blocks, groups, seq: blocks.filter((b) => groups.has(b.label)).map((b) => b.label), warnings };
  }

  const serialize = (blocks) => blocks.map((b) => (b.label ? `[${b.label}]` + (b.slides.length ? '\n' : '') : '') + b.slides.join('\n\n')).join('\n\n');

  const arrOf = (song) => (song.arrangements || []).find((a) => a.id === song.arr) || null;
  const order = (song, p) => { const a = arrOf(song); return a ? a.order.filter((l) => p.groups.has(l)) : p.seq; };

  // Слайды песни по выбранной аранжировке. id и темы слайдов сохраняются по месту (часть, повтор, слайд части);
  // byIndex — песня из старых слайдов, сопоставляем по порядку
  function build(song, oldSlides = [], byIndex = false, p = parse(song.text)) {
    const old = new Map(oldSlides.filter((s) => s.part !== undefined).map((s) => [s.part + '|' + s.occ + '|' + s.pi, s]));
    const occ = {};
    const out = [];
    for (const label of order(song, p)) {
      const n = occ[label] = (occ[label] || 0) + 1;
      p.groups.get(label).slides.forEach((text, pi) => {
        const was = byIndex ? oldSlides[out.length] : old.get(label + '|' + n + '|' + pi);
        const s = { id: was ? was.id : Slides.newId(), k: 'text', label, text, part: label, occ: n, pi };
        if (was && was.theme) s.theme = was.theme;
        if (was && was.look) s.look = was.look; // свой вид слайда (редактор тем)
        if (was && was.notes) s.notes = was.notes; // заметка к слайду и сценический макет (stage.js)
        if (was && was.stage) s.stage = was.stage;
        out.push(s);
      });
    }
    return out;
  }

  // Слайды поправили в редакторе, вставкой или удалением. Тот же порядок — новый текст уходит в песню
  // (и во все повторы этой части); другой порядок — 'loose'
  function absorb(item) {
    const song = item.song;
    const p = parse(song.text);
    const expect = build(song, item.slides, false, p);
    const same = expect.length === item.slides.length && expect.every((s, i) => {
      const x = item.slides[i];
      return x.k === 'text' && x.part === s.part && x.occ === s.occ && x.pi === s.pi;
    });
    if (!same) {
      if (song.loose) return '';
      song.loose = true;
      return 'loose';
    }
    delete song.loose;
    let changed = false;
    item.slides.forEach((x, i) => {
      const t = String(x.text || '').trim();
      if (t && t !== expect[i].text) { p.groups.get(x.part).slides[x.pi] = t; changed = true; }
    });
    if (!changed) return '';
    song.text = serialize(p.blocks);
    item.slides = build(song, item.slides);
    return 'text';
  }

  // Старая песня (только слайды с подписями) → текст с разметкой; повтор той же части — [Часть] без текста
  function fromSlides(slides) {
    const blocks = [];
    for (const s of slides.filter((x) => x.k === 'text')) {
      if (s.label || !blocks.length) blocks.push({ label: s.label || '', slides: [] });
      blocks[blocks.length - 1].slides.push(String(s.text || '').trim());
    }
    const seen = new Map();
    for (const b of blocks) {
      if (!b.label) continue;
      const t = b.slides.join('\n\n');
      if (!seen.has(b.label)) seen.set(b.label, t);
      else if (seen.get(b.label) === t) b.slides = [];
    }
    return serialize(blocks);
  }

  /* ----- Типы частей ----- */

  const baseName = (label) => String(label).replace(/\s*\(\d+\)$/, '').replace(/\s+\d+$/, '').trim().toLowerCase();
  const typeOf = (label, types) => { const b = baseName(label); return b ? types.find((t) => t.name.trim().toLowerCase() === b) || null : null; };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Следующее обозначение этого типа: «Куплет 1», «Куплет 2»…; без нумерации — «Припев», потом «Припев 2»
  function nextLabel(lines, type, skip = -1) {
    const name = type.name.trim();
    const re = new RegExp('^\\[' + esc(name) + '(?:\\s+(\\d+))?\\]$', 'i');
    let count = 0;
    let max = 0;
    lines.forEach((l, i) => {
      const m = i !== skip && l.trim().match(re);
      if (m) { count++; max = Math.max(max, m[1] ? +m[1] : 1); }
    });
    return type.num || count ? `${name} ${max + 1}` : name;
  }

  /* ----- Импорт и экспорт ----- */

  // «125. Название» → номер и название; без точки после числа номер не отделяем («10 000 причин»)
  function splitTitle(raw) {
    const m = raw.trim().match(/^(\d+)\s*[.)]\s*(.+)$/);
    return m ? { number: m[1], title: m[2].trim() } : { number: '', title: raw.trim() };
  }

  // ChordPro: {title:}, {soc}/{sov}/{sob} → обозначения частей, аккорды [Am] убираем
  // (keep — оставить аккорды: это поле «Аккорды для сцены», song.chords)
  function fromChordPro(t, keep) {
    const out = [];
    let verse = 0;
    for (const line of t.split('\n')) {
      const d = line.trim().match(/^\{\s*([\w-]+)\s*(?::\s*(.*?))?\s*\}$/);
      if (d) {
        const k = d[1].toLowerCase();
        const v = (d[2] || '').trim();
        if (k === 'title' || k === 't') out.push('@@ ' + v, '');
        else if (k === 'soc' || k === 'start_of_chorus') out.push('', `[${v || 'Припев'}]`);
        else if (k === 'sov' || k === 'start_of_verse') out.push('', `[${v || 'Куплет ' + ++verse}]`);
        else if (k === 'sob' || k === 'start_of_bridge') out.push('', `[${v || 'Бридж'}]`);
        else if (/^(eoc|eov|eob|end_of_\w+)$/.test(k)) out.push('');
        else if ((k === 'c' || k === 'comment' || k === 'ci') && v) out.push('', `[${v}]`);
        continue;
      }
      if (line.trim().startsWith('#')) continue;
      if (keep) { out.push(line.trimEnd()); continue; }
      const clean = line.replace(/\[[^\]]*\]/g, '').replace(/[ \t]{2,}/g, ' ').trimEnd();
      if (!clean.trim() && line.trim()) continue; // строка из одних аккордов
      out.push(clean);
    }
    return out.join('\n');
  }

  // Текстовый файл → песни. Название — только из «@@ …» или «title: …» в первой строке
  // (после заголовка — пустая строка); иначе — имя файла. Несколько заголовков — несколько песен.
  // Разметку частей не угадываем: нет [обозначений] — текст остаётся для ручной разметки.
  function fromText(text, fileName = '', ext = '') {
    let t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    let chords = '';
    const meta = {};
    for (const line of t.split('\n')) { const m = line.trim().match(META_RE); if (m) meta[META_KEY[m[1].toLowerCase()]] = m[2]; }
    if (/^(cho|chopro|chordpro|crd|pro)$/.test(ext) || /^\s*\{(title|t)\s*:/im.test(t)) {
      if (/\[[A-H][^\]\n]{0,8}\]/.test(t)) chords = fromChordPro(t, true).split('\n').filter((l) => !/^@@ /.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      t = fromChordPro(t);
    }
    const parts = [];
    let cur = null;
    let prevBlank = true;
    for (const line of t.split('\n')) {
      const m = prevBlank && line.trim().match(TITLE_RE);
      prevBlank = !line.trim();
      if (m && (!cur || cur.lines.some((l) => l.trim()) || cur.title === null)) {
        cur = { title: m[1], lines: [] };
        parts.push(cur);
        continue;
      }
      if (!cur) { cur = { title: null, lines: [] }; parts.push(cur); }
      cur.lines.push(line);
    }
    const out = [];
    for (const part of parts) {
      const arrangements = [];
      let genre = '';
      let ccli = '';
      const lines = part.lines.filter((l) => {
        if (META_RE.test(l.trim())) return false;
        const g = l.trim().match(GENRE_RE);
        if (g) { genre = g[1].trim(); return false; }
        const c = l.trim().match(CCLI_RE);
        if (c) { ccli = c[1].trim(); return false; }
        const a = l.trim().match(ARR_RE);
        if (a) arrangements.push({ id: Slides.newId(), name: a[1], order: a[2].split(a[2].includes('|') ? '|' : ',').map((x) => x.trim()).filter(Boolean) });
        return !a;
      });
      const body = lines.join('\n').replace(/^\s*\n/, '').trim();
      if (!body) continue;
      const tt = part.title !== null ? splitTitle(part.title) : null;
      const name = tt ? (tt.number ? `${tt.number}. ${tt.title}` : tt.title) : fileName || 'Песня';
      const song = { text: body, arrangements, arr: '' };
      if (tt && tt.number) song.number = tt.number;
      if (genre) song.genre = genre;
      if (ccli) song.ccli = ccli;
      out.push({ name, song });
    }
    if (chords && out.length === 1) out[0].song.chords = chords; // аккорды для сценического экрана
    if (out.length === 1) songMeta(out[0].song, meta);
    return out;
  }

  // Свой JSON (экспорт multiplayerSHOW): одна песня или список
  function fromJson(data) {
    const list = data && data.type === 'songs' && Array.isArray(data.songs) ? data.songs : data && data.type === 'song' ? [data] : [];
    return list.filter((s) => s && typeof s.text === 'string' && s.text.trim()).map((s) => {
      const arrangements = (Array.isArray(s.arrangements) ? s.arrangements : []).filter((a) => a && Array.isArray(a.order))
        .map((a) => ({ id: String(a.id || Slides.newId()), name: String(a.name || 'Аранжировка'), order: a.order.map(String) }));
      const song = { text: s.text, arrangements, arr: arrangements.some((a) => a.id === s.arr) ? s.arr : '' };
      if (s.number) song.number = String(s.number);
      if (s.genre) song.genre = String(s.genre);
      if (s.ccli) song.ccli = String(s.ccli);
      if (s.chords) song.chords = String(s.chords);
      songMeta(song, s);
      return { name: String(s.name || 'Песня'), song };
    });
  }

  const songOf = (item) => item.song || { text: fromSlides(item.slides), arrangements: [], arr: '' };

  // Текст с разметкой: заголовок @@, части в [скобках], в конце — аранжировки строками «arrangement: …»
  function toText(item) {
    const s = songOf(item);
    const arr = (s.arrangements || []).map((a) => `arrangement: ${a.name} = ${a.order.join(' | ')}`);
    const tail = [...(s.genre ? [`genre: ${s.genre}`] : []), ...(s.ccli ? [`ccli: ${s.ccli}`] : []),
      ...(s.key ? [`key: ${s.key}`] : []), ...(s.tempo ? [`tempo: ${s.tempo}`] : []), ...(s.time ? [`time: ${s.time}`] : []), ...arr];
    return [`@@ ${item.name}`, '', s.text.trim(), ...(tail.length ? ['', ...tail] : [])].join('\n') + '\n';
  }

  const toJson = (items) => ({
    app: 'church-presenter', type: 'songs', version: 1,
    songs: items.map((it) => { const s = songOf(it); return { name: it.name, number: s.number || '', genre: s.genre || '', ccli: s.ccli || '', text: s.text, arrangements: s.arrangements || [], arr: s.arr || '', ...(s.chords ? { chords: s.chords } : {}), ...(s.key ? { key: s.key } : {}), ...(s.tempo ? { tempo: s.tempo } : {}), ...(s.time ? { time: s.time } : {}) }; }),
  });

  return { MARK_RE, parse, serialize, build, absorb, fromSlides, typeOf, nextLabel, fromText, fromJson, toText, toJson, arrOf, songMeta };
})();

/* ===== Типы частей песни (lib.partTypes) ===== */

const PART_DEFAULTS = [
  ['Куплет', '#3b82f6', 'Ctrl+Digit1', true],
  ['Припев', '#e5484d', 'Ctrl+Digit2'],
  ['Бридж', '#8e4ec6', 'Ctrl+Digit3'],
  ['Вступление', '#46a758', 'Ctrl+Digit4'],
  ['Завершение', '#f76b15', 'Ctrl+Digit5'],
  ['Проигрыш', '#8b8d98', 'Ctrl+Digit6'],
];
const defaultPartTypes = () => PART_DEFAULTS.map(([name, color, key, num]) => ({ id: newId(), name, color, key, num: !!num }));

function partTypes() {
  if (!Array.isArray(lib.partTypes)) { lib.partTypes = defaultPartTypes(); saveLib(); }
  return lib.partTypes;
}
// Цвет подписи слайда по типу части («Куплет 2» → цвет «Куплета»)
const partColor = (label) => { const t = lib && label ? Songs.typeOf(label, partTypes()) : null; return t ? t.color : ''; };

/* ===== Окно песни: текст с разметкой и аранжировки ===== */

let songEditing = null; // презентация, которую правим, или null для новой
let songDraft = null;   // { arrangements, arr, number, sheets } — правки до «Сохранить»

const curArr = () => songDraft.arrangements.find((a) => a.id === songDraft.arr) || null;

function openSongDialog(item) {
  if (!item && plNoCreate()) return; // новая песня — только в библиотеке (playlist.js)
  songEditing = item;
  const s = item && item.song;
  songDraft = { arrangements: s ? JSON.parse(JSON.stringify(s.arrangements || [])) : [], arr: s ? s.arr || '' : '', number: s ? s.number || '' : '', sheets: s && Array.isArray(s.sheets) ? s.sheets.slice() : [] };
  $('songDlgTitle').textContent = item ? 'Изменить песню' : 'Новая песня';
  $('songName').value = item ? item.name : '';
  $('songGenre').value = (s && s.genre) || '';
  $('songCcli').value = (s && s.ccli) || '';
  // Подсказки — жанры, что уже есть в базе
  const genres = [...new Set(Object.values(lib.items).map((x) => x.song && x.song.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  $('songGenres').replaceChildren(...genres.map((g) => Object.assign(document.createElement('option'), { value: g })));
  $('songText').value = s ? s.text : item ? Songs.fromSlides(item.slides) : '';
  $('songChords').value = (s && s.chords) || '';
  $('songChordsBox').open = !!(s && s.chords);
  $('songKeyIn').value = (s && s.key) || '';
  $('songTempo').value = (s && s.tempo) || '';
  $('songTime').value = (s && s.time) || '';
  renderSongSheets();
  $('songSheetsBox').open = songDraft.sheets.length > 0;
  renderPartBar();
  songHot = { part: '', occ: '' };
  updateSongView();
  $('songDialog').showModal();
  (item ? $('songText') : $('songName')).focus();
  syncSongBack(); // ширина поля известна только в открытом окне
}

// Кнопки типов над текстом: щелчок или клавиша — обозначить выделенную часть
function renderPartBar() {
  const bar = $('partBar');
  bar.replaceChildren(...partTypes().map((t) => {
    const b = Object.assign(document.createElement('button'), { className: 'part-btn', title: `Обозначить выделенный текст: [${t.name}]` + (t.key ? ` (${prettyCombo(t.key)})` : '') });
    b.style.setProperty('--part', t.color);
    b.append(document.createTextNode(t.name));
    if (t.key) b.append(Object.assign(document.createElement('span'), { className: 'k', textContent: prettyCombo(t.key) }));
    b.addEventListener('mousedown', (e) => e.preventDefault()); // выделение в тексте не теряется
    b.addEventListener('click', () => markPart(t));
    return b;
  }));
  const un = Object.assign(document.createElement('button'), { className: 'part-btn', title: 'Убрать обозначение части у строки с курсором (Ctrl+0)' });
  un.append(document.createTextNode('Убрать'), Object.assign(document.createElement('span'), { className: 'k', textContent: 'Ctrl + 0' }));
  un.addEventListener('mousedown', (e) => e.preventDefault());
  un.addEventListener('click', unmarkPart);
  const ed = Object.assign(document.createElement('button'), { title: 'Добавить, удалить, изменить типы частей: название, цвет, клавиша' });
  ed.dataset.icon = 'parts';
  ed.append(document.createTextNode('Типы…'));
  ed.addEventListener('click', openPartTypes);
  bar.append(un, ed);
  Icons.apply(bar);
}

// Номер строки, с которой начинается выделение (пустые строки в начале выделения пропускаем)
function selLines() {
  const ta = $('songText');
  const v = ta.value;
  const lines = v.split('\n');
  const a = ta.selectionStart;
  const b = ta.selectionEnd;
  let li = v.slice(0, a).split('\n').length - 1;
  const last = v.slice(0, Math.max(a, b - 1)).split('\n').length - 1;
  while (li < last && !lines[li].trim()) li++;
  // Курсор на строке обозначения или сразу под ней — меняем это обозначение
  let mark = -1;
  if (Songs.MARK_RE.test(lines[li].trim())) mark = li;
  else if (li > 0 && Songs.MARK_RE.test(lines[li - 1].trim())) mark = li - 1;
  const off = (i) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
  return { ta, lines, li, mark, off, end: b };
}

function markPart(type) {
  const { ta, lines, li, mark, off, end } = selLines();
  const label = Songs.nextLabel(lines, type, mark);
  const len = ta.value.length;
  ta.focus();
  if (mark >= 0) {
    ta.setSelectionRange(off(mark), off(mark) + lines[mark].length);
    document.execCommand('insertText', false, `[${label}]`);
  } else {
    // Перед новой частью — пустая строка, чтобы текст было легко читать
    const gap = li > 0 && lines[li - 1].trim() ? '\n' : '';
    ta.setSelectionRange(off(li), off(li));
    document.execCommand('insertText', false, `${gap}[${label}]\n`);
  }
  const at = Math.max(end, off(li)) + ta.value.length - len;
  ta.setSelectionRange(at, at);
  updateSongView();
}

function unmarkPart() {
  const { ta, lines, mark, off } = selLines();
  if (mark < 0) return;
  ta.focus();
  ta.setSelectionRange(off(mark), Math.min(ta.value.length, off(mark) + lines[mark].length + 1));
  document.execCommand('delete');
  updateSongView();
}

function partChip(label, o = {}) {
  const t = Songs.typeOf(label, partTypes());
  const c = Object.assign(document.createElement('span'), { className: 'part-chip' + (o.missing ? ' missing' : ''), title: o.missing ? 'Такой части больше нет в тексте' : '' });
  if (t) c.style.setProperty('--part', t.color);
  c.append(document.createTextNode(label || 'Без обозначения'));
  return c;
}

// Перетаскивание частей: из «Частей песни» — добавить, внутри «Порядка» — переставить
const PART_DRAG = 'application/x-cp-part';
function arrDrop(e, at) {
  const a = curArr();
  let d;
  try { d = JSON.parse(e.dataTransfer.getData(PART_DRAG)); } catch { return; }
  if (!a || !d) return;
  e.preventDefault();
  e.stopPropagation();
  if (at === null) at = a.order.length;
  if (d.from >= 0) {
    const [m] = a.order.splice(d.from, 1);
    if (at > d.from) at--;
    a.order.splice(at, 0, m);
  } else a.order.splice(at, 0, d.label);
  updateSongView();
}

function renderArr(p) {
  const a = curArr();
  const sel = $('arrSel');
  sel.replaceChildren(new Option('Как в тексте', ''), ...songDraft.arrangements.map((x) => new Option(x.name, x.id)));
  sel.value = a ? a.id : '';
  $('arrRename').disabled = !a;
  $('arrCopy').disabled = !a;
  $('arrDelete').disabled = !a;
  // Части песни: щелчок — в конец порядка, можно перетащить в нужное место
  const parts = $('arrParts');
  parts.classList.toggle('off', !a);
  parts.replaceChildren(...[...p.groups.keys()].map((label) => {
    const c = partChip(label);
    c.dataset.part = label;
    c.draggable = !!a;
    c.title = a ? 'Щелчок — добавить в конец, или перетащите в нужное место' : 'Сначала создайте аранжировку';
    c.addEventListener('click', () => { if (a) { a.order.push(label); updateSongView(); } });
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData(PART_DRAG, JSON.stringify({ label, from: -1 })); e.dataTransfer.effectAllowed = 'copyMove'; });
    return c;
  }));
  if (!p.groups.size) parts.append(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'Обозначьте части в тексте — они появятся здесь' }));
  // Порядок исполнения
  const box = $('arrOrder');
  box.classList.toggle('off', !a);
  const list = a ? a.order : p.seq;
  const occ = {};
  box.replaceChildren(...list.map((label, i) => {
    const c = partChip(label, { missing: !p.groups.has(label) });
    // Какой это повтор части — по нему находятся её слайды (Songs.build: occ)
    if (p.groups.has(label)) { c.dataset.part = label; c.dataset.occ = occ[label] = (occ[label] || 0) + 1; }
    if (!a) return c;
    c.draggable = true;
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData(PART_DRAG, JSON.stringify({ label, from: i })); e.dataTransfer.effectAllowed = 'move'; });
    c.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(PART_DRAG)) { e.preventDefault(); e.stopPropagation(); c.classList.add('drop'); } });
    c.addEventListener('dragleave', () => c.classList.remove('drop'));
    c.addEventListener('drop', (e) => { c.classList.remove('drop'); arrDrop(e, i); });
    const x = Object.assign(document.createElement('span'), { className: 'x', textContent: '×', title: 'Убрать из аранжировки' });
    x.addEventListener('click', () => { a.order.splice(i, 1); updateSongView(); });
    c.append(x);
    return c;
  }));
  if (!list.length) box.append(Object.assign(document.createElement('span'), { className: 'hint', textContent: a ? 'Перетащите сюда части песни' : 'Пока пусто' }));
  $('arrHint').textContent = a ? 'Части можно повторять, перетаскивать и убирать (×). Текст при этом не меняется.'
    : 'Слайды идут как в тексте. «＋ Аранжировка» — свой порядок частей, текст не копируется.';
}

function updateSongView() {
  const text = $('songText').value;
  const p = Songs.parse(text);
  const slides = Songs.build({ text, arrangements: songDraft.arrangements, arr: songDraft.arr }, songEditing ? songEditing.slides : [], false, p);
  const a = curArr();
  $('songCount').textContent = slides.length ? `Слайдов: ${slides.length}` + (a ? ` — «${a.name}»` : '') : 'Здесь появятся слайды';
  $('songWarn').textContent = p.warnings.join(' ');
  $('songWarn').hidden = !p.warnings.length;
  renderArr(p);
  const fake = { type: 'pres', theme: songEditing && songEditing.theme, slides };
  $('songPreview').replaceChildren(...slides.map((s) => {
    const el = slideThumb(fake, s);
    el.dataset.part = s.part;
    el.dataset.occ = s.occ;
    const c = partColor(s.part);
    if (c) el.style.setProperty('--part', c);
    return el;
  }));
  fitThumbs($('songPreview'));
  songLink(songHot.part, songHot.occ);
}

/* Подсветка частей. В тексте: строки каждой части — полосой её цвета, часть с курсором ярче.
   Навели на часть в «Порядке исполнения» или «Частях песни» — подсвечены её слайды; навели на слайд — его часть */
let songHot = { part: '', occ: '' };

// Каждой строке текста — название её части (как в Songs.parse: вторая часть с тем же названием — «… (2)»)
function songLineParts(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks = [];
  let cur = -1;
  const idx = lines.map((line) => {
    const m = line.trim().match(Songs.MARK_RE);
    if (m) { blocks.push({ label: m[1].trim(), text: false }); cur = blocks.length - 1; } else if (cur >= 0 && line.trim()) blocks[cur].text = true;
    return cur;
  });
  const seen = new Set();
  for (const b of blocks) {
    if (!b.text) continue;
    let l = b.label;
    if (seen.has(l)) { let n = 2; while (seen.has(`${b.label} (${n})`)) n++; l = `${b.label} (${n})`; }
    seen.add(l);
    b.label = l;
  }
  return { lines, part: idx.map((i) => (i >= 0 ? blocks[i].label : '')) };
}

function paintSongText() {
  const ta = $('songText');
  const { lines, part } = songLineParts(ta.value);
  const caret = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
  const on = songHot.part || part[caret];
  $('songBack').firstChild.replaceChildren(...lines.map((line, i) => {
    const d = document.createElement('div');
    d.textContent = line || ' ';
    const l = part[i];
    if (l) {
      d.style.setProperty('--part', partColor(l) || 'var(--muted)');
      d.className = 'pl' + (Songs.MARK_RE.test(line.trim()) ? ' mk' : '') + (l === on ? ' on' : '');
    }
    return d;
  }));
  syncSongBack();
}

// Слой с полосами — той же ширины и прокрутки, что и поле
function syncSongBack() {
  const ta = $('songText');
  const inn = $('songBack').firstChild;
  inn.style.width = ta.clientWidth + 'px';
  inn.style.transform = `translateY(${-ta.scrollTop}px)`;
}

function songLink(part = '', occ = '', scroll = false) {
  songHot = { part, occ };
  const hit = (d) => !!part && d.part === part && (!occ || !d.occ || d.occ === String(occ));
  let first = null;
  document.querySelectorAll('#songPreview .sl, #arrOrder .part-chip, #arrParts .part-chip').forEach((el) => {
    const ok = hit(el.dataset);
    el.classList.toggle('hl', ok);
    if (ok && !first && el.classList.contains('sl')) first = el;
  });
  $('songPreview').classList.toggle('linking', !!part);
  if (scroll && first) first.scrollIntoView({ block: 'nearest' });
  paintSongText();
}

async function arrNew() {
  const name = await askName('Название аранжировки', songDraft.arrangements.length ? `Аранжировка ${songDraft.arrangements.length + 1}` : 'Основная');
  if (!name) return;
  // Новая начинается с того порядка, что сейчас на экране
  const p = Songs.parse($('songText').value);
  const a = curArr();
  const x = { id: newId(), name, order: a ? a.order.slice() : p.seq.slice() };
  songDraft.arrangements.push(x);
  songDraft.arr = x.id;
  updateSongView();
}

async function arrRename() {
  const a = curArr();
  const name = a && await askName('Название аранжировки', a.name);
  if (!name) return;
  a.name = name;
  updateSongView();
}

function arrCopy() {
  const a = curArr();
  if (!a) return;
  const x = { id: newId(), name: a.name + ' (копия)', order: a.order.slice() };
  songDraft.arrangements.push(x);
  songDraft.arr = x.id;
  updateSongView();
}

async function arrDelete() {
  const a = curArr();
  if (!a || !(await askYes(`Удалить аранжировку «${a.name}»? Текст песни не изменится.`, 'Удалить', true))) return;
  if (curArr() !== a) return; // пока спрашивали, окно песни поменялось
  songDraft.arrangements = songDraft.arrangements.filter((x) => x !== a);
  songDraft.arr = '';
  updateSongView();
}

// Переименовали обозначение в тексте ([Куплет 1] → [Куплет 1а]) — аранжировки следуют за ним
function followRenames(oldText, newText, arrangements) {
  const a = Songs.parse(oldText).blocks;
  const b = Songs.parse(newText).blocks;
  if (a.length !== b.length) return;
  const was = new Set(a.map((x) => x.label));
  const now = new Set(b.map((x) => x.label));
  const map = new Map();
  a.forEach((x, i) => { const y = b[i].label; if (x.label !== y && !now.has(x.label) && !was.has(y)) map.set(x.label, y); });
  if (map.size) arrangements.forEach((ar) => { ar.order = ar.order.map((l) => (map.has(l) ? map.get(l) : l)); });
}

function songSave() {
  const name = $('songName').value.trim();
  const text = $('songText').value.replace(/\s+$/, '');
  if (!name) { $('songName').focus(); return; }
  if (!Songs.parse(text).groups.size) { $('songText').focus(); return; }
  const song = { text, arrangements: songDraft.arrangements, arr: curArr() ? songDraft.arr : '' };
  if (songDraft.number) song.number = songDraft.number;
  const genre = $('songGenre').value.trim();
  if (genre) song.genre = genre;
  const ccli = $('songCcli').value.trim();
  if (ccli) song.ccli = ccli;
  const chords = $('songChords').value.replace(/\s+$/, '');
  if (chords.trim()) song.chords = chords; // аккорды для сценического экрана (stage.js)
  Songs.songMeta(song, { key: $('songKeyIn').value, tempo: $('songTempo').value, time: $('songTime').value }); // для телефонов группы
  if (songDraft.sheets.length) song.sheets = songDraft.sheets; // ноты для телефонов группы
  if (songEditing) {
    const first = !songEditing.song;
    if (!first) followRenames(songEditing.song.text, text, song.arrangements);
    songEditing.song = song;
    songEditing.name = name;
    songEditing.slides = Songs.build(song, songEditing.slides, first);
    touched(songEditing);
    renderService();
  } else {
    // Новая песня — в открытую библиотеку; если вдруг открыт плейлист — в первую библиотеку (работа не пропадёт)
    addItems([{ id: newId(), type: 'pres', kind: 'song', name, song, slides: Songs.build(song) }], true, 'rescue');
  }
  $('songDialog').close();
}

// Загрузить файл в открытое окно песни (первая песня из файла)
async function songLoadFile() {
  const files = await window.api.songsOpen();
  const songs = files.flatMap(readSongFile);
  if (!songs.length) { if (files.length) showNotice('В файле не нашлось текста песни', true); return; }
  const s = songs[0];
  if (!$('songName').value.trim() || !songEditing) $('songName').value = s.name;
  $('songText').value = s.song.text;
  if (s.song.genre) $('songGenre').value = s.song.genre;
  if (s.song.ccli) $('songCcli').value = s.song.ccli;
  if (s.song.chords) { $('songChords').value = s.song.chords; $('songChordsBox').open = true; }
  if (s.song.key) $('songKeyIn').value = s.song.key;
  if (s.song.tempo) $('songTempo').value = s.song.tempo;
  if (s.song.time) $('songTime').value = s.song.time;
  songDraft = { arrangements: s.song.arrangements, arr: '', number: s.song.number || '', sheets: songDraft.sheets };
  updateSongView();
  if (songs.length > 1) flashStatus(`В файле песен: ${songs.length}, открыта первая. Все сразу — кнопка «Импорт» над лентой.`);
}

// Экспорт того, что сейчас в окне (ещё не сохранённое тоже)
function songExportDraft() {
  const item = { name: $('songName').value.trim() || 'Песня', song: { text: $('songText').value, arrangements: songDraft.arrangements, arr: songDraft.arr, number: songDraft.number, genre: $('songGenre').value.trim(), ccli: $('songCcli').value.trim(), chords: $('songChords').value.trim() || undefined } };
  exportSongs([item]);
}

// Ноты (song.sheets): листы-картинки в userData\sheets — main.js делает их из фото и PDF; здесь — порядок и состав
function renderSongSheets() {
  const list = songDraft.sheets;
  $('songSheetsN').textContent = list.length ? `(листов: ${list.length})` : '';
  $('songSheets').replaceChildren(...list.map((x, i) => {
    const card = Object.assign(document.createElement('div'), { className: 'sheet-card' });
    const img = Object.assign(document.createElement('img'), { src: window.api.fileUrl(x.file), alt: '', loading: 'lazy', title: x.name });
    const name = Object.assign(document.createElement('span'), { textContent: x.name, title: x.name });
    name.dataset.noi18n = '';
    const bar = Object.assign(document.createElement('div'), { className: 'sc-btns' });
    const btn = (t, title, fn, off) => { const b = Object.assign(document.createElement('button'), { type: 'button', textContent: t, title, disabled: !!off }); b.onclick = fn; bar.append(b); };
    const move = (d) => { const [y] = list.splice(i, 1); list.splice(i + d, 0, y); renderSongSheets(); };
    btn('←', 'Раньше', () => move(-1), i === 0);
    btn('→', 'Позже', () => move(1), i === list.length - 1);
    btn('×', 'Убрать лист (до «Сохранить» — можно закрыть окно без сохранения)', () => { list.splice(i, 1); renderSongSheets(); });
    card.append(img, name, bar);
    return card;
  }));
}
$('songSheetsAdd').addEventListener('click', async () => {
  const r = await window.api.sheetsPick();
  if (!r) return;
  for (const x of r.sheets) if (!songDraft.sheets.some((y) => y.file === x.file)) songDraft.sheets.push(x);
  renderSongSheets();
  if (r.errors.length) showNotice('Не все файлы нот добавлены:\n' + r.errors.join('\n'), true);
  else if (r.sheets.length) flashStatus(`Ноты: добавлено листов — ${r.sheets.length}. Сохраните песню`);
});

$('songText').addEventListener('input', updateSongView);
// Курсор перешёл в другую часть — подсветка за ним
['keyup', 'mouseup', 'focus', 'select'].forEach((ev) => $('songText').addEventListener(ev, paintSongText));
$('songText').addEventListener('scroll', syncSongBack);
new ResizeObserver(syncSongBack).observe($('songText'));
// Наведение мыши: часть ↔ слайды
['songPreview', 'arrOrder', 'arrParts'].forEach((id) => {
  $(id).addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-part]');
    const part = el ? el.dataset.part : '';
    const occ = el && el.dataset.occ ? el.dataset.occ : '';
    if (part !== songHot.part || occ !== songHot.occ) songLink(part, occ, id !== 'songPreview');
  });
  $(id).addEventListener('mouseleave', () => songLink());
});
$('songText').addEventListener('keydown', (e) => {
  const combo = comboOf(e);
  if (!combo) return;
  if (combo === 'Ctrl+Digit0' || combo === 'Ctrl+Numpad0') { e.preventDefault(); unmarkPart(); return; }
  // Простые буквы — всегда текст (даже если в старых данных такая клавиша стоит у типа части)
  if (!e.ctrlKey && !e.altKey && !/^F\d+$/.test(e.code)) return;
  const t = partTypes().find((x) => x.key === combo);
  if (t) { e.preventDefault(); markPart(t); }
});
$('songSave').addEventListener('click', songSave);
// Аккорды: начать с текста песни и дописать аккорды над словами
$('songChordsFill').addEventListener('click', () => {
  if ($('songChords').value.trim()) { flashStatus('В поле аккордов уже есть текст — очистите его, чтобы взять текст песни заново'); return; }
  $('songChords').value = $('songText').value;
  $('songChords').focus();
});
// Аккорды из файла (ChordPro, txt, строки аккордов над словами) → на текст ЭТОЙ песни: текст не меняется, добавляются аккорды
async function songChordsFile() {
  const files = await window.api.songsOpen();
  const f = files.find((x) => x && x.bytes && !x.error);
  if (!f) return;
  const raw = decodeText(f.bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let src = '';
  const first = readSongFile(f)[0];
  if (first && first.song.chords) src = first.song.chords; // ChordPro: аккорды уже выделены
  else if (Chords.hasChords(raw)) src = raw;               // обычный текст со строками аккордов
  if (!src) { showNotice('В файле не нашлось аккордов', true); return; }
  const text = $('songText').value;
  if (!text.trim()) { $('songChords').value = src; $('songChordsBox').open = true; flashStatus('Текста песни ещё нет — аккорды загружены как есть'); return; }
  if ($('songChords').value.trim() && !(await askYes('В поле аккордов уже есть текст. Заменить его загруженными аккордами? Текст песни не изменится.', 'Заменить'))) return;
  const r = Chords.align(src, text);
  if (!r.exact && !r.fuzzy) { showNotice('Ни одна строка файла не похожа на текст песни — аккорды не загружены', true); return; }
  $('songChords').value = r.text;
  $('songChordsBox').open = true;
  if (first && first.song.key && !$('songKeyIn').value.trim()) $('songKeyIn').value = first.song.key;
  if (first && first.song.tempo && !$('songTempo').value.trim()) $('songTempo').value = first.song.tempo;
  if (first && first.song.time && !$('songTime').value.trim()) $('songTime').value = first.song.time;
  flashStatus(`Аккорды легли на ${r.exact + r.fuzzy} из ${r.total} строк текста${r.fuzzy ? ` (${r.fuzzy} — по похожести, проверьте)` : ''}${r.none ? `; без аккордов осталось ${r.none}` : ''}. Текст песни не менялся`);
}
$('songChordsLoad').addEventListener('click', songChordsFile);
$('songLoad').addEventListener('click', songLoadFile);
$('songExport').addEventListener('click', songExportDraft);
$('arrSel').addEventListener('change', () => { songDraft.arr = $('arrSel').value; updateSongView(); });
$('arrNew').addEventListener('click', arrNew);
$('arrRename').addEventListener('click', arrRename);
$('arrCopy').addEventListener('click', arrCopy);
$('arrDelete').addEventListener('click', arrDelete);
$('arrOrder').addEventListener('dragover', (e) => { if (curArr() && e.dataTransfer.types.includes(PART_DRAG)) { e.preventDefault(); $('arrOrder').classList.add('drop'); } });
$('arrOrder').addEventListener('dragleave', () => $('arrOrder').classList.remove('drop'));
$('arrOrder').addEventListener('drop', (e) => { $('arrOrder').classList.remove('drop'); arrDrop(e, null); });

/* ===== Песня в плейлисте: аранжировка, сверка со слайдами ===== */

// Слайды песни поменяли в обход окна песни (вызывается из touched и после редактора)
function songAbsorb(item) {
  if (Songs.absorb(item) === 'loose') flashStatus('Слайды песни изменены вручную — аранжировка пересоберёт их, когда смените её или сохраните текст');
}

// Слайды меняли вручную — сначала вопрос: тогда ответ — Promise (макрос его ждёт), иначе всё сразу
function setSongArr(item, arr) {
  const s = item.song;
  if (!s) return;
  if (s.loose) {
    return askYes('Собрать слайды заново по аранжировке? Слайды этой песни меняли вручную.', 'Собрать заново').then((ok) => {
      if (ok && item.song === s) applySongArr(item, arr);
      else renderService(); // выбор аранжировки в ленте — как было
    });
  }
  applySongArr(item, arr);
}
function applySongArr(item, arr) {
  const s = item.song;
  s.arr = arr;
  delete s.loose;
  item.slides = Songs.build(s, item.slides);
  saveLib();
  renderService();
  const a = Songs.arrOf(s);
  flashStatus(`«${item.name}»: ${a ? 'аранжировка «' + a.name + '»' : 'как в тексте'}`);
}

// Выбор аранжировки в заголовке песни в ленте
function songArrPick(item) {
  const s = item.song;
  if (!s || !(s.arrangements || []).length) return null;
  const sel = Object.assign(document.createElement('select'), { className: 'arr-pick', title: 'Аранжировка — порядок частей песни' });
  sel.append(new Option('Как в тексте', ''), ...s.arrangements.map((a) => new Option(a.name, a.id)));
  sel.value = Songs.arrOf(s) ? s.arr : '';
  ['mousedown', 'click', 'dblclick'].forEach((ev) => sel.addEventListener(ev, (e) => e.stopPropagation()));
  sel.addEventListener('change', () => setSongArr(item, sel.value));
  return sel;
}

const isSong = (item) => !!item.song || (item.kind === 'song' && item.slides.length > 0 && item.slides.every((s) => s.k === 'text'));

// Пункты меню песни (правая кнопка): изменить, аранжировки, экспорт
function songMenuItems(item, chosen) {
  if (!isSong(item)) return [];
  const s = item.song;
  const arrs = s ? s.arrangements || [] : [];
  const cur = s && Songs.arrOf(s);
  const songs = chosen.filter(isSong);
  return [
    { label: 'Изменить песню и аранжировки…', fn: () => openSongDialog(item) },
    ...(arrs.length ? [
      { label: (!cur ? '✓ ' : ' ') + 'Как в тексте', fn: () => setSongArr(item, '') },
      ...arrs.map((a) => ({ label: (cur === a ? '✓ ' : ' ') + 'Аранжировка «' + a.name + '»', fn: () => setSongArr(item, a.id) })),
    ] : []),
    { label: songs.length > 1 ? `Экспорт песен (${songs.length})…` : 'Экспорт песни…', fn: () => exportSongs(songs.length > 1 ? songs : [item]) },
    '-',
  ];
}

/* ===== Импорт и экспорт файлов ===== */

// Кодировка: UTF-16 по метке, иначе UTF-8, а если это не UTF-8 — старая русская Windows-1251
function decodeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1251').decode(b); }
}

function readSongFile(f) {
  if (f.error || !(f.bytes || f.db)) return [];
  // Другие программы (OpenLP, EasyWorship, ProPresenter, SongSelect) — songimport.js; не их формат — null
  try { const other = SongImport.read(f, decodeText); if (other) return other; } catch { /* дальше как текст */ }
  if (!f.bytes) return [];
  const text = decodeText(f.bytes);
  try { return f.ext === 'json' ? Songs.fromJson(JSON.parse(text)) : Songs.fromText(text, f.name, f.ext); } catch { return []; }
}

// other — окно выбора с базами и файлами других программ (OpenLP, EasyWorship, ProPresenter, SongSelect)
async function importSongs(other) {
  if (!findView()) { showNotice('Сначала создайте плейлист или библиотеку', true); return; }
  if (plNoCreate()) return; // песни импортируются только в библиотеку
  const files = await window.api.songsOpen({ other: other === true });
  if (!files.length) return;
  const many = files.some((f) => f.db && (f.db.songs || []).length > 50);
  if (many) showNotice('Импорт песен…');
  await new Promise((r) => setTimeout(r, 30)); // надпись успевает появиться
  const items = [];
  const bad = [];
  for (const f of files) {
    const songs = readSongFile(f);
    if (!songs.length) bad.push(f.name + (typeof f.error === 'string' ? ` (${f.error})` : ''));
    if (f.db && f.db.noWords) bad.push(`${f.name}: рядом нет SongWords.db — песни без слов не добавлены`);
    for (const s of songs) items.push({ id: newId(), type: 'pres', kind: 'song', name: s.name, song: s.song, slides: Songs.build(s.song) });
  }
  if (many) showNotice('');
  if (items.length) addItems(items, true);
  if (bad.length) showNotice((items.length ? `Импортировано песен: ${items.length}. ` : '') + 'Не получилось: ' + bad.join(', '), true);
  else flashStatus(`Импортировано песен: ${items.length}`);
}

async function exportSongs(items) {
  if (!items.length) return;
  if (items.length === 1) {
    const file = await window.api.songSave({ name: items[0].name, text: Songs.toText(items[0]), json: Songs.toJson(items) });
    if (file) flashStatus('Песня сохранена в файл');
    return;
  }
  const r = await window.api.songsSaveMany(items.map((it) => ({ name: it.name, text: Songs.toText(it) })));
  if (r) flashStatus(`Сохранено песен: ${r.n}`);
}


/* ===== Редактор типов частей ===== */

let ptWait = null; // id типа, которому ждём новую клавишу

function openPartTypes() {
  ptWait = null;
  $('ptMsg').textContent = '';
  renderPartTypes();
  $('partTypesDialog').showModal();
}

function partTypesChanged() {
  saveLib();
  renderPartTypes();
  if ($('songDialog').open) { renderPartBar(); updateSongView(); }
  renderService();
}

function renderPartTypes() {
  const types = partTypes();
  $('ptRows').replaceChildren(...types.map((t) => {
    const row = Object.assign(document.createElement('div'), { className: 'pt-row' });
    let pc = t.color || '#8b8d98';
    const color = ColorPicker.field(pc, null, (v) => { pc = v; }, { onClose: () => { if (pc !== t.color) { t.color = pc; partTypesChanged(); } } });
    color.title = 'Цвет части';
    const name = Object.assign(document.createElement('input'), { type: 'text', value: t.name, placeholder: 'Название, например Припев' });
    name.addEventListener('change', () => { if (name.value.trim()) t.name = name.value.trim(); partTypesChanged(); });
    const num = Object.assign(document.createElement('label'), { className: 'check', title: 'Сразу с номером: Куплет 1, Куплет 2… Без галочки: Припев, потом Припев 2' });
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!t.num });
    cb.addEventListener('change', () => { t.num = cb.checked; partTypesChanged(); });
    num.append(cb, document.createTextNode('с номером'));
    const waiting = ptWait === t.id;
    const key = Object.assign(document.createElement('button'), { className: 'key' + (waiting ? ' wait' : t.key ? '' : ' empty-key'), textContent: waiting ? 'Нажмите…' : t.key ? prettyCombo(t.key) : '—', title: 'Нажмите, затем нужное сочетание. Delete — убрать' });
    key.addEventListener('click', () => { ptWait = t.id; renderPartTypes(); });
    const del = Object.assign(document.createElement('button'), { textContent: '×', title: 'Удалить тип (в песнях обозначения останутся текстом)' });
    del.addEventListener('click', () => { lib.partTypes = types.filter((x) => x !== t); partTypesChanged(); });
    row.append(color, name, num, key, del);
    return row;
  }));
}

$('partTypesDialog').addEventListener('keydown', (e) => {
  if (!ptWait) return;
  e.preventDefault();
  e.stopPropagation();
  const t = partTypes().find((x) => x.id === ptWait);
  if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { ptWait = null; renderPartTypes(); return; }
  const combo = comboOf(e);
  if (!combo || !t) return;
  if (e.code === 'Delete' || e.code === 'Backspace') delete t.key;
  else {
    // Простые буквы нужны для набора текста — только с Ctrl или Alt, или F1–F12
    if (!e.ctrlKey && !e.altKey && !/^F\d+$/.test(e.code)) { $('ptMsg').textContent = 'Нужно сочетание с Ctrl или Alt (или F1–F12), иначе клавиша будет мешать набирать текст.'; return; }
    if (combo === 'Ctrl+Digit0' || combo === 'Ctrl+Numpad0') { $('ptMsg').textContent = 'Ctrl + 0 занято: убирает обозначение части.'; return; }
    for (const x of partTypes()) if (x.key === combo) delete x.key;
    t.key = combo;
  }
  $('ptMsg').textContent = '';
  ptWait = null;
  partTypesChanged();
}, true);
$('partTypesDialog').addEventListener('cancel', (e) => { if (ptWait) e.preventDefault(); });
$('partTypesDialog').addEventListener('close', () => { ptWait = null; });
// Ждём сочетание, а щёлкнули мимо кнопки (например, в название) — перестать ждать, иначе буквы не вводились бы.
// Без перерисовки строк: поле, по которому щёлкнули, должно остаться и получить фокус
$('partTypesDialog').addEventListener('pointerdown', (e) => {
  if (!ptWait || e.target.closest('#ptRows button.key')) return;
  const t = partTypes().find((x) => x.id === ptWait);
  ptWait = null;
  $('ptMsg').textContent = '';
  const b = $('ptRows').querySelector('button.key.wait');
  if (b) {
    b.classList.remove('wait');
    b.classList.toggle('empty-key', !(t && t.key));
    b.textContent = t && t.key ? prettyCombo(t.key) : '—';
  }
}, true);
$('ptAdd').addEventListener('click', () => {
  partTypes().push({ id: newId(), name: 'Новая часть', color: '#12a594', num: false });
  partTypesChanged();
  const rows = $('ptRows').querySelectorAll('input[type=text]');
  if (rows.length) rows[rows.length - 1].select();
});
$('ptReset').addEventListener('click', async () => {
  if (!(await askYes('Вернуть стандартные типы частей? Свои типы пропадут, обозначения в песнях останутся.', 'Вернуть', true))) return;
  lib.partTypes = defaultPartTypes();
  partTypesChanged();
});
