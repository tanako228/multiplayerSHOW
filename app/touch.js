/* Ввод на планшете: общее для пенала (pen.js) и нот (sheets.js). Отдельно — чтобы проверять тестами (test/touch.test.js).
   - Полный экран: iPadOS до 16.4 знает только webkitRequestFullscreen (без обещания), iPhone — никакой (кнопку прячем).
     Разворачиваем не <html>, а блок внутри открытого окна <dialog>: окно лежит в верхнем слое, и <html> во весь экран
     в Safari и Chrome оказывался под ним или запрос отклонялся — кнопка «срабатывала не с первого раза».
   - Перо: «коснулся / поднял, не отпуская кнопку» (Windows) приходит как pointermove со сменой e.button. Safari на iPad
     ставит e.button = 0 и у обычных движений пера — поэтому без нажима это не касание, а без отрыва — не подъём.
   - Предмет пенала тонкий (стилус — 12 px): палец, попавший рядом, должен взять предмет, а не рисовать по листу. */
'use strict';
const TouchKit = (() => {
  /* ----- Полный экран ----- */
  const fsElement = (d = document) => d.fullscreenElement || d.webkitFullscreenElement || null;
  const fsEnabled = (d = document) => !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  const fsCan = (el, d = document) => !!el && fsEnabled(d) && (typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function');
  // Вызывать прямо в обработчике нажатия (иначе браузер не считает это жестом пользователя)
  function fsEnter(el) {
    try {
      const r = typeof el.requestFullscreen === 'function' ? el.requestFullscreen() : el.webkitRequestFullscreen();
      return Promise.resolve(r);
    } catch (e) { return Promise.reject(e); }
  }
  function fsExit(d = document) {
    if (!fsElement(d)) return Promise.resolve();
    try {
      const r = typeof d.exitFullscreen === 'function' ? d.exitFullscreen() : d.webkitExitFullscreen();
      return Promise.resolve(r).catch(() => {});
    } catch { return Promise.resolve(); }
  }
  function fsListen(fn, err, d = document) {
    d.addEventListener('fullscreenchange', fn);
    d.addEventListener('webkitfullscreenchange', fn);
    if (err) { d.addEventListener('fullscreenerror', err); d.addEventListener('webkitfullscreenerror', err); }
  }

  /* ----- Перо ----- */
  // Касание кончиком (бит 1) или обратным концом-ластиком (32). Палец и мышь — всегда «касание»
  const touching = (e) => e.pointerType !== 'pen' || (e.buttons & 33) !== 0;
  // pointermove пера со сменой кнопки: 'down' — коснулся, 'up' — поднял, '' — обычное движение
  function penEdge(e, mine) {
    if (e.pointerType !== 'pen' || (e.button !== 0 && e.button !== 5)) return '';
    if (!mine && touching(e) && e.pressure > 0) return 'down';
    if (mine && !touching(e) && !(e.pressure > 0)) return 'up';
    return '';
  }

  /* ----- Попадание в предмет ----- */
  // Точка (x, y) — на повёрнутом прямоугольнике (центр cx, cy; размер w × h; поворот rot°) или ближе pad px к нему
  function inRect(x, y, cx, cy, w, h, rot, pad) {
    const a = (-rot * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= w / 2 + pad && Math.abs(ly) <= h / 2 + pad;
  }
  // Допуск: пальцем — по размеру пятна касания (не меньше 12 px), пером — 6, мышью — 0
  const slop = (e) => (e.pointerType === 'touch' ? Math.max(12, Math.min(28, (Math.max(e.width || 0, e.height || 0)) / 2)) : e.pointerType === 'pen' ? 6 : 0);

  /* ----- Звук (пенал, метроном): один AudioContext на всё приложение ----- */
  // Почему на iPad было тихо при включённой громкости:
  // 1) Web Audio в iOS по умолчанию — «фоновый» звук: беззвучный режим (Пункт управления / переключатель) его глушит.
  //    Звук приложения переводим в «воспроизведение» — navigator.audioSession (iOS 17+), а на старых iOS — тихий
  //    <audio> (silence.wav): пока играет HTML-звук, Safari держит категорию «воспроизведение».
  // 2) Касание пальцем (pointerdown) для iOS — не «нажатие»: контекст, созданный или разбуженный в нём, молчит.
  //    Будим его на touchend / pointerup / click / keydown.
  // 3) После блокировки экрана или звонка контекст «interrupted» и сам не просыпается — будим на следующем касании.
  // Вызывать audioCtx() только когда звук действительно нужен: «воспроизведение» в iOS ставит на паузу музыку
  // в других приложениях.
  let ac = null;
  let quiet = null; // тихий <audio> для iOS без audioSession
  const win = typeof window !== 'undefined' ? window : null;
  const iosLike = () => !!win && typeof navigator !== 'undefined' &&
    (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  function session() {
    try {
      const s = navigator.audioSession;
      if (s) { if (s.type !== 'playback') s.type = 'playback'; return; }
    } catch { /* нет */ }
    if (!iosLike() || typeof Audio === 'undefined') return;
    try {
      if (!quiet) { quiet = new Audio('silence.wav'); quiet.loop = true; quiet.preload = 'auto'; quiet.setAttribute('playsinline', ''); quiet.volume = 0.01; }
      if (quiet.paused) { const p = quiet.play(); if (p && p.catch) p.catch(() => {}); }
    } catch { quiet = null; }
  }
  function wake() {
    if (!ac || ac.state === 'closed') return;
    session();
    if (ac.state !== 'running') { try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* нет */ } }
    // Пустой звук в самом нажатии — так старый Safari «разблокирует» контекст
    try { const b = ac.createBuffer(1, 1, 22050); const s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0); } catch { /* нет */ }
  }
  let wired = false;
  function audioCtx() {
    if (!win) return null;
    if (!ac || ac.state === 'closed') {
      const C = win.AudioContext || win.webkitAudioContext;
      if (!C) return null;
      try { ac = new C(); } catch { ac = null; return null; }
    }
    if (!wired) {
      wired = true;
      const opt = { capture: true, passive: true };
      for (const t of ['touchend', 'pointerup', 'click', 'keydown']) win.addEventListener(t, () => { if (ac && ac.state !== 'running') wake(); }, opt);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (quiet) quiet.pause(); } else if (ac && ac.state !== 'running') wake();
      });
    }
    if (ac.state !== 'running') wake(); else session();
    return ac;
  }

  // Открыто как приложение с экрана «Домой» (а не во вкладке браузера)
  const standalone = () => !!win && ((win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);

  return { fsElement, fsEnabled, fsCan, fsEnter, fsExit, fsListen, touching, penEdge, inRect, slop, audioCtx, iosLike, standalone };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TouchKit;
