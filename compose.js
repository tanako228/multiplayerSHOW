/* ===== Экраны и экранные сцены (Screens / Screen Scenes): отрисовка — общая для окон вывода и окна оператора =====
   Экран (lib.screens) — виртуальная область вывода со своим разрешением. Показывает:
     'program' — программу: слои Media Layers (можно не все — screen.layers), в своём разрешении или вписанную;
     'scene'   — экранную сцену (композицию из элементов), смена сцены — с переходом;
     'blank'   — ничего (чёрный).
   Поверх — цвет (яркость, контраст, насыщенность, гамма, температура, размытие). Поворот и отражение — у окна вывода.
   Выход (screen.outputs) — куда идёт картинка: монитор, окно, NDI (окна открывает main.js); экран без выходов — виртуальный.
   Макет (lib.scenePresets, «Пресеты сцен»): { id, name, w, h, bg?, trans, items, layers? }, элемент: { id, type, name, x, y, w, h, rot, … } — см. ITEM_TYPES.
   Сцена (lib.scenes) для окон — экран 'scene:id' с mode 'scene': свой размер и фон (s.bg, 'transparent' — прозрачный),
   s.scene — id макета (C.scenes[id]); макет вписывается в сцену, без своего фона — виден фон сцены.
   Прозрачный фон (s.alpha): у экрана-программы и сцены нет фона — видно только текст и элементы
   (в «Предпросмотре» — шахматка, внутри другой сцены — просвечивает, в NDI — альфа).
   Программа (что в слоях) у окна одна: Compose.progShow/progClear/progLayers/progInk/progVideo/progInfo;
   каждый «экран-программа» и элемент 'program' получает свою копию слоёв (с маской слоёв). */
const Compose = (() => {
  const make = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
  const NONE = { type: 'none', ms: 0 };

  const css = document.createElement('style');
  css.textContent = `
    .cmp-screen { position: absolute; left: 0; top: 0; overflow: hidden; background: #000; }
    .cmp-fill { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; }
    .cmp-prog { position: absolute; left: 0; top: 0; overflow: hidden; transform-origin: 0 0; }
    .cmp-scene { position: absolute; left: 0; top: 0; overflow: hidden; transform-origin: 0 0; }
    .cmp-it { position: absolute; transform-origin: 50% 50%; }
    .cmp-clip { position: absolute; inset: 0; overflow: hidden; }
    .cmp-c { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; }
    .cmp-c > img, .cmp-c > video { width: 100%; height: 100%; display: block; }
    .cmp-ov { position: absolute; inset: 0; pointer-events: none; }
    .cmp-txt { position: absolute; inset: 0; display: flex; white-space: pre-wrap; overflow: hidden; line-height: 1.2; word-break: break-word; }
    .cmp-miss { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #8899aa;
      font: 600 28px "Segoe UI", sans-serif; background: repeating-linear-gradient(45deg, #11161c 0 18px, #161c24 18px 36px); text-align: center; padding: 10px; }
    .cmp-in { min-width: 0; max-width: 100%; }
    .cmp-lbl { font-size: .45em; opacity: .7; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: .25em; }
    .cmp-dim { opacity: .55; }
    .cmp-red { color: #ff4d4f; font-weight: 700; }
    .cmp-ph { opacity: .35; font-style: italic; }
    .cmp-chs { display: inline-flex; flex-direction: column; vertical-align: bottom; }
    .cmp-chc { font-weight: 700; line-height: 1.1; min-height: 1.1em; padding-right: .25em; white-space: nowrap; }
    .cmp-cht { white-space: pre; }
    .cmp-chn { opacity: .45; margin-top: .5em; }
    @keyframes cmpBlink { 0%, 100% { opacity: 1; } 50% { opacity: .12; } }
    .cmp-blink { animation: cmpBlink .6s ease-in-out 5; }
  `;
  document.head.append(css);

  /* ----- Цвет: CSS-фильтры + SVG-фильтр для гаммы и температуры ----- */

  const SVGNS = 'http://www.w3.org/2000/svg';
  let defs = null;
  const filterIds = new Map(); // ключ параметров → id фильтра
  function svgDefs() {
    if (defs) return defs;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    defs = document.createElementNS(SVGNS, 'defs');
    svg.append(defs);
    (document.body || document.documentElement).append(svg);
    return defs;
  }
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

  // fx: { b, c, s, h, g, temp, tint, blur } → CSS filter
  function fxFilter(fx) {
    if (!fx) return '';
    const parts = [];
    const g = num(fx.g, 1);
    const temp = num(fx.temp, 0);
    const tint = num(fx.tint, 0);
    if (g !== 1 || temp || tint) parts.push(`url(#${svgFilter(g, temp, tint)})`);
    const b = num(fx.b, 100); if (b !== 100) parts.push(`brightness(${b / 100})`);
    const c = num(fx.c, 100); if (c !== 100) parts.push(`contrast(${c / 100})`);
    const s = num(fx.s, 100); if (s !== 100) parts.push(`saturate(${s / 100})`);
    const h = num(fx.h, 0); if (h) parts.push(`hue-rotate(${h}deg)`);
    const bl = num(fx.blur, 0); if (bl > 0) parts.push(`blur(${bl}px)`);
    return parts.join(' ');
  }

  // Гамма и температура/оттенок — SVG-фильтром (в CSS их нет)
  function svgFilter(g, temp, tint) {
    const key = [g, temp, tint].join('|');
    if (filterIds.has(key)) return filterIds.get(key);
    const id = 'cfx' + filterIds.size;
    const f = document.createElementNS(SVGNS, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '1'); f.setAttribute('height', '1');
    if (g !== 1) {
      const ct = document.createElementNS(SVGNS, 'feComponentTransfer');
      for (const ch of ['R', 'G', 'B']) {
        const fn = document.createElementNS(SVGNS, 'feFunc' + ch);
        fn.setAttribute('type', 'gamma');
        fn.setAttribute('amplitude', '1');
        fn.setAttribute('exponent', String(1 / Math.max(0.1, g)));
        fn.setAttribute('offset', '0');
        ct.append(fn);
      }
      f.append(ct);
    }
    if (temp || tint) {
      const m = document.createElementNS(SVGNS, 'feColorMatrix');
      m.setAttribute('type', 'matrix');
      m.setAttribute('values', `${1 + temp / 400} 0 0 0 0  0 ${1 - tint / 500} 0 0 0  0 0 ${1 - temp / 400} 0 0  0 0 0 1 0`);
      f.append(m);
    }
    svgDefs().append(f);
    filterIds.set(key, id);
    return id;
  }

  /* ----- Программа: что сейчас в слоях (общая для окна) ----- */

  const P = { defs: [], on: {}, ink: null, info: { cur: null, next: null, only: null, st: {} }, baseVol: 1 };
  const progs = new Set(); // { el, mask, sound, ink, tr }
  const infos = new Set(); // { el, which: 'cur'|'next'|'only', ph? }
  const allowed = (p, id) => !p.mask || !id || p.mask.has(id);
  const progDefs = (p) => P.defs.map((d) => ({ ...d, hidden: !!d.hidden || !allowed(p, d.id), volume: p.sound ? d.volume : 0 }));
  // Тема экрана (look): тексты (песни, Библия, текстовые слайды) — в её оформлении; фото, видео, свои слайды — как есть
  const withLook = (look, c) => (look && c && c.type === 'text' && c.style ? { ...c, style: look, tpl: undefined } : c);
  // Альфа-канал: у текста без фона темы и фона шаблонов — виден только текст (и фигуры); фото и видео — как есть
  const noBg = (c) => (c && c.style ? { ...c, style: { ...c.style, bg: 'transparent', bgUrl: '', bgVideo: false, tpls: Array.isArray(c.style.tpls) ? c.style.tpls.map((t) => ({ ...t, bg: null })) : c.style.tpls } } : c);
  const forP = (p, c) => { let x = withLook(p.look, c); if (p.alpha) x = noBg(x); return p.sound ? x : { ...x, sound: false }; };
  // Для «Предпросмотра» оператора: содержимое так, как его покажет экран id
  const lookFor = (id, c) => { const s = screenDef(id); return withLook(s && s.look, c); };
  // Свой переход экрана: заменяет обычный (мгновенные показы остаются мгновенными)
  const pickTr = (p, tr) => (p.tr && tr && tr.type !== 'none' && tr.ms ? p.tr : tr);

  function progShow(content, tr, layer) {
    P.on[layer || ''] = content;
    for (const p of progs) if (allowed(p, layer)) Scene.show(p.el, forP(p, content), pickTr(p, tr), layer || undefined);
    inkRefresh();
  }
  function progClear(tr, layer) {
    if (layer) delete P.on[layer]; else P.on = {};
    for (const p of progs) Scene.clear(p.el, pickTr(p, tr), layer || undefined);
    inkRefresh();
  }
  function progLayers(m) {
    if (!m) return;
    if (Array.isArray(m.defs)) { P.defs = m.defs; for (const p of progs) Scene.setLayers(p.el, progDefs(p)); inkRefresh(); }
    if (m.layer && (m.cmd === 'play' || m.cmd === 'pause')) for (const p of progs) Scene.layerPlay(p.el, m.layer, m.cmd === 'play');
    if (m.cmd === 'build') for (const p of progs) Scene.buildNext(p.el);
  }

  /* Рисунок и крупный план — только там, где виден тот же слайд, на котором рисуют:
     в блоке/экране программы — если в нём есть слой этого слайда (фон без «Презентаций» — без рисунка);
     в блоке «Текущий слайд» — если он показывает тот же слайд (крупный план там не нужен — виден весь слайд) */
  const setInk = (el, d, anim) => (d && !Array.isArray(d) ? Scene.setInk(el, d.shapes, anim ? { animFrom: d.animFrom } : undefined) : Scene.setInk(el, d));
  // Слой рисунка — верхний непустой видимый (как topLayer в renderer.js; Overlay — только если больше ничего нет)
  function inkLayer() {
    let ov = null;
    for (let i = P.defs.length - 1; i >= 0; i--) {
      const d = P.defs[i];
      if (!P.on[d.id] || d.hidden) continue;
      if (!d.over) return d.id;
      if (!ov) ov = d.id;
    }
    return ov;
  }
  const slideId = (c) => (c ? [c.type, c.url || '', c.text || '', c.ref || '', c.verses ? c.verses.map((v) => v.n).join(',') : '', c.elements ? JSON.stringify(c.elements) : ''].join('|') : '');
  function inkFits(t) {
    if (!t.ink) return false;
    const id = inkLayer();
    if (t.which) return !!id && !!P.info.cur && slideId(P.on[id]) === slideId(P.info.cur);
    return id ? allowed(t, id) : !t.mask;
  }
  const inkTargets = () => [...progs, ...[...infos].filter((x) => x.which === 'cur')];
  // Подходит ли рисунок блоку — поменялось (сменился слайд, слои): показать или убрать без анимации
  function inkRefresh() {
    for (const t of inkTargets()) {
      const fit = inkFits(t);
      if (fit === !!t.inkFit) continue;
      t.inkFit = fit;
      setInk(t.el, fit ? P.ink : null, false);
      if (!t.which) Scene.setView(t.el, fit ? P.view : null, 0);
    }
  }
  function progInk(d) {
    P.ink = d;
    for (const t of inkTargets()) if (t.inkFit) setInk(t.el, d, true);
  }
  // Крупный план (Быстрая анимация): { view: { x, y, z } | null, ms } — там же, где рисунок
  function progView(m) {
    P.view = (m && m.view) || null;
    for (const p of progs) if (p.inkFit) Scene.setView(p.el, P.view, m && m.ms);
  }
  // Проигрыватель оператора: пуск, пауза, перемотка, громкость видео (не живых источников)
  function progVideo(m) {
    const { cmd, value } = m || {};
    if (cmd === 'volume' && Number.isFinite(value)) {
      P.baseVol = Math.max(0, Math.min(1, value));
      for (const p of progs) { p.el._baseVol = P.baseVol; Scene.applyVolume(p.el); }
      return;
    }
    // Устройство звука видео: value = { id, label }; id у окон может отличаться — ищем ещё и по названию
    if (cmd === 'sink') { setSink(value || {}); return; }
    for (const p of progs) {
      const v = [...p.el.querySelectorAll('.layer:not(.live) > video.media')].pop();
      if (!v) continue;
      if (cmd === 'play') v.play().catch(() => {});
      if (cmd === 'pause') v.pause();
      if (cmd === 'seek' && Number.isFinite(value)) v.currentTime = value;
    }
  }
  // Сцена и инфоблоки (сценический экран): текущий и следующий слайд, «только для сцены» (only)
  // и данные блоков st: { cur, next: { text, label }, notes, opnote, plCur, plNext, i, n, chords: { cur, next },
  //   msg: { text, at }, timers: { id: { mode, dur, run, base, at } }, video: { t, d, playing, at }, cap: { rec, live, ndi } }
  function progInfo(info) {
    const old = P.info;
    P.info = { cur: (info && info.cur) || null, next: (info && info.next) || null, only: (info && info.only) || null, st: (info && info.st) || {} };
    const ch = {};
    for (const k of ['cur', 'next', 'only']) ch[k] = JSON.stringify(P.info[k]) !== JSON.stringify(old[k]);
    for (const x of infos) if (ch[x.which]) paintInfo(x, false);
    if (ch.cur) inkRefresh();
    for (const n of stageNodes) paintStage(n);
    Scene.setTimers(P.info.st.timers); // таймеры в текстовых полях тем (scene.js)
  }
  function paintInfo(x, instant) {
    const c = P.info[x.which];
    if (x.ph) x.ph.style.display = c ? 'none' : '';
    if (!c) { Scene.clear(x.el, instant ? NONE : { type: 'fade', ms: 200 }); return; }
    Scene.show(x.el, { ...c, sound: false }, instant ? NONE : { type: 'fade', ms: 200 });
  }

  async function setSink(want) {
    let id = '';
    if (want.id) {
      try {
        const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
        const d = outs.find((x) => x.deviceId === want.id) || outs.find((x) => want.label && x.label === want.label);
        id = d ? d.deviceId : '';
      } catch { /* нет доступа — как в Windows */ }
    }
    P.sink = id;
    for (const p of progs) { p.el._sink = id; Scene.applyVolume(p.el); }
  }

  function progMount(el, opts) {
    const p = { el, mask: Array.isArray(opts.layers) ? new Set(opts.layers) : null, sound: !!opts.sound, ink: opts.ink !== false, tr: opts.tr || null, look: opts.look || null, alpha: !!opts.alpha };
    el._baseVol = P.baseVol;
    if (P.sink != null) el._sink = P.sink;
    Scene.setLayers(el, progDefs(p));
    for (const [id, c] of Object.entries(P.on)) if (allowed(p, id)) Scene.show(el, forP(p, c), NONE, id || undefined);
    p.inkFit = inkFits(p);
    if (p.inkFit && P.ink) setInk(el, P.ink, false);
    if (p.inkFit && P.view) Scene.setView(el, P.view, 0);
    progs.add(p);
    return p;
  }
  function progUnmount(p) {
    progs.delete(p);
    Scene.clear(p.el);
    Scene.setInk(p.el, null);
    Scene.setView(p.el, null, 0);
  }

  /* ----- Настройки экранов и сцен (приходят из окна оператора) ----- */

  let C = { screens: [], scenes: {}, main: { w: 1920, h: 1080 } };
  const screens = new Set(); // смонтированные экраны (для обновления при новых настройках)
  const screenDef = (id) => C.screens.find((s) => s.id === id) || (id === 'main' ? { id: 'main', mode: 'program' } : null);
  function screenSize(id) {
    const s = screenDef(id);
    if (!s || id === 'main') return { w: C.main.w || 1920, h: C.main.h || 1080 };
    return { w: Math.max(16, num(s.w, 1920)), h: Math.max(16, num(s.h, 1080)) };
  }

  function setConfig(cfg) {
    if (!cfg) return;
    C = {
      screens: Array.isArray(cfg.screens) ? cfg.screens : [],
      scenes: cfg.scenes || {},
      main: cfg.main || C.main,
    };
    for (const h of [...screens]) if (screens.has(h)) updateScreen(h); // вложенный мог уйти вместе с родителем
  }

  /* ----- Экран ----- */

  // opts: { preview (без звука), chain (какие экраны уже открыты выше — чтобы не уйти по кругу), root (окно вывода) }
  function mountScreen(host, id, opts = {}) {
    const h = { id, opts, el: make('div', 'cmp-screen'), key: '', body: null, root: !!opts.root };
    h.el.dataset.screen = id;
    host.append(h.el);
    screens.add(h);
    updateScreen(h);
    return h;
  }

  function unmountScreen(h) {
    if (!h) return;
    screens.delete(h);
    disposeBody(h.body);
    h.body = null;
    h.el.remove();
  }

  function disposeBody(b) {
    if (!b) return;
    if (b.prog) progUnmount(b.prog);
    if (b.scene) unmountScene(b.scene);
    b.el.remove();
  }

  function updateScreen(h) {
    const s = screenDef(h.id);
    const { w, h: H } = screenSize(h.id);
    h.W = w; h.H = H;
    h.el.style.width = w + 'px';
    h.el.style.height = H + 'px';
    if (!s) {
      if (h.key !== 'miss') { disposeBody(h.body); h.body = missing(h.el, 'Экран удалён'); h.key = 'miss'; }
      return;
    }
    const chain = h.opts.chain || [];
    if (chain.includes(h.id)) {
      if (h.key !== 'loop') { disposeBody(h.body); h.body = missing(h.el, 'Экран показывает сам себя'); h.key = 'loop'; }
      return;
    }
    h.el.style.filter = fxFilter(s.fx);
    // Прозрачный фон (s.alpha, у сцены ещё фон 'transparent'): без фона темы и шаблонов — видно только текст и элементы.
    // В «Предпросмотре» оператора — шахматка (видно, что прозрачно); внутри другой сцены — просвечивает; в NDI с альфой — прозрачно
    const alpha = !!s.alpha;
    const clear = alpha || (s.mode === 'scene' && s.bg === 'transparent');
    const top = !!h.opts.preview && !h.opts.nested && !(h.opts.chain || []).length;
    h.el.style.background = clear ? (top ? 'repeating-conic-gradient(#2a2f37 0 25%, #1b1f25 0 50%) 0 0 / 40px 40px' : 'transparent')
      : s.mode === 'scene' ? s.bg || '#000' : '';
    const sound = !h.opts.preview && !!(s.sound || (h.id === 'main' && h.root));
    const mode = s.mode === 'scene' || s.mode === 'blank' ? s.mode : 'program';
    if (mode === 'blank') {
      if (h.key !== 'blank') { disposeBody(h.body); h.body = { el: h.el.appendChild(make('div', 'cmp-fill')) }; h.key = 'blank'; }
      return;
    }
    if (mode === 'program') {
      const fit = h.id === 'main' ? 'native' : s.fit || 'native';
      const key = JSON.stringify(['p', s.layers || null, sound, s.ink !== false, s.trans || null, fit, w, H, fit === 'native' ? 0 : C.main, s.look || null, alpha]);
      if (key === h.key) return;
      disposeBody(h.body);
      h.key = key;
      const el = make('div', 'cmp-prog');
      const pw = fit === 'native' ? w : C.main.w;
      const ph = fit === 'native' ? H : C.main.h;
      el.style.width = pw + 'px';
      el.style.height = ph + 'px';
      fitBox(el, pw, ph, w, H, fit === 'native' ? 'stretch' : fit);
      h.el.append(el);
      h.body = { el, prog: progMount(el, { layers: s.layers, sound, ink: s.ink !== false, tr: s.trans && s.trans.type ? s.trans : null, look: s.look, alpha }) };
      return;
    }
    // Сцена: та же — обновить элементы; другая — плавный переход
    const sc = C.scenes[s.scene];
    const key = 's|' + (sc ? sc.id : '') + '|' + w + 'x' + H + '|' + sound + '|' + alpha;
    if (key === h.key && h.body && h.body.scene && sc) { updateScene(h.body.scene, sc); fitScene(h.body.scene, w, H); return; }
    const old = h.body;
    h.key = key;
    if (!sc) { disposeBody(old); h.body = missing(h.el, s.scene ? 'Макет удалён — выберите другой' : 'Макет не выбран'); return; }
    const box = make('div', 'cmp-fill');
    box.style.width = w + 'px';
    box.style.height = H + 'px';
    h.el.append(box);
    const scn = mountScene(box, sc, { preview: h.opts.preview, sound, chain: [...chain, h.id], alpha });
    fitScene(scn, w, H);
    h.body = { el: box, scene: scn };
    const tr = (s.sceneTrans && s.sceneTrans.type) ? s.sceneTrans : (sc.trans && sc.trans.type ? sc.trans : { type: 'fade', ms: 500 });
    const ms = old && tr.type !== 'none' ? Math.max(0, num(tr.ms, 500)) : 0;
    if (!ms) { disposeBody(old); return; }
    if (old && old.el) Scene.animOut([old.el], tr, ms);
    const a = Scene.animIn(box, tr, ms);
    const done = () => disposeBody(old);
    a.onfinish = done;
    a.oncancel = done;
  }

  function missing(host, text) {
    const el = make('div', 'cmp-miss');
    el.textContent = text;
    host.append(el);
    return { el };
  }

  // Вписать содержимое W×H в рамку bw×bh: contain | cover | stretch
  function fitBox(el, W, H, bw, bh, fit) {
    let sx = bw / W;
    let sy = bh / H;
    if (fit === 'contain' || fit === 'cover') sx = sy = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
    el.style.transform = `translate(${(bw - W * sx) / 2}px, ${(bh - H * sy) / 2}px) scale(${sx}, ${sy})`;
  }

  /* ----- Сцена ----- */

  function mountScene(host, scene, opts = {}) {
    const h = { el: make('div', 'cmp-scene'), nodes: new Map(), opts, scene: null };
    host.append(h.el);
    updateScene(h, scene);
    return h;
  }
  function unmountScene(h) {
    for (const n of h.nodes.values()) disposeNode(n);
    h.nodes.clear();
    h.el.remove();
  }
  function fitScene(h, bw, bh) {
    const s = h.scene;
    fitBox(h.el, s.w, s.h, bw, bh, 'contain');
  }

  const sceneW = (s) => Math.max(16, num(s.w, 1920));
  const sceneH = (s) => Math.max(16, num(s.h, 1080));

  function updateScene(h, scene) {
    const s = { ...scene, w: sceneW(scene), h: sceneH(scene) };
    h.scene = s;
    h.el.style.width = s.w + 'px';
    h.el.style.height = s.h + 'px';
    // Фон макета; без своего фона — прозрачный (виден фон сцены), в редакторе — чёрный. Прозрачный фон сцены — без фона макета
    h.el.style.background = h.opts.alpha ? 'transparent' : s.bg || (h.opts.edit ? '#000' : 'transparent');
    const items = Array.isArray(s.items) ? s.items : [];
    const keep = new Set(items.map((it) => it.id));
    for (const [id, n] of h.nodes) if (!keep.has(id)) { disposeNode(n); h.nodes.delete(id); }
    for (const it of items) {
      let n = h.nodes.get(it.id);
      const ck = contentKey(it) + (it.type === 'program' && !it.layers ? '|' + JSON.stringify(s.layers || null) : '');
      if (n && n._ck !== ck) { disposeNode(n); n = null; }
      if (!n) { n = buildNode(it, h, s); n._ck = ck; h.nodes.set(it.id, n); }
      applyNode(n, it, s);
      h.el.append(n); // по порядку элементов: каждый следующий — выше
    }
  }

  // Что требует пересоздать элемент (остальное — правится на месте)
  // Размер «Основного» и показанного экрана — тоже: блок программы строится в разрешении «Основного» и вписывается в рамку
  function contentKey(it) {
    const mainSz = '|' + C.main.w + 'x' + C.main.h;
    switch (it.type) {
      case 'screen': { const z = screenSize(it.ref); return 'screen|' + it.ref + '|' + z.w + 'x' + z.h; }
      case 'program': return 'program|' + JSON.stringify(it.layers || null) + '|' + !!it.sound + '|' + (it.ink !== false) + mainSz;
      case 'media': return 'media|' + it.url + '|' + (it.loop !== false) + '|' + !!it.sound;
      case 'source': return 'source|' + (it.src ? it.src.type + ':' + it.src.id : '');
      case 'cur': case 'next': return it.type + '|' + !!it.plain + '|' + (it.ink !== false) + mainSz;
      case 'only': return 'only' + mainSz;
      default: return it.type;
    }
  }
  // «Текущий/следующий слайд» с галочкой «Только текст» — это блок текста слайда (крупно, размер подбирается сам)
  const typeOf = (it) => ((it.type === 'cur' || it.type === 'next') && it.plain ? it.type + 'Text' : it.type);

  const MEDIA_IMG = /\.(jpe?g|png|gif|webp|bmp|svg)(\?|#|$)/i;

  function buildNode(it, sh, s) {
    const n = make('div', 'cmp-it');
    n.dataset.id = it.id;
    const clip = make('div', 'cmp-clip');
    const c = make('div', 'cmp-c');
    clip.append(c);
    const ov = make('div', 'cmp-ov');
    clip.append(ov);
    n.append(clip);
    n._clip = clip; n._c = c; n._ov = ov;
    n._W = 0; n._H = 0; // своё разрешение содержимого (0 — по рамке)
    const chain = sh.opts.chain || [];
    const sound = !sh.opts.preview && !!it.sound && sh.opts.sound !== false;
    const type = typeOf(it);
    n._edit = !!sh.opts.edit; // в редакторе макета пустые блоки показывают подсказку
    if (type === 'screen') {
      const sz = screenSize(it.ref);
      n._W = sz.w; n._H = sz.h;
      n._screen = mountScreen(c, it.ref, { preview: true, chain, nested: true });
    } else if (type === 'program' || type === 'cur' || type === 'next' || type === 'only') {
      n._W = C.main.w || 1920; n._H = C.main.h || 1080;
      const el = make('div', 'cmp-prog');
      el.style.width = n._W + 'px';
      el.style.height = n._H + 'px';
      c.append(el);
      n._pel = el; // fit 'native' — ширина подгоняется под рамку в applyNode
      if (type === 'program') n._prog = progMount(el, { layers: it.layers || s.layers, sound, ink: it.ink !== false, alpha: sh.opts.alpha }); // свои слои блока или слои сцены
      else {
        n._info = { el, which: type, ink: type === 'cur' && it.ink !== false };
        if (type === 'only' && n._edit) { n._info.ph = make('div', 'cmp-miss'); n._info.ph.textContent = 'Только для сцены: то, что оператор отправит сюда'; c.append(n._info.ph); }
        infos.add(n._info);
        paintInfo(n._info, true);
        if (type === 'cur') { n._info.inkFit = inkFits(n._info); if (n._info.inkFit) setInk(el, P.ink, false); }
      }
    } else if (STAGE.has(type)) {
      n._txt = make('div', 'cmp-txt');
      n._in = make('div', 'cmp-in');
      n._txt.append(n._in);
      c.append(n._txt);
      n._type = type;
      n._msgAt = P.info.st.msg ? P.info.st.msg.at : 0; // мигать — только на новое сообщение
      stageNodes.add(n);
    } else if (it.type === 'media') {
      if (!it.url) missing(c, 'Выберите файл');
      else if (MEDIA_IMG.test(it.url)) {
        const img = make('img');
        img.src = it.url;
        img.addEventListener('load', () => { n._W = img.naturalWidth; n._H = img.naturalHeight; if (n._it) applyNode(n, n._it, n._s); });
        c.append(img);
      } else {
        const v = make('video');
        v.src = it.url;
        v.autoplay = true;
        v.loop = it.loop !== false;
        v.muted = !sound;
        v.playsInline = true;
        v.addEventListener('loadedmetadata', () => { n._W = v.videoWidth; n._H = v.videoHeight; if (n._it) applyNode(n, n._it, n._s); });
        v.play().catch(() => {});
        c.append(v);
        n._video = v;
      }
    } else if (it.type === 'source') {
      n._W = 1920; n._H = 1080;
      const el = make('div', 'cmp-prog');
      el.style.width = '1920px';
      el.style.height = '1080px';
      c.append(el);
      if (it.src) Scene.show(el, { type: 'live', src: it.src, fit: 'cover', sound: false });
      else missing(el, 'Выберите источник');
      n._live = el;
    } else if (it.type === 'text' || it.type === 'clock') {
      n._txt = make('div', 'cmp-txt');
      c.append(n._txt);
      if (it.type === 'clock') clocks.add(n);
    }
    return n;
  }

  function disposeNode(n) {
    if (n._screen) unmountScreen(n._screen);
    if (n._prog) progUnmount(n._prog);
    if (n._info) { infos.delete(n._info); Scene.clear(n._info.el); }
    if (n._live) Scene.clear(n._live);
    if (n._video) { n._video.pause(); n._video.removeAttribute('src'); n._video.load(); }
    clocks.delete(n);
    stageNodes.delete(n);
    n.remove();
  }

  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

  function applyNode(n, it, s) {
    n._it = it; n._s = s;
    const w = Math.max(1, num(it.w, 400));
    const h = Math.max(1, num(it.h, 225));
    n.style.left = num(it.x, 0) + 'px';
    n.style.top = num(it.y, 0) + 'px';
    n.style.width = w + 'px';
    n.style.height = h + 'px';
    n.style.display = it.hidden ? 'none' : '';
    const tf = [];
    if (num(it.rot, 0)) tf.push(`rotate(${num(it.rot, 0)}deg)`);
    if (it.flipX || it.flipY) tf.push(`scale(${it.flipX ? -1 : 1}, ${it.flipY ? -1 : 1})`);
    n.style.transform = tf.join(' ');
    n.style.opacity = it.opacity != null && num(it.opacity, 100) < 100 ? String(Math.max(0, num(it.opacity, 100)) / 100) : '';
    n.style.mixBlendMode = BLENDS.includes(it.blend) && it.blend !== 'normal' ? it.blend : '';
    // Тень — у всего элемента (не обрезается рамкой)
    const sh = it.shadow;
    n.style.filter = sh && num(sh.blur, 0) + Math.abs(num(sh.x, 0)) + Math.abs(num(sh.y, 0)) > 0
      ? `drop-shadow(${num(sh.x, 0)}px ${num(sh.y, 0)}px ${num(sh.blur, 0)}px ${sh.c || 'rgba(0,0,0,.6)'})` : '';
    // Рамка, скругление, маска
    const clip = n._clip;
    const mask = it.mask || 'none';
    clip.style.borderRadius = mask === 'ellipse' || it.type === 'ellipse' ? '50%' : num(it.radius, 0) ? num(it.radius, 0) + 'px' : '';
    const bw = num(it.border && it.border.w, 0);
    clip.style.outline = bw > 0 ? `${bw}px solid ${(it.border && it.border.c) || '#ffffff'}` : '';
    clip.style.outlineOffset = bw > 0 ? -bw + 'px' : '';
    if (mask === 'fade') {
      const f = Math.max(1, Math.min(50, num(it.feather, 12)));
      const g = (dir) => `linear-gradient(${dir}, transparent, #000 ${f}%, #000 ${100 - f}%, transparent)`;
      clip.style.webkitMaskImage = clip.style.maskImage = `${g('to right')}, ${g('to bottom')}`;
      clip.style.webkitMaskComposite = 'source-in';
      clip.style.maskComposite = 'intersect';
    } else {
      clip.style.webkitMaskImage = clip.style.maskImage = '';
    }
    // Градиент поверх (затемнение, подсветка)
    const g = it.grad;
    n._ov.style.background = g && g.on ? `linear-gradient(${num(g.a, 180)}deg, ${g.c1 || 'rgba(0,0,0,0)'}, ${g.c2 || '#000'})` : '';
    n._ov.style.opacity = g && g.on ? String(num(g.o, 100) / 100) : '';
    // Цвет — только содержимого
    const c = n._c;
    c.style.filter = fxFilter(it.fx);
    // Своё содержимое: обрезка (crop) и вписывание в рамку
    // «Своё разрешение» (fit 'native') у блоков программы и слайдов: высота — как у «Основного», ширина — по пропорциям рамки,
    // поэтому полей нет при любом разрешении монитора «Основного» (текст подстраивается сам, как у экрана «Своё разрешение»)
    if (n._pel) {
      const MH = C.main.h || 1080;
      const PW = it.fit === 'native' && w > 0 && h > 0 ? Math.max(16, Math.round((MH * w) / h)) : C.main.w || 1920;
      if (n._W !== PW || n._H !== MH) { n._W = PW; n._H = MH; n._pel.style.width = PW + 'px'; n._pel.style.height = MH + 'px'; }
    }
    if (n._W && n._H) {
      c.style.width = n._W + 'px';
      c.style.height = n._H + 'px';
      const cr = it.crop || {};
      const l = Math.max(0, Math.min(0.45, num(cr.l, 0) / 100));
      const r = Math.max(0, Math.min(0.45, num(cr.r, 0) / 100));
      const t = Math.max(0, Math.min(0.45, num(cr.t, 0) / 100));
      const b = Math.max(0, Math.min(0.45, num(cr.b, 0) / 100));
      const vw = n._W * (1 - l - r);
      const vh = n._H * (1 - t - b);
      const fit = it.fit || 'contain';
      let sx = w / vw;
      let sy = h / vh;
      if (fit === 'contain' || fit === 'cover') sx = sy = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
      const ox = (w - vw * sx) / 2 - l * n._W * sx;
      const oy = (h - vh * sy) / 2 - t * n._H * sy;
      c.style.transform = `translate(${ox}px, ${oy}px) scale(${sx}, ${sy})`;
      // Картинка/видео: свой размер уже учтён — тянем во весь «холст» содержимого
      const m = c.firstElementChild;
      if (m && (m.tagName === 'IMG' || m.tagName === 'VIDEO')) m.style.objectFit = 'fill';
    } else {
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      c.style.transform = '';
      const m = c.firstElementChild;
      if (m && (m.tagName === 'IMG' || m.tagName === 'VIDEO')) m.style.objectFit = it.fit === 'stretch' ? 'fill' : it.fit || 'contain';
    }
    // Фигуры (заливка или градиент; форма — clip-path), текст, часы
    if (SHAPES.has(it.type)) {
      c.style.background = it.fill2 ? `linear-gradient(${num(it.fillA, 180)}deg, ${it.fill || '#3e8bff'}, ${it.fill2})` : it.fill || '#3e8bff';
      c.style.clipPath = CLIPS[it.type] || '';
    } else { c.style.background = ''; c.style.clipPath = ''; }
    if (n._txt) paintText(n, it);
  }

  const SHAPES = new Set(['rect', 'ellipse', 'line', 'triangle', 'rhombus', 'hexagon', 'star', 'arrow']);
  const CLIPS = {
    triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
    rhombus: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
    hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
    star: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
    arrow: 'polygon(0 30%, 65% 30%, 65% 0, 100% 50%, 65% 100%, 65% 70%, 0 70%)',
  };
  const JUST = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
  const ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' };
  const CASES = { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' };
  function paintText(n, it) {
    const t = n._txt;
    t.style.fontFamily = Scene.family(it.font || 'segoe');
    t.style.fontSize = Math.max(4, num(it.size, 64)) + 'px';
    t.style.fontWeight = it.weight ? String(it.weight) : it.bold ? '700' : '400';
    t.style.fontStyle = it.italic ? 'italic' : '';
    t.style.textDecoration = it.underline ? 'underline' : '';
    t.style.textTransform = CASES[it.case] || '';
    t.style.lineHeight = num(it.lineH, 0) ? String(num(it.lineH, 0)) : '';
    t.style.letterSpacing = num(it.spacing, 0) ? num(it.spacing, 0) + 'px' : '';
    t.style.color = it.color || '#ffffff';
    t.style.background = it.bg || '';
    t.style.borderRadius = it.bg && num(it.bgR, 0) ? num(it.bgR, 0) + 'px' : '';
    t.style.padding = num(it.pad, 0) + 'px';
    t.style.justifyContent = ALIGN[it.align] || 'center';
    t.style.alignItems = JUST[it.valign] || 'center';
    t.style.textAlign = it.align || 'center';
    t.style.textShadow = it.tshadow ? `0 2px ${num(it.tshadowB, 8)}px ${it.tshadowC || 'rgba(0,0,0,.7)'}` : '';
    t.style.webkitTextStroke = num(it.stroke, 0) ? `${num(it.stroke, 0)}px ${it.strokeC || '#000'}` : '';
    if (n._in) paintStage(n, true);
    else t.textContent = it.type === 'clock' ? clockText(it) : it.text || '';
  }

  /* ----- Инфоблоки: текст слайда, заметки, сообщение, плейлист, счётчик, аккорды, таймеры, видео, запись ----- */
  const STAGE = new Set(['curText', 'nextText', 'notes', 'opnote', 'msg', 'plist', 'count', 'chords', 'timer', 'countdown', 'vcd', 'cap']);
  const TICK = new Set(['timer', 'countdown', 'vcd', 'cap']); // меняются каждую секунду
  const stageNodes = new Set();

  // Время: auto — «05:00» или «1:05:00», hms — «00:05:00», ms — «65:00»; вниз — с округлением вверх (0:00 ровно в конце)
  function fmtMs(ms, fmt, up) {
    const neg = ms < 0;
    let s = Math.abs(ms) / 1000;
    s = up || neg ? Math.floor(s) : Math.ceil(s - 0.001);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const out = fmt === 'hms' ? `${pad2(h)}:${pad2(m)}:${pad2(sec)}` : fmt === 'ms' ? `${pad2(Math.floor(s / 60))}:${pad2(sec)}` : h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
    return (neg ? '−' : '') + out;
  }
  // Таймер: { mode: 'down'|'up', dur (с), run, base (мс до пуска), at (когда пустили) } → мс (вниз — сколько осталось)
  function timerMs(t, now) {
    const el = num(t.base, 0) + (t.run ? now - num(t.at, now) : 0);
    return t.mode === 'up' ? el : num(t.dur, 0) * 1000 - el;
  }
  // До времени дня «10:00»: прошло больше 12 часов — значит, до завтра
  function untilMs(hhmm, now) {
    const m = String(hhmm || '').match(/^(\d{1,2})[:.](\d{2})/);
    if (!m) return null;
    const d = new Date(now);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    let ms = d.getTime() - now;
    if (ms < -12 * 3600e3) ms += 24 * 3600e3;
    return ms;
  }
  // Цвет по оставшемуся времени: меньше warn секунд — warnC, вышло — overC
  function timeColor(it, left) {
    if (left <= 0) return it.overC || '#ff4d4f';
    if (left <= num(it.warn, 60) * 1000) return it.warnC || '#f5a524';
    return '';
  }

  // Что показать в блоке: { text } | { lines: [{ t, cls }] } | { chords, next }; label — подпись сверху; empty — нет данных
  function stageValue(type, it, st, edit, now) {
    const ph = (t) => (edit ? { text: t, ph: true, empty: true } : { text: '', empty: true });
    const pre = it.prefix ? it.prefix + ' ' : '';
    switch (type) {
      case 'curText': case 'nextText': {
        const s = st[type === 'curText' ? 'cur' : 'next'];
        if (!s || !s.text) return ph(type === 'curText' ? 'Текст текущего слайда' : 'Текст следующего слайда');
        return { label: it.label && s.label ? s.label : '', text: s.text };
      }
      case 'notes': return st.notes ? { text: st.notes } : ph('Заметки к слайду');
      case 'opnote': return st.opnote ? { text: st.opnote } : ph('Заметка оператора');
      case 'msg': return st.msg && st.msg.text ? { text: st.msg.text } : ph('Сообщение для сцены');
      case 'plist': {
        const show = it.show || 'both';
        const lines = [];
        if (show !== 'next') lines.push({ t: (show === 'both' ? 'Сейчас: ' : '') + (st.plCur || '—') });
        if (show !== 'cur') lines.push({ t: (show === 'both' ? 'Далее: ' : '') + (st.plNext || '—'), cls: show === 'both' ? 'dim' : '' });
        return { lines, empty: !st.plCur && !st.plNext };
      }
      case 'count': return st.n ? { text: pre + (it.fmt === 'n' ? String(st.i) : `${st.i} / ${st.n}`) } : ph(pre + '3 / 12');
      case 'chords': {
        const c = st.chords || {};
        if (!c.cur || !c.cur.length) return ph('Аккорды текущей песни');
        return { chords: c.cur, next: it.nextToo && c.next && c.next.length ? c.next : null };
      }
      case 'timer': {
        const t = st.timers && st.timers[it.ref];
        if (!t) return ph(pre + (it.ref ? 'Таймер удалён' : 'Таймер не выбран'));
        const ms = timerMs(t, now);
        const over = t.mode !== 'up' && ms < 0 && it.over === false ? 0 : ms;
        return { text: pre + fmtMs(over, it.fmt, t.mode === 'up'), color: t.mode === 'up' ? '' : timeColor(it, ms), dim: !t.run };
      }
      case 'countdown': {
        const ms = untilMs(it.to, now);
        if (ms == null) return ph(pre + 'Время не задано');
        return { text: pre + fmtMs(ms < 0 && it.over === false ? 0 : ms, it.fmt), color: timeColor(it, ms) };
      }
      case 'vcd': {
        const v = st.video;
        if (!v || !(v.d > 0)) return ph(pre + 'Видео 00:00');
        const t = Math.min(v.d, num(v.t, 0) + (v.playing ? (now - num(v.at, now)) / 1000 : 0));
        const left = (v.d - t) * 1000;
        return { text: pre + (it.show === 'elapsed' ? fmtMs(t * 1000, it.fmt, true) : fmtMs(left, it.fmt)), color: timeColor(it, left), dim: !v.playing };
      }
      case 'cap': {
        const c = st.cap || {};
        const lines = [];
        if (c.rec) lines.push({ t: '● ЗАПИСЬ ' + fmtMs(now - c.rec, 'hms', true), cls: 'red' });
        if (c.live) lines.push({ t: '● ЭФИР ' + fmtMs(now - c.live, 'hms', true), cls: 'red' });
        if (c.ndi) lines.push({ t: 'NDI-выходов: ' + c.ndi, cls: 'dim' });
        if (!lines.length) lines.push({ t: 'Не в эфире', cls: 'dim' });
        return { lines };
      }
      default: return { text: '' };
    }
  }

  // Строка с аккордами «[Am]Слава [G]Богу» → аккорды над слогами
  function chordLine(line) {
    const row = make('div');
    const parts = String(line).split(/\[([^\]]*)\]/);
    if (parts.length === 1) { row.textContent = line || ' '; return row; }
    if (parts[0]) { const s = make('span', 'cmp-chs'); s.append(make('span', 'cmp-chc'), Object.assign(make('span', 'cmp-cht'), { textContent: parts[0] })); row.append(s); }
    for (let i = 1; i < parts.length; i += 2) {
      const s = make('span', 'cmp-chs');
      s.append(Object.assign(make('span', 'cmp-chc'), { textContent: parts[i] }), Object.assign(make('span', 'cmp-cht'), { textContent: parts[i + 1] || ' ' }));
      row.append(s);
    }
    return row;
  }

  function paintStage(n, force) {
    const it = n._it;
    if (!it || !n._in) return;
    const now = Date.now();
    const v = stageValue(n._type, it, P.info.st || {}, n._edit, now);
    const key = JSON.stringify(v);
    if (!force && key === n._key) return;
    const relen = force || !n._key || key.length !== n._key.length || !TICK.has(n._type); // у часов длина та же — размер не подбираем каждую секунду
    n._key = key;
    const box = n._in;
    box.replaceChildren();
    box.className = 'cmp-in' + (v.ph ? ' cmp-ph' : '') + (v.dim ? ' cmp-dim' : '');
    box.style.color = v.color || '';
    if (v.label) box.append(Object.assign(make('div', 'cmp-lbl'), { textContent: v.label }));
    if (v.lines) for (const l of v.lines) box.append(Object.assign(make('div', l.cls ? 'cmp-' + l.cls : ''), { textContent: l.t }));
    else if (v.chords) {
      const cc = it.chordC || '#ffd84a';
      for (const l of v.chords) box.append(chordLine(l));
      if (v.next) { const nx = make('div', 'cmp-chn'); for (const l of v.next) nx.append(chordLine(l)); box.append(nx); }
      box.querySelectorAll('.cmp-chc').forEach((x) => { x.style.color = cc; });
    } else if (v.text) box.append(document.createTextNode(v.text));
    // Пустой блок: подложку не показывать (по галочке), в редакторе — подсказка
    n.style.visibility = v.empty && it.hideEmpty && !n._edit ? 'hidden' : '';
    // Новое сообщение — мигнуть
    if (n._type === 'msg') {
      const at = P.info.st.msg ? P.info.st.msg.at : 0;
      if (at && at !== n._msgAt && it.blink !== false) { n._txt.classList.remove('cmp-blink'); void n._txt.offsetWidth; n._txt.classList.add('cmp-blink'); }
      n._msgAt = at;
    }
    if (relen) autoFit(n, it);
  }

  // Размер текста — сам: самый крупный, при котором текст влезает в блок (не больше «Размера», не меньше minSize)
  function autoFit(n, it) {
    const t = n._txt;
    const box = n._in;
    const max = Math.max(4, num(it.size, 64));
    t.style.fontSize = max + 'px';
    if (it.auto === false) return;
    const pad = num(it.pad, 0);
    const W = t.clientWidth - 2 * pad;
    const H = t.clientHeight - 2 * pad;
    if (W <= 0 || H <= 0) return;
    const fits = () => box.scrollHeight <= H + 1 && box.scrollWidth <= W + 1;
    if (fits()) return;
    let lo = Math.max(4, Math.min(max, num(it.minSize, 12)));
    let hi = max;
    t.style.fontSize = lo + 'px';
    if (!fits()) return;
    for (let k = 0; k < 10 && hi - lo > 0.5; k++) {
      const m = (lo + hi) / 2;
      t.style.fontSize = m + 'px';
      if (fits()) lo = m; else hi = m;
    }
    t.style.fontSize = Math.floor(lo) + 'px';
  }
  setInterval(() => { for (const n of stageNodes) if (TICK.has(n._type)) paintStage(n); }, 250);

  /* ----- Часы ----- */
  const clocks = new Set();
  const pad2 = (v) => String(v).padStart(2, '0');
  function clockText(it) {
    const d = new Date();
    if (it.fmt === 'date') return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    if (it.fmt === 'hms') return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  setInterval(() => { for (const n of clocks) if (n._txt && n._it) n._txt.textContent = clockText(n._it); }, 1000);

  // Подогнать текст слайдов во всех вложенных сценах (после смены размера окна)
  function refit() {
    for (const p of progs) Scene.refit(p.el);
    for (const x of infos) Scene.refit(x.el);
  }

  return {
    progShow, progClear, progLayers, progInk, progView, progVideo, progInfo,
    setConfig, mountScreen, unmountScreen, updateScreen, mountScene, updateScene, unmountScene, fitScene, fitBox,
    screenSize, screenDef, fxFilter, refit, BLENDS, lookFor,
    get config() { return C; },
  };
})();
