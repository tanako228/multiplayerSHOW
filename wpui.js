/* ---------- Удалённое управление (окно оператора): Настройки → «Удалённое управление» ----------
   Устройство — workplace.js (главный процесс). Здесь:
   - этот компьютер (A): «Разрешить управление с других компьютеров», адрес и код для входа, кто управляет;
   - другой компьютер (B): адрес и код A → «Подключиться». Окно перезагружается и работает с данными A;
     плашка #wpBar внизу — «Управляете компьютером …» и «Отключиться»;
   - просьба A сохранить всё перед передачей управления (wp:flush → profFlush из profpanel.js). */
(function () {
  const $ = (id) => document.getElementById(id);
  let st = null;
  let found = null; // последний «Найти»: [{ id, name, addr, busy, known }]
  const tm = (t) => new Date(t).toLocaleTimeString().slice(0, 5);
  const day = (t) => new Date(t).toLocaleDateString();

  // Строка списка (как закладки .bm): имя, адрес, пометка; щелчок — действие, справа — своя кнопка
  function row(name, addr, tag, tagOk, onPick, side) {
    const r = document.createElement('div');
    r.className = 'bm';
    const b = document.createElement('button');
    b.className = 'bm-ref';
    const n = document.createElement('span'); n.className = 'wp-n'; n.textContent = name;
    const a = document.createElement('span'); a.className = 'wp-a'; a.textContent = addr;
    const t = document.createElement('span'); t.className = 'wp-tag' + (tagOk ? ' ok' : ''); t.textContent = tag;
    b.append(n, a, t);
    if (onPick) b.addEventListener('click', onPick); else b.tabIndex = -1;
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
      return row(t.name, t.ip || '', 'был ' + day(t.last || t.at), false, null, x);
    }));
  }

  // B: найденные в сети и знакомые (входят без кода)
  function renderFound(c) {
    const box = $('wpFound');
    if (!box) return;
    const items = (found || []).map((f) => ({ ...f }));
    for (const k of c.known || []) if (!items.some((f) => f.id === k.id)) items.push({ ...k, known: true, away: !!found });
    box.hidden = !items.length && !found;
    if (!items.length) { const e = document.createElement('div'); e.className = 'bm-empty'; e.textContent = 'Никого не нашлось. Включите на том компьютере «Разрешить управление…» или введите его адрес.'; box.replaceChildren(e); return; }
    box.replaceChildren(...items.map((f) => row(f.name, f.addr,
      f.busy ? 'им уже управляют' : f.away ? 'сейчас не отвечает' : f.known ? 'без кода' : 'нужен код', f.known && !f.busy && !f.away,
      () => pick(f))));
  }
  // Адрес в поле — знакомый компьютер? Тогда «Смотреть» без кода
  function knownId() {
    const a = $('wpAddrIn').value.trim();
    const k = st && (st.client.known || []).find((x) => x.addr === a || x.addr === a + ':8090');
    return k && !$('wpCodeIn').value.trim() ? k.id : undefined;
  }
  function pick(f) {
    $('wpAddrIn').value = f.addr;
    $('wpErr').textContent = '';
    if (f.known) connect(f.id); else { $('wpCodeIn').value = ''; $('wpCodeIn').focus(); }
  }
  async function find() {
    const b = $('wpFind');
    b.disabled = true;
    b.textContent = 'Ищу…';
    try { found = await window.api.wpFind(); } catch { found = []; }
    b.disabled = false;
    b.textContent = 'Найти';
    if (st) renderFound(st.client);
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
      on.disabled = c.on;
      $('wpHostBox').hidden = !h.on;
      const list = addrs(h);
      $('wpAddr').textContent = list.length ? list.join(', ') : 'сервер запускается…';
      $('wpCode').textContent = fmtCode(h.code);
      $('wpHostState').textContent = h.peer ? (h.peer.lostUntil ? 'Связь с «' + h.peer.name + '» прервалась — жду переподключения до ' + tm(h.peer.lostUntil) : 'Сейчас управляет: «' + h.peer.name + '» (' + h.peer.ip + ')') : h.taking ? 'Передаю управление…' : 'Никто не подключён. Код одноразовый: после входа появится новый.';
      $('wpMe').textContent = st.me;
      renderTrust(h);
      const ws = h.watchers || [];
      $('wpWatchers').hidden = !ws.length;
      $('wpWatchers').textContent = ws.length ? 'Смотрят без управления: ' + ws.map((w) => '«' + w.name + '»').join(', ') : '';
    }
    const form = $('wpCliForm');
    if (form) {
      form.hidden = c.on;
      $('wpCliOn').hidden = !c.on;
      $('wpCliState').textContent = !c.on ? '' : c.lostUntil ? 'Связь с компьютером «' + c.name + '» прервалась — переподключаюсь (до ' + tm(c.lostUntil) + '). Экраны на нём показывают как прежде.' : 'Это окно управляет компьютером «' + c.name + '» (' + c.addr + '). Экраны, библиотека и настройки — его.';
      $('wpGo').disabled = c.connecting;
      $('wpGo').textContent = c.connecting ? 'Подключаюсь…' : 'Подключиться';
      // Этот компьютер сам разрешает управлять собой — управлять другим нельзя (workplace.js: connect)
      $('wpCliFields').hidden = h.on;
      $('wpGoHint').hidden = !h.on;
      const a = $('wpAddrIn');
      if (a && !a.value && c.addr) a.value = c.addr;
      if (!c.on) renderFound(c);
      // R5: смотрим экран другого компьютера
      $('wpWatchOn').hidden = !c.watching;
      if (c.watching) $('wpWatchState').textContent = 'Окно «Экран компьютера «' + c.watching.name + '»» показывает, что на его экране. Управление — у него.';
      $('wpWatchGo').disabled = c.connecting;
    }
    const bar = $('wpBar');
    if (bar) {
      bar.hidden = !c.on;
      bar.classList.toggle('lost', !!c.lostUntil);
      $('wpBarName').textContent = c.lostUntil ? 'переподключаюсь…' : c.name;
    }
    document.body.classList.toggle('wp-client', !!c.on);
  }

  // id — найденный знакомый компьютер: без кода, ключом; watch — только смотреть (R5)
  async function connect(id, watch) {
    const addr = $('wpAddrIn').value.trim();
    const code = $('wpCodeIn').value.replace(/\D/g, '');
    $('wpErr').textContent = '';
    if (!addr) { $('wpErr').textContent = 'Укажите адрес компьютера A (он виден у него в этом же разделе).'; return; }
    const known = typeof id === 'string' || (st && (st.client.known || []).some((k) => k.addr === addr || k.addr === addr + ':8090'));
    if (code.length !== 6 && !(known && !code)) { $('wpErr').textContent = 'Код — 6 цифр, его показывает компьютер A.'; return; }
    if (!watch) {
      flashStatus('Сохраняю…');
      try { if (typeof profFlush === 'function') await profFlush(); } catch { /* дальше всё равно */ }
    }
    const r = await window.api.wpConnect({ addr, code, id: typeof id === 'string' ? id : '', watch: !!watch }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
    if (!r || !r.ok) {
      if (typeof repoClosing !== 'undefined') repoClosing = false;
      $('wpErr').textContent = 'Не подключилось: ' + ((r && r.error) || 'нет ответа');
      if (r && r.needCode) { $('wpCodeIn').focus(); render(await window.api.wpState()); }
    } else if (watch) { $('wpCodeIn').value = ''; render(await window.api.wpState()); }
    // Удалось — окно само перезагрузится с данными A
  }

  async function disconnect() {
    flashStatus('Сохраняю на компьютере A…');
    try { if (typeof liveSnap === 'function') window.api.wpShowPut(liveSnap()); } catch { /* что успели раньше */ } // окно A продолжит с того же места
    try { if (typeof profFlush === 'function') await profFlush(); } catch { /* связь могла уже пропасть */ }
    await window.api.wpDisconnect().catch(() => {});
  }

  function wire() {
    const on = $('wpHostOn');
    if (on) on.addEventListener('change', async () => render(await window.api.wpHost(on.checked)));
    if ($('wpGo')) $('wpGo').addEventListener('click', () => connect());
    if ($('wpFind')) $('wpFind').addEventListener('click', find);
    if ($('wpWatchGo')) $('wpWatchGo').addEventListener('click', () => connect(knownId(), true));
    if ($('wpWatchStop')) $('wpWatchStop').addEventListener('click', async () => render(await window.api.wpWatchStop()));
    if ($('wpCodeIn')) $('wpCodeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
    if ($('wpStop')) $('wpStop').addEventListener('click', disconnect);
    if ($('wpBarStop')) $('wpBarStop').addEventListener('click', disconnect);
    if ($('wpBarOpen')) $('wpBarOpen').addEventListener('click', () => openSettings('wp'));
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
