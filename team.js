/* ---------- Окно «Группа»: приложение для телефонов музыкантов (ТЗ-8-Группа.md) ----------
   Кнопка «Группа» в верхней строке → #teamDialog. Сервер, адрес-домен и сертификат живут в главном процессе
   (teamsrv.js); окно только показывает их состояние (window.api.teamInfo / onTeamInfo) и шлёт правки.
   Раздел «Подключить телефон»: QR-код. Простой адрес http://<IP>:8090/app/ работает без аккаунта (но без установки
   и офлайна); защищённый https://<домен>/app/ — когда настроен адрес и сертификат. Какой в коде — cp.teamQr.
   Раздел «Адрес и сертификат»: домен deSEC / Duck DNS, токен (хранится зашифрованным, сюда не возвращается),
   адрес компьютера, порт, «Записать адрес в DNS», «Проверить адрес», «Получить сертификат».
   Раздел «Люди и устройства» (teamapi.js, данные — grInfo.grp): ожидают подтверждения («Пустить» / «Отклонить»,
   они же — под QR-кодом), люди с ролью, их телефоны: в сети, приостановить, отозвать. «Журнал» — team-log.jsonl.
   Новый запрос, пока окно закрыто, — число на кнопке «Группа» и строка состояния. */

let grInfo = null;
let grFwSt = null;   // брандмауэр: { rule — порты пульта (простой адрес), pub, team — порт https }
let grTab = 'qr';    // открытый раздел окна
let grMode = localStorage.getItem('cp.teamQr') === 'plain' ? 'plain' : 'safe'; // какой адрес в QR-коде

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

  grQrPaint();
  grGrpPaint();
  // Сервер
  if (!c.on) grSt('tmSrv', 'Выключен. Телефоны группы не подключатся.', '');
  else if (n.srv.running) grSt('tmSrv', `Защищённый адрес работает: ${n.url}`, 'ok');
  else if (n.srv.err) grSt('tmSrv', 'Защищённый адрес не запустился: ' + n.srv.err, 'bad');
  else if (!n.cert || !n.cert.ok) grSt('tmSrv', 'Защищённый адрес ждёт сертификат' + (c.domain ? ` для ${c.domain}` : '') + '. Пока телефоны подключаются по простому адресу (раздел «Подключить телефон»).', '');
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
  else if (ct.staging) grSt('tmCertSt', `Тестовый сертификат для ${ct.domain} — телефоны ему не доверяют, замка в адресной строке не будет. Нажмите «Получить настоящий сертификат».`, 'bad');
  else grSt('tmCertSt', `Сертификат для ${ct.domain}, действует до ${grDate(ct.until)} (осталось ${ct.days} дн.), продлевается сам`, ct.days < 14 ? 'bad' : 'ok');

  // Включён «Тестовый» — главная кнопка получает настоящий (галочка снимется после успеха)
  const getting = busy && n.job.kind === 'cert';
  for (const id of ['tmDnsNow', 'tmCheck', 'tmCert', 'tmCertReal', 'tmQrReal']) $(id).disabled = busy;
  $('tmCertReal').hidden = !c.staging;
  $('tmCertReal').textContent = getting ? 'Получаю…' : 'Получить настоящий сертификат';
  $('tmCert').classList.toggle('primary', !c.staging);
  $('tmCert').textContent = getting && !c.staging ? 'Получаю…' : c.staging ? 'Получить тестовый' : ct && ct.ok && ct.domain === c.domain && !ct.staging ? 'Получить заново' : 'Получить сертификат';

  // Брандмауэр: без правила для порта группы телефон видит «Не удаётся открыть страницу»
  const fwBad = c.on && n.cert && n.cert.ok && grFwSt && !grFwSt.team;
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

// Раздел «Подключить телефон»: QR-код с адресом приложения
function grQrPaint() {
  const n = grInfo;
  const c = n.cfg;
  const safe = n.srv.running ? n.url : '';
  const plain = n.plainUrl || '';
  let mode = grMode;
  if (mode === 'safe' && !safe) mode = 'plain';
  if (mode === 'plain' && !plain && safe) mode = 'safe';
  const url = c.on ? (mode === 'safe' ? safe : plain) : '';
  $('tmQrOn').checked = c.on;
  $('tmQrModeRow').hidden = !(safe && plain);
  $('tmQrMode').value = mode;
  const box = $('tmQr');
  box.replaceChildren();
  if (url) {
    const img = document.createElement('div');
    img.innerHTML = QR.svg(url, 7);
    box.append(img, Object.assign(document.createElement('div'), { className: 'rm-url', textContent: url }));
  } else {
    const why = !c.on ? 'Доступ выключен. Поставьте галочку «Включить доступ для группы».'
      : n.http.err ? 'Сервер не запустился: ' + n.http.err
      : !n.ip ? 'Компьютер не подключён к сети (Wi-Fi или кабель).' : 'Сервер запускается…';
    box.append(Object.assign(document.createElement('div'), { className: 'tm-qr-empty', textContent: why }));
  }
  $('tmQrCopy').disabled = !url;
  if (!url) grSt('tmQrSt', '', '');
  else if (mode === 'safe' && n.cert && n.cert.staging) grSt('tmQrSt', 'Сертификат пока тестовый: телефон покажет предупреждение, замка не будет, установить приложение нельзя. Нажмите «Получить настоящий сертификат» — 1–5 минут.', 'bad');
  else if (mode === 'safe') grSt('tmQrSt', 'Защищённый адрес: замок в адресной строке, приложение можно установить на экран «Домой» и открывать без сети.', 'ok');
  else grSt('tmQrSt', 'Простой адрес: открывается сразу, без аккаунта. Установить приложение и пользоваться им без сети на нём нельзя' + (safe ? '.' : ' — для этого настройте раздел «Адрес и сертификат».'), '');
  $('tmQrRealRow').hidden = !(c.on && n.cert && n.cert.staging && n.cert.domain === c.domain);
  $('tmQrReal').textContent = n.job && n.job.kind === 'cert' ? 'Получаю… (1–5 минут)' : 'Получить настоящий сертификат';
  // Брандмауэр — для того порта, что в коде
  const fwBad = !!url && grFwSt && !(mode === 'safe' ? grFwSt.team : grFwSt.rule);
  $('tmQrFw').hidden = !fwBad;
  if (fwBad) $('tmQrFwText').textContent = 'Брандмауэр Windows не пускает телефоны к программе' + (grFwSt.pub ? ' (сеть Wi-Fi отмечена как общественная)' : '') + '. Нажмите кнопку и подтвердите в окне Windows.';
}

/* ----- Люди и устройства ----- */

const grRole = (id) => ((grInfo && grInfo.grp.roles.find((r) => r.id === id)) || { name: id || '' }).name;
const grEl = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
function grBtn(text, fn, primary) {
  const b = grEl('button', primary ? 'primary' : '', text);
  b.addEventListener('click', fn);
  return b;
}
const grDo = (a, okText) => grCall(window.api.teamDo(a), okText);

// Ожидают подтверждения — в разделе «Подключить телефон» (рядом с QR-кодом) и в «Люди и устройства»
function grPendList(list) {
  if (!list.length) return [];
  const out = [grEl('h3', '', `Ожидают подтверждения (${list.length})`)];
  for (const r of list) {
    const row = grEl('div', 'tm-req');
    const who = grEl('span', 'who');
    who.append(grEl('b', '', r.name), document.createTextNode(' · ' + grRole(r.role)), grEl('span', 'tm-sub', `${r.dev} · ${r.ip} · ${grFmt(r.at)}`));
    const acts = grEl('span', 'acts');
    acts.append(grBtn('Пустить', () => grDo({ act: 'approve', id: r.id }, `«${r.name}» — доступ открыт`), true),
      grBtn('Отклонить', () => grDo({ act: 'reject', id: r.id }, 'Запрос отклонён')));
    row.append(who, acts);
    out.push(row);
  }
  return out;
}

function grGrpPaint() {
  const g = grInfo.grp;
  $('tmQrPend').replaceChildren(...grPendList(g.pending));
  $('tmDevPend').replaceChildren(...grPendList(g.pending));
  $('tmDevCnt').textContent = g.pending.length ? String(g.pending.length) : '';
  const devs = g.people.reduce((n, p) => n + p.devices.length, 0);
  grSt('tmQrOnline', devs ? `В сети: ${g.online} из ${devs} (раздел «Люди и устройства»)` : '', g.online ? 'ok' : '');

  const box = $('tmPeople');
  if (!g.people.length) {
    box.replaceChildren(grEl('p', 'hint', 'Пока никого. Покажите QR-код из раздела «Подключить телефон» — телефон попросит доступ, и он появится здесь.'));
    return;
  }
  // Человек выбирает роль в списке — не перерисовывать под рукой
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  box.replaceChildren(grEl('h3', '', `Люди (${g.people.length}), в сети: ${g.online}`), ...g.people.map((p) => {
    const card = grEl('div', 'tm-person');
    const head = grEl('div', 'tm-p-head');
    const role = grEl('select');
    role.setAttribute('aria-label', 'Роль: ' + p.name);
    role.append(...g.roles.map((r) => Object.assign(grEl('option', '', r.name), { value: r.id, selected: r.id === p.role })));
    role.addEventListener('change', () => grDo({ act: 'person', id: p.id, role: role.value }, 'Роль изменена'));
    head.append(grEl('b', '', p.name), role, grEl('span', 'spacer'),
      grBtn('Переименовать', async () => {
        const n = await askName('Имя', p.name);
        if (n && n !== p.name) grDo({ act: 'person', id: p.id, name: n }, 'Имя изменено');
      }),
      grBtn('Удалить', async () => {
        if (await askYes(`Удалить «${p.name}»? Все телефоны этого человека потеряют доступ. Попросить доступ снова можно по QR-коду.`, 'Удалить', true)) grDo({ act: 'delPerson', id: p.id }, `«${p.name}» больше не в группе`);
      }));
    card.append(head);
    if (!p.devices.length) card.append(grEl('div', 'tm-dev', 'Нет телефонов'));
    for (const d of p.devices) {
      const row = grEl('div', 'tm-dev');
      const who = grEl('span', 'who');
      const st = d.off ? 'доступ приостановлен' : d.online ? 'в сети' : d.seen ? 'последний раз: ' + grFmt(d.seen) : 'подключений ещё не было';
      const sub = [d.synced ? 'песни получены ' + grFmt(d.synced) : 'песни ещё не получены', d.ip].filter(Boolean).join(' · ');
      who.append(grEl('i', 'tm-dot' + (d.off ? ' off' : d.online ? ' on' : '')), grEl('b', '', d.name), document.createTextNode(' — ' + st), grEl('span', 'tm-sub', sub));
      const acts = grEl('span', 'acts');
      acts.append(d.off ? grBtn('Включить', () => grDo({ act: 'off', id: d.id, off: false }, 'Доступ снова открыт'))
          : grBtn('Приостановить', () => grDo({ act: 'off', id: d.id, off: true }, 'Доступ приостановлен — «Включить», чтобы вернуть')),
        grBtn('Отозвать', () => grDo({ act: 'revoke', id: d.id }, 'Доступ отозван — телефон может попросить его снова по QR-коду')));
      row.append(who, acts);
      row.title = d.at ? 'Пустили ' + grFmt(d.at) : '';
      card.append(row);
    }
    return card;
  }));
}

// Число ожидающих — на кнопке «Группа»; новый запрос при закрытом окне — строка состояния
let grPendSeen = new Set();
function grBadge() {
  const list = grInfo && grInfo.grp ? grInfo.grp.pending : [];
  const b = $('teamOpen');
  if (list.length) b.dataset.n = String(list.length); else delete b.dataset.n;
  const fresh = list.filter((r) => !grPendSeen.has(r.id));
  grPendSeen = new Set(list.map((r) => r.id));
  if (fresh.length && !$('teamDialog').open) flashStatus(`«${fresh[0].name}» просит доступ к приложению группы — окно «Группа»`);
}

// Журнал: читаем, когда раздел открыт (и после перемен, не чаще раза в секунду)
const GR_EV = {
  join: (x) => `${x.name} (${grRole(x.role)}) просит доступ — ${x.dev}, ${x.ip}`,
  approve: (x) => `Пустили: ${x.name} — ${x.dev}`,
  admit: (x) => `${x.name}: телефон получил ключ — ${x.dev}, ${x.ip}`,
  reject: (x) => `Отклонили: ${x.name} — ${x.dev}`,
  off: (x) => `Приостановили: ${x.name} — ${x.dev}`,
  on: (x) => `Снова открыли доступ: ${x.name} — ${x.dev}`,
  revoke: (x) => `Отозвали доступ: ${x.name} — ${x.dev}`,
  delPerson: (x) => `Удалили из группы: ${x.name}`,
  bad: (x) => `Попытка войти с чужим или отозванным ключом — ${x.ip}`,
};
let grLogT = 0;
function grJournal() {
  clearTimeout(grLogT);
  grLogT = setTimeout(async () => {
    if (grTab !== 'log' || !$('teamDialog').open) return;
    const r = await window.api.teamDo({ act: 'log' }).catch(() => null);
    const list = (r && r.ok && r.info.res) || [];
    const box = $('tmJournal');
    if (!list.length) { box.replaceChildren(grEl('div', '', 'Пока пусто')); return; }
    box.replaceChildren(...list.map((x) => {
      const row = grEl('div', 'ev');
      row.append(grEl('time', '', grFmt(x.at)), grEl('span', '', (GR_EV[x.ev] || ((y) => y.ev))(x)));
      return row;
    }));
  }, 300);
}

function grShowTab(tab) {
  grTab = tab;
  document.querySelectorAll('.tm-nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tm === tab)));
  document.querySelectorAll('.tm-sec').forEach((s) => { s.hidden = s.dataset.tm !== tab; });
  if (tab === 'log') grJournal();
}

function grOpen() {
  grShowTab(grTab);
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

window.api.onTeamInfo((n) => { grInfo = n; grBadge(); grPaint(); if (grTab === 'log') grJournal(); });
window.api.teamInfo().then((n) => { grInfo = n; grBadge(); }).catch(() => {});

$('teamOpen').addEventListener('click', grOpen);
document.querySelectorAll('.tm-nav button').forEach((b) => b.addEventListener('click', () => grShowTab(b.dataset.tm)));
const grOnChange = (e) => grSet({ on: e.target.checked }).then(() => window.api.remoteFw().then((f) => { grFwSt = f; grPaint(); }).catch(() => {}));
$('tmOn').addEventListener('change', grOnChange);
$('tmQrOn').addEventListener('change', grOnChange);
$('tmQrMode').addEventListener('change', (e) => {
  grMode = e.target.value === 'plain' ? 'plain' : 'safe';
  try { localStorage.setItem('cp.teamQr', grMode); } catch { /* не страшно */ }
  grPaint();
});
$('tmQrCopy').addEventListener('click', () => {
  const url = $('tmQr').querySelector('.rm-url');
  if (url) navigator.clipboard.writeText(url.textContent).then(() => flashStatus('Ссылка скопирована'), () => {});
});
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
// Тестовый → настоящий: прежний работает, пока не придёт новый; галочку «Тестовый» снимает сервер после успеха
const grReal = () => grCall(window.api.teamCert({ staging: false }), 'Настоящий сертификат получен — на телефоне будет замок');
$('tmCertReal').addEventListener('click', grReal);
$('tmQrReal').addEventListener('click', grReal);
// Одно правило брандмауэра на оба адреса (порты пульта и порт https) — main.js: remote:fwFix
async function grFwFix(e) {
  const b = e.currentTarget;
  b.disabled = true;
  try { const f = await window.api.remoteFwFix(); if (f) grFwSt = f; } catch { /* отказались в окне Windows */ }
  b.disabled = false;
  flashStatus(grFwSt && grFwSt.rule && grFwSt.team ? 'Брандмауэр: телефоны группы пропускаются' : 'Брандмауэр не изменён');
  grPaint();
}
$('tmFwFix').addEventListener('click', grFwFix);
$('tmQrFwFix').addEventListener('click', grFwFix);
