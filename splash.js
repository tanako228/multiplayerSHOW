/* ---------- Заставка при запуске (brand/splash.html) ----------
   Подключается последним. Видна, пока грузятся плейлисты и Библия; потом плавно исчезает.
   Не меньше MIN_MS (чтобы анимация не мелькнула) и не больше MAX_MS (если что-то зависло). */

const msSplash = (() => {
  const MIN_MS = 1200;
  const MAX_MS = 12000;
  const el = document.getElementById('ms-splash');
  let done = false;

  function hide() {
    if (done || !el) return;
    done = true;
    el.classList.add('ms-hidden');
    setTimeout(() => el.remove(), 450);
  }
  const setText = (t) => { const l = document.getElementById('ms-label'); if (l && !done) l.textContent = t; };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const safe = (p) => Promise.resolve(p).catch(() => {});
  setText('Загружаю плейлисты и библиотеки…');
  safe(serviceReady).then(() => setText('Загружаю Библию…'));
  Promise.race([
    Promise.all([safe(serviceReady), safe(bibleReady), wait(Math.max(0, MIN_MS - performance.now()))]),
    wait(MAX_MS),
  ]).then(hide);

  return { hide, setText };
})();
