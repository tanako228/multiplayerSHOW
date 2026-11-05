/* ===== NDI: поиск и приём картинки и звука (главный процесс) =====
   Работает через библиотеку NDI Runtime (ставится вместе с бесплатными NDI Tools) и koffi — без сборки.
   Библиотеки нет — available() = false, остаётся поиск имён по mDNS в main.js.
   Кадры уходят в окна по IPC: 'ndi:video' { key, w, h, stride, alpha, data }, 'ndi:audio' { key, rate, ch, n, data };
   окно отвечает 'ndi:ack' — пока не ответило, новые кадры ему не шлём (берёт только свежие). */
const fs = require('fs');
const path = require('path');

let koffi = null;
let N; // функции библиотеки; false — библиотеки нет
let Video, Audio, Source;

const fourcc = (s) => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
const FCC_RGBA = fourcc('RGBA') >>> 0;
const FCC_RGBX = fourcc('RGBX') >>> 0;

function dllPath() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const dirs = [
    process.env.NDI_RUNTIME_DIR_V6, process.env.NDI_RUNTIME_DIR_V5,
    path.join(pf, 'NDI', 'NDI 6 Runtime', 'v6'), path.join(pf, 'NDI', 'NDI 6 Tools', 'Runtime'),
    path.join(pf, 'NDI', 'NDI 5 Runtime', 'v5'), path.join(pf, 'NDI', 'NDI 5 Tools', 'Runtime'),
  ];
  for (const d of dirs) {
    if (!d) continue;
    const f = path.join(d, 'Processing.NDI.Lib.x64.dll');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function load() {
  if (N !== undefined) return N;
  N = false;
  try {
    const file = dllPath();
    if (!file) return N;
    koffi = require('koffi');
    const lib = koffi.load(file);
    Source = koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char*', p_url_address: 'const char*' });
    koffi.struct('NDIlib_find_create_t', { show_local_sources: 'bool', p_groups: 'const char*', p_extra_ips: 'const char*' });
    koffi.struct('NDIlib_send_create_t', { p_ndi_name: 'const char*', p_groups: 'const char*', clock_video: 'bool', clock_audio: 'bool' });
    koffi.struct('NDIlib_recv_create_v3_t', {
      source_to_connect_to: 'NDIlib_source_t', color_format: 'int', bandwidth: 'int', allow_video_fields: 'bool', p_ndi_recv_name: 'const char*',
    });
    Video = koffi.struct('NDIlib_video_frame_v2_t', {
      xres: 'int', yres: 'int', FourCC: 'uint32_t', frame_rate_N: 'int', frame_rate_D: 'int', picture_aspect_ratio: 'float',
      frame_format_type: 'int', timecode: 'int64_t', p_data: 'void*', line_stride_in_bytes: 'int', p_metadata: 'const char*', timestamp: 'int64_t',
    });
    Audio = koffi.struct('NDIlib_audio_frame_v2_t', {
      sample_rate: 'int', no_channels: 'int', no_samples: 'int', timecode: 'int64_t', p_data: 'void*',
      channel_stride_in_bytes: 'int', p_metadata: 'const char*', timestamp: 'int64_t',
    });
    const fn = {
      init: lib.func('bool NDIlib_initialize()'),
      findCreate: lib.func('void* NDIlib_find_create_v2(const NDIlib_find_create_t*)'),
      findWait: lib.func('bool NDIlib_find_wait_for_sources(void*, uint32_t)'),
      findGet: lib.func('const NDIlib_source_t* NDIlib_find_get_current_sources(void*, _Out_ uint32_t*)'),
      recvCreate: lib.func('void* NDIlib_recv_create_v3(const NDIlib_recv_create_v3_t*)'),
      recvDestroy: lib.func('void NDIlib_recv_destroy(void*)'),
      // кадры — сырыми буферами (void*), разбираем koffi.decode
      capture: lib.func('int NDIlib_recv_capture_v2(void*, void*, void*, void*, uint32_t)'),
      freeVideo: lib.func('void NDIlib_recv_free_video_v2(void*, void*)'),
      freeAudio: lib.func('void NDIlib_recv_free_audio_v2(void*, void*)'),
      memcpy: koffi.load('kernel32.dll').func('void RtlMoveMemory(void*, void*, size_t)'),
      // Отправка (NDI-выход экрана)
      sendCreate: lib.func('void* NDIlib_send_create(const NDIlib_send_create_t*)'),
      sendDestroy: lib.func('void NDIlib_send_destroy(void*)'),
      sendVideo: lib.func('void NDIlib_send_send_video_v2(void*, const NDIlib_video_frame_v2_t*)'),
    };
    if (!fn.init()) return N;
    N = fn;
  } catch (e) {
    console.warn('NDI недоступен:', e.message);
    N = false;
  }
  return N;
}

const available = () => !!load();

/* ----- Поиск: один «искатель» на всю программу, первый раз ждём ответов ----- */

let finder = null;
let finderBorn = 0;

const wait = (ms) => new Promise((resolve) => N.findWait.async(finder, ms, () => resolve()));

async function sources(ms = 1500) {
  if (!load()) return null;
  if (!finder) {
    finder = N.findCreate({ show_local_sources: true, p_groups: null, p_extra_ips: null });
    finderBorn = Date.now();
  }
  if (!finder) return [];
  const left = finderBorn + ms - Date.now();
  if (left > 0) await wait(left);
  const n = [0];
  const p = N.findGet(finder, n);
  if (!n[0] || !p) return [];
  return koffi.decode(p, Source, n[0]).map((s) => ({ name: s.p_ndi_name, url: s.p_url_address || '' }));
}

/* ----- Приём: один приёмник на источник и качество, окна-подписчики ----- */

const receivers = new Map(); // key → { recv, subs: Map<id, { wc, n, busy }>, vbuf, abuf, last, live }
const LOST_MS = 3000;

function open(name, hq, wc) {
  if (!load() || !name) return null;
  const key = (hq ? 'hq|' : 'lq|') + name;
  let r = receivers.get(key);
  if (!r) {
    const recv = N.recvCreate({
      source_to_connect_to: { p_ndi_name: name, p_url_address: null },
      color_format: 2, // RGBX_RGBA
      bandwidth: hq ? 100 : 0, // окно вывода — полное качество, оператору — лёгкое превью
      allow_video_fields: false,
      p_ndi_recv_name: 'MP Show',
    });
    if (!recv) return null;
    // last — с запасом: подключение к источнику занимает несколько секунд
    r = { key, recv, subs: new Map(), vbuf: Buffer.alloc(koffi.sizeof(Video)), abuf: Buffer.alloc(koffi.sizeof(Audio)), last: Date.now() + 5000, live: true, closed: false };
    receivers.set(key, r);
    pump(r);
  }
  const s = r.subs.get(wc.id) || { wc, n: 0, busy: false };
  s.n++;
  r.subs.set(wc.id, s);
  if (s.n === 1) wc.once('destroyed', () => drop(key, wc.id, true));
  if (!r.live) setImmediate(() => !wc.isDestroyed() && wc.send('ndi:state', { key, live: false }));
  return key;
}

function drop(key, id, all) {
  const r = receivers.get(key);
  const s = r && r.subs.get(id);
  if (!s) return;
  if (all || --s.n <= 0) r.subs.delete(id);
  if (r.subs.size) return;
  // Никто не смотрит — закрыть чуть погодя (вдруг тут же откроют снова)
  setTimeout(() => {
    if (r.subs.size || receivers.get(key) !== r) return;
    receivers.delete(key);
    r.closed = true; // приёмник уничтожит pump, когда вернётся текущий запрос кадра
  }, 2000);
}

function ack(key, id) {
  const s = receivers.has(key) && receivers.get(key).subs.get(id);
  if (s) s.busy = false;
}

function tell(r, channel, msg, skipBusy) {
  for (const s of r.subs.values()) {
    if (s.wc.isDestroyed()) continue;
    if (skipBusy) {
      if (s.busy) continue;
      s.busy = true;
    }
    s.wc.send(channel, msg);
  }
}

// Кадр из памяти библиотеки — в свой Buffer (koffi.view в Electron нельзя: чужая память запрещена)
function copy(ptr, len) {
  const buf = Buffer.allocUnsafe(len);
  N.memcpy(buf, ptr, len);
  return buf;
}

function onVideo(r) {
  const v = koffi.decode(r.vbuf, Video);
  const alpha = v.FourCC === FCC_RGBA;
  if (v.p_data && (alpha || v.FourCC === FCC_RGBX) && [...r.subs.values()].some((s) => !s.busy)) {
    tell(r, 'ndi:video', { key: r.key, w: v.xres, h: v.yres, stride: v.line_stride_in_bytes, alpha, data: copy(v.p_data, v.line_stride_in_bytes * v.yres) }, true);
  }
  N.freeVideo(r.recv, r.vbuf);
}

function onAudio(r) {
  const a = koffi.decode(r.abuf, Audio);
  if (a.p_data && a.no_samples > 0 && a.no_channels > 0) {
    const raw = copy(a.p_data, a.channel_stride_in_bytes * a.no_channels);
    const len = a.no_samples * 4;
    // каналы подряд, без промежутков (так ждёт AudioData 'f32-planar')
    let data = raw;
    if (a.channel_stride_in_bytes !== len) {
      data = Buffer.alloc(len * a.no_channels);
      for (let c = 0; c < a.no_channels; c++) raw.copy(data, c * len, c * a.channel_stride_in_bytes, c * a.channel_stride_in_bytes + len);
    }
    tell(r, 'ndi:audio', { key: r.key, rate: a.sample_rate, ch: a.no_channels, n: a.no_samples, data });
  }
  N.freeAudio(r.recv, r.abuf);
}

// Кадры ждём в отдельном потоке (.async), чтобы не держать главный процесс
function pump(r) {
  N.capture.async(r.recv, r.vbuf, r.abuf, null, 250, (err, type) => {
    if (r.closed) { N.recvDestroy(r.recv); return; }
    try {
      if (type === 1) onVideo(r);
      else if (type === 2) onAudio(r);
    } catch (e) { console.warn('NDI кадр:', e.message); }
    // Пропал сигнал (источник закрыли) — сказать окнам; появился снова — тоже
    const now = Date.now();
    if (type === 1) r.last = now;
    const live = now - r.last < LOST_MS;
    if (live !== r.live) {
      r.live = live;
      tell(r, 'ndi:state', { key: r.key, live });
    }
    if (type === 4) setTimeout(() => pump(r), 500); // ошибка — не крутиться вхолостую
    else setImmediate(() => pump(r));
  });
}

/* ----- Отправка: NDI-выход экрана (main.js рисует экран в невидимом окне и отдаёт кадры BGRA) ----- */

const FCC_BGRA = fourcc('BGRA') >>> 0;
const TC_SYNTH = 9223372036854775807n; // NDIlib_send_timecode_synthesize

function sender(name) {
  if (!load()) return null;
  const inst = N.sendCreate({ p_ndi_name: String(name || 'MP Show'), p_groups: null, clock_video: false, clock_audio: false });
  if (!inst) return null;
  let mem = null;   // кадр в памяти, которую видит библиотека (свой Buffer отдать нельзя — переложим)
  let memLen = 0;
  let busy = false; // кадр ещё отправляется (в отдельном потоке) — новые пропускаем
  let closed = false;
  const free = () => { if (mem) koffi.free(mem); mem = null; memLen = 0; };
  return {
    frame(buf, w, h, fps) {
      if (busy || closed || !buf || buf.length < w * h * 4) return;
      busy = true;
      const len = w * h * 4;
      if (memLen !== len) { free(); mem = koffi.alloc('uint8_t', len); memLen = len; }
      N.memcpy(mem, buf, len);
      const f = {
        xres: w, yres: h, FourCC: FCC_BGRA, frame_rate_N: Math.round(fps * 1000), frame_rate_D: 1000, picture_aspect_ratio: w / h,
        frame_format_type: 1, timecode: TC_SYNTH, p_data: mem, line_stride_in_bytes: w * 4, p_metadata: null, timestamp: 0n,
      };
      N.sendVideo.async(inst, f, () => {
        busy = false;
        if (closed) { N.sendDestroy(inst); free(); }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      if (!busy) { N.sendDestroy(inst); free(); }
    },
  };
}

// IPC; isOutput(wc) — это окно вывода (ему полное качество)
function setup(ipcMain, isOutput) {
  ipcMain.handle('ndi:find', () => sources(1500));
  ipcMain.handle('ndi:open', (e, name) => open(String(name || ''), isOutput(e.sender), e.sender));
  ipcMain.on('ndi:close', (e, key) => drop(key, e.sender.id, false));
  ipcMain.on('ndi:ack', (e, key) => ack(key, e.sender.id));
}

module.exports = { available, sources, setup, sender };
