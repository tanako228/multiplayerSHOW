/* ===== Служение: кнопка «Служение ▾» в строке вкладок =====
   1) «Проверка перед служением» (svcCheck) — видео и картинки на месте, мониторы подключены, шрифты есть, Библия загружена.
   2) «Плашки и бегущая строка» (ltOpen) — шаблоны lib.lowerThirds (в HIST_KEYS — Ctrl+Z работает),
      показ — слой «Плашки» (LAYER_KINDS.lower, как Overlay: слайд на экране не сбивается), content.type 'lower'.
   3) «Библия по голосу» — voice.js. */

const svEl = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svBtn = (text, fn, cls, icon) => { const b = svEl('button', cls || '', text); b.type = 'button'; if (icon) b.dataset.icon = icon; b.addEventListener('click', fn); return b; };

(() => {
  const css = svEl('style');
  css.textContent = `
    .sv-dlg { width: min(860px, 94vw); }
    .sv-dlg .dlg-body { max-height: 70vh; }
    .sv-grid { display: grid; grid-template-columns: 250px 1fr; gap: 14px; min-height: 360px; }
    .sv-list { display: flex; flex-direction: column; gap: 4px; border-right: 1px solid var(--line); padding-right: 12px; overflow-y: auto; max-height: 62vh; }
    .sv-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: calc(6px * var(--rk, 1)); cursor: pointer; border: 1px solid transparent; }
    .sv-item:hover { background: var(--field); }
    .sv-item.sel { border-color: var(--line); background: var(--field); }
    .sv-item.on { box-shadow: inset 3px 0 0 var(--live); }
    .sv-item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sv-item small { color: var(--muted); }
    .sv-form { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .sv-row { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 10px; }
    .sv-row > span:first-child { color: var(--muted); font-size: 13px; }
    .sv-row input[type=text], .sv-row input[type=number], .sv-row input[type=time], .sv-row select, .sv-row textarea { width: 100%; box-sizing: border-box; }
    .sv-row textarea { min-height: 54px; resize: vertical; font: inherit; }
    .sv-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sv-sub { font-weight: 600; margin-top: 6px; }
    .sv-prev { position: relative; aspect-ratio: 16 / 9; width: 100%; max-width: 440px; background: #000 linear-gradient(135deg, #1b2533, #0b0f16); border-radius: calc(6px * var(--rk, 1)); overflow: hidden; border: 1px solid var(--line); }
    .sv-prev > .slot, .sv-prev > .layer { position: absolute; inset: 0; }
    .sv-live { color: var(--live); font-weight: 600; }
    .sv-chk { display: flex; flex-direction: column; gap: 10px; }
    .sv-chk .grp { border: 1px solid var(--line); border-radius: calc(8px * var(--rk, 1)); padding: 10px 12px; }
    .sv-chk .grp h3 { margin: 0 0 6px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
    .sv-chk .st { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; flex: none; }
    .sv-chk .st.ok { background: #2fa36b; } .sv-chk .st.warn { background: #d99a0c; } .sv-chk .st.bad { background: #d6453d; }
    .sv-chk ul { margin: 4px 0 0; padding-left: 26px; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .sv-chk li b { color: var(--text); font-weight: 500; }
    .sv-chk li button { margin-left: 6px; font-size: 12px; padding: 1px 8px; }
    .sv-sum { font-size: 15px; font-weight: 600; }
    .sv-files { color: var(--muted); font-size: 12px; }
  `;
  document.head.append(css);
})();

// Окно-диалог, общее устройство: заголовок, тело, низ. Строится один раз
function svDialog(id, title, cls = '') {
  let d = document.getElementById(id);
  if (d) return d;
  d = svEl('dialog', 'sv-dlg ' + cls);
  d.id = id;
  const head = svEl('div', 'dlg-head');
  head.append(svEl('h2', '', title), svEl('span', 'spacer'));
  const x = svBtn('×', () => d.close(), 'dlg-x');
  x.title = 'Закрыть';
  head.append(x);
  d.append(head, svEl('div', 'dlg-body'), svEl('div', 'dlg-foot'));
  document.body.append(d);
  return d;
}
const svRow = (label, ...ctl) => { const r = svEl('label', 'sv-row'); const box = svEl('span', 'sv-line'); box.append(...ctl); r.append(svEl('span', '', label), box); return r; };
const svInput = (type, value, on, attrs = {}) => {
  const i = svEl('input');
  i.type = type;
  i.value = value == null ? '' : value;
  Object.assign(i, attrs);
  i.addEventListener(type === 'range' ? 'input' : 'change', () => on(type === 'number' || type === 'range' ? Number(i.value) : i.value));
  return i;
};
const svSelect = (opts, value, on) => {
  const s = svEl('select');
  for (const [v, t] of opts) s.append(Object.assign(svEl('option', '', t), { value: v }));
  s.value = value;
  s.addEventListener('change', () => on(s.value));
  return s;
};
const svCheckbox = (text, checked, on) => {
  const l = svEl('label', 'check');
  const c = svEl('input');
  c.type = 'checkbox';
  c.checked = !!checked;
  c.addEventListener('change', () => on(c.checked));
  l.append(c, document.createTextNode(text));
  return l;
};
// Путь файла из file:/// адреса (у старых слайдов может не быть path)
function svPathOf(x) {
  if (!x) return '';
  if (x.path) return x.path;
  const u = String(x.url || '');
  if (!/^file:/i.test(u)) return '';
  try { return decodeURIComponent(u.replace(/^file:\/\/\/?/i, '')).replace(/\//g, '\\'); } catch { return ''; }
}

/* ---------- Меню «Служение ▾» ---------- */
function svcMenu() {
  const r = $('svcOpen').getBoundingClientRect();
  showMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
    { label: 'Проверка перед служением', fn: svcCheck, icon: 'check' },
    { label: 'Плашки и бегущая строка…', fn: ltOpen, icon: 'lowerthird' },
  ]);
  ctxMenu.dataset.tag = 'svc';
}
$('svcOpen').addEventListener('click', () => { if (!(menuClosed.tag === 'svc' && Date.now() - menuClosed.t < 400)) svcMenu(); });

/* ===================== Проверка перед служением ===================== */

// Все медиафайлы, которые могут понадобиться: рабочий плейлист (лента), темы (фон, Media Action, картинки, видео);
// где встречается — для подписи
function svcMediaUse() {
  const out = [];
  const add = (x, where, kind) => { const p = svPathOf(x); if (p) out.push({ path: p, name: x.name || p.split(/[\\/]/).pop(), where, kind }); };
  const used = new Set();
  for (const { item } of workEntries()) {
    for (const s of item.slides || []) {
      if (['image', 'video', 'audio'].includes(s.k)) add(s, item.name, s.k);
      if (s.theme) used.add(s.theme);
      for (const e of s.elements || []) if (e.url || e.path) add(e, item.name, 'image');
      for (const o of (s.look && s.look.objs) || []) if (o.url || o.path) add(o, item.name + ' (вид слайда)', o.kind);
    }
    if (item.theme) used.add(item.theme);
  }
  for (const id of Object.values(lib.themeFor || {})) if (id) used.add(id);
  for (const t of lib.themes || []) {
    if (!used.has(t.id)) continue;
    for (const tpl of t.templates || []) {
      if (tpl.bg && (tpl.bg.type === 'image' || tpl.bg.type === 'video')) add(tpl.bg, `тема «${t.name}»`, tpl.bg.type);
      if (tpl.media) add(tpl.media, `тема «${t.name}»`, tpl.media.type);
      for (const o of tpl.objs || []) if ((o.kind === 'image' || o.kind === 'video') && (o.url || o.path)) add(o, `тема «${t.name}»`, o.kind);
    }
    if (t.style && t.style.bgUrl) add({ url: t.style.bgUrl }, `тема «${t.name}»`, t.style.bgVideo ? 'video' : 'image');
  }
  // Один файл — одна строка
  const seen = new Map();
  for (const x of out) { const k = x.path.toLowerCase(); if (!seen.has(k)) seen.set(k, { ...x, places: [x.where] }); else if (!seen.get(k).places.includes(x.where)) seen.get(k).places.push(x.where); }
  return [...seen.values()];
}

// Шрифты, которые нужны темам рабочего плейлиста и плашкам
function svcFontsUse() {
  const fonts = new Map();
  const add = (f, where) => { if (!f) return; const k = String(f); if (!fonts.has(k)) fonts.set(k, new Set()); fonts.get(k).add(where); };
  const used = new Set(Object.values(lib.themeFor || {}).filter(Boolean));
  for (const { item } of workEntries()) {
    if (item.theme) used.add(item.theme);
    for (const s of item.slides || []) {
      if (s.theme) used.add(s.theme);
      for (const o of (s.look && s.look.objs) || []) if (o.kind === 'text') add(o.font, item.name);
      for (const e of s.elements || []) if (e.font) add(e.font, item.name);
    }
  }
  for (const t of lib.themes || []) {
    if (!used.has(t.id)) continue;
    if (t.style) add(t.style.font, `тема «${t.name}»`);
    for (const tpl of t.templates || []) for (const o of tpl.objs || []) if (o.kind === 'text') add(o.font, `тема «${t.name}»`);
  }
  for (const p of lib.lowerThirds || []) add(p.font, `плашка «${p.name}»`);
  return fonts;
}

async function svcCheck() {
  const d = svDialog('svcCheckDialog', 'Проверка перед служением');
  const body = d.querySelector('.dlg-body');
  const foot = d.querySelector('.dlg-foot');
  body.replaceChildren(svEl('p', 'hint', 'Проверяю…'));
  foot.replaceChildren(svEl('span', 'spacer'), svBtn('Проверить ещё раз', svcCheck), svBtn('Готово', () => d.close(), 'primary'));
  if (!d.open) d.showModal();
  const groups = [];
  const grp = (title, icon) => { const g = { title, icon, items: [], level: 'ok' }; groups.push(g); return g; };
  const note = (g, level, html, btn) => { g.items.push({ level, html, btn }); if (level === 'bad' || (level === 'warn' && g.level === 'ok')) g.level = level; };

  // 1. Файлы
  const media = svcMediaUse();
  const have = media.length ? await window.api.filesCheck(media.map((m) => m.path)) : [];
  const gf = grp('Видео, картинки и музыка', 'video');
  const lost = media.filter((m, i) => !have[i]);
  if (!media.length) note(gf, 'ok', 'В плейлисте и темах нет файлов с диска.');
  else if (!lost.length) note(gf, 'ok', `Все файлы на месте: ${media.length}.`);
  for (const m of lost.slice(0, 30)) note(gf, 'bad', `Нет файла <b>${escapeHtml(m.name)}</b> — ${escapeHtml(m.places.join(', '))}<div class="sv-files">${escapeHtml(m.path)}</div>`);
  if (lost.length > 30) note(gf, 'bad', `…и ещё ${lost.length - 30}`);

  // 2. Мониторы и выходы
  const gm = grp('Мониторы и вывод', 'output');
  const ext = displays.filter((x) => !x.here);
  if (displays.length < 2) note(gm, 'bad', 'Подключён только один монитор — выводить в зал некуда. Проверьте кабель проектора/телевизора и «Расширить» в Windows (Win+P).');
  const md = dispFind(settings.outDisplay, settings.outDisplayKey);
  if (displays.length >= 2) {
    if (!md) note(gm, 'bad', 'Монитор зала («Основной») не найден. Выберите его: Редактор → Редактор сцен → «Основной».', { text: 'Открыть', fn: () => { d.close(); if (typeof openScreensTab === 'function') openScreensTab(); } });
    else if (md.here) note(gm, 'bad', `Для зала выбран монитор с окном программы (${escapeHtml(md.label)}). Выберите другой.`);
    else note(gm, 'ok', `Зал: <b>${escapeHtml(md.label)}</b>`);
  }
  if (!mainOutOn()) note(gm, 'warn', 'Вывод в зал выключен — включите галочку «Зал» над «Предпросмотром» (F9).');
  for (const z of [...(lib.screens || []), ...(lib.scenes || [])]) {
    const on = z.id === 'main' ? mainOutOn() : (lib.scenes || []).includes(z) ? !!z.on : !!z.enabled;
    for (const o of z.outputs || []) {
      if (!o || o.off || o.kind !== 'display' || !on) continue;
      const dd = dispFind(o.display, o.dkey);
      const nm = ((lib.scenes || []).includes(z) ? 'Сцена' : 'Экран') + ` «${escapeHtml(z.name)}»`;
      if (!dd) note(gm, 'bad', `${nm}: монитор не подключён.`);
      else if (dd.here) note(gm, 'warn', `${nm}: выбран монитор с окном программы — не откроется.`);
      else note(gm, 'ok', `${nm}: ${escapeHtml(dd.label)}.`);
    }
  }
  if (!ext.length && displays.length >= 2) note(gm, 'warn', 'Все мониторы заняты окном программы.');

  // 3. Шрифты
  const gs = grp('Шрифты', 'text');
  const sys = await window.api.fontsSystem().catch(() => []);
  const fams = new Set([...(sys || []), ...Scene.fontsList().map((f) => f.family)].map((s) => String(s).toLowerCase()));
  const need = svcFontsUse();
  const missFont = [];
  for (const [f, where] of need) {
    const fam = Scene.FONT_NAMES[f] || f;
    if (!sys.length && Scene.FONT_NAMES[f]) continue; // список шрифтов Windows не получили — встроенные считаем есть
    if (!fams.has(String(fam).toLowerCase())) missFont.push([fam, [...where]]);
  }
  if (!sys.length) note(gs, 'warn', 'Не удалось получить список шрифтов Windows — проверены только свои шрифты программы.');
  if (!missFont.length) note(gs, 'ok', `Все шрифты есть: ${need.size}.`);
  for (const [fam, where] of missFont) note(gs, 'bad', `Нет шрифта <b>${escapeHtml(fam)}</b> — ${escapeHtml(where.slice(0, 4).join(', '))}. Текст покажется другим шрифтом. Добавить: Редактор тем → шрифт → «Свой файл…».`);

  // 4. Библия
  const gb = grp('Библия', 'bible');
  if (!bibleIndex.length) note(gb, 'bad', 'Нет ни одного перевода Библии.', { text: 'Добавить перевод', fn: () => { d.close(); pickBibles(); } });
  else if (!bible || !bible.books || !bible.books.length) note(gb, 'bad', 'Перевод не загрузился — откройте вкладку «Библия» и выберите перевод.');
  else {
    note(gb, 'ok', `Открыт перевод «${escapeHtml(typeof trLabel === 'function' ? trLabel(bibleIndex.find((t) => t.id === bible.id) || { name: bible.name }) : bible.name)}»: книг ${bible.books.length}.`);
    for (const [i, s] of (settings.bSlots || []).entries()) {
      if (!i || !s.id) continue;
      if (!bibleIndex.some((t) => t.id === s.id)) note(gb, 'warn', `Перевод в строке ${i + 1} окна «Библия» удалён — строка не покажется.`);
    }
  }

  // Итог
  const bad = groups.filter((g) => g.level === 'bad').length;
  const warn = groups.filter((g) => g.level === 'warn').length;
  const sum = svEl('div', 'sv-sum', bad ? `Найдены проблемы: ${bad}` + (warn ? `, предупреждения: ${warn}` : '') : warn ? `Почти всё готово, предупреждения: ${warn}` : 'Всё готово к служению');
  sum.style.color = bad ? '#d6453d' : warn ? '#d99a0c' : '#2fa36b';
  const box = svEl('div', 'sv-chk');
  box.append(sum);
  const mark = { ok: '✓', warn: '!', bad: '×' };
  for (const g of groups) {
    const el = svEl('div', 'grp');
    const h = svEl('h3');
    h.append(Object.assign(svEl('span', 'st ' + g.level, mark[g.level])), document.createTextNode(g.title));
    const ul = svEl('ul');
    for (const it of g.items) {
      if (!it.html) continue;
      const li = svEl('li');
      li.innerHTML = it.html;
      if (it.level !== 'ok') li.style.color = it.level === 'bad' ? '#e0716a' : '#d9a640';
      if (it.btn) li.append(svBtn(it.btn.text, it.btn.fn));
      ul.append(li);
    }
    el.append(h, ul);
    box.append(el);
  }
  body.replaceChildren(box);
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ===================== Плашки и бегущая строка ===================== */

const LT_TPL = [
  { name: 'Проповедник', kind: 'lt', look: 'band', pos: 'left', title: 'Имя Фамилия', sub: 'Пастор церкви', accent: '#e5484d' },
  { name: 'Объявление', kind: 'lt', look: 'glass', pos: 'left', title: 'Объявление', sub: 'Текст объявления', accent: '#3b82f6' },
  { name: 'Wi‑Fi', kind: 'lt', look: 'box', pos: 'right', title: 'Wi‑Fi: Church-Guest', sub: 'Пароль: welcome2026', accent: '#46a758' },
  { name: 'Пожертвования', kind: 'lt', look: 'band', pos: 'right', title: 'Пожертвования', sub: 'Ящик для пожертвований — у входа', accent: '#f5a524' },
  { name: 'Песня / автор', kind: 'lt', look: 'line', pos: 'left', title: 'Название песни', sub: 'Автор', accent: '#8e4ec6' },
  { name: 'Бегущая строка', kind: 'ticker', look: 'band', title: 'Объявления', sub: 'Добро пожаловать! После служения — чай в малом зале.', accent: '#e5484d', speed: 12 },
];
const LT_LOOKS = [['band', 'Полосы'], ['glass', 'Стекло'], ['line', 'Текст с линией'], ['box', 'Белая карточка']];
let ltSel = '';
const ltList = () => { if (!Array.isArray(lib.lowerThirds)) lib.lowerThirds = []; return lib.lowerThirds; };
const ltContent = (p, still) => ({ type: 'lower', ltId: p.id, lt: { still: !!still, kind: p.kind, look: p.look, pos: p.pos, title: p.title, sub: p.sub, accent: p.accent, color: p.color, font: p.font, speed: p.speed } });

// Слой «Плашки»; убрали в «Слоях» — создаём снова сверху
function ltLayer() {
  let l = layerDefs().find((x) => x.kind === 'lower');
  if (!l) {
    l = { id: 'lower' + Date.now().toString(36), kind: 'lower' };
    settings.layers.push(l);
    saveSettings();
    sendLayers();
    if (typeof renderLayers === 'function') renderLayers();
  }
  return l.id;
}
const ltLiveId = () => { const x = layerOn[ltLayer()]; return x && x.content.type === 'lower' ? x.content.ltId || '' : ''; };
let ltHideT = 0;
function ltShow(p) {
  const id = ltLayer();
  present(() => ltContent(p), 'Плашка: ' + p.name, false, id);
  clearTimeout(ltHideT);
  // Скрыть сама через N секунд (если это всё ещё она)
  if (Number(p.sec) > 0) ltHideT = setTimeout(() => { if (ltLiveId() === p.id) clearLayer(id); ltPaint(); }, Number(p.sec) * 1000);
  ltPaint();
}
function ltHide() { clearLayer(ltLayer()); ltPaint(); }
// Плашка на экране поменялась (текст, вид) — обновить без анимации появления
function ltRefresh(p) {
  const id = ltLayer();
  if (ltLiveId() === p.id) present(() => ltContent(p, true), 'Плашка: ' + p.name, true, id);
}

function ltOpen() {
  const d = svDialog('ltDialog', 'Плашки и бегущая строка');
  if (!ltSel || !ltList().some((p) => p.id === ltSel)) ltSel = (ltList()[0] || {}).id || '';
  ltPaint();
  if (!d.open) d.showModal();
}
function ltAfterUndo() { if (document.getElementById('ltDialog') && $('ltDialog').open) ltPaint(); }

function ltAdd(t) {
  const p = { id: newId(), sec: 0, color: '#ffffff', font: 'segoe', ...JSON.parse(JSON.stringify(t)) };
  ltList().push(p);
  ltSel = p.id;
  saveLib();
  ltPaint();
}
function ltMenu(e, p, i) {
  const L = ltList();
  showMenu(e, [
    { label: 'Показать', fn: () => ltShow(p) },
    { label: 'Дублировать', fn: () => { const c = { ...JSON.parse(JSON.stringify(p)), id: newId(), name: p.name + ' (копия)' }; L.splice(i + 1, 0, c); ltSel = c.id; saveLib(); ltPaint(); } },
    { label: 'Выше', disabled: !i, fn: () => { L.splice(i - 1, 0, L.splice(i, 1)[0]); saveLib(); ltPaint(); } },
    { label: 'Ниже', disabled: i >= L.length - 1, fn: () => { L.splice(i + 1, 0, L.splice(i, 1)[0]); saveLib(); ltPaint(); } },
    '-',
    { label: 'Удалить', fn: () => { L.splice(i, 1); saveLib(); ltPaint(); flashStatus('Плашка удалена. Ctrl+Z — вернуть'); } },
  ]);
}

function ltPaint() {
  const d = document.getElementById('ltDialog');
  if (!d) return;
  const L = ltList();
  const live = ltLiveId();
  const body = d.querySelector('.dlg-body');
  const grid = svEl('div', 'sv-grid');
  const list = svEl('div', 'sv-list');
  for (const [i, p] of L.entries()) {
    const it = svEl('div', 'sv-item' + (p.id === ltSel ? ' sel' : '') + (p.id === live ? ' on' : ''));
    const nm = svEl('span', 'nm', p.name);
    it.append(nm, svEl('small', '', p.kind === 'ticker' ? 'строка' : 'плашка'));
    const b = svBtn(p.id === live ? 'Убрать' : 'Показать', (e) => { e.stopPropagation(); if (p.id === live) ltHide(); else ltShow(p); }, p.id === live ? '' : 'primary');
    it.append(b);
    it.addEventListener('click', () => { ltSel = p.id; ltPaint(); });
    it.addEventListener('dblclick', () => ltShow(p));
    it.addEventListener('contextmenu', (e) => { e.preventDefault(); ltMenu(e, p, i); });
    list.append(it);
  }
  const add = svBtn('＋ Новая ▾', (e) => showMenu(e, LT_TPL.map((t) => ({ label: t.name, fn: () => ltAdd(t) }))), '', 'add');
  list.append(add);
  if (!L.length) list.append(svEl('p', 'hint', 'Плашек ещё нет — выберите шаблон: имя проповедника, объявление, Wi‑Fi, пожертвования, бегущая строка.'));
  const form = svEl('div', 'sv-form');
  const p = L.find((x) => x.id === ltSel);
  if (p) {
    const ch = (k, repaint) => (v) => { p[k] = v; saveLib(); ltRefresh(p); if (repaint) ltPaint(); else { ltPrev(p); if (k === 'name') { const n = d.querySelector('.sv-item.sel .nm'); if (n) n.textContent = v; } } };
    form.append(svRow('Название', svInput('text', p.name, ch('name'))));
    form.append(svRow('Вид', svSelect([['lt', 'Плашка внизу'], ['ticker', 'Бегущая строка']], p.kind, ch('kind', true)), svSelect(LT_LOOKS, p.look, ch('look'))));
    if (p.kind === 'ticker') {
      form.append(svRow('Ярлык слева', svInput('text', p.title, ch('title'), { placeholder: 'Объявления (можно пусто)' })));
      const ta = svEl('textarea');
      ta.value = p.sub || '';
      ta.addEventListener('change', () => ch('sub')(ta.value.replace(/\s*\n\s*/g, '   •   ')));
      form.append(svRow('Текст строки', ta));
      const sp = svInput('range', p.speed || 12, ch('speed'), { min: 3, max: 40, step: 1 });
      sp.dataset.def = '12';
      form.append(svRow('Скорость', sp));
    } else {
      form.append(svRow('Заголовок', svInput('text', p.title, ch('title'), { placeholder: 'Имя Фамилия' })));
      form.append(svRow('Подпись', svInput('text', p.sub, ch('sub'), { placeholder: 'Пастор церкви (можно пусто)' })));
      form.append(svRow('Место', svSelect([['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']], p.pos || 'left', ch('pos'))));
    }
    const fonts = Object.entries(Scene.FONT_NAMES).concat(Scene.fontsList().map((f) => [f.family, f.family]));
    if (p.font && !fonts.some(([v]) => v === p.font)) fonts.push([p.font, p.font]);
    form.append(svRow('Цвета', ColorPicker.field(p.accent || '#e5484d', null, (h) => { p.accent = h; ltPrev(p); }, { onClose: () => { saveLib(); ltRefresh(p); } }),
      ColorPicker.field(p.color || '#ffffff', null, (h) => { p.color = h; ltPrev(p); }, { onClose: () => { saveLib(); ltRefresh(p); } }), svSelect([...new Map(fonts)].map(([v, t]) => [v, t]), p.font || 'segoe', ch('font'))));
    form.append(svRow('Скрыть сама через', svInput('number', p.sec || 0, ch('sec'), { min: 0, max: 600, step: 1, style: 'width:80px' }), svEl('span', 'hint', 'секунд (0 — не скрывать)')));
    const prev = svEl('div', 'sv-prev');
    prev.id = 'ltPrev';
    form.append(prev, svEl('p', 'hint', 'Двойной щелчок по плашке — показать. Поверх песен и Библии, слайд на экране не меняется. Убрать — кнопкой или крестиком слоя «Плашки» справа от «Предпросмотра».'));
    form.append(svEl('div', 'sv-line'));
    form.lastChild.append(svBtn(p.id === live ? 'Убрать с экрана' : 'Показать на экране', () => (p.id === live ? ltHide() : ltShow(p)), p.id === live ? '' : 'primary', 'show'));
  } else form.append(svEl('p', 'hint', 'Выберите плашку слева или создайте новую.'));
  grid.append(list, form);
  body.replaceChildren(grid);
  d.querySelector('.dlg-foot').replaceChildren(svEl('span', 'hint', 'Плашки хранятся в библиотеке программы; Ctrl+Z отменяет правки.'), svEl('span', 'spacer'), svBtn('Готово', () => d.close(), 'primary'));
  if (p) ltPrev(p);
}
function ltPrev(p) {
  const el = document.getElementById('ltPrev');
  if (!el) return;
  Scene.clear(el);
  Scene.show(el, ltContent(p));
}
// Плашку убрали с экрана другим путём (Esc, крестик слоя) — кнопки окна по правде
setInterval(() => { const d = document.getElementById('ltDialog'); if (d && d.open) { const live = ltLiveId(); if (d.dataset.live !== live) { d.dataset.live = live; ltPaint(); } } }, 700);
