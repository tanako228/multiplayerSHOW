/* ===== Аудиоредактор: вкладка «Редактор ▾ → Аудиоредактор» (tab = 'audio') =====
   Файл открывается копией в памяти. Обрезать, удалить, тишина, появление, затухание, нормализация — правят копию
   (своя отмена: Ctrl+Z / Ctrl+Y, только внутри редактора — lib тут не меняется).
   Скорость, тон и плагины копию не меняют: слышны сразу при прослушивании, вшиваются при сохранении.
   «Сохранить тон» — скорость без изменения высоты: растяжение по времени (WSOLA, aeStretch).
   Сохранение — всегда новый WAV (исходник не трогаем): в media/ или куда скажет пользователь.
   VST-плагины Windows из браузерной части не подключить (нужен отдельный модуль на C++) — плагины встроенные: AE_FX. */

let ae = null;        // открытый файл: { name, path, url, src, sr, ch: Float32Array[], peaks, undo, redo, sel, cur, t0, pps, vz, ver, dirty }
let aeCtx = null;     // AudioContext для прослушивания
let aePlay = null;    // что играет: { node, chain, an, at, from, to, k, loop }
let aeRaf = 0;
let aeTok = 0;        // растяжение по времени отменяется новым
let aeStr = null;     // готовое растяжение: { key, buf }
let aeBusy = '';      // «Обработка 40 %» в строке времени
const AE_KEY = 'cp.audioEditor';
const AE = (() => {   // скорость/тон — у файла; плагины и «Сохранить тон» запоминаются
  let v = {};
  try { v = JSON.parse(localStorage.getItem(AE_KEY) || '{}') || {}; } catch { v = {}; }
  return { speed: 1, semi: 0, keep: v.keep !== false, loop: false, bypass: false, fx: Array.isArray(v.fx) ? v.fx : [] };
})();
const aeSaveCfg = () => { try { localStorage.setItem(AE_KEY, JSON.stringify({ keep: AE.keep, fx: AE.fx })); } catch { /* не страшно */ } };

const aeDb = (d) => Math.pow(10, d / 20);
const aeFmt = (t) => {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};
const aeDur = () => (ae ? ae.ch[0].length / ae.sr : 0);
const aeCtxGet = () => (aeCtx = aeCtx || new AudioContext());

/* ----- Встроенные плагины ----- */
// Параметр: [id, название, мин, макс, по умолчанию, шаг, единица] или { id, name, opts: [[значение, подпись]] }; log — ползунок по логарифму
const AE_FX = {
  gain: {
    name: 'Громкость и панорама', help: 'Тише/громче и влево/вправо',
    p: [['gain', 'Громкость', -24, 24, 0, 0.5, 'дБ'], ['pan', 'Панорама', -100, 100, 0, 1, '']],
    build(c) {
      const g = c.createGain(); const pn = c.createStereoPanner(); g.connect(pn);
      return { input: g, output: pn, set(p) { g.gain.value = aeDb(p.gain); pn.pan.value = p.pan / 100; } };
    },
  },
  eq: {
    name: 'Эквалайзер', help: 'Пять полос: низ, середина, верх',
    p: [['b60', '60 Гц', -15, 15, 0, 0.5, 'дБ'], ['b250', '250 Гц', -15, 15, 0, 0.5, 'дБ'], ['b1k', '1 кГц', -15, 15, 0, 0.5, 'дБ'], ['b4k', '4 кГц', -15, 15, 0, 0.5, 'дБ'], ['b12k', '12 кГц', -15, 15, 0, 0.5, 'дБ']],
    build(c) {
      const bands = [['lowshelf', 60, 'b60'], ['peaking', 250, 'b250'], ['peaking', 1000, 'b1k'], ['peaking', 4000, 'b4k'], ['highshelf', 12000, 'b12k']].map(([type, f, id]) => {
        const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 1; b.id = id; return b;
      });
      bands.reduce((a, b) => (a.connect(b), b));
      return { input: bands[0], output: bands[4], set(p) { bands.forEach((b) => { b.gain.value = p[b.id]; }); } };
    },
  },
  filter: {
    name: 'Фильтр', help: 'Убрать низ (гул) или верх (шипение)',
    p: [{ id: 'type', name: 'Что убрать', opts: [['highpass', 'Низ — ниже частоты'], ['lowpass', 'Верх — выше частоты']], def: 'highpass' }, ['freq', 'Частота', 20, 20000, 120, 1, 'Гц', true], ['q', 'Крутизна', 0.3, 10, 0.7, 0.1, '']],
    build(c) {
      const f = c.createBiquadFilter();
      return { input: f, output: f, set(p) { f.type = p.type; f.frequency.value = p.freq; f.Q.value = p.q; } };
    },
  },
  comp: {
    name: 'Компрессор', help: 'Выравнивает громкость: тихое громче, громкое тише',
    p: [['thr', 'Порог', -60, 0, -24, 1, 'дБ'], ['ratio', 'Сжатие', 1, 20, 4, 0.5, ':1'], ['att', 'Атака', 0, 200, 10, 1, 'мс'], ['rel', 'Отпускание', 10, 1000, 250, 10, 'мс'], ['mk', 'Усиление', 0, 24, 6, 0.5, 'дБ']],
    build(c) {
      const k = c.createDynamicsCompressor(); const g = c.createGain(); k.connect(g); k.knee.value = 6;
      return { input: k, output: g, set(p) { k.threshold.value = p.thr; k.ratio.value = p.ratio; k.attack.value = p.att / 1000; k.release.value = p.rel / 1000; g.gain.value = aeDb(p.mk); } };
    },
  },
  limit: {
    name: 'Лимитер', help: 'Не даёт звуку перегружаться выше потолка',
    p: [['ceil', 'Потолок', -12, 0, -1, 0.5, 'дБ'], ['drive', 'Подъём', 0, 18, 0, 0.5, 'дБ']],
    build(c) {
      const g = c.createGain(); const k = c.createDynamicsCompressor(); g.connect(k);
      k.knee.value = 0; k.ratio.value = 20; k.attack.value = 0.001; k.release.value = 0.06;
      return { input: g, output: k, set(p) { g.gain.value = aeDb(p.drive); k.threshold.value = p.ceil; } };
    },
  },
  delay: {
    name: 'Эхо', help: 'Повторы звука', tail: (p) => (p.time / 1000) * 6,
    p: [['time', 'Задержка', 20, 1500, 350, 5, 'мс'], ['fb', 'Повторы', 0, 90, 35, 1, '%'], ['mix', 'Доля эха', 0, 100, 30, 1, '%']],
    build(c) {
      const inp = c.createGain(); const out = c.createGain(); const dry = c.createGain(); const wet = c.createGain();
      const d = c.createDelay(2); const fb = c.createGain();
      inp.connect(dry).connect(out); inp.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(out);
      return { input: inp, output: out, set(p) { d.delayTime.value = p.time / 1000; fb.gain.value = p.fb / 100; wet.gain.value = p.mix / 100; dry.gain.value = 1 - p.mix / 200; } };
    },
  },
  reverb: {
    name: 'Реверберация', help: 'Звук как в зале', tail: (p) => p.size,
    p: [['size', 'Длина зала', 0.3, 8, 2.2, 0.1, 'с'], ['mix', 'Доля зала', 0, 100, 25, 1, '%'], ['tone', 'Яркость', 0, 100, 60, 1, '%']],
    build(c) {
      const inp = c.createGain(); const out = c.createGain(); const dry = c.createGain(); const wet = c.createGain();
      const cv = c.createConvolver(); const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      inp.connect(dry).connect(out); inp.connect(cv); cv.connect(lp).connect(wet).connect(out);
      let size = 0;
      return {
        input: inp, output: out,
        set(p) {
          if (p.size !== size) { size = p.size; cv.buffer = aeImpulse(c, size); }
          wet.gain.value = p.mix / 100; dry.gain.value = 1 - p.mix / 200;
          lp.frequency.value = 1500 + (p.tone / 100) * 16000;
        },
      };
    },
  },
};

// Отклик зала: шум с затуханием (одинаковый при каждом построении — сохранённое звучит как прослушанное)
function aeImpulse(c, sec) {
  const n = Math.max(1, Math.round(sec * c.sampleRate));
  const b = c.createBuffer(2, n, c.sampleRate);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = rnd() * Math.pow(1 - i / n, 3);
  }
  return b;
}

const aeParams = (type) => AE_FX[type].p.map((x) => (Array.isArray(x) ? { id: x[0], name: x[1], min: x[2], max: x[3], def: x[4], step: x[5], unit: x[6], log: !!x[7] } : x));
function aeFxNew(type) {
  const p = {};
  aeParams(type).forEach((x) => { p[x.id] = x.def; });
  return { id: newId(), type, on: true, p };
}

// Цепочка плагинов: вход → плагины по порядку → выход
function aeChain(c) {
  const input = c.createGain();
  const output = c.createGain();
  const nodes = [];
  let last = input;
  if (!AE.bypass) {
    for (const f of AE.fx) {
      if (!f.on || !AE_FX[f.type]) continue;
      const n = AE_FX[f.type].build(c);
      n.set({ ...aeFxNew(f.type).p, ...f.p });
      last.connect(n.input);
      last = n.output;
      nodes.push({ f, n });
    }
  }
  last.connect(output);
  return { input, output, nodes };
}
// «Хвост» эха и зала — дописывается в конец сохранённого файла
const aeTail = () => (AE.bypass ? 0 : AE.fx.reduce((t, f) => t + (f.on && AE_FX[f.type] && AE_FX[f.type].tail ? AE_FX[f.type].tail(f.p) : 0), 0));

/* ----- Скорость и тон ----- */
// T — растяжение по времени (без изменения тона), rate — скорость проигрывания (меняет тон). T·rate — итоговая скорость
function aeRates() {
  const r = Math.pow(2, AE.semi / 12);
  return AE.keep ? { T: AE.speed / r, rate: r } : { T: 1, rate: AE.speed * r };
}

// Растяжение по времени без изменения тона (WSOLA): кусочки по ~46 мс накладываются с поиском самого похожего места
async function aeStretch(ch, T, sr, tok, prog) {
  const len = ch[0].length;
  if (Math.abs(T - 1) < 1e-4 || len < 8192) return ch;
  const N = sr > 50000 ? 4096 : 2048;
  const Hs = N / 2;
  const Ha = Hs * T;
  const tol = N / 8;
  const D = 4;                 // поиск — по прореженному моно-сигналу, потом уточнение по точному
  const L = Hs;
  const outLen = Math.ceil(len / T) + N;
  const out = ch.map(() => new Float32Array(outLen));
  const wsum = new Float32Array(outLen);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const mlen = Math.floor(len / D);
  const m = new Float32Array(mlen);
  for (let i = 0; i < mlen; i++) {
    let s = 0;
    for (const c of ch) for (let j = 0; j < D; j++) s += c[i * D + j];
    m[i] = s;
  }
  const c0 = ch[0];
  const td = tol / D;
  const ld = L / D;
  let prev = 0;
  for (let k = 0; ; k++) {
    const nom = Math.round(k * Ha);
    if (nom >= len) break;
    let pos = nom;
    const tgt = prev + Hs; // где продолжилась бы предыдущая порция — ищем похожее место рядом с nom
    if (k > 0 && tgt + L < len) {
      const tq = Math.floor(tgt / D);
      let best = -Infinity; let bd = 0;
      for (let d = -td; d <= td; d++) {
        const q = Math.floor(nom / D) + d;
        if (q < 0 || q + ld >= mlen) continue;
        let s = 0; let e = 1e-9;
        for (let j = 0; j < ld; j++) { const v = m[q + j]; s += v * m[tq + j]; e += v * v; }
        s /= Math.sqrt(e);
        if (s > best) { best = s; bd = d; }
      }
      let p0 = Math.floor(nom / D) * D + bd * D;
      // уточнение по точному сигналу ±D
      let bf = -Infinity; let bp = p0;
      for (let d = -D; d <= D; d++) {
        const q = p0 + d;
        if (q < 0 || q + 256 >= len) continue;
        let s = 0; let e = 1e-9;
        for (let j = 0; j < 256; j++) { const v = c0[q + j]; s += v * c0[tgt + j]; e += v * v; }
        s /= Math.sqrt(e);
        if (s > bf) { bf = s; bp = q; }
      }
      pos = Math.max(0, bp);
    }
    const o0 = k * Hs;
    if (o0 >= outLen) break;
    for (let c = 0; c < ch.length; c++) {
      const src = ch[c]; const dst = out[c];
      for (let i = 0; i < N; i++) {
        const idx = pos + i; const o = o0 + i;
        if (idx >= len || o >= outLen) break;
        dst[o] += src[idx] * win[i];
      }
    }
    for (let i = 0; i < N && o0 + i < outLen && pos + i < len; i++) wsum[o0 + i] += win[i];
    prev = pos;
    if (k % 200 === 0) {
      prog(nom / len);
      await new Promise((r) => setTimeout(r, 0));
      if (tok !== aeTok) return null;
    }
  }
  const n = Math.min(outLen, Math.round(len / T));
  for (let c = 0; c < out.length; c++) {
    const d = out[c];
    for (let i = 0; i < n; i++) if (wsum[i] > 1e-3) d[i] /= wsum[i];
    out[c] = d.subarray(0, n).slice();
  }
  return out;
}

// Растянутая копия для прослушивания (кэш: тот же файл и та же скорость — без пересчёта)
async function aeStretched() {
  const { T } = aeRates();
  const key = ae.ver + ':' + T.toFixed(4);
  if (aeStr && aeStr.key === key) return aeStr.buf;
  const tok = ++aeTok;
  const ch = await aeStretch(ae.ch, T, ae.sr, tok, (x) => { aeBusy = `Обработка ${Math.round(x * 100)} %`; aeTime(); });
  aeBusy = '';
  if (!ch || tok !== aeTok) return null;
  const c = aeCtxGet();
  const buf = c.createBuffer(ch.length, ch[0].length, ae.sr);
  ch.forEach((d, i) => buf.copyToChannel(d, i));
  aeStr = { key, buf };
  aeTime();
  return buf;
}

/* ----- Открыть файл ----- */

function openAudioTab() { setTab('audio'); }
function aeTabOpen() { aeRenderSide(); requestAnimationFrame(aeDraw); }
function aeTabClose() { aeStop(); }

// file: { name, path, url }; src — откуда открыли: { kind: 'item', itemId, slideId } | { kind: 'music', list } | { kind: 'file' }
async function openAudioEditor(file, src) {
  if (!file || !file.path) { showNotice('У этой музыки нет файла на диске', true); return; }
  if (ae && ae.dirty && ae.path !== file.path && !(await askYes(`Открыть другой файл без сохранения? В «${ae.name}» есть несохранённые правки.`, 'Открыть без сохранения', true))) { setTab('audio'); return; }
  setTab('audio');
  if (ae && ae.path === file.path && !ae.dirty) { ae.src = src || ae.src; return; }
  await aeLoad(file, src || { kind: 'file' });
}

async function aeLoad(file, src) {
  aeStop();
  showNotice('Открываю аудио: ' + file.name, false, true);
  let ab = null;
  try {
    const bytes = await window.api.audioRead(file.path);
    if (bytes) ab = await aeCtxGet().decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch { ab = null; }
  showNotice('');
  if (!ab) { showNotice('Не удалось открыть аудио: ' + file.name, true); return false; }
  const ch = [];
  for (let i = 0; i < Math.min(2, ab.numberOfChannels); i++) ch.push(ab.getChannelData(i).slice());
  ae = { name: String(file.name || 'Аудио').replace(/\.[^.]+$/, ''), path: file.path, url: file.url, src, sr: ab.sampleRate, ch, undo: [], redo: [], sel: null, cur: 0, t0: 0, pps: 100, vz: 1, ver: 1, dirty: false };
  AE.speed = 1; AE.semi = 0;
  aeStr = null;
  aePeaks();
  aeRenderSide();
  aeFit(true);
  return true;
}

$('aeOpen').addEventListener('click', async () => {
  const [f] = await window.api.pickFile({ kinds: ['audio'], title: 'Открыть аудио' });
  if (f) openAudioEditor(f, { kind: 'file' });
});

/* ----- Волна: пики по 256 сэмплов на канал ----- */
const AE_BIN = 256;
function aePeaks() {
  ae.peaks = ae.ch.map((d) => {
    const n = Math.ceil(d.length / AE_BIN);
    const mn = new Float32Array(n); const mx = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      let lo = 0; let hi = 0;
      const e = Math.min(d.length, (b + 1) * AE_BIN);
      for (let i = b * AE_BIN; i < e; i++) { const v = d[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
      mn[b] = lo; mx[b] = hi;
    }
    return { mn, mx };
  });
}

const aeW = () => $('aeWrap').clientWidth || 1;
const aeMinPps = () => aeW() / Math.max(0.05, aeDur());
const aeMaxPps = () => (ae ? ae.sr / 2 : 1000);
const AE_DEEP = 20; // Ctrl+Alt+Shift: сжать ещё в 20 раз сильнее «Весь файл»
function aeClampView() {
  if (!ae) return;
  ae.pps = Math.max(aeMinPps() / AE_DEEP, Math.min(aeMaxPps(), ae.pps));
  ae.t0 = Math.max(0, Math.min(aeDur() - aeW() / ae.pps, ae.t0));
}
function aeFit(redraw = true) {
  if (!ae) return;
  ae.pps = aeMinPps();
  ae.t0 = 0;
  if (redraw) aeDraw();
}
// deep — без обычного предела «Весь файл» (Ctrl+Alt+Shift + колёсико)
function aeZoom(f, at, deep) {
  if (!ae) return;
  const x = at == null ? aeW() / 2 : at;
  const t = ae.t0 + x / ae.pps;
  const p = ae.pps;
  ae.pps *= f;
  if (!deep && f < 1) ae.pps = Math.max(ae.pps, Math.min(p, aeMinPps()));
  aeClampView();
  ae.t0 = t - x / ae.pps;
  aeClampView();
  aeDraw();
}
function aeVZoom(f, deep) {
  if (!ae) return;
  const v = ae.vz * f;
  ae.vz = Math.min(16, deep ? Math.max(0.05, v) : Math.max(Math.min(ae.vz, 1), v));
  aeDraw();
}

const aeCss = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';
const AE_RULER = 22;

function aeDraw() {
  const wrap = $('aeWrap');
  const cv = $('aeCanvas');
  if ($('audioView').hidden) return;
  const W = wrap.clientWidth; const H = wrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  $('aeEmpty').hidden = !!ae;
  aeTime();
  aeScrollSync();
  if (!ae) return;
  aeClampView();
  const line = aeCss('--line'); const muted = aeCss('--muted'); const live = aeCss('--live'); const text = aeCss('--text');
  // Линейка времени
  g.fillStyle = aeCss('--panel');
  g.fillRect(0, 0, W, AE_RULER);
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200];
  const step = steps.find((s) => s * ae.pps >= 80) || 7200;
  g.font = '11px "Segoe UI", sans-serif';
  g.textBaseline = 'middle';
  for (let t = Math.floor(ae.t0 / step) * step; t < ae.t0 + W / ae.pps; t += step) {
    const x = Math.round((t - ae.t0) * ae.pps) + 0.5;
    g.fillStyle = line; g.fillRect(x, 12, 1, AE_RULER - 12);
    g.fillStyle = muted;
    const m = Math.floor(t / 60); const s = t - m * 60;
    g.fillText(`${m}:${s < 10 ? '0' : ''}${s.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}`, x + 3, 8);
    for (let j = 1; j < 5; j++) { const xx = Math.round((t + (step * j) / 5 - ae.t0) * ae.pps) + 0.5; g.fillStyle = line; g.fillRect(xx, 17, 1, AE_RULER - 17); }
  }
  // Выделение
  if (ae.sel) {
    const a = (ae.sel.a - ae.t0) * ae.pps; const b = (ae.sel.b - ae.t0) * ae.pps;
    g.fillStyle = live; g.globalAlpha = 0.2; g.fillRect(a, AE_RULER, b - a, H - AE_RULER); g.globalAlpha = 1;
    g.fillStyle = live; g.fillRect(Math.round(a), 0, 1, H); g.fillRect(Math.round(b), 0, 1, H);
  }
  // Каналы
  const nch = ae.ch.length;
  const lane = (H - AE_RULER) / nch;
  const spp = ae.sr / ae.pps; // сэмплов на пиксель
  for (let c = 0; c < nch; c++) {
    const mid = AE_RULER + lane * c + lane / 2;
    const half = (lane / 2 - 3) * ae.vz;
    const top = AE_RULER + lane * c;
    g.fillStyle = line; g.fillRect(0, Math.round(mid), W, 1);
    if (c) g.fillRect(0, Math.round(top), W, 1);
    g.save();
    g.beginPath(); g.rect(0, top, W, lane); g.clip();
    g.fillStyle = text; g.globalAlpha = 0.85;
    const d = ae.ch[c]; const pk = ae.peaks[c];
    if (spp < 1.5) {
      // Близко — линия по сэмплам
      g.strokeStyle = text; g.lineWidth = 1.2; g.beginPath();
      const s0 = Math.max(0, Math.floor(ae.t0 * ae.sr)); const s1 = Math.min(d.length - 1, Math.ceil((ae.t0 + W / ae.pps) * ae.sr));
      for (let i = s0; i <= s1; i++) { const x = (i / ae.sr - ae.t0) * ae.pps; const y = mid - d[i] * half; if (i === s0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    } else {
      for (let x = 0; x < W; x++) {
        const s0 = Math.floor((ae.t0 + x / ae.pps) * ae.sr);
        const s1 = Math.min(d.length, Math.floor((ae.t0 + (x + 1) / ae.pps) * ae.sr));
        if (s0 >= d.length) break;
        let lo = 0; let hi = 0;
        if (s1 - s0 >= AE_BIN) {
          for (let b = Math.floor(s0 / AE_BIN), e = Math.min(pk.mn.length, Math.ceil(s1 / AE_BIN)); b < e; b++) { if (pk.mn[b] < lo) lo = pk.mn[b]; if (pk.mx[b] > hi) hi = pk.mx[b]; }
        } else {
          for (let i = s0; i < Math.max(s1, s0 + 1); i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        }
        const y1 = mid - hi * half; const y2 = mid - lo * half;
        g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
      }
    }
    g.restore();
  }
  // Сжато сильнее «Весь файл» — после конца файла пустое место, граница линией
  const ex = Math.round((aeDur() - ae.t0) * ae.pps);
  if (ex < W) { g.fillStyle = line; g.fillRect(ex, AE_RULER, 1, H - AE_RULER); }
  // Курсор и играющее место
  const cx = Math.round((ae.cur - ae.t0) * ae.pps) + 0.5;
  g.fillStyle = muted; g.fillRect(cx - 0.5, 0, 1, H);
  if (aePlay) {
    const px = Math.round((aeNow() - ae.t0) * ae.pps);
    g.fillStyle = aeCss('--warn'); g.fillRect(px - 1, 0, 2, H);
  }
}

function aeTime() {
  const t = ae ? (aePlay ? aeNow() : ae.cur) : 0;
  const { T, rate } = aeRates();
  const sp = T * rate;
  const outLen = ae ? aeDur() / sp : 0;
  $('aeTime').textContent = aeBusy || (ae ? `${aeFmt(t)} / ${aeFmt(aeDur())}` : '0:00.0 / 0:00.0');
  $('aeSelInfo').textContent = ae && ae.sel ? `Выделено: ${aeFmt(ae.sel.a)} – ${aeFmt(ae.sel.b)} (${aeFmt(ae.sel.b - ae.sel.a)})` : '';
  $('aeLen').textContent = ae ? (Math.abs(sp - 1) > 1e-3 ? `Длина: ${aeFmt(aeDur())} → ${aeFmt(outLen)}` : `Длина: ${aeFmt(aeDur())}`) : '';
}

// Полоса прокрутки под волной
function aeScrollSync() {
  const r = $('aeScroll');
  if (!ae) { r.disabled = true; return; }
  const span = Math.max(0, aeDur() - aeW() / ae.pps);
  r.disabled = span <= 0;
  r.value = span > 0 ? Math.round((ae.t0 / span) * 1000) : 0;
}
$('aeScroll').addEventListener('input', (e) => {
  if (!ae) return;
  ae.t0 = (Number(e.target.value) / 1000) * Math.max(0, aeDur() - aeW() / ae.pps);
  aeDraw();
});

/* ----- Мышь по волне: тянуть — выделить, щелчок — курсор, края выделения — двигать ----- */
const aeTimeAt = (x) => Math.max(0, Math.min(aeDur(), ae.t0 + x / ae.pps));
$('aeCanvas').addEventListener('pointerdown', (e) => {
  if (!ae || e.button !== 0) return;
  const cv = e.currentTarget;
  const rx = () => e.clientX - cv.getBoundingClientRect().left;
  const x0 = rx();
  const t0 = aeTimeAt(x0);
  let anchor = t0;
  let moved = false;
  if (ae.sel && !e.shiftKey) {
    const a = (ae.sel.a - ae.t0) * ae.pps; const b = (ae.sel.b - ae.t0) * ae.pps;
    if (Math.abs(x0 - a) < 6) { anchor = ae.sel.b; moved = true; } else if (Math.abs(x0 - b) < 6) { anchor = ae.sel.a; moved = true; }
  }
  if (e.shiftKey) { anchor = ae.sel ? (Math.abs(t0 - ae.sel.a) < Math.abs(t0 - ae.sel.b) ? ae.sel.b : ae.sel.a) : ae.cur; moved = true; }
  cv.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const x = ev.clientX - cv.getBoundingClientRect().left;
    if (!moved && Math.abs(x - x0) < 3) return;
    moved = true;
    // у края — прокрутка
    if (x > aeW() - 10) ae.t0 += 20 / ae.pps; else if (x < 10) ae.t0 -= 20 / ae.pps;
    aeClampView();
    const t = aeTimeAt(x);
    ae.sel = { a: Math.min(anchor, t), b: Math.max(anchor, t) };
    aeDraw();
  };
  const up = (ev) => {
    cv.removeEventListener('pointermove', move);
    cv.removeEventListener('pointerup', up);
    if (!moved) {
      ae.sel = null;
      ae.cur = t0;
      if (aePlay) aePlayFrom(t0);
    } else if (ae.sel && ae.sel.b - ae.sel.a < 0.005) ae.sel = null;
    else if (ae.sel) ae.cur = ae.sel.a;
    aeDraw();
    void ev;
  };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
});
$('aeCanvas').addEventListener('dblclick', () => { if (ae) { ae.sel = { a: 0, b: aeDur() }; aeDraw(); } });
$('aeCanvas').addEventListener('pointermove', (e) => {
  if (!ae || !ae.sel || e.buttons) return;
  const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
  const a = (ae.sel.a - ae.t0) * ae.pps; const b = (ae.sel.b - ae.t0) * ae.pps;
  e.currentTarget.style.cursor = Math.abs(x - a) < 6 || Math.abs(x - b) < 6 ? 'ew-resize' : 'text';
});
// Колёсико — прокрутка; Ctrl — масштаб по времени; Alt — высота волны;
// Ctrl+Alt+Shift — длина и высота вместе, сжимается сильнее обычного
$('aeWrap').addEventListener('wheel', (e) => {
  if (!ae) return;
  e.preventDefault();
  const x = e.clientX - $('aeWrap').getBoundingClientRect().left;
  const dy = e.deltaY || e.deltaX; // Shift в Windows превращает колёсико в горизонтальное
  if (e.ctrlKey && e.altKey && e.shiftKey) { const f = dy < 0 ? 1.25 : 0.8; aeZoom(f, x, true); aeVZoom(f, true); }
  else if (e.ctrlKey) aeZoom(e.deltaY < 0 ? 1.25 : 0.8, x);
  else if (e.altKey) aeVZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  else { ae.t0 += ((e.deltaX || e.deltaY) / ae.pps) * 0.8; aeClampView(); aeDraw(); }
}, { passive: false });
new ResizeObserver(() => { if (!$('audioView').hidden) aeDraw(); }).observe($('aeWrap'));

/* ----- Прослушивание ----- */

function aeNow() {
  if (!aePlay) return ae ? ae.cur : 0;
  let t = aePlay.from + (aeCtx.currentTime - aePlay.at) * aePlay.k;
  if (aePlay.loop) { const { a, b } = aePlay.loop; if (t > b) t = a + ((t - a) % (b - a)); }
  return Math.min(t, aeDur());
}

async function aePlayFrom(from) {
  if (!ae) return;
  const keepLoop = AE.loop && ae.sel;
  aeStop(true);
  const c = aeCtxGet();
  if (c.state === 'suspended') await c.resume();
  const pt = aePlayTok;
  const buf = await aeStretched();
  if (!buf || !ae || pt !== aePlayTok) return; // пока считали — нажали «Стоп» или выбрали другое место
  const { T, rate } = aeRates();
  const to = ae.sel && from < ae.sel.b && from >= ae.sel.a - 1e-6 ? ae.sel.b : aeDur();
  const node = c.createBufferSource();
  node.buffer = buf;
  node.playbackRate.value = rate;
  const chain = aeChain(c);
  const an = c.createAnalyser(); an.fftSize = 1024;
  node.connect(chain.input); chain.output.connect(an); an.connect(c.destination);
  const loop = keepLoop ? { a: ae.sel.a, b: ae.sel.b } : null;
  if (loop) { node.loop = true; node.loopStart = loop.a / T; node.loopEnd = loop.b / T; }
  const at = c.currentTime + 0.03;
  if (loop) node.start(at, from / T); else node.start(at, from / T, (to - from) / T);
  aePlay = { node, chain, an, at, from, to, k: T * rate, loop };
  node.onended = () => { if (aePlay && aePlay.node === node) { aeStop(); } };
  aeUiPlay();
  aeTick();
}
let aePlayTok = 0;
function aeStop(silent) {
  aePlayTok += 1;
  if (aePlay) {
    const p = aePlay;
    aePlay = null;
    try { p.node.onended = null; p.node.stop(); } catch { /* уже остановлен */ }
    setTimeout(() => { try { p.chain.output.disconnect(); p.an.disconnect(); } catch { /* ок */ } }, 50);
  }
  cancelAnimationFrame(aeRaf);
  if (!silent) { aeUiPlay(); aeDraw(); aeMeter(0); }
}
function aeToggle() {
  if (!ae) return;
  if (aePlay) { aeStop(); return; }
  aePlayFrom(ae.sel && (ae.cur < ae.sel.a || ae.cur >= ae.sel.b) ? ae.sel.a : ae.cur);
}
// Изменилась скорость, тон или цепочка — если играет, продолжаем с того же места
let aeReTimer = 0;
function aeReplay() {
  aeTime();
  if (!aePlay) return;
  clearTimeout(aeReTimer);
  aeReTimer = setTimeout(() => { if (aePlay) aePlayFrom(aeNow()); }, 200);
}
function aeTick() {
  cancelAnimationFrame(aeRaf);
  if (!aePlay) return;
  const t = aeNow();
  // играющее место ушло за край — листаем
  const W = aeW();
  if (t > ae.t0 + W / ae.pps || t < ae.t0) { ae.t0 = t - (W / ae.pps) * 0.1; aeClampView(); }
  const d = new Float32Array(aePlay.an.fftSize);
  aePlay.an.getFloatTimeDomainData(d);
  let pk = 0; for (const v of d) { const a = Math.abs(v); if (a > pk) pk = a; }
  aeMeter(pk);
  aeDraw();
  aeRaf = requestAnimationFrame(aeTick);
}
// Уровень: полоса справа в строке кнопок; красная — перегруз
function aeMeter(pk) {
  const db = pk > 0 ? 20 * Math.log10(pk) : -60;
  const w = Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
  const bar = $('aeMeterBar');
  bar.style.width = w + '%';
  bar.classList.toggle('over', pk >= 0.99);
}
function aeUiPlay() {
  const b = $('aePlay');
  b.dataset.icon = aePlay ? 'pause' : 'show';
  b.replaceChildren(Icons.el(b.dataset.icon));
  b.title = (aePlay ? 'Пауза' : 'Слушать') + ' (Пробел)';
}
$('aePlay').addEventListener('click', aeToggle);
$('aeStopBtn').addEventListener('click', () => { aeStop(); if (ae) { ae.cur = ae.sel ? ae.sel.a : 0; aeDraw(); } });
$('aeLoop').addEventListener('click', () => {
  AE.loop = !AE.loop;
  $('aeLoop').setAttribute('aria-pressed', String(AE.loop));
  if (aePlay) aePlayFrom(aeNow());
});
$('aeBypass').addEventListener('click', () => {
  AE.bypass = !AE.bypass;
  $('aeBypass').setAttribute('aria-pressed', String(AE.bypass));
  aeReplay();
});

/* ----- Правки копии (с отменой внутри редактора) ----- */

function aeEdit(fn, label) {
  if (!ae) return false;
  const before = ae.ch;
  const r = fn(ae.ch);
  if (!r) return false;
  ae.undo.push({ ch: before, label });
  if (ae.undo.length > 8) ae.undo.shift();
  ae.redo = [];
  ae.ch = r;
  aeChanged();
  flashStatus(label + ' · Ctrl+Z — вернуть');
  return true;
}
function aeChanged() {
  aeStop(true);
  ae.ver += 1;
  ae.dirty = true;
  aeStr = null;
  aePeaks();
  ae.cur = Math.min(ae.cur, aeDur());
  if (ae.sel) { ae.sel.b = Math.min(ae.sel.b, aeDur()); if (ae.sel.b - ae.sel.a < 0.005) ae.sel = null; }
  aeClampView();
  aeUiPlay();
  aeRenderSide();
  aeDraw();
}
function aeUndo(redo) {
  if (!ae) return;
  const from = redo ? ae.redo : ae.undo;
  const to = redo ? ae.undo : ae.redo;
  const x = from.pop();
  if (!x) { flashStatus(redo ? 'Нечего возвращать' : 'Нечего отменять'); return; }
  to.push({ ch: ae.ch, label: x.label });
  ae.ch = x.ch;
  aeChanged();
  flashStatus((redo ? 'Вернул: ' : 'Отменил: ') + x.label);
}
const aeRange = () => (ae && ae.sel ? [Math.round(ae.sel.a * ae.sr), Math.round(ae.sel.b * ae.sr)] : null);
const aeNeedSel = () => { if (ae && ae.sel) return aeRange(); flashStatus('Сначала выделите участок на волне (тяните мышью)'); return null; };

function aeCrop() {
  const r = aeNeedSel(); if (!r) return;
  if (aeEdit((ch) => ch.map((d) => d.slice(r[0], r[1])), 'Обрезано по выделению')) { ae.sel = null; ae.cur = 0; aeFit(); }
}
function aeDelete() {
  const r = aeNeedSel(); if (!r) return;
  if (r[1] - r[0] >= ae.ch[0].length - 1) { flashStatus('Нельзя удалить всё — оставьте хоть кусочек'); return; }
  if (aeEdit((ch) => ch.map((d) => { const o = new Float32Array(d.length - (r[1] - r[0])); o.set(d.subarray(0, r[0])); o.set(d.subarray(r[1]), r[0]); return o; }), 'Участок удалён')) {
    ae.cur = r[0] / ae.sr; ae.sel = null; aeDraw();
  }
}
function aeSilence() {
  const r = aeNeedSel(); if (!r) return;
  aeEdit((ch) => ch.map((d) => { const o = d.slice(); o.fill(0, r[0], r[1]); return o; }), 'Тишина на участке');
}
function aeFade(out) {
  const r = aeNeedSel(); if (!r) return;
  const n = r[1] - r[0];
  aeEdit((ch) => ch.map((d) => {
    const o = d.slice();
    for (let i = 0; i < n; i++) { const x = i / n; const k = out ? 1 - x : x; o[r[0] + i] *= k * k * (3 - 2 * k); }
    return o;
  }), out ? 'Затухание' : 'Плавное появление');
}
// Нормализация: самый громкий пик → −1 дБ (выделение или весь файл)
function aeNormalize() {
  if (!ae) return;
  const [s0, s1] = aeRange() || [0, ae.ch[0].length];
  let pk = 0;
  for (const d of ae.ch) for (let i = s0; i < s1; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
  if (pk < 1e-5) { flashStatus('Тут тишина — нечего усиливать'); return; }
  const k = aeDb(-1) / pk;
  aeEdit((ch) => ch.map((d) => { const o = d.slice(); for (let i = s0; i < s1; i++) o[i] *= k; return o; }), `Нормализация (${k >= 1 ? '+' : ''}${(20 * Math.log10(k)).toFixed(1)} дБ)`);
}
$('aeCrop').addEventListener('click', aeCrop);
$('aeDel').addEventListener('click', aeDelete);
$('aeSil').addEventListener('click', aeSilence);
$('aeFadeIn').addEventListener('click', () => aeFade(false));
$('aeFadeOut').addEventListener('click', () => aeFade(true));
$('aeNorm').addEventListener('click', aeNormalize);
$('aeUndo').addEventListener('click', () => aeUndo(false));
$('aeRedo').addEventListener('click', () => aeUndo(true));
$('aeZoomIn').addEventListener('click', () => aeZoom(1.6));
$('aeZoomOut').addEventListener('click', () => aeZoom(1 / 1.6));
$('aeZoomFit').addEventListener('click', () => aeFit());
$('aeZoomSel').addEventListener('click', () => {
  if (!ae || !ae.sel) { flashStatus('Сначала выделите участок'); return; }
  ae.pps = aeW() / Math.max(0.01, ae.sel.b - ae.sel.a) * 0.92; aeClampView();
  ae.t0 = ae.sel.a - (aeW() / ae.pps) * 0.04; aeClampView(); aeDraw();
});
$('aeVIn').addEventListener('click', () => aeVZoom(1.4));
$('aeVOut').addEventListener('click', () => aeVZoom(1 / 1.4));

// Клавиши на вкладке (зовёт общий обработчик в renderer.js); true — нажатие наше
function aeKey(e) {
  if (!ae) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.code === 'Space' && !ctrl) { aeToggle(); return true; }
  if (ctrl && e.code === 'KeyZ') { aeUndo(e.shiftKey); return true; }
  if (ctrl && e.code === 'KeyY') { aeUndo(true); return true; }
  if (ctrl && e.code === 'KeyA') { ae.sel = { a: 0, b: aeDur() }; aeDraw(); return true; }
  if (ctrl && e.code === 'KeyS') { aeSave(e.shiftKey ? 'copy' : 'save'); return true; }
  if (!ctrl && (e.code === 'Delete' || e.code === 'Backspace')) { aeDelete(); return true; }
  if (!ctrl && e.code === 'Escape' && ae.sel) { ae.sel = null; aeDraw(); return true; }
  if (!ctrl && e.code === 'Home') { ae.cur = 0; ae.t0 = 0; if (aePlay) aePlayFrom(0); aeDraw(); return true; }
  if (!ctrl && e.code === 'End') { ae.cur = aeDur(); aeStop(); return true; }
  if (ctrl && (e.code === 'Equal' || e.code === 'NumpadAdd')) { aeZoom(1.6); return true; }
  if (ctrl && (e.code === 'Minus' || e.code === 'NumpadSubtract')) { aeZoom(1 / 1.6); return true; }
  return false;
}

/* ----- Левая колонка: файл, скорость и тон, плагины ----- */

function aeRenderSide() {
  $('aeName').textContent = ae ? ae.name + (ae.dirty ? ' •' : '') : 'Файл не открыт';
  $('aeName').title = ae ? ae.path : '';
  $('aeInfo').textContent = ae ? `${ae.ch.length === 1 ? 'Моно' : 'Стерео'} · ${(ae.sr / 1000).toFixed(1)} кГц · ${aeFmt(aeDur())}` : 'Правая кнопка на музыке → «Открыть в аудиоредакторе», или «Открыть файл…»';
  const from = ae && ae.src && ae.src.kind;
  $('aeSave').title = from === 'item' ? 'Сохранить: новый файл в папку программы, презентация в библиотеке будет играть его (исходник не меняется). Ctrl+S'
    : from === 'music' ? 'Сохранить: новый файл в папку программы, плейлист музыки будет играть его (исходник не меняется). Ctrl+S'
      : 'Сохранить новым файлом — выберите, куда (исходник не меняется). Ctrl+S';
  ['aeSave', 'aeCopy', 'aeExport'].forEach((id) => { $(id).disabled = !ae; });
  $('aeUndo').disabled = !ae || !ae.undo.length;
  $('aeRedo').disabled = !ae || !ae.redo.length;
  $('aeSpeed').value = Math.round(AE.speed * 100);
  $('aeSpeedV').textContent = Math.round(AE.speed * 100) + ' %';
  $('aeSemi').value = AE.semi;
  $('aeSemiV').textContent = (AE.semi > 0 ? '+' : '') + AE.semi + ' пт';
  $('aeKeep').checked = AE.keep;
  $('aeLoop').setAttribute('aria-pressed', String(AE.loop));
  $('aeBypass').setAttribute('aria-pressed', String(AE.bypass));
  aeRenderFx();
  aeTime();
}

$('aeSpeed').addEventListener('input', (e) => { AE.speed = Number(e.target.value) / 100; $('aeSpeedV').textContent = e.target.value + ' %'; aeReplay(); });
$('aeSemi').addEventListener('input', (e) => { AE.semi = Number(e.target.value); $('aeSemiV').textContent = (AE.semi > 0 ? '+' : '') + AE.semi + ' пт'; aeReplay(); });
$('aeKeep').addEventListener('change', (e) => { AE.keep = e.target.checked; aeSaveCfg(); aeReplay(); });
document.querySelectorAll('#audioView [data-speed]').forEach((b) => b.addEventListener('click', () => {
  AE.speed = Number(b.dataset.speed); aeRenderSide(); aeReplay();
}));

// Плагины: карточка — вкл/выкл, вверх/вниз, убрать, ползунки
function aeRenderFx() {
  const box = $('aeFx');
  box.replaceChildren();
  if (!AE.fx.length) {
    box.append(Object.assign(document.createElement('div'), { className: 'ae-note', textContent: 'Плагинов нет. «＋» — добавить эквалайзер, компрессор, зал, эхо…' }));
    return;
  }
  AE.fx.forEach((f, i) => {
    const def = AE_FX[f.type];
    if (!def) return;
    const card = Object.assign(document.createElement('div'), { className: 'ae-plug' + (f.on ? '' : ' off') });
    const head = Object.assign(document.createElement('div'), { className: 'ae-plug-h' });
    const on = Object.assign(document.createElement('input'), { type: 'checkbox', checked: f.on, title: 'Включить / выключить плагин' });
    on.addEventListener('change', () => { f.on = on.checked; aeSaveCfg(); aeRenderFx(); aeReplay(); });
    const name = Object.assign(document.createElement('b'), { textContent: def.name, title: def.help });
    const btn = (icon, title, fn, dis) => { const b = Object.assign(document.createElement('button'), { className: 'icon-only', title, disabled: !!dis }); b.dataset.icon = icon; b.append(Icons.el(icon)); b.addEventListener('click', fn); return b; };
    const move = (d) => { const [x] = AE.fx.splice(i, 1); AE.fx.splice(i + d, 0, x); aeSaveCfg(); aeRenderFx(); aeReplay(); };
    head.append(on, name,
      btn('up', 'Выше в цепочке', () => move(-1), i === 0),
      btn('down', 'Ниже в цепочке', () => move(1), i === AE.fx.length - 1),
      btn('close', 'Убрать плагин', () => { AE.fx.splice(i, 1); aeSaveCfg(); aeRenderFx(); aeReplay(); flashStatus(`Плагин «${def.name}» убран`); }));
    card.append(head);
    for (const x of aeParams(f.type)) {
      const row = Object.assign(document.createElement('label'), { className: 'ae-prm' });
      row.append(Object.assign(document.createElement('span'), { textContent: x.name }));
      if (f.p[x.id] == null) f.p[x.id] = x.def;
      if (x.opts) {
        const s = document.createElement('select');
        x.opts.forEach(([v, t]) => s.append(new Option(t, v, false, f.p[x.id] === v)));
        s.addEventListener('change', () => { f.p[x.id] = s.value; aeFxLive(f); });
        row.append(s);
      } else {
        const r = Object.assign(document.createElement('input'), { type: 'range' });
        const val = Object.assign(document.createElement('em'));
        const toPos = (v) => (x.log ? Math.round((Math.log(v / x.min) / Math.log(x.max / x.min)) * 1000) : v);
        const fromPos = (p) => (x.log ? Math.round(x.min * Math.pow(x.max / x.min, p / 1000)) : p);
        if (x.log) { r.min = 0; r.max = 1000; r.step = 1; } else { r.min = x.min; r.max = x.max; r.step = x.step; }
        r.value = toPos(f.p[x.id]);
        r.dataset.def = toPos(x.def);
        const show = () => { const v = f.p[x.id]; val.textContent = (x.unit === 'Гц' && v >= 1000 ? (v / 1000).toFixed(1) + ' кГц' : (x.id === 'pan' ? (v === 0 ? 'центр' : v < 0 ? 'Л ' + -v : 'П ' + v) : (v > 0 && x.unit === 'дБ' ? '+' : '') + v + ' ' + x.unit)); };
        r.addEventListener('input', () => { f.p[x.id] = fromPos(Number(r.value)); show(); aeFxLive(f); });
        r.addEventListener('change', aeSaveCfg);
        show();
        row.append(r, val);
      }
      card.append(row);
    }
    box.append(card);
  });
}
// Ползунок плагина — сразу слышно, без перезапуска
function aeFxLive(f) {
  aeSaveCfg();
  const n = aePlay && aePlay.chain.nodes.find((x) => x.f === f);
  if (n) n.n.set({ ...aeFxNew(f.type).p, ...f.p });
}
$('aeFxAdd').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu({ clientX: r.left, clientY: r.bottom + 2 }, Object.entries(AE_FX).map(([type, d]) => ({
    label: d.name + ' — ' + d.help.toLowerCase(),
    fn: () => { AE.fx.push(aeFxNew(type)); aeSaveCfg(); aeRenderFx(); aeReplay(); },
  })));
});

/* ----- Сохранение: рендер (растяжение + плагины) → WAV 16 бит ----- */

async function aeRenderWav() {
  const { T, rate } = aeRates();
  const tok = ++aeTok;
  const ch = await aeStretch(ae.ch, T, ae.sr, tok, (x) => showNotice(`Сохраняю аудио: обработка ${Math.round(x * 100)} %`, false, true));
  if (!ch) return null;
  const pan = !AE.bypass && AE.fx.some((f) => f.on && (f.type === 'reverb' || (f.type === 'gain' && f.p.pan)));
  const nch = ch.length > 1 || pan ? 2 : 1;
  const len = Math.ceil(ch[0].length / rate + aeTail() * ae.sr);
  const oc = new OfflineAudioContext(nch, Math.max(1, len), ae.sr);
  const buf = oc.createBuffer(ch.length, ch[0].length, ae.sr);
  ch.forEach((d, i) => buf.copyToChannel(d, i));
  const src = oc.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const chain = aeChain(oc);
  src.connect(chain.input);
  chain.output.connect(oc.destination);
  src.start();
  showNotice('Сохраняю аудио: плагины…', false, true);
  const out = await oc.startRendering();
  return aeWav(out);
}

function aeWav(b) {
  const nch = b.numberOfChannels; const n = b.length; const sr = b.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + n * nch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); data.setUint32(4, 36 + n * nch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, nch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * nch * 2, true); data.setUint16(32, nch * 2, true); data.setUint16(34, 16, true);
  str(36, 'data'); data.setUint32(40, n * nch * 2, true);
  const chs = []; for (let c = 0; c < nch; c++) chs.push(b.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
    const v = Math.max(-1, Math.min(1, chs[c][i]));
    data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Uint8Array(data.buffer);
}

const aeDir = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');

// mode: 'save' — заменить там, откуда открыли; 'copy' — рядом новой копией; 'export' — файл куда угодно
async function aeSave(mode) {
  if (!ae || aeBusy) return;
  aeStop();
  const kind = ae.src && ae.src.kind;
  const inProgram = (kind === 'item' && lib.items[ae.src.itemId]) || (kind === 'music' && ae.src.list);
  const saveAs = mode === 'export' || !inProgram;
  const name = ae.name.replace(/ \((изм|копия)\)$/, '') + (mode === 'save' ? ' (изм)' : ' (копия)');
  const bytes = await aeRenderWav();
  if (!bytes) { showNotice(''); return; }
  showNotice('Сохраняю аудио…', false, true);
  const file = await window.api.audioSave({ bytes, name: mode === 'export' ? ae.name : name, saveAs, dir: aeDir(ae.path) });
  showNotice('');
  if (!file) return;
  if (file.error) { showNotice('Не удалось сохранить аудио: ' + file.error, true); return; }
  if (mode !== 'export' && inProgram) aePlace(file, mode === 'copy');
  if (saveAs && typeof renderPool === 'function') Promise.resolve(renderPool()).catch(() => {}); // файл мог лечь в папку медиапула
  if (mode === 'export') { flashStatus('Сохранено: ' + file.path); return; }
  // Дальше редактор работает с новым файлом: скорость, тон и плагины уже вшиты — сбрасываем, чтобы не наложить дважды
  const src = ae.src;
  const hadFx = AE.fx.some((f) => f.on);
  AE.fx.forEach((f) => { f.on = false; });
  aeSaveCfg();
  await aeLoad(file, mode === 'copy' && src.kind === 'item' ? { kind: 'item', itemId: aePlaced.itemId, slideId: aePlaced.slideId } : src);
  flashStatus(`Сохранено: «${file.name}»` + (hadFx ? ' · плагины вшиты в файл и выключены' : ''));
}
let aePlaced = {};

// Поставить новый файл туда, откуда открыли (copy — рядом новым пунктом)
function aePlace(file, copy) {
  const src = ae.src;
  const old = ae.path;
  if (src.kind === 'item') {
    const it = lib.items[src.itemId];
    if (!copy) {
      const sl = it.slides.find((s) => s.id === src.slideId) || it.slides.find((s) => s.k === 'audio' && s.path === old);
      if (sl) Object.assign(sl, { url: file.url, path: file.path });
      aePlaced = { itemId: it.id, slideId: sl && sl.id };
    } else {
      const n = Slides.fromFile({ ...file, type: 'audio', name: it.name + ' (копия)' });
      lib.items[n.id] = n;
      let libs = lib.libraries.filter((l) => l.items.includes(it.id));
      if (!libs.length) {
        if (!lib.libraries.length) lib.libraries.push({ id: newId(), name: 'Библиотека', items: [] });
        libs = [lib.libraries[0]];
      }
      libs.forEach((l) => { const at = l.items.indexOf(it.id); l.items.splice(at < 0 ? l.items.length : at + 1, 0, n.id); });
      aePlaced = { itemId: n.id, slideId: n.slides[0].id };
    }
    saveLib();
    renderService();
  } else if (src.kind === 'music') {
    const list = src.list;
    const i = list.findIndex((s) => s.path === old);
    if (copy) list.splice(i < 0 ? list.length : i + 1, 0, songOf(file));
    else list.forEach((s) => { if (s.path === old) Object.assign(s, { path: file.path, url: file.url, name: file.name }); });
    if (list === tracks) saveLists();
    listChanged();
  }
}

$('aeSave').addEventListener('click', () => aeSave('save'));
$('aeCopy').addEventListener('click', () => aeSave('copy'));
$('aeExport').addEventListener('click', () => aeSave('export'));

Icons.apply($('audioView'));
