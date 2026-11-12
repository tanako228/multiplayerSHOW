/* Кнопки стилуса, блютус-кнопки и педали (планшет): назначить на ластик, предметы пенала, листание.
   Окно «Кнопки стилуса» (Сведения или «…» в пенале): «Добавить кнопку» → нажать кнопку на стилусе или клавишу → выбрать дело.
   Кнопка стилуса видна браузеру как бит e.buttons у пера (2 — боковая, 4/8/16 — другие); её ловим и в воздухе,
   и при касании. Блютус-кнопки, кольца, педали для нот нажимают клавиши (PageDown, стрелки, пробел) — их ловим по e.code.
   Предмет на кнопке: зажать и писать — этим предметом на время, нажать и отпустить — взять насовсем (ещё раз — вернуть
   прежний). Обратный конец стилуса — всегда ластик (pen.js). Листать кнопкой — в режиме «Листать самому» (и в пенале).
   Назначения — localStorage mps.sbtn: [{ s: 'p2' | 'k:PageDown', a: дело, n: подпись }]. */
'use strict';
const Stylus = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'mps.sbtn';
  const DEF = [{ s: 'p2', a: 'eraser', n: 'Боковая кнопка стилуса' }];
  const MORE = [['next', 'Следующий предмет (по кругу)'], ['down', 'Листать вниз'], ['up', 'Листать вверх'],
    ['blkNext', 'Следующий блок песни'], ['blkPrev', 'Предыдущий блок песни'], ['undo', 'Отменить пометку'], ['pen', 'Открыть / закрыть пенал']];
  const acts = () => [['', 'Ничего'], ...Pen.tools(), ...MORE];
  const isTool = (a) => Pen.tools().some(([id]) => id === a);
  const BITS = { 2: 'Боковая кнопка стилуса', 4: 'Вторая кнопка стилуса', 8: 'Кнопка стилуса «назад»', 16: 'Кнопка стилуса «вперёд»' };
  const KEYS = { ArrowDown: 'Стрелка вниз', ArrowUp: 'Стрелка вверх', ArrowLeft: 'Стрелка влево', ArrowRight: 'Стрелка вправо', PageDown: 'Page Down',
    PageUp: 'Page Up', Space: 'Пробел', Enter: 'Enter', Backspace: 'Backspace', Home: 'Home', End: 'End', AudioVolumeUp: 'Громкость +',
    AudioVolumeDown: 'Громкость −', MediaPlayPause: 'Пауза / пуск', MediaTrackNext: 'Следующий трек', MediaTrackPrevious: 'Предыдущий трек' };
  const SKIP = ['Escape', 'Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock'];

  let list = load();
  let canScroll = () => '';
  let learn = null;           // окно ждёт кнопку: fn(s, n)
  const held = new Map();     // зажатые кнопки с предметом: s → { a, t, downs }
  const last = new Map();     // перо: pointerId → прошлые e.buttons
  let penBtnAt = 0;

  function load() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(a)) return a.filter((b) => b && typeof b.s === 'string' && typeof b.a === 'string').map((b) => ({ s: b.s, a: b.a, n: String(b.n || b.s) }));
    } catch { /* нет */ }
    return DEF.map((b) => ({ ...b }));
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* приватный режим */ } }
  const find = (s) => list.find((b) => b.s === s && b.a);
  const keyName = (e) => KEYS[e.code] || (e.key && e.key.length === 1 ? 'Клавиша ' + e.key.toUpperCase() : 'Клавиша ' + (e.key || e.code));

  /* ----- Дела ----- */

  function press(s) {
    const b = find(s);
    if (!b) return false;
    if (isTool(b.a)) {
      held.set(s, { a: b.a, t: performance.now(), downs: Pen.downs });
      if (Pen.isOpen) Pen.setTemp(b.a);
      return true;
    }
    run(b.a);
    return true;
  }
  function release(s) {
    const h = held.get(s);
    if (!h) return;
    held.delete(s);
    const rest = [...held.values()];
    Pen.setTemp(rest.length ? rest[rest.length - 1].a : '');
    // Нажали и отпустили, ничего не написав, — взять предмет насовсем (пенал закрыт — открыть)
    if (Pen.downs === h.downs && performance.now() - h.t < 700) {
      if (!Pen.isOpen) Pen.open();
      Pen.take(h.a);
    }
  }
  function releaseAll() { for (const s of [...held.keys()]) release(s); }
  function run(a) {
    if (a === 'next') { if (!Pen.isOpen) Pen.open(); Pen.cycle(); return; }
    if (a === 'undo') { Pen.undo(); return; }
    if (a === 'pen') { if (Pen.isOpen) Pen.close(); else Pen.open(); return; }
    if (['down', 'up', 'blkNext', 'blkPrev'].includes(a)) {
      const no = canScroll();
      if (no) { toast(no); return; }
      if (a === 'down' || a === 'up') page(a === 'down' ? 1 : -1); else block(a === 'blkNext' ? 1 : -1);
    }
  }
  // Видимая часть страницы: под шапкой и над полосой «На экране»
  function frame() {
    let top = 0;
    for (const h of document.querySelectorAll('.bar, .tools')) { const r = h.getBoundingClientRect(); if (r.height && r.top <= 1) top = Math.max(top, r.bottom); }
    const lb = $('liveBar');
    const lr = lb && lb.getBoundingClientRect();
    const bot = lr && lr.height ? lr.top : innerHeight;
    return [top, Math.max(top + 100, bot)];
  }
  function page(dir) {
    const [top, bot] = frame();
    window.scrollBy({ top: dir * (bot - top) * 0.85, behavior: 'smooth' });
  }
  // К началу следующего / прошлого блока песни (куплет, припев)
  function block(dir) {
    const secs = [...document.querySelectorAll('#songBody .sl')].filter((x) => x.offsetParent);
    if (!secs.length) { page(dir); return; }
    const [top] = frame();
    const ys = secs.map((x) => x.getBoundingClientRect().top - top - 8);
    const y = dir > 0 ? ys.find((v) => v > 4) : ys.filter((v) => v < -4).pop();
    if (y == null) { page(dir); return; }
    window.scrollBy({ top: y, behavior: 'smooth' });
  }

  /* ----- Перо: кнопки по битам e.buttons ----- */

  function onPtr(e) {
    if (e.pointerType !== 'pen') return;
    const was = last.get(e.pointerId) || 0;
    const now = e.type === 'pointercancel' ? 0 : e.buttons;
    last.set(e.pointerId, now);
    const ch = was ^ now;
    if (!ch) return;
    let used = false;
    for (const bit of [2, 4, 8, 16]) {
      if (!(ch & bit)) continue;
      const s = 'p' + bit;
      if (now & bit) {
        penBtnAt = performance.now();
        if (learn) { learn(s, BITS[bit]); used = true; } else if (press(s)) used = true;
      } else release(s);
    }
    if (used && e.cancelable && e.type !== 'pointermove') e.preventDefault();
  }
  // Перо ушло из зоны над экраном с зажатой кнопкой — отпустить
  function onOut(e) {
    if (e.pointerType !== 'pen' || e.relatedTarget) return;
    last.delete(e.pointerId);
    releaseAll();
  }

  /* ----- Клавиши: блютус-кнопки, кольца, педали ----- */

  const typing = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable]');
  function onKey(e) {
    if (SKIP.includes(e.code) || !e.code) return;
    if (learn) {
      if (e.repeat) { e.preventDefault(); return; }
      e.preventDefault();
      e.stopPropagation();
      learn('k:' + e.code, keyName(e));
      return;
    }
    if (typing(e.target) || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const s = 'k:' + e.code;
    if (!find(s)) return;
    e.preventDefault();
    if (e.repeat) { const b = find(s); if (b.a === 'down' || b.a === 'up') run(b.a); return; }
    press(s);
  }
  function onKeyUp(e) { release('k:' + e.code); }

  /* ----- Окно «Кнопки стилуса» ----- */

  function paint() {
    const box = $('sbList');
    box.replaceChildren(...list.map((b, i) => {
      const row = document.createElement('div');
      row.className = 'row-i sb-row';
      const n = document.createElement('span');
      n.textContent = b.n;
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Что делает: ' + b.n);
      for (const [v, t] of acts()) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
      sel.value = b.a;
      sel.onchange = () => { b.a = sel.value; save(); };
      const x = document.createElement('button');
      x.className = 'icon';
      x.setAttribute('aria-label', 'Убрать кнопку: ' + b.n);
      x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'; // своя иконка
      x.onclick = () => { list.splice(i, 1); save(); paint(); };
      row.append(n, sel, x);
      return row;
    }));
    $('sbEmpty').hidden = list.length > 0;
  }
  function stopLearn() {
    learn = null;
    $('sbAdd').textContent = 'Добавить кнопку';
    $('sbAdd').classList.remove('wait');
  }
  function startLearn() {
    if (learn) { stopLearn(); return; }
    $('sbAdd').textContent = 'Нажмите кнопку на стилусе или клавишу… (ещё раз — отмена)';
    $('sbAdd').classList.add('wait');
    learn = (s, n) => {
      stopLearn();
      if (list.some((b) => b.s === s)) { toast(n + ' — уже в списке'); return; }
      list.push({ s, n, a: s.startsWith('p') ? 'eraser' : 'down' });
      save();
      paint();
      toast(n + ' — выберите, что она делает');
    };
  }
  function show() {
    stopLearn();
    paint();
    $('sbDlg').showModal();
  }

  function init(opts) {
    if (opts && opts.canScroll) canScroll = opts.canScroll;
    const cap = { capture: true, passive: false };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(t, onPtr, cap);
    window.addEventListener('pointerout', onOut, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', () => { releaseAll(); last.clear(); });
    // Боковая кнопка пера в Windows — «правый щелчок»: меню не показывать
    window.addEventListener('contextmenu', (e) => { if (performance.now() - penBtnAt < 1500) e.preventDefault(); }, true);
    const d = $('sbDlg');
    $('sbX').onclick = () => d.close();
    d.addEventListener('close', stopLearn);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    $('sbAdd').onclick = startLearn;
    $('sbReset').onclick = () => { list = DEF.map((b) => ({ ...b })); save(); stopLearn(); paint(); };
  }

  return { init, show };
})();
