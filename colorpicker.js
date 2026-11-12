/* Окно «Цвета» — одно на всю программу (как в iPadOS): сетка, спектр, ползунки, прозрачность 0–100 %,
   свои цвета, пипетка. Прозрачность показывается, только если её передали (op !== null).
   Окно не модальное: без затемнения, работа под ним доступна; встаёт у кнопки цвета (как старое системное),
   двигается за заголовок, закрывается крестиком, Esc или щелчком мимо. На время пипетки прячется.
   ColorPicker.open({ hex, op, onInput(hex, op), onClose, at })  — окно (at — элемент, у которого встать);
   ColorPicker.field(hex, op, onInput)                        — кнопка-образец, по щелчку открывает окно (.set(hex, op) — обновить). */
const ColorPicker = (() => {
  const HEX = /^#[0-9a-f]{6}$/i;
  const toHex = (r, g, b) => '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
  const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, o) => { const [r, g, b] = rgbOf(h); return `rgba(${r}, ${g}, ${b}, ${o})`; };
  const norm = (v) => {
    let s = String(v || '').trim().replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = [...s].map((x) => x + x).join('');
    return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
  };
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  // Сетка: сверху серые (белый → чёрный), ниже 9 рядов по 12 оттенков — от тёмных к светлым
  const GRID = (() => {
    const out = [];
    for (let i = 0; i < 12; i++) { const v = 255 * (1 - i / 11); out.push(toHex(v, v, v)); }
    const H = [196, 214, 250, 276, 318, 2, 15, 30, 42, 52, 62, 95];
    for (const l of [15, 22, 30, 39, 49, 60, 71, 81, 91]) for (const h of H) out.push(hsl(h, 100, l));
    return out;
  })();
  const SW0 = [{ c: '#000000', o: 1 }, { c: '#ffffff', o: 1 }, { c: '#0a64ff', o: 1 }, { c: '#2fbe5a', o: 1 }, { c: '#ffd60a', o: 1 }, { c: '#ff3b30', o: 1 }, { c: '#000000', o: 0.5 }];
  function swGet() {
    try {
      const a = JSON.parse(localStorage.getItem('cp.swatches') || 'null');
      if (Array.isArray(a)) return a.filter((x) => x && HEX.test(x.c)).map((x) => ({ c: x.c.toLowerCase(), o: x.o >= 0 && x.o <= 1 ? x.o : 1 })).slice(0, 24);
    } catch { /* нет */ }
    return SW0.slice();
  }
  const swSet = (a) => { try { localStorage.setItem('cp.swatches', JSON.stringify(a.slice(-24))); } catch { /* нет */ } };

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  let dlg = null;
  let anchor = null; // кнопка, у которой открыли окно
  let picking = false; // идёт пипетка
  let st = null; // { hex, op (число или null), on, close, ring }
  let tab = 'grid';
  try { const t = localStorage.getItem('cp.tab'); if (['grid', 'spec', 'sl'].includes(t)) tab = t; } catch { /* нет */ }
  const q = (id) => dlg.querySelector('#' + id);

  function follow(node, at) {
    node.addEventListener('pointerdown', (e) => { e.preventDefault(); try { node.setPointerCapture(e.pointerId); } catch { /* уже */ } at(e); });
    node.addEventListener('pointermove', (e) => { if (node.hasPointerCapture && node.hasPointerCapture(e.pointerId)) at(e); });
  }

  function build() {
    // Окно — «всплывающий слой» (popover): всегда поверх всего, в том числе поверх Настроек,
    // и считает координаты от окна программы, а не от окна, внутри которого лежит
    dlg = el('div', 'cpk');
    dlg.setAttribute('popover', 'manual');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Цвета');
    dlg.innerHTML = `
      <div class="cpk-head">
        <button class="cpk-ic" id="cpkDrop" title="Пипетка: взять цвет с экрана"></button>
        <h2>Цвета</h2>
        <button class="cpk-ic cpk-x" id="cpkX" title="Закрыть">×</button>
      </div>
      <div class="cpk-seg" id="cpkTabs"><button data-t="grid">Сетка</button><button data-t="spec">Спектр</button><button data-t="sl">Ползунки</button></div>
      <div class="cpk-pane" id="cpkGrid"></div>
      <div class="cpk-pane cpk-spec" id="cpkSpec" hidden><canvas id="cpkCan" width="360" height="240"></canvas><i class="cpk-ring" id="cpkRing"></i></div>
      <div class="cpk-pane cpk-sl" id="cpkSl" hidden>
        <label>КРАСНЫЙ</label><div class="cpk-slr"><input type="range" id="cpkR" min="0" max="255" data-nodef><input type="number" class="cpk-n" id="cpkRn" min="0" max="255"></div>
        <label>ЗЕЛЁНЫЙ</label><div class="cpk-slr"><input type="range" id="cpkG" min="0" max="255" data-nodef><input type="number" class="cpk-n" id="cpkGn" min="0" max="255"></div>
        <label>СИНИЙ</label><div class="cpk-slr"><input type="range" id="cpkB" min="0" max="255" data-nodef><input type="number" class="cpk-n" id="cpkBn" min="0" max="255"></div>
        <div class="cpk-hex"><span>Цвет в Hex #</span><input id="cpkHex" maxlength="7" autocomplete="off" spellcheck="false"></div>
      </div>
      <div id="cpkOpBox">
        <label class="cpk-lbl">НЕПРОЗРАЧНОСТЬ <small>(0% — совсем прозрачный)</small></label>
        <div class="cpk-slr cpk-pad"><input type="range" class="cpk-op" id="cpkOp" min="0" max="100" data-def="100"><span class="cpk-n cpk-pct"><input type="number" id="cpkOpN" min="0" max="100">%</span></div>
      </div>
      <div class="cpk-foot">
        <div class="cpk-cur" id="cpkCur"><i></i></div>
        <div class="cpk-sw" id="cpkSw"></div>
      </div>`;
    document.body.append(dlg);
    // сетка
    const g = q('cpkGrid');
    for (const c of GRID) { const i = document.createElement('i'); i.style.background = c; i.dataset.c = c; g.append(i); }
    follow(g, (e) => {
      const r = g.getBoundingClientRect();
      const col = Math.max(0, Math.min(11, Math.floor(((e.clientX - r.left) / r.width) * 12)));
      const row = Math.max(0, Math.min(9, Math.floor(((e.clientY - r.top) / r.height) * 10)));
      const c = GRID[row * 12 + col];
      if (c !== st.hex) set(c, null, 'grid');
    });
    // спектр: оттенок слева направо, сверху светлее, снизу темнее
    const cv = q('cpkCan');
    const x = cv.getContext('2d', { willReadFrequently: true });
    const W = cv.width;
    const H = cv.height;
    const hg = x.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 12; i++) hg.addColorStop(i / 12, hsl((i * 30) % 360, 100, 50));
    x.fillStyle = hg; x.fillRect(0, 0, W, H);
    const vg = x.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(255,255,255,1)'); vg.addColorStop(0.08, 'rgba(255,255,255,.85)'); vg.addColorStop(0.5, 'rgba(255,255,255,0)');
    vg.addColorStop(0.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.92)');
    x.fillStyle = vg; x.fillRect(0, 0, W, H);
    follow(q('cpkSpec'), (e) => {
      const r = cv.getBoundingClientRect();
      const fx = Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width));
      const fy = Math.max(0, Math.min(0.999, (e.clientY - r.top) / r.height));
      const d = x.getImageData(Math.floor(fx * W), Math.floor(fy * H), 1, 1).data;
      st.ring = [fx, fy];
      set(toHex(d[0], d[1], d[2]), null, 'spec');
    });
    // остальное
    q('cpkX').onclick = () => hide();
    dlg.addEventListener('toggle', (e) => { if (e.newState === 'closed' && !isOpen()) done(); }); // спрятал сам браузер
    // щелчок мимо окна — закрыть (сам щелчок проходит дальше, как у старого окна)
    document.addEventListener('pointerdown', (e) => {
      if (!isOpen() || picking || dlg.contains(e.target) || (anchor && anchor.contains(e.target))) return;
      hide();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !isOpen() || picking) return;
      e.preventDefault(); e.stopPropagation(); hide();
    }, true);
    // перетаскивание за заголовок
    const head = dlg.querySelector('.cpk-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const r = dlg.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      try { head.setPointerCapture(e.pointerId); } catch { /* уже */ }
      const mv = (m) => place(m.clientX - dx, m.clientY - dy);
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
    for (const b of q('cpkTabs').children) b.onclick = () => { tab = b.dataset.t; try { localStorage.setItem('cp.tab', tab); } catch { /* нет */ } paint(); };
    for (const k of ['R', 'G', 'B']) {
      q('cpk' + k).oninput = () => set(toHex(+q('cpkR').value, +q('cpkG').value, +q('cpkB').value), null, 'sl');
      q('cpk' + k + 'n').oninput = () => set(toHex(...['R', 'G', 'B'].map((z) => Math.max(0, Math.min(255, Number(q('cpk' + z + 'n').value) || 0)))), null, 'num');
    }
    q('cpkHex').oninput = () => { const v = norm(q('cpkHex').value); if (v) set(v, null, 'hex'); };
    q('cpkHex').onblur = () => paint();
    q('cpkOp').oninput = () => set(st.hex, Number(q('cpkOp').value) / 100, 'op');
    q('cpkOpN').oninput = () => { const v = q('cpkOpN').value; if (v !== '') set(st.hex, Math.max(0, Math.min(100, Number(v) || 0)) / 100, 'opn'); };
    const drop = q('cpkDrop');
    drop.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M14.6 4.3a2.6 2.6 0 0 1 3.7 0l1.4 1.4a2.6 2.6 0 0 1 0 3.7l-2 2 .9.9-1.5 1.5-5.9-5.9 1.5-1.5.9.9z" fill="currentColor"/><path d="M10.6 8.6 4.8 14.4a2 2 0 0 0-.5.9l-.8 3.6a1 1 0 0 0 1.2 1.2l3.6-.8a2 2 0 0 0 .9-.5l5.8-5.8" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
    // пипетка: окно на время прячем, чтобы не закрывало рабочее поле
    if (window.EyeDropper) drop.onclick = async () => {
      picking = true;
      dlg.style.visibility = 'hidden';
      try { const r = await new EyeDropper().open(); if (st) set(r.sRGBHex.toLowerCase(), null, 'drop'); } catch { /* отменили */ }
      dlg.style.visibility = '';
      setTimeout(() => { picking = false; }, 0);
    };
    else drop.hidden = true;
  }

  // Выбрали цвет — сразу наружу (как «input» у обычного поля)
  function set(hex, o, from) {
    st.hex = hex.toLowerCase();
    if (o != null && st.op != null) st.op = Math.max(0, Math.min(1, o));
    if (from !== 'spec') st.ring = null;
    paint(from);
    if (st.on) st.on(st.hex, st.op);
  }

  function paint(from) {
    for (const b of q('cpkTabs').children) b.setAttribute('aria-pressed', String(b.dataset.t === tab));
    q('cpkGrid').hidden = tab !== 'grid';
    q('cpkSpec').hidden = tab !== 'spec';
    q('cpkSl').hidden = tab !== 'sl';
    for (const i of q('cpkGrid').children) i.classList.toggle('on', i.dataset.c === st.hex);
    const ring = q('cpkRing');
    ring.hidden = !st.ring;
    if (st.ring) { ring.style.left = st.ring[0] * 100 + '%'; ring.style.top = st.ring[1] * 100 + '%'; ring.style.background = st.hex; }
    const [r, g, b] = rgbOf(st.hex);
    const tr = { R: [`rgb(0,${g},${b})`, `rgb(255,${g},${b})`], G: [`rgb(${r},0,${b})`, `rgb(${r},255,${b})`], B: [`rgb(${r},${g},0)`, `rgb(${r},${g},255)`] };
    for (const [k, v] of [['R', r], ['G', g], ['B', b]]) {
      if (from !== 'sl') q('cpk' + k).value = String(v);
      q('cpk' + k).style.setProperty('--trk', `linear-gradient(to right, ${tr[k][0]}, ${tr[k][1]})`);
      if (from !== 'num') q('cpk' + k + 'n').value = String(v);
    }
    if (from !== 'hex') q('cpkHex').value = st.hex.slice(1).toUpperCase();
    const hasOp = st.op != null;
    q('cpkOpBox').hidden = !hasOp;
    const o = hasOp ? st.op : 1;
    if (hasOp) {
      if (from !== 'op') q('cpkOp').value = String(Math.round(o * 100));
      if (from !== 'opn') q('cpkOpN').value = String(Math.round(o * 100));
      q('cpkOp').style.setProperty('--trk', `linear-gradient(to right, ${rgba(st.hex, 0)}, ${st.hex})`);
    }
    q('cpkCur').style.setProperty('--cur', rgba(st.hex, o));
    const box = q('cpkSw');
    box.replaceChildren(...swGet().map((s, n) => {
      const sw = el('button');
      sw.type = 'button';
      sw.style.setProperty('--c', rgba(s.c, hasOp ? s.o : 1));
      sw.classList.toggle('on', s.c === st.hex && (!hasOp || Math.abs(s.o - o) < 0.01));
      sw.title = s.c + (s.o < 1 ? ` · ${Math.round(s.o * 100)}%` : '') + ' — правый щелчок: убрать';
      sw.append(document.createElement('i'));
      sw.onclick = () => set(s.c, hasOp ? s.o : null, 'sw');
      sw.oncontextmenu = (e) => { e.preventDefault(); const a = swGet(); a.splice(n, 1); swSet(a); paint(); if (window.flashStatus) flashStatus('Цвет убран из своих'); };
      return sw;
    }));
    const add = el('button', 'cpk-add', '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>');
    add.type = 'button';
    add.title = 'Добавить этот цвет в свои';
    add.onclick = () => {
      const a = swGet();
      if (a.some((s) => s.c === st.hex && Math.abs(s.o - o) < 0.01)) { if (window.flashStatus) flashStatus('Этот цвет уже есть'); return; }
      a.push({ c: st.hex, o: Math.round(o * 100) / 100 });
      swSet(a);
      paint();
    };
    box.append(add);
  }

  const isOpen = () => !!dlg && dlg.matches(':popover-open');
  // Окно закрыли — сообщить тому, кто открывал
  function done() { const f = st && st.close; st = null; anchor = null; if (f) f(); }
  function hide() { if (!isOpen()) return; dlg.hidePopover(); done(); }

  // Поставить окно в (x, y), не вылезая за край окна программы
  function place(x, y) {
    const w = dlg.offsetWidth;
    const h = dlg.offsetHeight;
    dlg.style.left = Math.round(Math.max(6, Math.min(innerWidth - w - 6, x))) + 'px';
    dlg.style.top = Math.round(Math.max(6, Math.min(innerHeight - h - 6, y))) + 'px';
  }

  // Встать у кнопки: под ней, не влезает — над ней, иначе сбоку
  function placeAt(el) {
    const w = dlg.offsetWidth;
    const h = dlg.offsetHeight;
    if (!el || !el.isConnected) { place((innerWidth - w) / 2, (innerHeight - h) / 2); return; }
    const r = el.getBoundingClientRect();
    if (r.bottom + 6 + h <= innerHeight) place(r.left, r.bottom + 6);
    else if (r.top - 6 - h >= 0) place(r.left, r.top - 6 - h);
    else if (r.right + 8 + w <= innerWidth) place(r.right + 8, r.top - h / 2);
    else place(r.left - 8 - w, r.top - h / 2);
  }

  function open({ hex, op = null, onInput, onClose, at = null }) {
    if (!dlg) build();
    hide();
    st = { hex: norm(hex) || '#000000', op: op == null ? null : Math.max(0, Math.min(1, Number(op))), on: onInput, close: onClose, ring: null };
    anchor = at;
    // кнопка внутри модального окна — кладём в него (иначе окно «Цвета» не будет нажиматься), а показываем поверх него
    const host = (at && at.closest && at.closest('dialog[open]:not(.cpk)')) || document.body;
    if (dlg.parentNode !== host) host.append(dlg);
    paint();
    dlg.showPopover();
    placeAt(at);
  }

  // Кнопка-образец: цвет с «шахматкой» под прозрачным. alpha — показывать ли прозрачность
  function field(hex, op, onInput, extra = {}) {
    const b = el('button', 'cpk-field');
    b.type = 'button';
    b.append(document.createElement('i'));
    let cur = { hex: norm(hex) || '#000000', op: op == null ? null : Number(op) };
    const show = () => { b.firstChild.style.background = rgba(cur.hex, cur.op == null ? 1 : cur.op); b.title = cur.hex + (cur.op != null && cur.op < 1 ? ` · непрозрачность ${Math.round(cur.op * 100)}%` : ''); };
    show();
    b.set = (h, o) => { cur = { hex: norm(h) || cur.hex, op: o == null ? null : Number(o) }; show(); };
    b.onclick = () => { if (isOpen() && anchor === b) { hide(); return; } open({ ...cur, at: b, onInput: (h, o) => { cur = { hex: h, op: o }; show(); if (onInput) onInput(h, o); }, onClose: extra.onClose }); };
    return b;
  }

  return { open, field, norm };
})();
