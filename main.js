const { app, BrowserWindow, ipcMain, dialog, screen, nativeImage, clipboard, shell, desktopCapturer, powerMonitor, safeStorage } = require('electron');
const dgram = require('dgram');
const ndi = require('./ndi');
const cast = require('./cast');
const team = require('./teamsrv');
const voice = require('./voicesrv'); // Библия по голосу: модели Vosk и окно распознавания
voice.early(); // свой протокол mpsvoice: — до app.ready
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const http = require('http');
const os = require('os');
const { pathToFileURL, fileURLToPath } = require('url');

const EXT = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'],
  presentation: ['pptx', 'ppt', 'ppsx', 'pps', 'odp'],
};
const ALL_EXT = Object.values(EXT).flat();

// Язык окон выбора файлов: окно оператора сообщает язык (I18n → api.setLang), заголовки и фильтры
// переводим тем же словарём lang.js, что и интерфейс (i18n.js грузим без окна, нужна только функция t)
let uiT = (s) => s;
ipcMain.on('ui:lang', (_e, lang) => {
  try {
    const vm = require('vm');
    const ctx = { localStorage: { getItem: () => lang, setItem() {} }, document: { readyState: 'loading', addEventListener() {} }, MutationObserver: function () { this.observe = () => {}; }, queueMicrotask() {}, CustomEvent: function () {} };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8') + ';this.I18n = I18n;', ctx);
    if (lang !== 'ru') vm.runInContext(fs.readFileSync(path.join(__dirname, 'lang.js'), 'utf8'), ctx);
    uiT = (s) => (typeof s === 'string' ? ctx.I18n.t(s) : s);
  } catch { uiT = (s) => s; }
});
const trDlg = (o) => {
  if (!o || typeof o !== 'object') return o;
  const r = { ...o };
  for (const k of ['title', 'buttonLabel', 'message', 'detail']) if (o[k]) r[k] = uiT(o[k]);
  if (Array.isArray(o.filters)) r.filters = o.filters.map((f) => ({ ...f, name: uiT(f.name) }));
  if (Array.isArray(o.buttons)) r.buttons = o.buttons.map(uiT);
  return r;
};
for (const k of ['showOpenDialog', 'showSaveDialog', 'showMessageBox']) {
  try {
    const f = dialog[k].bind(dialog);
    dialog[k] = (w, o) => (o === undefined ? f(trDlg(w)) : f(w, trDlg(o)));
  } catch { /* не вышло — окна останутся по-русски */ }
}

// Программа называется multiplayerSHOW, но данные остаются в старой папке %APPDATA%\church-presenter
// (библиотека, Библии, настройки) — иначе после переименования всё «пропало» бы
const APP_NAME = 'multiplayerSHOW';
const APP_ICON = path.join(__dirname, 'brand', 'icon.ico'); // значок окна и панели задач
const SHORT_NAME = 'MP Show'; // короткое имя — заголовок окна и подпись в панели задач Windows
// Имя программы для Windows (AppUserModelID) — строго как build.appId в package.json: под ним установщик
// создаёт ярлыки в «Пуске» и на рабочем столе. Было другое ('multiplayerSHOW.app') — Windows считала окно
// чужим для ярлыков: закреплённая кнопка жила отдельно и ломалась после обновления (см. fixShortcuts).
// При запуске через npm start — своё имя, чтобы не смешиваться с установленной программой.
const APP_ID = app.isPackaged ? 'org.multiplayershow.app' : 'org.multiplayershow.dev';
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
app.setPath('userData', path.join(app.getPath('appData'), 'church-presenter'));

// Профили (profiles.js): у каждого свои библиотеки, плейлисты и настройки окна, часть данных может быть общей.
// Переключение — окно оператора перезагружается с другим профилем, программа и окна показа работают дальше
const profiles = require('./profiles.js').store(app.getPath('userData'));
let profSwitching = false; // от команды переключения до загрузки окна с новым профилем: старое окно ничего не пишет

// Окно, закрытое другим окном целиком (заставка, окно показа), Chromium считает спрятанным и перестаёт рисовать;
// когда его открывают, программа секунду рисуется заново — был чёрный экран после заставки. Не отключать обратно
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Только одна копия программы: две копии делят одно хранилище настроек (localStorage),
// и Chromium может его стереть — пропадали папки медиапула и другие настройки.
// Второй запуск просто показывает уже открытое окно.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (!control || control.isDestroyed()) return;
  if (control.isMinimized()) control.restore();
  control.show();
  control.focus();
});

// Запасная копия настроек окна оператора (все записи localStorage «cp.*») — файл settings-backup.json.
// Если хранилище настроек пропало, preload.js при запуске возвращает всё из этого файла.
const lsBackupFile = () => profiles.lsFile(); // своя у каждого профиля
ipcMain.on('ls:backup', (e, data) => {
  if (profSwitching) { e.returnValue = true; return; } // уходящее окно — это настройки старого профиля
  try {
    if (!data || typeof data !== 'object' || !data['cp.settings']) return; // пустое не пишем — не затереть копию
    const f = lsBackupFile();
    fs.writeFileSync(f + '.tmp', JSON.stringify(data));
    fs.renameSync(f + '.tmp', f);
  } catch { /* не страшно — запишем в следующий раз */ }
  e.returnValue = true; // для sendSync при закрытии окна
});
ipcMain.on('ls:restore', (e) => {
  try { e.returnValue = JSON.parse(fs.readFileSync(lsBackupFile(), 'utf8')); } catch { e.returnValue = null; }
});
// Окно оператора загружается (preload.js): какой профиль открыт. С этого момента окно снова пишет
ipcMain.on('profile:boot', (e) => {
  profSwitching = false;
  e.returnValue = { id: profiles.active() };
});
// Настройки окна, оставшиеся от другого профиля (переключили — а окно не успело записать) — в его файл
ipcMain.on('ls:backupFor', (e, { id, data } = {}) => {
  try {
    if (data && typeof data === 'object' && data['cp.settings'] && profiles.state().list.some((p) => p.id === id)) {
      const f = profiles.lsFile(id);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.tmp', JSON.stringify(data));
      fs.renameSync(f + '.tmp', f);
    }
  } catch { /* не страшно */ }
  e.returnValue = true;
});

let control = null;      // окно оператора
let output = null;       // окно вывода на внешний монитор
let outputDisplayId = null;
let current = {};        // что сейчас на экране: слой → содержимое сцены (Media Layers)
let currentLayers = null; // слои: [{ id, hidden, opacity, volume }] снизу вверх
let currentInk = null;   // рисунок поверх слайда
let currentView = null;  // крупный план { x, y, z } (Быстрая анимация)
let editor = null;       // окно редактора
let outputSettings = { resW: 0, resH: 0 };
let screensCfg = null;   // экраны и применённые сцены (из окна оператора, screens.js)
let screenStage = null;  // текущий и следующий слайд — для элементов сцен
const screenWins = new Map(); // ключ выхода → { win, screen, kind, ndi? } — окна экранов, кроме «Основного» из Настроек

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  autoplayPolicy: 'no-user-gesture-required',
};

/* ---------- Клавиатура не должна «отваливаться» ----------
   Windows + Electron: после системного окна (выбор цвета, файла, вопрос), после заставки или закрытого окна
   бывало — в поле мигает курсор, а буквы не вводятся, помогал только перезапуск. Страница считает, что фокус
   у неё, а клавиши Windows отдаёт мимо. Лечим: окну и его странице заново отдаём фокус.
   strong — клавиши точно теряются (icons.js заметил или Windows говорит, что клавиатура ни у кого): окно на миг
   отпускает фокус и берёт обратно — так Windows заново направляет клавиатуру в окно (обычного способа тут мало). */
const focusFixAt = new WeakMap(); // окно → когда последний раз делали strong (не чаще раза в 2 с)
let w32 = null; // GetFocus/GetForegroundWindow через koffi (как в ndi.js); false — недоступно
function w32Api() {
  if (w32 !== null) return w32;
  w32 = false;
  if (process.platform !== 'win32') return w32;
  try {
    const koffi = require('koffi');
    const u = koffi.load('user32.dll');
    w32 = { koffi, focus: u.func('void * __stdcall GetFocus()'), fore: u.func('void * __stdcall GetForegroundWindow()') };
  } catch (e) {
    console.warn('Проверка клавиатуры недоступна:', e.message);
  }
  return w32;
}
// Окно программы впереди, а клавиатура Windows ни у какого окна — буквы уходят в никуда
function keyboardLost(win) {
  const api = w32Api();
  if (!api) return false;
  try {
    const me = win.getNativeWindowHandle().readBigUInt64LE(0);
    const fore = api.fore();
    if (!fore || api.koffi.address(fore) !== me) return false;
    return !api.focus();
  } catch { return false; }
}
function fixFocus(win, strong) {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
  if (!strong && keyboardLost(win)) strong = true;
  let blurred = false;
  if (strong && Date.now() - (focusFixAt.get(win) || 0) >= 2000) {
    focusFixAt.set(win, Date.now());
    win.blur();
    blurred = true;
  }
  if (blurred || !win.isFocused()) win.focus();
  win.webContents.focus();
}
// Окно с полями ввода (оператор, «Картинка»): получило фокус — страница тоже
function keepKeyboard(win) {
  win.on('focus', () => { if (!win.isDestroyed()) win.webContents.focus(); });
}
// Закрыли окно, у которого был фокус («Картинка», окно экрана), — фокус окну программы.
// Иначе Windows отдаёт его следующему окну (часто окну показа поверх всех), и клавиши уходят туда
function focusBackOnClose(win) {
  let had = false;
  win.on('close', () => { had = win.isFocused(); });
  win.on('closed', () => { if (had) fixFocus(control); });
}
ipcMain.on('win:refocus', (e, strong) => fixFocus(BrowserWindow.fromWebContents(e.sender), !!strong));

/* ---------- Мониторы ---------- */

// Номер монитора — по расположению (слева направо, сверху вниз), а не по порядку Windows:
// после перезагрузки Windows может поменять одинаковые мониторы местами в списке, а расположение у них то же
function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  const ctl = ctlDisplay(); // монитор с окном программы — на него выводить нельзя (решение владельца)
  const all = screen.getAllDisplays();
  const order = [...all].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return all.map((d) => {
    const n = order.indexOf(d) + 1;
    const pw = Math.round(d.size.width * d.scaleFactor); // настоящее разрешение монитора (пиксели) — больше на него не выводим
    const ph = Math.round(d.size.height * d.scaleFactor);
    return {
      id: d.id,
      n,
      name: d.label || '', // имя монитора из Windows («HP E232»)
      primary: d.id === primaryId,
      here: !!ctl && ctl.id === d.id,
      bx: d.bounds.x, // где стоит монитор (как в Windows: Параметры → Дисплей) — по этому и узнаём монитор
      by: d.bounds.y,
      bw: d.bounds.width,
      bh: d.bounds.height,
      pw,
      ph,
      hz: Math.round(d.displayFrequency || 0), // частота обновления (менять её умеет только Windows)
      label: `Монитор ${n}: ${d.label ? d.label + ', ' : ''}${pw}×${ph}` + (ctl && ctl.id === d.id ? ' — здесь программа' : d.id === primaryId ? ' (основной)' : ''),
    };
  }).sort((a, b) => a.n - b.n);
}

// «Показать номера»: на 3 секунды большой номер на каждом мониторе (окно без фокуса, поверх всего)
let identWins = [];
ipcMain.handle('displays:identify', () => {
  for (const w of identWins) if (!w.isDestroyed()) w.close();
  const list = listDisplays();
  identWins = screen.getAllDisplays().map((d) => {
    const it = list.find((x) => x.id === d.id) || {};
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, transparent: true, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true);
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}
      div{position:absolute;left:40px;bottom:40px;padding:20px 44px;border-radius:24px;background:rgba(0,0,0,.82);color:#fff;
      font:600 28px Segoe UI,sans-serif;border:4px solid #4da3ff}b{display:block;font-size:180px;line-height:1}</style>
      <div><b>${it.n || ''}</b>${esc(it.name || 'Монитор')} · ${it.pw}×${it.ph}${it.primary ? ' · основной' : ''}</div>`;
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    w.once('ready-to-show', () => { if (!w.isDestroyed()) w.showInactive(); });
    setTimeout(() => { if (!w.isDestroyed()) w.close(); }, 3000);
    return w;
  });
  return true;
});

/* ---------- Файлы ---------- */

function kindOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return Object.keys(EXT).find((k) => EXT[k].includes(ext));
}

function toItem(file, type, name) {
  return { path: file, name: name || path.basename(file), url: pathToFileURL(file).href, type };
}

/* ---------- NDI: поиск источников в сети по mDNS (без NDI SDK — только имена) ---------- */

// Запрос PTR для службы (бит QU — отвечать прямо нам)
function mdnsQuery(service) {
  const parts = service.split('.').map((l) => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)]));
  const head = Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([head, ...parts, Buffer.from([0, 0, 12, 0x80, 1])]);
}

// Имя из пакета DNS (со ссылками-сокращениями) → [имя, где продолжать]
function dnsName(buf, off) {
  const labels = [];
  let next = -1;
  for (let guard = 0; guard < 128; guard++) {
    const len = buf[off];
    if (len === undefined) throw new Error('обрыв');
    if ((len & 0xc0) === 0xc0) { if (next < 0) next = off + 2; off = ((len & 0x3f) << 8) | buf[off + 1]; continue; }
    if (!len) { if (next < 0) next = off + 1; break; }
    labels.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += len + 1;
  }
  return [labels.join('.'), next];
}

// Имена источников из ответа: «КОМПЬЮТЕР (Камера 1)»
function mdnsPtrs(buf, service) {
  const out = [];
  try {
    const qd = buf.readUInt16BE(4);
    const rrs = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let off = 12;
    for (let i = 0; i < qd; i++) off = dnsName(buf, off)[1] + 4;
    for (let i = 0; i < rrs; i++) {
      const [name, o] = dnsName(buf, off);
      const type = buf.readUInt16BE(o);
      const len = buf.readUInt16BE(o + 8);
      if (type === 12 && name.toLowerCase() === service) {
        const [target] = dnsName(buf, o + 10);
        out.push(target.slice(0, -(service.length + 1)));
      }
      off = o + 10 + len;
    }
  } catch { /* битый пакет — что успели, то и есть */ }
  return out;
}

function ndiFind(ms) {
  const service = '_ndi._tcp.local';
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { resolve([]); return; }
    let over = false;
    const done = () => {
      if (over) return;
      over = true;
      try { sock.close(); } catch { /* уже закрыт */ }
      resolve([...found.values()]);
    };
    sock.on('error', done);
    sock.on('message', (msg, rinfo) => {
      for (const name of mdnsPtrs(msg, service)) if (name) found.set(name, { name, host: rinfo.address });
    });
    sock.bind(0, () => {
      sock.send(mdnsQuery(service), 5353, '224.0.0.251', () => {});
      setTimeout(done, ms);
    });
  });
}

/* ---------- Обложки музыки: встроенная картинка ---------- */

async function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fd.read(b, 0, len, pos);
  return b.subarray(0, bytesRead);
}
const syncsafe = (b, p) => ((b[p] & 0x7f) << 21) | ((b[p + 1] & 0x7f) << 14) | ((b[p + 2] & 0x7f) << 7) | (b[p + 3] & 0x7f);

// Картинка из mp3 (ID3v2.2–2.4), flac или m4a/mp4; null — её нет
async function readCover(file) {
  const fd = await fs.promises.open(file, 'r');
  try {
    const head = await readAt(fd, 0, 12);
    if (head.length < 12) return null;
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const tag = await readAt(fd, 10, Math.min(syncsafe(head, 6), 40e6));
      return id3Picture(tag, head[3], head[5]);
    }
    if (head.toString('latin1', 0, 4) === 'fLaC') return await flacPicture(fd);
    if (head.toString('latin1', 4, 8) === 'ftyp') return await mp4Cover(fd);
    return null;
  } finally {
    await fd.close();
  }
}

function id3Picture(tag, ver, flags) {
  let p = 0;
  if (flags & 0x40) p = ver === 4 ? syncsafe(tag, 0) : tag.readUInt32BE(0) + 4; // расширенный заголовок
  const hl = ver === 2 ? 6 : 10;
  while (p + hl <= tag.length) {
    const id = tag.toString('latin1', p, p + (ver === 2 ? 3 : 4));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break; // дальше — пустое место
    const size = ver === 2 ? tag.readUIntBE(p + 3, 3) : ver === 4 ? syncsafe(tag, p + 4) : tag.readUInt32BE(p + 4);
    if (id === 'APIC' || id === 'PIC') {
      const body = tag.subarray(p + hl, p + hl + size);
      const enc = body[0];
      let q = 1;
      if (id === 'PIC') q += 3; else { while (q < body.length && body[q] !== 0) q += 1; q += 1; } // формат / тип файла
      q += 1; // вид картинки
      // подпись до нуля (в UTF-16 — до двух нулей)
      if (enc === 1 || enc === 2) { while (q + 1 < body.length && (body[q] || body[q + 1])) q += 2; q += 2; } else { while (q < body.length && body[q] !== 0) q += 1; q += 1; }
      if (q < body.length) return body.subarray(q);
    }
    p += hl + size;
  }
  return null;
}

async function flacPicture(fd) {
  let pos = 4;
  for (let n = 0; n < 128; n++) {
    const h = await readAt(fd, pos, 4);
    if (h.length < 4) return null;
    const len = h.readUIntBE(1, 3);
    if ((h[0] & 0x7f) === 6) {
      const b = await readAt(fd, pos + 4, len);
      let q = 4;
      q += 4 + b.readUInt32BE(q); // тип файла
      q += 4 + b.readUInt32BE(q) + 16; // подпись, размеры
      const sz = b.readUInt32BE(q);
      return b.subarray(q + 4, q + 4 + sz);
    }
    if (h[0] & 0x80) return null; // последний блок
    pos += 4 + len;
  }
  return null;
}

// m4a: moov → udta → meta → ilst → covr → data
async function mp4Cover(fd) {
  const size = (await fd.stat()).size;
  let pos = 0;
  while (pos + 8 <= size) {
    const h = await readAt(fd, pos, 16);
    let len = h.readUInt32BE(0);
    let hl = 8;
    if (len === 1) { len = Number(h.readBigUInt64BE(8)); hl = 16; } else if (len === 0) len = size - pos;
    if (len < hl) return null;
    if (h.toString('latin1', 4, 8) === 'moov') {
      if (len > 64e6) return null;
      const m = await readAt(fd, pos + hl, len - hl);
      const child = (s, e, name) => {
        for (let p = s; p + 8 <= e;) {
          const l = m.readUInt32BE(p);
          if (l < 8 || p + l > e) return null;
          if (m.toString('latin1', p + 4, p + 8) === name) return [p + 8, p + l];
          p += l;
        }
        return null;
      };
      const udta = child(0, m.length, 'udta');
      const meta = udta && child(udta[0], udta[1], 'meta');
      const ilst = meta && (child(meta[0] + 4, meta[1], 'ilst') || child(meta[0], meta[1], 'ilst'));
      const covr = ilst && child(ilst[0], ilst[1], 'covr');
      const data = covr && child(covr[0], covr[1], 'data');
      return data ? m.subarray(data[0] + 8, data[1]) : null;
    }
    pos += len;
  }
  return null;
}

function notify(text) {
  if (control && !control.isDestroyed()) control.webContents.send('media:status', text);
}

// Презентация -> картинки слайдов через Microsoft PowerPoint (только Windows)
function convertPresentation(file, width) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      return reject(new Error('импорт презентаций работает только в Windows'));
    }
    const stat = fs.statSync(file);
    const key = crypto.createHash('md5').update(file + stat.mtimeMs + stat.size + ':' + width).digest('hex');
    const outDir = path.join(app.getPath('userData'), 'slides', key);
    const num = (f) => parseInt((f.match(/\d+/) || ['0'])[0], 10);
    const list = () => (fs.existsSync(outDir)
      ? fs.readdirSync(outDir).filter((f) => /\.png$/i.test(f)).sort((a, b) => num(a) - num(b)).map((f) => path.join(outDir, f))
      : []);

    const cached = list();
    if (cached.length) return resolve(cached);
    fs.mkdirSync(outDir, { recursive: true });

    const script = [
      "$ErrorActionPreference = 'Stop'",
      "try { $ppt = New-Object -ComObject PowerPoint.Application } catch { [Console]::Error.WriteLine('NO_POWERPOINT'); exit 2 }",
      'try {',
      '  $pres = $ppt.Presentations.Open($env:CP_FILE, -1, 0, 0)',
      '  $w = [int]$env:CP_W',
      '  $h = [int]($w * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)',
      "  $pres.Export($env:CP_OUT, 'PNG', $w, $h)",
      '  $pres.Close()',
      '} finally {',
      '  if ($ppt.Presentations.Count -eq 0) { $ppt.Quit() }',
      '}',
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, CP_FILE: file, CP_OUT: outDir, CP_W: String(width) }, windowsHide: true, timeout: 300000 },
      (err, _stdout, stderr) => {
        const slides = err ? [] : list();
        if (slides.length) return resolve(slides);
        fs.rmSync(outDir, { recursive: true, force: true });
        if (/NO_POWERPOINT/.test(stderr || '')) {
          reject(new Error('для импорта презентаций нужен установленный Microsoft PowerPoint'));
        } else {
          reject(new Error('не удалось открыть презентацию'));
        }
      }
    );
  });
}

/* ---------- Ноты песни (song.sheets = [{ file, name, w, h }]): фото и PDF → JPEG-листы в userData\sheets ----------
   Имя файла — по содержимому (одинаковый лист не плодится). PDF рисует сам Windows (Windows.Data.Pdf), без сторонних программ.
   Листы уходят на телефоны группы (teamapi.js: /api/v1/sheets/…), в репозиторий — как обычные файлы программы. */
const SHEET_MAX = 2400; // длинная сторона листа, px
const SHEET_PAGES = 40; // больше страниц из одного PDF не берём
const sheetDir = () => path.join(app.getPath('userData'), 'sheets');
function pdfPages(file) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('PDF читается только в Windows'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-pdf-'));
    const script = [
      "$ErrorActionPreference = 'Stop'",
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
      "$ext = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }",
      "$asOp = ($ext | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
      "$asAct = ($ext | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]",
      'function Wait-Op($op, [Type]$t) { $k = $asOp.MakeGenericMethod($t).Invoke($null, @($op)); $k.Wait(-1) | Out-Null; $k.Result }',
      'function Wait-Act($op) { $k = $asAct.Invoke($null, @($op)); $k.Wait(-1) | Out-Null }',
      '[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]',
      '[void][Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]',
      '[void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]',
      '[void][Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]',
      '[void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]',
      'try { $src = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:CP_FILE)) ([Windows.Storage.StorageFile])',
      "  $doc = Wait-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($src)) ([Windows.Data.Pdf.PdfDocument]) } catch { [Console]::Error.WriteLine('BAD_PDF'); exit 3 }",
      '$dst = Wait-Op ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($env:CP_OUT)) ([Windows.Storage.StorageFolder])',
      '$n = [Math]::Min([int]$doc.PageCount, [int]$env:CP_MAX)',
      'for ($i = 0; $i -lt $n; $i++) {',
      '  $page = $doc.GetPage([uint32]$i)',
      '  $ro = New-Object Windows.Data.Pdf.PdfPageRenderOptions',
      '  $ro.DestinationWidth = [uint32]$env:CP_W',
      "  $f = Wait-Op ($dst.CreateFileAsync(('p' + ($i + 1) + '.png'), [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])",
      '  $s = Wait-Op ($f.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])',
      '  Wait-Act ($page.RenderToStreamAsync($s, $ro))',
      '  $s.Dispose(); $page.Dispose()',
      '}',
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, CP_FILE: file, CP_OUT: out, CP_W: String(SHEET_MAX), CP_MAX: String(SHEET_PAGES) }, windowsHide: true, timeout: 180000 },
      (err, _so, stderr) => {
        const num = (f) => parseInt((f.match(/\d+/) || ['0'])[0], 10);
        let list = [];
        try { list = fs.readdirSync(out).filter((f) => /\.png$/i.test(f)).sort((a, b) => num(a) - num(b)).map((f) => fs.readFileSync(path.join(out, f))); } catch { list = []; }
        fs.rmSync(out, { recursive: true, force: true });
        if (list.length) return resolve(list);
        reject(new Error(/BAD_PDF/.test(stderr || '') ? 'PDF не открылся (повреждён или защищён паролем)' : 'не получилось прочитать PDF' + (err && err.killed ? ' (слишком долго)' : '')));
      });
  });
}
// Картинка → лист нот (JPEG). Пустая картинка (формат не понят) — ошибка
function sheetSave(img, name) {
  if (!img || img.isEmpty()) throw new Error('картинка не открылась (подходят JPEG и PNG)');
  let { width: w, height: h } = img.getSize();
  if (Math.max(w, h) > SHEET_MAX) {
    const k = SHEET_MAX / Math.max(w, h);
    img = img.resize({ width: Math.round(w * k), height: Math.round(h * k), quality: 'best' });
    ({ width: w, height: h } = img.getSize());
  }
  const buf = img.toJPEG(86);
  fs.mkdirSync(sheetDir(), { recursive: true });
  const file = path.join(sheetDir(), crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.jpg');
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return { file, name: String(name || 'Ноты').slice(0, 120), w, h };
}
// Файл или байты (с телефона) → листы: [{ file, name, w, h }]
async function sheetsFrom({ file, buf, name, pdf }) {
  const base = String(name || (file ? path.basename(file, path.extname(file)) : 'Ноты')).replace(/\.(pdf|jpe?g|png|heic|webp)$/i, '');
  const isPdf = pdf || (file && /\.pdf$/i.test(file)) || (buf && buf.slice(0, 5).toString() === '%PDF-');
  if (!isPdf) return [sheetSave(buf ? nativeImage.createFromBuffer(buf) : nativeImage.createFromPath(file), base)];
  let src = file;
  let tmp = '';
  if (!src) { tmp = path.join(os.tmpdir(), `mps-${Date.now().toString(36)}.pdf`); fs.writeFileSync(tmp, buf); src = tmp; }
  try {
    const pages = await pdfPages(src);
    return pages.map((b, i) => sheetSave(nativeImage.createFromBuffer(b), pages.length > 1 ? `${base} — стр. ${i + 1}` : base));
  } finally { if (tmp) fs.rmSync(tmp, { force: true }); }
}

async function describeFiles(paths, opts) {
  const slideWidth = Math.min(7680, Math.max(800, Number(opts && opts.slideWidth) || 2560));
  const items = [];
  const errors = [];
  for (const p of paths) {
    const kind = kindOf(p);
    if (!kind) continue;
    if (kind === 'presentation') {
      try {
        notify(`Импорт презентации «${path.basename(p)}»… это может занять до минуты`);
        const slides = await convertPresentation(p, slideWidth);
        const base = path.basename(p, path.extname(p));
        // Для плейлистов презентация — один элемент со слайдами, для вкладки «Экран» — отдельные картинки
        if (opts && opts.groupDecks) items.push({ type: 'deck', name: base, path: p, slides: slides.map((s) => toItem(s, 'image')) });
        else slides.forEach((s, i) => items.push(toItem(s, 'image', `${base} — слайд ${i + 1}`)));
      } catch (e) {
        errors.push(`${path.basename(p)}: ${e.message}`);
      }
    } else {
      items.push(toItem(p, kind));
    }
  }
  notify('');
  return { items, errors };
}

/* ---------- Окно вывода ---------- */

function sendOutputState() {
  if (control && !control.isDestroyed()) {
    control.webContents.send('output:state', { open: !!output, displayId: outputDisplayId });
  }
}

function sendDisplays() {
  if (control && !control.isDestroyed()) control.webContents.send('displays:changed', listDisplays());
}

function closeOutput() {
  if (output && !output.isDestroyed()) output.close();
  output = null;
  outputDisplayId = null;
  sendOutputState();
  guardSync();
}

// Мониторы, на которые можно выводить: все, кроме того, где окно программы (решение владельца, не возвращать)
const outAllowed = (id) => { const c = ctlDisplay(); return !c || c.id !== Number(id); };

function openOutput(displayId) {
  const display = screen.getAllDisplays().find((d) => d.id === displayId);
  if (!display) return;
  if (!outAllowed(display.id)) return 'here'; // здесь окно программы
  if (output && !output.isDestroyed()) output.destroy();

  const b = display.bounds;
  outputDisplayId = display.id;
  output = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false,
    show: false,
    skipTaskbar: true,
    minimizable: false, // Win+D не сворачивает показ (guardWin)
    backgroundColor: '#000000',
    webPreferences,
  });
  const win = output;
  guardWin(win, display.id);
  output.setMenuBarVisibility(false);
  output.loadFile('output.html');
  // showInactive: окно вывода не забирает клавиатуру у окна программы (включили проектор посреди набора текста)
  output.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.showInactive();
    win.setFullScreen(true);
    guardSync();
  });
  output.webContents.on('did-finish-load', () => {
    output.webContents.send('output:settings', outputSettings);
    replayTo(output);
  });
  output.on('closed', () => {
    if (output !== win) return; // старое окно, уже заменённое новым
    output = null;
    outputDisplayId = null;
    sendOutputState();
    guardSync();
  });
  sendOutputState();
  guardSync();
}

// Новое окно вывода: всё, что сейчас на экране — без переходов
function replayTo(win) {
  const wc = win.webContents;
  if (screensCfg) wc.send('screen:config', screensCfg);
  if (screenStage) wc.send('screen:stage', screenStage);
  if (currentLayers) wc.send('output:layers', { defs: currentLayers });
  for (const [layer, content] of Object.entries(current)) wc.send('output:show', { content, layer, transition: { type: 'none', ms: 0 } });
  if (currentInk) wc.send('output:ink', currentInk);
  if (currentView) wc.send('output:view', { view: currentView, ms: 0 });
  // Громкость и устройство звука видео — новому окну вывода тоже
  for (const m of Object.values(videoAudio)) wc.send('output:video', m);
}
const videoAudio = {}; // последние команды 'volume' и 'sink' проигрывателя

/* ---------- Экраны (Screens): у каждого экрана свои выходы — монитор, окно, NDI ----------
   Экран «Основной» выводится как раньше (Настройки → Экран вывода, окно output), его дополнительные выходы и все
   остальные экраны — окна из screenWins. Все окна получают одно и то же (слои, рисунок), а что показать — решает экран. */

const floatWins = new Map(); // id экрана или 'scene:id' → плавающее окно (правая кнопка по «Предпросмотру» → «Открыть в отдельном окне»)
const outWins = () => [output, ...[...screenWins.values()].map((x) => x.win), ...floatWins.values(), rmMirror].filter((w) => w && !w.isDestroyed());

// Плавающее окно: экран или сцена в обычном окне поверх остальных, без звука; повторный вызов — показать уже открытое
function openFloatWin({ id, name }) {
  const sid = String(id || 'main');
  const old = floatWins.get(sid);
  if (old && !old.isDestroyed()) { if (old.isMinimized()) old.restore(); old.show(); old.focus(); return; }
  const s = (screensCfg && Array.isArray(screensCfg.screens) ? screensCfg.screens.find((z) => z.id === sid) : null) || {};
  const W = Number(s.w) || 1920;
  const H = Number(s.h) || 1080;
  const k = Math.min(640 / W, 480 / H, 1);
  const win = new BrowserWindow({
    width: Math.round(W * k), height: Math.round(H * k), useContentSize: true, alwaysOnTop: true, icon: APP_ICON,
    title: `${name || s.name || 'Экран'} — ${SHORT_NAME}`, autoHideMenuBar: true, backgroundColor: '#000000', webPreferences,
  });
  win.setMenuBarVisibility(false);
  win.webContents.setAudioMuted(true);
  win.loadFile('output.html', { query: { screen: sid, win: '1' } });
  win.webContents.on('did-finish-load', () => replayTo(win));
  win.on('closed', () => { if (floatWins.get(sid) === win) floatWins.delete(sid); });
  focusBackOnClose(win);
  floatWins.set(sid, win);
}
const toOutputs = (channel, msg) => outWins().forEach((w) => w.webContents.send(channel, msg));

// Какие выходы должны быть открыты сейчас: [{ key, s, o }]
function wantedOutputs() {
  const list = [];
  if (!screensCfg || !Array.isArray(screensCfg.screens)) return list;
  const disp = screen.getAllDisplays();
  for (const s of screensCfg.screens) {
    if (!s || !s.enabled) continue;
    (Array.isArray(s.outputs) ? s.outputs : []).forEach((o, i) => {
      if (!o || o.off) return;
      if (o.kind === 'display' && !disp.some((d) => d.id === Number(o.display))) return; // монитор не подключён — подождём
      if (o.kind === 'display' && !outAllowed(o.display)) return; // здесь окно программы — не выводим, пока его не перенесут
      if (o.kind === 'ndi' && !ndi.available()) return;
      const extra = o.kind === 'ndi' ? `|${o.name || s.name}|${s.w}x${s.h}|${s.hz || 30}|${s.alpha ? 'a' : ''}` : o.kind === 'display' ? '|' + o.display : s.alpha ? '|a' : '';
      list.push({ key: `${s.id}|${i}|${o.kind}${extra}`, s, o });
    });
  }
  return list;
}

function sendScreensState() {
  if (!control || control.isDestroyed()) return;
  control.webContents.send('screens:state', [...screenWins.entries()].map(([key, x]) => ({ key, screen: x.screen, kind: x.kind })));
}

function syncScreens() {
  const want = wantedOutputs();
  const keys = new Set(want.map((w) => w.key));
  for (const [key, x] of screenWins) if (!keys.has(key)) { screenWins.delete(key); closeScreenWin(x); }
  for (const w of want) if (!screenWins.has(w.key)) openScreenWin(w);
  for (const x of screenWins.values()) {
    if (x.kind === 'window' && !x.win.isDestroyed()) {
      const s = screensCfg.screens.find((z) => z.id === x.screen);
      if (s) x.win.setTitle(`${s.name || 'Экран'} — ${SHORT_NAME}`);
    }
  }
  sendScreensState();
  guardSync();
}

function closeScreenWin(x) {
  if (x.ndi) x.ndi.close();
  if (x.timer) clearInterval(x.timer);
  if (!x.win.isDestroyed()) x.win.destroy();
}

function openScreenWin({ key, s, o }) {
  const query = { screen: s.id };
  let win;
  const x = { win: null, screen: s.id, kind: o.kind, display: o.kind === 'display' ? Number(o.display) : null };
  if (o.kind === 'display') {
    const d = screen.getAllDisplays().find((z) => z.id === Number(o.display));
    const b = d.bounds;
    win = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, show: false, skipTaskbar: true, minimizable: false, backgroundColor: '#000000', webPreferences });
    guardWin(win, d.id); // Win+D не сворачивает показ
    win.once('ready-to-show', () => { if (win.isDestroyed()) return; win.showInactive(); win.setFullScreen(true); guardSync(); }); // клавиатура остаётся у окна программы
  } else if (o.kind === 'ndi') {
    // NDI-выход: невидимое окно рисует экран в своём разрешении, кадры уходят в сеть (ndi.js)
    const W = Math.max(16, Math.min(7680, Number(s.w) || 1920));
    const H = Math.max(16, Math.min(4320, Number(s.h) || 1080));
    const fps = Math.max(1, Math.min(60, Number(s.hz) || 30));
    // Альфа-канал (s.alpha): прозрачное окно — в кадре BGRA пустые места прозрачные (OBS, vMix видят только текст)
    const alpha = !!s.alpha;
    if (alpha) query.alpha = '1';
    // Масштаб Windows (125–175 %): невидимое окно рисует кадр в «размер окна × масштаб», а размер окна Windows урезает до экрана —
    // при 175 % окно 1920×1080 давало кадр 2881×1717 с другими пропорциями. Поэтому окно — W/масштаб × H/масштаб (кадр ≈ W × H),
    // размер ставится после создания (так Windows не урезает его до экрана), лишние 1–2 пикселя кадра обрезаются в put
    const sf = screen.getPrimaryDisplay().scaleFactor || 1;
    const cw = Math.ceil(W / sf);
    const ch = Math.ceil(H / sf);
    win = new BrowserWindow({ width: cw, height: ch, show: false, frame: false, useContentSize: true, transparent: alpha, backgroundColor: alpha ? '#00000000' : '#000000', webPreferences: { ...webPreferences, offscreen: true } });
    win.setContentSize(cw, ch);
    win.webContents.setAudioMuted(true);
    win.webContents.setFrameRate(fps);
    x.ndi = ndi.sender(o.name || `MP Show — ${s.name || 'Экран'}`);
    let last = null;
    let lastAt = 0;
    const put = (img) => {
      let sz = img.getSize();
      if (!sz.width || !sz.height) return;
      // Кадр в NDI — ровно разрешение экрана/сцены: больше — обрезать поровну с краёв, меньше — растянуть
      if (sz.width !== W || sz.height !== H) {
        img = sz.width >= W && sz.height >= H
          ? img.crop({ x: Math.floor((sz.width - W) / 2), y: Math.floor((sz.height - H) / 2), width: W, height: H })
          : img.resize({ width: W, height: H, quality: 'good' });
        sz = img.getSize();
      }
      last = { buf: img.toBitmap(), w: sz.width, h: sz.height };
      lastAt = Date.now();
      if (x.ndi) x.ndi.frame(last.buf, last.w, last.h, fps);
    };
    win.webContents.on('paint', (_e, _dirty, img) => put(img));
    // Картинка не меняется — окно не рисует; приёмникам NDI нужен поток, повторяем последний кадр
    x.timer = setInterval(() => { if (last && x.ndi && Date.now() - lastAt > 400) { lastAt = Date.now(); x.ndi.frame(last.buf, last.w, last.h, fps); } }, 200);
  } else if (s.alpha) {
    // Прозрачный фон: окно без рамки и без фона — сквозь него видно рабочий стол и другие окна, остаются текст и элементы.
    // Прозрачное окно в Windows нельзя растянуть мышью — переносится за любое место (html.alpha.win в output.html)
    const W = Number(s.w) || 1920;
    const H = Number(s.h) || 1080;
    const k = Math.min(960 / W, 720 / H, 1);
    win = new BrowserWindow({
      width: Math.round(W * k), height: Math.round(H * k), useContentSize: true, title: `${s.name || 'Экран'} — ${SHORT_NAME}`, icon: APP_ICON,
      frame: false, transparent: true, resizable: false, hasShadow: false, backgroundColor: '#00000000', webPreferences,
    });
    query.win = '1';
    query.alpha = '1';
  } else {
    // Обычное окно: можно растянуть, перенести на любой монитор, захватить в OBS
    const W = Number(s.w) || 1920;
    const H = Number(s.h) || 1080;
    const k = Math.min(960 / W, 720 / H, 1);
    win = new BrowserWindow({
      width: Math.round(W * k), height: Math.round(H * k), useContentSize: true, title: `${s.name || 'Экран'} — ${SHORT_NAME}`, icon: APP_ICON,
      autoHideMenuBar: true, backgroundColor: '#000000', webPreferences,
    });
    query.win = '1';
  }
  x.win = win;
  focusBackOnClose(win);
  win.setMenuBarVisibility(false);
  win.loadFile('output.html', { query });
  win.webContents.on('did-finish-load', () => replayTo(win));
  win.on('closed', () => {
    // Окно закрыли руками — выход остаётся выключенным до следующей правки экрана
    if (screenWins.get(key) === x) { screenWins.delete(key); if (x.ndi) x.ndi.close(); if (x.timer) clearInterval(x.timer); sendScreensState(); }
    if (x.kind === 'display') guardSync();
  });
  screenWins.set(key, x);
}

/* ---------- Заставка (screen saver) от выгорания OLED ----------
   Никто не трогает мышь и клавиатуру N минут — на мониторе окна оператора поверх всего открывается чёрное окно
   с тусклыми часами, которые переползают по экрану (saver.html). Экраны показа (зал, сцена, NDI) не трогаются:
   если на мониторе оператора открыт вывод — заставки нет. Любое движение мыши или клавиша — заставка закрывается. */
let saverCfg = { on: false, min: 5, kind: 'clock' };
let saverWin = null;
let saverTimer = null;
let saverSince = 0; // когда открыли (первые 1,5 с не закрываем — для «Проверить»)

function saverSet(cfg) {
  const k = String((cfg && cfg.kind) || '');
  saverCfg = { on: !!(cfg && cfg.on), min: Math.max(1, Math.min(240, Number(cfg && cfg.min) || 5)), kind: k === 'black' ? k : 'clock' };
  if (saverTimer) clearInterval(saverTimer);
  saverTimer = setInterval(saverTick, 1000);
  if (!saverCfg.on) saverHide();
  else saverHide(); // поменяли вид — откроется заново уже новым
}

// Монитор окна оператора — если на нём нет окна вывода
function saverDisplay() {
  if (!control || control.isDestroyed() || control.isMinimized()) return null;
  const d = screen.getDisplayMatching(control.getBounds());
  if (!d) return null;
  if (output && !output.isDestroyed() && outputDisplayId === d.id) return null;
  for (const x of screenWins.values()) if (x.kind === 'display' && x.display === d.id && !x.win.isDestroyed()) return null;
  return d;
}

function saverShow(test) {
  if (saverWin && !saverWin.isDestroyed()) return;
  const d = saverDisplay();
  if (!d) return test ? 'busy' : undefined;
  const b = d.bounds;
  saverWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, show: false, skipTaskbar: true, focusable: true,
    backgroundColor: '#000000', webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  saverWin.setAlwaysOnTop(true, 'screen-saver');
  saverWin.setMenuBarVisibility(false);
  saverWin.loadFile('saver.html', { query: { kind: saverCfg.kind } });
  const win = saverWin;
  saverWin.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.setFullScreen(true);
  });
  saverWin.on('closed', () => { if (saverWin === win) saverWin = null; });
  saverSince = Date.now();
  saverFastStart(test);
  return 'ok';
}

// Пока заставка открыта — проверка каждые 50 мс: GetLastInputInfo меняется от любого движения мыши или клавиши
// (powerMonitor.getSystemIdleTime считает целыми секундами — выход был с задержкой до 2 с)
let saverFast = null;
let saverInput0 = 0; // время последнего ввода, когда заставку открыли
const lastInputTick = () => {
  const api = guardApi();
  if (!api || !api.lastInput) return null;
  try { const p = { cbSize: 8, dwTime: 0 }; return api.lastInput(p) ? p.dwTime : null; } catch { return null; }
};
function saverFastStart(test) {
  if (saverFast) clearInterval(saverFast);
  saverInput0 = lastInputTick();
  if (saverInput0 === null) { saverFast = null; return; } // нет koffi — остаётся проверка раз в секунду
  saverFast = setInterval(() => {
    if (!saverWin || saverWin.isDestroyed()) { clearInterval(saverFast); saverFast = null; return; }
    if (test && Date.now() - saverSince < 600) { saverInput0 = lastInputTick(); return; } // «Проверить»: щелчок по кнопке не в счёт
    if (lastInputTick() !== saverInput0) saverHide();
  }, 50);
}

function saverHide() {
  if (saverFast) { clearInterval(saverFast); saverFast = null; }
  if (saverWin && !saverWin.isDestroyed()) {
    const had = saverWin.isFocused(); // фокус был у заставки, а не у другой программы
    if (had) fixFocus(control);
    saverWin.destroy();
    if (had) fixFocus(control);
  }
  saverWin = null;
}

function saverTick() {
  const idle = powerMonitor.getSystemIdleTime(); // секунды без мыши и клавиатуры во всей Windows
  if (saverWin && !saverWin.isDestroyed()) {
    // Пошевелили мышью или нажали клавишу — закрыть; вывод открыли на этом мониторе — тоже
    if ((idle < 1 && Date.now() - saverSince > 1500) || !saverDisplay()) saverHide(); // фокус окну программы вернёт saverHide
    return;
  }
  if (saverCfg.on && idle >= saverCfg.min * 60) saverShow(false);
}

/* ---------- Защита экранов показа: Win+D и курсор ----------
   Экран показа — монитор, на котором открыто окно вывода («Зал», «Сцена»), кроме монитора с окном программы
   (проверка на одном мониторе — там вывод остаётся обычным окном).
   1) Win+D / «Свернуть всё» сворачивает программу, но не показ: окна вывода без кнопки «свернуть» и поверх всех окон;
      если Windows всё же свернула — тут же возвращаем, не забирая фокус у окна программы. Всегда, без настройки.
   2) Курсор не уходит на экраны показа (Настройки → Показ и звук, guardCursor): ClipCursor — рамка вокруг остальных
      мониторов. Windows сама иногда снимает рамку (Alt+Tab, UAC) — ставим заново раз в 250 мс. Курсор оказался на экране
      показа (включили «Зал», когда он был там) — переносим в центр монитора программы. Мониторы стоят так, что рамка
      задела бы экран показа, — рамки нет, курсор проверяется 60 раз в секунду и возвращается назад. */
let guardCfg = { cursor: true };
let guardTimer = null; // проверка раз в 250 мс, пока открыт хоть один вывод на монитор
let guardFast = null; // частая проверка курсора, когда рамкой не обойтись
let guardClipped = false;
let guardOkPos = null; // последнее место курсора не на экране показа
let user32 = null; // ClipCursor/GetCursorPos/SetCursorPos через koffi (как в ndi.js); false — недоступно

function guardApi() {
  if (user32 !== null) return user32;
  user32 = false;
  if (process.platform !== 'win32') return user32;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    koffi.struct('MPS_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    koffi.struct('MPS_POINT', { x: 'int32', y: 'int32' });
    koffi.struct('MPS_LII', { cbSize: 'uint32', dwTime: 'uint32' });
    user32 = {
      clip: lib.func('bool __stdcall ClipCursor(const MPS_RECT *r)'),
      getClip: lib.func('bool __stdcall GetClipCursor(_Out_ MPS_RECT *r)'),
      getPos: lib.func('bool __stdcall GetCursorPos(_Out_ MPS_POINT *p)'),
      setPos: lib.func('bool __stdcall SetCursorPos(int x, int y)'),
      lastInput: lib.func('bool __stdcall GetLastInputInfo(_Inout_ MPS_LII *p)'), // когда последний раз трогали мышь/клавиатуру (мс)
    };
  } catch (e) {
    console.warn('Защита курсора недоступна:', e.message);
  }
  return user32;
}

// Окна вывода на мониторах: [{ win, display }]
function guardWins() {
  const list = [];
  if (output && !output.isDestroyed()) list.push({ win: output, display: outputDisplayId });
  for (const x of screenWins.values()) if (x.kind === 'display' && x.win && !x.win.isDestroyed()) list.push({ win: x.win, display: x.display });
  return list;
}

const ctlDisplay = () => (control && !control.isDestroyed() ? screen.getDisplayMatching(control.getBounds()) : null);

// Окно вывода на мониторе: без кнопки «свернуть»; свернулось (Win+D) — сразу назад, без фокуса
function guardWin(win, displayId) {
  win.setMinimizable(false);
  win.on('minimize', () => setTimeout(() => guardRestore(win, displayId), 0));
}
function guardRestore(win, displayId) {
  if (win.isDestroyed() || !win.isMinimized()) return;
  const ctl = ctlDisplay();
  if (ctl && ctl.id === displayId) return; // вывод на мониторе программы — пусть сворачивается
  win.showInactive();
  if (!win.isFullScreen()) win.setFullScreen(true);
}

// Открыли/закрыли вывод, поменяли настройку — включить или выключить проверку
function guardSync() {
  const any = guardWins().length > 0;
  if (any && !guardTimer) guardTimer = setInterval(guardTick, 250);
  if (!any && guardTimer) { clearInterval(guardTimer); guardTimer = null; }
  guardTick();
}

function guardTick() {
  const ctl = ctlDisplay();
  const shows = new Set();
  for (const { win, display } of guardWins()) {
    const mine = !!ctl && ctl.id === display;
    if (win.isAlwaysOnTop() === mine) win.setAlwaysOnTop(!mine);
    if (mine) continue;
    shows.add(display);
    guardRestore(win, display);
  }
  guardCursor(shows, ctl);
}

// Снять рамку и частую проверку
function guardFree() {
  if (guardFast) { clearInterval(guardFast); guardFast = null; }
  if (guardClipped && user32) user32.clip(null);
  guardClipped = false;
  guardOkPos = null;
}

function guardCursor(shows, ctl) {
  const api = guardCfg.cursor && shows.size && ctl ? guardApi() : null;
  if (!api) return guardFree();
  const disp = screen.getAllDisplays();
  const phys = (d) => screen.dipToScreenRect(null, d.bounds); // в пикселях экрана — их понимают ClipCursor и SetCursorPos
  const bad = disp.filter((d) => shows.has(d.id)).map(phys);
  const ok = disp.filter((d) => !shows.has(d.id)).map(phys);
  if (!bad.length || !ok.length) return guardFree();
  const inBad = (p) => bad.some((r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height);
  const c = phys(ctl);
  const home = { x: Math.round(c.x + c.width / 2), y: Math.round(c.y + c.height / 2) };
  const p = {};
  if (api.getPos(p) && inBad(p)) api.setPos(home.x, home.y); // курсор был на экране показа — в центр монитора программы
  // Рамка — прямоугольник вокруг остальных мониторов
  const box = {
    left: Math.min(...ok.map((r) => r.x)), top: Math.min(...ok.map((r) => r.y)),
    right: Math.max(...ok.map((r) => r.x + r.width)), bottom: Math.max(...ok.map((r) => r.y + r.height)),
  };
  const cross = bad.some((r) => r.x < box.right && r.x + r.width > box.left && r.y < box.bottom && r.y + r.height > box.top);
  if (!cross) {
    if (guardFast) { clearInterval(guardFast); guardFast = null; }
    const now = {};
    api.getClip(now);
    if (now.left !== box.left || now.top !== box.top || now.right !== box.right || now.bottom !== box.bottom) api.clip(box);
    guardClipped = true;
    return;
  }
  // Рамкой не обойтись (экран показа между мониторами) — возвращаем курсор назад, как только он туда попал
  if (guardClipped) { api.clip(null); guardClipped = false; }
  if (guardFast) clearInterval(guardFast);
  guardFast = setInterval(() => {
    const q = {};
    if (!api.getPos(q)) return;
    if (!inBad(q)) { guardOkPos = q; return; }
    const back = guardOkPos && !inBad(guardOkPos) ? guardOkPos : home;
    api.setPos(back.x, back.y);
  }, 16);
}

/* ---------- Окно «Картинка» (editor.html): правка фото; слайды — в редакторе тем главного окна ---------- */

// payload: { image, target, ui } — окно правит копию картинки,
// а по «Сохранить» отдаёт результат окну оператора, которое хранит библиотеку
function openEditor(payload) {
  if (editor && !editor.isDestroyed()) {
    editor.webContents.send('editor:load', payload);
    if (editor.isMinimized()) editor.restore();
    editor.focus();
    return;
  }
  editor = new BrowserWindow({
    width: 1400, height: 880, minWidth: 1000, minHeight: 640,
    backgroundColor: '#051822',
    autoHideMenuBar: true,
    title: 'Картинка — ' + SHORT_NAME,
    icon: APP_ICON,
    webPreferences,
  });
  keepKeyboard(editor);
  focusBackOnClose(editor);
  editor.loadFile('editor.html');
  editor.webContents.once('did-finish-load', () => editor.webContents.send('editor:load', payload));
  editor.on('closed', () => { editor = null; });
}

// Безопасное имя файла для сохранённой картинки
const safeName = (s) => String(s || 'картинка').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

let skipCloseAsk = false; // закрыть без вопроса (установка обновления)
function createControl() {
  control = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1000, minHeight: 600,
    backgroundColor: '#0F1420', // цвет заставки — окно открывается без вспышки
    icon: APP_ICON,
    autoHideMenuBar: true,
    title: SHORT_NAME,
    webPreferences,
  });
  // Панель задач Windows: короткое имя и наш значок (и у закреплённой кнопки).
  // Значок закреплённой кнопки Windows читает сама, когда программа закрыта, а внутрь app.asar
  // она заглянуть не может (был «пустой файл») — в установленной программе берём значок из самого exe.
  if (process.platform === 'win32') {
    const args = app.isPackaged ? '' : ` "${app.getAppPath()}"`;
    control.setAppDetails({
      appId: APP_ID, appIconPath: app.isPackaged ? process.execPath : APP_ICON, appIconIndex: 0,
      relaunchCommand: `"${process.execPath}"${args}`, relaunchDisplayName: SHORT_NAME,
    });
  }
  keepKeyboard(control);
  control.loadFile('index.html');
  // Окно программы перенесли на другой монитор: там выводить нельзя — выходы экранов оттуда уходят (и возвращаются,
  // когда окно уберут), вывод зала закрывается; список мониторов в окне программы обновляется
  control.on('moved', () => {
    if (output && !output.isDestroyed() && !outAllowed(outputDisplayId)) closeOutput();
    syncScreens();
    sendDisplays();
  });
  // Перед выходом спрашиваем, чтобы случайно не закрыть программу посреди служения
  let confirmed = false;
  let hung = false; // окно программы не отвечает — закрываем без вопроса
  control.on('unresponsive', () => { hung = true; });
  control.on('responsive', () => { hung = false; });
  control.on('close', (e) => {
    if (confirmed || skipCloseAsk) return;
    // Окно программы зависло или не загрузилось — спросить некому, закрываем
    const wc = control.webContents;
    if (wc.isCrashed() || wc.isLoading() || hung) return;
    e.preventDefault();
    // Свой вопрос в окне программы (renderer.js: onAskClose) — без системного звука Windows
    if (control.isMinimized()) control.restore();
    control.focus();
    wc.send('app:ask-close');
  });
  // Ответ «Закрыть программу» из своего окна вопроса
  ipcMain.removeHandler('app:close-ok');
  ipcMain.handle('app:close-ok', () => {
    if (!control || control.isDestroyed()) return;
    confirmed = true;
    control.close();
  });
  control.on('closed', () => {
    control = null;
    if (guardTimer) { clearInterval(guardTimer); guardTimer = null; }
    guardFree(); // курсор снова ходит везде
    if (editor && !editor.isDestroyed()) editor.destroy();
    for (const x of screenWins.values()) closeScreenWin(x);
    screenWins.clear();
    for (const w of floatWins.values()) if (!w.isDestroyed()) w.destroy();
    floatWins.clear();
    app.quit();
  });
}

/* Починка ярлыков Windows (панель задач, «Пуск», рабочий стол) — при каждом запуске установленной программы.
   Старые версии называли окно в Windows иначе, чем ярлыки установщика, и давали закреплённой кнопке значок
   из app.asar: после закрытия кнопка становилась «пустым файлом», а после обновления могла не запускаться.
   Чиним только свои ярлыки (ведут на multiplayerSHOW.exe): путь к exe, значок из exe, имя APP_ID.
   Ярлык другой установленной копии (её exe на месте) не трогаем. */
function fixShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const exe = process.execPath;
  const exeName = path.basename(exe).toLowerCase();
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const roam = app.getPath('appData');
  const pinned = path.join(roam, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned');
  const dirs = [path.join(pinned, 'TaskBar'), path.join(pinned, 'StartMenu'),
    path.join(roam, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), app.getPath('desktop')];
  let fixed = 0;
  for (const dir of dirs) {
    let names;
    try { names = fs.readdirSync(dir).filter((n) => /\.lnk$/i.test(n)); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      let l;
      try { l = shell.readShortcutLink(file); } catch { continue; }
      const t = l.target || '';
      if (!t || path.basename(t).toLowerCase() !== exeName) continue; // чужой ярлык
      if (!same(t, exe) && fs.existsSync(t)) continue; // другая копия программы
      // значок внутри app.asar Windows не видит (проверка до existsSync: Electron «видит» файлы в asar)
      const iconBad = !!l.icon && (/\.asar([\\/]|$)/i.test(l.icon) || !fs.existsSync(l.icon));
      if (same(t, exe) && l.appUserModelId === APP_ID && !iconBad) continue; // всё в порядке
      try {
        shell.writeShortcutLink(file, 'update', { target: exe, cwd: path.dirname(exe), icon: exe, iconIndex: 0, appUserModelId: APP_ID });
        fixed++;
      } catch { /* нет прав на ярлык — пропускаем */ }
    }
  }
  // Windows перечитает значки (иначе до перезагрузки может показывать старый «пустой»)
  if (fixed) execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe'), ['-show'], () => {});
}

app.whenReady().then(() => {
  createControl();
  setTimeout(() => { try { fixShortcuts(); } catch { /* не мешать работе */ } }, 5000);

  const onDisplaysChanged = () => {
    sendDisplays();
    // Если выбранный монитор отключили — закрываем вывод
    if (output && !screen.getAllDisplays().some((d) => d.id === outputDisplayId)) closeOutput();
    syncScreens(); // выходы экранов: монитор отключили — окно закрывается, подключили снова — открывается
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', sendDisplays);

  ipcMain.handle('displays:get', () => listDisplays());

  ipcMain.handle('media:pick', async (_e, opts) => {
    const res = await dialog.showOpenDialog(control, {
      title: 'Добавить файлы',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Все поддерживаемые файлы', extensions: ALL_EXT },
        { name: 'Фото и SVG', extensions: EXT.image },
        { name: 'Видео', extensions: EXT.video },
        { name: 'Презентации', extensions: EXT.presentation },
        { name: 'Музыка', extensions: EXT.audio },
      ],
    });
    return res.canceled ? { items: [], errors: [] } : describeFiles(res.filePaths, opts);
  });

  ipcMain.handle('media:describe', (_e, paths, opts) => describeFiles(paths, opts));

  ipcMain.handle('output:open', (_e, displayId) => openOutput(displayId));
  ipcMain.handle('output:close', () => closeOutput());

  // Заставка от выгорания OLED (Настройки → Показ): только на мониторе окна оператора
  ipcMain.handle('saver:set', (_e, cfg) => saverSet(cfg));
  ipcMain.handle('saver:test', () => saverShow(true));
  // «Настроить…» у заставки Windows — её собственное окно настроек (текст, папка с фото и т. п.)
  // Защита экранов показа (Настройки → Показ и звук): не пускать курсор на мониторы вывода
  ipcMain.handle('guard:set', (_e, cfg) => { guardCfg = { cursor: !(cfg && cfg.cursor === false) }; guardSync(); });
  app.on('will-quit', guardFree);

  ipcMain.handle('output:settings', (_e, st) => {
    outputSettings = { resW: Number(st.resW) || 0, resH: Number(st.resH) || 0 };
    if (output && !output.isDestroyed()) output.webContents.send('output:settings', outputSettings);
  });

  ipcMain.handle('output:show', (_e, payload) => {
    current[payload.layer || ''] = payload.content;
    toOutputs('output:show', payload);
  });

  ipcMain.handle('output:clear', (_e, payload) => {
    if (payload && payload.layer) delete current[payload.layer]; else current = {};
    toOutputs('output:clear', payload || {});
  });

  // Слои: порядок, видимость, прозрачность, громкость ({ defs }) или команда слою ({ layer, cmd: 'play'|'pause' })
  ipcMain.handle('output:layers', (_e, msg) => {
    if (msg && Array.isArray(msg.defs)) currentLayers = msg.defs;
    toOutputs('output:layers', msg || {});
  });

  // Проигрыватель в окне оператора: пауза, перемотка, громкость видео на выводе
  ipcMain.handle('output:video', (_e, msg) => {
    msg = msg || {};
    if (msg.cmd === 'volume' || msg.cmd === 'sink') videoAudio[msg.cmd] = msg;
    return toOutputs('output:video', msg);
  });

  // opts.animFrom — с какой фигуры начинается новое (его выводят с анимацией прорисовки)
  ipcMain.handle('output:ink', (_e, shapes, opts) => {
    currentInk = Array.isArray(shapes) && shapes.length ? shapes : null;
    const anim = opts && Number.isInteger(opts.animFrom) && currentInk;
    toOutputs('output:ink', anim ? { shapes: currentInk, animFrom: opts.animFrom } : currentInk);
  });

  // Крупный план (Быстрая анимация): view = { x, y, z } или null — весь слайд; ms — длительность наплыва
  ipcMain.handle('output:view', (_e, view, ms) => {
    currentView = view && view.z > 1 ? { x: +view.x, y: +view.y, z: +view.z } : null;
    toOutputs('output:view', { view: currentView, ms: Math.max(0, Number(ms) || 0) });
  });

  /* ---------- Экраны и сцены ---------- */

  // Настройки всех экранов и применённые сцены: окна открываются/закрываются, каждому — новые настройки
  ipcMain.handle('screens:config', (_e, cfg) => {
    screensCfg = cfg && typeof cfg === 'object' ? cfg : null;
    syncScreens();
    if (screensCfg) toOutputs('screen:config', screensCfg);
  });
  ipcMain.handle('screens:stage', (_e, info) => {
    screenStage = info || null;
    toOutputs('screen:stage', screenStage);
  });
  ipcMain.handle('screens:float', (_e, m) => openFloatWin(m || {}));
  ipcMain.handle('screens:state', () => [...screenWins.entries()].map(([key, x]) => ({ key, screen: x.screen, kind: x.kind })));
  ipcMain.handle('screens:focus', (_e, key) => {
    const x = screenWins.get(key);
    if (x && !x.win.isDestroyed() && x.kind === 'window') { if (x.win.isMinimized()) x.win.restore(); x.win.focus(); }
  });

  /* ---------- Редактор ---------- */

  ipcMain.handle('editor:open', (_e, payload) => openEditor(payload));

  // Редактор сохранил песню, слайды, темы или картинку — передаём окну оператора
  ipcMain.handle('editor:save', (_e, msg) => {
    if (control && !control.isDestroyed()) control.webContents.send('editor:saved', msg);
  });

  // Окно оператора поменяло темы — редактор должен знать
  ipcMain.handle('editor:themes', (_e, themes) => {
    if (editor && !editor.isDestroyed()) editor.webContents.send('editor:themes', themes);
  });

  ipcMain.handle('file:pick', async (e, opts) => {
    const kinds = (opts && opts.kinds) || ['image'];
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: (opts && opts.title) || 'Выбрать файл',
      properties: ['openFile'].concat(opts && opts.multi ? ['multiSelections'] : []),
      filters: [{ name: 'Подходящие файлы', extensions: kinds.flatMap((k) => EXT[k] || []) }],
    });
    return res.canceled ? [] : res.filePaths.map((p) => toItem(p, kindOf(p)));
  });

  // Картинка для редактора в виде data: URL (картинку с file:// холст не дал бы сохранить)
  ipcMain.handle('image:load', (_e, file) => {
    const ext = path.extname(String(file)).slice(1).toLowerCase();
    if (!EXT.image.includes(ext)) return null;
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    try { return `data:${mime};base64,` + fs.readFileSync(file).toString('base64'); } catch { return null; }
  });

  // Картинка из редактора: в папку программы или (saveAs) куда скажет пользователь
  ipcMain.handle('image:save', async (e, { dataUrl, name, saveAs }) => {
    const buf = Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');
    let file;
    if (saveAs) {
      const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        title: 'Сохранить картинку', defaultPath: safeName(name) + '.png', filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (res.canceled || !res.filePath) return null;
      file = res.filePath;
    } else {
      const dir = path.join(app.getPath('userData'), 'images');
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, `${safeName(name)}-${Date.now().toString(36)}.png`);
    }
    fs.writeFileSync(file, buf);
    return toItem(file, 'image');
  });

  /* ---------- Аудиоредактор (audioeditor.js): прочитать файл, сохранить готовый WAV ---------- */
  ipcMain.handle('audio:read', (_e, file) => {
    try { return fs.readFileSync(file); } catch { return null; }
  });
  // Исходник не трогаем: обычное сохранение — копией в media/; saveAs — куда скажет пользователь (dir — папка по умолчанию)
  ipcMain.handle('audio:save', async (e, { bytes, name, saveAs, dir }) => {
    let file;
    if (saveAs) {
      const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        title: 'Сохранить аудио', defaultPath: path.join(dir || app.getPath('music'), safeName(name) + '.wav'),
        filters: [{ name: 'WAV', extensions: ['wav'] }],
      });
      if (res.canceled || !res.filePath) return null;
      file = res.filePath;
    } else {
      const d = path.join(app.getPath('userData'), 'media');
      fs.mkdirSync(d, { recursive: true });
      file = path.join(d, `${safeName(name)}-${Date.now().toString(36)}.wav`);
    }
    try { fs.writeFileSync(file, Buffer.from(bytes)); } catch (err) { return { error: String(err.message || err) }; }
    return toItem(file, 'audio', saveAs ? path.basename(file).replace(/\.wav$/i, '') : String(name || 'Аудио'));
  });

  /* ---------- Данные: репозиторий (ниже) и старые резервные копии ----------
     Старая копия — папка «multiplayerSHOW — копия <дата>» с manifest.json, local.json, library.json,
     bibles/ и media/. Делать их больше нельзя (вместо них репозиторий), но восстановить — можно. */

  ipcMain.handle('data:open', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('data:path', () => app.getPath('userData'));
  ipcMain.handle('app:version', () => app.getVersion());

  /* ---------- Обновление программы: новые версии с GitHub (Releases), только в установленной программе.
     Скачивается само, ставится при закрытии программы или по кнопке «Перезапустить и обновить». ---------- */
  let upd = { state: app.isPackaged ? '' : 'dev' };
  let au = null;
  const updSend = (s) => {
    upd = { ...upd, ...s };
    if (control && !control.isDestroyed()) control.webContents.send('update:state', upd);
  };
  if (app.isPackaged) {
    try {
      au = require('electron-updater').autoUpdater;
      au.autoDownload = true;
      au.autoInstallOnAppQuit = true;
      au.on('checking-for-update', () => updSend({ state: 'checking', error: '' }));
      au.on('update-not-available', () => updSend({ state: 'none' }));
      au.on('update-available', (i) => updSend({ state: 'loading', version: i.version, percent: 0 }));
      au.on('download-progress', (p) => updSend({ state: 'loading', percent: Math.round(p.percent || 0) }));
      au.on('update-downloaded', (i) => updSend({ state: 'ready', version: i.version }));
      au.on('error', (err) => updSend({ state: 'error', error: String((err && err.message) || err) }));
    } catch (err) { au = null; upd = { state: 'error', error: String(err && err.message || err) }; }
  }
  ipcMain.handle('update:get', () => upd);
  ipcMain.handle('update:check', () => {
    if (!au) { updSend({}); return false; }
    if (upd.state === 'checking' || upd.state === 'loading' || upd.state === 'ready') { updSend({}); return true; }
    au.checkForUpdates().catch((err) => updSend({ state: 'error', error: String((err && err.message) || err) }));
    return true;
  });
  ipcMain.handle('update:install', () => {
    if (!au || upd.state !== 'ready') return false;
    skipCloseAsk = true; // без вопроса «Вы точно хотите закрыть?»
    setImmediate(() => au.quitAndInstall(true, true)); // тихо поставить и снова запустить
    return true;
  });

  // Все строки-ссылки на файлы (путь C:\… или file:///…) внутри объекта
  function fileRefs(obj, out = new Map()) {
    if (typeof obj === 'string') {
      let p = null;
      if (obj.startsWith('file:///')) { try { p = fileURLToPath(obj.split('#')[0]); } catch { /* не путь */ } }
      else if (/^[A-Za-z]:[\\/]/.test(obj)) p = obj;
      if (p && !out.has(obj)) { try { if (fs.statSync(p).isFile()) out.set(obj, p); } catch { /* файла нет */ } }
    } else if (Array.isArray(obj)) obj.forEach((x) => fileRefs(x, out));
    else if (obj && typeof obj === 'object') Object.values(obj).forEach((x) => fileRefs(x, out));
    return out;
  }

  function rewrite(obj, map) {
    if (typeof obj === 'string') return map.has(obj) ? map.get(obj) : obj;
    if (Array.isArray(obj)) return obj.map((x) => rewrite(x, map));
    if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, rewrite(v, map)]));
    return obj;
  }

  const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };

  /* ---------- Репозиторий: папка, куда программа сама складывает все данные ----------
     <папка>/repo.json — опись (что хранится, дата, список файлов); data/<часть>.json — данные части:
     { lib: ключи library.json, set: ключи cp.settings, ls: другие записи localStorage (строками) };
     bibles/ — переводы; files/appdata/… — файлы из папки программы (слайды, картинки, шрифты, медиа),
     files/other/… — файлы из других мест. Точная копия: лишние файлы удаляются (pruneDir); при первой отправке из чужой папки — только добавление.
     Окно оператора присылает все записи localStorage «cp.*»; library.json читаем с диска. */

  // Части репозитория. lib — ключи library.json, set — ключи настроек, ls — записи localStorage.
  // Ключи, которых нет ни в одной части, идут: lib — в «library», set и ls — в «settings»
  const REPO_PARTS = [
    { id: 'library', lib: ['items', 'libraries', 'playlists', 'view', 'lastPl', 'version', 'partTypes'] },
    { id: 'files' },
    { id: 'themes', lib: ['themes', 'themesLive', 'themeFor', 'tplFor', 'extThemes'] },
    { id: 'macros', lib: ['macros', 'fileMacros'] },
    { id: 'screens', lib: ['screens', 'scenes', 'scenePresets', 'timers'], ls: ['cp.sceneEditor'] },
    { id: 'bibles' },
    { id: 'bibleSet', lib: ['verseSplits'], set: ['bibleId', 'bSlots', 'vSplit', 'vMinFont', 'vMaxChars', 'vMaxParts', 'trShort', 'showTr', 'textFont', 'textScale', 'textColor', 'textBg'] },
    { id: 'bookmarks', ls: ['cp.bookmarks'] },
    { id: 'settings' },
    { id: 'layout', set: ['sizes', 'asideOrder', 'prevH', 'prevScreen', 'bmOpen', 'bmDock', 'bmSizeV', 'bmSizeH', 'lyFold', 'tmFold', 'sideFold', 'contentFold', 'poolOpen', 'poolH', 'poolSrc', 'scaleBible', 'scaleScreen'], ls: ['cp.themeEditor', 'cp.zoomPts'] },
    { id: 'look', set: ['uiTheme', 'uiColors', 'uiGlow', 'uiGlass', 'uiRadius', 'uiAlpha', 'uiFont', 'uiCaps'], ls: ['cp.look'] },
    { id: 'keys', set: ['keys'] },
    { id: 'presets', ls: ['cp.presets'] },
    { id: 'ink', ls: ['cp.ink'] },
    { id: 'lists', ls: ['cp.media', 'cp.tracks', 'cp.musicLists'] },
    { id: 'pool', set: ['poolFolders', 'poolCur', 'musicRoot', 'musicSrc'] },
  ];
  const REPO_NO_SET = ['repo', 'backupParts']; // настройка самого репозитория — в него не пишется
  const repoFile = (dir) => path.join(dir, 'repo.json');
  const ud = () => app.getPath('userData');

  // Чья это часть: ключ library.json ('lib'), настройки ('set') или записи localStorage ('ls')
  const repoOwner = (kind, k) => (REPO_PARTS.find((p) => (p[kind] || []).includes(k)) || { id: kind === 'lib' ? 'library' : 'settings' }).id;
  // Записи localStorage — разобранным JSON (чтобы найти и переписать пути к файлам), не JSON — строкой
  const lsParse = (v) => { try { const x = JSON.parse(v); return x && typeof x === 'object' ? x : v; } catch { return v; } };
  const lsText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const setsOf = (ls) => { try { return JSON.parse((ls || {})['cp.settings'] || '{}') || {}; } catch { return {}; } };

  // Разложить данные по частям
  function repoSplit(libAll, ls) {
    const out = Object.fromEntries(REPO_PARTS.map((p) => [p.id, { lib: {}, set: {}, ls: {} }]));
    for (const [k, v] of Object.entries(libAll || {})) out[repoOwner('lib', k)].lib[k] = v;
    for (const [k, v] of Object.entries(setsOf(ls))) if (!REPO_NO_SET.includes(k)) out[repoOwner('set', k)].set[k] = v;
    for (const [k, v] of Object.entries(ls)) if (k !== 'cp.settings') out[repoOwner('ls', k)].ls[k] = lsParse(v);
    return out;
  }

  // Где лежит файл внутри репозитория: из папки программы — с тем же путём, иначе — files/other/<метка>-<имя>
  function repoRel(p) {
    const base = ud().toLowerCase() + path.sep;
    if (p.toLowerCase().startsWith(base)) return 'files/appdata/' + p.slice(base.length).split(path.sep).join('/');
    const tag = crypto.createHash('md5').update(p.toLowerCase()).digest('hex').slice(0, 8);
    return `files/other/${tag}-${path.basename(p)}`;
  }

  // Скопировать, если файла нет или он изменился (размер, время)
  async function copyIfNewer(src, dst) {
    let s;
    try { s = fs.statSync(src); } catch { return false; }
    try { const d = fs.statSync(dst); if (d.size === s.size && d.mtimeMs >= s.mtimeMs - 2000) return false; } catch { /* нет — копируем */ }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    await fs.promises.copyFile(src, dst);
    return true;
  }
  // Папка целиком (без вложенных), только новое и изменённое
  async function mirrorDir(src, dst) {
    let n = 0;
    let list = [];
    try { list = fs.readdirSync(src, { withFileTypes: true }); } catch { return 0; }
    for (const f of list) {
      if (f.isDirectory()) n += await mirrorDir(path.join(src, f.name), path.join(dst, f.name));
      else if (f.isFile() && !f.name.endsWith('.tmp') && await copyIfNewer(path.join(src, f.name), path.join(dst, f.name))) n += 1;
    }
    return n;
  }
  const writeIfChanged = (file, text) => {
    try { if (fs.readFileSync(file, 'utf8') === text) return false; } catch { /* нового файла нет */ }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', text);
    fs.renameSync(file + '.tmp', file);
    return true;
  };

  let repoBusy = null; // идёт запись — следующая подождёт
  // Части, которые уже есть в папке, дополняются: что есть в папке, но нет в программе, остаётся
  const mergeObj = (a, b) => { const out = { ...(a || {}) }; for (const [k, v] of Object.entries(b || {})) out[k] = mergeVal(out[k], v); return out; };
  const mergePart = (old, cur) => (old ? { lib: mergeObj(old.lib, cur.lib), set: mergeObj(old.set, cur.set), ls: mergeObj(old.ls, cur.ls) } : cur);

  // Заменить: убрать из папки всё, что пишет программа (чужие файлы рядом не трогаем), и записать заново
  function repoClear(dir) {
    if (!fs.existsSync(repoFile(dir))) return;
    for (const x of ['data', 'files', 'bibles', 'repo.json', 'ПРОЧТИ.txt']) fs.rmSync(path.join(dir, x), { recursive: true, force: true });
  }

  // Убрать из папки root/sub всё, чего нет в keep (относительные пути через «/»); пустые папки тоже
  function pruneDir(root, sub, keep) {
    let n = 0;
    const walk = (abs, rel) => {
      let list = [];
      try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const f of list) {
        const a = path.join(abs, f.name);
        const r = rel ? rel + '/' + f.name : f.name;
        if (f.isDirectory()) { walk(a, r); try { if (!fs.readdirSync(a).length) fs.rmdirSync(a); } catch { /* занято */ } }
        else if (!keep.has(r.toLowerCase())) { try { fs.rmSync(a, { force: true }); n += 1; } catch { /* занято */ } }
      }
    };
    walk(path.join(root, sub), sub);
    return n;
  }

  // mode: '' — точная копия программы (автосохранение: удалённое в программе убирается и из папки),
  // 'add' — дополнить папку (ничего не удаляется; «Отправить» из папки, где уже были чужие данные), 'replace' — очистить и записать заново
  async function repoWrite(dir, parts, ls, mode) {
    if (!dir || !fs.existsSync(dir)) return { ok: false, missing: true };
    if (mode === 'replace') repoClear(dir);
    const add = mode === 'add';
    const has = (p) => parts.includes(p);
    const split = repoSplit(libView(), ls || {});
    let changed = mode === 'replace' ? 1 : 0;
    for (const id of parts) {
      if (!split[id]) continue;
      const file = path.join(dir, 'data', id + '.json');
      const data = add ? mergePart(readJson(file, null), split[id]) : split[id];
      changed += writeIfChanged(file, JSON.stringify(data, null, 1)) ? 1 : 0;
    }

    if (has('bibles')) {
      // Файлы переводов — копией, список index.json — как в программе (при 'add' — слить с тем, что в папке)
      const bd = path.join(dir, 'bibles');
      const keep = new Set(['bibles/index.json']);
      for (const f of fs.existsSync(bibleDir()) ? fs.readdirSync(bibleDir()) : []) {
        if (!f.endsWith('.json') || f === 'index.json') continue;
        keep.add('bibles/' + f.toLowerCase());
        if (await copyIfNewer(path.join(bibleDir(), f), path.join(bd, f))) changed += 1;
      }
      const index = add ? mergeVal(readJson(path.join(bd, 'index.json'), []), readIndex()) : readIndex();
      if (writeIfChanged(path.join(bd, 'index.json'), JSON.stringify(index))) changed += 1;
      if (!add && fs.existsSync(bibleDir())) changed += pruneDir(dir, 'bibles', keep); // папки переводов нет — ничего не трогаем
    }

    // Файлы, на которые ссылаются сохраняемые части, и шрифты программы
    const old = readJson(repoFile(dir), {}) || {};
    const files = new Map((Array.isArray(old.files) ? old.files : []).map((f) => [f.str, f]));
    if (has('files')) {
      if (!add) files.clear();
      for (const [str, p] of fileRefs(parts.map((id) => split[id]))) {
        const rel = repoRel(p);
        if (await copyIfNewer(p, path.join(dir, ...rel.split('/')))) changed += 1;
        files.set(str, { str, url: str.startsWith('file:'), rel });
      }
      changed += await mirrorDir(path.join(ud(), 'fonts'), path.join(dir, 'files', 'appdata', 'fonts'));
      if (!add) {
        // Точная копия: файлы, на которые больше ничего не ссылается, и удалённые шрифты — убрать
        const keep = new Set([...files.values()].map((f) => String(f.rel).toLowerCase()));
        let fonts = [];
        try { fonts = fs.readdirSync(path.join(ud(), 'fonts'), { recursive: true }); } catch { fonts = []; }
        for (const f of fonts) keep.add(('files/appdata/fonts/' + String(f).split(path.sep).join('/')).toLowerCase());
        changed += pruneDir(dir, 'files', keep);
      }
    }

    const man = { app: 'church-presenter', kind: 'repo', version: 1, name: APP_NAME, date: old.date || Date.now(), parts, files: [...files.values()] };
    const same = JSON.stringify({ ...man, date: 0 }) === JSON.stringify({ ...old, date: 0 });
    if (changed || !same) {
      man.date = Date.now();
      writeIfChanged(repoFile(dir), JSON.stringify(man, null, 1));
      writeIfChanged(path.join(dir, 'ПРОЧТИ.txt'), `Репозиторий ${APP_NAME}: все данные программы.\r\nНичего здесь не меняйте вручную. Чтобы перенести данные на другой компьютер, скопируйте эту папку целиком,\r\nзатем в программе: Настройки → Репозиторий → «Из папки репозитория…» и «Выбрать папку…».\r\n`);
    }
    return { ok: true, changed, date: man.date, files: files.size };
  }

  ipcMain.handle('repo:sync', async (_e, { dir, parts, ls, mode }) => {
    if (profSwitching) return { ok: false, skipped: true }; // настройки уходящего профиля с данными нового не смешиваем
    while (repoBusy) await repoBusy.catch(() => {});
    repoBusy = repoWrite(dir, parts || [], ls, mode);
    try { return await repoBusy; } catch (err) { return { ok: false, error: String(err && err.message || err) }; } finally { repoBusy = null; }
  });
  // Закрытие программы: запись в репозиторий не обрывать — дождаться, потом выйти
  app.on('before-quit', (e) => {
    if (!repoBusy) return;
    e.preventDefault();
    repoBusy.catch(() => {}).finally(() => setTimeout(() => app.quit(), 50));
  });

  // Выбрать папку: пустая или уже репозиторий — она сама; иначе — внутри новая «multiplayerSHOW — репозиторий»
  ipcMain.handle('repo:pick', async (e) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Папка репозитория ' + APP_NAME, properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    let dir = res.filePaths[0];
    const m = readJson(repoFile(dir), null);
    if (m && m.kind === 'repo') return { dir, existing: { date: m.date, parts: m.parts || [] } };
    let empty = true;
    try { empty = !fs.readdirSync(dir).length; } catch { /* нет доступа — пусть пишет туда */ }
    if (!empty) {
      dir = path.join(dir, `${APP_NAME} — репозиторий`);
      const m2 = readJson(repoFile(dir), null);
      if (m2 && m2.kind === 'repo') return { dir, existing: { date: m2.date, parts: m2.parts || [] } };
      fs.mkdirSync(dir, { recursive: true });
    }
    return { dir };
  });

  ipcMain.handle('repo:reveal', (_e, dir) => (dir && fs.existsSync(dir) ? shell.openPath(dir) : 'нет папки'));
  // «Показать в проводнике»: открыть папку файла и выделить его
  ipcMain.handle('file:reveal', (_e, p) => {
    if (!p || !fs.existsSync(p)) return false;
    shell.showItemInFolder(path.normalize(p));
    return true;
  });
  ipcMain.handle('repo:exists', (_e, dir) => !!dir && fs.existsSync(repoFile(dir)));

  // Папка для восстановления: репозиторий или старая резервная копия
  ipcMain.handle('repo:open', async (e) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Папка репозитория или резервной копии ' + APP_NAME, properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    for (const dir of [res.filePaths[0], path.join(res.filePaths[0], `${APP_NAME} — репозиторий`)]) {
      const m = readJson(repoFile(dir), null);
      if (m && m.app === 'church-presenter' && m.kind === 'repo') return { ok: true, kind: 'repo', dir, date: m.date, parts: m.parts || [] };
    }
    const dir = res.filePaths[0];
    const b = readJson(path.join(dir, 'manifest.json'), null);
    if (b && b.app === 'church-presenter' && b.kind === 'backup') return { ok: true, kind: 'backup', dir, date: b.date, parts: b.parts || [] };
    return { ok: false };
  });

  // Слить значения: списки с id — по id (то же id заменяется), объекты — по ключам, иначе — из репозитория
  function mergeVal(cur, add) {
    const byId = (a) => Array.isArray(a) && a.every((x) => x && typeof x === 'object' && x.id != null);
    if (byId(cur) && byId(add)) {
      const out = cur.slice();
      for (const x of add) { const i = out.findIndex((y) => y.id === x.id); if (i >= 0) out[i] = x; else out.push(x); }
      return out;
    }
    if (cur && add && typeof cur === 'object' && typeof add === 'object' && !Array.isArray(cur) && !Array.isArray(add)) return { ...cur, ...add };
    return add;
  }

  // mode: 'add' — добавить к данным программы (ничего не пропадает), 'replace' — заменить выбранные части тем, что в папке.
  // Перед заменой прежние данные откладываются в «прежние данные <дата>» в папке программы — их можно вернуть вручную.
  // curLs — записи localStorage окна (для слияния и чтобы отложить их копию)
  ipcMain.handle('repo:restore', async (_e, { dir, parts, mode, ls: curLs }) => {
    const m = readJson(repoFile(dir), null);
    if (!m || m.kind !== 'repo') return { ok: false };
    const has = (p) => parts.includes(p) && (m.parts || []).includes(p);
    const replace = mode === 'replace';
    curLs = curLs || {};
    let aside = '';
    if (replace) {
      const stamp = new Date().toLocaleString('ru-RU').replace(/[/:]/g, '-').replace(/,/g, '');
      aside = path.join(ud(), 'прежние данные ' + stamp);
      fs.mkdirSync(aside, { recursive: true });
      if (fs.existsSync(libFile())) fs.copyFileSync(libFile(), path.join(aside, 'library.json'));
      fs.writeFileSync(path.join(aside, 'localStorage.json'), JSON.stringify(curLs, null, 1));
    }

    // Файлы — в папку программы (что уже есть — не трогаем), ссылки переписываем на новые места
    const map = new Map();
    if (has('files')) {
      for (const f of Array.isArray(m.files) ? m.files : []) {
        const src = path.join(dir, ...String(f.rel).split('/'));
        if (!fs.existsSync(src)) continue;
        const rel = String(f.rel);
        const dst = rel.startsWith('files/appdata/') ? path.join(ud(), ...rel.slice(14).split('/')) : path.join(ud(), 'media', path.basename(rel));
        if (!dst.startsWith(ud())) continue;
        // Замена — файл из папки поверх своего (свой — в отложенные); добавление — свой не трогаем
        if (replace && fs.existsSync(dst) && fs.statSync(dst).size !== fs.statSync(src).size) {
          const keep = path.join(aside, 'files', path.relative(ud(), dst));
          fs.mkdirSync(path.dirname(keep), { recursive: true });
          fs.renameSync(dst, keep);
        }
        if (!fs.existsSync(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); await fs.promises.copyFile(src, dst); }
        map.set(f.str, f.url ? pathToFileURL(dst).href : dst);
      }
      const fonts = path.join(dir, 'files', 'appdata', 'fonts');
      let list = [];
      try { list = fs.readdirSync(fonts); } catch { list = []; }
      for (const f of list) {
        const dst = path.join(ud(), 'fonts', f);
        if (!fs.existsSync(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); await fs.promises.copyFile(path.join(fonts, f), dst); }
      }
    }

    // Данные частей. Добавление — слить со своим (списки по id, объекты по ключам);
    // замена — у выбранных частей остаётся только то, что в папке (лишние ключи убираются)
    const cur = libView();
    const curSet = setsOf(curLs);
    const set = {};
    const ls = {};
    const dropSet = [];
    const dropLs = [];
    for (const id of parts) {
      if (!has(id)) continue;
      const d = rewrite(readJson(path.join(dir, 'data', id + '.json'), null), map);
      if (!d) continue;
      const dl = d.lib || {};
      const ds = d.set || {};
      const dls = d.ls || {};
      if (replace) {
        for (const k of Object.keys(cur)) if (repoOwner('lib', k) === id && !(k in dl)) delete cur[k];
        for (const k of Object.keys(curSet)) if (repoOwner('set', k) === id && !(k in ds) && !REPO_NO_SET.includes(k)) dropSet.push(k);
        for (const k of Object.keys(curLs)) if (k !== 'cp.settings' && k !== 'cp.repoLast' && repoOwner('ls', k) === id && !(k in dls)) dropLs.push(k);
      }
      for (const [k, v] of Object.entries(dl)) cur[k] = replace ? v : mergeVal(cur[k], v);
      // Темы из репозитория — сразу применённые, если в репозитории нет их черновика
      if (id === 'themes' && cur.themesLive) for (const t of dl.themes || []) if (!(dl.themesLive || {})[t.id]) delete cur.themesLive[t.id];
      for (const [k, v] of Object.entries(ds)) set[k] = replace ? v : mergeVal(curSet[k], v);
      for (const [k, v] of Object.entries(dls)) ls[k] = lsText(replace || !(k in curLs) ? v : mergeVal(lsParse(curLs[k]), v));
    }
    profiles.save(cur); // общее — в общее хранилище, своё — в файл профиля

    // Переводы Библии добавляются (с тем же id — заменяются); при замене свои — в отложенные
    if (has('bibles') && fs.existsSync(path.join(dir, 'bibles'))) {
      if (replace && fs.existsSync(bibleDir())) fs.renameSync(bibleDir(), path.join(aside, 'bibles'));
      fs.mkdirSync(bibleDir(), { recursive: true });
      const index = replace ? [] : readIndex();
      for (const b of readJson(path.join(dir, 'bibles', 'index.json'), [])) {
        const sid = safeId(b.id);
        const src = sid && path.join(dir, 'bibles', sid + '.json');
        if (!src || !fs.existsSync(src)) continue;
        await fs.promises.copyFile(src, path.join(bibleDir(), sid + '.json'));
        const i = index.findIndex((x) => x.id === sid);
        if (i >= 0) index[i] = b; else index.push(b);
      }
      writeIndex(index);
    }
    // Настройки и записи localStorage записывает само окно
    return { ok: true, set, ls, dropSet, dropLs, aside };
  });

  ipcMain.handle('backup:restore', async (_e, { dir, parts }) => {
    const m = readJson(path.join(dir, 'manifest.json'), null);
    if (!m) return { ok: false };
    const has = (p) => parts.includes(p) && (m.parts || []).includes(p);

    // Файлы — в папку программы, ссылки на них переписываем
    const map = new Map();
    if (has('files') && Array.isArray(m.files)) {
      const mediaDir = path.join(app.getPath('userData'), 'media');
      fs.mkdirSync(mediaDir, { recursive: true });
      for (const f of m.files) {
        const src = path.join(dir, 'media', f.rel);
        const dst = path.join(mediaDir, f.rel);
        if (!fs.existsSync(dst) && fs.existsSync(src)) await fs.promises.copyFile(src, dst);
        map.set(f.str, f.url ? pathToFileURL(dst).href : dst);
      }
    }

    // Презентации и плейлисты заменяются, темы добавляются к своим
    const backLib = rewrite(readJson(path.join(dir, 'library.json'), null), map);
    if (backLib && (has('library') || has('themes'))) {
      const cur = libView();
      if (has('library')) Object.assign(cur, { version: backLib.version, items: backLib.items, libraries: backLib.libraries, playlists: backLib.playlists, view: backLib.view, lastPl: backLib.lastPl });
      if (has('themes') && Array.isArray(backLib.themes)) {
        const themes = Array.isArray(cur.themes) ? cur.themes : [];
        for (const t of backLib.themes) { const i = themes.findIndex((x) => x.id === t.id); if (i >= 0) themes[i] = t; else themes.push(t); }
        cur.themes = themes;
        cur.themeFor = { ...(cur.themeFor || {}), ...(backLib.themeFor || {}) };
        if (backLib.tplFor) cur.tplFor = { ...(cur.tplFor || {}), ...backLib.tplFor };
      }
      profiles.save(cur);
    }

    // Переводы Библии добавляются (с тем же id — заменяются)
    if (has('bibles') && fs.existsSync(path.join(dir, 'bibles'))) {
      fs.mkdirSync(bibleDir(), { recursive: true });
      const index = readIndex();
      const backIndex = readJson(path.join(dir, 'bibles', 'index.json'), []);
      for (const b of backIndex) {
        const sid = safeId(b.id);
        const src = sid && path.join(dir, 'bibles', sid + '.json');
        if (!src || !fs.existsSync(src)) continue;
        await fs.promises.copyFile(src, path.join(bibleDir(), sid + '.json'));
        const i = index.findIndex((x) => x.id === sid);
        if (i >= 0) index[i] = b; else index.push(b);
      }
      writeIndex(index);
    }

    // Настройки окна оператора отдаём обратно — их записывает само окно
    return { ok: true, local: rewrite(readJson(path.join(dir, 'local.json'), {}), map) };
  });

  /* ---------- Буфер обмена для слайдов ----------
     Слайды лежат здесь, а в обычный буфер Windows кладётся их текст. Если с тех пор там
     появилось что-то другое (скопировали текст песни из браузера), вставится уже оно. */

  let slideClip = null; // { slides, text }

  ipcMain.handle('clip:set', (_e, { slides, text }) => {
    const t = String(text || '').trim() || '[слайды ' + APP_NAME + ']';
    slideClip = { slides, text: t };
    clipboard.writeText(t);
  });

  ipcMain.handle('clip:get', () => {
    const text = clipboard.readText();
    if (slideClip && text === slideClip.text) return { slides: slideClip.slides, text };
    return { slides: null, text };
  });

  /* ---------- Пресеты настроек: файл .json для переноса на другой компьютер ---------- */

  // title, label — для других файлов JSON (темы); без них — пресет
  ipcMain.handle('json:save', async (e, { name, data, title, label }) => {
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      title: title || 'Сохранить пресет в файл', defaultPath: safeName(name) + '.json', filters: [{ name: label || 'Пресет ' + APP_NAME, extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2));
    return res.filePath;
  });

  ipcMain.handle('json:open', async (e, opts) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: (opts && opts.title) || 'Загрузить пресет из файла', properties: ['openFile'], filters: [{ name: (opts && opts.label) || 'Пресет ' + APP_NAME, extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    try { return { ok: true, data: JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8')) }; } catch { return { ok: false }; }
  });

  /* ---------- Шрифты: установленные в Windows и свои файлы (копией в userData\fonts) ---------- */

  let sysFonts = null; // список семейств — один раз за запуск
  ipcMain.handle('fonts:system', () => {
    if (sysFonts) return sysFonts;
    return new Promise((resolve) => {
      const ps = 'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }';
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + ps],
        { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
          const list = err ? [] : [...new Set(String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
          if (list.length) sysFonts = list;
          resolve(list);
        });
    });
  });

  const fontDir = () => path.join(app.getPath('userData'), 'fonts');
  const fontIndexFile = () => path.join(fontDir(), 'index.json');
  const readFonts = () => { try { const l = JSON.parse(fs.readFileSync(fontIndexFile(), 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; } };
  const fontsOut = () => readFonts().filter((f) => fs.existsSync(path.join(fontDir(), f.file))).map((f) => ({ ...f, url: pathToFileURL(path.join(fontDir(), f.file)).href }));
  const sendFonts = () => { const l = fontsOut(); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('fonts:changed', l); };

  // Имя семейства, жирность и курсив из самого файла (TTF/OTF/TTC и WOFF); не вышло — null
  function fontInfo(buf) {
    try {
      let base = 0;
      const sig = buf.toString('latin1', 0, 4);
      if (sig === 'ttcf') base = buf.readUInt32BE(12);
      const tables = {};
      if (sig === 'wOFF') {
        const n = buf.readUInt16BE(12);
        for (let i = 0; i < n; i++) {
          const r = 44 + i * 20;
          const off = buf.readUInt32BE(r + 4);
          const comp = buf.readUInt32BE(r + 8);
          const orig = buf.readUInt32BE(r + 12);
          const raw = buf.subarray(off, off + comp);
          tables[buf.toString('latin1', r, r + 4)] = comp < orig ? zlib.inflateSync(raw) : raw;
        }
      } else {
        const n = buf.readUInt16BE(base + 4);
        for (let i = 0; i < n; i++) {
          const r = base + 12 + i * 16;
          const off = buf.readUInt32BE(r + 8);
          tables[buf.toString('latin1', r, r + 4)] = buf.subarray(off, off + buf.readUInt32BE(r + 12));
        }
      }
      const nm = tables.name;
      if (!nm) return null;
      const count = nm.readUInt16BE(2);
      const strs = nm.readUInt16BE(4);
      const names = {};
      for (let i = 0; i < count; i++) {
        const r = 6 + i * 12;
        const plat = nm.readUInt16BE(r);
        const lang = nm.readUInt16BE(r + 4);
        const id = nm.readUInt16BE(r + 6);
        if (id !== 1 && id !== 16) continue;
        const s = nm.subarray(strs + nm.readUInt16BE(r + 10), strs + nm.readUInt16BE(r + 10) + nm.readUInt16BE(r + 8));
        let text = '';
        if (plat === 3 || plat === 0) { for (let j = 0; j + 1 < s.length; j += 2) text += String.fromCharCode(s.readUInt16BE(j)); } else if (plat === 1) text = s.toString('latin1');
        const rank = (plat === 3 ? 4 : plat === 0 ? 2 : 1) + (lang === 0x409 || lang === 0 ? 4 : 0);
        if (text && (!names[id] || names[id].rank < rank)) names[id] = { text, rank };
      }
      const family = (names[16] || names[1] || {}).text;
      if (!family) return null;
      const os2 = tables['OS/2'];
      const weight = os2 && os2.length > 6 ? os2.readUInt16BE(4) : 400;
      const italic = os2 && os2.length > 64 ? !!(os2.readUInt16BE(62) & 1) : false;
      return { family: family.trim(), weight: weight >= 100 && weight <= 1000 ? weight : 400, italic };
    } catch { return null; }
  }

  ipcMain.handle('fonts:user', () => fontsOut());
  // Свой шрифт: файл копируется в папку программы, исходник не трогаем
  ipcMain.handle('fonts:add', async (e) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Добавить шрифт', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Шрифты', extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2'] }],
    });
    if (res.canceled) return { added: [], skipped: [] };
    fs.mkdirSync(fontDir(), { recursive: true });
    const list = readFonts();
    const added = [];
    const skipped = [];
    for (const src of res.filePaths) {
      let buf;
      try { buf = fs.readFileSync(src); } catch { skipped.push(path.basename(src)); continue; }
      const info = fontInfo(buf) || { family: path.basename(src, path.extname(src)).replace(/[-_]+/g, ' '), weight: 400, italic: false };
      if (list.some((f) => f.family === info.family && f.weight === info.weight && !!f.italic === info.italic)) { skipped.push(info.family); continue; }
      const file = `${safeName(path.basename(src, path.extname(src)))}-${Date.now().toString(36)}${path.extname(src).toLowerCase()}`;
      fs.writeFileSync(path.join(fontDir(), file), buf);
      const f = { family: info.family, weight: info.weight, italic: info.italic, file, name: path.basename(src) };
      list.push(f);
      added.push(f);
    }
    fs.writeFileSync(fontIndexFile(), JSON.stringify(list, null, 2));
    sendFonts();
    return { added, skipped };
  });
  // Убрать из списка (копия файла остаётся в папке программы)
  ipcMain.handle('fonts:remove', (_e, file) => {
    const list = readFonts().filter((f) => f.file !== file);
    fs.mkdirSync(fontDir(), { recursive: true });
    fs.writeFileSync(fontIndexFile(), JSON.stringify(list, null, 2));
    sendFonts();
    return fontsOut();
  });

  // Ноты песни (окно песни): выбрать фото/PDF → листы [{ file, name, w, h }] и ошибки по файлам
  ipcMain.handle('sheets:pick', async (e) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Ноты: фото или PDF', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Ноты (PDF, JPEG, PNG)', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }],
    });
    if (res.canceled) return null;
    const sheets = [];
    const errors = [];
    for (const f of res.filePaths) {
      if (/\.pdf$/i.test(f)) notify(`Ноты: читаю «${path.basename(f)}»…`);
      try { sheets.push(...(await sheetsFrom({ file: f }))); } catch (err) { errors.push(`${path.basename(f)}: ${err.message}`); }
    }
    notify('');
    return { sheets, errors };
  });

  /* ---------- Песни: импорт и экспорт открытыми форматами (TXT, ChordPro, JSON) ---------- */

  const SONG_EXT = ['txt', 'text', 'md', 'cho', 'chopro', 'chordpro', 'crd', 'pro', 'json'];
  // Из других программ: OpenLP (songs.sqlite, OpenLyrics .xml), EasyWorship 6/7 (Songs.db + SongWords.db),
  // ProPresenter (.pro 5/6 — XML, 7 — двоичный), SongSelect (.usr, .txt). Разбор текста — songimport.js в окне
  const OTHER_EXT = ['sqlite', 'db', 'xml', 'usr', 'pro', 'pro6', 'pro5'];

  // Базы SQLite других программ → строки таблиц (без разбора текста)
  function songsFromDb(file, buf) {
    const db = sqliteReader(buf);
    if (db.has('songs')) {
      // OpenLP: songs(id, title, alternate_title, lyrics — XML, verse_order, ccli_number, copyright, song_number), authors
      const authors = new Map((db.table('authors') || []).map((a) => [a.id, String(a.display_name || [a.first_name, a.last_name].filter(Boolean).join(' ') || '')]));
      const links = db.table('authors_songs') || [];
      return { from: 'openlp', songs: db.table('songs').map((s) => ({
        title: s.title, alt: s.alternate_title, lyrics: s.lyrics, order: s.verse_order, ccli: s.ccli_number, copyright: s.copyright, number: s.song_number,
        authors: links.filter((l) => l.song_id === s.id).map((l) => authors.get(l.author_id)).filter(Boolean),
      })) };
    }
    if (db.has('song')) {
      // EasyWorship 6/7: Songs.db — song(rowid, title, author, copyright, reference_number), слова — SongWords.db: word(song_id, words — RTF)
      let words = new Map();
      const wf = ['SongWords.db', 'songwords.db'].map((n) => path.join(path.dirname(file), n)).find((p) => fs.existsSync(p));
      if (wf) { try { words = new Map((sqliteReader(fs.readFileSync(wf)).table('word') || []).map((w) => [Number(w.song_id), w.words])); } catch { /* без слов */ } }
      const rows = db.table('song').map((s) => ({ id: Number(s.rowid != null ? s.rowid : s.id != null ? s.id : s._rowid), title: s.title, author: s.author, copyright: s.copyright, ccli: s.reference_number, words: s.words }));
      return { from: 'ew', noWords: !wf, songs: rows.map((s) => ({ ...s, words: s.words || words.get(s.id) || '' })) };
    }
    if (db.has('word')) throw new Error('это файл слов EasyWorship — выберите рядом с ним Songs.db');
    throw new Error('в базе нет песен (поддерживаются OpenLP и EasyWorship 6/7)');
  }

  // Байты отдаём окну: кодировку (UTF-8, UTF-16, Windows-1251) разбирает окно через TextDecoder
  ipcMain.handle('songs:open', async (e, opts) => {
    const other = !!(opts && opts.other);
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: other ? 'Импорт песен из других программ' : 'Импорт песен', properties: ['openFile', 'multiSelections'],
      filters: other
        ? [{ name: 'OpenLP, EasyWorship, ProPresenter, SongSelect', extensions: [...OTHER_EXT, 'txt'] }, { name: 'Все файлы', extensions: ['*'] }]
        : [{ name: 'Песни (текст, ChordPro, JSON)', extensions: SONG_EXT }, { name: 'Все файлы', extensions: ['*'] }],
    });
    if (res.canceled) return [];
    return res.filePaths.map((p) => {
      const name = path.basename(p, path.extname(p));
      const ext = path.extname(p).slice(1).toLowerCase();
      try {
        const bytes = fs.readFileSync(p);
        if (bytes.toString('latin1', 0, 15) === 'SQLite format 3') {
          try { return { name, ext, db: songsFromDb(p, bytes) }; } catch (err) { return { name, ext, error: err.message }; }
        }
        return { name, ext, bytes };
      } catch { return { name, ext, error: true }; }
    });
  });

  // Проверка перед служением (service.js): есть ли файлы на диске
  ipcMain.handle('files:check', (_e, paths) => (Array.isArray(paths) ? paths.map((p) => { try { return !!p && fs.existsSync(String(p)); } catch { return false; } }) : []));

  // Библия по голосу (voicesrv.js)
  voice.setup({ ipcMain, getControl: () => control, webPreferences, unzip, dialog });

  // Одна песня: формат по расширению, которое выбрал пользователь (.txt или .json)
  ipcMain.handle('songs:save', async (e, { name, text, json }) => {
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Экспорт песни', defaultPath: safeName(name) + '.txt',
      filters: [{ name: 'Текст с разметкой', extensions: ['txt'] }, { name: 'JSON ' + APP_NAME, extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    const asJson = path.extname(res.filePath).toLowerCase() === '.json';
    fs.writeFileSync(res.filePath, asJson ? JSON.stringify(json, null, 2) : '﻿' + text.replace(/\n/g, '\r\n'));
    return res.filePath;
  });

  // Несколько песен — каждая своим .txt в выбранную папку; чужие файлы не перезаписываем
  ipcMain.handle('songs:saveMany', async (e, songs) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Папка для экспорта песен', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    let n = 0;
    for (const s of songs || []) {
      let file = path.join(dir, safeName(s.name) + '.txt');
      for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${safeName(s.name)} (${i}).txt`);
      try { fs.writeFileSync(file, '﻿' + String(s.text).replace(/\n/g, '\r\n')); n++; } catch { /* пропускаем */ }
    }
    return { dir, n };
  });

  /* ---------- Медиапул ---------- */

  ipcMain.handle('pool:pickFolder', async (_e, title) => {
    const res = await dialog.showOpenDialog(control, { title: title || 'Закрепить папку в медиапуле', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  /* ---------- Источники сигнала (Медиапул → Источники) ---------- */

  // Экраны и окна компьютера; окна самой программы не показываем
  ipcMain.handle('sources:screens', async () => {
    try {
      const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
      const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
      return list.filter((s) => !own.has(s.id)).map((s) => ({
        id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      }));
    } catch { return []; }
  });

  // NDI в локальной сети: источники объявляют себя через mDNS (_ndi._tcp.local) — спрашиваем и ждём ответов
  ipcMain.handle('sources:ndi', () => ndiFind(1500));
  // Есть NDI Runtime (NDI Tools) — поиск и показ через него (ndi.js); окну вывода — полное качество
  ndi.setup(ipcMain, (wc) => outWins().some((w) => w.webContents === wc)); // окнам вывода и экранов — полное качество
  // Приём экрана с телефона: AirPlay (UxPlay, имя «MP SHOW») и Miracast (cast.js)
  cast.setup(ipcMain, () => control, APP_ICON);
  app.on('will-quit', cast.stop);
  // Сервер группы (teamsrv.js): адрес-домен, HTTPS, сертификат. Запросы https — в тот же обработчик, что у пульта.
  // Токен DNS-провайдера — зашифрован Windows (safeStorage), без шифрования — только если его нет в системе
  team.setup(ipcMain, {
    dir: app.getPath('userData'), appDir: path.join(__dirname, 'app'), ips: rmIps, handler: rmHandle,
    libFile: () => profiles.libFile(), ver: app.getVersion(), // файл открытого профиля (общие песни приходят через libSaved)
    want: () => rmWant(), http: () => ({ running: !!rmSrv && !!rmPort, port: rmPort, err: rmErr }),
    seal: (s) => (safeStorage.isEncryptionAvailable() ? 'dp:' + safeStorage.encryptString(s).toString('base64') : 'raw:' + Buffer.from(s).toString('base64')),
    unseal: (s) => (s.startsWith('dp:') ? safeStorage.decryptString(Buffer.from(s.slice(3), 'base64')) : s.startsWith('raw:') ? Buffer.from(s.slice(4), 'base64').toString() : ''),
    notify: (i) => { if (control && !control.isDestroyed()) control.webContents.send('team:info', i); },
    // Телефон с правом «листать» нажал «Дальше» / слайд — окну оператора (team.js: onTeamCmd)
    cmd: (c) => { if (control && !control.isDestroyed()) control.webContents.send('team:cmd', c); },
    // Телефон с правом «править аккорды» прислал аккорды песни — окну оператора; ответ придёт через team:chordsDone
    chords: (c) => new Promise((ok, no) => {
      if (!control || control.isDestroyed()) return no(new Error('Окно программы закрыто'));
      const rid = ++chordReq;
      const t = setTimeout(() => { chordWait.delete(rid); no(new Error('Программа не ответила')); }, 8000);
      chordWait.set(rid, { ok, no, t });
      control.webContents.send('team:chords', { ...c, rid });
    }),
    // Ноты с телефона: { id, buf, name, who } — добавить (фото/PDF → листы здесь), { id, del: имя файла, who } — убрать.
    // Пишет окно оператора (team.js: onTeamSheets), ответ — тем же team:chordsDone
    sheets: async (c) => {
      const add = c.buf ? await sheetsFrom({ buf: c.buf, name: c.name }) : [];
      return new Promise((ok, no) => {
        if (!control || control.isDestroyed()) return no(new Error('Окно программы закрыто'));
        const rid = ++chordReq;
        const t = setTimeout(() => { chordWait.delete(rid); no(new Error('Программа не ответила')); }, 8000);
        chordWait.set(rid, { ok: () => ok({ n: add.length }), no, t });
        control.webContents.send('team:sheets', { id: c.id, add, del: c.del || '', who: c.who, rid });
      });
    },
    // Песня с планшета (teamapi.js: putSong): новая или текст и аранжировки. Пишет окно оператора (team.js: onTeamSong),
    // ответ — team:chordsDone с id песни
    // sheets: null — листы не трогать; иначе весь список: { file, name } — уже есть, { buf, name } — новый (фото/PDF → листы здесь)
    song: async (c) => {
      let sheets = null;
      if (c.sheets) {
        sheets = [];
        for (const x of c.sheets) {
          if (x.file) { const { width: w, height: h } = nativeImage.createFromPath(x.file).getSize(); sheets.push({ file: x.file, name: x.name, w, h }); }
          else sheets.push(...await sheetsFrom({ buf: x.buf, name: x.name }));
        }
      }
      return new Promise((ok, no) => {
        if (!control || control.isDestroyed()) return no(new Error('Окно программы закрыто'));
        const rid = ++chordReq;
        const t = setTimeout(() => { chordWait.delete(rid); no(new Error('Программа не ответила')); }, 8000);
        chordWait.set(rid, { ok, no, t });
        control.webContents.send('team:song', { ...c, sheets, rid });
      });
    },
    // Правка без связи, подписанная тем, кто может править (teamapi.js: putEdit); принёс любой телефон (via).
    // sheets: null — листы не трогать; иначе весь список: { file, name } — уже есть, { buf, name } — новый (фото → лист здесь)
    edit: async (c) => {
      let sheets = null;
      if (c.sheets) {
        sheets = [];
        for (const x of c.sheets) {
          if (x.file) { const { width: w, height: h } = nativeImage.createFromPath(x.file).getSize(); sheets.push({ file: x.file, name: x.name, w, h }); }
          else sheets.push(...await sheetsFrom({ buf: x.buf, name: x.name }));
        }
      }
      return new Promise((ok, no) => {
        if (!control || control.isDestroyed()) return no(new Error('Окно программы закрыто'));
        const rid = ++chordReq;
        const t = setTimeout(() => { chordWait.delete(rid); no(new Error('Программа не ответила')); }, 8000);
        chordWait.set(rid, { ok, no, t });
        control.webContents.send('team:edit', { id: c.id, chords: c.chords, key: c.key, sheets, who: c.who, via: c.via, rid });
      });
    },
  });
  app.on('will-quit', team.shutdown);
  ipcMain.handle('team:chordsDone', (_e, r) => {
    const w = r && chordWait.get(r.rid);
    if (!w) return;
    chordWait.delete(r.rid);
    clearTimeout(w.t);
    if (r.err) w.no(new Error(String(r.err))); else w.ok(r.id ? { id: String(r.id) } : {});
  });

  ipcMain.handle('pool:list', async (_e, dir) => {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const dirs = [];
      const files = [];
      for (const d of entries) {
        if (d.name.startsWith('.') || d.name.startsWith('$')) continue;
        const p = path.join(dir, d.name);
        if (d.isDirectory()) dirs.push({ name: d.name, path: p });
        else {
          const kind = kindOf(p);
          if (kind) files.push(toItem(p, kind));
        }
      }
      const byName = (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true });
      return { ok: true, dirs: dirs.sort(byName), files: files.sort(byName) };
    } catch (err) {
      return { ok: false, error: err.code === 'ENOENT' ? 'папка не найдена' : 'нет доступа к папке', dirs: [], files: [] };
    }
  });

  // Следим за открытой папкой медиапула: добавили/удалили файл — окну приходит 'pool:changed'
  let poolWatcher = null;
  let poolWatchTimer = null;
  ipcMain.handle('pool:watch', (e, dir) => {
    if (poolWatcher) { try { poolWatcher.close(); } catch {} poolWatcher = null; }
    clearTimeout(poolWatchTimer);
    if (!dir) return false;
    const wc = e.sender;
    try {
      poolWatcher = fs.watch(dir, () => {
        // Копирование большого файла даёт много событий — ждём, пока утихнет
        clearTimeout(poolWatchTimer);
        poolWatchTimer = setTimeout(() => { if (!wc.isDestroyed()) wc.send('pool:changed', dir); }, 500);
      });
      poolWatcher.on('error', () => { try { poolWatcher.close(); } catch {} poolWatcher = null; });
      return true;
    } catch { return false; }
  });

  // Быстрый поиск (Ctrl+S): все медиафайлы закреплённых папок со всеми подпапками, без повторов
  ipcMain.handle('pool:scan', async (_e, roots) => {
    const files = [];
    const seen = new Set();
    const LIMIT = 30000;
    const walk = async (dir, depth) => {
      if (files.length >= LIMIT || depth > 12 || seen.has(dir.toLowerCase())) return;
      seen.add(dir.toLowerCase());
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const d of entries) {
        if (files.length >= LIMIT) return;
        if (d.name.startsWith('.') || d.name.startsWith('$')) continue;
        const p = path.join(dir, d.name);
        if (d.isDirectory()) await walk(p, depth + 1);
        else {
          const kind = kindOf(p);
          if (kind && !seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); files.push({ ...toItem(p, kind), dir }); }
        }
      }
    };
    for (const r of Array.isArray(roots) ? roots : []) if (r) await walk(String(r), 0);
    return files;
  });

  // Лёгкие миниатюры фото и видео (как в Проводнике), кэш — в папке thumbs/; оригинал не трогаем
  const thumbDir = () => path.join(app.getPath('userData'), 'thumbs');
  ipcMain.handle('pool:thumb', async (_e, file) => {
    try {
      const st = await fs.promises.stat(file);
      const key = crypto.createHash('md5').update(file + st.mtimeMs + st.size).digest('hex');
      const out = path.join(thumbDir(), key + '.jpg');
      if (fs.existsSync(out)) return pathToFileURL(out).href;
      let img = null;
      try { img = await nativeImage.createThumbnailFromPath(file, { width: 320, height: 320 }); } catch { /* нет миниатюры у Windows */ }
      if ((!img || img.isEmpty()) && kindOf(file) === 'image') {
        img = nativeImage.createFromPath(file);
        if (!img.isEmpty() && img.getSize().height > 240) img = img.resize({ height: 240, quality: 'good' });
      }
      if (!img || img.isEmpty()) return null;
      await fs.promises.mkdir(thumbDir(), { recursive: true });
      await fs.promises.writeFile(out, img.toJPEG(82));
      return pathToFileURL(out).href;
    } catch {
      return null;
    }
  });

  // Обложка песни: встроенная картинка (mp3 — ID3, flac, m4a) или cover.jpg/folder.jpg рядом; кэш — в thumbs/
  ipcMain.handle('music:cover', async (_e, file) => {
    try {
      const st = await fs.promises.stat(file);
      const key = crypto.createHash('md5').update('cover:' + file + st.mtimeMs + st.size).digest('hex');
      const out = path.join(thumbDir(), key + '.jpg');
      if (fs.existsSync(out)) return pathToFileURL(out).href;
      let buf = await readCover(file).catch(() => null);
      if (!buf) {
        const dir = path.dirname(file);
        const near = (await fs.promises.readdir(dir)).find((n) => /^(cover|folder|front|album)\.(jpe?g|png)$/i.test(n));
        if (near) buf = await fs.promises.readFile(path.join(dir, near));
      }
      if (!buf) return null;
      let img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      if (img.getSize().width > 800) img = img.resize({ width: 800, quality: 'good' });
      await fs.promises.mkdir(thumbDir(), { recursive: true });
      await fs.promises.writeFile(out, img.toJPEG(88));
      return pathToFileURL(out).href;
    } catch {
      return null;
    }
  });

  // Настоящее перетаскивание файла (как из Проводника): его можно бросить в любое окно программы
  const dragIcon = nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 0xc0), { width: 32, height: 32 });
  ipcMain.on('drag:start', (e, file) => {
    if (typeof file === 'string' && fs.existsSync(file)) e.sender.startDrag({ file, icon: dragIcon });
  });

  /* ---------- Библиотеки и плейлисты ---------- */

  // Файл открытого профиля (profiles.js). В нём только своё: общие библиотеки — заглушками
  const libFile = () => profiles.libFile();
  // Всё, что видит открытый профиль: своё и общее вместе (как в окне оператора)
  const libView = () => { try { return profiles.load(undefined, { peek: true }) || {}; } catch { return {}; } };

  ipcMain.handle('lib:load', () => {
    try {
      const data = profiles.load();
      if (data) team.libSaved(data); // телефонам группы — с общими песнями
      return data;
    } catch (e) { console.warn('Профиль не прочитан:', e.message); return null; }
  });

  ipcMain.handle('lib:save', (_e, data) => {
    // Окно переключается на другой профиль — запоздалое сохранение старого не должно попасть в новый
    if (profSwitching) return { ok: false, skipped: true };
    // Пишется через временный файл и переименование (profiles.js), чтобы при сбое не потерять плейлисты
    const res = profiles.save(data);
    team.libSaved(data); // песни для телефонов группы (teamapi.js) — разберёт, когда телефон спросит
    return res;
  });

  /* ---------- Профили (profiles.js, окно «Настройки → Профили» — profpanel.js) ---------- */

  ipcMain.handle('profile:state', () => profiles.catalog());
  // a: { act, … }. a.reload — после команды окно перезагрузится (данные открытого профиля поменялись или открыт другой):
  // до загрузки нового окна старое ничего не пишет (lib:save, ls:backup, repo:sync)
  ipcMain.handle('profile:do', (_e, a = {}) => {
    try {
      let res = {};
      switch (a.act) {
        case 'create': res = { id: profiles.create(a.name, { libs: a.libs || [], cats: a.cats || [] }) }; break;
        case 'rename': res = { ok: profiles.rename(a.id, a.name) }; break;
        case 'remove': res = { ok: profiles.remove(a.id) }; break;
        case 'connect': res = { ok: profiles.connect(a.lib, a.id) }; break;
        case 'disconnect': res = { ok: profiles.disconnect(a.lib, a.id, !!a.keep) }; break;
        case 'cat': res = { ok: profiles.setCat(a.cat, Array.isArray(a.ids) ? a.ids : []) }; break;
        case 'switch': res = { ok: profiles.setActive(a.id) }; break;
        default: return { ok: false, error: 'unknown' };
      }
      if (res.ok === false) return { ok: false, state: profiles.catalog() };
      if (a.reload) profSwitching = true;
      return { ok: true, ...res, state: profiles.catalog() };
    } catch (e) {
      console.warn('Профили:', e.message);
      return { ok: false, error: e.message, state: profiles.catalog() };
    }
  });

  /* ---------- Библия ---------- */

  const bibleDir = () => path.join(app.getPath('userData'), 'bibles');
  const indexFile = () => path.join(bibleDir(), 'index.json');
  const safeId = (id) => (/^[\w-]+$/.test(String(id)) ? String(id) : null);
  // Список переводов. Если index.json потерян или повреждён, переводы не пропадают:
  // каждый лежит своим файлом, и такие файлы снова попадают в список.
  function readIndex() {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.filter((b) => b && safeId(b.id) && fs.existsSync(path.join(bibleDir(), b.id + '.json')));
    let found = false;
    let files = [];
    try { files = fs.readdirSync(bibleDir()); } catch { files = []; }
    for (const f of files) {
      const id = f.endsWith('.json') && f !== 'index.json' ? safeId(f.slice(0, -5)) : null;
      if (!id || list.some((b) => b.id === id)) continue;
      let name = id;
      try { name = JSON.parse(fs.readFileSync(path.join(bibleDir(), f), 'utf8')).name || id; } catch { continue; }
      list.push({ id, name: String(name), lang: '' });
      found = true;
    }
    if (found) writeIndex(list);
    return list;
  }
  function writeIndex(list) {
    fs.mkdirSync(bibleDir(), { recursive: true });
    const tmp = indexFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list));
    fs.renameSync(tmp, indexFile());
  }
  // Одинаковые названия различаем: «Синодальный», «Синодальный (2)»
  function uniqueName(list, name) {
    name = String(name || 'Перевод').trim().slice(0, 200) || 'Перевод';
    const taken = new Set(list.map((b) => String(b.name).toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
  }

  function decodeText(buf) {
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
    if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
    const s = new TextDecoder('utf-8').decode(buf);
    if ((s.match(/\uFFFD/g) || []).length > 10) return new TextDecoder('windows-1251').decode(buf);
    return s;
  }

  ipcMain.handle('bible:list', () => readIndex());

  ipcMain.handle('bible:pick', async () => {
    const res = await dialog.showOpenDialog(control, {
      title: 'Добавить перевод Библии',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Файлы Библии', extensions: ['xml', 'osis', 'zefania', 'json', 'txt', 'csv', 'tsv', 'usfm', 'sfm', 'zip', 'sqlite3', 'sqlite', 'db', 'mybible', 'bblx'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    return res.canceled ? [] : res.filePaths;
  });

  // Текстовые файлы отдаются как текст (разбирает bible.js), базы MyBible/e-Sword — готовыми строками стихов
  ipcMain.handle('bible:read', (_e, file) => {
    const name = path.basename(file, path.extname(file));
    const buf = fs.readFileSync(file);
    if (buf.toString('latin1', 0, 15) === 'SQLite format 3') return { name, ...bibleFromSqlite(buf, name) };
    if (buf.readUInt32LE(0) === 0x04034b50) {
      // ZIP (например, USFM с ebible.org): склеиваем все текстовые файлы Библии
      const parts = unzip(buf).filter((f) => /\.(usfm|sfm|ptx|xml|osis|json|txt|csv|tsv)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      if (!parts.length) throw new Error('в архиве нет файлов Библии');
      const db = parts.find((f) => f.data.toString('latin1', 0, 15) === 'SQLite format 3');
      if (db) return { name, ...bibleFromSqlite(db.data, name) };
      const usfm = parts.filter((f) => /\.(usfm|sfm|ptx)$/i.test(f.name));
      if (usfm.length) return { name, text: usfm.map((f) => decodeText(f.data)).join('\n'), format: 'USFM' };
      return { name, text: decodeText(parts[0].data) };
    }
    return { name, text: decodeText(buf) };
  });

  // Минимальное чтение ZIP: только сжатие deflate и «без сжатия»
  function unzip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('архив повреждён');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const out = [];
    for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
      const method = buf.readUInt16LE(p + 10);
      const size = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28);
      const extra = buf.readUInt16LE(p + 30);
      const comment = buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extra + comment;
      if (name.endsWith('/')) continue;
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      try {
        if (method === 0) out.push({ name, data: raw });
        else if (method === 8) out.push({ name, data: zlib.inflateRawSync(raw) });
      } catch { /* битый файл в архиве пропускаем */ }
    }
    return out;
  }

  // Минимальное чтение SQLite (только таблицы): хватает для модулей MyBible и e-Sword
  function sqliteReader(buf) {
    let pageSize = buf.readUInt16BE(16);
    if (pageSize === 1) pageSize = 65536;
    const usable = pageSize - buf[20];
    const enc = buf.readUInt32BE(56);
    const textDec = new TextDecoder(enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8');
    const varint = (p) => varintIn(buf, p);
    // Содержимое ячейки с учётом страниц продолжения
    const payload = (p, len) => {
      const maxLocal = usable - 35;
      if (len <= maxLocal) return buf.subarray(p, p + len);
      const min = Math.floor(((usable - 12) * 32) / 255) - 23;
      let local = min + ((len - min) % (usable - 4));
      if (local > maxLocal) local = min;
      const parts = [buf.subarray(p, p + local)];
      let left = len - local;
      let next = buf.readUInt32BE(p + local);
      while (next && left > 0) {
        const o = (next - 1) * pageSize;
        const take = Math.min(left, usable - 4);
        parts.push(buf.subarray(o + 4, o + 4 + take));
        left -= take;
        next = buf.readUInt32BE(o);
      }
      return Buffer.concat(parts);
    };
    const record = (rec) => {
      let [hsize, p] = varintIn(rec, 0);
      const types = [];
      while (p < hsize) { const r = varintIn(rec, p); types.push(r[0]); p = r[1]; }
      let d = hsize;
      return types.map((t) => {
        if (t === 0) return null;
        if (t === 8) return 0;
        if (t === 9) return 1;
        if (t >= 1 && t <= 6) {
          const n = [0, 1, 2, 3, 4, 6, 8][t];
          const v = n === 8 ? Number(rec.readBigInt64BE(d)) : rec.readIntBE(d, n);
          d += n;
          return v;
        }
        if (t === 7) { const v = rec.readDoubleBE(d); d += 8; return v; }
        const n = t >= 12 ? Math.floor((t - 12) / 2) : 0;
        const s = rec.subarray(d, d + n);
        d += n;
        return t % 2 ? textDec.decode(s) : Buffer.from(s);
      });
    };
    function varintIn(b, p) {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        const x = b[p + i];
        v = v * 128 + (x & 0x7f);
        if (x < 0x80) return [v, p + i + 1];
      }
      return [v * 256 + b[p + 8], p + 9];
    }
    // Все строки таблицы по номеру корневой страницы: [rowid, значения]
    const rows = (root) => {
      const out = [];
      const walk = (pg, depth) => {
        if (depth > 40) return;
        const o = (pg - 1) * pageSize;
        const h = pg === 1 ? 100 : 0;
        const type = buf[o + h];
        const cells = buf.readUInt16BE(o + h + 3);
        const ptrs = o + h + (type === 5 ? 12 : 8);
        for (let i = 0; i < cells; i++) {
          const c = o + buf.readUInt16BE(ptrs + i * 2);
          if (type === 5) walk(buf.readUInt32BE(c), depth + 1);
          else if (type === 13) {
            const [len, p1] = varint(c);
            const [rowid, p2] = varint(p1);
            try { out.push([rowid, record(payload(p2, len))]); } catch { /* повреждённая строка */ }
          }
        }
        if (type === 5) walk(buf.readUInt32BE(o + h + 8), depth + 1);
      };
      walk(root, 0);
      return out;
    };
    // Таблицы из sqlite_master и имена их столбцов из CREATE TABLE
    const tables = new Map();
    for (const [, r] of rows(1)) {
      if (r[0] !== 'table' || !r[3]) continue;
      const sql = String(r[4] || '');
      const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
      const cols = [];
      let depth = 0, cur = '';
      for (const ch of body + ',') {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && !depth) { cols.push(cur.trim()); cur = ''; } else cur += ch;
      }
      const defs = cols.filter((c) => c && !/^(primary|unique|constraint|foreign|check)\s/i.test(c))
        .map((c) => ({ name: c.split(/\s+/)[0].replace(/^["'`[]|["'`\]]$/g, '').toLowerCase(), rowid: /integer\s+(not\s+null\s+)?primary\s+key/i.test(c), int: /^\S+\s+integer/i.test(c) }));
      // «PRIMARY KEY (id)» отдельной строкой (OpenLP): такой столбец INTEGER — тоже номер строки, в записи он пустой
      const pk = cols.map((c) => c.match(/^primary\s+key\s*\(\s*["'`[]?(\w+)["'`\]]?\s*\)$/i)).find(Boolean);
      const pkd = pk && defs.find((d) => d.name === pk[1].toLowerCase());
      if (pkd && pkd.int) pkd.rowid = true;
      tables.set(String(r[1]).toLowerCase(), { root: r[3], defs });
    }
    const table = (name) => {
      const t = tables.get(name);
      if (!t) return null;
      return rows(t.root).map(([rowid, vals]) => {
        const o = { _rowid: rowid };
        t.defs.forEach((d, i) => { o[d.name] = d.rowid && vals[i] == null ? rowid : vals[i]; });
        return o;
      });
    };
    return { table, has: (n) => tables.has(n) };
  }

  // Номера книг MyBible (10 — Бытие … 730 — Откровение) в канонические 1–66
  const MYBIBLE = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240, 250, 260, 290, 300, 310,
    330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570,
    580, 590, 600, 610, 620, 630, 640, 650, 660, 670, 680, 690, 700, 710, 720, 730];

  function bibleFromSqlite(buf, fileName) {
    const db = sqliteReader(buf);
    const str = (v) => (Buffer.isBuffer(v) ? (() => { try { return zlib.inflateSync(v).toString('utf8'); } catch { return v.toString('utf8'); } })() : String(v == null ? '' : v));
    const rows = [];
    let name = fileName;
    if (db.has('verses')) {
      // MyBible: verses(book_number, chapter, verse, text), books(book_number, long_name), info(name, value)
      const info = db.table('info') || [];
      const desc = info.find((r) => r.name === 'description');
      if (desc && desc.value) name = String(desc.value);
      const books = new Map((db.table('books') || db.table('books_all') || []).map((b) => [Number(b.book_number), String(b.long_name || b.short_name || '')]));
      const clean = (t) => t.replace(/<S>.*?<\/S>|<m>.*?<\/m>|<f>.*?<\/f>|<n>.*?<\/n>|<h>.*?<\/h>/gis, '').replace(/<br\s*\/?>|<pb\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
      for (const r of db.table('verses')) {
        const bn = Number(r.book_number);
        const canon = MYBIBLE.indexOf(bn) + 1;
        rows.push({ canon, book: books.get(bn) || '', c: Number(r.chapter), v: Number(r.verse), t: clean(str(r.text)) });
      }
      return { rows, name, format: 'MyBible' };
    }
    if (db.has('bible')) {
      // e-Sword: Bible(Book, Chapter, Verse, Scripture) в RTF, Details(Title, Description)
      const det = (db.table('details') || [])[0] || {};
      name = String(det.title || det.description || det.abbreviation || fileName);
      const rtf = (t) => t
        .replace(/\{\\cf\d+\\super[^}]*\}|\\super\s+\S+/g, '')
        .replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(n < 0 ? +n + 65536 : +n))
        .replace(/\\'([0-9a-f]{2})/gi, (m, h) => new TextDecoder('windows-1251').decode(Buffer.from([parseInt(h, 16)])))
        .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
      for (const r of db.table('bible')) rows.push({ canon: Number(r.book) <= 66 ? Number(r.book) : 0, book: '', c: Number(r.chapter), v: Number(r.verse), t: rtf(str(r.scripture)) });
      return { rows, name, format: 'e-Sword' };
    }
    throw new Error('в базе нет таблицы стихов (поддерживаются MyBible и e-Sword)');
  }

  // Каждый добавленный перевод — новый файл с новым id: уже установленные никогда не заменяются
  ipcMain.handle('bible:save', (_e, bible) => {
    const list = readIndex();
    let id = crypto.randomUUID();
    while (fs.existsSync(path.join(bibleDir(), id + '.json'))) id = crypto.randomUUID();
    bible.id = id;
    bible.name = uniqueName(list, bible.name);
    const books = Array.isArray(bible.books) ? bible.books : [];
    const verses = books.reduce((n, b) => n + (b.chapters || []).reduce((m, c) => m + c.filter(Boolean).length, 0), 0);
    fs.mkdirSync(bibleDir(), { recursive: true });
    const file = path.join(bibleDir(), id + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(bible));
    fs.renameSync(file + '.tmp', file);
    list.push({
      id, name: bible.name, lang: String(bible.lang || ''),
      file: String(bible.file || ''), format: String(bible.format || ''), added: Date.now(), books: books.length, verses,
    });
    writeIndex(list);
    return { id, name: bible.name, list };
  });

  // Порядок, названия и языки переводов из окна настройки переводов
  ipcMain.handle('bible:setIndex', (_e, wanted) => {
    const known = new Map(readIndex().map((b) => [b.id, b]));
    const list = (Array.isArray(wanted) ? wanted : [])
      .filter((b) => b && known.has(b.id))
      .map((b) => ({ ...known.get(b.id), name: String(b.name || known.get(b.id).name).slice(0, 200), lang: String(b.lang || '').slice(0, 20), abbr: String(b.abbr || '').slice(0, 20) }));
    for (const b of known.values()) if (!list.some((x) => x.id === b.id)) list.push(b);
    writeIndex(list);
    return list;
  });

  ipcMain.handle('bible:load', (_e, id) => {
    const sid = safeId(id);
    if (!sid) return null;
    try {
      const bible = JSON.parse(fs.readFileSync(path.join(bibleDir(), sid + '.json'), 'utf8'));
      const entry = readIndex().find((b) => b.id === sid);
      if (entry) bible.name = entry.name; // название могли поменять в настройках
      return bible;
    } catch { return null; }
  });

  ipcMain.handle('bible:delete', (_e, id) => {
    const sid = safeId(id);
    if (sid) fs.rmSync(path.join(bibleDir(), sid + '.json'), { force: true });
    const list = readIndex().filter((b) => b.id !== sid);
    writeIndex(list);
    return list;
  });
});

/* ---------- Пульт с телефона (remote.js): свой маленький веб-сервер в локальной сети ----------
   Оператор даёт доступ к одной презентации — у доступа свой ключ (token) и QR-код со ссылкой
   http://<адрес ПК>:<порт>/r/<ключ>. Телефон видит только эту презентацию: слайды, что на экране, что дальше,
   листает (если разрешено) и правит текст (если разрешено). Команды идут в окно оператора (remote:cmd) —
   показ тот же, что щелчком мыши. Картинки слайдов рисует скрытое окно thumb.html, «Сейчас на экране» —
   скрытое окно-зеркало вывода (output.html), оба без экрана (offscreen) и только пока ими пользуются. */
const RM_PORT = 8090;
let rmSrv = null;
let rmPort = 0;
let rmErr = '';
let rmState = { grants: [], size: { W: 1920, H: 1080 } }; // от окна оператора
let rmRev = 1;
const rmWait = new Set(); // долгие запросы телефонов: ждут перемен
const rmThumbs = new Map(); // v → JPEG
let rmMirror = null;
let rmMirrorFrame = null;
let rmMirrorUsed = 0;
let rmSeen = null; // последний запрос не с этого компьютера: { ip, at } — видно в окне доступа, доходит ли телефон

const rmGrant = (t) => rmState.grants.find((g) => g.token === String(t || '')) || null;
function rmIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a && a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  // Домашние сети (192.168…, 10…) — первыми
  return out.sort((a, b) => (/^(192\.168|10\.)/.test(b) ? 1 : 0) - (/^(192\.168|10\.)/.test(a) ? 1 : 0));
}
const rmInfo = () => ({ running: !!rmSrv && !!rmPort, port: rmPort, ips: rmIps(), error: rmErr, seen: rmSeen });
const rmHash = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);

function rmStart() {
  if (rmSrv) return;
  rmErr = '';
  rmSrv = http.createServer(rmHandle);
  let port = RM_PORT;
  rmSrv.on('error', (err) => {
    // Порт занят — пробуем следующий
    if (err && err.code === 'EADDRINUSE' && port < RM_PORT + 20) { port++; setTimeout(() => rmSrv && rmSrv.listen(port, '0.0.0.0'), 50); return; }
    rmErr = String((err && err.message) || err);
    rmPort = 0;
    rmNotify();
  });
  rmSrv.on('listening', () => { rmPort = port; rmNotify(); });
  rmSrv.on('upgrade', (req, sock, head) => { if (!team.upgrade(req, sock, head)) sock.destroy(); }); // WebSocket группы /ws
  rmSrv.listen(port, '0.0.0.0');
}
function rmStop() {
  if (!rmSrv) return;
  for (const w of rmWait) { clearTimeout(w.timer); try { w.res.end('{}'); } catch {} }
  rmWait.clear();
  rmSrv.close();
  rmSrv = null;
  rmPort = 0;
  rmMirrorClose();
  rmNotify();
}
const rmNotify = () => { if (control && !control.isDestroyed()) control.webContents.send('remote:info', rmInfo()); team.changed(); };
// Сервер нужен, пока есть хоть один доступ к презентации или включён доступ для группы (простой адрес /app/ по Wi-Fi)
let chordReq = 0;
const chordWait = new Map(); // ответы окна оператора на аккорды с телефона
const rmWant = () => { if (rmState.grants.length || team.on()) rmStart(); else rmStop(); };

// Что видит телефон: только своя презентация
function rmView(g) {
  return {
    rev: rmRev, name: g.name, show: !!g.show, edit: !!g.edit, live: g.live || null, other: !!g.other,
    aspect: rmState.size.W / rmState.size.H || 16 / 9,
    slides: g.slides.map((s) => ({ id: s.id, k: s.k, label: s.label || '', text: s.text || '', v: s.v })),
  };
}

function rmSend(res, code, type, body, extra) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(extra || {}) });
  res.end(body);
}
const rmJson = (res, x) => rmSend(res, 200, 'application/json; charset=utf-8', JSON.stringify(x));

function rmHandle(req, res) {
  // Кто стучится: телефон (не этот компьютер) — запомнить и сказать окну оператора (не чаще раза в 3 с)
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip && ip !== '127.0.0.1' && ip !== '::1' && !rmIps().includes(ip)) {
    const old = rmSeen;
    rmSeen = { ip, at: Date.now() };
    if (!old || old.ip !== ip || rmSeen.at - old.at > 3000) rmNotify();
  }
  const u = new URL(req.url, 'http://x');
  if (team.route(req, res, u)) return; // приложение группы: /app/… (teamsrv.js)
  const t = u.searchParams.get('t');
  const m = /^\/r\/([0-9a-z]+)\/?$/.exec(u.pathname);
  if (m) {
    if (!rmGrant(m[1])) return rmSend(res, 404, 'text/html; charset=utf-8', '<meta name="viewport" content="width=device-width"><p style="font:18px sans-serif">Доступ закрыт или ссылка устарела. Попросите оператора показать новый QR-код.</p>');
    return fs.readFile(path.join(__dirname, 'phone.html'), (err, buf) => (err ? rmSend(res, 500, 'text/plain', 'нет phone.html') : rmSend(res, 200, 'text/html; charset=utf-8', buf)));
  }
  if (u.pathname === '/icon.png') return fs.readFile(path.join(__dirname, 'brand', 'icon-256.png'), (err, buf) => (err ? rmSend(res, 404, 'text/plain', '') : rmSend(res, 200, 'image/png', buf)));
  const g = rmGrant(t);
  if (u.pathname.startsWith('/api/') && !g) return rmSend(res, 403, 'application/json', '{"gone":true}');
  if (u.pathname === '/api/state') {
    // Долгий опрос: ответ сразу, если что-то поменялось, иначе ждём до 20 с
    if (Number(u.searchParams.get('rev')) !== rmRev) return rmJson(res, rmView(g));
    const w = { res, t, timer: setTimeout(() => { rmWait.delete(w); const gg = rmGrant(t); if (gg) rmJson(res, rmView(gg)); else rmSend(res, 403, 'application/json', '{"gone":true}'); }, 20000) };
    rmWait.add(w);
    res.on('close', () => { clearTimeout(w.timer); rmWait.delete(w); }); // телефон ушёл — не ждать
    return;
  }
  if (u.pathname === '/api/thumb') {
    const s = g.slides.find((x) => x.id === u.searchParams.get('s'));
    if (!s || !s.content) return rmSend(res, 404, 'text/plain', '');
    return rmThumb(s).then((buf) => (buf ? rmSend(res, 200, 'image/jpeg', buf, { 'Cache-Control': 'max-age=3600' }) : rmSend(res, 404, 'text/plain', '')));
  }
  if (u.pathname === '/api/live') {
    rmMirrorUsed = Date.now();
    rmMirrorOpen();
    const img = rmMirrorFrame;
    return img && !img.isEmpty() ? rmSend(res, 200, 'image/jpeg', img.toJPEG(70)) : rmSend(res, 204, 'image/jpeg', '');
  }
  if (u.pathname === '/api/cmd' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      let msg = {};
      try { msg = JSON.parse(body) || {}; } catch {}
      const cmd = String(msg.cmd || '');
      const okShow = g.show && ['show', 'next', 'prev', 'clear'].includes(cmd);
      const okEdit = g.edit && cmd === 'edit' && typeof msg.text === 'string';
      if (!okShow && !okEdit) return rmJson(res, { ok: false, error: 'Нет доступа' });
      if (control && !control.isDestroyed()) control.webContents.send('remote:cmd', { token: g.token, cmd, sid: String(msg.sid || ''), text: okEdit ? msg.text.slice(0, 20000) : undefined });
      rmJson(res, { ok: true });
    });
    return;
  }
  rmSend(res, 404, 'text/plain; charset=utf-8', 'нет такой страницы');
}

// Картинки слайдов: одно скрытое окно, по очереди
let rmThumbWin = null;
let rmThumbQ = Promise.resolve();
let rmThumbFrame = null;
function rmThumbSize() {
  const { W, H } = rmState.size;
  return { width: 480, height: Math.max(120, Math.min(960, Math.round((480 * H) / W) || 270)) };
}
function rmThumbOpen() {
  if (rmThumbWin && !rmThumbWin.isDestroyed()) return Promise.resolve(rmThumbWin);
  const sz = rmThumbSize();
  rmThumbWin = new BrowserWindow({ ...sz, show: false, frame: false, useContentSize: true, webPreferences: { ...webPreferences, offscreen: true } });
  rmThumbWin.webContents.setAudioMuted(true);
  rmThumbWin.webContents.setFrameRate(10);
  rmThumbWin.webContents.on('paint', (_e, _d, img) => { rmThumbFrame = img; });
  rmThumbWin.on('closed', () => { rmThumbWin = null; });
  return new Promise((ok) => { rmThumbWin.webContents.once('did-finish-load', () => ok(rmThumbWin)); rmThumbWin.loadFile('thumb.html'); });
}
function rmThumb(s) {
  if (rmThumbs.has(s.v)) return Promise.resolve(rmThumbs.get(s.v));
  const job = rmThumbQ.then(async () => {
    if (rmThumbs.has(s.v)) return rmThumbs.get(s.v);
    const w = await rmThumbOpen();
    const sz = rmThumbSize();
    const [cw, ch] = w.getContentSize();
    if (cw !== sz.width || ch !== sz.height) w.setContentSize(sz.width, sz.height);
    const ready = new Promise((ok) => { const f = () => ok(); ipcMain.once('thumb:ready', f); setTimeout(() => { ipcMain.removeListener('thumb:ready', f); ok(); }, 2500); });
    w.webContents.send('thumb:draw', s.content);
    await ready;
    rmThumbFrame = null;
    w.webContents.invalidate();
    for (let i = 0; i < 80 && !rmThumbFrame; i++) { await new Promise((ok) => setTimeout(ok, 25)); if (i === 20) w.webContents.invalidate(); } // первая картинка нового окна — дольше
    const buf = rmThumbFrame && !rmThumbFrame.isEmpty() ? rmThumbFrame.toJPEG(72) : null;
    if (buf) {
      rmThumbs.set(s.v, buf);
      if (rmThumbs.size > 400) rmThumbs.delete(rmThumbs.keys().next().value);
    }
    return buf;
  });
  rmThumbQ = job.catch(() => {});
  return job.catch(() => null);
}

// «Сейчас на экране»: зеркало вывода «Основного» экрана; закрывается само, когда телефоны не смотрят
function rmMirrorOpen() {
  if (rmMirror && !rmMirror.isDestroyed()) return;
  const { W, H } = rmState.size;
  rmMirror = new BrowserWindow({ width: 480, height: Math.round((480 * H) / W) || 270, show: false, frame: false, useContentSize: true, webPreferences: { ...webPreferences, offscreen: true } });
  rmMirror.webContents.setAudioMuted(true);
  rmMirror.webContents.setFrameRate(4);
  rmMirror.webContents.on('paint', (_e, _d, img) => { rmMirrorFrame = img; });
  rmMirror.webContents.on('did-finish-load', () => {
    rmMirror.webContents.send('output:settings', { resW: W, resH: H });
    replayTo(rmMirror);
  });
  rmMirror.on('closed', () => { rmMirror = null; rmMirrorFrame = null; });
  rmMirror.loadFile('output.html', { query: { screen: 'main' } });
}
function rmMirrorClose() { if (rmMirror && !rmMirror.isDestroyed()) rmMirror.destroy(); rmMirror = null; rmMirrorFrame = null; }
setInterval(() => { if (rmMirror && Date.now() - rmMirrorUsed > 15000) rmMirrorClose(); }, 5000);

// Окно оператора: доступы и их презентации (сервер включён, пока есть хоть один доступ)
ipcMain.handle('remote:state', (_e, st) => {
  const grants = (st && Array.isArray(st.grants) ? st.grants : []).filter((g) => g && /^[0-9a-z]+$/.test(String(g.token || '')));
  for (const g of grants) {
    g.slides = Array.isArray(g.slides) ? g.slides : [];
    for (const s of g.slides) s.v = s.content ? rmHash([s.content, st.size]) : '';
  }
  rmState = { grants, size: st && st.size && st.size.W > 0 && st.size.H > 0 ? st.size : { W: 1920, H: 1080 } };
  rmRev++;
  // Ждущим телефонам — новое состояние; доступ убрали — «закрыто»
  for (const w of [...rmWait]) {
    clearTimeout(w.timer);
    rmWait.delete(w);
    const g = rmGrant(w.t);
    try { if (g) rmJson(w.res, rmView(g)); else rmSend(w.res, 403, 'application/json', '{"gone":true}'); } catch {}
  }
  rmWant();
  return rmInfo();
});
ipcMain.handle('remote:info', () => rmInfo());
// Брандмауэр Windows: без правила телефон не достучится (особенно в «общественной» сети Wi-Fi).
// Правило по портам пульта (8090–8110) и порту HTTPS группы (teamsrv.js, обычно 443), для любых сетей;
// ставит его сам владелец кнопкой — Windows спрашивает разрешение (UAC). team — в правиле есть порт группы
const RM_FW = 'multiplayerSHOW — пульт с телефона';
const rmPs = (cmd) => new Promise((ok) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + cmd],
  { windowsHide: true, timeout: 60000 }, (err, out) => ok(err ? '' : String(out || ''))));
async function rmFw() {
  if (process.platform !== 'win32') return { rule: true, pub: false, team: true };
  const out = await rmPs(`$r = @(Get-NetFirewallRule -DisplayName '${RM_FW}' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }); $ports = @($r | Get-NetFirewallPortFilter | ForEach-Object { $_.LocalPort }) -join ','; $p = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' }).Count; "$($r.Count)|$p|$ports"`);
  const [r, p, ports] = out.trim().split('|');
  const tp = team.port();
  const has = String(ports || '').split(',').some((x) => { const m = /^(\d+)(?:-(\d+))?$/.exec(x.trim()); return m && tp >= +m[1] && tp <= +(m[2] || m[1]); });
  return { rule: Number(r) > 0, pub: Number(p) > 0, team: Number(r) > 0 && has };
}
ipcMain.handle('remote:fw', () => rmFw());
ipcMain.handle('remote:fwFix', async () => {
  const inner = `Remove-NetFirewallRule -DisplayName '${RM_FW}' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '${RM_FW}' -Direction Inbound -Protocol TCP -LocalPort '${RM_PORT}-${RM_PORT + 20}','${team.port()}' -Action Allow -Profile Any | Out-Null`;
  const enc = Buffer.from(inner, 'utf16le').toString('base64');
  await rmPs(`try { Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-EncodedCommand','${enc}' } catch {}`);
  return rmFw();
});

app.on('window-all-closed', () => app.quit());
