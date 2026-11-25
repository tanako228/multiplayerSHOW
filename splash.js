/* ---------- Готовность окна программы ----------
   Подключается последним. Заставку при запуске показывает отдельное прозрачное окно (brand/splash-win.html, main.js →
   createSplash); здесь только ждём, пока загрузятся плейлисты и Библия (не дольше MAX_MS, если что-то зависло),
   и говорим main.js, что окно можно показывать. Своей заставки внутри окна больше нет. */

(() => {
  const MAX_MS = 12000;
  const safe = (p) => Promise.resolve(p).catch(() => {});
  Promise.race([
    Promise.all([safe(serviceReady), safe(bibleReady)]),
    new Promise((r) => setTimeout(r, MAX_MS)),
  ]).then(() => window.api?.appReady?.()); // main.js → revealControl
})();
