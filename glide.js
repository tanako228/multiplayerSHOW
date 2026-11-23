/* Скользящая подсветка на пружинах (по образцу «Segmented Control», designbookmark.com/motion).
   Выбранное — плашка .gl-sel, под мышью — плашка .gl-hov; обе не прыгают, а едут к новой кнопке
   и на ходу чуть сплющиваются от скорости. Пружины те же: положение — жёсткость 300, затухание 20
   (одна небольшая «перелётка»), появление и исчезание — 300 / 26.
   Glide.seg(контейнер, { items, axis, hover, sel, inset }) — группа кнопок (вкладки, переключатели);
   Glide.menu(меню) — вертикальное меню: подсветка под мышью и стрелками ↑ ↓.
   Своего цикла кадров нет, пока ничего не едет: requestAnimationFrame идёт только во время движения. */
window.Glide = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOVE = [300, 20], FADE = [300, 26];
  const S = (x) => ({ x, v: 0, t: x });
  const step = (s, dt, [k, c]) => {
    if (reduce) c = 2 * Math.sqrt(k); // без «перелёта», если в системе просят меньше движения
    const a = -k * (s.x - s.t) - c * s.v;
    s.v += a * dt; s.x += s.v * dt;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const still = (s, eps) => Math.abs(s.x - s.t) < eps && Math.abs(s.v) < eps * 4;

  // Общий цикл: только пока хоть одна плашка в движении
  const moving = new Set();
  let raf = 0, last = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (const p of moving) {
      for (let i = 0; i < 4; i++) p.frame(dt / 4); // 4 под-шага, как в образце
      if (p.rest()) { p.snap(); moving.delete(p); }
      p.render();
    }
    raf = moving.size ? requestAnimationFrame(loop) : 0;
  }
  function kick(p) {
    moving.add(p);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }

  // Плашка: положение, размер и прозрачность — каждое на своей пружине
  function pill(box, cls, axis) {
    const el = Object.assign(document.createElement('span'), { className: 'gl-pill ' + cls });
    el.setAttribute('aria-hidden', 'true');
    box.prepend(el);
    const x = S(0), y = S(0), w = S(0), h = S(0), o = S(0);
    const p = {
      el,
      frame(dt) { step(x, dt, MOVE); step(y, dt, MOVE); step(w, dt, MOVE); step(h, dt, MOVE); step(o, dt, FADE); },
      rest: () => still(x, .3) && still(y, .3) && still(w, .3) && still(h, .3) && still(o, .005),
      snap() { for (const s of [x, y, w, h, o]) { s.x = s.t; s.v = 0; } },
      render() {
        const op = clamp(o.x, 0, 1);
        el.style.opacity = op.toFixed(3);
        if (op <= 0 && o.t <= 0) return;
        // сплющивание от скорости: вдоль движения шире, поперёк — чуть тоньше
        const sp = clamp(Math.abs(axis === 'y' ? y.v : x.v) / 1400, 0, .22);
        const sx = axis === 'y' ? 1 - sp * .08 : 1 + sp, sy = axis === 'y' ? 1 + sp * .5 : 1 - sp * .5;
        el.style.width = Math.max(0, w.x).toFixed(2) + 'px';
        el.style.height = Math.max(0, h.x).toFixed(2) + 'px';
        el.style.transform = `translate(${x.x.toFixed(2)}px, ${y.x.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
      },
      // к прямоугольнику r; jump — сразу на месте (первый показ, смена размеров окна)
      to(r, jump) {
        const fresh = o.x < .05 && o.t < 1;
        x.t = r.x; y.t = r.y; w.t = r.w; h.t = r.h; o.t = 1;
        if (jump || fresh) { x.x = x.t; y.x = y.t; w.x = w.t; h.x = h.t; x.v = y.v = w.v = h.v = 0; }
        if (jump) { o.x = 1; o.v = 0; p.render(); } // сразу, не дожидаясь кадра
        kick(p);
      },
      hide(jump) { o.t = 0; if (jump) { o.x = 0; o.v = 0; p.render(); } kick(p); },
    };
    return p;
  }

  // Прямоугольник кнопки внутри контейнера (с учётом прокрутки контейнера)
  function rectIn(box, it, inset) {
    const b = box.getBoundingClientRect(), r = it.getBoundingClientRect();
    const i = inset || {};
    const x = r.left - b.left - box.clientLeft + box.scrollLeft + (i.l || 0);
    const y = r.top - b.top - box.clientTop + box.scrollTop + (i.t || 0);
    return { x, y, w: r.width - (i.l || 0) - (i.r || 0), h: r.height - (i.t || 0) - (i.b || 0) };
  }
  const isSel = (b) => ['aria-selected', 'aria-pressed', 'aria-current'].some((a) => b.getAttribute(a) === 'true') || b.classList.contains('on');
  const usable = (b) => b && !b.disabled && !b.hidden && b.offsetParent !== null;

  function seg(box, opt = {}) {
    if (!box || box._glide) return box && box._glide;
    const o = Object.assign({ items: ':scope > button', axis: 'x', hover: true, sel: true, sel_fn: isSel }, opt);
    box.classList.add('gl');
    if (['', 'static'].includes(getComputedStyle(box).position)) box.style.position = 'relative'; // плашки отсчитываются от контейнера
    const items = () => [...box.querySelectorAll(o.items)];
    // кнопка группы, на которой (или внутри которой) событие; closest(':scope > …') тут не годится
    const itemOf = (t) => { const list = items(); for (let n = t; n && n !== box; n = n.parentElement) if (list.includes(n)) return n; return null; };
    const hov = o.hover ? pill(box, 'gl-hov', o.axis) : null;
    const sel = o.sel ? pill(box, 'gl-sel', o.axis) : null;
    let hovOn = null, raf2 = 0;

    function update(jump) {
      if (!box.isConnected || box.offsetParent === null) return;
      if (sel) {
        const cur = items().find((b) => usable(b) && o.sel_fn(b));
        if (cur) sel.to(rectIn(box, cur, o.inset), jump); else sel.hide(jump);
      }
      if (hov && hovOn) { if (usable(hovOn)) hov.to(rectIn(box, hovOn, o.inset), jump); else { hovOn = null; hov.hide(); } }
    }
    const later = (jump) => { if (raf2) return; raf2 = requestAnimationFrame(() => { raf2 = 0; update(jump); }); };

    if (hov) {
      const point = (b) => {
        if (b === hovOn) return;
        hovOn = b;
        if (b) hov.to(rectIn(box, b, o.inset)); else hov.hide();
      };
      // После стрелок мышь забирает подсветку, только когда её правда сдвинули: иначе пункт под
      // неподвижным курсором перехватил бы подсветку (браузер шлёт pointerover и без движения)
      let kbd = false;
      const byPointer = (e) => { if (kbd) return; const b = itemOf(e.target); point(b && usable(b) ? b : null); };
      box.addEventListener('pointerover', byPointer);
      box.addEventListener('pointermove', (e) => { if (kbd && (e.movementX || e.movementY)) { kbd = false; byPointer(e); } });
      box.addEventListener('pointerleave', () => { if (!kbd) point(null); });
      box.addEventListener('focusin', (e) => {
        const b = itemOf(e.target);
        if (b && b.matches(':focus-visible')) point(b);
      });
      box.addEventListener('focusout', () => { if (!kbd && !box.matches(':hover')) point(null); });
      box._glidePoint = (b) => { kbd = true; point(b); };
      box._glideHov = () => hovOn;
    }
    // Выбор сменился (атрибуты кнопок) или кнопки перестроены — плашка едет к новой
    new MutationObserver(() => later(false)).observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'aria-current', 'class', 'hidden', 'disabled'] });
    // Размер изменился (окно, шрифт, показ скрытого) — сразу на месте, без езды
    new ResizeObserver(() => later(true)).observe(box);
    box.addEventListener('scroll', () => later(true), { passive: true });
    update(true);
    return (box._glide = { update, items });
  }

  // Вертикальное меню: подсветка под мышью, стрелки ↑ ↓, Home, End
  function menu(box) {
    const g = seg(box, { items: ':scope > button', axis: 'y', sel: false });
    if (!g) return g;
    box.classList.add('gl-menu');
    g.move = (d) => {
      const list = g.items().filter(usable);
      if (!list.length) return;
      // от пункта под подсветкой (мышью или стрелками), иначе — от того, что в фокусе
      const at = list.includes(box._glideHov()) ? list.indexOf(box._glideHov()) : list.indexOf(document.activeElement);
      const n = d === 'home' ? 0 : d === 'end' ? list.length - 1 : at < 0 ? (d > 0 ? 0 : list.length - 1) : (at + d + list.length) % list.length;
      list[n].focus({ preventScroll: false });
      box._glidePoint(list[n]);
    };
    return g;
  }

  // Постоянные группы главного окна
  function boot() {
    seg(document.querySelector('.tabs-side:not(.end)'), { items: ':scope > .tab', inset: { t: 5 } });
    document.querySelectorAll('.view-toggle, .dock-pos, #inkTools, #zoomTools, #inkWidths, #cpkTabs').forEach((b) => seg(b));
    document.querySelectorAll('.set-nav').forEach((b) => seg(b, { axis: 'y' }));
    document.documentElement.classList.add('gl-ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  return { seg, menu };
})();
