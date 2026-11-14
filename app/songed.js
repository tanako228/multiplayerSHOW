/* Песня с планшета (приложение группы): новая песня или текст, разметка частей и аранжировки уже существующей.
   Право — то же, что править аккорды и ноты (perms.chords). Нужна связь с программой: песню сохраняет окно оператора
   (POST /api/v1/songs/put → teamapi.js: putSong → team.js: onTeamSong), слайды собирает программа, как в своём окне песни.
   Текст — с разметкой, как в программе: строка [Куплет 1], [Припев]… начинает часть; пустая строка внутри части —
   новый слайд; [Припев] без текста — повторить припев. Кнопки частей — типы из программы (lib.partTypes, Store.types).
   Аранжировка — только порядок частей (по названию), текст не копируется; выбранная аранжировка — та, что пойдёт на экран.
   Общие функции ($, el, toast, ask, cur, online, canChords, runSync, openSong, renderList) — из app.js. */
'use strict';
const SongEd = (() => {
  const MARK_RE = /^\[([^\]\n]+)\]$/;
  const DEF_TYPES = [
    { name: 'Куплет', color: '#3b82f6', num: true }, { name: 'Припев', color: '#e5484d' }, { name: 'Бридж', color: '#8e4ec6' },
    { name: 'Вступление', color: '#46a758' }, { name: 'Завершение', color: '#f76b15' }, { name: 'Проигрыш', color: '#8b8d98' },
  ];
  let d = null;      // черновик: { id, name, text, arrs: [{ id, name, order }], arr }
  let sel = { a: 0, b: 0 }; // выделение в тексте (на планшете кнопка забирает фокус у поля)
  let busy = false;
  let tab = 1;
  let was = '';       // как было при открытии — спросить, если закрывают с правками

  const types = () => (Store.types && Store.types.length ? Store.types : DEF_TYPES);
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const baseName = (label) => String(label).replace(/\s*\(\d+\)$/, '').replace(/\s+\d+$/, '').trim().toLowerCase();
  const typeOf = (label) => { const b = baseName(label); return b ? types().find((t) => t.name.trim().toLowerCase() === b) || null : null; };
  const colorOf = (label) => { const t = typeOf(label); return (t && t.color) || ''; };

  // Как Songs.parse в программе: части по порядку, части с текстом по названию, порядок «как в тексте», предупреждения
  function parse(text) {
    const raw = [];
    let c = null;
    for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
      const m = line.trim().match(MARK_RE);
      if (m) { c = { label: m[1].trim(), lines: [] }; raw.push(c); continue; }
      if (!c) { c = { label: '', lines: [] }; raw.push(c); }
      c.lines.push(line);
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
  // Следующее обозначение: «Куплет 1», «Куплет 2»…; без нумерации — «Припев», потом «Припев 2»
  function nextLabel(lines, type, skip) {
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
  const curArr = () => d.arrs.find((a) => a.id === d.arr) || null;
  const order = (p) => { const a = curArr(); return a ? a.order.filter((l) => p.groups.has(l)) : p.seq; };

  /* ----- Открыть ----- */

  function open(id) {
    if (!canChords()) { toast('Добавлять и править песни разрешает оператор в окне «Группа»'); return; }
    const s = id ? Store.songs.get(id) : null;
    if (id && !s) { toast('Такой песни на телефоне нет'); return; }
    // Песня скачана старой программой — без текста с разметкой; сохранить её отсюда — потерять аранжировки
    if (s && typeof s.text !== 'string') { toast('У этой песни ещё нет текста для правки — обновите песни («…» → «Обновить песни») при связи с программой'); return; }
    // У песни есть несохранённая в программе правка с этого планшета — продолжить её
    if (s && Sheets.got('sg-' + s.id)) { openDraft('sg-' + s.id); return; }
    const nid = newId();
    fill({
      id: 'sg-' + (s ? s.id : nid), base: s ? s.id : '', nid,
      song: s ? { name: s.name, text: s.text, arrs: s.arrs || [], arr: s.arr || '', key: s.key || '', tempo: s.tempo || '', time: s.time || '', lib: '' }
        : { name: '', text: '', arrs: [], arr: '', key: '', tempo: '', time: '', lib: Store.libs.some((l) => l.id === $('libSel').value) ? $('libSel').value : (Store.libs[0] || {}).id || '' },
      chords: s ? (s.chords ? s.chords : null) : undefined,
      sheets: s ? (s.sheets || []).map((x) => ({ f: x.f, name: x.name })) : [],
    }, false);
  }
  // Черновик из «Не синхронизированные» (песня, сделанная или изменённая без связи)
  async function openDraft(id) {
    const r = Sheets.got(id);
    if (!r || !(r.sg || r.ext)) return;
    if (!canChords()) { toast('Добавлять и править песни разрешает оператор в окне «Группа»'); return; }
    if (r.sg) { fill(r, true); return; }
    // Пришла файлом или ссылкой (от другого планшета) — новая песня из неё; после «Сохранить» запись из файла убирается
    const s = r.song || {};
    // эта песня уже есть в программе — не вторую такую же, а аккорды и ноты на неё (или просто убрать запись)
    if (await Sheets.toTwin(id)) return;
    const nid = newId();
    fill({
      id: 'sg-' + nid, base: '', nid, from: r.id,
      song: { name: s.name || r.name, text: s.text || '', arrs: Array.isArray(s.arrs) ? s.arrs : [], arr: s.arr || '', key: s.key || '', tempo: s.tempo || '', time: s.time || '',
        lib: Store.libs.some((l) => l.id === $('libSel').value) ? $('libSel').value : (Store.libs[0] || {}).id || '' },
      chords: s.chords || undefined,
      sheets: (r.sheets || []).filter((x) => x.buf).map((x) => ({ name: x.name, type: x.type || 'image/jpeg', buf: x.buf })),
    }, false);
  }
  // r — запись черновика: { id, base, nid, song: { name, text, arrs, arr, key, tempo, time, lib }, chords, sheets }
  function fill(r, draft) {
    const s = r.song;
    d = { id: r.id, base: r.base || '', nid: r.nid, draft, from: r.from || '', text: s.text, arrs: JSON.parse(JSON.stringify(s.arrs || [])), arr: s.arr || '',
      chTouch: draft && typeof r.chords === 'string', shTouch: draft && Array.isArray(r.sheets) && !!r.shTouch,
      sheets: (Array.isArray(r.sheets) ? r.sheets : []).map((x) => ({ ...x, k: newId() })) };
    $('sgTitle').textContent = (d.base ? 'Изменить песню' : 'Новая песня') + (draft ? ' — ещё не в программе' : '');
    $('sgName').value = s.name || '';
    $('sgKey').value = s.key || '';
    $('sgTempo').value = s.tempo || '';
    $('sgTime').value = s.time || '';
    $('sgText').value = d.text;
    $('sgChords').value = typeof r.chords === 'string' && r.chords ? Chords.toRows(r.chords) : '';
    $('sgPasteBox').hidden = true;
    // Новая — в какую библиотеку (выбранная в списке песен — по умолчанию)
    $('sgLibBox').hidden = !!d.base || !Store.libs.length;
    $('sgLib').replaceChildren(...Store.libs.map((l) => Object.assign(el('option', '', l.name), { value: l.id })));
    if (!d.base && Store.libs.length) $('sgLib').value = Store.libs.some((l) => l.id === s.lib) ? s.lib : Store.libs[0].id;
    sel = { a: d.text.length, b: d.text.length };
    was = snap();
    paintBar();
    setTab(1);
    $('sgDlg').showModal();
    paint();
    paintSheets();
    if (!d.base && !draft) $('sgName').focus();
  }

  function setTab(n) {
    tab = n;
    $('sgDlg').dataset.tab = String(n);
    $('sgT1').setAttribute('aria-pressed', String(n === 1));
    $('sgT2').setAttribute('aria-pressed', String(n === 2));
    $('sgT12').setAttribute('aria-pressed', String(n !== 3));
    $('sgT3').setAttribute('aria-pressed', String(n === 3));
    if (n === 2) paint();
    if (n === 3) {
      // аккордов ещё нет — подставить текст песни: останется вписать аккорды строкой над словами
      if (!$('sgChords').value.trim()) $('sgChords').value = Chords.toRows(lyrics());
      paintKeys();
    }
  }

  /* ----- Аккорды и ноты ----- */

  // Текст песни для аккордов: части с обозначениями, без пустых повторов ([Припев] без текста)
  function lyrics() {
    const p = parse($('sgText').value);
    return p.blocks.filter((b) => b.slides.length).map((b) => (b.label ? `[${b.label}]\n` : '') + b.slides.join('\n\n')).join('\n\n');
  }
  // Быстрые аккорды в тональности песни: I ii iii IV V vi
  function paintKeys() {
    const k = $('sgKey').value.trim();
    const n = k ? Chords.interval('C', k) : 7; // нет тональности — G
    const flat = Chords.flatFor(k || 'G', 0, '');
    $('sgKeys').replaceChildren(...['C', 'Dm', 'Em', 'F', 'G', 'Am'].map((c) => Chords.shift(c, n, flat)).map((c) => {
      const b = el('button', '', c);
      b.type = 'button';
      b.dataset.noi18n = '';
      b.onclick = () => { const ta = $('sgChords'); ta.setRangeText(c, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); d.chTouch = true; };
      return b;
    }));
  }
  function fitPaste() {
    const src = $('sgPaste').value;
    if (!src.trim()) { toast('Сначала вставьте текст с аккордами'); return; }
    if (!Chords.hasChords(src)) { toast('Не вижу аккордов: они должны быть в [скобках] или строкой над словами'); return; }
    const r = Chords.align(src, lyrics());
    if (!r.exact && !r.fuzzy) { toast('Строки не похожи на текст этой песни — проверьте, что вставили ту же песню'); return; }
    $('sgChords').value = Chords.toRows(r.text);
    d.chTouch = true;
    $('sgPasteBox').hidden = true;
    toast(`Аккорды легли на ${r.exact + r.fuzzy} из ${r.total} строк — проверьте и поправьте при необходимости`);
  }
  // Аккорды для программы: строки аккордов над словами → [G]Сло[D]ва; без аккордов — пусто
  function chordsOut() {
    const t = Chords.toInline($('sgChords').value).replace(/\s+$/, '');
    return Chords.hasChords(t) ? t : '';
  }
  const urls = [];
  function paintSheets() {
    while (urls.length) URL.revokeObjectURL(urls.pop());
    const box = $('sgSheets');
    box.replaceChildren(...d.sheets.map((x, i) => {
      const t = el('div', 'sg-sh');
      const pic = el('div', 'sg-shp');
      if (x.type === 'application/pdf') pic.append(el('b', '', 'PDF'));
      else if (x.buf) { const u = URL.createObjectURL(new Blob([x.buf], { type: x.type || 'image/jpeg' })); urls.push(u); pic.style.backgroundImage = `url("${u}")`; }
      else if (x.f) Store.getRec('sheets', x.f).then((c) => { if (c && c.buf) { const u = URL.createObjectURL(new Blob([c.buf], { type: c.type })); urls.push(u); pic.style.backgroundImage = `url("${u}")`; } }).catch(() => {});
      const nm = el('span', 'sg-shn', x.name || 'Ноты');
      nm.dataset.noi18n = '';
      const bt = (s, lbl, fn, dis) => { const b = el('button', 'sg-mv', s); b.type = 'button'; b.setAttribute('aria-label', lbl); b.disabled = !!dis; b.onclick = fn; return b; };
      const row = el('div', 'sg-shb');
      row.append(
        bt('←', 'Раньше', () => { d.sheets.splice(i - 1, 0, d.sheets.splice(i, 1)[0]); d.shTouch = true; paintSheets(); }, i === 0),
        bt('→', 'Позже', () => { d.sheets.splice(i + 1, 0, d.sheets.splice(i, 1)[0]); d.shTouch = true; paintSheets(); }, i === d.sheets.length - 1),
        bt('×', 'Убрать лист', () => { d.sheets.splice(i, 1); d.shTouch = true; paintSheets(); }));
      t.append(pic, nm, row);
      return t;
    }));
    if (!d.sheets.length) box.append(el('p', 'hint', 'Нот пока нет. Сфотографируйте лист или выберите фото или PDF.'));
  }
  async function addSheets(files) {
    let n = 0;
    for (const f of files) {
      if (f.size > 30e6) { toast(`«${f.name}» больше 30 МБ — не добавлен`); continue; }
      const name = f.name.replace(/\.[^.]+$/, '') || 'Ноты';
      try {
        // PDF разберёт на страницы программа; фото — уменьшаем здесь
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) d.sheets.push({ name, type: 'application/pdf', buf: await f.arrayBuffer(), k: newId() });
        else {
          const s = atob(await Sheets.jpeg(f));
          const u = new Uint8Array(s.length);
          for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
          d.sheets.push({ name, type: 'image/jpeg', buf: u.buffer, k: newId() });
        }
        n++;
      } catch (e) { toast(e.message || `«${f.name}» не открылось`); }
    }
    if (n) { d.shTouch = true; paintSheets(); }
  }

  /* ----- Разметка частей ----- */

  function paintBar() {
    const bar = $('sgBar');
    bar.replaceChildren(...types().map((t) => {
      const b = el('button', 'sg-pt', t.name);
      b.type = 'button';
      b.dataset.noi18n = '';
      if (t.color) b.style.setProperty('--part', t.color);
      b.onclick = () => mark(t);
      return b;
    }));
    const other = el('button', 'sg-pt', 'Другая…');
    other.type = 'button';
    other.onclick = async () => { const n = await askName('Название части', ''); if (n) mark({ name: n.replace(/[[\]]/g, ''), num: false }); };
    const un = el('button', 'sg-pt sg-un', 'Убрать');
    un.type = 'button';
    un.onclick = unmark;
    bar.append(other, un);
  }
  function keepSel() { const ta = $('sgText'); sel = { a: ta.selectionStart, b: ta.selectionEnd }; }
  // Строка, с которой начинается выделение; mark — строка обозначения этой части (курсор на ней или сразу под ней)
  function lineAt() {
    const ta = $('sgText');
    const v = ta.value;
    const lines = v.split('\n');
    const a = Math.min(sel.a, v.length);
    const b = Math.min(sel.b, v.length);
    let li = v.slice(0, a).split('\n').length - 1;
    const last = v.slice(0, Math.max(a, b - 1)).split('\n').length - 1;
    while (li < last && !lines[li].trim()) li++;
    let mk = -1;
    if (MARK_RE.test(lines[li].trim())) mk = li;
    else if (li > 0 && MARK_RE.test(lines[li - 1].trim())) mk = li - 1;
    const off = (i) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    return { ta, lines, li, mk, off };
  }
  function mark(type) {
    const { ta, lines, li, mk, off } = lineAt();
    const label = nextLabel(lines, type, mk);
    if (mk >= 0) ta.setRangeText(`[${label}]`, off(mk), off(mk) + lines[mk].length, 'end');
    else {
      // перед новой частью — пустая строка, чтобы текст было легко читать
      const gap = li > 0 && lines[li - 1].trim() ? '\n' : '';
      ta.setRangeText(`${gap}[${label}]\n`, off(li), off(li), 'end');
    }
    const at = ta.selectionEnd;
    sel = { a: at, b: at };
    focusAt(at);
    changed();
  }
  function unmark() {
    const { ta, lines, mk, off } = lineAt();
    if (mk < 0) { toast('Поставьте курсор на строку с обозначением части или сразу под ней'); return; }
    ta.setRangeText('', off(mk), Math.min(ta.value.length, off(mk) + lines[mk].length + 1), 'start');
    sel = { a: off(mk), b: off(mk) };
    focusAt(off(mk));
    changed();
  }
  function focusAt(at) {
    const ta = $('sgText');
    try { ta.focus({ preventScroll: true }); ta.setSelectionRange(at, at); } catch { /* старый браузер */ }
  }
  // Переименовали обозначение в тексте ([Куплет 1] → [Куплет 1а]) — аранжировки следуют за ним (как в программе)
  function followRenames(oldText, newText) {
    const a = parse(oldText).blocks;
    const b = parse(newText).blocks;
    if (a.length !== b.length) return;
    const was = new Set(a.map((x) => x.label));
    const now = new Set(b.map((x) => x.label));
    const map = new Map();
    a.forEach((x, i) => { const y = b[i].label; if (x.label !== y && !now.has(x.label) && !was.has(y)) map.set(x.label, y); });
    if (map.size) d.arrs.forEach((ar) => { ar.order = ar.order.map((l) => (map.has(l) ? map.get(l) : l)); });
  }
  function changed() {
    const t = $('sgText').value;
    followRenames(d.text, t);
    d.text = t;
    paint();
  }

  /* ----- Части и аранжировки ----- */

  function chip(label, missing) {
    const c = el('span', 'sg-chip' + (missing ? ' missing' : ''), label || 'Без обозначения');
    c.dataset.noi18n = '';
    const col = colorOf(label);
    if (col) c.style.setProperty('--part', col);
    return c;
  }
  function paint() {
    const p = parse($('sgText').value);
    const a = curArr();
    // Слайдов по выбранной аранжировке
    const n = order(p).reduce((k, l) => k + p.groups.get(l).slides.length, 0);
    $('sgCount').textContent = n ? `Частей: ${p.groups.size} · слайдов: ${n}` + (a ? ` — «${a.name}»` : '') : 'Впишите текст песни и обозначьте части';
    $('sgWarn').textContent = p.warnings.join(' ');
    $('sgWarn').hidden = !p.warnings.length;
    // Выбор аранжировки
    const s = $('sgArr');
    s.replaceChildren(Object.assign(el('option', '', 'Как в тексте'), { value: '' }), ...d.arrs.map((x) => { const o = el('option', '', x.name); o.value = x.id; o.dataset.noi18n = ''; return o; }));
    s.value = a ? a.id : '';
    $('sgArrRen').disabled = !a;
    $('sgArrCopy').disabled = !a;
    $('sgArrDel').disabled = !a;
    // Части песни: нажать — в конец порядка
    const box = $('sgChips');
    box.replaceChildren(...[...p.groups.keys()].map((label) => {
      const c = chip(label);
      c.setAttribute('role', 'button');
      c.tabIndex = 0;
      c.classList.toggle('off', !a);
      c.onclick = () => {
        if (!a) { toast('Сначала создайте аранжировку: «＋ Новая»'); return; }
        a.order.push(label);
        paint();
        const rows = $('sgOrder').querySelectorAll('.sg-row');
        if (rows.length) rows[rows.length - 1].scrollIntoView({ block: 'nearest' });
      };
      return c;
    }));
    if (!p.groups.size) box.append(el('span', 'hint', 'Обозначьте части в тексте — они появятся здесь'));
    // Порядок исполнения: ↑ ↓ ×
    const list = a ? a.order : p.seq;
    const ord = $('sgOrder');
    ord.replaceChildren(...list.map((label, i) => {
      const row = el('div', 'sg-row');
      row.append(el('span', 'sg-n', String(i + 1)), chip(label, !p.groups.has(label)));
      if (a) {
        const bt = (t, lbl, fn, dis) => { const b = el('button', 'sg-mv', t); b.type = 'button'; b.setAttribute('aria-label', lbl); b.disabled = !!dis; b.onclick = fn; return b; };
        row.append(
          bt('↑', 'Выше', () => { a.order.splice(i - 1, 0, a.order.splice(i, 1)[0]); paint(); }, i === 0),
          bt('↓', 'Ниже', () => { a.order.splice(i + 1, 0, a.order.splice(i, 1)[0]); paint(); }, i === list.length - 1),
          bt('⧉', 'Повторить', () => { a.order.splice(i + 1, 0, label); paint(); }),
          bt('×', 'Убрать из аранжировки', () => { a.order.splice(i, 1); paint(); }));
      }
      return row;
    }));
    if (!list.length) ord.append(el('p', 'hint', a ? 'Нажимайте части выше — они встанут сюда по порядку' : 'Пока пусто'));
    $('sgArrHint').textContent = a ? 'Части можно повторять (⧉), двигать (↑ ↓) и убирать (×). Текст песни при этом не меняется. На экран пойдёт выбранная аранжировка.'
      : 'Слайды идут как в тексте. «＋ Новая» — свой порядок частей (например, припев после каждого куплета); текст не копируется.';
  }

  async function arrNew() {
    const name = await askName('Название аранжировки', d.arrs.length ? `Аранжировка ${d.arrs.length + 1}` : 'Основная');
    if (!name) return;
    const p = parse($('sgText').value);
    const a = curArr();
    const x = { id: newId(), name, order: a ? a.order.slice() : p.seq.slice() };
    d.arrs.push(x);
    d.arr = x.id;
    paint();
  }
  async function arrRen() {
    const a = curArr();
    const name = a && await askName('Название аранжировки', a.name);
    if (!name) return;
    a.name = name;
    paint();
  }
  function arrCopy() {
    const a = curArr();
    if (!a) return;
    const x = { id: newId(), name: a.name + ' (копия)', order: a.order.slice() };
    d.arrs.push(x);
    d.arr = x.id;
    paint();
  }
  async function arrDel() {
    const a = curArr();
    if (!a || !(await ask(`Удалить аранжировку «${a.name}»? Текст песни не изменится.`, 'Удалить'))) return;
    d.arrs = d.arrs.filter((x) => x !== a);
    d.arr = '';
    paint();
  }
  // Название (аранжировки, своей части)
  function askName(title, value) {
    return new Promise((resolve) => {
      const dl = $('sgNameDlg');
      $('sgNameH').textContent = title;
      $('sgNameIn').value = value || '';
      const done = (v) => { dl.close(); $('sgNameOk').onclick = $('sgNameNo').onclick = $('sgNameIn').onkeydown = null; resolve(v); };
      $('sgNameOk').onclick = () => done($('sgNameIn').value.trim());
      $('sgNameNo').onclick = () => done('');
      $('sgNameIn').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done($('sgNameIn').value.trim()); } };
      dl.oncancel = () => done('');
      dl.showModal();
      $('sgNameIn').focus();
      $('sgNameIn').select();
    });
  }

  /* ----- Сохранить: на связи — сразу в программу; без связи — черновик в «Не синхронизированные» ----- */

  // Запись черновика из окна. chords: undefined / null — не трогать (у новой песни — нет аккордов); sheets: null — не трогать
  function record() {
    const a = curArr();
    const ch = chordsOut();
    return {
      id: d.id, sg: true, pend: true, mine: true, base: d.base, nid: d.nid, who: Store.me ? Store.me.person.name : '',
      name: $('sgName').value.trim(), at: Date.now(),
      song: { name: $('sgName').value.trim(), text: $('sgText').value.replace(/\s+$/, ''), arrs: d.arrs, arr: a ? a.id : '',
        key: $('sgKey').value.trim(), tempo: Number($('sgTempo').value) || '', time: $('sgTime').value.trim(), lib: d.base ? '' : $('sgLib').value },
      chords: d.base ? (d.chTouch ? ch : null) : ch || undefined,
      sheets: d.base && !d.shTouch ? null : d.sheets.map(({ k, ...x }) => x),
      shTouch: !!d.shTouch,
    };
  }
  // В программу (и из Sheets.flush — когда телефон подключился). Ответ { id }
  let lastSend = 0;
  async function send(r) {
    const wait = 900 - (Date.now() - lastSend); // программа принимает песню с одного телефона не чаще раза в 0,8 с
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    const s = r.song;
    const body = { id: r.base || '', nid: r.nid, lib: s.lib || '', name: s.name, text: s.text, arrs: s.arrs, arr: s.arr, key: s.key, tempo: Number(s.tempo) || 0, time: s.time };
    if (typeof r.chords === 'string') body.chords = r.chords;
    if (Array.isArray(r.sheets) && (r.base || r.sheets.length)) {
      body.sheets = [];
      for (const x of r.sheets) body.sheets.push(x.f ? { f: x.f, name: x.name } : { name: x.name, data: await Sheets.b64(new Blob([x.buf])) });
    }
    try { return await Store.api('/songs/put', { method: 'POST', body, timeout: 240000 }); } finally { lastSend = Date.now(); }
  }
  async function save() {
    if (busy || !d) return;
    const name = $('sgName').value.trim();
    const text = $('sgText').value.replace(/\s+$/, '');
    if (!name) { toast('Впишите название песни'); setTab(1); $('sgName').focus(); return; }
    if (!parse(text).groups.size) { toast('Впишите текст песни'); setTab(1); $('sgText').focus(); return; }
    if (!canChords()) { toast('Право править песни снято — песня не сохранена'); return; }
    const r = record();
    busy = true;
    $('sgSave').disabled = true;
    try {
      if (online()) {
        try {
          const res = await send(r);
          if (d.draft || Sheets.got(r.id)) await Sheets.delExt(r.id); // черновик больше не нужен
          if (d.from) await Sheets.delExt(d.from); // песня из файла теперь в программе
          window.renderExt && window.renderExt();
          $('sgDlg').close();
          toast(r.base ? 'Песня сохранена в программе' : 'Песня добавлена в программу');
          await runSync();
          await Sheets.prefetch();
          const id = (res && res.id) || r.base;
          if (id && Store.songs.get(id)) {
            if (screen === 'Song' && cur && (cur.id === id || cur.id === r.id || cur.tmp)) { const y = window.scrollY; openSong(id, false, { pl: cur.pl, eid: cur.eid, key: cur.key }); window.scrollTo(0, y); } else if (!r.base) openSong(id, true);
          } else if (typeof renderList === 'function') renderList();
          return;
        } catch (e) {
          if (e.code !== 'net') { toast(e.message || 'Не получилось сохранить песню'); return; }
        }
      }
      // Нет связи: песня ждёт на планшете и уйдёт в программу сама, когда он подключится (Sheets.flush)
      try { await Sheets.keepRec(r); } catch (e) { toast(e.message || 'Не хватило места на телефоне'); return; }
      if (d.from) { await Sheets.delExt(d.from); window.renderExt && window.renderExt(); } // вместо записи из файла — черновик
      $('sgDlg').close();
      const lib = !r.base && (Store.libs.find((l) => l.id === r.song.lib) || {}).name;
      toast(`Нет связи — песня в «Не синхронизированные». Уйдёт ${lib ? `в библиотеку «${lib}»` : 'в программу'}, когда телефон подключится`);
      if (screen !== 'Lib' && typeof closeSong === 'function' && cur && cur.tmp) closeSong();
    } finally {
      busy = false;
      $('sgSave').disabled = false;
    }
  }
  const snap = () => JSON.stringify([$('sgName').value, $('sgText').value, $('sgKey').value, $('sgTempo').value, $('sgTime').value, $('sgLib').value, d.arrs, d.arr,
    d.chTouch ? $('sgChords').value : '', d.sheets.map((x) => x.k)]);
  async function close() {
    if (d && snap() !== was && !(await ask('Закрыть без сохранения? Изменения пропадут.', 'Закрыть'))) return;
    $('sgDlg').close();
  }

  function init() {
    $('sgX').onclick = close;
    $('sgDlg').addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    $('sgT1').onclick = () => setTab(1);
    $('sgT2').onclick = () => setTab(2);
    const ta = $('sgText');
    for (const ev of ['select', 'keyup', 'mouseup', 'touchend', 'blur', 'input']) ta.addEventListener(ev, keepSel);
    document.addEventListener('selectionchange', () => { if (document.activeElement === ta) keepSel(); });
    ta.addEventListener('input', changed);
    $('sgArr').onchange = () => { d.arr = $('sgArr').value; paint(); };
    $('sgArrNew').onclick = arrNew;
    $('sgArrRen').onclick = arrRen;
    $('sgArrCopy').onclick = arrCopy;
    $('sgArrDel').onclick = arrDel;
    $('sgSave').onclick = save;
    $('sgT12').onclick = () => setTab(1);
    $('sgT3').onclick = () => setTab(3);
    $('sgChords').addEventListener('input', () => { d.chTouch = true; });
    $('sgChText').onclick = async () => {
      if (chordsOut() && !(await ask('Заменить аккорды текстом песни без аккордов?', 'Заменить'))) return;
      $('sgChords').value = Chords.toRows(lyrics());
      d.chTouch = true;
    };
    $('sgChPaste').onclick = () => { $('sgPasteBox').hidden = false; $('sgPaste').value = ''; $('sgPaste').focus(); };
    $('sgPasteNo').onclick = () => { $('sgPasteBox').hidden = true; };
    $('sgFit').onclick = fitPaste;
    $('sgChClear').onclick = async () => {
      if (chordsOut() && !(await ask('Убрать все аккорды этой песни?', 'Убрать'))) return;
      $('sgChords').value = Chords.toRows(lyrics());
      d.chTouch = true;
      toast('Аккордов нет — в песне останется только текст');
    };
    $('sgKey').addEventListener('change', () => { if (tab === 3) paintKeys(); });
    $('sgShAdd').onclick = () => $('sgShFile').click();
    $('sgShFile').onchange = () => { const l = [...$('sgShFile').files]; $('sgShFile').value = ''; addSheets(l); };
  }

  return { init, open, openDraft, send, parse };
})();
