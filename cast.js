/* ===== Приём экрана с телефона и компьютера (главный процесс) =====
   AirPlay (iPhone, iPad, Mac): бесплатный приёмник UxPlay (uxplay.exe) под именем «MP SHOW»; ему нужна служба Bonjour от Apple.
   Miracast (Android, Windows — Win+K): встроенное приложение Windows «Беспроводной дисплей» (Параметры → Система →
   Проецирование на этот компьютер), в списке телефона — имя компьютера.
   Картинку оба показывают в своём окне — его и берём как источник (окно экрана, desktopCapturer).
   Окну оператора: 'cast:event' { kind, on, name } — подключились/отключились. */
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { desktopCapturer, Notification, BrowserWindow } = require('electron');

const CAST_NAME = 'MP SHOW';
// Заголовки окна «Беспроводной дисплей» (Windows 11) и «Подключить» (Windows 10)
const MIRACAST_RE = /^(Беспроводной дисплей|Wireless Display|Подключить|Connect)$/i;
// Окно картинки UxPlay (GStreamer)
const AIRPLAY_RE = /^MP SHOW$|uxplay|Direct3D11 renderer|Direct3D renderer|OpenGL renderer/i;

let control = () => null;
let icon = '';
let ux = null;            // процесс UxPlay
let uxPath;               // путь к uxplay.exe; null — не найден
let uxErr = '';           // почему не запустился
let air = { on: false, name: '' };   // подключён ли кто-то по AirPlay
let mira = { on: false, appId: null };
let miraLaunched = 0;     // когда открыли «Беспроводной дисплей» сами
const wins = { airplay: null, miracast: null }; // id окна-источника

function findUxplay() {
  if (uxPath !== undefined) return uxPath;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const here = path.dirname(process.execPath);
  const list = [
    path.join(__dirname, 'uxplay', 'uxplay.exe'), path.join(here, 'uxplay', 'uxplay.exe'),
    path.join(process.env.APPDATA || '', 'church-presenter', 'uxplay', 'uxplay.exe'),
    path.join(pf, 'UxPlay', 'uxplay.exe'), 'C:\\msys64\\ucrt64\\bin\\uxplay.exe', 'C:\\msys64\\mingw64\\bin\\uxplay.exe',
    ...(process.env.PATH || '').split(';').filter(Boolean).map((d) => path.join(d, 'uxplay.exe')),
  ];
  uxPath = list.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
  return uxPath;
}

const send = (ch, data) => { const w = control(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
// Событие о подключении — всем окнам: на выводе слой «ждём подключения» оживает сам
const sendAll = (data) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('cast:event', data); };

// Уведомление Windows; щелчок — окно программы наверх, раздел «Источники»
function notify(title, body) {
  sendAll({ notice: body });
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon, silent: false });
  n.on('click', () => {
    const w = control();
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    w.focus();
    send('cast:open', null);
  });
  n.show();
}

/* ----- AirPlay: UxPlay ----- */

function startAirplay() {
  if (ux || !findUxplay()) return;
  uxErr = '';
  // -n имя, -nh без «@компьютер», -vs окно Direct3D 11; звук — в то же окно Windows (по умолчанию)
  try {
    ux = spawn(uxPath, ['-n', CAST_NAME, '-nh', '-vs', 'd3d11videosink'], { cwd: path.dirname(uxPath), windowsHide: true });
  } catch (err) { uxErr = String(err.message || err); ux = null; return; }
  let tail = '';
  const onText = (buf) => {
    tail = (tail + buf.toString()).slice(-4000);
    const lines = tail.split(/\r?\n/);
    tail = lines.pop();
    for (const l of lines) airplayLine(l);
  };
  ux.stdout.on('data', onText);
  ux.stderr.on('data', onText);
  ux.on('error', (err) => { uxErr = String(err.message || err); });
  ux.on('exit', (code) => {
    ux = null;
    if (air.on) airplayOff();
    if (code && !uxErr) uxErr = /bonjour|dns_sd|mdns/i.test(tail) ? 'нет службы Bonjour' : `UxPlay остановился (код ${code})`;
    sendAll({ kind: 'airplay', state: true });
  });
}

function airplayLine(l) {
  if (/bonjour|dnssd|dns_sd/i.test(l) && /fail|error|not|unable/i.test(l)) uxErr = 'нет службы Bonjour — установите Bonjour от Apple';
  // «connection request from iPhone (…)» — имя устройства
  const m = l.match(/connection request from\s+(.+?)\s*(\(|with deviceID|$)/i);
  if (m) air.name = m[1].trim();
  const open = l.match(/open connections:\s*(\d+)/i);
  if (open) {
    const n = +open[1];
    if (n > 0 && !air.on) { air.on = true; sendAll({ kind: 'airplay', on: true, name: air.name }); }
    if (n === 0 && air.on) airplayOff();
  }
}

function airplayOff() {
  const name = air.name;
  air = { on: false, name: '' };
  wins.airplay = null;
  sendAll({ kind: 'airplay', on: false, name });
}

/* ----- Miracast: приложение Windows «Беспроводной дисплей» ----- */

// Есть ли приложение (ставится как «Дополнительный компонент» Windows) — ищем в меню «Пуск»
function findMiracast() {
  return new Promise((done) => {
    const ps = 'Get-StartApps | Where-Object { $_.Name -match \'Беспроводной дисплей|Wireless Display|^Подключить$|^Connect$\' } | Select-Object -First 1 -ExpandProperty AppID';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + ps],
      { windowsHide: true, timeout: 15000 }, (err, out) => {
        mira.appId = err ? null : String(out || '').trim() || null;
        done(mira.appId);
      });
  });
}

/* ----- Окна с картинкой: ищем каждые 2 с ----- */

let busy = false;
async function watch() {
  if (busy) return;
  busy = true;
  try {
    const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    const a = air.on ? list.find((s) => AIRPLAY_RE.test(s.name)) : null;
    const m = list.find((s) => MIRACAST_RE.test(s.name.trim()));
    if (a && wins.airplay !== a.id) {
      wins.airplay = a.id;
      notify('Новый источник: AirPlay', `${air.name || 'Устройство Apple'} показывает экран в «${CAST_NAME}» — Медиапул → Источники`);
      sendAll({ kind: 'airplay', on: true, name: air.name, ready: true });
    }
    // Windows сама открывает «Беспроводной дисплей», когда телефон подключается
    if (m && wins.miracast !== m.id) {
      wins.miracast = m.id;
      mira.on = true;
      // открыли сами кнопкой — это ещё не телефон, без уведомления
      if (Date.now() - miraLaunched > 15000) notify('Новый источник: Miracast', 'Телефон или компьютер показывает экран по Miracast — Медиапул → Источники');
      sendAll({ kind: 'miracast', on: true, ready: true });
    }
    if (!m && mira.on) {
      mira.on = false;
      wins.miracast = null;
      sendAll({ kind: 'miracast', on: false });
    }
  } catch { /* список окон не получили — в следующий раз */ }
  busy = false;
}

function state() {
  return {
    name: CAST_NAME,
    airplay: { found: !!findUxplay(), running: !!ux, error: uxErr, on: air.on, name: air.name, ready: !!wins.airplay },
    miracast: { found: !!mira.appId, on: mira.on, ready: !!wins.miracast },
  };
}

function setup(ipcMain, getControl, appIcon) {
  control = getControl;
  icon = appIcon;
  startAirplay();
  findMiracast();
  setInterval(watch, 2000);
  ipcMain.handle('cast:state', async (_e, again) => {
    if (again) { uxPath = undefined; startAirplay(); await findMiracast(); }
    return state();
  });
  // id окна с картинкой: kind — 'airplay' | 'miracast'; нет — null (ещё не подключились)
  ipcMain.handle('cast:window', (_e, kind) => wins[kind] || null);
  // Открыть «Беспроводной дисплей», чтобы компьютер стал виден телефонам
  ipcMain.handle('cast:miracast', async () => {
    if (!mira.appId) await findMiracast();
    if (!mira.appId) return false;
    miraLaunched = Date.now();
    spawn('explorer.exe', ['shell:AppsFolder\\' + mira.appId], { windowsHide: true, detached: true }).unref();
    return true;
  });
}

function stop() {
  if (ux) { try { ux.kill(); } catch { /* уже закрыт */ } ux = null; }
}

module.exports = { setup, stop };
