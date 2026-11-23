/* Анимация цветов на всю программу (по образцу «Invite people», те же пружины).
   Пружины «жёсткость затухание» — как в tokens.css образца:
     pop 520 16 — кружок выскочил / приземлился; soft 260 24 — соседи отъезжают;
     fade 420 32 — надписи; settle 280 22 — кружок под мышью приподнимается.
   ColorFly.fly({ from, to, color, label, onLand }) — цвет выходит из from «таблеткой» с надписью,
     сжимается в кружок, по дуге летит в to и садится с пружинкой;
   ColorFly.row(box) — ряд кружков: .before() до перерисовки, .after({ hold, enter }) после —
     оставшиеся плавно переезжают, новые выскакивают, убранные сжимаются; .land(key), .pick(el);
     ключ кружка — data-cfk;
   ColorFly.roll(el, h) — строчка, которая сменяется прокруткой (.set(text)). */
const ColorFly = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SP = { pop: [520, 16], soft: [260, 24], fade: [420, 32], settle: [280, 22], out: [680, 40] };
  const STAGGER = 0.045; // как --stagger: 45 мс между кружками
  const S = (x, sp) => { const s = { x, v: 0, t: x, k: 400, c: 30 }; if (sp) tune(s, ...sp); return s; };
  function tune(s, k, c) { s.k = k; s.c = reduce ? 2 * Math.sqrt(k) : c; }
  const step = (s, dt) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * dt; s.x += s.v * dt; };
  const still = (s) => Math.abs(s.x - s.t) < 0.004 && Math.abs(s.v) < 0.02;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const io = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const out3 = (u) => 1 - Math.pow(1 - u, 3);
  const mid = (r) => [r.left + r.width / 2, r.top + r.height / 2];

  // Один цикл кадров на всех; когда всё замерло — останавливается (не грузит программу впустую)
  const comps = new Set();
  let raf = 0;
  let last = 0;
  let inLoop = false;
  function loop(now) {
    const dt = clamp((now - last) / 1000, 0, 1 / 30); last = Math.max(last, now); // метка кадра бывает раньше, чем «разбудили»
    inLoop = true;
    for (const c of [...comps]) {
      try {
        for (let k = 0; k < 4; k++) c.frame(dt / 4);
        if (c.render() === false) comps.delete(c);
      } catch (e) { comps.delete(c); console.error('ColorFly', e); } // одна поломка не должна остановить остальные
    }
    inLoop = false;
    // кто-то мог разбудить другого прямо в этом кадре (цвет сел — ряд ожил), поэтому смотрим, кто остался
    raf = comps.size ? requestAnimationFrame(loop) : 0;
  }
  function wake(c) { comps.add(c); if (!raf && !inLoop) { last = performance.now(); raf = requestAnimationFrame(loop); } }

  // Нажатие: кружок чуть проседает (свойство scale — складывается с transform анимации)
  const ease0 = 'cubic-bezier(.23,1,.32,1)';
  function dip(bt) {
    if (!bt.animate) return;
    if (bt._cfp) bt._cfp.cancel();
    bt._cfp = bt.animate([{ scale: '1' }, { scale: '.94' }], { duration: 120, easing: ease0, fill: 'forwards' });
    const up = () => {
      removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (bt._cfp) bt._cfp.cancel();
      bt._cfp = bt.animate([{ scale: '.94' }, { scale: '1' }], { duration: 220, easing: ease0 });
    };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  // Строчка с прокруткой: старая уходит вверх и тает, новая въезжает снизу
  function roll(el, h) {
    let items = [];
    let cur = null;
    const c = {
      set(w) {
        if (w === cur) return;
        const up = cur == null ? 0 : 1;
        items.forEach((o) => { o.y.t = -h; o.o.t = 0; o.dead = true; tune(o.y, ...SP.out); });
        const sp = document.createElement('span'); sp.textContent = w; el.append(sp);
        const o = { el: sp, y: S(up * h, SP.fade), o: S(up ? 0 : 1, SP.fade) };
        o.y.t = 0; o.o.t = 1; items.push(o); cur = w;
        wake(c);
      },
      frame(dt) { items.forEach((o) => { step(o.y, dt); step(o.o, dt); }); },
      render() {
        items = items.filter((o) => { if (o.dead && o.o.x < 0.02) { o.el.remove(); return false; } return true; });
        let busy = false;
        items.forEach((o) => {
          const v = clamp(o.o.x, 0, 1);
          o.el.style.transform = `translateY(${o.y.x.toFixed(2)}px)`;
          o.el.style.opacity = v.toFixed(3);
          o.el.style.filter = v > 0.98 ? '' : `blur(${((1 - v) * 2).toFixed(2)}px)`;
          busy = busy || !still(o.y) || !still(o.o);
        });
        return busy;
      },
    };
    el.classList.add('cfly-roll');
    return c;
  }

  // Полёт цвета: 0–0,3 с «таблетка» с надписью сжимается в кружок, надпись тает;
  // 0,3–0,95 с кружок дугой летит к цели и садится
  function fly({ from, to, color, label = '', onLand }) {
    const tgt = () => (typeof to === 'function' ? to() : to);
    const fr = from && from.getBoundingClientRect ? from.getBoundingClientRect() : from;
    const t0 = tgt();
    if (reduce || !fr || !fr.width || !t0 || !t0.isConnected) { if (onLand) onLand(); return; }
    const el = document.createElement('div');
    el.className = 'cfly';
    el.setAttribute('popover', 'manual'); // в верхнем слое — поверх окон и окна «Цвета»
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="tx"></span><span class="av"><i></i></span>';
    el.firstChild.textContent = label;
    el.lastChild.firstChild.style.background = color;
    ((from && from.closest && from.closest('dialog[open]')) || document.body).append(el);
    try { el.showPopover(); } catch { /* старый движок — просто поверх */ }
    const tw = label ? el.firstChild.offsetWidth : 0;
    const w0 = label ? tw + 24 : 34;
    const [x0, y0] = mid(fr);
    let t = 0;
    const c = {
      frame(dt) { t += dt; },
      render() {
        const te = tgt();
        if (!te || !te.isConnected || t >= 0.95) {
          el.remove();
          if (onLand && te && te.isConnected) onLand();
          return false;
        }
        const tr = te.getBoundingClientRect();
        const [x1, y1] = mid(tr);
        const a = clamp(t / 0.3, 0, 1);
        const ea = out3(a);
        const u = io(clamp((t - 0.3) / 0.65, 0, 1));
        const s1 = Math.min(tr.width, tr.height) || 34;
        const sz = 34 + (s1 - 34) * u; // к концу — размер цели
        const w = (w0 + (34 - w0) * io(a)) * (1 - u) + sz * u;
        const arcH = clamp(Math.hypot(x1 - x0, y1 - y0) * 0.35, 16, 42);
        const arc = Math.sin(u * Math.PI);
        const cx = x0 + (x1 - x0) * u;
        const cy = y0 - ea * 4 * (1 - u) + (y1 - y0) * u - arc * arcH;
        el.style.width = w.toFixed(1) + 'px';
        el.style.height = sz.toFixed(1) + 'px';
        el.style.transform = `translate(${(cx - w / 2).toFixed(1)}px,${(cy - sz / 2).toFixed(1)}px) scale(${(1 + arc * 0.1).toFixed(3)})`;
        const tv = clamp(1 - a * 1.8, 0, 1);
        el.firstChild.style.opacity = tv.toFixed(3);
        el.firstChild.style.filter = tv > 0.98 ? '' : `blur(${((1 - tv) * 3).toFixed(2)}px)`;
        const p = label ? clamp((t - 0.22) / 0.25, 0, 1) : 1;
        const pop = p <= 0 ? 0 : 1 + Math.sin(p * Math.PI) * 0.18 * (1 - p) - (1 - p) * (1 - p);
        el.lastChild.style.transform = `scale(${Math.max(0, pop).toFixed(3)})`;
        return true;
      },
    };
    wake(c);
  }

  // Ряд кружков-цветов
  function row(box) {
    box.classList.add('cfly-row');
    const key = (e) => e.dataset && e.dataset.cfk;
    let items = []; // { el, X, Y, K, L, lean, wait }
    let ghosts = [];
    let prev = null;
    let hover = null;
    const find = (el) => items.find((it) => it.el === el);
    const c = {
      before() {
        prev = new Map();
        for (const it of items) if (it.el.isConnected) prev.set(key(it.el), { p: mid(it.el.getBoundingClientRect()), it, w: it.el.offsetWidth, h: it.el.offsetHeight });
        if (!items.length) for (const el of box.children) if (key(el)) prev.set(key(el), { p: mid(el.getBoundingClientRect()), w: el.offsetWidth, h: el.offsetHeight, el });
      },
      after({ hold = null, enter = false } = {}) {
        const now = [...box.children].filter(key);
        const had = prev;
        items = now.map((el, i) => {
          const it = { el, X: S(0, SP.soft), Y: S(0, SP.soft), K: S(1, SP.pop), L: S(0, SP.settle), lean: S(0, SP.settle), wait: 0 };
          const p = had && had.get(key(el));
          const held = hold && (hold instanceof Set ? hold.has(key(el)) : hold === key(el));
          if (p) {
            const [nx, ny] = mid(el.getBoundingClientRect());
            it.X.x = p.p[0] - nx; it.Y.x = p.p[1] - ny;
            if (p.it) { it.K.x = p.it.K.x; it.K.v = p.it.K.v; if (p.it.held) { it.held = true; it.K.t = 0; } }
          } else if (held) { it.K.x = 0; it.K.t = 0; it.held = true; }
          else if (had || enter) { it.K.x = 0.001; it.wait = enter ? i * STAGGER : 0; if (it.wait) it.K.t = 0.001; }
          if (!el._cfOn) {
            el._cfOn = true;
            el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = el; wake(c); } });
            el.addEventListener('pointerleave', () => { if (hover === el) { hover = null; wake(c); } });
            el.addEventListener('pointerdown', () => dip(el));
          }
          return it;
        });
        if (hover && !now.includes(hover)) hover = null;
        // убранные: копия на старом месте сжимается в точку
        if (had) for (const [k, p] of had) {
          if (now.some((e) => key(e) === k)) continue;
          const src = p.it ? p.it.el : p.el;
          if (!src) continue;
          const g = src.cloneNode(true);
          g.removeAttribute('data-cfk');
          g.classList.add('cfly-ghost');
          g.style.width = p.w + 'px'; g.style.height = p.h + 'px';
          box.append(g);
          const br = box.getBoundingClientRect();
          g.style.left = (p.p[0] - br.left - box.clientLeft - p.w / 2) + 'px';
          g.style.top = (p.p[1] - br.top - box.clientTop - p.h / 2) + 'px';
          const K = S(p.it ? p.it.K.x : 1, SP.pop); K.t = 0;
          ghosts.push({ el: g, K });
        }
        prev = null;
        wake(c);
      },
      // кружок, который ждал полёта, садится: сплющен и распрямляется пружиной
      land(k) {
        const it = items.find((x) => key(x.el) === k);
        if (!it) return;
        it.held = false; it.K.x = 0.82; it.K.v = 0; it.K.t = 1; wake(c);
      },
      // выбрали — кружок «подпрыгивает»
      pick(el) {
        const it = find(el);
        if (!it || reduce) return;
        it.K.x = Math.min(it.K.x, 0.86); it.K.t = 1; wake(c);
      },
      el: (k) => items.map((x) => x.el).find((e) => key(e) === k) || null,
      frame(dt) {
        const hi = hover ? items.findIndex((x) => x.el === hover) : -1;
        const top = hi >= 0 ? hover.offsetTop : 0;
        items.forEach((it, i) => {
          if (it.wait > 0) { it.wait -= dt; if (it.wait <= 0) it.K.t = 1; }
          it.L.t = i === hi ? -5 : 0;
          it.lean.t = hi < 0 || i === hi || it.el.offsetTop !== top ? 0 : (i < hi ? -1 : 1) * Math.max(0, 6 - 2 * Math.abs(i - hi));
          step(it.X, dt); step(it.Y, dt); step(it.K, dt); step(it.L, dt); step(it.lean, dt);
        });
        ghosts.forEach((g) => step(g.K, dt));
      },
      render() {
        if (!box.isConnected) { items = []; ghosts = []; return false; }
        ghosts = ghosts.filter((g) => { if (g.K.x < 0.02) { g.el.remove(); return false; } g.el.style.transform = `scale(${Math.max(0, g.K.x).toFixed(3)})`; return true; });
        let busy = ghosts.length > 0;
        for (const it of items) {
          const lift = it.L.x;
          const k = Math.max(0, it.K.x * (1 - lift * 0.016));
          const moving = !(still(it.X) && still(it.Y) && still(it.K) && still(it.L) && still(it.lean)) || it.wait > 0;
          if (moving || it.held) {
            busy = busy || moving;
            it.el.style.transform = `translate(${(it.X.x + it.lean.x).toFixed(1)}px,${(it.Y.x + lift).toFixed(2)}px) scale(${k.toFixed(3)})`;
          } else if (hover === it.el) it.el.style.transform = `translateY(${lift.toFixed(2)}px) scale(${k.toFixed(3)})`;
          else it.el.style.transform = '';
        }
        return busy;
      },
    };
    return c;
  }

  // Цвет «сел» в кнопку: она сплющивается и распрямляется пружиной
  function bump(el) {
    if (!el || !el.isConnected || reduce) return;
    if (el._cfb) comps.delete(el._cfb);
    const K = S(0.84, SP.pop); K.t = 1;
    const c = {
      frame(dt) { step(K, dt); },
      render() {
        if (!el.isConnected || still(K)) { el.style.scale = ''; el._cfb = null; return false; }
        el.style.scale = Math.max(0, K.x).toFixed(3);
        return true;
      },
    };
    el._cfb = c;
    wake(c);
  }

  // Кружки, которые просто появляются (меню и т. п.): выскакивают по очереди, под мышью приподнимаются
  function enter(box, sel = 'button') {
    const kids = [...box.querySelectorAll(sel)];
    kids.forEach((e, i) => { e.dataset.cfk = e.dataset.cfk || String(i); });
    const r = row(box);
    r.after({ enter: true });
    return r;
  }

  return { fly, row, roll, enter, bump, dip, reduce };
})();
