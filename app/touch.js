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

  return { fsElement, fsEnabled, fsCan, fsEnter, fsExit, fsListen, touching, penEdge, inRect, slop };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TouchKit;
