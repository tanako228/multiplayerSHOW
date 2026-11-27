/* ---------- Облако (главный процесс): вход в Google, выбор места, синхронизация открытого профиля ----------
   Ядро — sync/core.js, данные программы ↔ документы — sync/appsource.js, места — sync/providers/*.
   Окно — cloud.js (Настройки → Облако). Всё своё — в <папка программы>\cloud:
     device.json                 — номер этой установки (вместе с профилем — «устройство» в облаке)
     google-client.json          — свой пропуск в Google, если в сборке его нет (sync/google-client.js)
     <профиль>\google-token.txt  — вход в Google (зашифрован Windows, safeStorage)
     <профиль>\core-<место>.json — что было при прошлой синхронизации с этим местом (своё у Google и у каждой папки)
     <профиль>\source.json       — время правок, отпечатки файлов, где лежат чужие файлы здесь
     <профиль>\last.json         — итог последней синхронизации
     <профиль>\conflicts\<дата>\ — версии, проигравшие при одновременной правке
   У каждого профиля — свой вход и своё место: «Основное» и «Молодёжное» могут синхронизироваться с разными аккаунтами. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createSync } = require('./sync/core.js');
const { createAppSource } = require('./sync/appsource.js');
const { gdriveProvider } = require('./sync/providers/gdrive.js');
const { folderProvider } = require('./sync/providers/folder.js');
const BUILT_IN = require('./sync/google-client.js');

/* d: { ud(), profile() → { id, name }, libView(), saveLib(obj), readIndex(), writeIndex(list), bibleDir(),
        owner(kind, key), seal(s), unseal(s), openUrl(url), openPath(dir), pickDir(sender), blocked() → bool, send(ch, data), app } */
function setup(ipcMain, d) {
  const root = () => path.join(d.ud(), 'cloud');
  const profDir = () => path.join(root(), d.profile().id || 'main');
  const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };

  function deviceId() {
    const f = path.join(root(), 'device.json');
    let m = readJson(f, null);
    if (!m || !/^[\w-]+$/.test(m.id || '')) { m = { id: crypto.randomBytes(6).toString('hex') }; writeJson(f, m); }
    return m.id + '-' + String(d.profile().id || 'main').replace(/[^\w-]/g, '_');
  }
  const deviceName = () => `${d.devName ? d.devName() : os.hostname()} — ${d.profile().name || 'Основной'}`;

  function client() {
    const own = readJson(path.join(root(), 'google-client.json'), null);
    if (own && own.clientId) return { clientId: own.clientId, clientSecret: own.clientSecret || '', own: true };
    return { clientId: BUILT_IN.clientId, clientSecret: BUILT_IN.clientSecret, own: false };
  }

  // Google Диск открытого профиля (вход хранится в папке профиля)
  const gdCache = new Map();
  function gdrive() {
    const c = client();
    if (!c.clientId) return null;
    const key = profDir() + '|' + c.clientId;
    if (!gdCache.has(key)) {
      const tf = () => path.join(profDir(), 'google-token.txt');
      gdCache.set(key, gdriveProvider({
        clientId: c.clientId, clientSecret: c.clientSecret, t: d.t,
        tokens: {
          load: () => { try { return JSON.parse(d.unseal(fs.readFileSync(tf(), 'utf8'))); } catch { return null; } },
          save: (t) => { if (!t) fs.rmSync(tf(), { force: true }); else { fs.mkdirSync(path.dirname(tf()), { recursive: true }); fs.writeFileSync(tf(), d.seal(JSON.stringify(t))); } },
        },
      }));
    }
    return gdCache.get(key);
  }

  const placeKey = (cfg) => (cfg && cfg.provider === 'folder' ? 'folder-' + crypto.createHash('md5').update(String(cfg.dir || '').toLowerCase()).digest('hex').slice(0, 10) : 'gdrive');
  function providerOf(cfg) {
    if (cfg && cfg.provider === 'folder') {
      if (!cfg.dir || !fs.existsSync(cfg.dir)) { const e = new Error('Папка не найдена: ' + (cfg.dir || 'не выбрана')); e.code = 'NO_DIR'; throw e; }
      return folderProvider(cfg.dir);
    }
    const g = gdrive();
    if (!g) { const e = new Error('В этой сборке нет пропуска Google — впишите свой в «Облако → Для разработчика»'); e.code = 'NO_CLIENT'; throw e; }
    if (!g.signedIn()) { const e = new Error('Войдите в Google'); e.code = 'NEED_SIGNIN'; throw e; }
    return g;
  }
  const forget = (cfg) => fs.rmSync(path.join(profDir(), `core-${placeKey(cfg)}.json`), { force: true });

  function state(cfg) {
    const c = client();
    const g = gdrive();
    return {
      google: { configured: !!c.clientId, own: c.own, signedIn: !!(g && g.signedIn()) },
      folder: { dir: cfg && cfg.dir || '', exists: !!(cfg && cfg.dir && fs.existsSync(cfg.dir)) },
      device: deviceName(),
      busy: !!running,
      last: readJson(path.join(profDir(), 'last.json'), null),
    };
  }

  let running = null;
  let lastSent = 0;
  async function run({ cfg, ls, parts, prefer, pushOnly, adopt }) {
    if (d.blocked()) return { ok: false, skipped: true };
    const provider = providerOf(cfg);
    const dir = profDir();
    const coreFile = path.join(dir, `core-${placeKey(cfg)}.json`);
    const src = createAppSource({
      ud: d.ud(), libView: d.libView, saveLib: d.saveLib, ls: ls || {}, readIndex: d.readIndex, writeIndex: d.writeIndex,
      bibleDir: d.bibleDir(), owner: d.owner, parts: new Set(parts || []),
      stateFile: path.join(dir, 'source.json'), conflictDir: path.join(dir, 'conflicts'),
    });
    const core = createSync({
      provider, source: src, deviceId: deviceId(), deviceName: deviceName(), include: src.include,
      state: { load: async () => readJson(coreFile, null), save: async (o) => writeJson(coreFile, o) },
      onProgress: (p) => { const t = Date.now(); if (t - lastSent > 200 || p.i + 1 === p.n) { lastSent = t; d.send('cloud:progress', p); } },
    });
    const fresh = await core.fresh();
    if (fresh && pushOnly) return { ok: true, skipped: 'fresh' }; // до первой полной синхронизации ничего не отправляем сами
    if (fresh && !prefer && await core.others()) return { ok: false, needChoice: true };
    const res = await core.sync({ prefer, pushOnly, adopt: !!(adopt && fresh && prefer === 'remote') }); // «заменить» — только при первой синхронизации
    const out = src.finish();
    const sum = {
      date: Date.now(), place: cfg && cfg.provider === 'folder' ? 'folder' : 'gdrive', pushOnly: !!pushOnly,
      pushed: res.pushed.length, pulled: res.pulled.length, deleted: res.deleted.length, conflicts: res.conflicts.length,
      pending: res.pending.length, errors: res.errors.slice(0, 20), skipped: out.skipped.length, kept: out.kept,
    };
    writeJson(path.join(dir, 'last.json'), sum);
    return { ok: true, sum, out };
  }

  ipcMain.handle('cloud:state', (_e, cfg) => state(cfg));
  ipcMain.handle('cloud:sync', async (_e, opts = {}) => {
    if (running) return { ok: false, busy: true };
    running = run(opts);
    try { return await running; } catch (err) {
      return { ok: false, error: String(err && err.message || err), needSignIn: err && err.code === 'NEED_SIGNIN', code: err && err.code };
    } finally { running = null; }
  });
  ipcMain.handle('cloud:signin', async (_e, cfg) => {
    const g = gdrive();
    if (!g) return { ok: false, error: 'В этой сборке нет пропуска Google', state: state(cfg) };
    try {
      await g.signIn({ openUrl: d.openUrl });
      forget({ provider: 'gdrive' }); // другой аккаунт — сравнивать заново
      return { ok: true, state: state(cfg) };
    } catch (err) { return { ok: false, error: String(err && err.message || err), state: state(cfg) }; }
  });
  ipcMain.handle('cloud:signout', async (_e, cfg) => {
    const g = gdrive();
    if (g) await g.signOut();
    forget({ provider: 'gdrive' });
    return state(cfg);
  });
  ipcMain.handle('cloud:client', (_e, { cfg, clientId, clientSecret } = {}) => {
    const f = path.join(root(), 'google-client.json');
    const id = String(clientId || '').trim();
    if (!id) fs.rmSync(f, { force: true });
    else if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) return { ok: false, error: 'Идентификатор клиента выглядит так: …apps.googleusercontent.com', state: state(cfg) };
    else writeJson(f, { clientId: id, clientSecret: String(clientSecret || '').trim() });
    gdCache.clear();
    return { ok: true, state: state(cfg) };
  });
  ipcMain.handle('cloud:pickDir', (e) => d.pickDir(e.sender));
  ipcMain.handle('cloud:conflicts', () => { const p = path.join(profDir(), 'conflicts'); fs.mkdirSync(p, { recursive: true }); return d.openPath(p); });

  // Закрытие программы: идущую синхронизацию не обрывать (но не дольше 20 с)
  let quitting = false;
  d.app.on('before-quit', (e) => {
    if (!running || quitting) return;
    e.preventDefault();
    quitting = true;
    Promise.race([running.catch(() => {}), new Promise((r) => setTimeout(r, 20000))]).finally(() => setTimeout(() => d.app.quit(), 50));
  });
}

module.exports = { setup };
