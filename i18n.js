/* Языки интерфейса: русский (как написан код), английский, эстонский.
   Код по-прежнему пишет тексты по-русски, а i18n.js сам переводит то, что попало на экран:
   текст элементов и подсказки (title, placeholder, aria-label, label), по словарю lang.js
   (русская строка → [английский, эстонский]; {0} {1} — подстановки, например «Удалено: {0}»).
   Не трогает: слайды (.layer — песни, Библия, презентации), поля ввода, svg, [data-noi18n].
   [data-i18n="exact"] — только точное совпадение строки (списки устройств и т. п.).
   Язык — localStorage 'cp.lang' ('ru' | 'en' | 'et'); смена — I18n.set(lang), без перезапуска.
   Новая строка в интерфейсе — добавьте её в lang.js (иначе останется по-русски). */
const I18n = (() => {
  const LANGS = [['ru', 'Русский'], ['en', 'English'], ['et', 'Eesti']];
  const IDX = { en: 0, et: 1 };
  const CYR = /[А-Яа-яЁё]/;
  const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
  const SKIP_TEXT = 'script,style,textarea,svg,.layer,[contenteditable=""],[contenteditable="true"],[data-noi18n]';
  const SKIP_ATTR = '.layer,[data-noi18n]';
  let lang = 'ru';
  try { lang = localStorage.getItem('cp.lang') || 'ru'; } catch { /* нет хранилища */ }
  if (lang !== 'ru' && !(lang in IDX)) lang = 'ru';

  const dict = new Map(); // строка → [en, et]
  const pats = []; // { re, n, v: [en, et] }
  const frags = new Map(); // кусок фразы (склейка в коде) → [en, et]
  let fragRe;
  let cache = new Map();

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normNl = (s) => s.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  const normAll = (s) => s.replace(/\s+/g, ' ').trim();

  // Словарь: I18n.add({ 'Русский': ['English', 'Eesti'] }); frag — куски фраз, которые код склеивает
  function add(obj, frag) {
    for (const [k, v] of Object.entries(obj)) {
      if (!Array.isArray(v)) continue;
      if (/\{\d+\}/.test(k)) {
        const lit = k.replace(/\{\d+\}/g, '');
        if (!CYR.test(lit)) continue;
        const order = [];
        const re = new RegExp('^' + esc(k).replace(/\\\{(\d+)\\\}/g, (_, n) => { order.push(+n); return '([\\s\\S]*?)'; }) + '$');
        pats.push({ re, order, v, w: lit.length, cy: (lit.match(/[А-Яа-яЁё]/g) || []).length });
      } else {
        dict.set(k, v);
        if (frag && k.length >= 3) frags.set(k, v);
      }
    }
    pats.sort((a, b) => b.w - a.w);
    fragRe = undefined;
    cache = new Map();
    memo = new Map();
  }

  const exact = (k, i) => {
    let d = dict.get(k);
    if (!d && k.includes('\n')) d = dict.get(normAll(k));
    return d && d[i] ? d[i] : null;
  };

  // Подстановка внутри шаблона — переводим, только если это известная строка (имена пользователя не трогаем)
  const sub = (s, i) => {
    if (!s || !CYR.test(s)) return s;
    const k = normAll(s);
    let t = lookup(k, i, false, true);
    // «запись» (код сделал toLowerCase) — ищем «Запись» и возвращаем с маленькой буквы
    if (t == null && k[0] !== k[0].toUpperCase()) {
      const u = lookup(k[0].toUpperCase() + k.slice(1), i, false, true);
      if (u != null) t = u[0].toLowerCase() + u.slice(1);
    }
    if (t == null) return s;
    return (/^\s/.test(s) ? ' ' : '') + t + (/\s$/.test(s) ? ' ' : ''); // «Таймер 1 · » + «Время…» — пробел не терять
  };

  // noFrag: без перевода отдельных слов (для подстановок в шаблон), но по частям фразы — можно
  let memo = new Map();
  function lookup(k, i, onlyExact, noFrag) {
    if (onlyExact) return exact(k, i);
    const mk = i + (noFrag ? '1' : '0') + k;
    if (memo.has(mk)) return memo.get(mk);
    memo.set(mk, null); // защита от зацикливания
    const r = lookup2(k, i, noFrag);
    memo.set(mk, r);
    return r;
  }
  function lookup2(k, i, noFrag) {
    const e = exact(k, i);
    if (e != null) return e;
    // Шаблон: «Удалено: {0}». Подстановка не перевелась (имя пользователя) — такой вариант запасной,
    // сначала пробуем другие способы: «Видео {0}» не должен съесть «Видео и медиа · 20»
    const flat = normAll(k);
    let spare = null;
    for (const p of pats) {
      const m = p.re.exec(k) || (flat !== k ? p.re.exec(flat) : null);
      if (!m || !p.v[i]) continue;
      let full = true;
      const r = p.v[i].replace(/\{(\d+)\}/g, (all, n) => {
        const at = p.order.indexOf(+n);
        if (at < 0) return all;
        const v = sub(m[at + 1], i);
        if (CYR.test(v)) full = false;
        return v;
      });
      if (full) return r;
      if (spare == null && p.cy >= 4) spare = r; // «{0} с» — слишком мало слов, чтобы оставлять имя по-русски
    }
    // Строка в скобках/кавычках, со значком или двоеточием: «(тема и цвета)», «✓ Редактор сцен», «Тема:»
    const w = /^([(«"'“\[·—–\s✓✔＋+•▸▾▶►●○■□★☆→←↑↓]*)([\s\S]*?)([)»"'”\]:.,;…·—–\s▾▸]*)$/.exec(k);
    if (w && (w[1] || w[3]) && w[2]) {
      const inner = exact(w[2], i) ?? (w[2] !== k ? lookup(w[2], i, false, true) : null);
      if (inner != null && !CYR.test(inner)) return w[1] + inner + w[3];
      // только значок спереди: «＋ Объявления по кругу (каждые 6 с)» — скобка в конце своя
      const tail = k.slice(w[1].length);
      const t2 = w[1] && tail !== k ? exact(tail, i) ?? lookup(tail, i, false, true) : null;
      if (t2 != null && !CYR.test(t2)) return w[1] + t2;
    }
    // Фраза склеена из готовых кусков: «Презентации: пусто (слой скрыт). Правая кнопка — сменить иконку» —
    // переводим каждый кусок между знаками препинания; годится, только если переведены все русские куски
    const parts = k.split(/(\.\s+|\s+[—–]\s+|:\s+|\s*\(|\)\s*|,\s+|\s+·\s+|·\s*)/);
    if (parts.length > 1) {
      let ok = true, any = false, out = '';
      // берём самый длинный известный кусок (с разделителями внутри: «Правая кнопка — сменить иконку»)
      for (let a = 0; a < parts.length;) {
        if (a % 2) { out += parts[a++]; continue; }
        let hit = null;
        for (let b = parts.length - 1 - ((parts.length - 1) % 2); b >= a && !hit; b -= 2) {
          const p = parts.slice(a, b + 1).join('');
          if (!CYR.test(p)) { if (b === a) hit = [p, b]; continue; }
          if (p === k) continue; // целиком уже искали
          const v = exact(p, i) ?? sub(p, i);
          if (v !== p) { hit = [v, b]; break; }
          // кусок вместе со скобками вокруг: «(слой скрыт)»
          const pre = parts[a - 1] || '', post = parts[b + 1] || '';
          if (pre.includes('(') && post.includes(')')) {
            const w2 = exact('(' + p + ')', i);
            if (w2 != null && w2[0] === '(' && w2.endsWith(')')) { hit = [w2.slice(1, -1) + post, b + 1]; break; } // «(» уже в out
          }
        }
        if (hit) { if (CYR.test(parts[a])) any = true; out += hit[0]; a = hit[1] + 1; continue; }
        if (!/^[«"“][^»"”]*[»"”]$/.test(parts[a].trim())) ok = false;
        out += parts[a++];
      }
      if (ok && any) return out;
    }
    if (spare != null) return spare;
    if (noFrag) return null;
    if (fragRe === undefined) {
      const keys = [...frags.keys()].sort((a, b) => b.length - a.length).map(esc);
      fragRe = keys.length ? new RegExp('(?<![А-Яа-яЁёA-Za-z0-9])(?:' + keys.join('|') + ')(?![А-Яа-яЁёA-Za-z0-9])', 'g') : null;
    }
    if (fragRe) {
      let hit = false, short = false;
      const out = k.replace(fragRe, (m) => { const v = frags.get(m); if (v && v[i]) { hit = true; if (m.length < 6) short = true; return v[i]; } return m; });
      // Осталось русское (имя пользователя — можно), но переведены короткие слова вроде «для» —
      // это смесь языков посреди фразы («темы for песен»): лучше оставить строку как есть
      // Можно оставить русское только в «кавычках» или после «Заголовок: » (имена пользователя)
      const rest = out.replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, '');
      const ci = rest.indexOf(': ');
      if (hit && (!CYR.test(rest) || (!short && ci > 0 && !CYR.test(rest.slice(0, ci))))) return out;
    }
    return null;
  }

  // Перевод строки на текущий язык (пробелы по краям сохраняются)
  function t(s, onlyExact) {
    if (lang === 'ru' || s == null) return s;
    s = String(s);
    if (!CYR.test(s)) return s;
    const ck = onlyExact ? '\u0002' + s : s;
    let r = cache.get(ck);
    if (r !== undefined) return r;
    const k = normNl(s);
    const v = lookup(k, IDX[lang], onlyExact);
    if (v == null) r = s;
    else {
      const lead = /^\s/.test(s) ? ' ' : '';
      const trail = /\s$/.test(s) ? ' ' : '';
      r = lead + v + trail;
    }
    cache.set(ck, r);
    return r;
  }

  /* ----- Перевод того, что на экране ----- */
  const orig = new WeakMap(); // текстовый узел → русский текст
  const wrote = new WeakMap(); // текстовый узел → что записали мы
  const aorig = new WeakMap(); // элемент → { атрибут: русский }
  const awrote = new WeakMap(); // элемент → { атрибут: что записали мы }
  const mode = (el) => {
    const m = el && el.closest('[data-i18n]');
    return m ? m.getAttribute('data-i18n') : '';
  };

  function doText(n, force) {
    const cur = n.data;
    const w = wrote.get(n);
    let ru;
    if (w !== undefined && w === cur) { if (!force) return; ru = orig.get(n); } else ru = cur;
    if (ru == null || !CYR.test(ru)) { orig.delete(n); wrote.delete(n); return; }
    const el = n.parentElement;
    if (!el || el.closest(SKIP_TEXT)) return;
    orig.set(n, ru);
    const tr = lang === 'ru' ? ru : t(ru, mode(el) === 'exact');
    wrote.set(n, tr);
    if (tr !== cur) n.data = tr;
  }

  function doAttr(el, a, force) {
    const cur = el.getAttribute(a);
    if (cur == null) return;
    const w = awrote.get(el);
    let ru;
    if (w && w[a] === cur) { if (!force) return; ru = (aorig.get(el) || {})[a]; } else ru = cur;
    const o = aorig.get(el) || {};
    if (ru == null || !CYR.test(ru)) { delete o[a]; if (w) delete w[a]; return; }
    if (el.closest(SKIP_ATTR)) return;
    o[a] = ru;
    aorig.set(el, o);
    const tr = lang === 'ru' ? ru : t(ru, mode(el) === 'exact');
    const ww = w || {};
    ww[a] = tr;
    awrote.set(el, ww);
    if (tr !== cur) el.setAttribute(a, tr);
  }

  function walk(root, force) {
    if (root.nodeType === 3) { doText(root, force); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (root.closest(SKIP_ATTR)) return;
      for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a, force);
    }
    const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP_ATTR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n = it.nextNode();
    while (n) {
      if (n.nodeType === 3) doText(n, force);
      else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a, force);
      n = it.nextNode();
    }
  }

  const mo = new MutationObserver((recs) => {
    if (lang === 'ru') return;
    for (const r of recs) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttr(r.target, r.attributeName);
      else for (const n of r.addedNodes) walk(n);
    }
  });

  // Надписи из CSS (content: '…') — переводим отдельными правилами
  const CSS = {
    en: "#zoomPts:empty::before{content:'none'} .sl.extra .lbl::after{content:' · extra'}",
    et: "#zoomPts:empty::before{content:'pole'} .sl.extra .lbl::after{content:' · lisa'}",
  };
  let style;
  function applyCss() {
    if (!style) { style = document.createElement('style'); style.dataset.noi18n = ''; document.head.append(style); }
    style.textContent = CSS[lang] || '';
    document.documentElement.dataset.lang = lang;
    document.documentElement.lang = lang;
  }

  // <html data-i18n-manual> (окна вывода): экран целиком не переводим — только то, что код сам пропустит через I18n.t
  const manual = !!(document.documentElement && document.documentElement.hasAttribute('data-i18n-manual'));

  function start() {
    applyCss();
    if (manual) return;
    if (lang !== 'ru') walk(document.body || document.documentElement);
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    bindPicker();
    tellMain();
  }

  function tellMain() {
    try { if (window.api && window.api.setLang) window.api.setLang(lang); } catch { /* нет моста */ }
  }

  // Сменить язык сразу, без перезапуска
  function set(l) {
    if (l !== 'ru' && !(l in IDX)) l = 'ru';
    if (l === lang) return;
    lang = l;
    try { localStorage.setItem('cp.lang', l); } catch { /* нет хранилища */ }
    cache = new Map();
    applyCss();
    if (!manual) walk(document.body, true);
    syncPicker();
    tellMain();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: l }));
  }

  // Выбор языка: <select id="uiLang"> (Настройки → Оформление)
  function syncPicker() {
    const sel = document.getElementById('uiLang');
    if (sel) sel.value = lang;
  }
  function bindPicker() {
    const sel = document.getElementById('uiLang');
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = '1';
    if (!sel.options.length) for (const [id, name] of LANGS) sel.append(new Option(name, id));
    sel.value = lang;
    sel.addEventListener('change', () => set(sel.value));
  }

  // Русский текст элемента (как его написал код), даже если на экране перевод
  function src(el) {
    if (!el) return '';
    if (el.nodeType === 3) return orig.get(el) ?? el.data;
    let s = '';
    const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) s += orig.get(n) ?? n.data;
    return s;
  }

  // Язык сменили в окне оператора — другие окна программы (вывод, «Картинка») переходят сами
  if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === 'cp.lang' && e.newValue) set(e.newValue); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else queueMicrotask(start);

  const LOC = { ru: 'ru-RU', en: 'en-GB', et: 'et-EE' };
  return { t: (s) => t(s), add, set, src, get lang() { return lang; }, get loc() { return LOC[lang]; }, get manual() { return manual; }, LANGS };
})();
