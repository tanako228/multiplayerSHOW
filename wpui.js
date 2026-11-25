/* ---------- Удалённое управление (окно оператора): Настройки → «Удалённое управление» ----------
   Устройство — workplace.js (главный процесс). Здесь:
   - имя этого компьютера для других (пусто — имя Windows);
   - пузырьки подключения (Eco ниже): свой пузырёк и компьютеры в сети. Перетащили свой на другой (или другой на
     свой) — они слипаются, появляется окошко: код (если тот компьютер нас ещё не помнит), «Управлять», «Смотреть».
     Подключились — окно перезагружается и работает с данными A; плашка #wpBar вверху — «Отключиться»;
   - этот компьютер (A): «Разрешить управление этим компьютером» — на своём пузырьке код, рядом прилипают зрители;
   - просьба A сохранить всё перед передачей управления (wp:flush → profFlush из profpanel.js). */
(function () {
  const $ = (id) => document.getElementById(id);
  // Подстановка {0} {1}; перевод делает i18n.js сам по тексту на странице (словарь — lang.js)
  const T = (s, ...a) => s.replace(/\{(\d)\}/g, (_m, i) => a[i]);
  let st = null;
  let found = null; // последний «Найти»: [{ id, name, addr, busy, known }]
  const manual = []; // добавлены «По адресу…»: [{ addr }]
  const tm = (t) => new Date(t).toLocaleTimeString().slice(0, 5);
  const day = (t) => new Date(t).toLocaleDateString();

  // Строка списка (как закладки .bm): имя, адрес, пометка; справа — своя кнопка
  function row(name, addr, tag, side) {
    const r = document.createElement('div');
    r.className = 'bm';
    const b = document.createElement('button');
    b.className = 'bm-ref';
    b.tabIndex = -1;
    const n = document.createElement('span'); n.className = 'wp-n'; n.textContent = name;
    const a = document.createElement('span'); a.className = 'wp-a'; a.textContent = addr;
    const t = document.createElement('span'); t.className = 'wp-tag'; t.textContent = tag;
    b.append(n, a, t);
    r.append(b);
    if (side) r.append(side);
    return r;
  }

  // A: кого пускаем без кода
  function renderTrust(h) {
    const box = $('wpTrust');
    if (!box) return;
    const list = h.trusted || [];
    $('wpTrustBox').hidden = !list.length;
    box.replaceChildren(...list.slice().reverse().map((t) => {
      const x = document.createElement('button');
      x.className = 'remove';
      x.textContent = 'Забыть';
      x.title = 'Забыть «' + t.name + '» — в следующий раз ему понадобится код';
      x.addEventListener('click', async () => render(await window.api.wpForget(t.id)));
      return row(t.name, t.ip || '', 'был ' + day(t.last || t.at), x);
    }));
  }

  const sameAddr = (a, b) => !!a && !!b && (a === b || a === b + ':8090' || a + ':8090' === b);
  async function find() {
    const b = $('wpFind');
    if (find.busy) return;
    find.busy = true;
    if (b) { b.disabled = true; b.textContent = 'Ищу…'; }
    try { found = await window.api.wpFind(); } catch { found = found || []; }
    find.busy = false;
    if (b) { b.disabled = false; b.textContent = 'Найти'; }
    Eco.sync();
  }

  const addrs = (h) => (h.port ? (h.ips.length ? h.ips : ['127.0.0.1']).map((ip) => ip + ':' + h.port) : []);
  const fmtCode = (c) => (c ? c.slice(0, 3) + ' ' + c.slice(3) : '—');

  function render(s) {
    st = s || st;
    if (!st) return;
    const h = st.host;
    const c = st.client;
    const on = $('wpHostOn');
    if (on) {
      on.checked = !!h.on;
      on.disabled = c.on || !!c.watching;
      $('wpHostBox').hidden = !h.on;
      const list = addrs(h);
      $('wpAddr').textContent = list.length ? list.join(', ') : 'сервер запускается…';
      $('wpCode').textContent = fmtCode(h.code);
      $('wpHostState').textContent = h.peer ? (h.peer.lostUntil ? 'Связь с «' + h.peer.name + '» прервалась — жду переподключения до ' + tm(h.peer.lostUntil) : 'Сейчас управляет: «' + h.peer.name + '» (' + h.peer.ip + ')') : h.taking ? 'Передаю управление…' : 'Никто не подключён. Код одноразовый: после входа появится новый.';
      renderTrust(h);
      const ws = h.watchers || [];
      $('wpWatchers').hidden = !ws.length;
      $('wpWatchers').textContent = ws.length ? 'Смотрят без управления: ' + ws.map((w) => '«' + w.name + '»').join(', ') : '';
      // Этот компьютер сам разрешает управлять собой — управлять другим нельзя (workplace.js: connect)
      $('wpFind').disabled = !!find.busy || h.on || c.on;
      $('wpAddrBtn').disabled = h.on || c.on;
      if (h.on || c.on) $('wpAddrRow').hidden = true;
    }
    const nm = $('wpNameIn');
    if (nm) {
      nm.placeholder = st.sysName || '';
      if (document.activeElement !== nm) nm.value = st.meOwn ? st.me : '';
      nm.disabled = c.on; // окно управляет другим компьютером — его имя меняют там
    }
    const bar = $('wpBar');
    if (bar) {
      bar.hidden = !c.on;
      bar.classList.toggle('lost', !!c.lostUntil);
      $('wpBarName').textContent = c.lostUntil ? 'переподключаюсь…' : c.name;
    }
    document.body.classList.toggle('wp-client', !!c.on);
    Eco.sync();
  }

  // p — компьютер (адрес; id — знакомый, без кода); watch — только смотреть (R5)
  async function connect(p, watch) {
    const code = $('wpCodeIn').value.replace(/\D/g, '');
    $('wpErr').textContent = '';
    if (!p || !p.addr) { Eco.say('У этого компьютера нет адреса — добавьте его «По адресу…»', true); return; }
    const known = !!p.known;
    if (code.length !== 6 && !(known && !code)) { Eco.say('Код — 6 цифр, он виден на пузырьке того компьютера.', true); $('wpCodeIn').focus(); return; }
    Eco.phase(watch ? 'watching' : 'connecting');
    if (!watch) {
      flashStatus('Сохраняю…');
      try { if (typeof profFlush === 'function') await profFlush(); } catch { /* дальше всё равно */ }
    }
    const r = await window.api.wpConnect({ addr: p.addr, code, id: known && !code ? (p.id || '') : '', watch: !!watch }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
    if (!r || !r.ok) {
      if (typeof repoClosing !== 'undefined') repoClosing = false;
      Eco.phase('ask');
      Eco.say('Не подключилось: ' + ((r && r.error) || 'нет ответа'), true);
      if (r && r.needCode) { Eco.needCode(); render(await window.api.wpState()); }
    } else if (watch) { $('wpCodeIn').value = ''; render(await window.api.wpState()); }
    // Удалось управлять — окно само перезагрузится с данными A
  }

  async function disconnect() {
    flashStatus('Сохраняю на компьютере A…');
    try { if (typeof liveSnap === 'function') window.api.wpShowPut(liveSnap()); } catch { /* что успели раньше */ } // окно A продолжит с того же места
    try { if (typeof profFlush === 'function') await profFlush(); } catch { /* связь могла уже пропасть */ }
    await window.api.wpDisconnect().catch(() => {});
  }

  /* ----- Пузырьки (Eco) -----
     Два слоя с одинаковыми координатами: круги .wp-blob под SVG-фильтром #wpGoo (размытие + резкий порог
     прозрачности — близкие круги сливаются перемычкой, как капли) и надписи .wp-bub сверху. У каждого пузырька —
     «дом» (куда его тянет пружина) и лёгкое покачивание вокруг него; соседи расталкиваются; слипшиеся пары
     прижаты друг к другу (расстояние меньше суммы радиусов — перемычка видна). Кадры идут, только пока поле видно. */
  const Eco = (() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bubs = new Map(); // ключ → пузырёк
    let link = null;        // { key, phase: 'ask' | 'connecting' | 'watching' | 'on' | 'watch' }
    let drag = null;
    let hot = null;         // к кому сейчас прилипнет перетаскиваемый
    let W = 600, H = 340, vis = false, raf = 0, last = 0, t0 = performance.now();
    let timer = 0;
    const field = () => $('wpEco');

    function make(key, kind) {
      const blob = document.createElement('div');
      blob.className = 'wp-blob' + (kind === 'me' ? ' me' : '');
      const lab = document.createElement('div');
      lab.className = 'wp-bub' + (kind === 'me' ? ' me' : '');
      lab.setAttribute('role', 'listitem');
      lab.tabIndex = 0;
      lab.dataset.key = key;
      $('wpEcoGoo').append(blob);
      $('wpEcoTop').append(lab);
      const b = { key, kind, blob, lab, r: 48, x: W * 0.7, y: H * 0.5, vx: 0, vy: 0, hx: W * 0.7, hy: H * 0.5, s: 0, sv: 0, st: 1, ph: Math.random() * 6.28, p: null, html: '' };
      if (kind === 'me') { b.x = b.hx = W * 0.32; b.y = b.hy = H * 0.48; }
      else { const m = bubs.get('me'); if (m) { b.x = m.x + 30; b.y = m.y; } } // новый «выдувается» из своего
      lab.addEventListener('pointerdown', (e) => down(e, b));
      lab.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && b.kind === 'peer') { e.preventDefault(); stick(b.key); }
      });
      bubs.set(key, b);
      return b;
    }
    function drop(b) { b.st = 0; b.gone = true; b.lab.style.pointerEvents = 'none'; }

    // Кто сейчас в сети и знаком: найденные «Найти», запомненные ключами, добавленные по адресу
    function peers() {
      const c = st.client, h = st.host;
      const out = [];
      const add = (p) => {
        const same = out.find((q) => (p.id && q.id === p.id) || sameAddr(q.addr, p.addr));
        if (same) { Object.assign(same, { ...p, known: same.known || p.known, away: same.away && p.away }); return; }
        out.push(p);
      };
      if (h.on) { for (const w of h.watchers || []) add({ key: 'w:' + w.ip + w.name, name: w.name, addr: w.ip, watcher: true }); return out; }
      if (c.on) { add({ key: 'cur', name: c.name, addr: c.addr, cur: true, lost: !!c.lostUntil }); return out; }
      for (const f of found || []) add({ key: 'id:' + f.id, id: f.id, name: f.name, addr: f.addr, busy: !!f.busy, known: !!f.known });
      for (const k of c.known || []) add({ key: 'id:' + k.id, id: k.id, name: k.name, addr: k.addr, known: true, away: !!found });
      for (const m of manual) add({ key: 'a:' + m.addr, name: m.addr, addr: m.addr, manual: true });
      if (c.watching) {
        const w = out.find((p) => sameAddr(p.addr, c.watching.addr) || p.name === c.watching.name);
        if (w) w.watched = true; else add({ key: 'watch', name: c.watching.name, addr: c.watching.addr, watched: true });
      }
      for (const p of out) {
        if (!p.key) p.key = 'a:' + p.addr;
        if (p.id && !p.key.startsWith('id:')) p.key = 'id:' + p.id;
        // У знакомого компьютера есть ключ — по адресу из поиска он тоже входит без кода
        if (!p.known && (c.known || []).some((k) => k.id === p.id || sameAddr(k.addr, p.addr))) p.known = true;
      }
      return out;
    }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    function label(b) {
      const h = st.host, c = st.client, p = b.p || {};
      let cls = '', html = '', title = '';
      if (b.kind === 'me') {
        html = '<span class="wb-cap">' + esc(T('Этот компьютер')) + '</span><span class="wb-n" data-noi18n>' + esc(st.me) + '</span>';
        if (h.on && h.code && !h.peer) html += '<span class="wb-code" data-noi18n title="' + esc(T('Код для входа')) + '">' + esc(fmtCode(h.code)) + '</span>';
        if (h.on) cls += ' pulse';
        title = h.on ? T('Ждёт, когда к нему подключатся. Код — для первого входа') : T('Перетащите на компьютер, которым хотите управлять');
      } else {
        const sub = p.cur ? (p.lost ? T('переподключаюсь…') : T('управляете им'))
          : p.watcher ? T('смотрит экран') : p.watched ? T('смотрите экран')
          : p.busy ? T('им уже управляют') : p.away ? T('сейчас не отвечает')
          : p.known ? T('без кода') : T('нужен код');
        html = '<span class="wb-n" data-noi18n>' + esc(p.name || p.addr) + '</span><span class="wb-s">' + esc(sub) + '</span>';
        if (p.addr && !p.manual && !p.watcher) html += '<span class="wb-s">' + esc(p.addr) + '</span>';
        if (p.busy || p.away) cls += ' dim';
        if (p.lost || (link && link.key === b.key && (link.phase === 'connecting' || link.phase === 'watching'))) cls += ' pulse';
        title = p.busy ? T('Им уже управляет другой компьютер') : p.cur || p.watcher || p.watched ? '' : T('Перетащите свой пузырёк сюда — или щёлкните');
      }
      if (hot === b || (drag && drag.b === b && hot)) cls += ' hot';
      if (drag && drag.b === b) cls += ' drag';
      if (html !== b.html) { b.lab.innerHTML = html; b.html = html; }
      b.lab.className = 'wp-bub' + (b.kind === 'me' ? ' me' : '') + cls;
      b.lab.title = title;
      b.lab.setAttribute('aria-label', (b.kind === 'me' ? T('Этот компьютер') + ': ' : '') + b.lab.textContent);
      b.blob.className = 'wp-blob' + (b.kind === 'me' ? ' me' : p.cur || p.watched || p.watcher ? ' on' : p.busy || p.away ? ' dim' : p.known ? ' known' : '');
    }

    // Куда тянет каждый пузырёк: свой — слева (или в центре пары), остальные — дугой справа
    function layout() {
      const k = Math.max(0.72, Math.min(1, W / 620));
      const me = bubs.get('me');
      if (!me) return;
      me.r = 62 * k;
      const live = [...bubs.values()].filter((b) => b.kind === 'peer' && !b.gone);
      for (const b of live) b.r = 52 * k;
      const popOn = !$('wpPop').hidden;
      const linked = live.filter((b) => link && link.key === b.key || b.p.cur || b.p.watcher || b.p.watched);
      const free = live.filter((b) => !linked.includes(b));
      let cx = W * 0.32, cy = H * 0.48;
      if (linked.length === 1) {
        const o = linked[0];
        const d = (me.r + o.r) * 0.86; // прижаты: перемычка видна, надписи не наезжают
        // Окошко открыто: широкое поле — пара слева, окошко справа; узкое — пара сверху, окошко под ней
        const side = popOn && W >= 470;
        const pcx = side ? Math.max(me.r + 12 + d * o.r / (me.r + o.r), (W - 262) / 2) : W * 0.5;
        const pcy = popOn && !side ? me.r + 18 : H * 0.44;
        me.hx = pcx - d * o.r / (me.r + o.r); me.hy = pcy;
        o.hx = me.hx + d; o.hy = pcy;
        cx = pcx; cy = pcy;
      } else if (linked.length > 1) { // зрители вокруг своего
        cx = W * 0.4; cy = H * 0.46;
        me.hx = cx; me.hy = cy;
        linked.forEach((o, i) => { // веером справа от своего
          const ang = -Math.PI * 0.42 + i * (Math.PI * 0.84 / (linked.length - 1));
          const d = (me.r + o.r) * 0.76;
          o.hx = cx + Math.cos(ang) * d; o.hy = cy + Math.sin(ang) * d;
        });
      } else { me.hx = cx; me.hy = cy; }
      // Свободные — дугой справа от своего (при слипшейся паре — подальше, по краю)
      const n = free.length;
      const R = linked.length ? Math.min(W, H) * 0.62 : Math.max(me.r + 48 * k + 40, Math.min(W * 0.46, H * 0.62));
      free.forEach((b, i) => {
        const span = Math.min(Math.PI * 1.15, 0.62 * Math.max(1, n - 1));
        const ang = n === 1 ? 0 : -span / 2 + i * (span / (n - 1));
        b.hx = cx + Math.cos(ang) * R; b.hy = cy + Math.sin(ang) * R * 0.92;
      });
      for (const b of bubs.values()) {
        b.hx = Math.max(b.r + 6, Math.min(W - b.r - 6, b.hx));
        b.hy = Math.max(b.r + 6, Math.min(H - b.r - 6, b.hy));
      }
      placePop();
    }

    // Широкое поле — окошко справа от пары; узкое — под парой, поле вытягивается, чтобы окошко не закрыло пузырьки
    function placePop() {
      const pop = $('wpPop'), f = field();
      if (pop.hidden || !link) { if (f.style.height) { f.style.height = ''; } return; }
      const me = bubs.get('me'), o = bubs.get(link.key);
      if (!me || !o) return;
      const pw = pop.offsetWidth || 250, ph = pop.offsetHeight || 170;
      if (W >= 470) {
        if (f.style.height) f.style.height = '';
        pop.style.left = (W - pw - 12) + 'px';
        pop.style.top = Math.max(8, (H - ph) / 2 - 10) + 'px';
        return;
      }
      const top = Math.max(me.hy + me.r, o.hy + o.r) + 14;
      const need = Math.ceil(top + ph + 12);
      if (need > 340 && f.style.height !== need + 'px') f.style.height = need + 'px';
      pop.style.left = Math.max(8, (W - pw) / 2) + 'px';
      pop.style.top = top + 'px';
    }

    function hint() {
      const el = $('wpEcoHint');
      if (!el || !st) return;
      const h = st.host, c = st.client;
      const live = [...bubs.values()].filter((b) => b.kind === 'peer' && !b.gone);
      let s = '';
      if (c.on) s = c.lostUntil ? T('Связь с «{0}» прервалась — переподключаюсь (до {1}). Экраны на нём показывают как прежде.', c.name, tm(c.lostUntil)) : T('Это окно управляет компьютером «{0}». Экраны, библиотека и настройки — его.', c.name);
      else if (h.on) s = h.peer ? T('Сейчас управляет: «{0}»', h.peer.name) : T('Ждём: на другом компьютере перетащите свой пузырёк на «{0}» и введите код.', st.me);
      else if (link && link.phase !== 'watch') s = '';
      else if (c.watching) s = T('Окно «Экран компьютера «{0}»» показывает, что на его экране. Управление — у него.', c.watching.name);
      else if (!live.length) s = found ? T('Никого не нашлось. Включите на том компьютере «Разрешить управление…» или добавьте его по адресу.') : T('Ищу компьютеры в этой сети…');
      else s = T('Перетащите свой пузырёк на компьютер — они слипнутся и соединятся.');
      el.textContent = s;
      el.hidden = !$('wpPop').hidden && !!link;
    }

    // Окошко под слипшейся парой: код, «Управлять», «Смотреть» — или «Отключиться» / «Не смотреть»
    function pop() {
      const box = $('wpPop');
      const c = st.client, h = st.host;
      const b = link && bubs.get(link.key);
      const show = !!b && !h.on;
      box.hidden = !show;
      if (!show) return;
      const p = b.p;
      $('wpPopT').textContent = p.name || p.addr;
      const on = !!p.cur, watching = !!p.watched;
      const busy = link.phase === 'connecting' || link.phase === 'watching';
      $('wpCodeIn').hidden = on || watching || !!p.known;
      $('wpGo').hidden = on || watching;
      $('wpWatchGo').hidden = on || watching;
      $('wpStop').hidden = !on;
      $('wpWatchStop').hidden = !watching;
      $('wpPopX').hidden = on || watching;
      $('wpGo').disabled = busy || c.connecting;
      $('wpWatchGo').disabled = busy || c.connecting;
      $('wpGo').textContent = link.phase === 'connecting' ? T('Подключаюсь…') : T('Управлять');
      const ht = $('wpPopHint');
      if (!ht.classList.contains('wp-err')) {
        ht.textContent = on ? T('Это окно управляет им: экраны, библиотека и настройки — его.')
          : watching ? T('Его экран — в отдельном окне. Управление — у него.')
          : p.known ? T('Этот компьютер вас помнит — код не нужен.')
          : T('Введите код — он на пузырьке того компьютера.');
      }
    }

    function sync() {
      if (!st || !field()) return;
      if (!bubs.has('me')) make('me', 'me');
      const list = peers();
      const keys = new Set(list.map((p) => p.key));
      for (const b of bubs.values()) if (b.kind === 'peer' && !keys.has(b.key) && !b.gone) drop(b);
      for (const p of list) {
        let b = bubs.get(p.key);
        if (!b || b.gone) { if (b) { b.blob.remove(); b.lab.remove(); } b = make(p.key, 'peer'); }
        b.p = p;
      }
      // Состояние связи — из главного процесса: управляем / смотрим — пара слипшаяся сама
      const cur = list.find((p) => p.cur) || list.find((p) => p.watched);
      if (cur) link = { key: cur.key, phase: cur.cur ? 'on' : 'watch' };
      else if (link && (link.phase === 'on' || link.phase === 'watch')) link = null;
      else if (link && !keys.has(link.key)) link = null;
      if (st.host.on && link && !list.find((p) => p.key === link.key && p.watcher)) link = null;
      for (const b of bubs.values()) label(b);
      pop();
      layout();
      hint();
      // Поиск каждые 8 с перерисовывает поле; будим пузырьки, только если что-то и правда поменялось
      const sig = [...bubs.values()].map((b) => b.key + (b.gone ? '-' : '') + b.html + b.hx.toFixed(0) + b.hy.toFixed(0) + b.r.toFixed(0)).join('|') + (link ? link.key + link.phase : '');
      if (sig !== lastSig) { lastSig = sig; kick(); }
    }
    let lastSig = '';

    // Прилипнуть: свой и выбранный прижимаются, под ними — окошко
    function stick(key) {
      const b = bubs.get(key);
      if (!b || b.gone || !b.p || st.host.on || st.client.on) return;
      if (b.p.busy) { shake(b); say(T('Им уже управляет другой компьютер'), true); return; }
      if (b.p.watched) { link = { key, phase: 'watch' }; sync(); return; }
      link = { key, phase: 'ask' };
      $('wpCodeIn').value = '';
      $('wpErr').textContent = '';
      $('wpPopHint').classList.remove('wp-err');
      sync();
      requestAnimationFrame(() => { placePop(); (b.p.known ? $('wpGo') : $('wpCodeIn')).focus(); });
    }
    function unstick() {
      if (!link || link.phase === 'on') return;
      const b = bubs.get(link.key);
      link = null;
      if (b) { b.vx += 260; b.vy -= 60; } // отскок
      sync();
    }
    function shake(b) { b.vx += 380; kick(); setTimeout(() => { b.vx -= 520; kick(); }, 90); }
    function say(text, bad) {
      const ht = $('wpPopHint');
      if (link && !$('wpPop').hidden) { ht.textContent = text; ht.classList.toggle('wp-err', !!bad); }
      else $('wpErr').textContent = bad ? text : '';
    }

    /* ----- Перетаскивание ----- */
    function down(e, b) {
      if (e.button !== 0 || b.gone || !st) return;
      if (e.target.closest('.wb-code')) return; // код можно выделить и скопировать
      const fixed = st.client.on || st.host.on || (b.p && (b.p.busy || b.p.cur || b.p.watcher));
      const r = field().getBoundingClientRect();
      drag = { b, dx: e.clientX - r.left - b.x, dy: e.clientY - r.top - b.y, sx: e.clientX, sy: e.clientY, moved: false, fixed, lx: b.x, ly: b.y, lt: performance.now() };
      if (!fixed) b.lab.setPointerCapture(e.pointerId);
      e.preventDefault();
      kick();
    }
    function move(e) {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      if (drag.fixed) return;
      const b = drag.b;
      const r = field().getBoundingClientRect();
      const nx = Math.max(b.r * 0.6, Math.min(W - b.r * 0.6, e.clientX - r.left - drag.dx));
      const ny = Math.max(b.r * 0.6, Math.min(H - b.r * 0.6, e.clientY - r.top - drag.dy));
      const now = performance.now(), dt = Math.max(1, now - drag.lt) / 1000;
      b.vx = (nx - drag.lx) / dt * 0.6; b.vy = (ny - drag.ly) / dt * 0.6;
      b.x = nx; b.y = ny; drag.lx = nx; drag.ly = ny; drag.lt = now;
      // К кому прилипнет: свой — к любому доступному; чужой — только к своему
      let best = null, bd = Infinity;
      for (const o of bubs.values()) {
        if (o === b || o.gone) continue;
        if (b.kind === 'peer' && o.kind !== 'me') continue;
        const cand = b.kind === 'me' ? o : b;
        if (!cand.p || cand.p.busy || cand.p.away && !cand.p.known) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < b.r + o.r + 34 && d < bd) { bd = d; best = o; }
      }
      if (best !== hot) { const was = hot; hot = best; if (was) label(was); if (hot) label(hot); label(b); }
    }
    function up() {
      if (!drag) return;
      const { b, moved, fixed } = drag;
      const target = hot;
      drag = null; hot = null;
      for (const o of bubs.values()) label(o);
      if (fixed) { if (!moved && b.kind === 'peer' && b.p && b.p.busy) { shake(b); say(T('Им уже управляет другой компьютер'), true); } return; }
      if (moved && target) stick(b.kind === 'me' ? target.key : b.key);
      else if (!moved && b.kind === 'peer') stick(b.key);
      else if (!moved && b.kind === 'me') $('wpNameIn').focus();
      else if (moved && link && b.key === link.key) { /* оторвали от своего — отпустить */ if (Math.hypot(b.x - bubs.get('me').x, b.y - bubs.get('me').y) > b.r + bubs.get('me').r + 40) unstick(); }
    }

    /* ----- Кадры ----- */
    function frame(dt, t) {
      const list = [...bubs.values()];
      const me = bubs.get('me');
      for (const b of list) {
        // появление / исчезание — своя пружина
        b.sv += (-170 * (b.s - b.st) - 20 * b.sv) * dt; b.s += b.sv * dt;
        if (drag && drag.b === b && !drag.fixed) continue;
        const wob = reduce ? 0 : sway;
        const tx = b.hx + Math.sin(t * 0.55 + b.ph) * 7 * wob;
        const ty = b.hy + Math.cos(t * 0.43 + b.ph * 1.3) * 6 * wob;
        let ax = 34 * (tx - b.x) - 7 * b.vx, ay = 34 * (ty - b.y) - 7 * b.vy;
        // магнит: кандидат тянется к перетаскиваемому
        if (drag && hot === b) { ax += 60 * (drag.b.x - b.x); ay += 60 * (drag.b.y - b.y); }
        b.vx += ax * dt; b.vy += ay * dt;
      }
      // соседи расталкиваются (кроме слипшейся пары)
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], c = list[j];
        if (a.gone || c.gone) continue;
        const pair = (a === me || c === me) && link && (a.key === link.key || c.key === link.key);
        const watcherPair = (a === me || c === me) && ((a.p && (a.p.watcher || a.p.cur || a.p.watched)) || (c.p && (c.p.watcher || c.p.cur || c.p.watched)));
        if (pair || watcherPair) continue;
        if (drag && (hot === a || hot === c) && (drag.b === a || drag.b === c)) continue;
        let dx = c.x - a.x, dy = c.y - a.y;
        if (Math.abs(dx) + Math.abs(dy) < 0.5) { dx = 1; dy = 0.3; } // совпали — разводим в сторону, не делим на ноль
        const d = Math.max(4, Math.hypot(dx, dy));
        const min = a.r + c.r + 14;
        if (d < min) {
          const f = (min - d) * 26 * dt / d;
          if (!(drag && drag.b === a)) { a.vx -= dx * f; a.vy -= dy * f; }
          if (!(drag && drag.b === c)) { c.vx += dx * f; c.vy += dy * f; }
        }
      }
      for (const b of list) {
        if (drag && drag.b === b && !drag.fixed) continue;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 2400) { b.vx *= 2400 / sp; b.vy *= 2400 / sp; } // не разгоняться
        b.x += b.vx * dt; b.y += b.vy * dt;
        // Улетел (или NaN) — обратно домой; держать в поле
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) { b.x = b.hx; b.y = b.hy; b.vx = b.vy = 0; }
        b.x = Math.max(b.r * 0.5, Math.min(W - b.r * 0.5, b.x));
        b.y = Math.max(b.r * 0.5, Math.min(H - b.r * 0.5, b.y));
      }
    }
    function paint() {
      for (const b of [...bubs.values()]) {
        if (b.gone && b.s < 0.02) { b.blob.remove(); b.lab.remove(); bubs.delete(b.key); continue; }
        const s = Math.max(0, b.s);
        const sp = Math.hypot(b.vx, b.vy);
        const q = reduce ? 0 : Math.min(0.14, sp / 2600); // растягивается по ходу движения
        const ang = Math.atan2(b.vy, b.vx);
        const d = b.r * 2;
        b.blob.style.width = b.blob.style.height = d + 'px';
        b.blob.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px) rotate(${ang}rad) scale(${s * (1 + q)}, ${s * (1 - q)}) rotate(${-ang}rad)`;
        b.lab.style.width = b.lab.style.height = d + 'px';
        b.lab.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px) scale(${s})`;
        b.lab.style.opacity = Math.min(1, s * 1.4);
      }
    }
    /* Покачивание идёт SWAY_MS после любого изменения (поиск, связь, щелчок, перетаскивание), потом плавно
       затихает, пузырьки садятся на места — и кадры останавливаются совсем. Раньше цикл крутился, пока поле
       видно: SVG-фильтр #wpGoo пересчитывался 120+ раз в секунду — ядро процессора и видеокарта заняты
       впустую (лаги на слабых ПК). Кадров не больше ~60 в секунду и на мониторах 120/144 Гц. */
    const SWAY_MS = 5000, FADE_MS = 1500;
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    let sway = 0, awake = 0;
    function calmAll() {
      for (const b of bubs.values()) {
        if (Math.abs(b.s - b.st) > 0.002 || Math.abs(b.sv) > 0.02) return false;
        if (b.gone) continue;
        if (Math.hypot(b.vx, b.vy) > 0.6 || Math.hypot(b.x - b.hx, b.y - b.hy) > 0.4) return false;
      }
      return true;
    }
    function loop(now) {
      raf = 0;
      if (!vis) return;
      if (now - last < 15) { raf = requestAnimationFrame(loop); return; } // 120/144 Гц — каждый второй кадр
      const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
      const t = (now - t0) / 1000;
      const idle = now - awake - SWAY_MS;
      const want = idle <= 0 ? 1 : Math.max(0, 1 - idle / FADE_MS);
      sway = clamp01(sway + Math.max(-dt / 0.6, Math.min(dt / 0.6, want - sway))); // вступает плавно, без рывка
      if (want === 0 && sway < 0.01) sway = 0;
      for (let i = 0; i < 4; i++) frame(dt / 4, t);
      paint();
      if (sway === 0 && !drag && calmAll()) return; // всё на местах — тишина до следующего kick()
      raf = requestAnimationFrame(loop);
    }
    function kick() {
      awake = performance.now();
      if (vis && !raf) { last = awake - 16; raf = requestAnimationFrame(loop); }
    }

    function measure() {
      const f = field();
      if (!f) return;
      // Размер разметки, а не на экране: окно настроек раскрывается с масштабом — getBoundingClientRect врёт
      if (f.offsetWidth > 120 && f.offsetHeight > 120) { W = f.offsetWidth; H = f.offsetHeight; layout(); kick(); }
    }

    // Видно поле — кадры и поиск в сети каждые 8 с; не видно — тишина
    function visible(v) {
      vis = v;
      clearInterval(timer); timer = 0;
      if (!v) return;
      lastSig = ''; // поле снова видно — пузырьки оживают
      measure();
      const scan = () => { if (st && !st.host.on && !st.client.on && !document.hidden) find(); };
      scan();
      timer = setInterval(scan, 8000);
      kick();
    }

    function wire() {
      const f = field();
      if (!f) return;
      new ResizeObserver(measure).observe(f);
      new IntersectionObserver((es) => visible(es.some((x) => x.isIntersecting))).observe(f);
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
      $('wpPopX').addEventListener('click', unstick);
      $('wpPop').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); unstick(); } });
      $('wpGo').addEventListener('click', () => { const b = link && bubs.get(link.key); if (b) connect(b.p, false); });
      $('wpWatchGo').addEventListener('click', () => { const b = link && bubs.get(link.key); if (b) connect(b.p, true); });
      $('wpCodeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('wpGo').click(); });
      $('wpCodeIn').addEventListener('input', (e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
        e.target.value = v.length > 3 ? v.slice(0, 3) + ' ' + v.slice(3) : v;
        $('wpPopHint').classList.remove('wp-err');
        pop();
      });
    }

    return {
      wire, sync, stick, say,
      phase(p) { if (link) { link.phase = p; sync(); } },
      needCode() { const b = link && bubs.get(link.key); if (b && b.p) b.p.known = false; $('wpCodeIn').hidden = false; $('wpCodeIn').focus(); },
    };
  })();

  function wire() {
    const on = $('wpHostOn');
    if (on) on.addEventListener('change', async () => render(await window.api.wpHost(on.checked)));
    if ($('wpFind')) $('wpFind').addEventListener('click', find);
    if ($('wpWatchStop')) $('wpWatchStop').addEventListener('click', async () => render(await window.api.wpWatchStop()));
    if ($('wpStop')) $('wpStop').addEventListener('click', disconnect);
    if ($('wpBarStop')) $('wpBarStop').addEventListener('click', disconnect);
    if ($('wpBarOpen')) $('wpBarOpen').addEventListener('click', () => openSettings('wp'));
    const nm = $('wpNameIn');
    if (nm) {
      const save = async () => { if (st && nm.value.trim() !== (st.meOwn ? st.me : '')) render(await window.api.wpSetName(nm.value)); };
      nm.addEventListener('change', save);
      nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); if (e.key === 'Escape') { nm.value = st && st.meOwn ? st.me : ''; nm.blur(); } });
    }
    // «По адресу…»: компьютер не нашёлся сам — его пузырёк появляется по адресу
    if ($('wpAddrBtn')) $('wpAddrBtn').addEventListener('click', () => { const r = $('wpAddrRow'); r.hidden = !r.hidden; if (!r.hidden) $('wpAddrIn').focus(); });
    const addAddr = () => {
      const a = $('wpAddrIn').value.trim();
      if (!a) return;
      const full = /:\d+$/.test(a) ? a : a + ':8090';
      if (!manual.some((m) => sameAddr(m.addr, full))) manual.push({ addr: full });
      $('wpAddrIn').value = '';
      $('wpAddrRow').hidden = true;
      Eco.sync();
      const p = st && [...((found || [])), ...(st.client.known || [])].find((x) => sameAddr(x.addr, full));
      Eco.stick(p && p.id ? 'id:' + p.id : 'a:' + full);
    };
    if ($('wpAddrAdd')) $('wpAddrAdd').addEventListener('click', addAddr);
    if ($('wpAddrIn')) $('wpAddrIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') addAddr(); if (e.key === 'Escape') $('wpAddrRow').hidden = true; });
    Eco.wire();
  }

  window.wpHostName = () => (st && st.client.on ? st.client.name : ''); // имя компьютера A — окну обзора (wpbrowse.js)
  window.wpIsClient = () => !!(st && st.client.on && !st.client.lostUntil); // renderer.js: livePush
  window.api.onWpState(render);
  window.api.onWpNotice((m) => {
    if (!m || !m.text) return;
    // Связь вернулась сама — событие не от человека: островок «готово» вместо крутилки «переподключаюсь…»
    if (m.kind === 'ok' && typeof Notify !== 'undefined') { Notify.close('progress'); Notify.show({ kind: 'ok', text: m.text }); return; }
    showNotice(m.text, !m.ok);
  });
  // Компьютер B подключился к этому: всё несохранённое — на диск, затем окно станет плашкой (workplace.js: hostTake).
  // Цвета темы — плашке, чтобы она была в оформлении программы
  window.api.onWpFlush(async () => {
    flashStatus('Передаю управление…');
    try { if (typeof profFlush === 'function') await profFlush(); } catch { /* что успели */ }
    const cs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const k of ['--ink', '--panel', '--field', '--line', '--text', '--muted', '--live', '--live-ink', '--warn', '--rk']) vars[k] = cs.getPropertyValue(k).trim();
    vars.font = getComputedStyle(document.body).fontFamily;
    vars.bg = getComputedStyle(document.body).backgroundColor;
    let show = null;
    try { if (typeof liveSnap === 'function') show = JSON.parse(JSON.stringify(liveSnap())); } catch { show = null; } // R5: что на экране — окну B
    window.api.wpFlushed({ vars, show });
  });

  const start = async () => {
    wire();
    try { render(await window.api.wpState()); } catch { /* нет главного процесса */ }
    // Окно перезагрузилось после отключения от A: сказать почему
    try {
      const b = await window.api.wpBye();
      if (b && b.text && Date.now() - b.at < 60000) showNotice(b.text, b.code !== 'taken');
    } catch { /* нет */ }
    // R5: окно продолжает показ, начатый другим окном (B — после перехвата, A — после возврата управления)
    try {
      const s = await window.api.wpShow();
      if (s && typeof liveRestore === 'function') {
        for (let i = 0; i < 100 && !(typeof lib !== 'undefined' && lib && lib.items); i++) await new Promise((r) => setTimeout(r, 100)); // библиотека загрузилась
        liveRestore(s);
      }
    } catch { /* начнём с чистого выбора */ }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
