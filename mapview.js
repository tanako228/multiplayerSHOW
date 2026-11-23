/* ---------- Карты: модель и отрисовка на экране (общая для окна вывода, предпросмотра и редактора «Карты») ----------
   Карта (lib.maps[]) — картинка пользователя (PNG/JPEG) и объекты поверх неё. Координаты — доли 0–1 от исходной картинки,
   поэтому от размера файла, превью и экрана ничего не зависит.
     { id, name, w, h, img: { path, url }, p, b, t,       — оригинал и облегчённые копии (main.js: mapImport)
       points: [точка], routes: [маршрут],
       layers: { hide: { тип: true }, labels, routes },   — «Слои» карты: какие виды точек, подписи, маршруты видны
       look: { layout, ms, ease, panel, pz, zoom, marker, label, theme, font, bg } }
   Точка: { id, name, x, y, type, icon, color, short, desc, history, dates, events: [{ t, ref }], refs: [строка], images: [{ path, url, t }] }
   Маршрут: { id, name, stops: [id точки], color, width, arrows, numbers, style: solid|dash, ms, hidden }
   На экран идёт содержимое { type: 'map', key, url, prev, w, h, layout, point, points, routes, fit, labels, look } (content):
   scene.js рисует его через MapView.build, а ту же карту с другой компоновкой или точкой — MapView.update без перезагрузки. */
const MapView = (() => {
  const TYPES = {
    city: { name: 'Город', icon: 'city', color: '#f5a524' },
    village: { name: 'Селение', icon: 'house', color: '#e0a15e' },
    mountain: { name: 'Гора', icon: 'mountain', color: '#9a6b45' },
    water: { name: 'Море, озеро', icon: 'water', color: '#2f80ed' },
    river: { name: 'Река', icon: 'river', color: '#2bb3c0' },
    region: { name: 'Область, страна', icon: 'flag', color: '#8e4ec6' },
    desert: { name: 'Пустыня', icon: 'tent', color: '#c9a227' },
    event: { name: 'Событие', icon: 'star', color: '#e5484d' },
    place: { name: 'Место', icon: 'dot', color: '#12a594' },
  };
  const W = '#fff';
  const GLYPHS = {
    dot: `<circle cx="12" cy="12" r="4.6" fill="${W}"/>`,
    city: `<path d="M4.5 19.5V10l3-2.2 3 2.2v9.5M10.5 19.5V7.5l3.5-3 3.5 3v12M3.5 19.5h17" fill="none" stroke="${W}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    house: `<path d="M5 11.5 12 5.5l7 6M7 10v9.5h10V10" fill="none" stroke="${W}" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>`,
    mountain: `<path d="M2.8 19 9.2 7.8l3.4 5.6 2.2-3.2L21.2 19z" fill="${W}"/>`,
    water: `<path d="M3.5 9.5c2.1-1.6 3.6-1.6 5.7 0s3.6 1.6 5.7 0 3.6-1.6 5.6 0M3.5 15c2.1-1.6 3.6-1.6 5.7 0s3.6 1.6 5.7 0 3.6-1.6 5.6 0" fill="none" stroke="${W}" stroke-width="2.1" stroke-linecap="round"/>`,
    river: `<path d="M7 3.5c4.5 3 -3 6.5 2.5 9.5S16 18 13 20.5" fill="none" stroke="${W}" stroke-width="2.4" stroke-linecap="round"/>`,
    flag: `<path d="M6 21V4M6 4.8h11l-2.4 3.6L17 12H6" fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    tent: `<path d="M2.8 19.5 12 5l9.2 14.5zM12 19.5l-2.6-5h5.2z" fill="${W}" fill-rule="evenodd"/>`,
    star: `<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z" fill="${W}"/>`,
    cross: `<path d="M12 3.5v17M6.5 8.5h11" stroke="${W}" stroke-width="2.8" stroke-linecap="round"/>`,
    temple: `<path d="M3.5 9 12 4l8.5 5zM5.5 10.5v7M9.8 10.5v7M14.2 10.5v7M18.5 10.5v7M3.5 19.5h17" fill="${W}" stroke="${W}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>`,
    ship: `<path d="M3.5 14.5h17l-2.8 4.5H6.3zM12 3.5v10M12 4.5l6 7.5h-6" fill="${W}" stroke="${W}" stroke-width="1.6" stroke-linejoin="round"/>`,
    crown: `<path d="m3.8 8 4.4 4 3.8-6.5 3.8 6.5 4.4-4-1.8 10H5.6z" fill="${W}"/>`,
    fish: `<path d="M3.5 12c3.5-5 9.5-5.5 13 0-3.5 5.5-9.5 5-13 0zM16.5 12l4-3.5v7z" fill="${W}"/>`,
    tree: `<path d="M12 3.5 5.5 14h13zM12 8l-5 8h10zM12 14v6.5" fill="${W}" stroke="${W}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
    well: `<path d="M12 4c3 4.2 5.2 7 5.2 9.8a5.2 5.2 0 0 1-10.4 0C6.8 11 9 8.2 12 4z" fill="${W}"/>`,
    battle: `<path d="m5 4 14 14M19 4 5 18M4 16l4 4M16 20l4-4" stroke="${W}" stroke-width="2.3" stroke-linecap="round"/>`,
  };
  const ICON_NAMES = { dot: 'Точка', city: 'Город', house: 'Дом', mountain: 'Гора', water: 'Вода', river: 'Река', flag: 'Флаг', tent: 'Шатёр', star: 'Звезда', cross: 'Крест', temple: 'Храм', ship: 'Корабль', crown: 'Корона', fish: 'Рыба', tree: 'Дерево', well: 'Источник', battle: 'Битва' };
  const LAYOUTS = [
    ['side', 'Карта и панель справа'],
    ['over', 'Панель поверх карты'],
    ['map', 'Только карта'],
    ['card', 'Только карточка'],
    ['focus', 'Точка с подписью'],
  ];
  const THEMES = [['dark', 'Тёмная'], ['glass', 'Стекло'], ['light', 'Светлая'], ['parch', 'Пергамент']];
  const EASES = { smooth: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), soft: (t) => 1 - Math.pow(1 - t, 3), linear: (t) => t };
  const EASE_NAMES = [['smooth', 'Плавно'], ['soft', 'Мягкая остановка'], ['linear', 'Ровно']];
  const DEF_LOOK = { layout: 'side', ms: 1100, ease: 'smooth', panel: 38, pz: 1.6, zoom: 2.6, marker: 1, label: 1, theme: 'dark', font: '', bg: '#000000' };
  const ROUTE_DEF = { color: '#e5484d', width: 5, arrows: true, numbers: true, style: 'solid', ms: 2400 };

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

  /* ----- Модель ----- */
  function normPoint(p) {
    p = p && typeof p === 'object' ? p : {};
    const type = TYPES[p.type] ? p.type : 'city';
    return {
      id: str(p.id, 40) || newId(),
      name: str(p.name, 200) || 'Точка',
      x: clamp(num(p.x, 0.5), 0, 1), y: clamp(num(p.y, 0.5), 0, 1),
      type, icon: GLYPHS[p.icon] ? p.icon : '', color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '',
      short: str(p.short, 600), desc: str(p.desc), history: str(p.history), dates: str(p.dates, 200),
      events: (Array.isArray(p.events) ? p.events : []).filter((e) => e && typeof e === 'object').map((e) => ({ t: str(e.t, 400), ref: str(e.ref, 120) })),
      refs: (Array.isArray(p.refs) ? p.refs : []).map((r) => str(r, 120).trim()).filter(Boolean),
      images: (Array.isArray(p.images) ? p.images : []).filter((m) => m && m.url).map((m) => ({ path: str(m.path, 1000), url: str(m.url, 2000), t: str(m.t, 2000) || undefined })),
      // Только для редактора (на экран не идут): источники сведений, координаты (широта/долгота), auto — поставлена сама, не вручную
      sources: (Array.isArray(p.sources) ? p.sources : []).map((r) => str(r, 600).trim()).filter(Boolean),
      ...(p.geo && Number.isFinite(+p.geo.lat) && Number.isFinite(+p.geo.lon) ? { geo: { lat: clamp(+p.geo.lat, -90, 90), lon: clamp(+p.geo.lon, -180, 180) } } : {}),
      ...(p.auto ? { auto: true } : {}),
      ...(p.hidden ? { hidden: true } : {}),
    };
  }
  function normRoute(r, ids) {
    r = r && typeof r === 'object' ? r : {};
    return {
      id: str(r.id, 40) || newId(),
      name: str(r.name, 200) || 'Маршрут',
      stops: (Array.isArray(r.stops) ? r.stops : []).filter((s) => typeof s === 'string' && (!ids || ids.has(s))),
      color: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : ROUTE_DEF.color,
      width: clamp(num(r.width, ROUTE_DEF.width), 1, 20),
      arrows: r.arrows !== false, numbers: r.numbers !== false,
      style: r.style === 'dash' ? 'dash' : 'solid',
      ms: clamp(num(r.ms, ROUTE_DEF.ms), 0, 20000),
      ...(r.hidden ? { hidden: true } : {}),
    };
  }
  function normMap(m) {
    m = m && typeof m === 'object' ? m : {};
    const points = (Array.isArray(m.points) ? m.points : []).map(normPoint);
    const ids = new Set(points.map((p) => p.id));
    const L = m.layers && typeof m.layers === 'object' ? m.layers : {};
    const look = { ...DEF_LOOK, ...(m.look && typeof m.look === 'object' ? m.look : {}) };
    if (!LAYOUTS.some(([k]) => k === look.layout)) look.layout = DEF_LOOK.layout;
    return {
      ...m,
      id: str(m.id, 40) || newId(),
      name: str(m.name, 200) || 'Карта',
      w: Math.max(1, num(m.w, 1)), h: Math.max(1, num(m.h, 1)),
      points,
      routes: (Array.isArray(m.routes) ? m.routes : []).map((r) => normRoute(r, ids)),
      layers: { hide: L.hide && typeof L.hide === 'object' ? { ...L.hide } : {}, labels: L.labels !== false, routes: L.routes !== false },
      look,
    };
  }
  function newMap(file) {
    return normMap({ id: newId(), name: file.name, w: file.w, h: file.h, img: file.img, p: file.p, b: file.b, t: file.t, at: Date.now() });
  }
  // Точка видна на этой карте (слои)
  const visible = (map, p) => !p.hidden && !(map.layers && map.layers.hide && map.layers.hide[p.type]);
  const colorOf = (p) => p.color || (TYPES[p.type] || TYPES.place).color;
  const iconOf = (p) => p.icon || (TYPES[p.type] || TYPES.place).icon;

  // Что пойдёт на экран. o: { point, layout, routes: [id] | null (все видимые), fit: [x0,y0,x1,y1], look, family }
  function content(map, o = {}) {
    const look = { ...DEF_LOOK, ...(map.look || {}), ...(o.look || {}) };
    const layout = LAYOUTS.some(([k]) => k === o.layout) ? o.layout : look.layout;
    const pt = o.point ? (map.points || []).find((p) => p.id === o.point) : null;
    const L = map.layers || {};
    const byId = new Map((map.points || []).map((p) => [p.id, p]));
    const points = (map.points || []).filter((p) => visible(map, p) || (pt && p.id === pt.id))
      .map((p) => ({ id: p.id, x: p.x, y: p.y, name: p.name, color: colorOf(p), icon: iconOf(p) }));
    const routes = L.routes === false && !o.routes ? [] : (map.routes || [])
      .filter((r) => (o.routes ? o.routes.includes(r.id) : !r.hidden))
      .map((r) => ({ id: r.id, color: r.color, width: r.width, arrows: r.arrows, numbers: r.numbers, style: r.style, ms: r.ms,
        stops: r.stops.map((id) => byId.get(id)).filter(Boolean).map((p) => [p.x, p.y, p.id]) }))
      .filter((r) => r.stops.length > 1);
    const point = pt ? {
      id: pt.id, x: pt.x, y: pt.y, name: pt.name, color: colorOf(pt), icon: iconOf(pt), kind: (TYPES[pt.type] || TYPES.place).name,
      dates: pt.dates, short: pt.short, desc: pt.desc, history: pt.history,
      events: pt.events.filter((e) => e.t || e.ref), refs: pt.refs, images: pt.images.map((m) => m.url),
    } : null;
    return {
      type: 'map', key: map.id, url: ((map.b || map.img) || {}).url || '', prev: ((map.p || map.img) || {}).url || '',
      w: map.w, h: map.h, layout, point, points, routes, fit: !pt && Array.isArray(o.fit) ? o.fit : null,
      labels: L.labels !== false, look: { ...look, family: o.family || '' }, name: map.name,
    };
  }
  // Рамка вокруг точек маршрута (для «Показать маршрут»)
  function bounds(list) {
    if (!list.length) return null;
    const xs = list.map((p) => p.x);
    const ys = list.map((p) => p.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  /* ----- Отрисовка ----- */
  const NS = 'http://www.w3.org/2000/svg';
  const glyph = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name] || GLYPHS.dot}</svg>`;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // Маркер точки: кружок цвета точки со знаком и подпись. Размеры — переменные --s (кружок) и --ls (подпись) у владельца
  function pin(p, label) {
    const m = el('div', 'mv-pt');
    m.dataset.id = p.id;
    const b = el('div', 'mv-pin');
    b.innerHTML = glyph(p.icon);
    m.append(b);
    if (label) m.append(el('div', 'mv-lb', p.name));
    m.style.setProperty('--c', p.color);
    return m;
  }
  function pinSet(m, p, label) {
    m.style.setProperty('--c', p.color);
    const b = m.firstChild;
    if (b._icon !== p.icon) { b.innerHTML = glyph(p.icon); b._icon = p.icon; }
    let lb = m.querySelector(':scope > .mv-lb');
    if (label && !lb) { lb = el('div', 'mv-lb'); m.append(lb); }
    if (!label && lb) { lb.remove(); lb = null; }
    if (lb && lb.textContent !== p.name) lb.textContent = p.name;
  }
  // Линия маршрута по точкам экрана [[x, y]]; стрелки — на серединах отрезков
  function routePath(pts) { return pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '); }
  function arrowsPath(pts, size) {
    let d = '';
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < size * 3) continue;
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      const mx = (x0 + x1) / 2 + ux * size * 0.5;
      const my = (y0 + y1) / 2 + uy * size * 0.5;
      const bx = mx - ux * size * 1.6;
      const by = my - uy * size * 1.6;
      d += `M${mx.toFixed(1)} ${my.toFixed(1)}L${(bx - uy * size).toFixed(1)} ${(by + ux * size).toFixed(1)}L${(bx + uy * size).toFixed(1)} ${(by - ux * size).toFixed(1)}Z`;
    }
    return d;
  }

  const css = `
    .mv-pt { position: absolute; left: 0; top: 0; width: 0; height: 0; }
    .mv-pin { position: absolute; left: 0; top: 0; width: var(--s, 26px); height: var(--s, 26px); box-sizing: border-box; transform: translate(-50%, -50%); border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--c) 70%, #fff), var(--c) 62%); display: grid; place-items: center;
      box-shadow: 0 0 0 calc(var(--s, 26px) * .085) rgba(255,255,255,.95), 0 calc(var(--s, 26px) * .14) calc(var(--s, 26px) * .45) rgba(0,0,0,.55); }
    .mv-pin svg { width: 64%; height: 64%; display: block; }
    .mv-lb { position: absolute; left: 0; top: calc(var(--s, 26px) * .66); transform: translateX(-50%); white-space: nowrap; font-weight: 650; font-size: var(--ls, 13px); line-height: 1.15;
      color: #fff; text-shadow: 0 0 .25em rgba(0,0,0,.95), 0 .08em .35em rgba(0,0,0,.9), 0 0 .8em rgba(0,0,0,.6); letter-spacing: .01em; }
    .mv-pt.on .mv-pin { width: calc(var(--s, 26px) * 1.3); height: calc(var(--s, 26px) * 1.3); }
    .mv-pt.on::before { content: ''; position: absolute; left: 0; top: 0; width: calc(var(--s, 26px) * 1.3); height: calc(var(--s, 26px) * 1.3); border-radius: 50%; transform: translate(-50%, -50%);
      border: calc(var(--s, 26px) * .1) solid var(--c); animation: mvPulse 2.2s ease-out infinite; }
    .mv-pt.on .mv-lb { top: calc(var(--s, 26px) * .86); font-size: calc(var(--ls, 13px) * 1.12); }
    .mv-fc .mv-pt.on .mv-lb { opacity: 0; transition: opacity .3s; }
    .mv-pt.dim { opacity: .55; }
    @keyframes mvPulse { 0% { opacity: .9; width: calc(var(--s, 26px) * 1.3); height: calc(var(--s, 26px) * 1.3); } 100% { opacity: 0; width: calc(var(--s, 26px) * 3.6); height: calc(var(--s, 26px) * 3.6); } }
    .mv-num { position: absolute; left: 0; top: 0; transform: translate(-10%, -115%); min-width: calc(var(--s, 26px) * .62); height: calc(var(--s, 26px) * .62); padding: 0 .25em; box-sizing: border-box;
      border-radius: 1em; background: var(--rc, #e5484d); color: #fff; font-weight: 700; font-size: calc(var(--s, 26px) * .42); display: grid; place-items: center; line-height: 1;
      box-shadow: 0 0 0 calc(var(--s, 26px) * .05) #fff; font-variant-numeric: tabular-nums; }
    .layer.map { container-type: size; }
    .layer.map .mv-view { position: absolute; left: 0; top: 0; overflow: hidden; }
    .layer.map .mv-img { position: absolute; left: 0; top: 0; max-width: none; user-select: none; }
    .layer.map svg.mv-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .layer.map .mv-marks { position: absolute; inset: 0; pointer-events: none; --s: 3.4cqh; --ls: 2.3cqh; }
    .layer.map .mv-cap { position: absolute; left: 0; top: 0; opacity: 0; pointer-events: none; }
    .layer.map .mv-cap > div { position: absolute; left: 3.2cqh; top: 0; transform: translateY(-50%); min-width: 22cqh; max-width: 62cqh; padding: 1.6cqh 2.4cqh; border-radius: 1.6cqh;
      background: rgba(12,16,24,.82); backdrop-filter: blur(1.2cqh); color: #fff; border-left: .6cqh solid var(--c); box-shadow: 0 1cqh 4cqh rgba(0,0,0,.5); }
    .layer.map .mv-cap b { display: block; font-size: 4.4cqh; line-height: 1.1; }
    .layer.map .mv-cap span { display: block; margin-top: .8cqh; font-size: 2.4cqh; line-height: 1.3; opacity: .85; }
    .layer.map .mv-panel { position: absolute; top: 0; right: 0; bottom: 0; width: var(--pw); box-sizing: border-box; padding: 6cqh 4.5cqh; overflow: hidden;
      display: flex; flex-direction: column; gap: calc(1.7cqh * var(--k, 1)); opacity: 0; transform: translateX(14%); }
    .layer.map .mv-panel.over { top: 5cqh; bottom: 5cqh; right: 4cqh; border-radius: 2.4cqh; box-shadow: 0 2cqh 7cqh rgba(0,0,0,.45); }
    .layer.map .mv-panel.on { opacity: 1; transform: none; }
    .layer.map .mv-card { position: absolute; inset: 0; box-sizing: border-box; padding: 9cqh 10cqw; display: flex; gap: 6cqw; align-items: center; opacity: 0; pointer-events: none; }
    .layer.map .mv-card.on { opacity: 1; }
    .layer.map .mv-card .mv-txt { flex: 1 1 0; min-width: 0; max-height: 100%; display: flex; flex-direction: column; gap: calc(1.9cqh * var(--k, 1)); overflow: hidden; }
    .layer.map .mv-card .mv-pic { flex: 0 0 38%; max-height: 82cqh; aspect-ratio: 4 / 3.4; border-radius: 2cqh; background: center / cover no-repeat; box-shadow: 0 2cqh 6cqh rgba(0,0,0,.45); }
    .mv-th-dark { background: linear-gradient(180deg, rgba(14,19,29,.97), rgba(10,13,20,.97)); color: #f1f3f7; --mu: rgba(241,243,247,.68); --ln: rgba(255,255,255,.14); }
    .mv-th-glass { background: rgba(16,22,34,.58); backdrop-filter: blur(2.6cqh) saturate(1.3); color: #fff; --mu: rgba(255,255,255,.75); --ln: rgba(255,255,255,.2); }
    .mv-th-light { background: rgba(250,250,247,.96); color: #1d2430; --mu: rgba(29,36,48,.62); --ln: rgba(29,36,48,.14); }
    .mv-th-parch { background: linear-gradient(160deg, #f3e6c8, #e6d2a6); color: #3b2a17; --mu: rgba(59,42,23,.66); --ln: rgba(59,42,23,.2); }
    .mv-card.mv-th-glass { backdrop-filter: blur(4cqh) saturate(1.3); }
    .mv-in { display: contents; }
    .mv-kind { font-size: calc(2.1cqh * var(--k, 1)); font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--c); display: flex; align-items: center; gap: .6em; }
    .mv-kind::before { content: ''; width: 1.9em; height: .22em; border-radius: 1em; background: var(--c); }
    .mv-name { font-size: calc(6.4cqh * var(--k, 1)); font-weight: 750; line-height: 1.05; letter-spacing: -.01em; overflow-wrap: anywhere; }
    .mv-card .mv-name { font-size: calc(9cqh * var(--k, 1)); }
    .mv-dates { font-size: calc(2.5cqh * var(--k, 1)); color: var(--mu); font-weight: 600; }
    .mv-short { font-size: calc(3.1cqh * var(--k, 1)); line-height: 1.32; font-weight: 550; }
    .mv-p { font-size: calc(2.55cqh * var(--k, 1)); line-height: 1.42; color: var(--mu); white-space: pre-line; }
    .mv-h { font-size: calc(1.95cqh * var(--k, 1)); font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--mu); padding-top: calc(1.2cqh * var(--k, 1)); border-top: 1px solid var(--ln); margin-top: calc(.6cqh * var(--k, 1)); }
    .mv-ev { display: flex; gap: .7em; font-size: calc(2.45cqh * var(--k, 1)); line-height: 1.35; }
    .mv-ev::before { content: ''; flex: none; width: .5em; height: .5em; margin-top: .45em; border-radius: 50%; background: var(--c); }
    .mv-ev i { font-style: normal; color: var(--c); font-weight: 650; white-space: nowrap; }
    .mv-refs { display: flex; flex-wrap: wrap; gap: .5em; font-size: calc(2.3cqh * var(--k, 1)); }
    .mv-refs span { padding: .25em .7em; border-radius: 1em; border: 1px solid var(--ln); font-weight: 600; }
    .mv-pics { display: flex; gap: 1.2cqh; min-height: 0; }
    .mv-pics div { flex: 1 1 0; aspect-ratio: 16 / 10; max-height: 20cqh; border-radius: 1.2cqh; background: center / cover no-repeat; }
  `;
  let cssOn = false;
  function useCss() {
    if (cssOn || typeof document === 'undefined') return;
    cssOn = true;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.append(s);
  }

  // Текст карточки: тип, название, даты, кратко, описание, история, события, места Писания, картинки
  function cardInner(p, full, pics) {
    const box = el('div', 'mv-in');
    box.append(el('div', 'mv-kind', p.kind));
    box.append(el('div', 'mv-name', p.name));
    if (p.dates) box.append(el('div', 'mv-dates', p.dates));
    if (p.short) box.append(el('div', 'mv-short', p.short));
    if (p.desc) box.append(el('div', 'mv-p', p.desc));
    if (p.history) { box.append(el('div', 'mv-h', 'История')); box.append(el('div', 'mv-p', p.history)); }
    if (p.events.length) {
      box.append(el('div', 'mv-h', 'Библейские события'));
      for (const e of p.events.slice(0, 8)) {
        const r = el('div', 'mv-ev');
        const t = el('span', '', e.t);
        if (e.ref) { t.append(e.t ? ' · ' : ''); t.append(el('i', '', e.ref)); }
        r.append(t);
        box.append(r);
      }
    }
    if (p.refs.length) {
      if (!p.events.length) box.append(el('div', 'mv-h', 'Писание'));
      const r = el('div', 'mv-refs');
      for (const x of p.refs.slice(0, 12)) r.append(el('span', '', x));
      box.append(r);
    }
    if (pics && p.images.length && !full) {
      const r = el('div', 'mv-pics');
      for (const u of p.images.slice(0, 3)) { const d = el('div'); d.style.backgroundImage = `url("${u.replace(/"/g, '%22')}")`; r.append(d); }
      box.append(r);
    }
    return box;
  }
  // Ужать текст, пока не влезет (k — общий множитель размеров)
  function shrink(box) {
    let k = 1;
    box.style.setProperty('--k', '1');
    for (let i = 0; i < 9 && box.scrollHeight > box.clientHeight + 1 && k > 0.5; i++) { k -= 0.06; box.style.setProperty('--k', k.toFixed(2)); }
  }

  // Куда смотрит карта при этой компоновке: окно карты (в px слоя) и положение картинки в нём
  function target(c, LW, LH) {
    const look = c.look;
    const pw = clamp(num(look.panel, 38), 20, 60) / 100;
    const p = c.point;
    const v = { x: 0, y: 0, w: LW, h: LH };
    let z = 1;
    let cx = 0.5;
    let cy = 0.5;
    let ax = 0.5;
    let op = 1;
    const at = (zz) => { if (p) { z = zz; cx = p.x; cy = p.y; } };
    if (c.layout === 'side') { v.w = LW * (1 - pw); at(num(look.pz, 1.6)); }
    else if (c.layout === 'over') { ax = (1 - pw) / 2; at(num(look.pz, 1.6)); }
    else if (c.layout === 'focus') at(num(look.zoom, 2.6));
    else if (c.layout === 'card') { op = 0; at(num(look.pz, 1.6)); }
    const s0 = Math.min(v.w / c.w, v.h / c.h);
    if (!p && c.fit) {
      const [x0, y0, x1, y1] = c.fit;
      const bw = Math.max(0.02, x1 - x0) * c.w * s0;
      const bh = Math.max(0.02, y1 - y0) * c.h * s0;
      z = clamp(Math.min(v.w / bw, v.h / bh) / 1.35, 1, 8);
      cx = (x0 + x1) / 2;
      cy = (y0 + y1) / 2;
    }
    z = clamp(z, 1, 12);
    const s = s0 * z;
    const Wd = c.w * s;
    const Hd = c.h * s;
    let tx = v.w * ax - cx * Wd;
    let ty = v.h * 0.5 - cy * Hd;
    tx = Wd > v.w ? clamp(tx, v.w - Wd, 0) : (v.w - Wd) / 2;
    ty = Hd > v.h ? clamp(ty, v.h - Hd, 0) : (v.h - Hd) / 2;
    return { vx: v.x, vy: v.y, vw: v.w, vh: v.h, tx, ty, s, op };
  }
  const KEYS = ['vx', 'vy', 'vw', 'vh', 'tx', 'ty', 's', 'op'];
  const mix = (a, b, t) => { const o = {}; for (const k of KEYS) o[k] = a[k] + (b[k] - a[k]) * t; return o; };

  // Один кадр: окно карты, картинка, маркеры, маршруты, подпись
  function frame(L, S) {
    const M = L._mv;
    M.S = S;
    const vs = M.view.style;
    vs.left = S.vx + 'px'; vs.top = S.vy + 'px'; vs.width = S.vw + 'px'; vs.height = S.vh + 'px';
    vs.opacity = S.op.toFixed(3);
    const c = M.c;
    const is = M.img.style;
    is.left = S.tx + 'px'; is.top = S.ty + 'px'; is.width = c.w * S.s + 'px'; is.height = c.h * S.s + 'px';
    const X = (x) => S.tx + x * c.w * S.s;
    const Y = (y) => S.ty + y * c.h * S.s;
    for (const [id, m] of M.marks) m.el.style.transform = `translate(${X(m.p.x).toFixed(1)}px,${Y(m.p.y).toFixed(1)}px)`;
    const unit = L.clientHeight / 1080 || 0.5;
    for (const r of M.routes.values()) {
      const pts = r.r.stops.map((q) => [X(q[0]), Y(q[1])]);
      r.line.setAttribute('d', routePath(pts));
      r.line.setAttribute('stroke-width', (r.r.width * unit).toFixed(2));
      if (r.r.style === 'dash') r.line.setAttribute('stroke-dasharray', `${(r.r.width * unit * 2.6).toFixed(1)} ${(r.r.width * unit * 2).toFixed(1)}`);
      r.halo.setAttribute('d', r.line.getAttribute('d'));
      r.halo.setAttribute('stroke-width', (r.r.width * unit + 4 * unit).toFixed(2));
      if (r.arrows) r.arrows.setAttribute('d', arrowsPath(pts, Math.max(4, r.r.width * unit * 1.5)));
    }
    if (M.cap && c.point) M.cap.style.transform = `translate(${X(c.point.x).toFixed(1)}px,${Y(c.point.y).toFixed(1)}px)`;
  }

  function placeMarks(L) {
    const M = L._mv;
    const c = M.c;
    const seen = new Set();
    // Номера остановок у точек маршрутов
    const nums = new Map();
    for (const r of c.routes) if (r.numbers) r.stops.forEach((s, i) => { if (!nums.has(s[2])) nums.set(s[2], { n: i + 1, c: r.color }); });
    for (const p of c.points) {
      seen.add(p.id);
      let m = M.marks.get(p.id);
      if (!m) { m = { el: pin(p, c.labels) }; M.marks.set(p.id, m); M.marksBox.append(m.el); }
      else pinSet(m.el, p, c.labels);
      m.p = p;
      m.el.classList.toggle('on', !!(c.point && c.point.id === p.id) && c.layout !== 'card');
      let nb = m.el.querySelector(':scope > .mv-num');
      const n = nums.get(p.id);
      if (n && !nb) { nb = el('div', 'mv-num'); m.el.append(nb); }
      if (!n && nb) nb.remove();
      if (n) { nb.textContent = n.n; nb.style.setProperty('--rc', n.c); }
    }
    for (const [id, m] of M.marks) if (!seen.has(id)) { m.el.remove(); M.marks.delete(id); }
  }
  function placeRoutes(L, animate) {
    const M = L._mv;
    const seen = new Set();
    for (const r of M.c.routes) {
      seen.add(r.id);
      let x = M.routes.get(r.id);
      const sig = JSON.stringify(r);
      if (x && x.sig === sig) continue;
      const fresh = !x;
      if (!x) {
        const g = document.createElementNS(NS, 'g');
        const halo = document.createElementNS(NS, 'path');
        const line = document.createElementNS(NS, 'path');
        halo.setAttribute('fill', 'none'); halo.setAttribute('stroke', 'rgba(0,0,0,.35)'); halo.setAttribute('stroke-linecap', 'round'); halo.setAttribute('stroke-linejoin', 'round');
        line.setAttribute('fill', 'none'); line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round');
        g.append(halo, line);
        M.svg.append(g);
        x = { g, halo, line, arrows: null };
        M.routes.set(r.id, x);
      }
      x.sig = sig;
      x.r = r;
      x.line.setAttribute('stroke', r.color);
      if (r.style !== 'dash') x.line.removeAttribute('stroke-dasharray');
      if (r.arrows && !x.arrows) { x.arrows = document.createElementNS(NS, 'path'); x.g.append(x.arrows); }
      if (!r.arrows && x.arrows) { x.arrows.remove(); x.arrows = null; }
      if (x.arrows) x.arrows.setAttribute('fill', r.color);
      // Появление маршрута: линия прорисовывается от первой остановки к последней
      if (fresh && animate && r.ms > 0) {
        for (const pth of [x.line, x.halo]) {
          pth.setAttribute('pathLength', '1');
          if (r.style !== 'dash') {
            pth.style.strokeDasharray = '1 1';
            pth.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: r.ms, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'backwards', delay: 250 })
              .onfinish = () => { pth.style.strokeDasharray = ''; pth.removeAttribute('pathLength'); };
          }
        }
        if (r.style === 'dash') x.g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(900, r.ms), delay: 250, fill: 'backwards' });
        if (x.arrows) x.arrows.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: r.ms + 250 });
      }
    }
    for (const [id, x] of M.routes) if (!seen.has(id)) { x.g.remove(); M.routes.delete(id); }
  }
  function fillPanel(L, animate) {
    const M = L._mv;
    const c = M.c;
    const p = c.point;
    const panelOn = !!p && (c.layout === 'side' || c.layout === 'over');
    const cardOn = !!p && c.layout === 'card';
    const theme = THEMES.some(([k]) => k === c.look.theme) ? c.look.theme : 'dark';
    const sig = p ? JSON.stringify([p, theme, c.look.family]) : '';
    for (const [box, on, full] of [[M.panel, panelOn, false], [M.card, cardOn, true]]) {
      box.className = (box === M.panel ? 'mv-panel' : 'mv-card') + ' mv-th-' + theme + (box === M.panel && c.layout === 'over' ? ' over' : '');
      box.style.setProperty('--pw', clamp(num(c.look.panel, 38), 20, 60) + '%');
      if (p) box.style.setProperty('--c', p.color);
      if (c.look.family) box.style.fontFamily = c.look.family;
      if (on && box._sig !== sig) {
        const had = box._sig;
        box._sig = sig;
        const inner = box === M.card ? el('div', 'mv-txt') : box;
        const fill = cardInner(p, full, true);
        if (box === M.card) {
          inner.append(fill);
          const pic = p.images[0];
          const nodes = [inner];
          if (pic) { const d = el('div', 'mv-pic'); d.style.backgroundImage = `url("${pic.replace(/"/g, '%22')}")`; nodes.push(d); }
          box.replaceChildren(...nodes);
        } else box.replaceChildren(fill);
        if (!M.lite) requestAnimationFrame(() => shrink(inner));
        // Другая точка в той же панели — текст сменяется мягко
        if (animate && had && box.classList.contains('on')) fill.parentElement.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
      }
      box.classList.toggle('on', on);
    }
    // Подпись у точки — «Точка с подписью»; своя подпись точки на карте прячется
    M.marksBox.classList.toggle('mv-fc', !!p && c.layout === 'focus');
    if (M.cap) { M.cap.remove(); M.cap = null; }
    if (p && c.layout === 'focus') {
      M.cap = el('div', 'mv-cap');
      M.cap.style.setProperty('--c', p.color);
      const d = el('div');
      d.append(el('b', '', p.name));
      if (p.short || p.dates) d.append(el('span', '', p.short || p.dates));
      if (c.look.family) d.style.fontFamily = c.look.family;
      M.cap.append(d);
      M.view.append(M.cap);
      M.cap.animate([{ opacity: 0, translate: '-2cqh 0' }, { opacity: 1, translate: '0 0' }], { duration: animate ? 600 : 0, delay: animate ? Math.min(700, c.look.ms * 0.6) : 0, fill: 'both', easing: 'ease-out' });
    }
  }
  function sizeVars(L) {
    const M = L._mv;
    M.marksBox.style.setProperty('--s', (3.4 * clamp(num(M.c.look.marker, 1), 0.4, 3)).toFixed(2) + 'cqh');
    M.marksBox.style.setProperty('--ls', (2.3 * clamp(num(M.c.look.label, 1), 0.4, 3)).toFixed(2) + 'cqh');
    if (M.c.look.family) M.marksBox.style.fontFamily = M.c.look.family;
  }

  // Плавный переход к новой цели
  function go(L, ms) {
    const M = L._mv;
    cancelAnimationFrame(M.raf);
    const LW = L.clientWidth;
    const LH = L.clientHeight;
    if (!LW || !LH) { M.pending = true; return; }
    M.pending = false;
    const to = target(M.c, LW, LH);
    if (!M.S || !ms || M.lite) { frame(L, to); return; }
    const from = M.S;
    const ease = EASES[M.c.look.ease] || EASES.smooth;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      frame(L, mix(from, to, ease(t)));
      if (t < 1) M.raf = requestAnimationFrame(step);
    };
    M.raf = requestAnimationFrame(step);
    // Окно не рисуется (свёрнуто) — rAF стоит; через время перехода всё равно встаём на место
    clearTimeout(M.late);
    M.late = setTimeout(() => { if (M.S !== to && performance.now() - t0 >= ms) { cancelAnimationFrame(M.raf); frame(L, to); } }, ms + 300);
  }
  // Картинка: сразу лёгкое превью, а для большого экрана — полная копия, когда загрузится (интерфейс не ждёт)
  function upgrade(L) {
    const M = L._mv;
    const c = M.c;
    if (M.lite || !c.url || c.url === c.prev || M.img._full === c.url) return;
    const need = (L.clientWidth || 0) * (window.devicePixelRatio || 1) * Math.max(1, num(c.look.zoom, 1));
    if (need && need < 2048 * 0.9) return;
    const im = new Image();
    im.decoding = 'async';
    im.src = c.url;
    const put = () => { if (L._mv && L._mv.c.url === c.url) { M.img.src = c.url; M.img._full = c.url; } };
    (im.decode ? im.decode() : Promise.resolve()).then(put, () => {});
  }

  function build(c, lite) {
    useCss();
    const L = el('div', 'layer map');
    L.style.background = c.look.bg || '#000';
    const view = el('div', 'mv-view');
    const img = el('img', 'mv-img');
    img.decoding = 'async';
    img.draggable = false;
    img.alt = '';
    img.src = c.prev || c.url;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'mv-svg');
    const marksBox = el('div', 'mv-marks');
    view.append(img, svg, marksBox);
    const panel = el('div', 'mv-panel');
    const card = el('div', 'mv-card');
    L.append(view, panel, card);
    L._mv = { c, key: c.key, url: c.url, view, img, svg, marksBox, panel, card, marks: new Map(), routes: new Map(), S: null, raf: 0, lite: !!lite, cap: null };
    sizeVars(L);
    placeMarks(L);
    placeRoutes(L, !lite);
    fillPanel(L, false);
    if (!lite) {
      panel.style.transition = card.style.transition = `opacity ${Math.round(c.look.ms * 0.8)}ms ease, transform ${c.look.ms}ms cubic-bezier(.2,.75,.2,1)`;
    }
    // Размер слоя известен только в документе: первый кадр — когда слой встал на место, дальше — при каждом изменении размера
    const ro = new ResizeObserver(() => {
      if (!L.isConnected) return;
      cancelAnimationFrame(L._mv.raf);
      go(L, 0);
      upgrade(L);
    });
    ro.observe(L);
    L._mvStop = () => { ro.disconnect(); cancelAnimationFrame(L._mv.raf); clearTimeout(L._mv.late); };
    return L;
  }
  // Та же карта (тот же файл): новая компоновка, точка, маршруты — без перезагрузки картинки. false — не та карта
  function update(L, c) {
    const M = L && L._mv;
    if (!M || M.key !== c.key || M.url !== c.url) return false;
    const was = M.c;
    M.c = c;
    L.style.background = c.look.bg || '#000';
    sizeVars(L);
    placeMarks(L);
    placeRoutes(L, true);
    fillPanel(L, true);
    if (!M.lite) M.panel.style.transition = M.card.style.transition = `opacity ${Math.round(c.look.ms * 0.8)}ms ease, transform ${c.look.ms}ms cubic-bezier(.2,.75,.2,1)`;
    const same = was.layout === c.layout && (was.point && was.point.id) === (c.point && c.point.id) && JSON.stringify(was.fit) === JSON.stringify(c.fit);
    go(L, same ? 0 : num(c.look.ms, 1100));
    return true;
  }

  return { TYPES, GLYPHS, ICON_NAMES, LAYOUTS, THEMES, EASE_NAMES, DEF_LOOK, ROUTE_DEF, newId, normMap, normPoint, normRoute, newMap, content, bounds, visible, colorOf, iconOf, glyph, pin, pinSet, routePath, arrowsPath, useCss, build, update, target };
})();
if (typeof module !== 'undefined') module.exports = MapView;
