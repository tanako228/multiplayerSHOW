// Окно вывода — один экран (Screens, compose.js): ?screen=id (без него — «Основной»), &win=1 — обычное окно с рамкой
const params = new URLSearchParams(location.search);
const SID = params.get('screen') || 'main';
if (params.get('win')) document.body.classList.add('win');
const stage = document.getElementById('stage');
let size = { w: 0, h: 0 }; // «Основной»: 0 = разрешение монитора

// &alpha=1 — NDI с альфа-каналом (main.js): фон прозрачный
const ALPHA = !!params.get('alpha');
if (ALPHA) document.documentElement.classList.add('alpha');
Compose.mountScreen(stage, SID, { root: true, alpha: ALPHA });

// Экран строится в своём разрешении и вписывается в окно; поворот (вертикальный монитор) и отражение (обратная проекция) — здесь
function layout() {
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const def = Compose.screenDef(SID) || {};
  if (SID === 'main') {
    const c = Compose.config;
    const W = size.w || iw;
    const H = size.h || ih;
    // размер «Основного» знает только это окно — сцены и экраны-программы подстраиваются под него
    if (c.main.w !== W || c.main.h !== H) Compose.setConfig({ ...c, main: { w: W, h: H } });
  }
  const { w: W, h: H } = Compose.screenSize(SID);
  const rot = ((Number(def.rotate) || 0) % 360 + 360) % 360;
  const side = rot === 90 || rot === 270;
  let s = Math.min(iw / (side ? H : W), ih / (side ? W : H));
  // «Подгонка: пиксель в пиксель» (def.outFit 'none') — картинка своего разрешения не растягивается: меньше разрешение — меньше на мониторе
  if (def.outFit === 'none' && !(SID === 'main' && !size.w)) s = Math.min(s, 1 / (window.devicePixelRatio || 1));
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  stage.style.left = (iw - W) / 2 + 'px';
  stage.style.top = (ih - H) / 2 + 'px';
  stage.style.transformOrigin = '50% 50%';
  stage.style.transform = `scale(${s}) rotate(${rot}deg) scale(${def.flipX ? -1 : 1}, ${def.flipY ? -1 : 1})`;
  Compose.refit();
}

window.addEventListener('resize', layout);
layout();

window.api.onSettings((s) => { size = { w: s.resW | 0, h: s.resH | 0 }; layout(); });
// Настройки экранов и применённые сцены — из окна оператора (через main.js)
window.api.onScreenConfig((cfg) => {
  // Размер «Основного» в этом окне — свой (монитор), его не перетираем
  if (SID === 'main') cfg = { ...cfg, main: Compose.config.main };
  Compose.setConfig(cfg);
  layout();
});
window.api.onScreenStage((info) => Compose.progInfo(info));
// Слои (Media Layers): каждый показ и очистка — только в своём слое
window.api.onShow(({ content, transition, layer }) => Compose.progShow(content, transition, layer));
window.api.onClear(({ transition, layer }) => Compose.progClear(transition, layer));
window.api.onLayers((m) => Compose.progLayers(m));
// Рисунок: просто список фигур или { shapes, animFrom } — новое прорисовывается анимацией
window.api.onInk((d) => Compose.progInk(d));
// Крупный план (Быстрая анимация): плавный наплыв на часть слайда
window.api.onView((m) => Compose.progView(m));
// Команды проигрывателя оператора — для видео, которое сейчас на экране
window.api.onVideo((m) => Compose.progVideo(m));
