/* Колесо выбора (как Wheel picker из Kokonut UI, MIT) и окно «Время таймера» на колёсах.
   Геометрия и движение — как в оригинале: строка 36 px, 20° на строку, радиус 102 px, перспектива 1000;
   пружина щелчка/доводки — duration .4 / bounce .15 (≈ жёсткость 139, затухание 20), бросок — жёсткость 140, затухание 24, накат .32 с;
   колесо мыши — 0,4 строки на 36 px, доводка через 120 мс; тап — asin(смещение / радиус). Цвета — переменные темы.
   Wheel.create({ options:[{value,label}], value, loop, label, onChange }) → { el, get(), set(v) }
   WheelTime.pop({ anchor, key, sec, h, m, s, onChange }) — окошко над полем, часы 0–23 (24 часа), минуты и секунды 0–59; применяется сразу. */
(function () {
  const IH = 36, ANG = 20, WIN = 5;
  const R = Math.round(18 / Math.tan((10 * Math.PI) / 180) * 100) / 100;
  const VH = Math.round(2 * R) + 18;
  const SLOP = 4, VEL_MS = 80, COAST = 0.32;
  const mod = (a, n) => ((a % n) + n) % n;
  const damp = (d) => 1.2 * (1 - Math.exp(-d / 1.2));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const SNAP = { stiffness: 139, damping: 20, rest: 0.001 };
  const FLICK = { stiffness: 140, damping: 24, rest: 0.005 };

  function create(o) {
    const opts = o.options || [];
    const n = opts.length;
    const loop = !!o.loop;
    let p = Math.max(0, opts.findIndex((x) => x.value === o.value));
    let lastC = null, lastSel = null, raf = 0, wheelT = 0;

    const col = document.createElement('div');
    col.className = 'wh-col';
    col.tabIndex = 0;
    col.setAttribute('role', 'spinbutton');
    if (o.label) col.setAttribute('aria-label', o.label);
    col.setAttribute('aria-valuemin', '0');
    col.setAttribute('aria-valuemax', String(n - 1));
    col.style.height = VH + 'px';
    const band = document.createElement('div');
    band.className = 'wh-band';
    const mask = document.createElement('div');
    mask.className = 'wh-mask';
    const mk = (cls) => {
      const wrap = document.createElement('div');
      wrap.className = 'wh-persp ' + cls;
      const drum = document.createElement('div');
      drum.className = 'wh-drum';
      wrap.append(drum);
      mask.append(wrap);
      return drum;
    };
    const dimDrum = mk('wh-dim');
    const hiDrum = mk('wh-hi');
    const tick = (side) => { const t = document.createElement('span'); t.className = 'wh-tick ' + side; return t; };
    col.append(band, mask, tick('l'), tick('r'));

    const idxOk = (i) => loop || (i >= 0 && i < n);
    function rows(drum, c) {
      const frag = document.createDocumentFragment();
      for (let i = c - WIN; i <= c + WIN; i++) {
        if (!idxOk(i)) continue;
        const r = document.createElement('div');
        r.className = 'wh-row';
        r.style.transform = `rotateX(${-i * ANG}deg) translateZ(${R}px)`;
        r.textContent = opts[mod(i, n)].label;
        frag.append(r);
      }
      drum.replaceChildren(frag);
    }
    function paint() {
      const c = Math.round(p);
      if (c !== lastC) {
        rows(dimDrum, c);
        rows(hiDrum, c);
        if (lastC != null && touchOn && navigator.vibrate) try { navigator.vibrate(1); } catch {}
        lastC = c;
        const sel = opts[mod(c, n)] || opts[0];
        col.setAttribute('aria-valuenow', String(mod(c, n)));
        col.setAttribute('aria-valuetext', sel ? sel.label : '');
      }
      const tr = `translateZ(${-R}px) rotateX(${p * ANG}deg)`;
      dimDrum.style.transform = tr;
      hiDrum.style.transform = tr;
    }
    const clampI = (i) => (loop ? i : Math.max(0, Math.min(n - 1, i)));
    function settle() {
      const i = mod(Math.round(p), n);
      if (!loop) p = Math.round(p);
      paint();
      if (i !== lastSel) { lastSel = i; if (o.onChange) o.onChange(opts[i].value); }
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }
    // Пружина: полунеявный Эйлер шагами по 1/240 с
    function spring(target, cfg, v0) {
      stop();
      if (reduced()) { p = target; settle(); return; }
      let v = v0 || 0, t0 = performance.now();
      const step = (now) => {
        let dt = Math.min(0.064, (now - t0) / 1000);
        t0 = now;
        while (dt > 0) {
          const h = Math.min(dt, 1 / 240);
          v += (-cfg.stiffness * (p - target) - cfg.damping * v) * h;
          p += v * h;
          dt -= h;
        }
        if (Math.abs(p - target) < cfg.rest && Math.abs(v) < cfg.rest * 10) { p = target; raf = 0; settle(); return; }
        paint();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    const goTo = (i) => spring(clampI(i), SNAP);

    // Мышь и палец
    let drag = null, touchOn = false;
    col.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      touchOn = e.pointerType === 'touch';
      stop();
      clearTimeout(wheelT);
      col.setPointerCapture(e.pointerId);
      col.focus({ preventScroll: true });
      drag = { y: e.clientY, p, moved: false, s: [{ t: performance.now(), v: p }] };
    });
    col.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) < SLOP) return;
      drag.moved = true;
      let raw = drag.p - dy / IH;
      if (!loop) { if (raw > n - 1) raw = n - 1 + damp(raw - (n - 1)); else if (raw < 0) raw = -damp(-raw); }
      p = raw;
      paint();
      const now = performance.now();
      drag.s.push({ t: now, v: p });
      while (drag.s.length > 2 && now - drag.s[0].t > VEL_MS) drag.s.shift();
    });
    const up = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) {
        const rc = col.getBoundingClientRect();
        const ratio = Math.max(-1, Math.min(1, (e.clientY - (rc.top + rc.height / 2)) / R));
        goTo(Math.round(p) + Math.round((Math.asin(ratio) * 180) / Math.PI / ANG));
        return;
      }
      const now = performance.now();
      const a = d.s[0], b = d.s[d.s.length - 1];
      const el = (b.t - a.t) / 1000;
      const v = now - b.t > VEL_MS || el <= 0 ? 0 : (b.v - a.v) / el;
      const out = !loop && (p < 0 || p > n - 1);
      if (Math.abs(v) < 2 || out || reduced()) { goTo(Math.round(p)); return; }
      spring(clampI(Math.round(p + v * COAST)), FLICK, v);
    };
    col.addEventListener('pointerup', up);
    col.addEventListener('pointercancel', up);

    // Колесо мыши и тачпад
    col.addEventListener('wheel', (e) => {
      e.preventDefault();
      stop();
      let raw = p + (e.deltaY / IH) * 0.4;
      if (!loop) raw = Math.max(-0.4, Math.min(n - 1 + 0.4, raw));
      p = raw;
      paint();
      clearTimeout(wheelT);
      wheelT = setTimeout(() => goTo(Math.round(p)), 120);
    }, { passive: false });

    // Клавиши: ↑ ↓ — на 1, PageUp/PageDown — на 5, Home/End — к краям
    col.addEventListener('keydown', (e) => {
      const c = Math.round(p);
      let to = null;
      if (e.key === 'ArrowUp') to = c + 1;
      else if (e.key === 'ArrowDown') to = c - 1;
      else if (e.key === 'PageUp') to = c + 5;
      else if (e.key === 'PageDown') to = c - 5;
      else if (e.key === 'Home') to = c - mod(c, n);
      else if (e.key === 'End') to = c - mod(c, n) + n - 1;
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
      p = clampI(to);
      settle();
    });

    paint();
    lastSel = mod(Math.round(p), n);
    return {
      el: col,
      get: () => opts[mod(Math.round(p), n)].value,
      // Снаружи: по кругу — коротким путём
      set(val, anim = true) {
        const sel = opts.findIndex((x) => x.value === val);
        if (sel < 0) return;
        const cur = Math.round(p);
        let delta = sel - mod(cur, n);
        if (loop && Math.abs(delta) > n / 2) delta -= Math.sign(delta) * n;
        if (anim) goTo(cur + delta); else { stop(); p = cur + delta; settle(); }
      },
    };
  }

  const pad = (v) => String(v).padStart(2, '0');
  const range = (k) => Array.from({ length: k }, (_, i) => ({ value: i, label: pad(i) }));

  /* Всплывающее окошко над полем времени: без «Готово» — каждое выбранное значение сразу применяется (onChange).
     Закрывается щелчком мимо, Esc, Enter, сменой размера окна. key — чей это пикер: повторный щелчок по тому же полю
     сразу после закрытия не открывает его заново (WheelTime.recent(key)). */
  let cur = null, lastKey = null, lastAt = 0;
  function close() {
    if (!cur) return;
    const c = cur;
    cur = null;
    lastKey = c.key;
    lastAt = performance.now();
    document.removeEventListener('pointerdown', c.out, true);
    window.removeEventListener('resize', close);
    c.el.remove();
    if (c.onClose) c.onClose();
  }
  const recent = (key) => key != null && key === lastKey && performance.now() - lastAt < 400;
  function place(el, anchor) {
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
    const w = el.offsetWidth, h = el.offsetHeight, gap = 8, vw = innerWidth, vh = innerHeight;
    const cx = r.left + r.width / 2;
    const x = Math.max(8, Math.min(vw - w - 8, cx - w / 2));
    const up = r.top - gap - h >= 8 || r.bottom + gap + h > vh - 8; // по умолчанию — над полем
    const y = up ? Math.max(8, r.top - gap - h) : r.bottom + gap;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.classList.toggle('below', !up);
    el.style.setProperty('--ax', Math.max(14, Math.min(w - 14, cx - x)) + 'px');
  }
  // o: { anchor (элемент или {x,y}), key, sec, h, m, s, onChange({h,m,s}), onClose }
  function pop(o = {}) {
    close();
    const sec = !!o.sec;
    const r = { h: o.h | 0, m: o.m | 0, s: o.s | 0 };
    const el = document.createElement('div');
    el.className = 'ui-pop wh-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', sec ? 'Время таймера' : 'До какого времени');
    const root = document.createElement('div');
    root.className = 'wh-root';
    const cols = [];
    const addCol = (key, k, cap, label) => {
      const box = document.createElement('div');
      box.className = 'wh-cell';
      const c = document.createElement('div');
      c.className = 'wh-cap';
      c.textContent = cap;
      const w = create({ options: range(k), value: r[key], loop: true, label, onChange: (v) => { r[key] = v; if (o.onChange) o.onChange({ ...r }); } });
      box.append(c, w.el);
      root.append(box);
      cols.push(w);
    };
    const colon = () => { const c = document.createElement('div'); c.className = 'wh-colon'; c.textContent = ':'; root.append(c); };
    addCol('h', 24, 'часы', 'Часы, от 0 до 23');
    colon();
    addCol('m', 60, 'мин', 'Минуты');
    if (sec) { colon(); addCol('s', 60, 'сек', 'Секунды'); }
    el.append(root);
    el.title = 'Крутите колёсиком мыши, тяните или щёлкните по числу. Стрелки ↑ ↓ — по одному.';
    el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // горячие клавиши программы не срабатывают, пока крутим время
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = cols.findIndex((c) => c.el === document.activeElement);
        const n = cols[Math.max(0, Math.min(cols.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)))];
        if (n) { e.preventDefault(); n.el.focus(); }
      }
    });
    document.body.append(el);
    if (window.Icons && Icons.apply) try { Icons.apply(el); } catch {}
    place(el, o.anchor || { x: innerWidth / 2, y: innerHeight / 2 });
    const out = (e) => { if (!el.contains(e.target)) close(); };
    cur = { el, key: o.key, out, onClose: o.onClose };
    document.addEventListener('pointerdown', out, true);
    window.addEventListener('resize', close);
    cols[0].el.focus({ preventScroll: true });
    return { close, el };
  }

  window.Wheel = { create };
  window.WheelTime = { pop, close, recent, isOpen: (key) => !!cur && cur.key === key };
})();
