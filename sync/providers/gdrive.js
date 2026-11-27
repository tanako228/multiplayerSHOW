/* ---------- Провайдер «Google Диск» ----------
   Файлы лежат в скрытой папке приложения (appDataFolder): на диске пользователя их не видно, чужие файлы программе
   недоступны. Права — только https://www.googleapis.com/auth/drive.appdata.
   Вход — как в классических программах: открывается браузер, Google возвращает код на адрес 127.0.0.1:<порт> (PKCE).
   Пароль Google программа не видит; хранится только «токен обновления» (tokens.save — зашифровать safeStorage в main.js).
   Нужен clientId приложения («Desktop app» в Google Cloud Console → API и сервисы → Учётные данные, включить Google Drive API).
   Имена файлов в Диске плоские: путь 'blobs/ab/abc…' хранится как есть в поле name (слэш в имени Диск допускает). */
'use strict';
const crypto = require('crypto');
const http = require('http');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SIMPLE_MAX = 4 * 1024 * 1024; // больше — докачиваемая загрузка кусками
const CHUNK = 8 * 1024 * 1024;      // кратно 256 КБ, как требует Google

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class NeedSignIn extends Error {
  constructor(msg) { super(msg || 'Нужно войти в Google заново'); this.code = 'NEED_SIGNIN'; }
}

/* cfg: { clientId, clientSecret?, tokens: { load(): obj|null, save(obj|null) }, fetch?, sleep?, now? } */
function gdriveProvider(cfg) {
  const tr = (s) => (cfg.t ? cfg.t(s) : s); // язык интерфейса — для страницы «Готово» в браузере после входа
  const f = cfg.fetch || globalThis.fetch;
  const sleep = cfg.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = cfg.now || Date.now;
  let tok = null; // { access_token, refresh_token, expires }
  let idx = null; // имя → { id, name, size, mtime }

  const loadTok = () => { if (!tok) tok = cfg.tokens.load() || null; return tok; };
  const saveTok = (t) => { tok = t; return cfg.tokens.save(t); };

  async function tokenCall(params) {
    const body = new URLSearchParams({ client_id: cfg.clientId, ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}), ...params });
    const r = await f(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  }

  /* Вход. openUrl(url) — открыть адрес в браузере (shell.openExternal). Возвращает Promise; готово, когда токен сохранён. */
  async function signIn({ openUrl, timeoutMs = 5 * 60 * 1000 }) {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    let server;
    const got = new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        if (u.searchParams.get('state') !== state || (!code && !err)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<meta charset="utf-8"><body style="font:16px sans-serif;text-align:center;margin-top:20vh">${tr(err ? 'Вход отменён.' : 'Готово! Можно закрыть эту вкладку и вернуться в программу.')}</body>`);
        if (err) reject(new Error('Вход отменён: ' + err)); else resolve(code);
      });
      server.on('error', reject);
      setTimeout(() => reject(new Error('Время на вход вышло')), timeoutMs).unref();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const redirect = `http://127.0.0.1:${server.address().port}`;
      const url = AUTH_URL + '?' + new URLSearchParams({
        client_id: cfg.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state,
      });
      await openUrl(url);
      const code = await got;
      const { ok, j } = await tokenCall({ code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' });
      if (!ok || !j.refresh_token) throw new Error('Google не выдал доступ: ' + (j.error_description || j.error || 'нет токена'));
      await saveTok({ access_token: j.access_token, refresh_token: j.refresh_token, expires: now() + (j.expires_in || 3600) * 1000 });
      idx = null;
    } finally { server.close(); }
  }
  async function signOut() { idx = null; await saveTok(null); }
  const signedIn = () => !!(loadTok() && tok.refresh_token);

  async function accessToken(force) {
    const t = loadTok();
    if (!t || !t.refresh_token) throw new NeedSignIn();
    if (!force && t.access_token && t.expires - 60000 > now()) return t.access_token;
    const { ok, j } = await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    if (!ok) {
      if (j.error === 'invalid_grant') { await saveTok(null); throw new NeedSignIn('Доступ к Google отозван — войдите заново'); }
      throw new Error('Google: не обновился доступ (' + (j.error || 'ошибка') + ')');
    }
    await saveTok({ ...t, access_token: j.access_token, expires: now() + (j.expires_in || 3600) * 1000 });
    return tok.access_token;
  }

  // Запрос с повтором: 401 — обновить доступ один раз; 429 и 5xx — подождать и повторить
  async function call(url, init = {}, tries = 5) {
    let refreshed = false;
    for (let a = 0; ; a++) {
      const r = await f(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + await accessToken(refreshed) } });
      if (r.status === 401 && !refreshed) { refreshed = true; continue; }
      if ((r.status === 429 || r.status >= 500) && a < tries) { await sleep(Math.min(30000, 500 * 2 ** a)); continue; }
      return r;
    }
  }
  const must = async (r, what) => {
    if (!r.ok) throw new Error(`Google Диск: ${what} — ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
    return r;
  };

  // Список всех файлов приложения (постранично) — один запрос на синхронизацию
  async function reindex() {
    const m = new Map();
    let page = '';
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,name,size,modifiedTime)' });
      if (page) q.set('pageToken', page);
      const j = await (await must(await call(`${API}/files?${q}`), 'список файлов')).json();
      for (const x of j.files || []) {
        const rec = { id: x.id, name: x.name, size: +x.size || 0, mtime: Date.parse(x.modifiedTime) || 0 };
        const old = m.get(x.name);
        if (!old || rec.mtime > old.mtime) m.set(x.name, rec); // повторы имён (две записи одновременно) — берём свежее
      }
      page = j.nextPageToken || '';
    } while (page);
    idx = m;
    return m;
  }
  async function locate(name) {
    if (!idx) await reindex();
    let r = idx.get(name);
    if (!r) { await reindex(); r = idx.get(name); } // мог появиться у другого устройства после списка
    return r;
  }

  function multipart(meta, buf) {
    const boundary = 'b' + crypto.randomBytes(12).toString('hex');
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
    return { type: `multipart/related; boundary=${boundary}`, body: Buffer.concat([Buffer.from(head), buf, Buffer.from(`\r\n--${boundary}--`)]) };
  }

  // Докачиваемая загрузка кусками (большие файлы)
  async function resumable(method, url, meta, buf) {
    const init = await must(await call(url, { method, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(buf.length) }, body: JSON.stringify(meta) }), 'начало загрузки');
    const loc = init.headers.get('location');
    if (!loc) throw new Error('Google Диск: нет адреса загрузки');
    for (let s = 0; s < buf.length; s += CHUNK) {
      const e = Math.min(s + CHUNK, buf.length);
      const r = await call(loc, { method: 'PUT', headers: { 'Content-Range': `bytes ${s}-${e - 1}/${buf.length}` }, body: buf.subarray(s, e) });
      if (e === buf.length) return (await must(r, 'загрузка')).json();
      if (r.status !== 308) await must(r, 'загрузка куска');
    }
  }

  return {
    id: 'gdrive', name: 'Google Диск', signIn, signOut, signedIn,
    async read(p) {
      const rec = await locate(p);
      if (!rec) return null;
      const r = await call(`${API}/files/${rec.id}?alt=media`);
      if (r.status === 404) { idx = null; return null; }
      await must(r, 'чтение ' + p);
      return Buffer.from(await r.arrayBuffer());
    },
    async write(p, buf) {
      if (!idx) await reindex();
      const rec = idx.get(p);
      let j;
      if (buf.length > SIMPLE_MAX) {
        j = rec ? await resumable('PATCH', `${UPLOAD}/files/${rec.id}?uploadType=resumable&fields=id,name,size,modifiedTime`, {}, buf)
          : await resumable('POST', `${UPLOAD}/files?uploadType=resumable&fields=id,name,size,modifiedTime`, { name: p, parents: ['appDataFolder'] }, buf);
      } else if (rec) {
        j = await (await must(await call(`${UPLOAD}/files/${rec.id}?uploadType=media&fields=id,name,size,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: buf }), 'запись ' + p)).json();
      } else {
        const mp = multipart({ name: p, parents: ['appDataFolder'] }, buf);
        j = await (await must(await call(`${UPLOAD}/files?uploadType=multipart&fields=id,name,size,modifiedTime`, { method: 'POST', headers: { 'Content-Type': mp.type }, body: mp.body }), 'запись ' + p)).json();
      }
      idx.set(p, { id: j.id, name: p, size: buf.length, mtime: Date.parse(j.modifiedTime) || now() });
    },
    async list(prefix) {
      const m = await reindex();
      return [...m.values()].filter((x) => x.name.startsWith(prefix)).map(({ name, size, mtime }) => ({ name, size, mtime }));
    },
    async remove(p) {
      const rec = await locate(p);
      if (!rec) return;
      const r = await call(`${API}/files/${rec.id}`, { method: 'DELETE' });
      if (r.status !== 404) await must(r, 'удаление ' + p);
      idx.delete(p);
    },
  };
}

module.exports = { gdriveProvider, NeedSignIn };
