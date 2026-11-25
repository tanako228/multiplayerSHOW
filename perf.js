/* Производительность: программа подстраивается под компьютер сама.
   • До запуска окон (early) — ключи Chromium: рисовать на видеокарте (растеризация и текстуры в видеопамяти,
     а не в оперативной), на ноутбуках с двумя видеокартами — брать мощную (NVIDIA/AMD), а не встроенную.
   • После запуска (info) — что за компьютер: ОЗУ, процессор, какая видеокарта рисует, сколько у неё памяти,
     работает ли ускорение; сколько памяти и процессора берёт каждая часть программы (окно, видеокарта, служебные).
   • Режим: «auto» — сам решает; «quality» — всё красиво; «eco» — без размытия стекла и лишних анимаций.
     Авто включает лёгкий вид, когда ОЗУ меньше ~8 ГБ или видеокарта не работает (рисует процессор).
   Режим хранится в perf.json в папке данных: ключи Chromium читаются до окон, localStorage тогда ещё нет. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MODES = ['auto', 'quality', 'eco'];
let file = '';
let cfg = { mode: 'auto' };
let started = { mode: 'auto' }; // с каким режимом запущены ключи Chromium (смена — после перезапуска)

function early(app, userData) {
  file = path.join(userData, 'perf.json');
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (MODES.includes(j.mode)) cfg.mode = j.mode; } catch { /* нет файла — авто */ }
  started = { ...cfg };
  const sw = app.commandLine;
  // Рисование (растеризация, слои, декодирование видео) Chromium и так делает на видеокарте, если она не в чёрном
  // списке драйверов, — силой не включаем: на старых драйверах это даёт мусор на экране. Наше дело — чтобы рисовала
  // мощная видеокарта: две видеокарты (ноутбук, ПК со встроенной и отдельной) — NVIDIA/AMD; «Экономно» — встроенная
  sw.appendSwitch(cfg.mode === 'eco' ? 'force_low_power_gpu' : 'force_high_performance_gpu');
}

const VENDORS = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x1022: 'AMD', 0x8086: 'Intel', 0x1414: 'Microsoft' };
const isDiscrete = (d) => !!d && (d.vendorId === 0x10de || /\b(NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|Arc\(TM\) A\d|Arc\(TM\) B\d)/i.test(d.deviceString || ''));
// AMD (0x1002) бывает и встроенной (Ryzen с Radeon Graphics) — отдельная только по имени (RX, Pro)

// Видеопамять — из реестра Windows (WMI отдаёт не больше 4 ГБ): имя видеокарты → байты
let vramCache = null;
function vram() {
  if (vramCache) return Promise.resolve(vramCache);
  if (process.platform !== 'win32') return Promise.resolve({});
  const key = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
  return new Promise((ok) => {
    execFile('reg', ['query', key, '/s', '/v', 'HardwareInformation.qwMemorySize'], { windowsHide: true, timeout: 4000 }, (e1, memOut) => {
      execFile('reg', ['query', key, '/s', '/v', 'DriverDesc'], { windowsHide: true, timeout: 4000 }, (e2, descOut) => {
        const out = {};
        const byKey = (txt, re) => { const m = {}; let cur = ''; for (const l of String(txt || '').split(/\r?\n/)) { if (/^HKEY_/.test(l)) cur = l.trim(); else { const x = l.match(re); if (x && cur) m[cur] = x[1]; } } return m; };
        const mem = byKey(memOut, /qwMemorySize\s+REG_QWORD\s+0x([0-9a-f]+)/i);
        const desc = byKey(descOut, /DriverDesc\s+REG_SZ\s+(.+)$/);
        for (const k of Object.keys(mem)) if (desc[k]) out[desc[k].trim()] = parseInt(mem[k], 16);
        vramCache = out;
        ok(out);
      });
    });
  });
}

let gpuInfoCache = null;
async function gpu(app) {
  if (!gpuInfoCache) { try { gpuInfoCache = await app.getGPUInfo('basic'); } catch { gpuInfoCache = {}; } }
  // 0x1414 — «Базовый видеодрайвер Microsoft», не видеокарта
  const devs = (gpuInfoCache.gpuDevice || []).filter((d) => d.vendorId !== 0x1414).map((d) => ({ ...d, vendor: VENDORS[d.vendorId] || '' }));
  const st = app.getGPUFeatureStatus() || {};
  const accel = st.gpu_compositing === 'enabled' || st.gpu_compositing === 'enabled_on';
  const mem = await vram();
  // Имя: от Chromium часто пусто — берём из реестра по производителю (там «NVIDIA GeForce RTX 3060»)
  const regNames = Object.keys(mem).filter((n) => !/Microsoft|Basic|Remote|Virtual|spacedesk|Parsec|Citrix/i.test(n));
  const nameOf = (d) => d.deviceString || regNames.find((n) => d.vendor && n.toLowerCase().includes(d.vendor.toLowerCase())) || d.vendor || 'Видеокарта';
  const list = devs.map((d) => {
    const name = nameOf(d);
    const disc = isDiscrete({ ...d, deviceString: name });
    // У встроенной «видеопамять» в реестре — общая с ОЗУ, её не показываем
    return { name, vendor: d.vendor, active: !!d.active, discrete: disc, vram: disc ? mem[name] || 0 : 0 };
  }).filter((d, i, a) => a.findIndex((x) => x.name === d.name) === i); // одна и та же карта бывает в списке дважды
  // Первая в списке Chromium — та, на которой работает его процесс видеокарты (если флага active нет)
  if (list.length && !list.some((d) => d.active)) list[0].active = true;
  // Устройств может не быть в списке (старый драйвер) — тогда хотя бы имена из реестра
  if (!list.length) for (const name of regNames) { const disc = isDiscrete({ deviceString: name }); list.push({ name, vendor: '', active: false, discrete: disc, vram: disc ? mem[name] : 0 }); }
  const active = list.find((d) => d.active) || list[0] || null;
  return {
    list, active, accel,
    video: st.video_decode || '',
    raster: st.rasterization || '',
    // Есть отдельная видеокарта, а рисует встроенная — обычно монитор/проектор подключён к разъёму материнской платы
    wrongGpu: !!(active && !active.discrete && list.some((d) => d.discrete)),
  };
}

// Решение «Авто»: лёгкий вид на слабом компьютере
function decide(g) {
  const ram = os.totalmem();
  const reasons = [];
  if (ram < 7.5 * 1024 ** 3) reasons.push('ram');
  if (g && !g.accel) reasons.push('nogpu');
  const lite = cfg.mode === 'eco' || (cfg.mode === 'auto' && reasons.length > 0);
  return { lite, reasons };
}

// Части программы: сколько памяти и процессора берёт каждая (app.getAppMetrics), окна — по названию
function parts(app, BrowserWindow) {
  const names = new Map();
  for (const w of BrowserWindow.getAllWindows()) {
    try { const pid = w.webContents.getOSProcessId(); if (pid) names.set(pid, (names.get(pid) ? names.get(pid) + ', ' : '') + (w.getTitle() || 'окно')); } catch { /* окно закрывается */ }
  }
  return app.getAppMetrics().map((m) => ({
    pid: m.pid,
    type: m.type, // Browser — главный процесс, Tab — окно, GPU — видеокарта, Utility — сеть/звук
    sub: m.serviceName || '',
    name: names.get(m.pid) || '',
    mb: Math.round(((m.memory && (m.memory.privateBytes || m.memory.workingSetSize)) || 0) / 1024),
    cpu: Math.round(((m.cpu && m.cpu.percentCPUUsage) || 0) * 10) / 10,
  })).sort((a, b) => b.mb - a.mb);
}

async function info(app, BrowserWindow) {
  const g = await gpu(app);
  const d = decide(g);
  const cpus = os.cpus();
  return {
    mode: cfg.mode, startedMode: started.mode, lite: d.lite, reasons: d.reasons,
    ram: os.totalmem(), ramFree: os.freemem(),
    cpu: { name: (cpus[0] && cpus[0].model || '').trim(), cores: cpus.length },
    gpu: g,
    parts: parts(app, BrowserWindow),
  };
}

function setMode(mode) {
  if (!MODES.includes(mode)) return cfg.mode;
  cfg.mode = mode;
  try { fs.writeFileSync(file, JSON.stringify(cfg)); } catch { /* папка данных недоступна — режим до перезапуска */ }
  return cfg.mode;
}

module.exports = { early, info, setMode, decide, gpu, isDiscrete, MODES };
