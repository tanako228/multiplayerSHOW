/* Пометки, заметка к песне и цифровой пенал (ТЗ-8-Группа.md, этап 3).
   Кнопка «Пенал» в шапке песни → лист становится светлым, на нём и вокруг него «раскладываются» предметы (вид сверху):
   стилус, карандаш, ручка, маркеры, текстовыделитель, ластик, линейка. Нажать на предмет — взять (инструмент),
   ещё раз — положить; перетащить — переложить. Раскладка — localStorage mps.desk (своя «стоя» и «лёжа»).
   Держите предмет пальцем и коснитесь вторым — предмет поворачивается за пальцами (вокруг своей оси); мышью — колесо.
   Звуки (выключаются в меню «…»): предметы высыпаются на лист, шорох бумаги под пером — WebAudio, без файлов.
   Текстовыделитель красит слова целиком (от слова, где начали, до слова под пальцем — как выделение текста);
   с линейкой — ровная полоса. Цвет — свои у предмета или любой из окна «Цвета» (как в iPadOS: сетка, спектр,
   ползунки, непрозрачность, свои цвета, пипетка) — тогда в пометке #rrggbb и o (непрозрачность).
   Линейка — ровные линии (по 45° прилипают) тем, что в руке. Рисует палец или стилус, двумя пальцами — листать;
   «Только стилус» — пальцем листать (включается само, когда телефон увидел стилус).
   Привязка пометки — к слову песни: id слайда (a.s), номер слова в слайде (a.w), точки — в долях размера шрифта (em)
   от левого верхнего угла слова (p: x, y, нажим, …). Поэтому пометки остаются на своих словах при другом размере
   текста, ширине экрана, с аккордами и без, на другом телефоне — свой шрифт не понадобился. Черта вдоль строки держится
   и за слово под концом (b: номер слова и расстояние) — тянется вместе со строкой. Выделитель — под текстом, остальное —
   поверх. Хранится на телефоне: IndexedDB marks (db.js), на сервер не уходит. Ключ — id песни (у «Моей версии» — свой). */
'use strict';
const Pen = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const S = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a || {}) e.setAttribute(k, a[k]); return e; };
  const $ = (id) => document.getElementById(id);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };
  const r2 = (n) => Math.round(n * 100) / 100;
  const r1 = (n) => Math.round(n * 10) / 10;
  const pt = (q) => `${r1(q[0])} ${r1(q[1])}`;

  /* ----- Инструменты ----- */

  // Цвет — имя (класс c-имя): на светлом листе и на тёмном экране он свой (pen.css)
  const INK = ['ink', 'blue', 'red', 'green', 'orange', 'violet', 'graphite'];
  const HL = ['yellow', 'lime', 'pink', 'sky'];
  const SIZES = [0.6, 1, 1.7];
  const TOOLS = {
    stylus: { name: 'Стилус', k: 'ink', c: 'ink', w: 0.12, colors: INK },
    pencil: { name: 'Карандаш', k: 'pencil', c: 'graphite', w: 0.085, colors: INK },
    pen: { name: 'Ручка', k: 'pen', c: 'blue', w: 0.07, colors: INK },
    mRed: { name: 'Красный маркер', k: 'marker', c: 'red', w: 0.2 },
    mBlue: { name: 'Синий маркер', k: 'marker', c: 'blue', w: 0.2 },
    mGreen: { name: 'Зелёный маркер', k: 'marker', c: 'green', w: 0.2 },
    hl: { name: 'Текстовыделитель', k: 'hl', c: 'yellow', w: 1.05, colors: HL },
    eraser: { name: 'Ластик', k: 'eraser' },
    ruler: { name: 'Линейка', k: 'ruler' },
  };
  const DRAW = (id) => !!TOOLS[id] && TOOLS[id].k !== 'eraser' && TOOLS[id].k !== 'ruler';
  let prefs = {};
  try { prefs = JSON.parse(lsGet('mps.tools', '{}')) || {}; } catch { prefs = {}; }
  const HEX = /^#[0-9a-f]{6}$/i;
  const colorOf = (id) => { const t = TOOLS[id]; const c = prefs[id] && prefs[id].c; return t.colors && (t.colors.includes(c) || HEX.test(c)) ? c : t.c; };
  const opOf = (id) => { const o = prefs[id] && prefs[id].o; return HEX.test(colorOf(id)) && o >= 0.05 && o < 1 ? o : 1; };
  // Цвет пометки: имя (класс c-имя, свой на тёмном и светлом фоне) или #rrggbb
  function tint(el, c, o, fill) {
    if (HEX.test(c)) el.style.color = c; else el.classList.add('c-' + c);
    if (o != null && o < 1) el.setAttribute(fill ? 'fill-opacity' : 'stroke-opacity', String(o));
  }
  const sizeOf = (id) => { const s = prefs[id] && prefs[id].s; return SIZES[s] ? s : 1; };
  const widthOf = (id) => TOOLS[id].w * SIZES[sizeOf(id)];
  const setPref = (id, k, v) => { prefs[id] = { ...(prefs[id] || {}), [k]: v }; lsSet('mps.tools', JSON.stringify(prefs)); };

  /* ----- Состояние ----- */

  let body = null;      // #songBody
  let view = null;      // открытая песня (cur в app.js)
  let rec = null;       // { id, v, strokes, note, at }
  let isOpen = false;
  let openKey = '';
  let tool = TOOLS[lsGet('mps.tool', '')] ? lsGet('mps.tool', '') : '';
  let ruler = false;
  let penOnly = lsGet('mps.penOnly', '0') === '1';
  let penSeen = penOnly;
  let undo = [];
  let redo = [];
  let under = null;     // svg под текстом (выделитель)
  let over = null;      // svg поверх текста (всё остальное) — он же ловит палец
  let ug = null;
  let og = null;
  let f = 22;           // размер шрифта текста, px
  const secs = new Map();
  const wcache = new Map();
  let onChange = () => {};
  const key = (v) => (v && (v.markKey || v.id)) || '';

  /* ----- Слова и их места ----- */

  function measure() {
    const tx = body.querySelector('.tx');
    f = parseFloat(getComputedStyle(tx || body).fontSize) || 22;
    secs.clear();
    wcache.clear();
    for (const sec of body.querySelectorAll('.sl')) secs.set(sec.dataset.id, sec);
  }
  const wordsOf = (sec) => { let w = wcache.get(sec); if (!w) { w = [...sec.querySelectorAll('.w')]; wcache.set(sec, w); } return w; };
  function rel(elm, br) {
    const r = elm.getClientRects()[0] || elm.getBoundingClientRect();
    return { l: r.left - br.left, t: r.top - br.top, r: r.right - br.left, b: r.bottom - br.top };
  }
  // Ближайшее слово в слайде: по высоте важнее (своя строка), чем по ширине. Слову принадлежит и место под ним
  // (подчеркнули между строками — это слово сверху), верх его рамки — почти нет (там кончается строка выше)
  function nearestIn(sec, sid, x, y, br) {
    let best = null;
    let bd = Infinity;
    wordsOf(sec).forEach((w, i) => {
      const r = rel(w, br);
      const top = r.t + (r.b - r.t) * 0.3;
      const bot = r.b + f * 0.3;
      const dx = x < r.l ? r.l - x : x > r.r ? x - r.r : 0;
      const dy = y < top ? top - y : y > bot ? y - bot : 0;
      const d = dx * dx + 9 * dy * dy;
      if (d < bd) { bd = d; best = { sec, sid, i, r }; }
    });
    return best;
  }
  function nearestWord(x, y, br) {
    let best = null;
    let bd = Infinity;
    for (const [sid, sec] of secs) {
      if (!wordsOf(sec).length) continue;
      const r = rel(sec, br);
      const d = y < r.t ? r.t - y : y > r.b ? y - r.b : 0;
      if (d < bd) { bd = d; best = [sec, sid]; }
      if (!d) break;
    }
    return best ? nearestIn(best[0], best[1], x, y, br) : null;
  }
  // Пометка → точки на экране (px от угла #songBody)
  function place(st, br) {
    const sec = secs.get(st.a.s);
    if (!sec) return null;
    const ws = wordsOf(sec);
    const A = ws[Math.min(st.a.w, ws.length - 1)];
    if (!A) return null;
    const ra = rel(A, br);
    let sx = 1;
    if (st.b && st.b.d > 0.3 && ws[st.b.w]) {
      const rb = rel(ws[st.b.w], br);
      if (Math.abs(rb.t - ra.t) < f * 0.5) sx = Math.min(1.8, Math.max(0.55, (rb.l - ra.l) / f / st.b.d));
    }
    const out = [];
    for (let i = 0; i + 2 < st.p.length; i += 3) out.push([ra.l + st.p[i] * f * sx, ra.t + st.p[i + 1] * f, st.p[i + 2]]);
    return out.length ? out : null;
  }
  // Точки на экране → пометка, привязанная к словам
  function toStroke(pts, d) {
    measure();
    const br = body.getBoundingClientRect();
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    // Маленькая пометка (обвели слово, галочка) — к слову под серединой, длинная — к слову под началом
    const compact = x1 - x0 < 3 * f && y1 - y0 < 3 * f;
    const A = compact ? nearestWord((x0 + x1) / 2, (y0 + y1) / 2, br) : nearestWord(pts[0][0], pts[0][1], br);
    if (!A) return null;
    const st = { k: d.k, c: d.c, w: r2(d.w), a: { s: A.sid, w: A.i }, p: [] };
    if (d.o < 1) st.o = r2(d.o);
    if (!compact) {
      const lp = pts[pts.length - 1];
      const B = nearestIn(A.sec, A.sid, lp[0], lp[1], br);
      if (B && B.i !== A.i && Math.abs(B.r.t - A.r.t) < f * 0.5 && (B.r.l - A.r.l) / f > 0.3) st.b = { w: B.i, d: r2((B.r.l - A.r.l) / f) };
    }
    for (const q of pts) st.p.push(r2((q[0] - A.r.l) / f), r2((q[1] - A.r.t) / f), r2(q[2]));
    return st;
  }

  /* ----- Рисунок линии ----- */

  // Через середины соседних точек — плавно
  function smooth(px) {
    if (px.length === 1) return `M${pt(px[0])}L${r1(px[0][0] + 0.1)} ${r1(px[0][1])}`;
    let d = `M${pt(px[0])}`;
    for (let i = 1; i < px.length - 1; i++) d += `Q${pt(px[i])} ${r1((px[i][0] + px[i + 1][0]) / 2)} ${r1((px[i][1] + px[i + 1][1]) / 2)}`;
    return d + `L${pt(px[px.length - 1])}`;
  }
  function through(p) {
    let d = '';
    for (let i = 1; i < p.length - 1; i++) d += `Q${pt(p[i])} ${r1((p[i][0] + p[i + 1][0]) / 2)} ${r1((p[i][1] + p[i + 1][1]) / 2)}`;
    return d + `L${pt(p[p.length - 1])}`;
  }
  // Стилус: толщина по нажиму — контур линии (обе стороны и круглые концы)
  function outline(px, w) {
    const n = px.length;
    const rad = (i) => Math.max(0.35, (w / 2) * (0.3 + 0.95 * px[i][2]) * Math.min(1, 0.6 + 0.2 * Math.min(i, n - 1 - i)));
    if (n < 3) {
      const r = rad(0);
      if (n === 1 || Math.hypot(px[1][0] - px[0][0], px[1][1] - px[0][1]) < r) return `M${r1(px[0][0] - r)} ${r1(px[0][1])}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0Z`;
    }
    const L = [];
    const R = [];
    for (let i = 0; i < n; i++) {
      const a = px[Math.max(0, i - 1)];
      const b = px[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      const r = rad(i);
      L.push([px[i][0] - ty * r, px[i][1] + tx * r]);
      R.push([px[i][0] + ty * r, px[i][1] - tx * r]);
    }
    const re = r1(rad(n - 1));
    const rs = r1(rad(0));
    R.reverse();
    return `M${pt(L[0])}${through(L)}A${re} ${re} 0 0 0 ${pt(R[0])}${through(R)}A${rs} ${rs} 0 0 0 ${pt(L[0])}Z`;
  }
  function pathFor(st, px) {
    const w = st.w * f;
    if (st.k === 'ink') { const p = S('path', { d: outline(px, w), class: 'k-ink', fill: 'currentColor' }); tint(p, st.c, st.o, true); return p; }
    const p = S('path', { d: smooth(px), class: 'k-' + st.k, fill: 'none', stroke: 'currentColor', 'stroke-width': r2(w),
      'stroke-linecap': st.k === 'hl' ? 'butt' : 'round', 'stroke-linejoin': 'round' });
    tint(p, st.c, st.o, false);
    if (st.k === 'pencil') p.setAttribute('filter', 'url(#mkGrain)');
    return p;
  }
  // Выделитель по словам: слова a.w…e слайда a.s → полосы по строкам (px от угла #songBody)
  function wordRects(sid, i0, i1, br) {
    const sec = secs.get(sid);
    if (!sec) return [];
    const ws = wordsOf(sec);
    const lines = [];
    for (let i = Math.max(0, Math.min(i0, i1)); i <= Math.min(ws.length - 1, Math.max(i0, i1)); i++) {
      for (const cr of ws[i].getClientRects()) {
        if (!cr.width) continue;
        const r = { l: cr.left - br.left, t: cr.top - br.top, r: cr.right - br.left, b: cr.bottom - br.top };
        const ln = lines.find((q) => Math.abs(q.t - r.t) < f * 0.45);
        if (ln) { ln.l = Math.min(ln.l, r.l); ln.r = Math.max(ln.r, r.r); ln.t = Math.min(ln.t, r.t); ln.b = Math.max(ln.b, r.b); } else lines.push(r);
      }
    }
    return lines;
  }
  const HLH = [0.42, 0.72, 0.96]; // высота полосы — доля строки (Тонко, Средне, Толсто)
  function wordsPath(st, rects) {
    const h0 = HLH[st.h] || HLH[1];
    let d = '';
    for (const q of rects) {
      const h = (q.b - q.t) * h0;
      const cy = q.t + (q.b - q.t) * (h0 > 0.9 ? 0.5 : 0.6);
      const t = cy - h / 2;
      const b = cy + h / 2;
      const l = q.l - f * 0.1;
      const r = q.r + f * 0.1;
      const e = h * 0.22; // конец полосы — скошенный, как от плоского кончика выделителя
      d += `M${r1(l + e)} ${r1(t)}L${r1(r)} ${r1(t + 0.5)}L${r1(r + e * 0.6)} ${r1(b)}L${r1(l)} ${r1(b - 0.5)}Z`;
    }
    const p = S('path', { d, class: 'k-hlw', fill: 'currentColor', 'stroke-linejoin': 'round' });
    tint(p, st.c, st.o, true);
    return p;
  }

  /* ----- Слои пометок ----- */

  function overlays() {
    under = S('svg', { class: 'mk mk-under', 'aria-hidden': 'true' });
    over = S('svg', { class: 'mk mk-over', 'aria-hidden': 'true' });
    ug = S('g');
    og = S('g');
    under.append(ug);
    // Зерно карандаша: пятнистая прозрачность
    const defs = S('defs');
    const fl = S('filter', { id: 'mkGrain', x: '-10%', y: '-10%', width: '120%', height: '120%' });
    fl.append(S('feTurbulence', { type: 'fractalNoise', baseFrequency: '1.1', numOctaves: '2', seed: '3', result: 'n' }),
      S('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1.5 1.35', result: 'm' }),
      S('feComposite', { in: 'SourceGraphic', in2: 'm', operator: 'in' }));
    defs.append(fl);
    over.append(defs, og);
    body.prepend(under);
    body.append(over);
    over.addEventListener('pointerdown', onDown);
    over.addEventListener('pointermove', onMove);
    over.addEventListener('pointerup', onUp);
    over.addEventListener('pointercancel', onUp);
    over.addEventListener('lostpointercapture', (e) => { if (drawing && e.pointerId === drawing.id) finishStroke(); });
    setInput();
  }
  let raf = 0;
  const sched = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  function render() {
    if (!body || !over || !rec || !over.isConnected) return;
    measure();
    const br = body.getBoundingClientRect();
    ug.replaceChildren();
    og.replaceChildren();
    for (const st of rec.strokes) {
      if (st.e != null) {
        st._px = null;
        st._rects = wordRects(st.a.s, st.a.w, st.e, br);
        if (st._rects.length) ug.append(wordsPath(st, st._rects));
        continue;
      }
      const px = place(st, br);
      st._px = px;
      if (px) (st.k === 'hl' ? ug : og).append(pathFor(st, px));
    }
    if (drawing && drawing.el) (drawing.k === 'hl' ? ug : og).append(drawing.el);
  }

  /* ----- Песня открыта ----- */

  async function show(v) {
    body = $('songBody');
    view = v;
    const can = !!(v && v.song);
    $('penBtn').hidden = !can;
    if (isOpen && (!can || key(v) !== openKey)) close();
    if (!can) { rec = null; return; }
    overlays();
    const k = key(v);
    if (!rec || rec.id !== k) {
      undo = [];
      redo = [];
      rec = { id: k, v: 1, strokes: [], note: '', at: 0 };
      let r = null;
      try { r = await Store.getRec('marks', k); } catch { r = null; }
      if (view !== v) return;
      if (r && Array.isArray(r.strokes)) rec = { id: k, v: 1, strokes: r.strokes.filter((s) => s && s.a && Array.isArray(s.p)), note: String(r.note || ''), at: r.at || 0 };
    }
    paintNote();
    render();
  }

  // Сохранить на телефоне (чуть позже — пачкой; при закрытии пенала — сразу)
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(flush, 400); };
  function flush() {
    clearTimeout(saveT);
    saveT = 0;
    if (!rec) return;
    const r = { id: rec.id, v: 1, strokes: rec.strokes.map(({ _px, _rects, ...x }) => x), note: rec.note || '', at: Date.now() };
    (r.strokes.length || r.note ? Store.putRec('marks', r) : Store.delRec('marks', r.id))
      .catch((e) => toast('Пометки не сохранились: ' + (e.message || e)));
  }

  /* ----- Звуки: предметы высыпались на лист, шорох бумаги под пером (WebAudio, без файлов) ----- */

  const Snd = (() => {
    let on = lsGet('mps.penSnd', '1') !== '0';
    let ac = null;
    let buf = null;
    let scr = null;
    function ctx() {
      if (!on) return null;
      try {
        if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
      } catch { ac = null; }
      return ac;
    }
    // Шум бумаги: мягкий белый шум с «зерном» — громкость мелко скачет, как волокна листа под кончиком
    function noise() {
      if (buf) return buf;
      const n = ac.sampleRate * 2;
      buf = ac.createBuffer(1, n, ac.sampleRate);
      const d = buf.getChannelData(0);
      let g = 1;
      let b = 0;
      for (let i = 0; i < n; i++) {
        if (i % 48 === 0) g = Math.random() < 0.06 ? 1.5 : 0.3 + Math.random() * 0.7;
        b = 0.55 * b + 0.45 * (Math.random() * 2 - 1);
        d[i] = b * g;
      }
      return buf;
    }
    const hold = (p, t) => { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); } };
    // Удар предмета о тетрадь: щелчок корпуса (шум в полосе своего тона) + глухой стук листа
    const HIT = { stylus: [2900, 260], pencil: [1700, 200], pen: [2400, 240], mRed: [1900, 210], mBlue: [2000, 215], mGreen: [1850, 205],
      hl: [1500, 190], eraser: [650, 130], ruler: [1250, 170] };
    function hit(at, id, vol) {
      const [fq, low] = HIT[id] || [1600, 200];
      const src = ac.createBufferSource();
      src.buffer = noise();
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq * (0.9 + Math.random() * 0.2);
      bp.Q.value = id === 'ruler' ? 3 : 1.4;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (id === 'ruler' ? 0.09 : id === 'eraser' ? 0.035 : 0.05));
      src.connect(bp).connect(g).connect(ac.destination);
      src.start(at, Math.random() * 1.5, 0.12);
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(low * 1.5, at);
      o.frequency.exponentialRampToValueAtTime(low * 0.7, at + 0.07);
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0.0001, at);
      g2.gain.exponentialRampToValueAtTime(vol * 0.7, at + 0.003);
      g2.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      o.connect(g2).connect(ac.destination);
      o.start(at);
      o.stop(at + 0.1);
    }
    // Пенал открыли: предметы падают с небольшой высоты один за другим, круглые чуть подпрыгивают
    function drop(ids) {
      if (!ctx()) return;
      const t0 = ac.currentTime + 0.03;
      ids.forEach((id, i) => {
        const at = t0 + 0.16 + i * 0.035 + Math.random() * 0.025;
        const v = id === 'eraser' ? 0.5 : id === 'ruler' ? 0.42 : 0.32;
        hit(at, id, v);
        if (id !== 'eraser') hit(at + 0.055 + Math.random() * 0.03, id, v * 0.28);
        if (id !== 'eraser' && id !== 'ruler') hit(at + 0.1 + Math.random() * 0.04, id, v * 0.1);
      });
    }
    // Шорох под пером: громче, чем быстрее ведут; остановились — тихо
    const SCR = { ink: [2100, 0.9, 0.16], pencil: [4300, 0.7, 0.3], pen: [3000, 1.1, 0.18], marker: [1400, 0.8, 0.2], hl: [1200, 0.7, 0.18], eraser: [750, 0.6, 0.42] };
    function scratch(k) {
      stop();
      if (!ctx()) return;
      const [fq, q, vol] = SCR[k] || SCR.pen;
      const src = ac.createBufferSource();
      src.buffer = noise();
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = q;
      const g = ac.createGain();
      g.gain.value = 0;
      src.connect(bp).connect(g).connect(ac.destination);
      src.start(0, Math.random() * 1.8);
      scr = { src, g, bp, fq, vol };
    }
    function speed(v) {
      if (!scr || !ac) return;
      const t = ac.currentTime;
      const lvl = scr.vol * Math.min(1, Math.max(0, v - 0.02) / 0.9);
      hold(scr.g.gain, t);
      scr.g.gain.setTargetAtTime(lvl, t, 0.012);
      scr.g.gain.setTargetAtTime(0, t + 0.07, 0.035);
      scr.bp.frequency.setTargetAtTime(scr.fq * (0.85 + Math.min(0.45, v * 0.3)), t, 0.03);
    }
    function stop() {
      if (!scr) return;
      const s = scr;
      scr = null;
      const t = ac.currentTime;
      hold(s.g.gain, t);
      s.g.gain.setTargetAtTime(0, t, 0.02);
      try { s.src.stop(t + 0.15); } catch { /* уже */ }
    }
    return {
      drop, scratch, speed, stop,
      get on() { return on; },
      set on(v) { on = !!v; lsSet('mps.penSnd', on ? '1' : '0'); if (!on) stop(); },
    };
  })();

  /* ----- Ввод: палец, стилус, мышь ----- */

  let drawing = null;   // { id, type, k, c, o, w, h, straight, pts, end, last, el, words }
  let erasing = null;   // { id, type, list: [{ st, i }] }
  let pan = null;       // листать: { ids, y, v, t }
  let glide = 0;
  const ptrs = new Map();
  let liveRaf = 0;

  function setInput() {
    if (!over) return;
    over.classList.toggle('on', isOpen && (DRAW(tool) || tool === 'eraser'));
    over.classList.toggle('erase', isOpen && tool === 'eraser');
  }
  function local(e) {
    const br = body.getBoundingClientRect();
    return [e.clientX - br.left, e.clientY - br.top];
  }
  function onDown(e) {
    if (!isOpen) return;
    if (e.pointerType === 'pen' && !penSeen) { penSeen = true; if (!penOnly) setPenOnly(true, true); }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const fingers = [...ptrs.values()].filter((p) => p.type === 'touch').length;
    if (e.pointerType === 'touch' && (penOnly || fingers >= 2)) {
      if (drawing && drawing.type === 'touch') cancelStroke();
      if (erasing && erasing.type === 'touch') endErase();
      startPan(e);
      return;
    }
    if (drawing || erasing) return;
    e.preventDefault();
    try { over.setPointerCapture(e.pointerId); } catch { /* уже */ }
    const [x, y] = local(e);
    if (eyedrop) { eyedrop = false; measure(); takeColor(x, y); return; }
    if (tool === 'eraser') {
      measure();
      erasing = { id: e.pointerId, type: e.pointerType, list: [], last: { x, y, t: e.timeStamp } };
      eraseAt(x, y);
      cursor(x, y);
      Snd.scratch('eraser');
      return;
    }
    if (!DRAW(tool)) return;
    const p0 = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    const k = TOOLS[tool].k;
    drawing = { id: e.pointerId, type: e.pointerType, k, c: colorOf(tool), o: opOf(tool), w: widthOf(tool), h: sizeOf(tool), straight: ruler,
      pts: [[x, y, p0]], end: null, last: { x, y, t: e.timeStamp, p: p0 }, el: null, words: null };
    measure();
    if (k === 'hl' && !ruler) {
      const A = nearestWord(x, y, body.getBoundingClientRect());
      if (!A) { drawing = null; return; }
      drawing.words = { sec: A.sec, sid: A.sid, a: A.i, b: A.i };
    }
    Snd.scratch(k);
    liveDraw();
  }
  function onMove(e) {
    const q = ptrs.get(e.pointerId);
    if (q) { q.x = e.clientX; q.y = e.clientY; }
    if (pan && pan.ids.has(e.pointerId)) { panMove(); return; }
    if (erasing && e.pointerId === erasing.id) {
      const [x, y] = local(e);
      const L = erasing.last;
      Snd.speed(Math.hypot(x - L.x, y - L.y) / Math.max(1, e.timeStamp - L.t));
      erasing.last = { x, y, t: e.timeStamp };
      eraseAt(x, y);
      cursor(x, y);
      return;
    }
    if (!drawing || e.pointerId !== drawing.id) return;
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const L0 = drawing.last;
    for (const ev of evs.length ? evs : [e]) addPt(ev);
    const L1 = drawing.last;
    if (L1 !== L0) Snd.speed(Math.hypot(L1.x - L0.x, L1.y - L0.y) / Math.max(1, L1.t - L0.t));
    if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; if (drawing) liveDraw(); });
  }
  function onUp(e) {
    ptrs.delete(e.pointerId);
    if (pan && pan.ids.has(e.pointerId)) { pan.ids.delete(e.pointerId); if (pan.ids.size) panReset(); else endPan(); return; }
    if (erasing && e.pointerId === erasing.id) { endErase(); return; }
    if (drawing && e.pointerId === drawing.id) { if (e.type === 'pointercancel') cancelStroke(); else finishStroke(); }
  }
  function addPt(ev) {
    const [x, y] = local(ev);
    const L = drawing.last;
    const d = Math.hypot(x - L.x, y - L.y);
    if (d < 0.8) return;
    let p;
    if (ev.pointerType === 'pen' && ev.pressure > 0) p = ev.pressure;
    else {
      // Палец и мышь нажима не знают — по скорости: быстрее → тоньше
      const v = d / Math.max(1, ev.timeStamp - L.t);
      p = L.p + (Math.max(0.2, Math.min(0.9, 0.95 - v * 0.35)) - L.p) * 0.35;
    }
    drawing.last = { x, y, t: ev.timeStamp, p };
    if (drawing.straight) drawing.end = [x, y, p];
    else drawing.pts.push([x, y, p]);
  }
  // По линейке: от начала до пальца; почти по 0° / 45° / 90° — ровно
  function straightPts() {
    const a = drawing.pts[0];
    const b = drawing.end || a;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const sn = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(ang - sn) < 0.12) { dx = Math.cos(sn) * len; dy = Math.sin(sn) * len; }
    const n = Math.max(1, Math.ceil(len / 6));
    const out = [];
    for (let i = 0; i <= n; i++) out.push([a[0] + (dx * i) / n, a[1] + (dy * i) / n, 0.6]);
    return out;
  }
  function liveDraw() {
    let el;
    if (drawing.words) {
      // Выделитель: от слова, где начали, до слова под пальцем (в том же слайде)
      const w = drawing.words;
      const br = body.getBoundingClientRect();
      const B = nearestIn(w.sec, w.sid, drawing.last.x, drawing.last.y, br);
      if (B) w.b = B.i;
      el = wordsPath({ c: drawing.c, o: drawing.o, h: drawing.h }, wordRects(w.sid, w.a, w.b, br));
    } else el = pathFor({ k: drawing.k, c: drawing.c, o: drawing.o, w: drawing.w }, drawing.straight ? straightPts() : drawing.pts);
    if (drawing.el && drawing.el.isConnected) drawing.el.replaceWith(el);
    else (drawing.k === 'hl' ? ug : og).append(el);
    drawing.el = el;
  }
  function cancelStroke() {
    if (drawing && drawing.el) drawing.el.remove();
    drawing = null;
    Snd.stop();
  }
  function finishStroke() {
    const d = drawing;
    if (!d) return;
    Snd.stop();
    if (d.words) {
      if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; liveDraw(); }
      drawing = null;
      if (d.el) d.el.remove();
      const w = d.words;
      const st = { k: 'hl', c: d.c, w: 0, h: d.h, a: { s: w.sid, w: Math.min(w.a, w.b) }, e: Math.max(w.a, w.b), p: [] };
      if (d.o < 1) st.o = r2(d.o);
      rec.strokes.push(st);
      undo.push({ add: [st] });
      redo = [];
      save();
      render();
      paintBar();
      return;
    }
    const pts = d.straight ? straightPts() : d.pts;
    drawing = null;
    if (d.el) d.el.remove();
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if ((d.k === 'hl' || d.straight) && len < 4) { render(); return; }
    const st = toStroke(pts, d);
    if (!st) { render(); return; }
    rec.strokes.push(st);
    undo.push({ add: [st] });
    redo = [];
    save();
    render();
    paintBar();
  }

  // Ластик стирает линию целиком — ту, которой коснулся
  function near(px, x, y, r) {
    const r2q = r * r;
    for (let i = 0; i < px.length; i++) {
      const a = px[i];
      const b = px[i + 1] || a;
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const l = vx * vx + vy * vy;
      const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l)) : 0;
      const dx = a[0] + vx * t - x;
      const dy = a[1] + vy * t - y;
      if (dx * dx + dy * dy <= r2q) return true;
    }
    return false;
  }
  const hits = (st, x, y, r) => (st._px && near(st._px, x, y, r + (st.w * f) / 2)) ||
    (st._rects && st._rects.some((q) => x >= q.l - r && x <= q.r + r && y >= q.t - r && y <= q.b + r));
  function eraseAt(x, y) {
    const hit = rec.strokes.filter((st) => hits(st, x, y, 10));
    if (!hit.length) return;
    for (const st of hit) {
      const i = rec.strokes.indexOf(st);
      rec.strokes.splice(i, 1);
      erasing.list.push({ st, i });
    }
    render();
  }
  function endErase() {
    if (erasing && erasing.list.length) { undo.push({ del: erasing.list }); redo = []; save(); paintBar(); }
    erasing = null;
    Snd.stop();
    cursor();
  }
  let cur = null;
  function cursor(x, y) {
    if (x == null) { if (cur) cur.remove(); cur = null; return; }
    if (!cur || !cur.isConnected) { cur = S('circle', { class: 'er-cur', r: '10' }); og.append(cur); }
    cur.setAttribute('cx', r1(x));
    cur.setAttribute('cy', r1(y));
  }

  // Двумя пальцами (или пальцем при «Только стилус») — листать, с разгоном
  function startPan(e) {
    cancelAnimationFrame(glide);
    if (!pan) pan = { ids: new Set(), y: 0, v: 0, t: 0 };
    pan.ids.add(e.pointerId);
    panReset();
  }
  const panY = () => { let s = 0; let n = 0; for (const id of pan.ids) { const p = ptrs.get(id); if (p) { s += p.y; n++; } } return n ? s / n : pan.y; };
  function panReset() { pan.y = panY(); pan.t = performance.now(); }
  function panMove() {
    const y = panY();
    const now = performance.now();
    const dy = y - pan.y;
    window.scrollBy(0, -dy);
    pan.v = 0.7 * (-dy / Math.max(1, now - pan.t)) + 0.3 * pan.v;
    pan.y = y;
    pan.t = now;
  }
  function endPan() {
    let v = pan ? pan.v : 0;
    pan = null;
    const step = () => { if (Math.abs(v) < 0.03) return; window.scrollBy(0, v * 16); v *= 0.94; glide = requestAnimationFrame(step); };
    if (Math.abs(v) > 0.15) glide = requestAnimationFrame(step);
  }

  /* ----- Отмена, заметка ----- */

  function applyOp(op, back) {
    if (op.add) { if (back) rec.strokes = rec.strokes.filter((s) => !op.add.includes(s)); else rec.strokes.push(...op.add); }
    if (op.del) {
      if (back) for (let j = op.del.length - 1; j >= 0; j--) rec.strokes.splice(op.del[j].i, 0, op.del[j].st);
      else for (const x of op.del) { const i = rec.strokes.indexOf(x.st); if (i >= 0) rec.strokes.splice(i, 1); }
    }
    if (op.clear) rec.strokes = back ? op.clear.slice() : [];
    if (op.note) { rec.note = back ? op.note[0] : op.note[1]; paintNote(); }
  }
  function step(back) {
    const from = back ? undo : redo;
    const op = from.pop();
    if (!op || !rec) return;
    applyOp(op, back);
    (back ? redo : undo).push(op);
    save();
    render();
    paintBar();
  }
  function clearAll() {
    if (!rec || !rec.strokes.length) { toast('На этой песне пометок нет'); return; }
    undo.push({ clear: rec.strokes.slice() });
    redo = [];
    rec.strokes = [];
    save();
    render();
    paintBar();
    toast('Пометки стёрты — «Отменить» вернёт');
  }
  function paintNote() {
    let n = body.querySelector('.sticky');
    const t = rec && rec.note;
    if (!t) { if (n) n.remove(); return; }
    if (!n) {
      n = document.createElement('button');
      n.type = 'button';
      n.className = 'sticky';
      n.setAttribute('aria-label', 'Заметка к песне — изменить');
      n.onclick = editNote;
      const ord = body.querySelector('.order');
      if (ord) ord.after(n); else body.insertBefore(n, body.querySelector('.sl'));
    }
    n.textContent = t;
  }
  function editNote() {
    if (!rec) return;
    const d = $('noteDlg');
    $('noteText').value = rec.note || '';
    $('noteDel').hidden = !rec.note;
    $('noteOk').onclick = () => { setNote($('noteText').value.trim().slice(0, 2000)); d.close(); };
    $('noteDel').onclick = () => { setNote(''); d.close(); };
    d.showModal();
    setTimeout(() => $('noteText').focus(), 60);
  }
  function setNote(t) {
    const was = rec.note || '';
    if (t === was) return;
    undo.push({ note: [was, t] });
    redo = [];
    rec.note = t;
    flush();
    paintNote();
    paintBar();
  }

  /* ----- Пенал: предметы на столе ----- */

  const DESK = ['ruler', 'mBlue', 'mGreen', 'hl', 'pencil', 'stylus', 'pen', 'mRed', 'eraser'];
  const SIZE = { stylus: [176, 12], pencil: [168, 12], pen: [150, 12], mRed: [128, 20], mBlue: [128, 20], mGreen: [128, 20], hl: [122, 26], eraser: [58, 26], ruler: [250, 36] };
  const grad = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">` +
    stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('') + '</linearGradient>';
  const marker = (id, base, light, dark) => `<svg viewBox="0 0 128 20"><defs>` +
    grad(`pg${id}b`, [[0, '#c4c4c2'], [0.22, '#f7f7f6'], [0.48, '#ffffff'], [0.8, '#e0e0de'], [1, '#aeaeac']]) +
    grad(`pg${id}c`, [[0, dark], [0.28, base], [0.47, light], [0.7, base], [1, dark]]) + `</defs>
    <path d="M4 1.6H72V18.4H4Q1 18.4 1 10T4 1.6Z" fill="url(#pg${id}b)"/>
    <path d="M4 1.6H8.5V18.4H4Q1 18.4 1 10T4 1.6Z" fill="url(#pg${id}c)"/>
    <rect x="20" y="1.6" width="38" height="16.8" fill="url(#pg${id}c)" opacity=".93"/>
    <rect x="23" y="8.7" width="29" height="2.6" rx="1.3" fill="#fff" opacity=".85"/>
    <path d="M70 .8H121Q127 .8 127 10T121 19.2H70Z" fill="url(#pg${id}c)"/>
    <rect x="70" y=".8" width="3.6" height="18.4" fill="${dark}" opacity=".4"/>
    <path d="M80 7.3H118.5Q121.6 7.3 121.6 10T118.5 12.7H80Z" fill="url(#pg${id}c)" stroke="${dark}" stroke-width=".45"/>
    <rect x="82" y="8.1" width="34" height="1" rx=".5" fill="#fff" opacity=".6"/></svg>`;
  function rulerArt() {
    let ticks = '';
    let nums = '';
    for (let mm = 0; mm <= 150; mm++) {
      const x = r2(9 + mm * 1.54);
      const h = mm % 10 === 0 ? 8 : mm % 5 === 0 ? 5.5 : 3.4;
      ticks += `M${x} 1.6V${r2(1.6 + h)}`;
      if (mm % 10 === 0) nums += `<text x="${x}" y="16.2" text-anchor="middle">${mm / 10}</text>`;
    }
    return `<svg viewBox="0 0 250 36"><defs>` +
      grad('pgR', [[0, '#ffffff', 0.8], [0.12, '#f1f7ff', 0.5], [0.85, '#e4eef9', 0.42], [1, '#c4d7ec', 0.75]]) + `</defs>
      <rect x=".5" y=".5" width="249" height="35" rx="3" fill="url(#pgR)" stroke="#8fa8c2" stroke-opacity=".75"/>
      <rect x="2" y="33" width="246" height="1.2" rx=".6" fill="#fff" opacity=".85"/>
      <path d="${ticks}" stroke="#26343f" stroke-width=".42" opacity=".85"/>
      <g font-size="5.6" font-family="Helvetica, Arial, sans-serif" fill="#26343f" opacity=".85">${nums}</g>
      <text x="236" y="29" font-size="4.2" font-family="Helvetica, Arial, sans-serif" fill="#26343f" opacity=".55" text-anchor="end">cm</text></svg>`;
  }
  const ART = {
    stylus: `<svg viewBox="0 0 176 12"><defs>` +
      grad('pgSt', [[0, '#c9c9c6'], [0.2, '#f8f8f7'], [0.5, '#ffffff'], [0.8, '#eaeae8'], [1, '#b3b3af']]) +
      grad('pgStT', [[0, '#efefed'], [0.7, '#d0d0cc'], [1, '#a3a39e']], 1, 0) + `</defs>
      <path d="M5 .5H150L171.5 5.2Q174.8 6 171.5 6.8L150 11.5H5Q.5 11.5 .5 6T5 .5Z" fill="url(#pgSt)"/>
      <path d="M150 .5L171.5 5.2Q174.8 6 171.5 6.8L150 11.5Z" fill="url(#pgStT)"/>
      <path d="M167.4 4.3L171.5 5.2Q174.8 6 171.5 6.8L167.4 7.7Z" fill="#96968f"/>
      <rect x="6" y="1.5" width="143" height="1.3" rx=".65" fill="#fff"/>
      <rect x="149.6" y=".5" width=".7" height="11" fill="#c2c2be"/>
      <rect x="12" y="8.6" width="128" height=".5" fill="#d9d9d5"/></svg>`,
    pencil: `<svg viewBox="0 0 168 12"><defs>` +
      grad('pgPb', [[0, '#b97803'], [0.08, '#dc960f'], [0.33, '#e9a71f'], [0.33, '#ffd04b'], [0.5, '#ffe286'], [0.66, '#f7c235'], [0.66, '#d38c0b'], [1, '#a46602']]) +
      grad('pgPf', [[0, '#86888b'], [0.35, '#f3f4f5'], [0.6, '#c6c8cb'], [1, '#727477']]) +
      grad('pgPe', [[0, '#d26c77'], [0.4, '#f7a7ae'], [1, '#bb5864']]) +
      grad('pgPw', [[0, '#dcb47c'], [1, '#f4dcb6']], 1, 0) +
      grad('pgPg', [[0, '#5d5d60'], [1, '#262628']], 1, 0) + `</defs>
      <path d="M3.2 .7H9.4V11.3H3.2Q.6 11.3 .6 6T3.2 .7Z" fill="url(#pgPe)"/>
      <rect x="9" y=".35" width="12.4" height="11.3" fill="url(#pgPf)"/>
      <path d="M11.2 .35V11.65M13.8 .35V11.65M18.6 .35V11.65" stroke="#6b6d70" stroke-width=".5" opacity=".75"/>
      <rect x="21.2" y=".6" width="112" height="10.8" fill="url(#pgPb)"/>
      <text x="44" y="7.4" font-size="3.8" font-family="Helvetica, Arial, sans-serif" font-weight="700" fill="#5a3a00" opacity=".45" letter-spacing=".4">HB</text>
      <path d="M133 .6Q135 2.2 133.6 3.4Q135.4 4.8 133.8 6Q135.4 7.2 133.6 8.6Q135 9.8 133 11.4L155 7.1V4.9Z" fill="url(#pgPw)"/>
      <path d="M136.4 3.3L152 5.3M136.8 8.7L152 6.7M138.4 6H153" stroke="#c19358" stroke-width=".35" opacity=".85"/>
      <path d="M151 4.45L166.6 5.72Q167.7 6 166.6 6.28L151 7.55Z" fill="url(#pgPg)"/></svg>`,
    pen: `<svg viewBox="0 0 150 12"><defs>` +
      grad('pgNb', [[0, '#09122b'], [0.24, '#28499a'], [0.42, '#5f82cf'], [0.6, '#1c3879'], [1, '#070e24']]) +
      grad('pgNm', [[0, '#787c82'], [0.4, '#f5f6f7'], [0.65, '#b5b8bd'], [1, '#5b5f64']]) +
      grad('pgNg', [[0, '#0f0f10'], [0.45, '#3c3e43'], [1, '#0b0b0c']]) + `</defs>
      <path d="M4 1H104V11H4Q.8 11 .8 6T4 1Z" fill="url(#pgNb)"/>
      <rect x="103.6" y="1.35" width="22.4" height="9.3" rx="1" fill="url(#pgNg)"/>
      <path d="M107 1.35V10.65M110 1.35V10.65M113 1.35V10.65M116 1.35V10.65M119 1.35V10.65M122 1.35V10.65" stroke="#55585e" stroke-width=".6"/>
      <path d="M126 1.6L143 4.9V7.1L126 10.4Z" fill="url(#pgNm)"/>
      <circle cx="144.4" cy="6" r="1.35" fill="#2c3954"/>
      <rect x="59.5" y="1" width="1.6" height="10" fill="url(#pgNm)"/>
      <path d="M6 3.6H54Q57.6 3.6 57.6 6T54 8.4H6Z" fill="url(#pgNm)"/>
      <rect x="8" y="4.45" width="44" height=".9" rx=".45" fill="#fff" opacity=".85"/></svg>`,
    mRed: marker('Mr', '#d8322b', '#ff7d70', '#8c1510'),
    mBlue: marker('Mb', '#2358c8', '#729dff', '#0f2f6e'),
    mGreen: marker('Mg', '#1f9a51', '#71dc99', '#0c592b'),
    hl: `<svg viewBox="0 0 122 26"><defs>` +
      grad('pgHb', [[0, '#d2b900'], [0.2, '#ffe94e'], [0.5, '#fff6a0'], [0.8, '#ffe23b'], [1, '#c1a700']]) +
      grad('pgHc', [[0, '#b89e00'], [0.35, '#f4d300'], [0.55, '#ffea60'], [1, '#a68e00']]) + `</defs>
      <path d="M6 2.2H76V23.8H6Q1.5 23.8 1.5 13T6 2.2Z" fill="url(#pgHb)"/>
      <rect x="12" y="9" width="44" height="8" rx="2" fill="#333" opacity=".82"/>
      <rect x="15" y="12" width="30" height="2" rx="1" fill="#ffe94e" opacity=".9"/>
      <path d="M74 1H114Q120.6 1 120.6 13T114 25H74Z" fill="url(#pgHc)"/>
      <rect x="74" y="1" width="4" height="24" fill="#857300" opacity=".35"/>
      <path d="M86 10H116Q118.2 10 118.2 13T116 16H86Z" fill="#fff7ae" opacity=".55"/></svg>`,
    eraser: `<svg viewBox="0 0 58 26"><defs>` +
      grad('pgEb', [[0, '#e6e1da'], [0.3, '#ffffff'], [1, '#d2cbc2']]) +
      grad('pgEs', [[0, '#1b4cab'], [0.35, '#3a77e6'], [1, '#163c8a']]) + `</defs>
      <path d="M5.4 1.6H40V24.4H5.4Q1.3 24.4 1.5 20L1.7 6Q1.7 1.6 5.4 1.6Z" fill="url(#pgEb)"/>
      <rect x="20" y="1" width="37" height="24" rx="1.6" fill="url(#pgEs)"/>
      <rect x="24.6" y="1" width="2.4" height="24" fill="#fff" opacity=".85"/>
      <rect x="29.2" y="1" width=".8" height="24" fill="#fff" opacity=".6"/></svg>`,
    ruler: rulerArt(),
  };

  let desk = null;
  let lay = null;   // { id: [cx, cy, поворот, z] } — центр в долях экрана
  let zTop = 1;
  const orient = () => (innerWidth > innerHeight ? 'l' : 'p');
  const scale = () => Math.max(0.7, Math.min(1.35, (Math.min(innerWidth, innerHeight) / 390) * 0.86));
  // Как «высыпались» предметы: телефон — внизу листа, планшет и компьютер — по сторонам листа
  function defaults() {
    const vw = innerWidth;
    const vh = innerHeight;
    const s = scale();
    const sr = body.getBoundingClientRect();
    const side = Math.min(sr.left, vw - sr.right);
    const L = {};
    const put = (id, x, y, r) => { L[id] = [x / vw, y / vh, r, 0]; };
    if (side > 120 * s) {
      const xl = sr.left - side / 2;
      const xr = sr.right + side / 2;
      const m = vh / 2;
      put('ruler', xl - 22 * s, m - 10 * s, 87);
      put('hl', xl + 26 * s, m - 90 * s, 96);
      put('eraser', xl + 30 * s, m + 110 * s, 68);
      put('stylus', xr - 44 * s, m - 40 * s, -84);
      put('pencil', xr - 14 * s, m + 10 * s, -96);
      put('pen', xr + 16 * s, m - 70 * s, -78);
      put('mRed', xr + 44 * s, m + 70 * s, 92);
      put('mBlue', xr - 34 * s, m + 160 * s, 104);
      put('mGreen', xr + 30 * s, m - 170 * s, 82);
    } else {
      // Кучкой внизу; на широком экране — справа внизу, а не по всей ширине
      const B = vh - 92 * s;
      const cw = Math.min(vw, 430 * s);
      const X = (k) => vw - cw + k * cw;
      put('ruler', X(0.47), B - 150 * s, -3);
      put('mGreen', X(0.9), B - 112 * s, 72);
      put('mBlue', X(0.1), B - 96 * s, 101);
      put('hl', X(0.7), B - 98 * s, 7);
      put('pencil', X(0.37), B - 86 * s, 4);
      put('stylus', X(0.52), B - 58 * s, -7);
      put('pen', X(0.36), B - 28 * s, -2);
      put('mRed', X(0.79), B - 30 * s, -19);
      put('eraser', X(0.14), B - 14 * s, 14);
    }
    return L;
  }
  function layout() {
    if (lay && lay._o === orient()) return lay;
    let all = null;
    try { all = JSON.parse(lsGet('mps.desk', 'null')); } catch { all = null; }
    const saved = all && all[orient()];
    const d = defaults();
    lay = { _o: orient() };
    for (const id of DESK) {
      const v = saved && Array.isArray(saved[id]) && saved[id].length >= 3 && saved[id].every((n) => typeof n === 'number' && isFinite(n)) ? saved[id] : d[id];
      lay[id] = [v[0], v[1], v[2], v[3] || 0];
      zTop = Math.max(zTop, lay[id][3] + 1);
    }
    return lay;
  }
  function saveLayout() {
    let all = null;
    try { all = JSON.parse(lsGet('mps.desk', 'null')); } catch { all = null; }
    all = all && typeof all === 'object' ? all : {};
    const L = layout();
    all[orient()] = Object.fromEntries(DESK.map((id) => [id, L[id].map((n) => Math.round(n * 1000) / 1000)]));
    lsSet('mps.desk', JSON.stringify(all));
  }
  function deskBuild() {
    desk = $('penDesk');
    if (desk.childElementCount) return;
    DESK.forEach((id, i) => {
      const d = document.createElement('div');
      d.className = 'pi';
      d.dataset.id = id;
      d.style.setProperty('--dl', `${i * 0.035}s`);
      const r = document.createElement('div');
      r.className = 'pr';
      r.setAttribute('role', 'button');
      r.tabIndex = 0;
      r.setAttribute('aria-label', TOOLS[id].name);
      r.title = TOOLS[id].name;
      r.innerHTML = ART[id]; // свои картинки (постоянные строки выше), не данные
      d.append(r);
      desk.append(d);
      dragWire(d, r);
    });
  }
  function placeOne(d) {
    const id = d.dataset.id;
    const s = scale();
    const [w, h] = SIZE[id];
    const [cx, cy, rot, z] = layout()[id];
    d.style.width = w * s + 'px';
    d.style.height = h * s + 'px';
    d.style.setProperty('--x', `${Math.round(cx * innerWidth - (w * s) / 2)}px`);
    d.style.setProperty('--y', `${Math.round(cy * innerHeight - (h * s) / 2)}px`);
    d.style.setProperty('--r', `${rot}deg`);
    d.style.zIndex = String(z || 0);
  }
  function placeAll() { if (desk) for (const d of desk.children) placeOne(d); }
  function paintDesk() {
    if (!desk) return;
    for (const d of desk.children) d.classList.toggle('on', d.dataset.id === tool || (d.dataset.id === 'ruler' && ruler));
  }
  // Нажал — взял (ещё раз — положил), потащил — переложил. Держишь и коснулся вторым пальцем (где угодно) —
  // предмет поворачивается за пальцами вокруг своей оси и едет за их серединой. Мышью: колесо над предметом — поворот
  let hold = null;   // { id, d, a: палец, b: второй палец | null, x, y, cx, cy, ang, rot, moved }
  const deg = (r) => (r * 180) / Math.PI;
  const norm = (g) => ((((g + 180) % 360) + 360) % 360) - 180;
  function holdBase() {
    const L = layout()[hold.id];
    const A = hold.a;
    const B = hold.b;
    hold.cx = L[0];
    hold.cy = L[1];
    hold.rot = L[2];
    hold.x = B ? (A.x + B.x) / 2 : A.x;
    hold.y = B ? (A.y + B.y) / 2 : A.y;
    hold.ang = B ? Math.atan2(B.y - A.y, B.x - A.x) : 0;
  }
  function holdMove() {
    const { id, d, a: A, b: B } = hold;
    const L = layout()[id];
    const mx = B ? (A.x + B.x) / 2 : A.x;
    const my = B ? (A.y + B.y) / 2 : A.y;
    const dx = mx - hold.x;
    const dy = my - hold.y;
    if (!hold.moved && !B && Math.hypot(dx, dy) < 7) return;
    if (!hold.moved) { hold.moved = true; d.classList.add('drag'); }
    L[0] = Math.max(0.02, Math.min(0.98, hold.cx + dx / innerWidth));
    L[1] = Math.max(0.06, Math.min(0.97, hold.cy + dy / innerHeight));
    if (B) {
      let g = norm(hold.rot + deg(Math.atan2(B.y - A.y, B.x - A.x) - hold.ang));
      const sn = Math.round(g / 90) * 90; // ровно по сторонам листа — прилипает
      if (Math.abs(g - sn) < 3) g = sn;
      L[2] = Math.round(norm(g) * 10) / 10;
    }
    placeOne(d);
  }
  const holdOpt = { capture: true, passive: false };
  function holdDown(e) {
    if (!hold || hold.b || e.pointerId === hold.a.id) return;
    e.preventDefault();
    e.stopPropagation();
    hold.b = { id: e.pointerId, x: e.clientX, y: e.clientY };
    holdBase();
    hold.moved = true;
    hold.d.classList.add('drag');
  }
  function holdPtr(e) {
    if (!hold) return;
    const p = hold.a.id === e.pointerId ? hold.a : hold.b && hold.b.id === e.pointerId ? hold.b : null;
    if (!p) return;
    e.stopPropagation();
    p.x = e.clientX;
    p.y = e.clientY;
    holdMove();
  }
  function holdUp(e) {
    if (!hold) return;
    const isA = hold.a.id === e.pointerId;
    const isB = hold.b && hold.b.id === e.pointerId;
    if (!isA && !isB) return;
    e.stopPropagation();
    if (hold.b) {
      // Один палец отпустили — второй дальше просто двигает
      if (isA) hold.a = hold.b;
      hold.b = null;
      holdBase();
      return;
    }
    const h = hold;
    hold = null;
    document.documentElement.classList.remove('holding');
    window.removeEventListener('pointerdown', holdDown, holdOpt);
    window.removeEventListener('pointermove', holdPtr, holdOpt);
    window.removeEventListener('pointerup', holdUp, holdOpt);
    window.removeEventListener('pointercancel', holdUp, holdOpt);
    h.d.classList.remove('drag');
    if (h.moved) saveLayout();
    else if (e.type === 'pointerup') pick(h.id);
  }
  let wheelT = 0;
  function dragWire(d, r) {
    r.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || hold) return;
      e.preventDefault();
      e.stopPropagation();
      try { r.setPointerCapture(e.pointerId); } catch { /* уже */ }
      const id = d.dataset.id;
      const L = layout();
      L[id][3] = zTop++;
      d.style.zIndex = String(L[id][3]);
      hold = { id, d, a: { id: e.pointerId, x: e.clientX, y: e.clientY }, b: null, moved: false };
      holdBase();
      document.documentElement.classList.add('holding');
      window.addEventListener('pointerdown', holdDown, holdOpt);
      window.addEventListener('pointermove', holdPtr, holdOpt);
      window.addEventListener('pointerup', holdUp, holdOpt);
      window.addEventListener('pointercancel', holdUp, holdOpt);
    });
    r.addEventListener('wheel', (e) => {
      e.preventDefault();
      const L = layout()[d.dataset.id];
      L[2] = Math.round(norm(L[2] + (e.deltaY > 0 ? 6 : -6)) * 10) / 10;
      placeOne(d);
      clearTimeout(wheelT);
      wheelT = setTimeout(saveLayout, 300);
    }, { passive: false });
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(d.dataset.id); } });
  }
  function pick(id) {
    if (id === 'ruler') {
      ruler = !ruler;
      if (ruler && !DRAW(tool)) tool = 'pen';
      toast(ruler ? `Линейка: ровные линии (${TOOLS[tool].name.toLowerCase()})` : 'Линейку отложили');
    } else {
      tool = tool === id ? '' : id;
      if (!DRAW(tool)) ruler = false;
      toast(tool ? TOOLS[tool].name : 'Предмет отложили — пальцем листать');
    }
    lsSet('mps.tool', tool);
    $('penPop').hidden = true;
    paintDesk();
    paintBar();
    setInput();
  }

  /* ----- Панель пенала ----- */

  function paintBar() {
    $('penBtn').classList.toggle('on', isOpen);
    $('penBtn').setAttribute('aria-pressed', String(isOpen));
    if (!isOpen) return;
    $('penUndo').disabled = !undo.length;
    $('penRedo').disabled = !redo.length;
    const has = DRAW(tool);
    $('penOpt').hidden = !has;
    if (has) {
      const c = colorOf(tool);
      const dot = $('penDot');
      dot.className = 'dotc' + (HEX.test(c) ? '' : ' c-' + c) + (TOOLS[tool].k === 'hl' ? ' hl' : '');
      dot.style.color = HEX.test(c) ? c : '';
    }
    $('penOnly').setAttribute('aria-pressed', String(penOnly));
    if (!$('penPop').hidden) paintPop();
  }
  function paintPop() {
    const id = tool;
    const t = TOOLS[id];
    if (!t || !DRAW(id)) { $('penPop').hidden = true; return; }
    $('ppColors').hidden = !t.colors;
    $('ppColors').replaceChildren(...(t.colors || []).map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pp-c c-${c}` + (t.k === 'hl' ? ' hl' : '');
      b.setAttribute('aria-pressed', String(c === colorOf(id)));
      b.setAttribute('aria-label', 'Цвет');
      b.onclick = () => { setPref(id, 'c', c); paintBar(); };
      return b;
    }));
    if (t.colors) {
      // Другой цвет — окно «Цвета»
      const c = colorOf(id);
      const any = document.createElement('button');
      any.type = 'button';
      any.className = 'pp-any';
      any.setAttribute('aria-label', 'Другой цвет');
      any.title = 'Другой цвет';
      any.setAttribute('aria-pressed', String(HEX.test(c)));
      if (HEX.test(c)) any.style.setProperty('--cur', rgba(c, opOf(id)));
      any.onclick = () => cpOpen(id);
      $('ppColors').append(any);
    }
    $('ppSizes').replaceChildren(...SIZES.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pp-s';
      b.setAttribute('aria-pressed', String(i === sizeOf(id)));
      b.setAttribute('aria-label', ['Тонко', 'Средне', 'Толсто'][i]);
      const dot = document.createElement('i');
      const c = colorOf(id);
      if (HEX.test(c)) dot.style.color = c; else dot.className = 'c-' + c;
      dot.style.width = dot.style.height = `${[5, 9, 15][i]}px`;
      b.append(dot);
      b.onclick = () => { setPref(id, 's', i); paintBar(); };
      return b;
    }));
  }

  /* ----- Окно «Цвета» (как в iPadOS): сетка, спектр, ползунки, непрозрачность, свои цвета, пипетка ----- */

  const toHex = (r, g, b) => '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
  const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, o) => { const [r, g, b] = rgbOf(h); return `rgba(${r}, ${g}, ${b}, ${o})`; };
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f1 = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return toHex(f1(0) * 255, f1(8) * 255, f1(4) * 255);
  }
  // Имя цвета (c-имя) → #rrggbb на нынешнем фоне
  function cssHex(c) {
    if (HEX.test(c)) return c.toLowerCase();
    const i = document.createElement('i');
    i.className = 'c-' + c;
    i.hidden = true;
    document.body.append(i);
    const m = getComputedStyle(i).color.match(/[\d.]+/g) || [0, 0, 0];
    i.remove();
    return toHex(+m[0], +m[1], +m[2]);
  }
  // Сетка: сверху серые (белый → чёрный), ниже 9 рядов по 12 оттенков — от тёмных к светлым
  const GRID = (() => {
    const out = [];
    for (let i = 0; i < 12; i++) { const v = 255 * (1 - i / 11); out.push(toHex(v, v, v)); }
    const H = [196, 214, 250, 276, 318, 2, 15, 30, 42, 52, 62, 95];
    for (const l of [15, 22, 30, 39, 49, 60, 71, 81, 91]) for (const h of H) out.push(hsl(h, 100, l));
    return out;
  })();
  const SW0 = [{ c: '#000000', o: 1 }, { c: '#0a64ff', o: 1 }, { c: '#2fbe5a', o: 1 }, { c: '#ffd60a', o: 1 }, { c: '#ff3b30', o: 1 }];
  function swGet() {
    try {
      const a = JSON.parse(lsGet('mps.swatches', 'null'));
      if (Array.isArray(a)) return a.filter((x) => x && HEX.test(x.c)).map((x) => ({ c: x.c.toLowerCase(), o: x.o >= 0.05 && x.o <= 1 ? x.o : 1 })).slice(0, 18);
    } catch { /* нет */ }
    return SW0.slice();
  }
  const swSet = (a) => lsSet('mps.swatches', JSON.stringify(a));
  let cp = null;        // { id, hex, o, ring: [x, y] в долях спектра | null }
  let eyedrop = false;
  let cpTab = ['grid', 'spec', 'sl'].includes(lsGet('mps.cpTab', '')) ? lsGet('mps.cpTab', '') : 'grid';
  let specCtx = null;
  function cpOpen(id) {
    if (!TOOLS[id] || !TOOLS[id].colors) return;
    cp = { id, hex: cssHex(colorOf(id)), o: opOf(id), ring: null };
    $('penPop').hidden = true;
    cpBuild();
    cpPaint();
    if (!$('cpDlg').open) $('cpDlg').showModal();
  }
  // Выбрали цвет — сразу в инструмент (что в руке)
  function cpSet(hex, o, from) {
    cp.hex = hex.toLowerCase();
    if (o != null) cp.o = Math.max(0.05, Math.min(1, o));
    if (from !== 'spec') cp.ring = null;
    setPref(cp.id, 'c', cp.hex);
    setPref(cp.id, 'o', Math.round(cp.o * 100) / 100);
    cpPaint(from);
    paintBar();
  }
  const follow = (el, at) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* уже */ } at(e); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) at(e); });
  };
  function cpBuild() {
    const g = $('cpGrid');
    if (!g.childElementCount) {
      for (const c of GRID) { const i = document.createElement('i'); i.style.background = c; i.dataset.c = c; g.append(i); }
      follow(g, (e) => {
        const r = g.getBoundingClientRect();
        const col = Math.max(0, Math.min(11, Math.floor(((e.clientX - r.left) / r.width) * 12)));
        const row = Math.max(0, Math.min(9, Math.floor(((e.clientY - r.top) / r.height) * 10)));
        const c = GRID[row * 12 + col];
        if (c !== cp.hex) cpSet(c, null, 'grid');
      });
    }
    if (!specCtx) {
      // Спектр: оттенок слева направо, сверху светлее, снизу темнее
      const cv = $('cpCan');
      const x = cv.getContext('2d', { willReadFrequently: true });
      const W = cv.width;
      const H = cv.height;
      const hg = x.createLinearGradient(0, 0, W, 0);
      for (let i = 0; i <= 12; i++) hg.addColorStop(i / 12, hsl((i * 30) % 360, 100, 50));
      x.fillStyle = hg;
      x.fillRect(0, 0, W, H);
      const vg = x.createLinearGradient(0, 0, 0, H);
      vg.addColorStop(0, 'rgba(255,255,255,1)');
      vg.addColorStop(0.08, 'rgba(255,255,255,.85)');
      vg.addColorStop(0.5, 'rgba(255,255,255,0)');
      vg.addColorStop(0.5, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,.92)');
      x.fillStyle = vg;
      x.fillRect(0, 0, W, H);
      specCtx = x;
      follow($('cpSpec'), (e) => {
        const r = cv.getBoundingClientRect();
        const fx = Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width));
        const fy = Math.max(0, Math.min(0.999, (e.clientY - r.top) / r.height));
        const d = x.getImageData(Math.floor(fx * W), Math.floor(fy * H), 1, 1).data;
        cp.ring = [fx, fy];
        cpSet(toHex(d[0], d[1], d[2]), null, 'spec');
      });
    }
  }
  function cpPaint(from) {
    for (const b of $('cpTabs').children) b.setAttribute('aria-pressed', String(b.dataset.t === cpTab));
    $('cpGrid').hidden = cpTab !== 'grid';
    $('cpSpec').hidden = cpTab !== 'spec';
    $('cpSl').hidden = cpTab !== 'sl';
    for (const i of $('cpGrid').children) i.classList.toggle('on', i.dataset.c === cp.hex);
    const ring = $('cpRing');
    ring.hidden = !cp.ring;
    if (cp.ring) { ring.style.left = cp.ring[0] * 100 + '%'; ring.style.top = cp.ring[1] * 100 + '%'; ring.style.background = cp.hex; }
    const [r, g, b] = rgbOf(cp.hex);
    const tr = { R: [`rgb(0,${g},${b})`, `rgb(255,${g},${b})`], G: [`rgb(${r},0,${b})`, `rgb(${r},255,${b})`], B: [`rgb(${r},${g},0)`, `rgb(${r},${g},255)`] };
    for (const [k, v] of [['R', r], ['G', g], ['B', b]]) {
      const el = $('cp' + k);
      if (from !== 'sl') el.value = String(v);
      el.style.setProperty('--trk', `linear-gradient(to right, ${tr[k][0]}, ${tr[k][1]})`);
      if (from !== 'num') $('cp' + k + 'n').value = String(v);
    }
    if (from !== 'hex') $('cpHex').value = cp.hex.slice(1).toUpperCase();
    if (from !== 'op') $('cpOp').value = String(Math.round(cp.o * 100));
    $('cpOp').style.setProperty('--trk', `linear-gradient(to right, ${rgba(cp.hex, 0)}, ${cp.hex})`);
    $('cpOpN').textContent = Math.round(cp.o * 100) + '%';
    $('cpCur').style.setProperty('--cur', rgba(cp.hex, cp.o));
    const box = $('cpSw');
    box.replaceChildren(...swGet().map((s, n) => {
      const b2 = document.createElement('button');
      b2.type = 'button';
      b2.style.setProperty('--c', rgba(s.c, s.o));
      b2.classList.toggle('on', s.c === cp.hex && Math.abs(s.o - cp.o) < 0.01);
      b2.setAttribute('aria-label', 'Свой цвет ' + s.c + ' (держать — убрать)');
      b2.append(document.createElement('i'));
      let lt = 0;
      let long = false;
      b2.onpointerdown = () => {
        long = false;
        lt = setTimeout(() => { long = true; const a = swGet(); a.splice(n, 1); swSet(a); cpPaint(); toast('Цвет убран из своих'); }, 600);
      };
      b2.onpointerup = b2.onpointerleave = b2.onpointercancel = () => clearTimeout(lt);
      b2.oncontextmenu = (e) => e.preventDefault();
      b2.onclick = () => { if (!long) cpSet(s.c, s.o, 'sw'); };
      return b2;
    }));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'cp-add';
    add.setAttribute('aria-label', 'Добавить цвет в свои');
    add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'; // своя иконка
    add.onclick = () => {
      const a = swGet();
      if (a.some((s) => s.c === cp.hex && Math.abs(s.o - cp.o) < 0.01)) { toast('Этот цвет уже есть'); return; }
      a.push({ c: cp.hex, o: Math.round(cp.o * 100) / 100 });
      swSet(a.slice(-18));
      cpPaint();
    };
    box.append(add);
  }
  function cpWire() {
    const d = $('cpDlg');
    $('cpX').onclick = () => d.close();
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    for (const b of $('cpTabs').children) b.onclick = () => { cpTab = b.dataset.t; lsSet('mps.cpTab', cpTab); cpBuild(); cpPaint(); };
    for (const k of ['R', 'G', 'B']) {
      $('cp' + k).oninput = () => cpSet(toHex(+$('cpR').value, +$('cpG').value, +$('cpB').value), null, 'sl');
      $('cp' + k + 'n').oninput = () => {
        const v = [$('cpRn'), $('cpGn'), $('cpBn')].map((x) => Math.max(0, Math.min(255, Number(x.value) || 0)));
        cpSet(toHex(...v), null, 'num');
      };
    }
    $('cpHex').oninput = () => { const v = $('cpHex').value.replace(/[^0-9a-f]/gi, ''); if (v.length === 6) cpSet('#' + v, null, 'hex'); };
    $('cpHex').onblur = () => cpPaint();
    $('cpOp').oninput = () => cpSet(cp.hex, Number($('cpOp').value) / 100, 'op');
    // Пипетка: окно прячется, нажатие на пометку — её цвет
    $('cpDrop').onclick = () => {
      d.close();
      eyedrop = true;
      document.body.classList.add('eyedrop');
      toast('Пипетка: нажмите на пометку — возьму её цвет');
    };
  }
  function takeColor(x, y) {
    document.body.classList.remove('eyedrop');
    const id = cp ? cp.id : tool;
    let st = null;
    for (let i = rec.strokes.length - 1; i >= 0 && !st; i--) if (hits(rec.strokes[i], x, y, 6)) st = rec.strokes[i];
    if (!st) toast('Тут нет пометки — пипетка берёт цвет пометки');
    else if (TOOLS[id] && TOOLS[id].colors) {
      if (TOOLS[id].colors.includes(st.c)) { setPref(id, 'c', st.c); setPref(id, 'o', 1); }
      else { setPref(id, 'c', cssHex(st.c)); setPref(id, 'o', st.o || 1); }
      paintBar();
    }
    cpOpen(id);
  }

  function setPenOnly(v, auto) {
    penOnly = v;
    lsSet('mps.penOnly', v ? '1' : '0');
    toast(v ? (auto ? 'Стилус найден: стилусом — писать, пальцем — листать' : 'Только стилус: пальцем — листать') : 'Пальцем — писать, двумя пальцами — листать');
    paintBar();
  }

  /* ----- Открыть / закрыть пенал ----- */

  let awayT = 0;
  function open() {
    if (!view || !view.song || !rec) return;
    clearTimeout(awayT);
    isOpen = true;
    openKey = key(view);
    document.body.classList.add('pen-open');
    deskBuild();
    lay = null;
    desk.classList.remove('away');
    desk.classList.add('drop');
    Snd.drop(DESK);
    desk.hidden = false;
    // Лист стал светлым и шире (поля) — разложить по новому листу
    requestAnimationFrame(() => {
      placeAll();
      requestAnimationFrame(() => desk.classList.remove('drop'));
    });
    $('penBar').hidden = false;
    paintDesk();
    paintBar();
    setInput();
    onChange();
    if (lsGet('mps.penHint', '') !== '1') {
      lsSet('mps.penHint', '1');
      setTimeout(() => toast('Нажмите на предмет — взять, ещё раз — положить. Потащите — переложить, коснитесь вторым пальцем — повернуть. Двумя пальцами по листу — листать.'), 700);
    }
  }
  function close() {
    if (!isOpen) return;
    if (drawing) finishStroke();
    if (erasing) endErase();
    eyedrop = false;
    document.body.classList.remove('eyedrop');
    if ($('cpDlg').open) $('cpDlg').close();
    flush();
    isOpen = false;
    openKey = '';
    document.body.classList.remove('pen-open');
    $('penBar').hidden = true;
    $('penPop').hidden = true;
    if (desk) {
      desk.classList.add('away');
      awayT = setTimeout(() => { desk.hidden = true; desk.classList.remove('away'); }, 260);
    }
    setInput();
    paintBar();
    onChange();
  }

  function init() {
    $('penBtn').onclick = () => (isOpen ? close() : open());
    $('penDone').onclick = close;
    $('penUndo').onclick = () => step(true);
    $('penRedo').onclick = () => step(false);
    $('penOnly').onclick = () => setPenOnly(!penOnly);
    $('penNote').onclick = editNote;
    $('penOpt').onclick = () => { const p = $('penPop'); p.hidden = !p.hidden; if (!p.hidden) paintPop(); };
    $('ppClear').onclick = () => { $('penPop').hidden = true; clearAll(); };
    cpWire();
    $('noteDlg').addEventListener('click', (e) => { if (e.target === $('noteDlg')) $('noteDlg').close(); });
    document.addEventListener('keydown', (e) => {
      if (!isOpen || e.target.closest('input, textarea, dialog')) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); step(!e.shiftKey); }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); step(false); }
    });
    // Песня поменяла размер (шрифт A−/A+, поворот, аккорды, заметка) — пометки на свои слова
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (rec) sched(); }).observe($('songBody'));
    window.addEventListener('resize', () => { if (isOpen) { lay = null; placeAll(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
  }

  return {
    init, show, open, close, editNote, relayout: sched,
    get isOpen() { return isOpen; },
    get sound() { return Snd.on; },
    set sound(v) { Snd.on = v; },
    set onChange(fn) { onChange = fn; },
  };
})();
