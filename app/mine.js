/* «Моя версия» песни (этап 5) — своя копия текста только на этом телефоне (IndexedDB mine, на сервер не уходит):
   { id: песня, parts: { часть: текст }, base: { часть: текст оригинала, с которого правили }, at }.
   Часть — «Куплет 1|0» (часть песни и номер слайда в ней; повтор припева — та же часть, правится один раз),
   у слайда без части — его id. Оригинал поменялся: часть, которую вы не правили, просто становится новой;
   правленая — плашка «Оригинал изменился» (что поменялось — по строкам), «Оставить мою» / «Взять из оригинала».
   Оформление — разметка в тексте: ==выделить==, ~~замазать~~, __подчеркнуть__, ^^подпись^^ (мелко, между словами).
   Слова (.w) — только сам текст; пометки пенала у моей версии свои (ключ 'my:' + id, app.js). */
'use strict';
const Mine = (() => {
  const all = new Map();
  let modes = {}; // localStorage mps.mv: { id: 1 } — показывать мою версию
  try { modes = JSON.parse(localStorage.getItem('mps.mv') || '{}') || {}; } catch { modes = {}; }
  const saveModes = () => { try { localStorage.setItem('mps.mv', JSON.stringify(modes)); } catch { /* приватный режим */ } };

  async function init() {
    try { for (const r of await Store.allRec('mine')) if (r && r.id && r.parts) all.set(r.id, r); } catch { /* нет базы — без моих версий */ }
  }
  const has = (id) => all.has(id);
  const on = (id) => all.has(id) && !!modes[id];
  function setOn(id, y) { if (y) modes[id] = 1; else delete modes[id]; saveModes(); }
  function put(r) { r.at = Date.now(); all.set(r.id, r); return Store.putRec('mine', r).catch(() => {}); }
  async function drop(id) { all.delete(id); delete modes[id]; saveModes(); try { await Store.delRec('mine', id); } catch { /* нет базы */ } }

  // Части песни по порядку: часть → { text, label } (первое появление)
  const keyOf = (z) => (z.part ? z.part + '|' + (z.pi || 0) : z.id);
  function parts(slides) {
    const m = new Map();
    slides.forEach((z, i) => {
      const k = keyOf(z);
      const name = z.label || z.part;
      if (!m.has(k)) m.set(k, { text: z.text || '', label: name ? name + (z.part && z.pi ? ` (${z.pi + 1})` : '') : `Слайд ${i + 1}` });
    });
    return m;
  }

  // Моя версия открытой песни: слайды с моим текстом и что поменялось в оригинале
  function view(v) {
    const r = all.get(v.id);
    if (!r) return null;
    const orig = parts(v.slides);
    const changed = [];
    let fix = false;
    for (const [k, o] of orig) {
      const mine = r.parts[k];
      const base = r.base[k];
      if (mine === undefined) { r.parts[k] = r.base[k] = o.text; fix = true; continue; } // новая часть
      if (base === o.text) continue;
      if (mine === base) { r.parts[k] = r.base[k] = o.text; fix = true; continue; }      // не правили — как в оригинале
      changed.push({ key: k, label: o.label, was: base || '', now: o.text, mine });
    }
    if (fix) put(r);
    return { changed, slides: v.slides.map((z) => ({ ...z, text: r.parts[keyOf(z)] ?? z.text })) };
  }
  function keep(id, keys, takeNew) {
    const r = all.get(id);
    if (!r) return;
    for (const c of keys) { r.base[c.key] = c.now; if (takeNew) r.parts[c.key] = c.now; }
    put(r);
  }

  /* ----- Разметка ----- */

  const TAGS = { '==': 'hl', '~~': 'cov', __: 'ul' };
  const MARK_RE = /\^\^([^^\n]*)\^\^|==|~~|__/g;
  // Строка → { text: без разметки, fx: [{ a, b, k }], caps: [{ at, t }] }
  function parse(line) {
    let text = '';
    const fx = [];
    const caps = [];
    const open = {};
    let last = 0;
    for (const m of String(line).matchAll(MARK_RE)) {
      text += line.slice(last, m.index);
      last = m.index + m[0].length;
      if (m[1] !== undefined) { if (m[1].trim()) caps.push({ at: text.length, t: m[1].trim() }); continue; }
      const k = TAGS[m[0]];
      if (open[k] === undefined) open[k] = text.length;
      else { if (text.length > open[k]) fx.push({ a: open[k], b: text.length, k }); delete open[k]; }
    }
    text += line.slice(last);
    for (const k of Object.keys(open)) if (text.length > open[k]) fx.push({ a: open[k], b: text.length, k }); // не закрыли — до конца строки
    return { text, fx, caps };
  }
  const plain = (text) => String(text || '').split('\n').map((l) => parse(l).text).join('\n');

  /* ----- Различия по строкам (что поменялось в оригинале) ----- */

  function diff(a, b) {
    const x = String(a).split('\n');
    const y = String(b).split('\n');
    const L = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) { out.push(['=', x[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', x[i++]]); else out.push(['+', y[j++]]);
    }
    while (i < x.length) out.push(['-', x[i++]]);
    while (j < y.length) out.push(['+', y[j++]]);
    return out;
  }

  /* ----- Редактор ----- */

  let edV = null;
  let lastTa = null;
  function edit(v) {
    edV = v;
    const r = all.get(v.id);
    const body = document.getElementById('myBody');
    body.replaceChildren();
    for (const [k, o] of parts(v.slides)) {
      const box = document.createElement('div');
      box.className = 'my-part';
      const h = document.createElement('h3');
      h.textContent = o.label || 'Текст';
      const ta = document.createElement('textarea');
      ta.className = 'field my-ta';
      ta.dataset.key = k;
      ta.value = r && r.parts[k] !== undefined ? r.parts[k] : o.text;
      ta.rows = Math.max(2, ta.value.split('\n').length);
      ta.spellcheck = false;
      const pv = document.createElement('div');
      pv.className = 'sl my-pv';
      const paint = () => { pv.replaceChildren(textBlock(ta.value || ' ', null, 0, false, true)); fit(ta); };
      ta.addEventListener('input', paint);
      ta.addEventListener('focus', () => { lastTa = ta; });
      paint();
      box.append(h, ta, pv);
      body.append(box);
    }
    lastTa = body.querySelector('textarea');
    document.getElementById('myDel').hidden = !r;
    document.getElementById('myDlg').showModal();
    for (const ta of body.querySelectorAll('textarea')) fit(ta);
    body.scrollTop = 0;
  }
  // Поле — по высоте текста (без своей прокрутки)
  function fit(ta) { ta.style.height = 'auto'; if (ta.scrollHeight) ta.style.height = ta.scrollHeight + 2 + 'px'; }
  // Кнопка оформления: обернуть выделение (по строкам) или слово под курсором; '' — убрать оформление
  function apply(f) {
    const ta = lastTa;
    if (!ta) return;
    const v = ta.value;
    let a = ta.selectionStart;
    let b = ta.selectionEnd;
    const isL = (ch) => /[\p{L}\p{N}'’-]/u.test(ch || '');
    if (a === b && f !== '^^') {
      if (!f) { a = v.lastIndexOf('\n', a - 1) + 1; b = v.indexOf('\n', b); if (b < 0) b = v.length; } else { while (a > 0 && isL(v[a - 1])) a--; while (b < v.length && isL(v[b])) b++; }
    }
    let mid;
    let selA = a;
    let selB;
    if (!f) mid = v.slice(a, b).replace(MARK_RE, '');
    else if (a === b) { mid = '^^подпись^^'; selA = a + 2; selB = a + 9; } else {
      mid = v.slice(a, b).split('\n').map((l) => {
        const t = l.match(/^(\s*)(.*?)(\s*)$/);
        return t[2] ? t[1] + f + t[2] + f + t[3] : l;
      }).join('\n');
    }
    ta.value = v.slice(0, a) + mid + v.slice(b);
    ta.focus();
    ta.setSelectionRange(selA, selB ?? a + mid.length);
    ta.dispatchEvent(new Event('input'));
  }
  async function save() {
    if (!edV) return;
    const v = edV;
    const orig = parts(v.slides);
    const r = all.get(v.id) || { id: v.id, parts: {}, base: {} };
    for (const ta of document.querySelectorAll('#myBody textarea')) {
      const k = ta.dataset.key;
      r.parts[k] = ta.value.replace(/\r/g, '');
      if (r.base[k] === undefined) r.base[k] = orig.has(k) ? orig.get(k).text : '';
    }
    await put(r);
    setOn(v.id, true);
    document.getElementById('myDlg').close();
    edV = null;
  }
  function wire(after) {
    document.getElementById('myX').onclick = () => document.getElementById('myDlg').close();
    for (const b of document.querySelectorAll('#myTools button')) {
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // выделение в поле не теряется
      b.onclick = () => apply(b.dataset.f);
    }
    document.getElementById('mySave').onclick = async () => { await save(); after(); };
    document.getElementById('myDel').onclick = async () => {
      if (!edV || !(await ask('Удалить вашу версию этой песни? Пометки на ней тоже не будут видны.', 'Удалить'))) return;
      await drop(edV.id);
      document.getElementById('myDlg').close();
      edV = null;
      after();
    };
  }

  return { init, has, on, setOn, view, keep, parse, plain, diff, edit, wire, drop, all: () => [...all.values()] };
})();
