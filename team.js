/* ---------- Окно «Группа»: приложение для телефонов музыкантов (ТЗ-8-Группа.md) ----------
   Кнопка «Группа» в верхней строке → #teamDialog. Сервер, адрес-домен и сертификат живут в главном процессе
   (teamsrv.js); окно только показывает их состояние (window.api.teamInfo / onTeamInfo) и шлёт правки.
   Раздел «Подключить телефон»: QR-код. Простой адрес http://<IP>:8090/app/ работает без аккаунта (но без установки
   и офлайна); защищённый https://<домен>/app/ — когда настроен адрес и сертификат. Какой в коде — cp.teamQr.
   Раздел «Адрес и сертификат»: домен deSEC / Duck DNS, токен (хранится зашифрованным, сюда не возвращается),
   адрес компьютера, порт, «Записать адрес в DNS», «Проверить адрес», «Получить сертификат».
   Раздел «Люди и устройства» (teamapi.js, данные — grInfo.grp): ожидают подтверждения («Пустить» / «Отклонить»,
   они же — под QR-кодом), люди с ролью, их телефоны: в сети, приостановить, отозвать. «Журнал» — team-log.jsonl.
   Новый запрос, пока окно закрыто, — число на кнопке «Группа» и строка состояния.
   Этап 2: что на экране — телефонам (grLive → window.api.teamLive, раз в 0,4 с, если поменялось); команды с телефона
   человека с галочкой «Может листать» (onTeamCmd: next / prev / show / clear) — тем же путём, что клавиши и щелчок.
   Раздел «Сетлисты»: плейлист с пометкой «Для группы» (pl.team = { date }) и тональностью строк (entry.key) — правка lib,
   Ctrl+Z работает; телефоны получают их от teamapi.js. */

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
    // Право листать слайды с телефона (Дальше / Назад / показать слайд / убрать текст) — у человека, не у роли
    const ctl = grEl('label', 'check');
    const cb = Object.assign(grEl('input'), { type: 'checkbox', checked: !!p.ctl });
    cb.addEventListener('change', () => grDo({ act: 'person', id: p.id, ctl: cb.checked }, cb.checked ? `«${p.name}» может листать слайды с телефона` : 'Листать с телефона больше нельзя'));
    ctl.append(cb, document.createTextNode(' Может листать'));
    ctl.title = 'Дальше / Назад, показать слайд, убрать текст с экрана — с телефона';
    head.append(grEl('b', '', p.name), role, ctl, grEl('span', 'spacer'),
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
  ctlOn: (x) => `${x.name}: можно листать слайды с телефона`,
  ctlOff: (x) => `${x.name}: листать с телефона больше нельзя`,
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
  if (tab === 'sets') grSetsPaint();
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

/* ----- Сетлисты: плейлист «для группы», дата служения, тональность строки ----- */

const grToday = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
function grSetsPaint() {
  const box = $('tmSets');
  if (!$('teamDialog').open || grTab !== 'sets' || typeof lib === 'undefined' || !lib) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox') return; // печатают
  if (!lib.playlists.length) { box.replaceChildren(grEl('p', 'hint', 'Плейлистов пока нет — создайте плейлист в библиотеке.')); return; }
  // Сначала сетлисты (новые сверху), потом остальные плейлисты
  const list = [...lib.playlists].sort((a, b) => (!!b.team - !!a.team) || ((b.team && b.team.date) || '').localeCompare((a.team && a.team.date) || ''));
  box.replaceChildren(...list.map((pl) => {
    const card = grEl('div', 'tm-person tm-set' + (pl.team ? ' on' : ''));
    const head = grEl('div', 'tm-p-head');
    const lab = grEl('label', 'check');
    const cb = Object.assign(grEl('input'), { type: 'checkbox', checked: !!pl.team });
    cb.addEventListener('change', () => {
      if (cb.checked) pl.team = { date: (pl.team && pl.team.date) || grToday() };
      else delete pl.team;
      saveLib();
      flashStatus(cb.checked ? `«${pl.name}» — сетлист для группы` : `«${pl.name}» больше не виден группе (Ctrl+Z — вернуть)`);
      grSetsPaint();
    });
    lab.append(cb, document.createTextNode(' Для группы'));
    head.append(grEl('b', '', pl.name), grEl('span', 'tm-sub', `${pl.entries.length} пунктов`), grEl('span', 'spacer'), lab);
    if (pl.team) {
      const date = Object.assign(grEl('input'), { type: 'date', value: pl.team.date || '' });
      date.setAttribute('aria-label', 'Дата служения: ' + pl.name);
      date.addEventListener('change', () => { if (!pl.team) return; pl.team.date = date.value; saveLib(); });
      head.insertBefore(date, lab);
    }
    card.append(head);
    if (!pl.team) return card;
    if (!pl.entries.length) card.append(grEl('div', 'tm-dev', 'Пусто — перетащите песни в плейлист'));
    for (const e of pl.entries) {
      const it = lib.items[e.item];
      if (!it) continue;
      const row = grEl('div', 'tm-dev');
      row.append(grEl('span', 'who', it.name));
      card.append(row);
      // Тональность — только у песен; у Библии и видео — что это
      if (it.kind !== 'song') { row.append(grEl('span', 'kind', Slides.PRES_NAMES[it.kind] || '')); continue; }
      const key = Object.assign(grEl('input', 'tm-key'), { value: e.key || '', maxLength: 12, placeholder: 'Тон.' });
      key.title = 'Тональность для группы — например G, Am, C#';
      key.setAttribute('aria-label', 'Тональность: ' + it.name);
      key.addEventListener('change', () => {
        const v = key.value.trim();
        if (v) e.key = v; else delete e.key;
        saveLib();
      });
      row.append(key);
    }
    return card;
  }));
}

/* ----- Что на экране — телефонам группы (teamapi.js: setLive, протокол v1 — live) ----- */

// Текст слайда для телефона: у Библии — стихи, у своего слайда — его текстовые блоки
function grSlideText(s) {
  if (s.k === 'text') return s.text || '';
  if (s.k === 'bible') return (s.verses || []).map((v) => ((s.verses.length > 1 ? v.n + ' ' : '') + v.t)).join(' ');
  if (s.k === 'custom') return (s.elements || []).filter((x) => x.kind === 'text').map((x) => x.text).join('\n');
  return '';
}
function grLive() {
  // Пункт из плейлиста или библиотеки
  const x = plShown && entryByKey(plShown.key, keyView(plShown.view));
  if (x && x.item) {
    const it = x.item;
    const idx = it.slides.findIndex((s) => s.id === plShown.sid);
    const s = it.slides[idx];
    const pl = plShown.view.startsWith('pl:') ? plShown.view.slice(3) : '';
    const base = { item: it.id, name: it.name, sid: plShown.sid, idx, n: it.slides.length, pl, eid: pl ? plShown.key : '' };
    if (it.kind === 'song') return { kind: 'song', ...base };
    if (!s || ['image', 'video', 'audio', 'live'].includes(s.k)) return { kind: 'media', ...base, name: it.slides.length > 1 ? it.name : (s && s.name) || it.name };
    return { kind: it.kind === 'bible' ? 'bible' : 'text', ...base,
      slides: it.slides.map((z) => ({ id: z.id, label: z.k === 'bible' ? z.ref || z.label || '' : z.label || z.name || '', text: grSlideText(z) })) };
  }
  // Библия со вкладки «Библия»: глава целиком, на экране — стих
  if (bShown) {
    const lay = Object.values(layerOn).find((l) => l.marks && l.marks.bShown === bShown);
    const label = (lay && lay.label) || 'Библия';
    if (!bible || bShown.bid !== bible.id) return { kind: 'bible', item: 'b:' + bShown.bid, name: label, slides: [] };
    const book = bible.books[bShown.bi];
    const keys = bShown.keys || (book.chapters[bShown.ci] || []).map((t, i) => (t ? vkey(bShown.bi, bShown.ci, i + 1) : null)).filter(Boolean);
    const slides = keys.map((k) => { const u = unkey(k); return { id: 'v' + k, label: bShown.keys ? `${bible.books[u.bi].name} ${u.ci + 1}:${u.v}` : String(u.v), text: verseText(k) }; });
    const sid = 'v' + vkey(bShown.bi, bShown.ci, bShown.v1);
    return { kind: 'bible', item: bShown.keys ? 'bx:' + bible.id : `b:${bible.id}:${bShown.bi}:${bShown.ci}`, name: bShown.keys ? label : `${book.name} ${bShown.ci + 1}`,
      sid, idx: slides.findIndex((z) => z.id === sid), n: slides.length, slides };
  }
  // Другое: видео, картинка, источник
  const ids = Object.keys(layerOn);
  if (ids.length) return { kind: 'media', name: layerOn[ids[ids.length - 1]].label || '' };
  return { kind: 'none' };
}
let grLiveSig = '';
let grLiveHist = null;
let grSetsHist = null;
setInterval(() => {
  if (!grInfo || !grInfo.cfg.on || typeof lib === 'undefined' || !lib) { grLiveSig = ''; return; }
  if (histCur !== grLiveHist) { grLiveHist = histCur; grLiveSig = ''; } // библиотеку сохранили — текст мог поменяться
  const sig = [plShown && plShown.view + '|' + plShown.key + '|' + plShown.sid, bShown && JSON.stringify(bShown), bible && bible.id, Object.keys(layerOn).join(',')].join('§');
  if (sig !== grLiveSig) {
    grLiveSig = sig;
    let l;
    try { l = grLive(); } catch { l = { kind: 'none' }; }
    window.api.teamLive(l).catch(() => {});
  }
  if (grTab === 'sets' && $('teamDialog').open && histCur !== grSetsHist) { grSetsHist = histCur; grSetsPaint(); } // Ctrl+Z, правка плейлиста
}, 400);

/* ----- Команды с телефона (право «Может листать»): тем же путём, что стрелки и щелчок по слайду ----- */

function grStep(d) {
  if (bShown && bible && bShown.bid === bible.id) { bibleStep(d); return; }
  // Пункт не из ленты (из библиотеки слева) — листаем внутри него
  if (plShown && plShown.view !== workKey()) {
    const x = entryByKey(plShown.key, keyView(plShown.view));
    if (!x) return;
    const s = x.item.slides[x.item.slides.findIndex((z) => z.id === plShown.sid) + d];
    if (s) showSlide(plShown.key, s.id, plShown.view);
    return;
  }
  plStep(d);
}
function grShow(c) {
  // Стих со вкладки «Библия»: пункт b:<перевод>:<книга>:<глава> (или bx:<перевод> — стихи вразброс), слайд v<книга>:<глава>:<стих>
  if (/^bx?:/.test(c.item)) {
    const k = /^v(\d+):(\d+):(\d+)$/.exec(c.sid);
    const mine = bible && (c.item === 'bx:' + bible.id || c.item.startsWith('b:' + bible.id + ':'));
    if (!mine || !k || !verseText(c.sid.slice(1))) return false;
    showVerses(Number(k[1]), Number(k[2]), Number(k[3]), Number(k[3]), (bShown && bShown.pane) || 'main');
    return true;
  }
  let at = null;
  if (c.pl && c.eid) { const x = entryByKey(c.eid, { kind: 'pl', id: c.pl }); if (x && x.item.id === c.item) at = { key: c.eid, vk: 'pl:' + c.pl }; }
  if (!at && plShown) { const x = entryByKey(plShown.key, keyView(plShown.view)); if (x && x.item.id === c.item) at = { key: plShown.key, vk: plShown.view }; }
  if (!at) at = rmPlace(c.item);
  const item = lib.items[c.item];
  if (!at || !item || !item.slides.some((s) => s.id === c.sid)) return false;
  sel = [{ key: at.key, sid: c.sid }];
  selAnchor = sel[0];
  showSlide(at.key, c.sid, at.vk);
  return true;
}
function grClear() {
  const id = Object.keys(layerOn).find((k) => { const m = layerOn[k].marks; return m && ((plShown && m.plShown === plShown) || (bShown && m.bShown === bShown)); });
  if (id) clearLayer(id); else clearKind('pres');
}
window.api.onTeamCmd((c) => {
  if (!c || typeof lib === 'undefined' || !lib) return;
  const who = `Телефон${c.who ? ` (${c.who})` : ''}`;
  if (c.cmd === 'next' || c.cmd === 'prev') { grStep(c.cmd === 'next' ? 1 : -1); flashStatus(`${who}: ${c.cmd === 'next' ? 'дальше' : 'назад'}`); }
  else if (c.cmd === 'clear') { grClear(); flashStatus(`${who}: текст убран с экрана`); }
  else if (c.cmd === 'show') { if (grShow(c)) flashStatus(`${who}: показан слайд`); else flashStatus(`${who}: этого слайда уже нет`); }
});
