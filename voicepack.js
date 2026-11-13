/* ===== Библия по голосу: другие языки и свои пакеты разбора (окно «Языки…» в панели голоса) =====
   1) Модель распознавания (что программа СЛЫШИТ) — любая модель Vosk (alphacephei.com/vosk/models): по ссылке на .zip
      или из файла. Свои языки помнит voicesrv.js (userData\voice\models.json), список — vcModels.
   2) Пакет разбора (как в этом языке НАЗЫВАЮТ места Писания) — файл .json: названия книг, числа словами,
      «глава», «стих», «по». Его можно сделать через ИИ: кнопка «Инструкция для ИИ» копирует задание (VP_PROMPT).
      Пакеты лежат в settings.voicePacks = [{ id, on, name, lang, …данные пакета }]; включённые подмешиваются
      в разбор voice.js (vcFind) через vpHas / vpNum / vpOrd / vpIsOrd / vpBook. */

const VP_FORMAT = 'mpshow-voice-pack';
const VP_LISTS = ['chapter', 'verse', 'range', 'filler', 'prefix', 'bookWords', 'numberJoin', 'same', 'next'];
// Слово как его отдаёт распознавание: строчные, ё → е, без знаков; «*» в конце — «начинается с»
const vpNorm = (w) => String(w == null ? '' : w).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}*]+/gu, '');
const vpTokens = (s) => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}*]+/u).filter(Boolean);

let vpData = null; // собранные включённые пакеты (vpBuild), null — собрать заново
const vpPacks = () => { if (!Array.isArray(settings.voicePacks)) settings.voicePacks = []; return settings.voicePacks; };

// Набор слов: точные + «начинается с» (слово*)
function vpSet() { return { set: new Set(), pre: [] }; }
function vpAdd(m, w) {
  const n = vpNorm(w);
  if (!n || n === '*') return;
  if (n.endsWith('*')) { const p = n.slice(0, -1); if (p.length >= 3) m.pre.push(p); } else m.set.add(n);
}
const vpIn = (m, t) => !!m && !!t && (m.set.has(t) || m.pre.some((p) => t.startsWith(p)));

function vpBuild() {
  const d = { nums: new Map(), ords: new Map(), books: [] };
  for (const k of VP_LISTS) d[k] = vpSet();
  for (const p of vpPacks()) {
    if (!p || p.on === false) continue;
    for (const k of VP_LISTS) for (const w of p[k] || []) vpAdd(d[k], w);
    for (const [w, v] of Object.entries(p.numbers || {})) { const n = vpNorm(w); if (n && Number(v) > 0) d.nums.set(n, Number(v)); }
    for (const [w, v] of Object.entries(p.ordinals || {})) { const n = vpNorm(w); if (n && Number(v) > 0) { d.ords.set(n, Number(v)); d.nums.set(n, Number(v)); } }
    for (const b of p.books || []) {
      const canon = Number(b && b.canon);
      if (!(canon >= 1 && canon <= 66)) continue;
      for (const nm of b.names || []) {
        const tk = vpTokens(nm);
        if (tk.length) d.books.push({ tk, canon, ord: Number(b.ordinal) || 0 });
      }
    }
  }
  d.books.sort((a, b) => b.tk.length - a.tk.length); // длинные названия — первыми
  d.any = d.books.length > 0 || d.nums.size > 0 || VP_LISTS.some((k) => d[k].set.size || d[k].pre.length);
  return d;
}
const vpD = () => vpData || (vpData = vpBuild());
const vpReset = () => { vpData = null; };

/* ----- Точки подключения к разбору voice.js ----- */
function vpHas(key, t) { const d = vpD(); return d.any && vpIn(d[key], t); }
const vpOrd = (t) => { const d = vpD(); const v = d.ords.get(t) || d.nums.get(t) || 0; return v >= 1 && v <= 5 ? v : 0; };
const vpIsOrd = (t) => vpD().ords.has(t);
const vpTokMatch = (pat, t) => (pat.endsWith('*') ? t.startsWith(pat.slice(0, -1)) && pat.length > 3 : pat === t);

// Число с позиции i: «сто двадцать пять», «kakskümmend kaheksa» → { v, n } (как vcNum)
function vpNum(tk, i) {
  const d = vpD();
  if (!d.nums.size) return null;
  let v = 0, n = 0, last = 0;
  for (let k = i; k < tk.length && n < 8;) {
    const x = d.nums.get(tk[k]);
    if (x == null) {
      // «двадцать и пять» — связка между частями числа
      if (v && vpIn(d.numberJoin, tk[k]) && d.nums.has(tk[k + 1] || '')) { k++; continue; }
      break;
    }
    // Можно прибавить: к круглым сотням — меньше сотни, к круглым десяткам (20–90) — единицы
    const ok = !v || (last >= 100 && last % 100 === 0 && x < 100) || (last >= 20 && last < 100 && last % 10 === 0 && x < 10);
    if (!ok) break;
    v += x;
    last = x;
    k++;
    n = k - i;
  }
  return v ? { v, n } : null;
}

// Книга с позиции i: [_, канон или { порядковый: канон }], len — сколько слов в названии
function vpBook(tk, i) {
  const d = vpD();
  if (!d.books.length) return null;
  let len = 0;
  const hit = [];
  for (const b of d.books) {
    if (len && b.tk.length < len) break; // уже нашли более длинное
    if (b.tk.every((p, k) => tk[i + k] != null && vpTokMatch(p, tk[i + k]))) { len = b.tk.length; hit.push(b); }
  }
  if (!hit.length) return null;
  let canon;
  if (hit.some((b) => b.ord)) {
    canon = {};
    for (const b of hit) if (b.ord && !canon[b.ord]) canon[b.ord] = b.canon;
    const plain = hit.find((b) => !b.ord);
    if (plain) canon[0] = plain.canon;
  } else canon = hit[0].canon;
  return Object.assign([null, canon], { len });
}

/* ----- Загрузка пакета ----- */
function vpClean(o) {
  const warn = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('это не пакет: нужен объект JSON');
  if (o.format && o.format !== VP_FORMAT) warn.push(`поле format — «${o.format}», ждали «${VP_FORMAT}»`);
  const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 2000) : []);
  const map = (m) => {
    const r = {};
    if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) { const n = Math.round(Number(v)); if (k.trim() && n >= 1 && n <= 999) r[k.trim().slice(0, 60)] = n; }
    return r;
  };
  const p = { id: newId(), on: true, format: VP_FORMAT, version: 1, name: String(o.name || o.lang || 'Пакет').slice(0, 60), lang: String(o.lang || '').toLowerCase().slice(0, 12) };
  for (const k of VP_LISTS) p[k] = strs(o[k]);
  p.numbers = map(o.numbers);
  p.ordinals = map(o.ordinals);
  p.books = [];
  const seen = new Set();
  for (const b of Array.isArray(o.books) ? o.books : []) {
    const canon = Math.round(Number(b && b.canon));
    if (!(canon >= 1 && canon <= 66)) { warn.push(`книга с номером «${b && b.canon}» пропущена (нужно 1–66)`); continue; }
    const names = strs(b.names);
    if (!names.length) continue;
    seen.add(canon);
    const ord = Math.round(Number(b.ordinal)) || 0;
    p.books.push(ord ? { canon, names, ordinal: ord } : { canon, names });
  }
  if (!p.books.length) warn.push('нет ни одной книги (books)');
  else if (seen.size < 66) warn.push(`названы не все книги: ${seen.size} из 66`);
  if (!Object.keys(p.numbers).length) warn.push('нет чисел (numbers)');
  if (!p.chapter.length) warn.push('нет слова «глава» (chapter)');
  if (!p.verse.length) warn.push('нет слова «стих» (verse)');
  const m = o.model;
  if (m && typeof m === 'object' && m.url) p.model = { url: String(m.url).slice(0, 400), name: String(m.name || p.name).slice(0, 40), mb: Math.round(Number(m.mb)) || 0 };
  return { p, warn };
}

async function vpImport() {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let r;
    try { r = vpClean(JSON.parse((await f.text()).replace(/^﻿/, ''))); } catch (err) { showNotice('Пакет не загрузился: ' + (err.message || err) + '. Нужен файл .json по инструкции для ИИ.', true); return; }
    const { p, warn } = r;
    // Пакет того же языка с тем же названием — заменяем
    const L = vpPacks();
    const old = L.findIndex((x) => x.name === p.name && x.lang === p.lang);
    if (old >= 0) L.splice(old, 1, p); else L.push(p);
    saveSettings();
    vpReset();
    // Ссылка на модель распознавания — добавить язык (скачать — кнопкой, после подтверждения)
    if (p.model && p.lang && window.api.voiceAdd) {
      const a = await window.api.voiceAdd({ lang: p.lang, name: p.model.name, url: p.model.url, mb: p.model.mb });
      if (a && a.ok) vcModels = a.state; else if (a && a.error) warn.push('модель: ' + a.error);
    }
    flashStatus(`Пакет «${p.name}» загружен: книг ${new Set(p.books.map((b) => b.canon)).size}, чисел ${Object.keys(p.numbers).length + Object.keys(p.ordinals).length}`);
    if (warn.length) showNotice(`Пакет «${p.name}»: ` + warn.join('; '), false);
    vpPaint();
  });
  inp.click();
}

/* ----- Окно «Языки распознавания» ----- */
let vpBusy = '';
async function vpOpen() {
  const d = svDialog('vpDialog', 'Библия по голосу — языки');
  try { vcModels = await window.api.voiceState(); } catch { /* покажем, что есть */ }
  vpPaint();
  if (!d.open) d.showModal();
}
setInterval(() => { const d = document.getElementById('vpDialog'); if (d && d.open && (vpBusy || vcGetting)) vpPaint(); }, 500);

async function vpModelGet(m) {
  if (!confirm(`Скачать модель распознавания «${m.name}»${m.mb ? ` (${m.mb} МБ)` : ''}?\n\n${m.url}`)) return;
  vpBusy = m.id;
  vpPaint();
  const r = await window.api.voiceGet(m.id);
  vpBusy = '';
  vcGetting = null;
  if (!r.ok) showNotice('Модель не скачалась: ' + (r.error || 'ошибка') + '. Проверьте ссылку и интернет или возьмите .zip модели Vosk («Из файла…»).', true);
  else { vcModels = r.state; flashStatus(`Модель «${m.name}» готова — выберите язык в панели голоса`); }
  vpPaint();
  if (typeof vcPaint === 'function') vcPaint();
}
async function vpModelFile(id) {
  const r = await window.api.voiceFile(id);
  if (!r.ok) { if (r.error) showNotice('Модель: ' + r.error, true); return; }
  vcModels = r.state;
  vpPaint();
  if (typeof vcPaint === 'function') vcPaint();
}

function vpPaint() {
  const d = document.getElementById('vpDialog');
  if (!d) return;
  const body = d.querySelector('.dlg-body');
  const box = svEl('div', 'vp-box');
  // 1. Модели
  box.append(svEl('div', 'sv-sub', '1. Что программа слышит — модели распознавания (Vosk)'),
    svEl('p', 'hint', 'Модель переводит речь в слова. Скачивается один раз, дальше работает без интернета, голос никуда не отправляется. Список моделей всех языков — alphacephei.com/vosk/models (берите «small»).'));
  const ms = (vcModels && vcModels.models) || [];
  for (const m of ms) {
    const row = svEl('div', 'vp-row');
    const nm = svEl('span', 'nm', m.name + ' ');
    nm.append(svEl('small', '', `${m.id}${m.own ? ' · свой' : ''}${m.mb ? ' · ' + m.mb + ' МБ' : ''}`));
    row.append(nm);
    if (vpBusy === m.id) {
      const pct = vcGetting && vcGetting.total ? Math.round((vcGetting.got / vcGetting.total) * 100) : 0;
      row.append(svEl('span', 'hint', vcGetting && vcGetting.unpack ? 'Распаковываю…' : `Скачиваю ${pct}%`));
    } else if (m.have) {
      row.append(svEl('span', 'vp-ok', '✓ скачана'));
    } else {
      const g = svBtn('Скачать', () => vpModelGet(m), 'primary');
      g.disabled = !!vpBusy || !m.url;
      if (!m.url) g.title = 'Нет ссылки — возьмите модель из файла';
      row.append(g, svBtn('Из файла…', () => vpModelFile(m.id)));
    }
    if (m.own || m.have) {
      const x = svBtn(m.own ? 'Убрать' : 'Удалить модель', async () => {
        if (!confirm(m.own ? `Убрать язык «${m.name}» и его модель?` : `Удалить скачанную модель «${m.name}»? Потом её можно скачать снова.`)) return;
        const r = await window.api.voiceRemove(m.id);
        if (r && r.ok) vcModels = r.state;
        if (vcCfg().lang === m.id && m.own) { vcCfg().lang = 'ru'; saveSettings(); }
        vpPaint();
        if (typeof vcPaint === 'function') vcPaint();
      });
      x.disabled = !!vpBusy;
      row.append(x);
    }
    box.append(row);
  }
  // Свой язык
  const add = svEl('div', 'vp-add');
  const code = svInput('text', '', () => {}, { placeholder: 'et', maxLength: 12, style: 'width:70px' });
  const name = svInput('text', '', () => {}, { placeholder: 'Eesti', style: 'width:130px' });
  const url = svInput('text', '', () => {}, { placeholder: 'https://alphacephei.com/vosk/models/vosk-model-small-….zip', style: 'flex:1;min-width:220px' });
  const doAdd = async (fromFile) => {
    const r = await window.api.voiceAdd({ lang: code.value, name: name.value || code.value, url: url.value });
    if (!r.ok) { showNotice('Язык: ' + r.error, true); return; }
    vcModels = r.state;
    const lang = code.value.trim().toLowerCase();
    const m = vcModels.models.find((x) => x.id === lang);
    vpPaint();
    if (fromFile) vpModelFile(lang); else if (m && m.url && !m.have) vpModelGet(m);
  };
  add.append(svEl('b', '', 'Другой язык: '), code, name, url, svBtn('Добавить и скачать', () => doAdd(false), 'primary'), svBtn('Из файла (.zip)…', () => doAdd(true)));
  box.append(add, svEl('p', 'hint', 'Код — две-три латинские буквы (et — эстонский, uk — украинский, lv — латышский). Ссылка — на .zip модели Vosk. Если для языка нет модели Vosk, распознавание на нём не заработает, даже с пакетом.'));

  // 2. Пакеты разбора
  box.append(svEl('div', 'sv-sub', '2. Как называют места Писания — пакеты разбора'),
    svEl('p', 'hint', 'Пакет учит программу словам языка: названия книг во всех формах, числа словами, «глава», «стих», «по». Русский, английский и немецкий встроены. Для другого языка сделайте пакет через ИИ (ChatGPT, Claude…): скопируйте инструкцию, отправьте ИИ, сохраните его ответ в файл .json и загрузите сюда.'));
  const L = vpPacks();
  for (const [i, p] of L.entries()) {
    const row = svEl('div', 'vp-row');
    const nm = svEl('span', 'nm', p.name + ' ');
    nm.append(svEl('small', '', `${p.lang || '—'} · книг ${new Set((p.books || []).map((b) => b.canon)).size} · чисел ${Object.keys(p.numbers || {}).length + Object.keys(p.ordinals || {}).length}`));
    row.append(svCheckbox('', p.on !== false, (v) => { p.on = v; saveSettings(); vpReset(); }), nm,
      svBtn('Сохранить…', () => vpSave(p)),
      svBtn('Удалить', () => { if (!confirm(`Удалить пакет «${p.name}»?`)) return; L.splice(i, 1); saveSettings(); vpReset(); vpPaint(); }));
    box.append(row);
  }
  if (!L.length) box.append(svEl('p', 'hint', 'Своих пакетов нет.'));
  const ln = svEl('div', 'sv-line');
  ln.append(svBtn('Загрузить пакет (.json)…', vpImport, 'primary', 'add'), svBtn('Инструкция для ИИ — скопировать', vpCopyPrompt), svBtn('Сохранить инструкцию в файл…', () => vpDownload('Инструкция-пакет-языка-для-ИИ.md', VP_PROMPT, 'text/markdown')));
  box.append(ln);
  // Проверка пакета: написать фразу, как её скажет проповедник
  const test = svInput('text', '', () => {}, { placeholder: 'Проверить фразу: «kolmas peatükk kuueteistkümnes salm johannese evangeeliumist»', style: 'flex:1' });
  const res = svEl('span', 'hint', '');
  const run = () => {
    const found = vcFind(test.value).map((r) => { const x = vcResolve(r); return x ? x.ref : `книга №${r.canon} ${r.ch}${r.v1 ? ':' + r.v1 : ''} (нет в открытом переводе)`; });
    res.textContent = found.length ? '→ ' + found.join(', ') : '→ место не найдено';
  };
  test.addEventListener('input', run);
  const tl = svEl('div', 'sv-line');
  tl.append(test);
  box.append(tl, res);
  body.replaceChildren(box);
  d.querySelector('.dlg-foot').replaceChildren(svEl('span', 'spacer'), svBtn('Готово', () => d.close(), 'primary'));
}

function vpDownload(name, text, type) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function vpSave(p) {
  const o = { ...p };
  delete o.id; delete o.on;
  vpDownload(`voice-pack-${p.lang || 'xx'}.json`, JSON.stringify(o, null, 2), 'application/json');
}
async function vpCopyPrompt() {
  try { await navigator.clipboard.writeText(VP_PROMPT); flashStatus('Инструкция скопирована — вставьте её в чат с ИИ и допишите язык'); }
  catch { vpDownload('Инструкция-пакет-языка-для-ИИ.md', VP_PROMPT, 'text/markdown'); }
}

(() => {
  const css = document.createElement('style');
  css.textContent = `
    #vpDialog { width: min(900px, 95vw); }
    .vp-box { display: flex; flex-direction: column; gap: 6px; }
    .vp-row { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: calc(6px * var(--rk, 1)); }
    .vp-row:hover { background: var(--field); }
    .vp-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vp-row small { color: var(--muted); }
    .vp-row .check { margin: 0; }
    .vp-ok { color: #2fa36b; font-size: 13px; }
    .vp-add { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  `;
  document.head.append(css);
})();

/* ----- Задание для ИИ: сделать пакет языка ----- */
const VP_PROMPT = `# Задача

Сделай **пакет языка** для функции «Библия по голосу» церковной программы multiplayerSHOW.

Программа слушает проповедника через распознавание речи Vosk. Vosk выдаёт **только слова в нижнем регистре, без знаков препинания и почти всегда без цифр** — числа приходят словами («kolm», «kakskümmend üks»). Программа ищет в этих словах ссылку на место Писания: название книги + номер главы + номер стиха (иногда «по» стих — диапазон). Пакет — это словарь, по которому она понимает такие ссылки на нужном языке.

**Язык пакета: [НАПИШИ ЯЗЫК, например «эстонский»]**

# Что выдать

Только один JSON-объект в блоке кода \`\`\`json — без пояснений до и после (пояснения можно после блока, кратко). Формат строго такой:

\`\`\`json
{
  "format": "mpshow-voice-pack",
  "version": 1,
  "name": "Eesti keel",
  "lang": "et",
  "model": { "name": "Eesti", "url": "https://…/model.zip", "mb": 0 },
  "chapter": ["peatükk", "peatüki", "peatükis"],
  "verse": ["salm", "salmi", "salmis"],
  "range": ["kuni"],
  "filler": ["ja", "number"],
  "prefix": ["raamatust", "evangeeliumist"],
  "bookWords": ["raamat", "kiri", "kirjast"],
  "numberJoin": [],
  "same": ["samas", "selles", "sama"],
  "next": ["järgmine", "järgmises"],
  "numbers": { "üks": 1, "kaks": 2, "kakskümmend": 20, "sada": 100 },
  "ordinals": { "esimene": 1, "teine": 2, "kolmas": 3 },
  "books": [
    { "canon": 1, "names": ["moosese", "genesis"], "ordinal": 1 },
    { "canon": 43, "names": ["johannese", "johannes"] },
    { "canon": 62, "names": ["johannese", "johannes"], "ordinal": 1 }
  ]
}
\`\`\`

# Поля

| Поле | Что это |
|---|---|
| \`name\` | название пакета (на этом языке) |
| \`lang\` | код языка ISO 639-1: et, uk, lv, lt, fi, pl… |
| \`model\` | модель Vosk для этого языка, если она есть на https://alphacephei.com/vosk/models — прямая ссылка на .zip (лучше «small»), примерный размер в МБ. **Ссылку не выдумывай**: если не уверен, что такая модель есть, поле \`model\` не пиши вообще и напиши об этом после JSON |
| \`chapter\` | слово «глава» во **всех** формах (падежи, число) |
| \`verse\` | слово «стих» во всех формах |
| \`range\` | слова диапазона «по», «до» (стихи 3 по 12) |
| \`filler\` | короткие служебные слова, которые могут стоять между названием книги и числами: «и», «в», «номер» |
| \`prefix\` | слова, которые стоят прямо **перед названием книги**, когда числа сказаны раньше книги: «(из) книги», «евангелия», «от», «послания», «пророка» — во всех формах |
| \`bookWords\` | слова между порядковым номером книги и её названием: «(первое) **послание к** коринфянам», «(вторая) **книга** царств» |
| \`numberJoin\` | связка внутри составного числа, если она бывает отдельным словом («ein **und** zwanzig»); иначе пусто |
| \`same\` | слова «этой же / той же / этом», которые стоят перед «главой» и значат «текущая глава» («в этой же главе 17 стих» — программа берёт книгу и главу последнего места) |
| \`next\` | «следующий» перед словом «стих» («следующий стих» → стих после последнего) |
| \`numbers\` | количественные числа словами → значение |
| \`ordinals\` | порядковые числа словами (первый, третьей, шестнадцатый…) → значение, во всех формах |
| \`books\` | книги Библии: номер \`canon\` 1–66 и все варианты названия |

# Правила

1. **Все слова — в нижнем регистре**, без точек, дефисов и апострофов (как их выдаст распознавание). Буква «ё» → «е».
2. **Формы слов.** Проповедник говорит в разных падежах: «в Евангелии от Иоанна», «Иоанна три шестнадцать», «из книги Исаии». Перечисли все формы, которые реально звучат. Можно ставить \`*\` в конце — «слово начинается с»: \`"korintla*"\` (не короче 3 букв до звёздочки; не делай звёздочку слишком короткой, чтобы не ловить обычные слова).
3. **Числа.** Нужны значения от 1 до 176 (самая длинная глава — Псалом 118/119 — 176 стихов).
   - Если в языке числа — **отдельные слова** («сто двадцать пять» = сто + двадцать + пять), достаточно перечислить 1–19, десятки 20–90 и сотни 100, 200 (во всех формах) — программа сама сложит: к круглой сотне прибавит меньшее число, к круглому десятку — единицы.
   - Если составное число пишется **одним словом** (нем. «einundzwanzig», эст. «kakskümmend» отдельно, но «kaksteist» слитно), перечисли **каждое** слитное слово от 1 до 176 со значением.
   - Порядковые («первая глава», «шестнадцатый стих», «kuueteistkümnes salm») — в \`ordinals\`, тоже до 176 и во всех падежах, которые звучат при ссылке.
4. **Книги.** Все 66 книг, номер \`canon\` строго по списку ниже (протестантский канон, 66 книг). В \`names\` — все формы и распространённые варианты названия на этом языке (полное, короткое, разговорное), каждое — как его произносят. Название может быть из нескольких слов: \`"laulude laul"\`.
5. **Нумерованные книги** (1–2 Царств/Самуила, 1–2 Коринфянам и т. п.): отдельная запись на каждую с полем \`"ordinal": 1\` или \`2\` (3 — для 3 Иоанна) и **одинаковыми** \`names\` без номера. Программа сама найдёт порядковое слово перед названием («первое послание к коринфянам», «2 Korintlastele»). Для книги с тем же названием без номера (Евангелие от Иоанна, canon 43) — запись **без** \`ordinal\`. Порядковые слова «первый/второй/третий» должны быть в \`ordinals\`.
6. Ничего не пропускай и не сокращай списки словами «и т. д.» — программа видит только то, что написано.
7. После JSON коротко перечисли, что проверить человеку, знающему язык.

# Номера книг (canon)

1 Genesis · 2 Exodus · 3 Leviticus · 4 Numbers · 5 Deuteronomy · 6 Joshua · 7 Judges · 8 Ruth · 9 1 Samuel · 10 2 Samuel · 11 1 Kings · 12 2 Kings · 13 1 Chronicles · 14 2 Chronicles · 15 Ezra · 16 Nehemiah · 17 Esther · 18 Job · 19 Psalms · 20 Proverbs · 21 Ecclesiastes · 22 Song of Songs · 23 Isaiah · 24 Jeremiah · 25 Lamentations · 26 Ezekiel · 27 Daniel · 28 Hosea · 29 Joel · 30 Amos · 31 Obadiah · 32 Jonah · 33 Micah · 34 Nahum · 35 Habakkuk · 36 Zephaniah · 37 Haggai · 38 Zechariah · 39 Malachi · 40 Matthew · 41 Mark · 42 Luke · 43 John · 44 Acts · 45 Romans · 46 1 Corinthians · 47 2 Corinthians · 48 Galatians · 49 Ephesians · 50 Philippians · 51 Colossians · 52 1 Thessalonians · 53 2 Thessalonians · 54 1 Timothy · 55 2 Timothy · 56 Titus · 57 Philemon · 58 Hebrews · 59 James · 60 1 Peter · 61 2 Peter · 62 1 John · 63 2 John · 64 3 John · 65 Jude · 66 Revelation

Если в традиции языка 1–2 Samuel и 1–2 Kings называются «1–4 Царств», дай записи так: «1 Царств» → canon 9 (ordinal 1), «2 Царств» → 10 (ordinal 2), «3 Царств» → 11 (ordinal 3), «4 Царств» → 12 (ordinal 4).

# Как программа будет понимать (проверь на этих примерах)

Все варианты ниже должны давать одно место — Иисус Навин 1:8 (canon 6, глава 1, стих 8):
- «[книга] один восемь» — книга, потом глава и стих;
- «один восемь [книга]» — числа до книги;
- «[книга] глава первая стих восьмой»;
- «первая глава восьмой стих книги [книга]» — подписи после чисел, слово «книги» — из \`prefix\`;
- «глава один стих восемь из книги [книга]».

Без книги — место берётся из последнего названного (пусть до этого прозвучало «Притчи 8:5»): «в этой же главе семнадцатый стих» → 20 8:17; «стих двадцать» → 20 8:20; «следующий стих» → 20 8:6; «девятая глава первый стих» → 20 9:1.

И ещё: «[Иоанн] три шестнадцать» → 43 3:16; «первое послание к коринфянам тринадцать четыре по семь» → 46 13:4–7; «псалом сто восемнадцать» → 19, глава 118.
Переведи эти примеры на свой язык и убедись, что каждое слово из них есть в пакете.
`;
