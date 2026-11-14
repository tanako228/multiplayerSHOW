// Звук на iPad (app/touch.js: audioCtx): беззвучный режим, касание как «нажатие», пробуждение после блокировки.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const navDesc = Object.getOwnPropertyDescriptor(global, 'navigator');

// Свежая копия touch.js с поддельными window / document / navigator
function load({ session = true, ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', state = 'suspended' } = {}) {
  const ls = {};
  const on = (t, fn) => { (ls[t] = ls[t] || []).push(fn); };
  const ctxs = [];
  class Ctx {
    constructor() { this.state = state; this.resumed = 0; this.played = 0; this.destination = {}; ctxs.push(this); }
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
    createBuffer() { return {}; }
    createBufferSource() { const c = this; return { connect() {}, start() { c.played++; } }; }
  }
  const audios = [];
  global.window = { AudioContext: Ctx, addEventListener: on };
  global.document = { hidden: false, addEventListener: on };
  // в Node 21+ navigator — свой, только для чтения: подменяем свойством
  Object.defineProperty(global, 'navigator', { value: { userAgent: ua, platform: 'iPad', maxTouchPoints: 5, ...(session ? { audioSession: { type: 'auto' } } : {}) }, configurable: true, writable: true });
  global.Audio = class { constructor(src) { this.src = src; this.paused = true; this.attrs = {}; audios.push(this); } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } setAttribute(k, v) { this.attrs[k] = v; } };
  const f = path.join(__dirname, '..', 'app', 'touch.js');
  delete require.cache[require.resolve(f)];
  const T = require(f);
  const fire = (t) => (ls[t] || []).forEach((fn) => fn({}));
  return { T, ctxs, audios, fire, ls };
}
test.afterEach(() => {
  delete global.window; delete global.document; delete global.Audio;
  delete global.navigator;
  if (navDesc) Object.defineProperty(global, 'navigator', navDesc);
});

test('iOS 17+: звук приложения — «воспроизведение», беззвучный режим его не глушит', () => {
  const { T } = load();
  T.audioCtx();
  assert.equal(navigator.audioSession.type, 'playback');
});

test('старый iOS без audioSession: играет тихий silence.wav (inline), чтобы держать «воспроизведение»', () => {
  const { T, audios } = load({ session: false });
  T.audioCtx();
  assert.equal(audios.length, 1);
  assert.equal(audios[0].src, 'silence.wav');
  assert.equal(audios[0].paused, false);
  assert.ok('playsinline' in audios[0].attrs);
});

test('Windows / Android без audioSession: тихий звук не нужен', () => {
  const { T, audios } = load({ session: false, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  navigator.platform = 'Win32'; navigator.maxTouchPoints = 0;
  T.audioCtx();
  assert.equal(audios.length, 0);
});

test('один контекст на пенал и метроном', () => {
  const { T, ctxs } = load();
  assert.equal(T.audioCtx(), T.audioCtx());
  assert.equal(ctxs.length, 1);
});

test('контекст спит (создан в касании пальцем) — просыпается на pointerup / touchend / click', () => {
  const { T, ctxs, fire } = load();
  const ac = T.audioCtx();
  ac.state = 'suspended'; // iOS не принял pointerdown за нажатие
  const before = ac.resumed;
  fire('touchend');
  assert.equal(ac.resumed, before + 1);
  assert.equal(ac.state, 'running');
  assert.ok(ctxs[0].played > 0, 'пустой звук в самом нажатии');
});

test('после блокировки экрана (interrupted) — будится на следующем касании и при возврате в приложение', () => {
  const { T, fire } = load();
  const ac = T.audioCtx();
  ac.state = 'interrupted';
  fire('pointerup');
  assert.equal(ac.state, 'running');
  ac.state = 'interrupted';
  fire('visibilitychange');
  assert.equal(ac.state, 'running');
});

test('слушатели нажатий вешаются один раз', () => {
  const { T, ls } = load();
  T.audioCtx(); T.audioCtx(); T.audioCtx();
  assert.equal(ls.pointerup.length, 1);
});

test('нет Web Audio — null, без ошибок', () => {
  const { T } = load();
  window.AudioContext = undefined;
  // уже загруженный модуль ещё не создавал контекст
  assert.equal(T.audioCtx(), null);
});
