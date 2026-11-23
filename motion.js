/* Живой интерфейс на пружинах (по образцам designbookmark.com/motion):
   • «Morph tooltip» — одна подсказка на все кнопки: вместо системной (title) — своя, первая появляется
     с задержкой, дальше не исчезает, а перетекает к соседней кнопке: передний край на жёсткой пружине,
     задний — на мягкой, надпись уезжает и въезжает с лёгким размытием, хвостик едет следом.
   • «Toggle switch» — в оформлениях с «роликами» кружок на ходу вытягивается вперёд и садится с отскоком.
   • «Checkbox list» — обычные галочки и кружки (radio) при щелчке чуть «прыгают».
   • «Spring dropdown» — меню правой кнопки раскрывается шторкой с перелётом, пункты падают по очереди.
   • «Hold button» (нажатие) — кнопка под пальцем чуть приседает и отпружинивает.
   Свой цикл кадров идёт только пока что-то движется; в покое — ни одного кадра и ни одного замера. */
window.UiMotion = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = (x, k = 400, c = 30) => ({ x, v: 0, t: x, k, c: reduce ? 2 * Math.sqrt(k) : c }); // меньше движения в системе — без перелёта
  const tune = (s, k, c) => { s.k = k; s.c = reduce ? 2 * Math.sqrt(k) : c; };
  const step = (s, dt) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * dt; s.x += s.v * dt; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const calm = (s, e = .002) => Math.abs(s.x - s.t) < e && Math.abs(s.v) < e * 20;
  const settle = (s) => { s.x = s.t; s.v = 0; };

  // Общий цикл: у каждого движущегося — frame(dt) и render() → true, пока ему ещё нужно движение
  const live = new Set();
  let raf = 0, last = 0, dog = 0;
  function tick(dt) {
    for (const m of live) {
      for (let i = 0; i < 4; i++) m.frame(dt / 4);
      if (!m.render()) live.delete(m);
    }
  }
  function loop(now) {
    tick(Math.min((now - last) / 1000, 1 / 30)); last = now;
    raf = live.size ? requestAnimationFrame(loop) : 0;
  }
  // Окно свёрнуто или в фоне — кадров нет: досчитываем по таймеру, чтобы ничего не застряло на полпути
  // (меню полупрозрачным, кружок «ролика» сдвинутым)
  function watch() {
    dog = 0;
    if (!live.size) return;
    const gap = (performance.now() - last) / 1000;
    if (gap > .2) { for (let t = 0; t < Math.min(gap, 2); t += 1 / 60) tick(1 / 60); last = performance.now(); }
    if (live.size) dog = setTimeout(watch, 250);
  }
  function run(m) {
    live.add(m);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    if (!dog) dog = setTimeout(watch, 250);
  }

  /* ---------- Подсказка ---------- */
  const tip = (() => {
    let box, tail, labs = [], cur = null, prev = null, curText = '', showT = 0, hideT = 0, lastHide = 0, below = true, muted = null;
    const LEAD = [620, 36], TRAIL = [190, 19];
    const L = S(0, ...LEAD), R = S(0, ...LEAD), T = S(0, 300, 24), H = S(0, 300, 24), X = S(0, 300, 22), A = S(0, 420, 24);
    const GAP = 8, PADX = 9, PADY = 5, MAXW = 300;

    function build() {
      box = Object.assign(document.createElement('div'), { className: 'mo-tip' });
      box.setAttribute('role', 'tooltip');
      tail = Object.assign(document.createElement('i'), { className: 'mo-tip-tail' });
      document.body.append(tail, box);
      for (const el of [box, tail]) if (el.showPopover) el.popover = 'manual';
    }
    // в верхний слой — поверх открытых окон (<dialog>), и поверх тех, что открылись позже
    function raise() {
      for (const el of [tail, box]) if (el.showPopover) { try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch {} }
    }
    function measure(text) {
      // меряем вне подсказки: закрытая (popover) она display: none и ширины не даёт
      const m = Object.assign(document.createElement('span'), { className: 'mo-tip-lab', textContent: text });
      m.style.cssText = 'position:fixed;visibility:hidden;left:0;top:0;transform:none;max-width:' + (MAXW - PADX * 2) + 'px';
      document.body.append(m);
      const tw = Math.ceil(m.getBoundingClientRect().width) + 1;
      const r = { tw, w: tw + PADX * 2, h: Math.ceil(m.offsetHeight) + PADY * 2 };
      m.remove();
      return r;
    }
    function place(el, text, snap) {
      const r = el.getBoundingClientRect(), sz = measure(text);
      const vw = innerWidth, vh = innerHeight, cx = r.left + r.width / 2;
      below = r.bottom + GAP + sz.h + 6 <= vh || r.top - GAP - sz.h < 6;
      const top = below ? r.bottom + GAP : r.top - GAP - sz.h;
      const left = clamp(cx - sz.w / 2, 6, Math.max(6, vw - 6 - sz.w));
      const to = [[L, left], [R, left + sz.w], [T, top], [H, sz.h], [X, clamp(cx, left + 10, left + sz.w - 10)]];
      for (const [s, v] of to) { s.t = v; if (snap) settle(s); }
      return sz;
    }
    function label(text, dir, tw) {
      for (const l of labs) { l.o.t = 0; l.dir = -dir; }
      const el = Object.assign(document.createElement('span'), { className: 'mo-tip-lab', textContent: text });
      el.style.width = tw + 'px'; // своя ширина: пока рамка растягивается, строки не переносятся заново
      box.append(el);
      const l = { el, o: S(dir ? 0 : 1, 420, 32), dir };
      l.o.t = 1;
      labs.push(l);
    }
    function show(el, text) {
      clearTimeout(hideT); hideT = 0;
      if (!box) build();
      const was = clamp(A.x, 0, 1) > .3 && prev && prev.isConnected;
      let dir = 0;
      if (was) {
        const a = prev.getBoundingClientRect(), b = el.getBoundingClientRect();
        dir = Math.sign((b.left + b.width / 2) - (a.left + a.width / 2)) || Math.sign(b.top - a.top) || 1;
        const right = dir >= 0;
        tune(R, ...(right ? LEAD : TRAIL)); tune(L, ...(right ? TRAIL : LEAD));
        label(text, dir, place(el, text, false).tw);
      } else {
        tune(L, ...LEAD); tune(R, ...LEAD);
        const sz = place(el, text, true);
        for (const l of labs) l.el.remove();
        labs = [];
        label(text, 0, sz.tw);
        A.x = Math.min(A.x, 0); raise();
      }
      cur = prev = el; curText = text; A.t = 1;
      run(motion);
    }
    function hide(now) {
      clearTimeout(showT); showT = 0;
      if (!cur) return;
      clearTimeout(hideT);
      const go = () => { hideT = 0; cur = null; A.t = 0; lastHide = performance.now(); run(motion); };
      if (now) go(); else hideT = setTimeout(go, 140); // перешли через щель между кнопками — не мигаем
    }
    const motion = {
      frame(dt) { for (const s of [L, R, T, H, X, A]) step(s, dt); for (const l of labs) step(l.o, dt); },
      render() {
        const a = clamp(A.x, 0, 1.15), op = clamp(A.x, 0, 1);
        const l = Math.min(L.x, R.x - 24), w = R.x - l, h = Math.max(0, H.x);
        const lift = (1 - a) * (below ? -6 : 6);
        box.style.width = w.toFixed(2) + 'px';
        box.style.height = h.toFixed(2) + 'px';
        box.style.opacity = op.toFixed(3);
        box.style.transformOrigin = `${clamp(X.x - l, 0, w).toFixed(1)}px ${below ? 0 : '100%'}`;
        box.style.transform = `translate(${l.toFixed(2)}px,${(T.x + lift).toFixed(2)}px) scale(${(.72 + .28 * a).toFixed(4)})`;
        const tx = clamp(X.x, l + 10, l + w - 10), ty = below ? T.x - 4 : T.x + h - 5;
        tail.style.opacity = op.toFixed(3);
        tail.style.transform = `translate(${(tx - 5).toFixed(2)}px,${(ty + lift * 1.3).toFixed(2)}px) rotate(45deg) scale(${clamp(a, 0, 1).toFixed(3)})`;
        labs = labs.filter((lb) => {
          const o = clamp(lb.o.x, 0, 1);
          if (lb.o.t === 0 && o < .01) { lb.el.remove(); return false; }
          lb.el.style.opacity = o.toFixed(3);
          lb.el.style.transform = `translateX(${(lb.dir * (1 - o) * 14).toFixed(2)}px)`;
          lb.el.style.filter = o > .02 && o < .98 ? `blur(${((1 - o) * 3).toFixed(2)}px)` : '';
          return true;
        });
        const busy = [L, R, T, H, X, A].some((s) => !calm(s, .05)) || labs.some((lb) => !calm(lb.o));
        if (!busy && A.t === 0) {
          for (const el of [box, tail]) if (el.hidePopover) { try { el.hidePopover(); } catch {} }
          for (const lb of labs) lb.el.remove();
          labs = [];
        }
        return busy;
      },
    };

    // Источник — атрибут title. Пока над элементом, title снят (иначе вылезет и системная подсказка),
    // при уходе возвращается на место: код программы, читающий title, ничего не замечает
    let held = null, heldTitle = '';
    const watch = new MutationObserver(() => {
      if (!held || !held.hasAttribute('title')) return;
      heldTitle = held.getAttribute('title'); held.removeAttribute('title');
      if (!heldTitle) { hide(true); return; }
      if (cur === held && heldTitle !== curText) show(held, heldTitle);
    });
    function release() {
      if (!held) return;
      watch.disconnect();
      if (!held.hasAttribute('title')) held.setAttribute('title', heldTitle);
      held = null;
    }
    // Подсказка нужна не везде. Не показываем (и системную тоже — title на время наведения снят):
    // на слайдах (подпись «Библия», «Карты» — и так видно), на больших блоках (заголовки, панели),
    // и там, где title повторяет видимую надпись, — если только надпись не обрезана «…»
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    function cut(el) {
      if (el.scrollWidth > el.clientWidth + 1) return true;
      const kids = el.querySelectorAll('*');
      for (let i = 0; i < kids.length && i < 30; i++) if (kids[i].scrollWidth > kids[i].clientWidth + 1 && kids[i].clientWidth) return true;
      return false;
    }
    function needless(el, text) {
      if (el.closest('[data-no-tip], .mo-tip, .cpk-spec')) return true;
      if (el.closest('.sl') && !el.classList.contains('stale')) return true; // у «устаревшего» слайда — важная подсказка
      const r = el.getBoundingClientRect();
      if (r.width > 260 || r.height > 90) return true;
      const t = norm(text), own = norm(el.textContent);
      if (t && own && own.includes(t) && !cut(el)) return true;
      return false;
    }
    const IDLE = 1500; // мышь стоит на месте полторы секунды — тогда подсказка
    let mx = 0, my = 0;
    function arm(el, text) {
      clearTimeout(showT);
      showT = setTimeout(() => { showT = 0; if (held === el && el.isConnected && muted !== el && heldTitle) show(el, heldTitle); }, IDLE);
    }
    function over(e) {
      // внутри кнопки, у которой title уже снят, — это всё ещё она
      const el = held && held.contains(e.target) ? held : e.target.closest && e.target.closest('[title]');
      if (el === held) return;
      release();
      clearTimeout(showT); showT = 0;
      if (!el || !el.getAttribute('title') || e.pointerType === 'touch') { hide(false); return; }
      held = el; heldTitle = el.getAttribute('title');
      el.removeAttribute('title');
      watch.observe(el, { attributes: true, attributeFilter: ['title'] });
      el._moSkip = needless(el, heldTitle);
      if (el._moSkip) { hide(false); return; }
      if (muted === el) return; // по кнопке только что щёлкнули — не лезем, пока мышь не уйдёт
      // подсказка уже на экране (или только что была) — перетекает сразу, как системная; иначе ждём покоя
      if (cur || performance.now() - lastHide < 450) show(el, heldTitle); else arm(el, heldTitle);
    }
    document.addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) < 4) return;
      mx = e.clientX; my = e.clientY;
      if (showT && held && !cur) arm(held, heldTitle); // мышь ещё едет — отсчёт заново
    }, { capture: true, passive: true });
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) { release(); muted = null; hide(false); } }, true);
    document.addEventListener('pointerdown', () => { if (held) muted = held; hide(true); }, true);
    document.addEventListener('pointerover', (e) => { if (muted && !muted.contains(e.target)) muted = null; }, true);
    for (const ev of ['keydown', 'wheel', 'blur']) addEventListener(ev, () => hide(true), { capture: true, passive: true });
    // элемент под подсказкой убрали из окна (перестроили список) — не висим в пустоте
    setInterval(() => { if (cur && !cur.isConnected) { release(); hide(true); } }, 500);
    return { hide: () => hide(true) };
  })();

  /* ---------- Переключатели и галочки ---------- */
  const SWITCH = ['aura', 'amber', 'sunset', 'spectral'];
  function toggled(el) {
    if (el.indeterminate || reduce) return;
    const deco = document.documentElement.dataset.uiDeco;
    const isSwitch = el.type === 'checkbox' && SWITCH.includes(deco) && el.offsetWidth > el.offsetHeight * 1.4;
    if (isSwitch) {
      const k = getComputedStyle(el, '::before');
      const kw = parseFloat(k.width) || 10, inset = parseFloat(k.top) || 2;
      const travel = Math.max(0, el.clientWidth - kw - inset * 2);
      const m = el._moSw || (el._moSw = { p: S(0, 320, 18), g: S(0, 300, 20) });
      // p — сколько осталось проехать (в долях хода), g — вытягивание кружка; толчок, как в образце
      // (в долях хода, от нового места; щёлкнули на ходу — продолжает с того места, где был)
      m.p.x = clamp(m.p.x + (el.checked ? -1 : 1), -1, 1); m.p.t = 0;
      m.g.t = 0; m.g.v = 60;
      run({
        frame(dt) { step(m.p, dt); step(m.g, dt); },
        render() {
          const grow = clamp(m.g.x, 0, 1) * kw * .4, prog = clamp(1 - Math.abs(m.p.x), 0, 1);
          const dx = m.p.x * travel - (el.checked ? grow * prog : 0);
          if (calm(m.p) && calm(m.g)) { settle(m.p); settle(m.g); el.style.removeProperty('--sw-dx'); el.style.removeProperty('--sw-g'); return false; }
          el.style.setProperty('--sw-dx', dx.toFixed(2) + 'px');
          el.style.setProperty('--sw-g', grow.toFixed(2) + 'px');
          return el.isConnected;
        },
      });
      return;
    }
    // галочка/кружок: «прыжок» (сжатие и отскок)
    const p = el._moPop || (el._moPop = S(1, 520, 13));
    p.x = el.checked ? .7 : .85; p.v = 5; p.t = 1;
    run({
      frame(dt) { step(p, dt); },
      render() {
        if (calm(p)) { settle(p); el.style.scale = ''; return false; }
        el.style.scale = p.x.toFixed(4);
        return el.isConnected;
      },
    });
  }
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input[type=checkbox], input[type=radio]') && e.isTrusted) toggled(t);
  }, true);

  /* ---------- Нажатие кнопки ---------- */
  const presses = new Map();
  function press(btn, down) {
    let m = presses.get(btn);
    if (!m) {
      if (!down) return;
      if (btn.style.scale) return; // кнопку уже ведёт другая анимация (кружки цветов)
      const r = btn.getBoundingClientRect(), big = Math.max(r.width, r.height);
      if (!big || big > 420) return;
      m = { s: S(1, 520, 20), depth: clamp(3 / big, .02, .06) };
      presses.set(btn, m);
      run({
        frame(dt) { step(m.s, dt); },
        render() {
          if (m.s.t === 1 && calm(m.s, .0005)) { btn.style.scale = ''; presses.delete(btn); return false; }
          btn.style.scale = m.s.x.toFixed(4);
          return true;
        },
      });
    }
    if (down) m.s.t = 1 - m.depth; else { m.s.t = 1; m.s.v += 1.2 * m.depth / .04; }
  }
  const pressable = (t) => t && t.closest && t.closest('button:not(:disabled), .btn');
  document.addEventListener('pointerdown', (e) => {
    if (e.button || reduce) return;
    const b = pressable(e.target);
    if (!b || b.closest('[data-no-press], .gl-pill, .wh-col')) return;
    press(b, true);
    const up = () => { press(b, false); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); };
    addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
  }, true);

  /* ---------- Меню: шторка с перелётом и пункты по очереди ---------- */
  function drop(menu, opt = {}) {
    if (!menu || reduce) return;
    const up = !!opt.up; // меню выше места щелчка — раскрывается снизу вверх
    const H = S(0, 300, 23);
    H.t = 1;
    const rows = [...menu.children].filter((c) => !c.classList.contains('gl-pill'));
    const n = Math.min(rows.length, 12);
    const rs = rows.map((el, i) => ({ el, s: S(0, 300, 24), at: .03 + Math.min(i, n) * .028 }));
    let clock = 0;
    menu.style.transformOrigin = up ? '50% 100%' : '50% 0';
    run({
      frame(dt) {
        clock += dt; step(H, dt);
        for (const r of rs) { if (clock >= r.at) r.s.t = 1; step(r.s, dt); }
      },
      render() {
        if (!menu.isConnected) return false;
        const h = H.x, cut = clamp((1 - h) * 100, -10, 100).toFixed(2) + '%';
        menu.style.clipPath = up ? `inset(${cut} -10% -10% -10%)` : `inset(-10% -10% ${cut} -10%)`;
        menu.style.transform = `scaleX(${(.94 + .06 * clamp(h, 0, 1.04)).toFixed(4)})`;
        let busy = !calm(H);
        for (const r of rs) {
          const s = r.s.x;
          r.el.style.opacity = clamp(s, 0, 1).toFixed(3);
          r.el.style.translate = `0 ${((s - 1) * (up ? -8 : 8)).toFixed(2)}px`;
          if (!calm(r.s) || r.s.t === 0) busy = true;
        }
        if (!busy) {
          menu.style.clipPath = menu.style.transform = menu.style.transformOrigin = '';
          for (const r of rs) { r.el.style.opacity = ''; r.el.style.translate = ''; }
          if (menu._glide) menu._glide.update(true); // подсветка — на свои места после езды
        }
        return busy;
      },
    });
  }

  /* ---------- Появление: раздел, окно; «прыжок» слайда, ушедшего на экран ---------- */
  // enter — проявляется и подъезжает (по образцу «Morph popover»): прозрачность, сдвиг и масштаб на пружине.
  // Только отдельные свойства opacity / translate / scale — свой transform элемента не трогаем; в конце всё снимается
  function enter(el, { dy = 8, from = .985, k = 380, c = 30 } = {}) {
    if (!el || reduce) return;
    if (el._moEnter) el._moEnter.stop = true;
    const s = S(0, k, c), m = { stop: false };
    s.t = 1; el._moEnter = m;
    run({
      frame(dt) { step(s, dt); },
      render() {
        const done = m.stop || calm(s) || !el.isConnected;
        if (done) {
          if (!m.stop) { el.style.opacity = el.style.translate = el.style.scale = ''; el._moEnter = null; }
          return false;
        }
        el.style.opacity = clamp(s.x * 1.4, 0, 1).toFixed(3);
        el.style.translate = `0 ${((1 - s.x) * dy).toFixed(2)}px`;
        el.style.scale = (from + (1 - from) * s.x).toFixed(4);
        return true;
      },
    });
  }
  // pop — сжался и отпружинил (выбранная кнопка, слайд, только что ушедший на экран)
  function pop(el, from = .96) {
    if (!el || reduce || el.style.scale) return;
    const s = S(from, 520, 16);
    s.t = 1; s.v = (1 - from) * 40; // толчок по силе сжатия: слабый прыжок — и отскок слабее
    run({
      frame(dt) { step(s, dt); },
      render() {
        if (calm(s, .0008) || !el.isConnected) { el.style.scale = ''; return false; }
        el.style.scale = s.x.toFixed(4);
        return true;
      },
    });
  }
  // Любое окно (<dialog>) раскрывается из лёгкого уменьшения, а не возникает рывком
  for (const fn of ['showModal', 'show']) {
    const orig = HTMLDialogElement.prototype[fn];
    if (!orig) continue;
    HTMLDialogElement.prototype[fn] = function (...a) {
      const was = this.open;
      const r = orig.apply(this, a);
      if (!was && !this.hasAttribute('data-no-anim')) enter(this, { dy: 10, from: .94, k: 420, c: 28 });
      return r;
    };
  }

  /* ---------- Каскад: строки появляются по очереди (раскрыли блок, открыли плейлист) ---------- */
  // Анимируются только видимые в окне (не больше max) — за краем ничего не считаем
  function cascade(list, { dy = 10, gap = .024, max = 18, k = 340, c = 28 } = {}) {
    if (reduce) return;
    const vh = innerHeight, vw = innerWidth;
    const els = [];
    for (const el of list) {
      if (els.length >= max) break;
      if (!el || !el.isConnected || el._moEnter) continue;
      const r = el.getBoundingClientRect();
      if (!r.height || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      els.push(el);
    }
    if (!els.length) return;
    const rs = els.map((el, i) => { el.style.opacity = '0'; return { el, s: S(0, k, c), at: i * gap }; });
    let clock = 0;
    run({
      frame(dt) { clock += dt; for (const r of rs) { if (clock >= r.at) r.s.t = 1; step(r.s, dt); } },
      render() {
        let busy = false;
        for (const r of rs) {
          const s = r.s.x;
          if (r.s.t === 1 && calm(r.s)) { r.el.style.opacity = r.el.style.translate = ''; continue; }
          busy = true;
          r.el.style.opacity = clamp(s * 1.3, 0, 1).toFixed(3);
          r.el.style.translate = `0 ${((1 - s) * dy).toFixed(2)}px`;
        }
        return busy;
      },
    });
  }
  // Блок раскрыли (сняли класс fold) — его строки выезжают по очереди
  function foldWatch(box, rows) {
    if (!box) return;
    let was = box.classList.contains('fold');
    new MutationObserver(() => {
      const now = box.classList.contains('fold');
      if (was && !now) queueMicrotask(() => cascade(rows()));
      was = now;
    }).observe(box, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- Выпадающий список: новое значение «накатывает» снизу (по образцу «Spring dropdown») ---------- */
  function roll(el, dir = 1) {
    if (!el || reduce || !el.isConnected) return;
    const s = S(0, 420, 26);
    s.t = 1;
    run({
      frame(dt) { step(s, dt); },
      render() {
        if (calm(s) || !el.isConnected) { el.style.translate = el.style.opacity = ''; return false; }
        el.style.translate = `0 ${((1 - s.x) * 6 * dir).toFixed(2)}px`;
        el.style.opacity = clamp(.35 + .65 * s.x, 0, 1).toFixed(3);
        return true;
      },
    });
  }
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.tagName === 'SELECT' && e.isTrusted && !t.closest('[data-no-anim]')) {
      const el = t;
      queueMicrotask(() => roll(el)); // список перестроили (отключён) — ничего не делает
    }
  }, true);

  /* ---------- Значок кнопки сменился (▶ ↔ ❚❚) — новый поворачивается и встаёт на место ---------- */
  function iconSwap(btn) {
    if (!btn) return;
    let prev = btn.textContent;
    new MutationObserver(() => {
      const now = btn.textContent;
      if (now === prev) return; // текст переписали тем же — не дёргаем
      prev = now;
      if (reduce) return;
      const s = S(0, 300, 17);
      s.t = 1;
      run({
        frame(dt) { step(s, dt); },
        render() {
          if (calm(s) || !btn.isConnected) { btn.style.rotate = ''; return false; }
          btn.style.rotate = ((1 - s.x) * -90).toFixed(2) + 'deg';
          return true;
        },
      });
    }).observe(btn, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- Перемотка: над шкалой — время в точке под мышью, пузырёк едет за курсором ---------- */
  const secOf = (txt) => { const p = String(txt || '').trim().split(':').map(Number); if (p.some((n) => !Number.isFinite(n))) return NaN; return p.reduce((a, n) => a * 60 + n, 0); };
  const fmtSec = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  function seekTip(range, endEl) {
    if (!range || !endEl) return;
    let bub = null, on = false;
    const X = S(0, 520, 34), A = S(0, 420, 28);
    const m = {
      frame(dt) { step(X, dt); step(A, dt); },
      render() {
        const a = clamp(A.x, 0, 1);
        bub.style.opacity = a.toFixed(3);
        bub.style.transform = `translate(${X.x.toFixed(2)}px, ${bub._y}px) translateX(-50%) scale(${(.8 + .2 * a).toFixed(4)})`;
        const busy = !calm(X, .05) || !calm(A);
        if (!busy && A.t === 0 && bub.hidePopover) { try { bub.hidePopover(); } catch {} }
        return busy;
      },
    };
    function move(e) {
      const dur = secOf(endEl.textContent);
      if (!(dur > 0)) return hide();
      if (!bub) {
        bub = Object.assign(document.createElement('div'), { className: 'mo-seek' });
        if (bub.showPopover) bub.popover = 'manual';
        document.body.append(bub);
      }
      const r = range.getBoundingClientRect();
      const f = clamp((e.clientX - r.left) / r.width, 0, 1);
      bub.textContent = fmtSec(f * dur);
      bub._y = Math.round(r.top - 26);
      X.t = clamp(e.clientX, 24, innerWidth - 24);
      if (!on) { on = true; X.x = X.t; X.v = 0; A.t = 1; if (bub.showPopover) { try { if (!bub.matches(':popover-open')) bub.showPopover(); } catch {} } }
      run(m);
    }
    function hide() { if (!on) return; on = false; A.t = 0; run(m); }
    range.addEventListener('pointermove', move);
    range.addEventListener('pointerleave', hide);
    for (const ev of ['wheel', 'scroll', 'blur']) addEventListener(ev, hide, { capture: true, passive: true }); // панель прокрутили, окно ушло в фон
    range.addEventListener('pointerdown', move);
  }

  // Подключение к постоянным местам главного окна
  function boot() {
    const $ = (id) => document.getElementById(id);
    foldWatch($('layersBox'), () => $('lyRows') ? $('lyRows').children : []);
    foldWatch($('tmBox'), () => $('tmRows') ? $('tmRows').children : []);
    foldWatch($('mcQuick'), () => [...$('mcQuick').children].slice(1));
    iconSwap($('playPause')); iconSwap($('vPlay'));
    seekTip($('seek'), $('timeEnd')); seekTip($('vSeek'), $('vTimeEnd'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // Слайд щёлкнули мышью только что — «прыжок» полный; листают стрелками — слабее
  let slideClickT = -1e9;
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.sl')) slideClickT = performance.now(); }, true);
  const slidePop = (el) => pop(el, performance.now() - slideClickT < 700 ? .965 : .979);

  return { drop, tip, enter, pop, slidePop, cascade, roll };
})();
