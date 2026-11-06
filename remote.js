/* ---------- Пульт с телефона ----------
   Оператор открывает доступ к одной презентации (меню презентации → «Доступ с телефона…»): у доступа свой ключ,
   ссылка и QR-код. Человек сканирует его телефоном (та же Wi-Fi сеть) и в браузере видит только эту презентацию:
   что сейчас на экране, что дальше, все слайды; может листать (галочка «Листать») и править текст слайдов
   («Править текст»). Сервер — в main.js (rmHandle), страница телефона — phone.html, QR-код — qr.js.
   Доступы — cp.remote (localStorage) = [{ token, itemId, show, edit }]; убрать доступ — ссылка перестаёт работать.
   Команды с телефона идут тем же путём, что щелчок мышью (showSlide), правка текста — через lib (Ctrl+Z работает). */

let rmList = [];
try { rmList = JSON.parse(localStorage.getItem('cp.remote') || '[]'); } catch { rmList = []; }
if (!Array.isArray(rmList)) rmList = [];
const rmSave = () => { try { localStorage.setItem('cp.remote', JSON.stringify(rmList)); } catch { /* не страшно */ } rmPush(); };
let rmNet = { running: false, port: 0, ips: [], error: '' };
let rmCur = ''; // какой доступ показан в окне (QR)
let rmIp = localStorage.getItem('cp.remoteIp') || '';
let rmFw = { rule: true, pub: false }; // брандмауэр Windows (main.js: rmFw)

const rmToken = () => [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
const rmItem = (g) => (lib && lib.items[g.itemId]) || null;
const rmAddr = () => (rmNet.ips.includes(rmIp) ? rmIp : rmNet.ips[0] || '');
const rmUrl = (g) => (rmNet.running && rmAddr() ? `http://${rmAddr()}:${rmNet.port}/r/${g.token}` : '');

// Текст слайда для телефона (правка и подпись без картинки)
function rmText(s) {
  if (s.k === 'text') return s.text || '';
  if (s.k === 'bible') return (s.ref ? s.ref + '\n' : '') + (s.verses || []).map((v) => v.t).join(' ');
  return s.name || '';
}

// Где показывать пункт: лента (рабочий список), список слева или первая библиотека, где он есть
function rmPlace(itemId) {
  const views = [work, lib.view, ...lib.libraries.map((l) => ({ kind: 'lib', id: l.id }))];
  for (const v of views) {
    if (!v || !findView(v)) continue;
    const x = viewEntries(v).find((e) => e.item.id === itemId);
    if (x) return { key: x.key, vk: viewKey(v) };
  }
  return null;
}
// Что из этой презентации сейчас на экране
function rmLive(itemId) {
  if (!plShown) return null;
  const e = entryByKey(plShown.key, keyView(plShown.view));
  return e && e.item.id === itemId ? plShown.sid : null;
}

function rmPush() {
  if (!lib) return;
  rmList = rmList.filter((g) => rmItem(g)); // презентацию удалили — доступ пропадает
  const grants = rmList.map((g) => {
    const item = rmItem(g);
    const live = rmLive(item.id);
    return {
      token: g.token, name: item.name, show: !!g.show, edit: !!g.edit, live,
      other: !live && Object.keys(layerOn).length > 0,
      slides: item.slides.map((s) => {
        let content = null;
        if (!['audio', 'live'].includes(s.k)) { try { content = contentOf(item, s); } catch { content = null; } }
        return { id: s.id, k: s.k, label: s.label || '', text: rmText(s), content };
      }),
    };
  });
  window.api.remoteState({ grants, size: outputSize() }).then((n) => { if (n) rmNet = n; rmPaint(); }).catch(() => {});
}

// Перемены (lib сохранили, показали другой слайд, очистили экран) — телефонам сразу
let rmSig = '';
let rmHist = null;
setInterval(() => {
  if (!lib || !rmList.length) { if (rmSig) { rmSig = ''; rmPush(); } return; }
  if (histCur !== rmHist) { rmHist = histCur; rmSig = ''; } // библиотеку сохранили — что-то поменялось
  const sig = [ plShown && plShown.key + '|' + plShown.sid + '|' + plShown.view, Object.keys(layerOn).join(','), settings.res, settings.resW, settings.resH].join('§');
  if (sig === rmSig) return;
  rmSig = sig;
  rmPush();
}, 400);
// Правка текста могла не поменять длину снимка — после сохранения отправить ещё раз
const rmPushSoon = () => setTimeout(rmPush, 700);

window.api.onRemoteInfo((n) => { if (n) rmNet = n; rmPaint(); });

// Команды с телефона
window.api.onRemoteCmd(({ token, cmd, sid, text }) => {
  const g = rmList.find((x) => x.token === token);
  const item = g && rmItem(g);
  if (!item) return;
  const at = rmPlace(item.id);
  if (!at) { flashStatus(`Пульт: «${item.name}» нет ни в одном списке`); return; }
  const show = (id) => {
    if (!item.slides.some((s) => s.id === id)) return;
    sel = [{ key: at.key, sid: id }];
    selAnchor = sel[0];
    showSlide(at.key, id, at.vk);
  };
  const live = rmLive(item.id);
  const i = live ? item.slides.findIndex((s) => s.id === live) : -1;
  if (cmd === 'show' && g.show) show(sid);
  else if (cmd === 'next' && g.show) { const s = item.slides[i + 1]; if (s) show(s.id); }
  else if (cmd === 'prev' && g.show) { const s = i < 0 ? item.slides[0] : item.slides[i - 1]; if (s) show(s.id); }
  else if (cmd === 'clear' && g.show && live) {
    // Убрать только свой слайд: слой, где он сейчас
    const id = Object.keys(layerOn).find((k) => layerOn[k].marks && layerOn[k].marks.plShown === plShown);
    if (id) clearLayer(id); else clearScreen();
  } else if (cmd === 'edit' && g.edit) {
    const s = item.slides.find((x) => x.id === sid);
    if (!s || s.k !== 'text' || s.text === text) return;
    s.text = text;
    touched(item);
    renderService();
    flashStatus(`Пульт: текст слайда в «${item.name}» изменён (Ctrl+Z — вернуть)`);
    if (live === sid) showSlide(plShown.key, sid, plShown.view);
    rmPushSoon();
  }
});

/* ----- Окно «Доступ с телефона» ----- */

function rmOpen(item) {
  if (item) {
    let g = rmList.find((x) => x.itemId === item.id);
    if (!g) { g = { token: rmToken(), itemId: item.id, show: true, edit: false }; rmList.push(g); rmSave(); }
    rmCur = g.token;
  }
  if (!rmList.some((g) => g.token === rmCur)) rmCur = rmList[0] ? rmList[0].token : '';
  rmPaint();
  if (!$('rmDialog').open) $('rmDialog').showModal();
  window.api.remoteInfo().then((n) => { if (n) rmNet = n; rmPaint(); }).catch(() => {});
  window.api.remoteFw().then((f) => { if (f) rmFw = f; rmPaint(); }).catch(() => {});
}

function rmPaint() {
  const dlg = $('rmDialog');
  if (!dlg || !dlg.open) return;
  rmList = rmList.filter((g) => rmItem(g));
  const rows = $('rmRows');
  rows.replaceChildren();
  if (!rmList.length) rows.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Доступов нет. Откройте меню презентации (правая кнопка) → «Доступ с телефона…».' }));
  for (const g of rmList) {
    const item = rmItem(g);
    const row = Object.assign(document.createElement('div'), { className: 'rm-row' + (g.token === rmCur ? ' on' : '') });
    const nm = Object.assign(document.createElement('button'), { className: 'rm-name', textContent: item.name, title: 'Показать QR-код этого доступа' });
    nm.onclick = () => { rmCur = g.token; rmPaint(); };
    const chk = (label, key, tip) => {
      const l = Object.assign(document.createElement('label'), { className: 'rm-chk', title: tip });
      const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!g[key] });
      c.onchange = () => { g[key] = c.checked; rmSave(); };
      l.append(c, document.createTextNode(' ' + label));
      return l;
    };
    const fresh = Object.assign(document.createElement('button'), { textContent: 'Новая ссылка', title: 'Старая ссылка и QR-код перестанут работать' });
    fresh.onclick = () => { g.token = rmToken(); rmCur = g.token; rmSave(); flashStatus('Новая ссылка — старая больше не работает'); };
    const del = Object.assign(document.createElement('button'), { textContent: 'Закрыть доступ', className: 'danger-btn' });
    del.onclick = () => {
      rmList = rmList.filter((x) => x !== g);
      rmSave();
      flashStatus(`Доступ к «${item.name}» закрыт — телефон больше не управляет`);
    };
    row.append(nm, chk('Листать', 'show', 'Может показывать слайды на экране'), chk('Править текст', 'edit', 'Может менять текст слайдов песни'), fresh, del);
    rows.append(row);
  }
  // QR-код выбранного доступа
  const g = rmList.find((x) => x.token === rmCur);
  const qr = $('rmQr');
  const url = g ? rmUrl(g) : '';
  qr.replaceChildren();
  if (url) {
    const box = document.createElement('div');
    box.className = 'rm-qrimg';
    box.innerHTML = QR.svg(url, 7);
    qr.append(box, Object.assign(document.createElement('div'), { className: 'rm-url', textContent: url }));
    const name = rmItem(g).name;
    qr.append(Object.assign(document.createElement('div'), { className: 'hint', textContent: `Наведите камеру телефона на код — откроется пульт презентации «${name}».` }));
  } else if (g) {
    qr.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: rmNet.error ? 'Сервер не запустился: ' + rmNet.error : !rmNet.ips.length && rmNet.running ? 'Компьютер не подключён к сети (Wi-Fi или кабель).' : 'Запуск сервера…' }));
  }
  // Сервер и последнее подключение с телефона — видно, доходит ли телефон до компьютера
  const sv = $('rmSrv');
  const seen = rmNet.seen;
  sv.textContent = !rmNet.running ? (rmNet.error ? 'Сервер не запустился: ' + rmNet.error : rmList.length ? 'Сервер запускается…' : '')
    : 'Сервер работает (порт ' + rmNet.port + '). ' + (seen ? 'Последнее подключение: ' + seen.ip + ' в ' + new Date(seen.at).toLocaleTimeString() + '.' : 'С телефона ещё никто не подключался.');
  // Брандмауэр: без правила телефон видит «Не удаётся получить доступ к сайту»
  $('rmFw').hidden = rmFw.rule;
  $('rmFwText').textContent = 'Брандмауэр Windows не пускает телефоны к программе' + (rmFw.pub ? ' (сеть Wi-Fi отмечена как общественная)' : '') + '. Нажмите кнопку и подтвердите в окне Windows.';
  // Адрес компьютера, если сетей несколько
  const pick = $('rmIp');
  pick.replaceChildren(...rmNet.ips.map((ip) => Object.assign(document.createElement('option'), { value: ip, textContent: ip, selected: ip === rmAddr() })));
  $('rmIpRow').hidden = rmNet.ips.length < 2;
}
$('rmFwFix').addEventListener('click', async () => {
  $('rmFwFix').disabled = true;
  try { const f = await window.api.remoteFwFix(); if (f) rmFw = f; } catch { /* отказались в окне Windows */ }
  $('rmFwFix').disabled = false;
  flashStatus(rmFw.rule ? 'Брандмауэр: доступ с телефона разрешён' : 'Брандмауэр не изменён');
  rmPaint();
});
$('rmIp').addEventListener('change', (e) => { rmIp = e.target.value; localStorage.setItem('cp.remoteIp', rmIp); rmPaint(); });
$('rmCopy').addEventListener('click', () => {
  const g = rmList.find((x) => x.token === rmCur);
  const url = g && rmUrl(g);
  if (url) navigator.clipboard.writeText(url).then(() => flashStatus('Ссылка скопирована'), () => {});
});

// Пункт в меню презентации (playlist.js: presMenu)
function rmPresMenu(item) {
  const has = rmList.some((g) => g.itemId === item.id);
  return [{ label: 'Доступ с телефона (QR)…' + (has ? ' ✓' : ''), fn: () => rmOpen(item) }];
}

// Доступы, сохранённые с прошлого раза, — сервер включается сам
setTimeout(() => { if (rmList.length) rmPush(); }, 1500);
