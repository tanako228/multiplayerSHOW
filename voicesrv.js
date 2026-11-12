// Библия по голосу — главный процесс (voice.js в окне оператора, voice.html — скрытое окно распознавания).
// Распознавание — Vosk (vosk-browser, WebAssembly), без интернета: модель языка один раз скачивается
// с alphacephei.com (или берётся из своего .zip) и лежит в userData\voice\<язык>.tar.gz.
// Окно распознавания читает модель по адресу mpsvoice://model/<язык>.tar.gz (свой протокол: fetch из воркера).
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

const MODELS = {
  ru: { name: 'Русский', file: 'vosk-model-small-ru-0.22.zip', mb: 45 },
  en: { name: 'English', file: 'vosk-model-small-en-us-0.15.zip', mb: 40 },
};
const BASE = 'https://alphacephei.com/vosk/models/';
const dir = () => path.join(app.getPath('userData'), 'voice');
const modelFile = (lang) => path.join(dir(), lang + '.tar.gz');

// До app.ready: свой протокол с fetch и CORS (воркер Vosk — из blob:, его страница — file://)
function early() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'mpsvoice', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}

// Папка модели из ZIP → tar.gz с одной верхней папкой «model/» (так ждёт vosk-browser).
// Сначала — записи папок (model/, model/am/…): без них Vosk распаковывает, но потом не может
// сохранить модель (ошибка «Failed to sync file system», распознавание не включалось).
function tarGz(files) {
  const blocks = [];
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  const dirs = new Set(['model/']);
  for (const f of files) { const p = f.name.split('/'); for (let i = 1; i < p.length; i++) dirs.add('model/' + p.slice(0, i).join('/') + '/'); }
  const all = [...[...dirs].sort().map((d) => ({ full: d, dir: true, data: Buffer.alloc(0) })), ...files.map((f) => ({ full: 'model/' + f.name, data: f.data }))];
  for (const f of all) {
    let name = f.full;
    let prefix = '';
    if (Buffer.byteLength(name) > 99) { const i = name.lastIndexOf('/', 154); prefix = name.slice(0, i); name = name.slice(i + 1); }
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write(oct(f.dir ? 0o755 : 0o644, 8), 100);
    h.write(oct(0, 8), 108);
    h.write(oct(0, 8), 116);
    h.write(oct(f.data.length, 12), 124);
    h.write(oct(Math.floor(Date.now() / 1000), 12), 136);
    h.fill(' ', 148, 156);
    h.write(f.dir ? '5' : '0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    h.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (const b of h) sum += b;
    h.write(oct(sum, 7) + ' ', 148);
    blocks.push(h, f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks), { level: 1 });
}

// Старая модель (сохранена без записей папок) → пересобрать один раз. true — файл в порядке или исправлен
function fixOld(f) {
  try {
    const gz = fs.readFileSync(f);
    // первая запись — папка ('5'): уже новый вид (смотрим только начало архива — быстро)
    if (zlib.gunzipSync(gz.subarray(0, 65536), { finishFlush: zlib.constants.Z_SYNC_FLUSH })[156] === 53) return true;
    const b = zlib.gunzipSync(gz);
    const files = [];
    for (let p = 0; p + 512 <= b.length;) {
      const name = b.toString('utf8', p, p + 100).replace(/\0.*$/s, '');
      if (!name) break;
      const pre = b.toString('utf8', p + 345, p + 500).replace(/\0.*$/s, '');
      const size = parseInt(b.toString('utf8', p + 124, p + 136), 8) || 0;
      const full = (pre ? pre + '/' : '') + name;
      if (b[p + 156] !== 53 && full.startsWith('model/')) files.push({ name: full.slice(6), data: b.subarray(p + 512, p + 512 + size) });
      p += 512 + Math.ceil(size / 512) * 512;
    }
    if (!files.length) return false;
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, tarGz(files));
    fs.renameSync(tmp, f);
    return true;
  } catch { return false; }
}

// Файлы модели из архива: убираем верхнюю папку (vosk-model-small-ru-0.22/…), проверяем, что это модель
function modelFrom(zip, unzip) {
  const parts = unzip(zip);
  const tops = new Set(parts.map((f) => f.name.split('/')[0]));
  const strip = tops.size === 1 && parts.every((f) => f.name.includes('/'));
  const files = parts.map((f) => ({ name: strip ? f.name.slice(f.name.indexOf('/') + 1) : f.name, data: f.data })).filter((f) => f.name);
  if (!files.some((f) => /^am\/final\.mdl$/.test(f.name)) || !files.some((f) => /^conf\/model\.conf$/.test(f.name))) throw new Error('в архиве нет модели Vosk (am/final.mdl, conf/model.conf)');
  return files;
}

function setup({ ipcMain, getControl, webPreferences, unzip, dialog }) {
  const send = (ch, x) => { const c = getControl(); if (c && !c.isDestroyed()) c.webContents.send(ch, x); };

  protocol.handle('mpsvoice', async (req) => {
    const m = new URL(req.url).pathname.match(/^\/([a-z]{2})\.tar\.gz$/);
    const f = m && modelFile(m[1]);
    if (!f || !fs.existsSync(f)) return new Response('нет модели', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    const r = await net.fetch(pathToFileURL(f).href);
    return new Response(r.body, { status: 200, headers: { 'Content-Type': 'application/gzip', 'Access-Control-Allow-Origin': '*' } });
  });

  const state = () => ({ models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, mb: m.mb, have: fs.existsSync(modelFile(id)) })), on: !!(win && !win.isDestroyed()), lang: cur.lang });

  const save = (lang, files) => {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = modelFile(lang) + '.tmp';
    fs.writeFileSync(tmp, tarGz(files));
    fs.renameSync(tmp, modelFile(lang));
  };

  // Скачать модель языка (один раз), прогресс — voice:progress { lang, got, total }
  let busy = null;
  ipcMain.handle('voice:get', async (_e, lang) => {
    const m = MODELS[lang];
    if (!m) return { ok: false, error: 'нет такого языка' };
    if (busy) return { ok: false, error: 'модель уже скачивается' };
    busy = lang;
    try {
      const r = await net.fetch(BASE + m.file);
      if (!r.ok) throw new Error('сервер ответил ' + r.status);
      const total = Number(r.headers.get('content-length')) || m.mb * 1048576;
      const chunks = [];
      let got = 0;
      let last = 0;
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        got += value.length;
        if (Date.now() - last > 300) { last = Date.now(); send('voice:progress', { lang, got, total }); }
      }
      send('voice:progress', { lang, got: total, total, unpack: true });
      save(lang, modelFrom(Buffer.concat(chunks), unzip));
      return { ok: true, state: state() };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    } finally { busy = null; send('voice:progress', null); }
  });

  // Своя модель из .zip (скачали на другом компьютере, другой язык Vosk)
  ipcMain.handle('voice:file', async (e, lang) => {
    if (!MODELS[lang]) return { ok: false, error: 'нет такого языка' };
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Модель Vosk (.zip)', properties: ['openFile'], filters: [{ name: 'Модель Vosk', extensions: ['zip'] }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false };
    try { save(lang, modelFrom(fs.readFileSync(res.filePaths[0]), unzip)); return { ok: true, state: state() }; } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('voice:state', () => state());

  // Журнал распознавания — userDataoicelog.txt (что пошло не так у владельца; не больше ~200 КБ)
  const logFile = () => path.join(dir(), 'log.txt');
  const log = (t) => {
    try {
      fs.mkdirSync(dir(), { recursive: true });
      const f = logFile();
      if (fs.existsSync(f) && fs.statSync(f).size > 200000) fs.renameSync(f, f + '.old');
      fs.appendFileSync(f, new Date().toLocaleString('ru-RU') + '  ' + t + '\n');
    } catch { /* журнал не важнее распознавания */ }
  };

  // Скрытое окно распознавания: микрофон → Vosk → текст окну оператора (voice:text)
  let win = null;
  let cur = {};
  const stop = () => { const w = win; win = null; cur = {}; if (w && !w.isDestroyed()) w.destroy(); };
  ipcMain.handle('voice:start', (_e, cfg) => {
    const lang = cfg && MODELS[cfg.lang] ? cfg.lang : 'ru';
    log('— Вкл: язык ' + lang + ', микрофон ' + ((cfg && cfg.label) || 'как в Windows'));
    if (!fs.existsSync(modelFile(lang))) return { ok: false, error: 'нет модели языка' };
    if (!fixOld(modelFile(lang))) return { ok: false, error: 'файл модели повреждён — скачайте модель заново' };
    stop();
    cur = { lang };
    const w = new BrowserWindow({ show: false, width: 300, height: 200, skipTaskbar: true, webPreferences: { ...webPreferences, backgroundThrottling: false } });
    win = w;
    // v — время файла модели: новая модель → новый ключ в IndexedDB окна (старая распакованная копия не мешает)
    const v = String(Math.floor(fs.statSync(modelFile(lang)).mtimeMs));
    w.loadFile(path.join(__dirname, 'voice.html'), { query: { lang, v, mic: (cfg && cfg.mic) || '', label: (cfg && cfg.label) || '' } });
    // Старое окно при перезапуске (смена языка/микрофона) «выкл» не шлёт — иначе панель гасла после включения нового
    w.webContents.on('console-message', (_ev, level, message) => { if (level >= 2 && !/ScriptProcessorNode|Security Warning/.test(message)) log('окно: ' + message); });
    w.on('closed', () => { if (win === w) { win = null; cur = {}; send('voice:text', { state: 'off' }); } });
    w.webContents.on('render-process-gone', (_e, d) => { if (win === w) { log('окно упало: ' + d.reason); send('voice:text', { state: 'error', error: 'распознавание упало (' + d.reason + ')' }); stop(); } });
    return { ok: true };
  });
  ipcMain.handle('voice:stop', (_e, why) => { log('— Выкл' + (why ? ' (' + why + ')' : '')); stop(); return { ok: true }; });
  // От окна распознавания: { text, final } | { state: 'loading'|'on'|'error', error } | { warn } | { level } | { log } (только в журнал)
  ipcMain.on('voice:send', (e, msg) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents || !msg) return;
    if (msg.log) { log(msg.log); return; }
    if (msg.state) log('состояние: ' + msg.state + (msg.error ? ' — ' + msg.error : ''));
    if (msg.warn) log('внимание: ' + msg.warn);
    send('voice:text', msg);
  });
  app.on('will-quit', stop);
}

module.exports = { early, setup, MODELS };
