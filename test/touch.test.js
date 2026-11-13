// Тесты ввода на планшете (app/touch.js): полный экран с приставкой webkit, перо, попадание в предмет пенала.
// Запуск: node --test test/   (или npm test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../app/touch.js');

/* ----- Полный экран ----- */

test('полный экран: стандартный API (Chrome, Android, Windows, iPadOS 16.4+)', async () => {
  let asked = 0;
  const el = { requestFullscreen: () => { asked++; return Promise.resolve(); } };
  const doc = { fullscreenEnabled: true, fullscreenElement: null };
  assert.equal(T.fsCan(el, doc), true);
  await T.fsEnter(el);
  assert.equal(asked, 1);
});

test('полный экран: только webkit-приставка, без обещания (iPadOS до 16.4)', async () => {
  let asked = 0;
  const el = { webkitRequestFullscreen: () => { asked++; } };
  const doc = { webkitFullscreenEnabled: true, webkitFullscreenElement: null };
  assert.equal(T.fsCan(el, doc), true);
  await T.fsEnter(el); // undefined вместо обещания — не падает
  assert.equal(asked, 1);
  doc.webkitFullscreenElement = el;
  assert.equal(T.fsElement(doc), el);
  let out = 0;
  doc.webkitExitFullscreen = () => { out++; };
  await T.fsExit(doc);
  assert.equal(out, 1);
});

test('полный экран: iPhone — нельзя, кнопку прячем', () => {
  assert.equal(T.fsCan({}, {}), false);
  assert.equal(T.fsCan({ webkitRequestFullscreen() {} }, { webkitFullscreenEnabled: false }), false);
  assert.equal(T.fsCan(null, { fullscreenEnabled: true }), false);
});

test('полный экран: отказ браузера приходит отказом обещания, а не исключением', async () => {
  const sync = { requestFullscreen: () => { throw new TypeError('нет жеста'); } };
  await assert.rejects(T.fsEnter(sync), TypeError);
  const async_ = { requestFullscreen: () => Promise.reject(new Error('отказ')) };
  await assert.rejects(T.fsEnter(async_), /отказ/);
});

test('выйти из полного экрана, когда он не включён, — ничего не делать', async () => {
  let out = 0;
  await T.fsExit({ fullscreenElement: null, exitFullscreen: () => { out++; return Promise.resolve(); } });
  assert.equal(out, 0);
});

test('fsListen слушает и стандартные, и webkit-события', () => {
  const got = [];
  const doc = { addEventListener: (t) => got.push(t) };
  T.fsListen(() => {}, () => {}, doc);
  assert.deepEqual(got.sort(), ['fullscreenchange', 'fullscreenerror', 'webkitfullscreenchange', 'webkitfullscreenerror']);
});

/* ----- Перо ----- */

const pen = (o) => ({ pointerType: 'pen', button: -1, buttons: 0, pressure: 0, ...o });

test('палец и мышь — всегда касание; перо — по кончику или ластику', () => {
  assert.equal(T.touching({ pointerType: 'touch', buttons: 0 }), true);
  assert.equal(T.touching({ pointerType: 'mouse', buttons: 1 }), true);
  assert.equal(T.touching(pen({ buttons: 1 })), true);
  assert.equal(T.touching(pen({ buttons: 32 })), true);
  assert.equal(T.touching(pen({ buttons: 2 })), false); // боковая кнопка в воздухе
  assert.equal(T.touching(pen({ buttons: 0 })), false); // перо над экраном (наведение на iPad)
});

test('Safari iPad: обычное движение пера с button = 0 — не начало и не конец линии', () => {
  // во время линии
  assert.equal(T.penEdge(pen({ button: 0, buttons: 1, pressure: 0.4 }), true), '');
  // кратковременно buttons = 0, но нажим есть — линию не рвать
  assert.equal(T.penEdge(pen({ button: 0, buttons: 0, pressure: 0.3 }), true), '');
  // наведение над экраном
  assert.equal(T.penEdge(pen({ button: 0, buttons: 0, pressure: 0 }), false), '');
  // лишнее движение с buttons = 1 без нажима (после того как перо двигало предмет) — не новая линия
  assert.equal(T.penEdge(pen({ button: 0, buttons: 1, pressure: 0 }), false), '');
});

test('Windows: кнопку пера зажали в воздухе, потом коснулись / подняли — это касание и подъём', () => {
  assert.equal(T.penEdge(pen({ button: 0, buttons: 3, pressure: 0.5 }), false), 'down');
  assert.equal(T.penEdge(pen({ button: 5, buttons: 32, pressure: 0.5 }), false), 'down'); // обратный конец
  assert.equal(T.penEdge(pen({ button: 0, buttons: 2, pressure: 0 }), true), 'up');
});

test('движения без смены кнопки (button = -1) и палец — не трогаем', () => {
  assert.equal(T.penEdge(pen({ button: -1, buttons: 1, pressure: 0.5 }), false), '');
  assert.equal(T.penEdge({ pointerType: 'touch', button: 0, buttons: 1, pressure: 0.5 }, false), '');
});

/* ----- Попадание в предмет ----- */

test('точка на предмете и рядом с ним, с учётом поворота', () => {
  // стилус 176 × 12 в точке (200, 300), лежит ровно
  assert.equal(T.inRect(200, 300, 200, 300, 176, 12, 0, 0), true);
  assert.equal(T.inRect(200, 310, 200, 300, 176, 12, 0, 0), false); // палец на 4 px ниже края
  assert.equal(T.inRect(200, 310, 200, 300, 176, 12, 0, 12), true); // …с допуском пальца — взяли
  assert.equal(T.inRect(200, 330, 200, 300, 176, 12, 0, 12), false); // далеко — рисует по листу
  // повёрнут на 90°: длинная сторона — вертикально
  assert.equal(T.inRect(200, 380, 200, 300, 176, 12, 90, 0), true);
  assert.equal(T.inRect(280, 300, 200, 300, 176, 12, 90, 0), false);
  // −84° (как кладётся по умолчанию)
  assert.equal(T.inRect(200 + Math.cos((-84 * Math.PI) / 180) * 80, 300 + Math.sin((-84 * Math.PI) / 180) * 80, 200, 300, 176, 12, -84, 0), true);
});

test('допуск касания: палец — по пятну, перо — 6 px, мышь — без допуска', () => {
  assert.equal(T.slop({ pointerType: 'touch', width: 1, height: 1 }), 12);
  assert.equal(T.slop({ pointerType: 'touch', width: 40, height: 44 }), 22);
  assert.equal(T.slop({ pointerType: 'touch', width: 200, height: 200 }), 28);
  assert.equal(T.slop({ pointerType: 'pen' }), 6);
  assert.equal(T.slop({ pointerType: 'mouse' }), 0);
});
