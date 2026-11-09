/* ---------- Окно «Группа»: приложение для телефонов музыкантов (ТЗ-8-Группа.md) ----------
   Кнопка «Группа» в верхней строке → #teamDialog. Сервер, адрес-домен и сертификат живут в главном процессе
   (teamsrv.js); окно только показывает их состояние (window.api.teamInfo / onTeamInfo) и шлёт правки.
   Раздел «Адрес и сертификат»: домен deSEC / Duck DNS, токен (хранится зашифрованным, сюда не возвращается),
   адрес компьютера, порт, «Записать адрес в DNS», «Проверить адрес», «Получить сертификат». */

let grInfo = null;
let grFwSt = null;   // брандмауэр: { rule, pub, team }

const grFmt = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const grDate = (t) => new Date(t).toLocaleDateString('ru-RU');
const grTokHelp = {
  desec: 'Токен: desec.io → войти → Token management → «＋». Нужен токен того аккаунта, где заведён адрес.',
  duckdns: 'Токен: duckdns.org → войти — строка «token» вверху страницы.',
};

function grSt(id, text, kind) {
  const el = $(id);
  el.textContent = text || '';
  el.className = 'tm-st' + (kind ? ' ' + kind : '');
}

function grPaint() {
  const dlg = $('teamDialog');
  if (!dlg.open || !grInfo) return;
  const n = grInfo;
  const c = n.cfg;
  const busy = !!n.job;
  const ae = document.activeElement;
  // Поля — только если человек сейчас не печатает в них
  const fill = (id, v) => { if (ae !== $(id)) $(id).value = v; };
  $('tmOn').checked = c.on;
  $('tmStaging').checked = c.staging;
  $('tmProv').replaceChildren(...n.providers.map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.name, selected: p.id === c.provider })));
  fill('tmDomain', c.domain);
  $('tmDomain').placeholder = c.provider === 'duckdns' ? 'moya-cerkov.duckdns.org' : 'moya-cerkov.dedyn.io';
  fill('tmPort', c.port);
  fill('tmEmail', c.email);
  $('tmToken').placeholder = n.hasToken ? 'сохранён — вставьте новый, чтобы заменить' : 'вставьте токен';
  $('tmTokHint').textContent = (n.hasToken ? 'Токен сохранён (зашифрован). ' : '') + (grTokHelp[c.provider] || '');
  const ips = $('tmIp');
  ips.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'Сам (' + (c.ip && n.ips.includes(c.ip) ? c.ip : n.ip || 'нет сети') + ')' }),
    ...n.ips.map((ip) => Object.assign(document.createElement('option'), { value: ip, textContent: ip })));
  ips.value = c.ip && n.ips.includes(c.ip) ? c.ip : '';

  // Сервер
  if (!c.on) grSt('tmSrv', 'Выключен. Телефоны группы не подключатся.', '');
  else if (n.srv.running) grSt('tmSrv', `Работает: ${n.url}`, 'ok');
  else if (n.srv.err) grSt('tmSrv', 'Не запустился: ' + n.srv.err, 'bad');
  else if (!n.cert || !n.cert.ok) grSt('tmSrv', 'Ждёт сертификат для адреса ' + (c.domain || '(не указан)') + ' — нажмите «Получить сертификат».', 'bad');
  else grSt('tmSrv', 'Запускается…', '');

  // Запись в DNS
  const d = n.dns;
  if (d.err) grSt('tmDnsSt', 'Не удалось записать адрес в DNS: ' + d.err, 'bad');
  else if (d.ip && d.ip === n.ip) grSt('tmDnsSt', `В DNS записано: ${c.domain} → ${d.ip} (${grFmt(d.at)})`, 'ok');
  else if (d.ip) grSt('tmDnsSt', `В DNS записан старый адрес ${d.ip}, у компьютера сейчас ${n.ip}` + (c.on ? ' — обновится сам в течение минуты.' : ' — нажмите «Записать адрес в DNS».'), 'bad');
  else grSt('tmDnsSt', c.domain && n.hasToken ? 'Адрес в DNS ещё не записан' + (c.on ? ' — запишется сам в течение минуты.' : '.') : '', '');

  // Сертификат
  const ct = n.cert;
  if (!ct) grSt('tmCertSt', 'Сертификата пока нет.', '');
  else if (ct.domain !== c.domain) grSt('tmCertSt', `Есть сертификат для другого адреса (${ct.domain}) — получите новый.`, 'bad');
  else if (ct.staging !== c.staging) grSt('tmCertSt', ct.staging ? 'Есть только тестовый сертификат — получите настоящий.' : 'Есть настоящий сертификат; для тестового — получите его отдельно.', 'bad');
  else if (!ct.ok) grSt('tmCertSt', `Сертификат истёк ${grDate(ct.until)} — получите новый.`, 'bad');
  else grSt('tmCertSt', `${ct.staging ? 'Тестовый сертификат' : 'Сертификат'} для ${ct.domain}, действует до ${grDate(ct.until)} (осталось ${ct.days} дн.)`, ct.days < 14 ? 'bad' : 'ok');

  for (const id of ['tmDnsNow', 'tmCheck', 'tmCert']) $(id).disabled = busy;
  $('tmCert').textContent = busy && n.job.kind === 'cert' ? 'Получаю…' : ct && ct.ok && ct.domain === c.domain && ct.staging === c.staging ? 'Получить заново' : 'Получить сертификат';

  // Брандмауэр: без правила для порта группы телефон видит «Не удаётся открыть страницу»
  const fwBad = c.on && grFwSt && !grFwSt.team;
  $('tmFw').hidden = !fwBad;
  if (fwBad) $('tmFwText').textContent = `Брандмауэр Windows не пускает телефоны на порт ${c.port}` + (grFwSt.pub ? ' (сеть Wi-Fi отмечена как общественная)' : '') + '. Нажмите кнопку и подтвердите в окне Windows.';

  // Ход работы или чем кончилась прошлая
  const log = $('tmLog');
  log.replaceChildren();
  const src = n.job || n.last;
  if (src) {
    log.append(document.createTextNode(src.log.join('\n')));
    const items = n.last && n.last.kind === 'check' && !n.job && n.last.res ? n.last.res.items : null;
    for (const it of items || []) if (!it.ok && it.tip) log.append(Object.assign(document.createElement('div'), { className: 'tip', textContent: '→ ' + it.tip }));
  }
}

function grOpen() {
  if (!$('teamDialog').open) $('teamDialog').showModal();
  window.api.teamInfo().then((n) => { grInfo = n; grPaint(); }).catch(() => {});
  window.api.remoteFw().then((f) => { grFwSt = f; grPaint(); }).catch(() => {});
}

// Ответ главного процесса: { ok, error?, info }
async function grCall(p, okText) {
  let r;
  try { r = await p; } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  if (r && r.info) grInfo = r.info;
  grPaint();
  if (r && !r.ok) showNotice(r.error || 'Не получилось', true);
  else if (okText) flashStatus(okText);
  return r;
}
const grSet = (p) => grCall(window.api.teamSet(p));

window.api.onTeamInfo((n) => { grInfo = n; grPaint(); });

$('teamOpen').addEventListener('click', grOpen);
$('tmOn').addEventListener('change', (e) => grSet({ on: e.target.checked }).then(() => window.api.remoteFw().then((f) => { grFwSt = f; grPaint(); }).catch(() => {})));
$('tmStaging').addEventListener('change', (e) => grSet({ staging: e.target.checked }));
$('tmProv').addEventListener('change', (e) => grSet({ provider: e.target.value }));
$('tmIp').addEventListener('change', (e) => grSet({ ip: e.target.value }));
$('tmDomain').addEventListener('change', (e) => grSet({ domain: e.target.value }));
$('tmEmail').addEventListener('change', (e) => grSet({ email: e.target.value }));
$('tmPort').addEventListener('change', async (e) => {
  const was = grInfo && grInfo.cfg.port;
  const r = await grSet({ port: e.target.value });
  if (r && r.ok && was !== r.info.cfg.port) window.api.remoteFw().then((f) => { grFwSt = f; grPaint(); }).catch(() => {});
});
$('tmTokenSave').addEventListener('click', async () => {
  const t = $('tmToken').value.trim();
  if (!t) { flashStatus('Вставьте токен в поле'); return; }
  const r = await grCall(window.api.teamToken(t), 'Токен сохранён');
  if (r && r.ok) $('tmToken').value = '';
});
$('tmToken').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('tmTokenSave').click(); });
$('tmDnsNow').addEventListener('click', () => grCall(window.api.teamDns(), 'Адрес записан в DNS'));
$('tmCheck').addEventListener('click', async () => {
  const r = await grCall(window.api.teamCheck());
  if (r && r.ok) flashStatus(r.info.check.ok ? 'Адрес в порядке' : 'Проверка: есть замечания — см. окно «Группа»');
});
$('tmCert').addEventListener('click', () => grCall(window.api.teamCert(), 'Сертификат получен'));
$('tmFwFix').addEventListener('click', async () => {
  $('tmFwFix').disabled = true;
  try { const f = await window.api.remoteFwFix(); if (f) grFwSt = f; } catch { /* отказались в окне Windows */ }
  $('tmFwFix').disabled = false;
  flashStatus(grFwSt && grFwSt.team ? 'Брандмауэр: телефоны группы пропускаются' : 'Брандмауэр не изменён');
  grPaint();
});
