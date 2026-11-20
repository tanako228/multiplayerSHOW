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
// Стоп-кадр (ниже): пока снимается кадр, новое на экран не идёт — иначе снимок поймал бы начало перехода
let frzHold = null;
const held = (fn) => (m) => { if (frzHold) frzHold.push(() => fn(m)); else fn(m); };
window.api.onScreenStage(held((info) => Compose.progInfo(info)));
// Слои (Media Layers): каждый показ и очистка — только в своём слое
window.api.onShow(held(({ content, transition, layer }) => Compose.progShow(content, transition, layer)));
window.api.onClear(held(({ transition, layer }) => Compose.progClear(transition, layer)));
window.api.onLayers(held((m) => Compose.progLayers(m)));
// Рисунок: просто список фигур или { shapes, animFrom } — новое прорисовывается анимацией
window.api.onInk(held((d) => Compose.progInk(d)));
// Крупный план (Быстрая анимация): плавный наплыв на часть слайда
window.api.onView(held((m) => Compose.progView(m)));
// Команды проигрывателя оператора — для видео, которое сейчас на экране
window.api.onVideo((m) => Compose.progVideo(m));

/* Стоп-кадр, как на проекторе (main.js: freezeSet) — только экраны группы «Зал» (как галочка «Зал» над «Предпросмотром»:
   экраны — «Зал», сцены — «Сцена», если в Редакторе сцен не выбрано другое). Снимок окна лежит поверх всего,
   под ним экран живёт дальше; отмена — снимок плавно уходит и видно то, что показано сейчас */
const frz = document.createElement('img');
frz.id = 'freeze';
frz.alt = '';
document.body.append(frz);
let frzSeq = 0;
const frzHall = () => { const d = Compose.screenDef(SID) || {}; return (d.group || (d.mode === 'scene' ? 'stage' : 'hall')) === 'hall'; };
const frzFlush = () => { const q = frzHold || []; frzHold = null; q.forEach((f) => f()); };
window.api.onFreeze(async ({ on, fresh }) => {
  const seq = ++frzSeq;
  if (!on) {
    frzFlush();
    frz.classList.remove('on');
    setTimeout(() => { if (seq === frzSeq) frz.removeAttribute('src'); }, 400);
    return;
  }
  if (!frzHall()) return;
  frzHold = frzHold || [];
  let url = null;
  try { url = await Promise.race([window.api.freezeSnap(SID, fresh, ALPHA), new Promise((ok) => setTimeout(() => ok(null), 1500))]); } catch { url = null; }
  if (seq !== frzSeq) return;
  if (url) {
    frz.src = url;
    try { await frz.decode(); } catch { /* покажется как есть */ }
    if (seq !== frzSeq) return;
    frz.classList.add('on');
  }
  frzFlush();
});
