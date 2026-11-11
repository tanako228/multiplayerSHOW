/* ---------- Сервер группы (главный процесс): адрес-домен, HTTPS, DNS-провайдеры — ТЗ-8-Группа.md ----------
   Телефоны группы открывают https://<домен>/app/. Домен (deSEC или Duck DNS) указывает на ЛОКАЛЬНЫЙ IP этого
   компьютера: программа сама меняет A-запись, когда IP поменялся (сверка раз в минуту). Сертификат Let's Encrypt —
   через DNS-01: TXT-запись _acme-challenge.<домен> ставит программа, ждёт её на серверах имён провайдера,
   получает сертификат; продление само, когда осталось меньше 30 дней (проверка каждые 6 ч).
   Настройки — team.json в папке данных (раздел net; другие разделы файла не трогаем), ключи и сертификат — tls\.
   Токен провайдера хранится зашифрованным (safeStorage из main.js) и в окно оператора не уходит.
   Запросы https идут в общий обработчик пульта (main.js: rmHandle); он отдаёт сюда /app/… (route).
   Без домена тоже можно: пока доступ включён, работает простой адрес http://<IP>:8090/app/ (http-сервер пульта,
   opt.want/opt.http) — открывается по QR сразу, но установить приложение и работать без сети на нём нельзя.
   Вход телефонов, люди, устройства, песни для телефона — teamapi.js (/api/v1/…), окно «Группа» видит их в info().grp.
   Связь в реальном времени — WebSocket /ws (upgrade → teamapi.js), на обоих серверах: https здесь и http пульта в main.js.
   Модуль работает и без Electron: init() — для проверки в Node, setup() — из main.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');
const api = require('./teamapi');

const DEF = { on: false, port: 443, provider: 'desec', domain: '', ip: '', email: '', staging: false };
const RENEW_DAYS = 30;
const DAY = 86400e3;

let dir = '';      // папка данных (%APPDATA%\church-presenter)
let appDir = '';   // папка приложения для телефона (app/)
let opt = {};      // { ips(), handler(req, res), seal(str), unseal(str), notify(info), want(), http(), libFile, ver, cmd(c) }
let cfg = { ...DEF };
let token = '';    // токен провайдера, расшифрованный, только в памяти
let dnsSt = { ip: '', at: 0, err: '' }; // что программа записала в DNS
let cert = null;   // { key, pem, domain, until, staging }
let srv = null;
let srvPort = 0;
let srvErr = '';
let job = null;    // что делается сейчас: { kind, log: [], at }
let last = null;   // чем закончилось прошлое: { kind, ok, err, log, at }
let timers = [];

const teamFile = () => path.join(dir, 'team.json');
const tlsDir = () => path.join(dir, 'tls');

/* ----- Файл team.json: читаем целиком, пишем свой раздел (остальные разделы — другие этапы) ----- */

function readFile() {
  try { const j = JSON.parse(fs.readFileSync(teamFile(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function writeFile(patch) {
  const all = { ...readFile(), v: 1, ...patch };
  const tmp = teamFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 1));
  fs.renameSync(tmp, teamFile());
}
function load() {
  const j = readFile();
  const n = j.net || {};
  cfg = { ...DEF };
  for (const k of Object.keys(DEF)) if (n[k] !== undefined && typeof n[k] === typeof DEF[k]) cfg[k] = n[k];
  token = '';
  try { token = n.token ? String(opt.unseal(n.token) || '') : ''; } catch { token = ''; }
  dnsSt = { ip: String((j.dns && j.dns.ip) || ''), at: Number((j.dns && j.dns.at) || 0), err: '' };
}
function save() {
  writeFile({ net: { ...cfg, token: token ? opt.seal(token) : '' }, dns: { ip: dnsSt.ip, at: dnsSt.at } });
}

/* ----- Адрес компьютера в сети ----- */

const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
function curIp() {
  const ips = opt.ips();
  if (cfg.ip && ips.includes(cfg.ip)) return cfg.ip;
  return ips.find(isPrivate) || ips[0] || '';
}

/* ----- DNS-провайдеры. Новый провайдер (свой домен у другого хостинга DNS) — ещё одна запись тут ----- */

async function http(method, url, { headers = {}, body, tries = 3 } = {}) {
  for (let i = 0; ; i++) {
    let r;
    try {
      r = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      if (i + 1 < tries) { await sleep(3000); continue; }
      throw new Error('Нет связи с ' + new URL(url).host + ' — есть ли интернет? (' + (e.cause && e.cause.code || e.message) + ')');
    }
    const text = await r.text();
    // deSEC ограничивает частоту запросов: 429 + Retry-After — подождать и повторить
    if (r.status === 429 && i + 1 < tries) { await sleep(Math.min(60, Number(r.headers.get('retry-after')) || 5) * 1000); continue; }
    return { status: r.status, text };
  }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

const PROVIDERS = {
  desec: {
    name: 'deSEC (dedyn.io или свой домен)',
    api: 'https://desec.io/api/v1',
    async call(method, p, body) {
      const r = await http(method, this.api + p, { headers: { Authorization: 'Token ' + token }, body });
      if (r.status === 401 || r.status === 403) throw new Error('deSEC не принял токен — проверьте его (Token management на desec.io)');
      if (r.status >= 300) {
        let msg = r.text.slice(0, 300);
        try { const j = JSON.parse(r.text); msg = JSON.stringify(j.detail || j.non_field_errors || j); } catch { /* текст как есть */ }
        throw new Error(`deSEC ответил ${r.status}: ${msg}`);
      }
      try { return r.text ? JSON.parse(r.text) : null; } catch { return null; }
    },
    // Какая зона владеет именем: church.dedyn.io → зона church.dedyn.io; church.example.org → зона example.org, sub church
    async zone(host) {
      const list = await this.call('GET', '/domains/?owns_qname=' + encodeURIComponent(host));
      const z = Array.isArray(list) && list[0];
      if (!z || !z.name) throw new Error(`В аккаунте deSEC нет домена «${host}» (или токен от другого аккаунта)`);
      return { zone: z.name, sub: host === z.name ? '' : host.slice(0, -(z.name.length + 1)), ttl: Math.max(60, Number(z.minimum_ttl) || 3600) };
    },
    async put(host, prefix, type, records) {
      const z = await this.zone(host);
      const subname = [prefix, z.sub].filter(Boolean).join('.');
      // Пакетная правка: запись создаётся, если её нет; пустой records — удалить
      await this.call('PATCH', `/domains/${z.zone}/rrsets/`, [{ subname, type, ttl: z.ttl, records }]);
    },
    setA(host, ip) { return this.put(host, '', 'A', [ip]); },
    setTxt(host, v) { return this.put(host, '_acme-challenge', 'TXT', [`"${v}"`]); },
    clearTxt(host) { return this.put(host, '_acme-challenge', 'TXT', []); },
  },
  duckdns: {
    name: 'Duck DNS (duckdns.org)',
    api: 'https://www.duckdns.org/update',
    sub(host) {
      const m = /^(?:.+\.)?([a-z0-9-]+)\.duckdns\.org$/.exec(host);
      if (!m) throw new Error('Для Duck DNS адрес должен быть вида имя.duckdns.org');
      return m[1];
    },
    async go(host, q) {
      const r = await http('GET', `${this.api}?domains=${this.sub(host)}&token=${encodeURIComponent(token)}&${q}`);
      if (!/^OK/.test(r.text.trim())) throw new Error('Duck DNS ответил «' + r.text.trim().slice(0, 40) + '»: неверный токен или имя поддомена');
    },
    setA(host, ip) { return this.go(host, 'ip=' + ip); },
    setTxt(host, v) { return this.go(host, 'txt=' + encodeURIComponent(v)); },
    // clear=true вместе с txt очищает только TXT (A-запись остаётся)
    clearTxt(host) { return this.go(host, 'txt=&clear=true'); },
  },
};
const prov = () => PROVIDERS[cfg.provider] || null;

/* ----- Работа (сертификат, DNS, проверка): одна за раз, ход виден в окне «Группа» ----- */

function runJob(kind, fn) {
  if (job) return Promise.reject(new Error('Уже идёт: ' + jobName(job.kind)));
  job = { kind, log: [], at: Date.now() };
  const say = (t) => { job.log.push(t); notify(); };
  notify();
  return fn(say).then((res) => {
    last = { kind, ok: true, log: job.log, at: Date.now(), res };
    job = null; notify();
    return res;
  }, (e) => {
    const err = String((e && e.message) || e);
    job.log.push('Ошибка: ' + err);
    last = { kind, ok: false, err, log: job.log, at: Date.now() };
    job = null; notify();
    throw new Error(err);
  });
}
const jobName = (k) => ({ cert: 'получение сертификата', dns: 'запись адреса в DNS', check: 'проверка адреса' })[k] || k;

function need() {
  if (!cfg.domain) throw new Error('Не указан адрес (домен)');
  if (!prov()) throw new Error('Не выбран DNS-провайдер');
  if (!token) throw new Error('Не сохранён токен провайдера');
}

/* ----- A-запись: домен → локальный IP ----- */

let dnsBusy = false;
let dnsNext = 0; // после ошибки — не чаще раза в 5 минут
async function syncDns(force) {
  if (!cfg.on || !cfg.domain || !token || !prov() || dnsBusy) return;
  const ip = curIp();
  if (!ip || (!force && ip === dnsSt.ip && !dnsSt.err)) return;
  if (!force && Date.now() < dnsNext) return;
  dnsBusy = true;
  try {
    await prov().setA(cfg.domain, ip);
    dnsSt = { ip, at: Date.now(), err: '' };
    save();
  } catch (e) {
    dnsSt = { ...dnsSt, err: String(e.message || e) };
    dnsNext = Date.now() + 5 * 60e3;
  }
  dnsBusy = false;
  notify();
}
const dnsNow = () => runJob('dns', async (say) => {
  need();
  const ip = curIp();
  if (!ip) throw new Error('Компьютер не подключён к сети');
  say(`Записываю ${cfg.domain} → ${ip}…`);
  dnsBusy = true;
  try { await prov().setA(cfg.domain, ip); } finally { dnsBusy = false; }
  dnsSt = { ip, at: Date.now(), err: '' };
  save();
  say('Готово. Телефоны увидят новый адрес в течение ' + (cfg.provider === 'desec' ? 'часа (deSEC хранит запись до часа)' : 'минуты'));
  return { ip };
});

/* ----- Серверы имён провайдера: ждём, пока TXT-запись появится на всех ----- */

async function authServers(name) {
  // Поднимаемся по имени, пока не найдём NS зоны: _acme-challenge.church.dedyn.io → church.dedyn.io
  const parts = name.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const zone = parts.slice(i).join('.');
    let ns = [];
    try { ns = await dns.promises.resolveNs(zone); } catch { continue; }
    if (!ns.length) continue;
    const ips = [];
    for (const h of ns) { try { ips.push(...(await dns.promises.resolve4(h))); } catch { /* этот NS без IPv4 */ } }
    if (ips.length) return ips;
  }
  return [];
}
async function txtOn(server, name) {
  const r = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
  r.setServers([server]);
  try { return [].concat(...(await r.resolveTxt(name))); } catch { return []; }
}
async function waitTxt(name, value, say) {
  const servers = await authServers(name);
  if (!servers.length) { say('Не нашёл серверы имён — жду 60 с'); await sleep(60000); return; }
  const until = Date.now() + 5 * 60e3;
  for (let n = 0; Date.now() < until; n++) {
    const got = await Promise.all(servers.map((s) => txtOn(s, name)));
    const ok = got.filter((g) => g.includes(value)).length;
    if (ok === servers.length) { say(`Запись видна на всех серверах имён (${ok})`); await sleep(5000); return; }
    if (n % 3 === 0) say(`Жду, пока запись разойдётся по серверам имён: ${ok} из ${servers.length}…`);
    await sleep(10000);
  }
  say('Запись не появилась везде за 5 минут — всё равно пробую');
}

/* ----- Сертификат Let's Encrypt ----- */

function loadCert() {
  cert = null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(tlsDir(), 'cert.json'), 'utf8'));
    const pem = fs.readFileSync(path.join(tlsDir(), 'cert.pem'), 'utf8');
    const key = fs.readFileSync(path.join(tlsDir(), 'cert.key'), 'utf8');
    const x = new crypto.X509Certificate(pem);
    cert = { key, pem, domain: String(meta.domain || ''), staging: !!meta.staging, until: new Date(x.validTo).getTime(), at: Number(meta.at) || 0 };
  } catch { cert = null; }
}
// Сертификат подходит к нынешним настройкам (тот же адрес, тот же вид — настоящий или тестовый) и ещё действует
const certOk = () => !!(cert && cert.domain === cfg.domain && cert.staging === cfg.staging && cert.until > Date.now());

// o.staging — какой получить (настоящий после тестового): галочка «Тестовый» меняется только после успеха,
// а до того работает прежний сертификат — телефоны не остаются без связи
const issue = (o) => runJob('cert', async (say) => {
  need();
  const staging = o && typeof o.staging === 'boolean' ? o.staging : cfg.staging;
  const acme = require('acme-client'); // нужен только здесь — не грузим при каждом запуске
  fs.mkdirSync(tlsDir(), { recursive: true });
  const accFile = path.join(tlsDir(), staging ? 'account-staging.key' : 'account.key');
  let accountKey;
  try { accountKey = fs.readFileSync(accFile); } catch {
    accountKey = await acme.crypto.createPrivateKey();
    fs.writeFileSync(accFile, accountKey);
  }
  const client = new acme.Client({ directoryUrl: staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production, accountKey });
  say(`Заказываю ${staging ? 'тестовый' : 'настоящий'} сертификат для ${cfg.domain}…`);
  const [key, csr] = await acme.crypto.createCsr({ commonName: cfg.domain });
  const host = cfg.domain;
  const p = prov();
  const pem = await client.auto({
    csr,
    email: cfg.email || undefined,
    termsOfServiceAgreed: true, // владелец нажал кнопку под текстом об условиях Let's Encrypt
    challengePriority: ['dns-01'],
    skipChallengeVerification: true, // проверяем сами — по серверам имён провайдера (waitTxt)
    challengeCreateFn: async (authz, ch, value) => {
      if (ch.type !== 'dns-01') throw new Error('Let\'s Encrypt не предложил проверку через DNS');
      say('Ставлю TXT-запись _acme-challenge…');
      await p.setTxt(host, value);
      await waitTxt('_acme-challenge.' + authz.identifier.value, value, say);
      say('Let\'s Encrypt проверяет запись…');
    },
    challengeRemoveFn: async () => { try { await p.clearTxt(host); } catch { /* не страшно */ } },
  });
  // Сначала во временные файлы — сбой посередине не испортит рабочий сертификат
  const put = (n, data) => { fs.writeFileSync(path.join(tlsDir(), n + '.tmp'), data); };
  put('cert.pem', pem);
  put('cert.key', key);
  put('cert.json', JSON.stringify({ domain: host, staging, at: Date.now() }));
  for (const n of ['cert.pem', 'cert.key', 'cert.json']) fs.renameSync(path.join(tlsDir(), n + '.tmp'), path.join(tlsDir(), n));
  loadCert();
  if (cfg.staging !== staging) { cfg.staging = staging; save(); }
  say((staging ? 'Тестовый сертификат получен (замка на телефоне не будет)' : 'Сертификат получен — на телефоне будет замок') + ', действует до ' + new Date(cert.until).toLocaleDateString('ru-RU'));
  restart();
  return { until: cert.until };
});

async function renewTick() {
  if (!cfg.on || !cert || job || cert.domain !== cfg.domain || cert.staging !== cfg.staging) return;
  if (cert.until - Date.now() > RENEW_DAYS * DAY) return;
  try { await issue(); } catch { /* ошибка видна в окне «Группа» (last), попробуем через 6 ч */ }
}

/* ----- HTTPS-сервер на постоянном порту (порт не перебираем: у телефона данные хранятся «на адрес с портом») ----- */

function start() {
  if (srv || !cfg.on || !certOk()) return;
  srvErr = '';
  const s = https.createServer({ key: cert.key, cert: cert.pem }, (req, res) => opt.handler(req, res));
  srv = s;
  s.on('error', (e) => {
    srvErr = e && e.code === 'EADDRINUSE' ? `Порт ${cfg.port} занят другой программой` : e && e.code === 'EACCES' ? `Нет прав на порт ${cfg.port}` : String((e && e.message) || e);
    if (srv === s) { srv = null; srvPort = 0; }
    notify();
  });
  s.on('listening', () => { srvPort = cfg.port; notify(); });
  s.on('upgrade', (req, sock, head) => { if (!upgrade(req, sock, head)) sock.destroy(); });
  s.listen(cfg.port, '0.0.0.0');
}
function stop() {
  if (srv) { try { srv.close(); } catch { /* уже закрыт */ } }
  srv = null;
  srvPort = 0;
}
function restart() {
  // Тот же порт и сервер работает — только новый сертификат
  if (srv && srvPort === cfg.port && cfg.on && certOk()) { srv.setSecureContext({ key: cert.key, cert: cert.pem }); notify(); return; }
  stop();
  start();
  notify();
}

/* ----- Проверка адреса: публичный DNS, DNS этого компьютера (обычно роутер), сам сервер ----- */

async function ask(servers, host) {
  const r = new dns.promises.Resolver({ timeout: 2500, tries: 2 });
  try { r.setServers(servers); } catch { return { ips: [], err: 'неверный DNS' }; }
  try { return { ips: await r.resolve4(host), err: '' }; } catch (e) { return { ips: [], err: e.code || e.message }; }
}
function ping(ip) {
  return new Promise((ok) => {
    const req = https.get({ host: ip, port: cfg.port, path: '/app/ping', servername: cfg.domain, headers: { host: cfg.domain }, timeout: 4000, rejectUnauthorized: !cfg.staging }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { ok({ ok: JSON.parse(b).app === 'church-presenter' }); } catch { ok({ ok: false, err: 'чужой ответ' }); } });
    });
    req.on('timeout', () => req.destroy(new Error('нет ответа')));
    req.on('error', (e) => ok({ ok: false, err: e.code || e.message }));
  });
}
const check = () => runJob('check', async (say) => {
  if (!cfg.domain) throw new Error('Не указан адрес (домен)');
  const host = cfg.domain;
  const ip = curIp();
  const items = [];
  const add = (ok, text, tip) => { items.push({ ok, text, tip: tip || '' }); say((ok ? '✓ ' : '✗ ') + text); };
  if (!ip) throw new Error('Компьютер не подключён к сети');
  const pub = await ask(['1.1.1.1', '8.8.8.8'], host);
  const pubOk = pub.ips.includes(ip);
  if (pubOk) add(true, `Интернет (1.1.1.1): ${host} → ${ip}`);
  else if (pub.ips.length) add(false, `Интернет (1.1.1.1): ${host} → ${pub.ips.join(', ')}, а у компьютера ${ip}`, 'Нажмите «Записать адрес в DNS». У deSEC старый адрес может держаться до часа.');
  else add(false, `Интернет (1.1.1.1): ${host} не найден (${pub.err})`, 'Проверьте имя и токен, нажмите «Записать адрес в DNS».');
  const own = dns.getServers().filter((s) => net.isIPv4(s));
  if (own.length) {
    const loc = await ask(own, host);
    const locOk = loc.ips.includes(ip);
    if (locOk) add(true, `DNS этой сети (${own.join(', ')}): ${host} → ${ip}`);
    else if (pubOk) add(false, `DNS этой сети (${own.join(', ')}) не отдаёт локальный адрес (${loc.ips.join(', ') || loc.err})`,
      'Похоже, роутер блокирует ответы с адресами 192.168.x.x / 10.x.x.x (защита от DNS rebinding). Как обойти — ИНСТРУКЦИЯ-ГРУППА.md, раздел «Роутер не пускает».');
    else add(false, `DNS этой сети (${own.join(', ')}): ${loc.ips.join(', ') || loc.err}`);
  }
  if (!srvPort) add(false, 'Сервер HTTPS не работает' + (srvErr ? ': ' + srvErr : certOk() ? '' : ' — нет сертификата для этого адреса'));
  else {
    const p = await ping(ip);
    if (p.ok) add(true, `Сервер отвечает: https://${host}${cfg.port === 443 ? '' : ':' + cfg.port}/app/` + (cfg.staging ? ' (тестовый сертификат — телефоны ему не доверяют)' : ', сертификат в порядке'));
    else add(false, `Сервер не ответил по https (${p.err})`, 'Проверьте брандмауэр (кнопка в окне «Группа»).');
  }
  return { items, ok: items.every((x) => x.ok) };
});

/* ----- Приложение для телефона: /app/… (файлы из app/), данные: /api/v1/… (teamapi.js) ----- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
// Только свой адрес: домен из настроек или IP. Чужой сайт, подменивший свой адрес на 192.168.x.x (DNS rebinding),
// не дотянется до данных группы из браузера на компьютере в этой сети
function hostOk(req) {
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return (!!cfg.domain && h === cfg.domain) || net.isIPv4(h) || h === 'localhost';
}
// Отпечаток файлов приложения — версия кэша на телефоне (sw.js): файлы поменялись с обновлением программы —
// телефон сам скачает новые. По содержимому (в app.asar установленной программы время файлов не меняется); ~150 КБ
function appVer() {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { h.update(path.relative(appDir, f) + ':'); h.update(fs.readFileSync(f)); }
    }
  };
  try { walk(appDir); } catch { /* нет папки — всё равно ответим */ }
  try { h.update('chords.js:'); h.update(fs.readFileSync(path.join(appDir, '..', 'chords.js'))); } catch { /* нет файла */ }
  return h.digest('hex').slice(0, 12);
}
// connect-src: свой адрес и его WebSocket (старый Safari не считает ws:// «своим» по 'self')
const csp = (req) => {
  const h = String(req.headers.host || '').toLowerCase().replace(/[^a-z0-9.:[\]-]/g, '');
  return "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'" + (h ? ` ws://${h} wss://${h}` : '') +
    "; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
};
// WebSocket /ws: только свой адрес и страница с него же (Origin) — чужой сайт не подключится от имени телефона
function upgrade(req, sock, head) {
  let p = '';
  try { p = new URL(req.url, 'http://x').pathname; } catch { return false; }
  if (p !== '/ws') return false;
  sock.on('error', () => { /* оборвалось */ });
  let oh = '';
  try { oh = new URL(String(req.headers.origin || '')).host.toLowerCase(); } catch { /* нет Origin */ }
  if (!hostOk(req) || oh !== String(req.headers.host || '').toLowerCase()) { sock.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return true; }
  api.upgrade(req, sock, head);
  return true;
}
function route(req, res, u) {
  if (u.pathname.startsWith('/api/v1/')) {
    if (!hostOk(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"error":"host"}'); return true; }
    api.handle(req, res, u);
    return true;
  }
  if (u.pathname === '/app') { res.writeHead(301, { Location: '/app/' }); res.end(); return true; }
  if (!u.pathname.startsWith('/app/')) return false;
  if (u.pathname === '/app/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ app: 'church-presenter', name: 'multiplayerSHOW', team: 1, https: !!req.socket.encrypted }));
    return true;
  }
  let rel = '';
  try { rel = decodeURIComponent(u.pathname.slice(5)) || 'index.html'; } catch { rel = ''; }
  // Значки 256 и 512 — из brand/ (тот же значок, что у программы); аккорды — общий chords.js программы
  const icon = /^icon-(256|512)\.png$/.exec(rel);
  const shared = icon || rel === 'chords.js';
  const file = icon ? path.join(appDir, '..', 'brand', `icon-${icon[1]}.png`) : rel === 'chords.js' ? path.join(appDir, '..', 'chords.js') : path.normalize(path.join(appDir, rel));
  if (!rel || rel.includes('\0') || (!shared && !file.startsWith(appDir + path.sep))) { res.writeHead(404); res.end(); return true; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('нет такой страницы'); return; }
    if (rel === 'sw.js') buf = Buffer.from(buf.toString('utf8').replace('__VER__', appVer()));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache',
      'Content-Security-Policy': csp(req), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(buf);
  });
  return true;
}

/* ----- Что видит окно оператора ----- */

function info() {
  const url = cfg.domain ? `https://${cfg.domain}${cfg.port === 443 ? '' : ':' + cfg.port}/app/` : '';
  // Простой адрес по Wi-Fi (http-сервер пульта в main.js): без аккаунта и сертификата, но без установки и офлайна
  const h = opt.http ? opt.http() : { running: false, port: 0, err: '' };
  const ip = curIp();
  return {
    cfg: { ...cfg }, hasToken: !!token, ip, ips: opt.ips ? opt.ips() : [],
    http: h, plainUrl: cfg.on && h.running && ip ? `http://${ip}:${h.port}/app/` : '',
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name })),
    dns: { ...dnsSt },
    cert: cert ? { domain: cert.domain, staging: cert.staging, until: cert.until, ok: certOk(), days: Math.floor((cert.until - Date.now()) / DAY) } : null,
    srv: { running: !!srvPort, port: srvPort, err: srvErr },
    job: job ? { kind: job.kind, log: job.log.slice(-12) } : null,
    last: last ? { kind: last.kind, ok: last.ok, err: last.err || '', log: last.log.slice(-12), at: last.at, res: last.res } : null,
    url: certOk() ? url : '',
    grp: api.state(),
  };
}
let notifyT = 0;
function notify() {
  clearTimeout(notifyT);
  notifyT = setTimeout(() => { if (opt.notify) opt.notify(info()); }, 50);
}

// Правка настроек из окна «Группа»
const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
function set(p) {
  const was = { ...cfg };
  if (!p || typeof p !== 'object') return info();
  if (typeof p.on === 'boolean') cfg.on = p.on;
  if (typeof p.staging === 'boolean') cfg.staging = p.staging;
  if (typeof p.provider === 'string' && PROVIDERS[p.provider]) cfg.provider = p.provider;
  if (typeof p.domain === 'string') {
    const d = p.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').replace(/\.$/, '');
    if (d && !HOST_RE.test(d)) throw new Error('Адрес должен быть вида имя.dedyn.io или имя.duckdns.org');
    cfg.domain = d;
  }
  if (p.port !== undefined) {
    const n = Math.round(Number(p.port));
    if (!(n >= 1 && n <= 65535)) throw new Error('Порт — число от 1 до 65535');
    cfg.port = n;
  }
  if (typeof p.email === 'string') {
    const e = p.email.trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Почта указана с ошибкой');
    cfg.email = e;
  }
  if (typeof p.ip === 'string') cfg.ip = p.ip;
  // Другой адрес или провайдер — прежняя запись в DNS уже не наша
  if (cfg.domain !== was.domain || cfg.provider !== was.provider) dnsSt = { ip: '', at: 0, err: '' };
  save();
  if (was.on && !cfg.on) api.closeAll(); // телефоны на связи — «Доступ выключен»
  if (cfg.on !== was.on && opt.want) opt.want(); // простой адрес (http) — включить или выключить вместе с доступом
  if (cfg.on !== was.on || cfg.port !== was.port || cfg.domain !== was.domain || cfg.staging !== was.staging) restart();
  if (cfg.on && (cfg.ip !== was.ip || !dnsSt.ip)) syncDns(false);
  return info();
}
function setToken(t) {
  token = String(t || '').trim();
  dnsSt = { ...dnsSt, err: '' };
  save();
  if (cfg.on) syncDns(true);
  return info();
}

/* ----- Запуск ----- */

function init(o) {
  opt = o;
  dir = o.dir;
  appDir = path.resolve(o.appDir);
  fs.mkdirSync(dir, { recursive: true });
  load();
  loadCert();
  api.init({ dir, libFile: o.libFile || path.join(dir, 'library.json'), ver: o.ver || '', on: () => cfg.on, notify, cmd: o.cmd,
    store: { read: readFile, write: writeFile } });
  start();
  if (opt.want) opt.want();
  const t = (fn, ms) => { const h = setInterval(fn, ms); if (h.unref) h.unref(); timers.push(h); };
  t(() => syncDns(false), 60e3);       // IP поменялся — новая A-запись
  t(renewTick, 6 * 3600e3);            // продление сертификата
  const first = setTimeout(() => { syncDns(false); renewTick(); }, 15e3);
  if (first.unref) first.unref();
  timers.push(first);
}
function shutdown() {
  for (const h of timers) clearInterval(h);
  timers = [];
  api.shutdown();
  stop();
}

// Из main.js: каналы окна оператора (preload.js: team*)
function setup(ipcMain, o) {
  init(o);
  const wrap = (fn) => async (...a) => { try { return { ok: true, info: await fn(...a) } } catch (e) { return { ok: false, error: String(e.message || e), info: info() }; } };
  ipcMain.handle('team:info', () => info());
  ipcMain.handle('team:set', wrap((_e, p) => set(p)));
  ipcMain.handle('team:token', wrap((_e, t) => setToken(t)));
  ipcMain.handle('team:cert', wrap(async (_e, o) => { await issue(o); return info(); }));
  ipcMain.handle('team:dns', wrap(async () => { await dnsNow(); return info(); }));
  ipcMain.handle('team:check', wrap(async () => { const r = await check(); return { ...info(), check: r }; }));
  // Люди и устройства: { act: 'approve'|'reject'|'off'|'revoke'|'person'|'delPerson'|'log'|'mode'|'password'|'unlock'|'msg'|'metro', … } (teamapi.js: act)
  ipcMain.handle('team:do', wrap(async (_e, a) => { const res = await api.act(a); return { ...info(), res }; }));
  // Что на экране — телефонам (team.js шлёт, когда поменялось)
  ipcMain.handle('team:live', (_e, l) => api.setLive(l));
}

module.exports = { setup, init, shutdown, route, upgrade, info, set, setToken, issue, check, dnsNow, port: () => cfg.port, on: () => cfg.on, changed: notify,
  libSaved: (data) => api.libSaved(data), PROVIDERS, _test: { authServers, waitTxt, curIp, api } };
