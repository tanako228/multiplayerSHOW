/* Производительность (Настройки → «Производительность»; главный процесс — perf.js).
   • При запуске: лёгкий вид (html.perf-lite), если компьютер слабый (Авто) или выбран режим «Экономно».
   • Раздел: режим, что за компьютер и какая видеокарта рисует, память и процессор по частям программы —
     обновляется раз в 2 с, только пока раздел открыт. «Копировать» — всё текстом, чтобы прислать разработчику. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const gb = (b) => (b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1) + ' ГБ';
  const mbs = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(1) + ' ГБ' : mb + ' МБ');
  let last = null, timer = 0;

  function setLite(on) {
    const html = document.documentElement;
    if (html.classList.contains('perf-lite') === !!on) return;
    html.classList.toggle('perf-lite', !!on);
    if (typeof applyUiColors === 'function') applyUiColors(); // tools.js: размытие и плотность панелей
  }

  // Часть программы — понятным словом
  function partName(p) {
    if (p.type === 'Browser') return 'Программа (главный процесс)';
    if (p.type === 'GPU') return 'Видеокарта (всё, что рисуется)';
    if (p.type === 'Tab' || p.type === 'Renderer') {
      const n = (p.name || '').replace(/\s+—\s+MP Show$/, '');
      return n ? 'Окно: ' + n : 'Окно';
    }
    const sub = /network/i.test(p.sub) ? 'сеть' : /audio/i.test(p.sub) ? 'звук' : /video_capture/i.test(p.sub) ? 'камеры и захват' : /storage/i.test(p.sub) ? 'хранилище' : p.sub || '';
    return 'Служебный' + (sub ? ': ' + sub : '');
  }

  const REASON = { ram: 'мало оперативной памяти', nogpu: 'видеокарта не работает — рисует процессор' };

  function paint(x) {
    last = x;
    $('pfMode').value = x.mode;
    // видеокарта выбирается при запуске; .field — display:flex, атрибут hidden его не прячет
    $('pfRestartRow').style.display = (x.mode === 'eco') === (x.startedMode === 'eco') ? 'none' : '';
    $('pfNow').textContent = x.lite
      ? 'Сейчас: лёгкий вид' + (x.mode === 'auto' && x.reasons.length ? ' (' + x.reasons.map((r) => REASON[r] || r).join(', ') + ')' : '') + '.'
      : 'Сейчас: полный вид.';
    const g = x.gpu || {};
    const a = g.active;
    const rows = [
      ['Оперативная память', gb(x.ram) + ' · свободно ' + gb(x.ramFree)],
      ['Процессор', (x.cpu.name || '—') + ' · ядер: ' + x.cpu.cores],
      ['Рисует', a ? a.name + (a.vram ? ' · ' + gb(a.vram) + ' видеопамяти' : '') : '—'],
      ['Ускорение', g.accel ? 'включено' + (g.video && /enabled/.test(g.video) ? ', видео — на видеокарте' : '') : 'выключено — всё рисует процессор'],
    ];
    const other = (g.list || []).filter((d) => d !== a && !(a && d.name === a.name));
    if (other.length) rows.push(['Ещё видеокарты', other.map((d) => d.name + (d.vram ? ' · ' + gb(d.vram) : '')).join('; ')]);
    $('pfSum').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd data-noi18n>${esc(v)}</dd>`).join('');
    const used = Math.max(0, Math.min(1, 1 - x.ramFree / x.ram));
    $('pfRamBar').style.width = (used * 100).toFixed(0) + '%';
    const warn = [];
    if (g.wrongGpu) warn.push('Есть отдельная видеокарта, но рисует встроенная. Чаще всего монитор или проектор подключён к разъёму материнской платы — подключите его к разъёму видеокарты (снизу корпуса, рядом с ней). Если не помогло — Параметры Windows → Дисплей → Графика → MP Show → «Высокая производительность».');
    if (!g.accel) warn.push('Ускорение видеокарты не работает — всё рисует процессор, отсюда лаги. Обновите драйвер видеокарты с сайта NVIDIA / AMD / Intel.');
    if (used > 0.9) warn.push('Оперативная память почти занята (' + Math.round(used * 100) + ' %). Закройте лишние программы — браузер, OBS, мессенджеры.');
    const hot = x.parts.filter((p) => p.cpu > 50 && p.type !== 'GPU');
    if (hot.length) warn.push('Сильно занят процессор: ' + hot.map((p) => partName(p) + ' — ' + p.cpu + ' %').join('; ') + '.');
    $('pfWarn').textContent = warn.join('\n\n');
    $('pfWarn').style.whiteSpace = 'pre-line';
    const total = x.parts.reduce((s, p) => s + p.mb, 0);
    $('pfRows').innerHTML = '<div class="pf-row pf-head"><span>Часть программы</span><span>Память</span><span>Процессор</span></div>'
      + x.parts.filter((p) => p.mb >= 5 || p.cpu >= 1).map((p) => `<div class="pf-row${p.cpu > 50 ? ' pf-hot' : ''}"><span class="pf-n" title="${esc(partName(p))}">${esc(partName(p))}</span><span data-noi18n>${esc(mbs(p.mb))}</span><span data-noi18n>${p.cpu.toFixed(0)} %</span></div>`).join('');
    $('pfTotal').textContent = 'Всего программа: ' + mbs(total) + ' из ' + gb(x.ram);
  }

  async function tick() {
    try { paint(await window.api.perfInfo()); } catch { /* закрывается */ }
  }
  // Настройки: раздел открыт — замер раз в 2 с; закрыт — тишина
  window.perfShow = (on) => {
    clearInterval(timer); timer = 0;
    if (!on || !window.api.perfInfo) return;
    tick();
    timer = setInterval(() => { if ($('setDialog').open) tick(); else { clearInterval(timer); timer = 0; } }, 2000);
  };

  $('pfMode').addEventListener('change', async () => {
    await window.api.perfMode($('pfMode').value);
    const x = await window.api.perfInfo();
    setLite(x.lite);
    paint(x);
  });
  $('pfRestart').addEventListener('click', () => window.api.perfRestart());
  $('pfCopy').addEventListener('click', async () => {
    if (!last) return;
    const x = last;
    const lines = [
      'MP Show — производительность',
      'Режим: ' + x.mode + (x.lite ? ' (лёгкий вид)' : ' (полный вид)'),
      ...[...$('pfSum').querySelectorAll('dt')].map((dt) => dt.textContent + ': ' + dt.nextElementSibling.textContent),
      $('pfWarn').textContent ? 'Предупреждения: ' + $('pfWarn').textContent.replace(/\n+/g, ' ') : '',
      '',
      ...x.parts.map((p) => partName(p) + ' — ' + mbs(p.mb) + ', процессор ' + p.cpu.toFixed(0) + ' %'),
      $('pfTotal').textContent,
    ].filter((l) => l !== null);
    try { await navigator.clipboard.writeText(lines.join('\n')); Notify.show({ kind: 'ok', text: 'Скопировано — вставьте в сообщение разработчику' }); }
    catch { Notify.show({ kind: 'error', text: 'Не удалось скопировать' }); }
  });

  // При запуске: слабый компьютер или «Экономно» — сразу лёгкий вид
  if (window.api && window.api.perfInfo) window.api.perfInfo().then((x) => setLite(x.lite)).catch(() => {});
})();
