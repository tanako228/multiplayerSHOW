/* ---------- Облако: раздел «Настройки → Данные и облако» (вместе с локальной копией — tools.js) (главный процесс — cloudsrv.js, ядро — sync/) ----------
   settings.cloud (у каждого профиля своё) = { provider: 'gdrive' | 'folder', dir, parts, auto, on }
     on — синхронизация уже была хоть раз (дальше можно автоматически).
   Автоматически (галочка): при запуске — полная синхронизация (пришло новое → окно обновляется, как при восстановлении),
   во время работы раз в 5 минут и при закрытии / смене профиля — «только отправить» (окно не трогается).
   Пришедшие библиотеки и файлы пишет главный процесс; настройки и записи localStorage — это окно, потом перезагрузка.
   Части — те же, что у репозитория (REPO_NAMES, tools.js); по умолчанию без экранов, раскладки, папок медиапула и
   «Настроек программы»: у каждого компьютера свои мониторы, звук и папки. */

const CLOUD_DEF_PARTS = ['library', 'files', 'themes', 'macros', 'bibles', 'bibleSet', 'bookmarks', 'keys', 'presets', 'ink', 'lists'];
if (!settings.cloud || typeof settings.cloud !== 'object') settings.cloud = { provider: 'gdrive', dir: '', parts: CLOUD_DEF_PARTS.slice(), auto: true, on: false };
if (!Array.isArray(settings.cloud.parts)) settings.cloud.parts = CLOUD_DEF_PARTS.slice();
const cloud = () => settings.cloud;

let clSt = null;       // ответ cloud:state
let clBusy = false;
let clWarned = false;  // об ошибке автоматической синхронизации говорим один раз
let clProg = null;     // ход: { step, i, n }

const clReady = () => !!clSt && (cloud().provider === 'folder' ? clSt.folder.exists : clSt.google.signedIn);
const clVisible = () => $('setDialog').open && !document.querySelector('.set-sec[data-sec="data"]').hidden;

function clSummary(s) {
  if (!s) return '';
  const p = [];
  if (s.pushed) p.push(`отправлено ${s.pushed}`);
  if (s.pulled) p.push(`получено ${s.pulled}`);
  if (s.deleted) p.push(`удалено ${s.deleted}`);
  if (s.conflicts) p.push(`одновременных правок ${s.conflicts}`);
  if (s.pending) p.push(`ждут следующего раза ${s.pending}`);
  if (s.skipped) p.push(`слишком больших файлов ${s.skipped}`);
  if (s.errors && s.errors.length) p.push(`ошибок ${s.errors.length}`);
  return p.length ? p.join(' · ') : 'всё уже одинаково';
}

async function renderCloud() {
  try { clSt = await window.api.cloudState(cloud()); } catch { clSt = null; }
  clPaint();
  dataPartsPaint();
}

// «Что сохранять»: строка на часть данных, галочки «Облако» и «Копия» (settings.cloud.parts / settings.repo.parts)
function dataPartsPaint() {
  const box = $('dataParts');
  if (!box) return;
  const cell = (cls, text) => Object.assign(document.createElement('div'), { className: cls, textContent: text || '' });
  const kids = [cell('dp-h', 'Данные'), cell('dp-h dp-c', 'Облако'), cell('dp-h dp-c', 'Копия')];
  for (const [id, name, note] of REPO_NAMES) {
    const row = [cell('dp-n')];
    // пояснение — на самой надписи (на широкой ячейке подсказка не показывается)
    row[0].append(Object.assign(document.createElement('span'), { textContent: name, title: note || '' }));
    for (const [get, set] of [[() => cloud().parts, (v) => { cloud().parts = v; }], [() => repo().parts, (v) => { repo().parts = v; }]]) {
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: get().includes(id) });
      cb.addEventListener('change', () => {
        const now = get().filter((x) => x !== id);
        if (cb.checked) now.push(id);
        set(REPO_ALL.filter((x) => now.includes(x)));
        saveSettings();
      });
      const c = cell('dp-c');
      c.append(cb);
      row.push(c);
    }
    // подсветка строки целиком
    for (const el of row) {
      el.addEventListener('pointerenter', () => row.forEach((x) => x.classList.add('dp-hov')));
      el.addEventListener('pointerleave', () => row.forEach((x) => x.classList.remove('dp-hov')));
    }
    kids.push(...row);
  }
  box.replaceChildren(...kids);
}

function clPaint() {
  const c = cloud();
  const s = clSt;
  if (!s) return;
  $('clPlace').value = c.provider;
  $('clGoogle').hidden = c.provider !== 'gdrive';
  $('clFolder').hidden = c.provider !== 'folder';
  const g = s.google;
  $('clGoogleState').textContent = !g.configured
    ? 'В этой сборке программы нет пропуска Google — можно синхронизироваться через папку.'
    : g.signedIn ? 'Вход выполнен. Программа видит только свою скрытую папку на вашем Диске.'
      : 'Откроется браузер — войдите в свой аккаунт Google.';
  $('clSignIn').hidden = !g.configured || g.signedIn;
  $('clSignOut').hidden = !g.signedIn;
  $('clDir').textContent = s.folder.dir ? s.folder.dir + (s.folder.exists ? '' : ' — папка не найдена') : 'Папка не выбрана';
  $('clDevOwn').textContent = g.own ? 'Сейчас используется свой пропуск (вписан здесь).' : g.configured ? 'Сейчас используется пропуск, вшитый в программу.' : '';
  $('clDevClear').hidden = !g.own;

  const st = $('clState');
  const ready = clReady();
  st.classList.toggle('off', !ready);
  if (clBusy) st.textContent = 'Синхронизация…' + (clProg && clProg.n ? ` ${Math.min(clProg.i + 1, clProg.n)} из ${clProg.n}` : '');
  else if (!ready) st.textContent = c.provider === 'folder' ? 'Выберите папку.' : g.configured ? 'Войдите в Google, чтобы начать.' : 'Google Диск в этой сборке недоступен — выберите «Папка».';
  else if (s.last) st.textContent = `Последняя синхронизация: ${new Date(s.last.date).toLocaleString(I18n.loc)}${s.last.pushOnly ? ' (только отправка)' : ''} — ${clSummary(s.last)}.`;
  else st.textContent = 'Ещё не синхронизировалось. Нажмите «Синхронизировать сейчас».';
  $('clName').textContent = `Этот компьютер в облаке называется: ${s.device}`;
  $('clNow').disabled = !ready || clBusy;
  $('clAuto').checked = !!c.auto;
  $('clAuto').disabled = !ready;
  dataBothPaint();
}

// Строка вверху раздела: облако и локальная копия вместе
function dataBothPaint() {
  const el = $('dataBoth');
  if (!el) return;
  const c = cloud();
  const s = clSt;
  const cl = !s ? '…' : !clReady() ? 'не подключено'
    : (c.provider === 'folder' ? 'папка' : 'Google Диск') + (s.last ? ', ' + new Date(s.last.date).toLocaleString(I18n.loc) : ', ещё не было') + (c.on && c.auto ? ', автоматически' : '');
  const r = repo();
  const rp = !r.dir ? 'не подключена' : r.hold ? 'ждёт решения' : (repoLast && repoLast.date ? new Date(repoLast.date).toLocaleString(I18n.loc) : 'ещё не сохранялась') + (r.auto ? ', автоматически' : '');
  el.textContent = `Облако: ${cl} · Резервная копия: ${rp}`;
  el.classList.toggle('off', !clReady() && !r.dir);
}

/* Синхронизировать. manual — по кнопке (всё сообщать); pushOnly — только отправить; prefer — ответ на вопрос «что взять» */
async function cloudRun({ manual = false, pushOnly = false, prefer, adopt = false } = {}) {
  const c = cloud();
  if (clBusy) return null;
  clBusy = true;
  clProg = null;
  if (clVisible()) clPaint();
  try {
    // Свежая библиотека — на диск: главный процесс берёт данные оттуда
    if (typeof lib !== 'undefined' && lib) {
      if (typeof saveTimer !== 'undefined' && saveTimer) flushLib();
      await window.api.libSave(lib).catch(() => {});
    }
    const res = await window.api.cloudSync({ cfg: c, ls: lsSnapshot(), parts: c.parts, prefer, pushOnly, adopt });
    if (res && res.needChoice) {
      // В программе ещё ни одной презентации (новая установка) — спрашивать нечего: берём облако целиком
      if (manual && typeof lib !== 'undefined' && lib && !Object.keys(lib.items || {}).length) { clBusy = false; return await cloudRun({ manual, prefer: 'remote', adopt: true }); }
      if (manual) $('clChoice').hidden = false;
      else showNotice('Облако: в нём уже есть данные с другого компьютера. Откройте «Настройки → Данные и облако» и выберите, что взять.', true);
      return res;
    }
    if (!res || !res.ok) {
      if (res && (res.skipped || res.busy)) return res;
      if (manual || !clWarned) {
        clWarned = true;
        showNotice('Облако: ' + (res && res.error ? res.error : 'не удалось синхронизировать'), true);
      }
      return res;
    }
    clWarned = false;
    if (!pushOnly && !c.on) { c.on = true; saveSettings(); }
    if (!pushOnly && res.out && res.out.changed) { clApply(res); return res; }
    if (manual) flashStatus('Облако: ' + clSummary(res.sum));
    return res;
  } catch (err) {
    if (manual) showNotice('Облако: ' + String(err && err.message || err), true);
    return null;
  } finally {
    clBusy = false;
    if (clVisible()) renderCloud();
  }
}

// Пришло новое: настройки и записи localStorage — сюда, затем окно собирается заново (как после восстановления)
function clApply(res) {
  const o = res.out;
  clearTimeout(saveTimer); // старая библиотека из памяти не должна перезаписать пришедшую
  saveTimer = 0;
  if (typeof repoClosing !== 'undefined') repoClosing = true;
  const keep = { cloud: settings.cloud, repo: settings.repo };
  Object.assign(settings, o.set || {});
  for (const k of o.dropSet || []) delete settings[k];
  Object.assign(settings, keep);
  saveSettings();
  try {
    for (const [k, v] of Object.entries(o.ls || {})) if (k.startsWith('cp.') && k !== 'cp.settings') localStorage.setItem(k, v);
    for (const k of o.dropLs || []) if (k.startsWith('cp.') && k !== 'cp.settings') localStorage.removeItem(k);
  } catch { /* не страшно */ }
  try { sessionStorage.setItem('cp-cloud-msg', 'Облако: ' + clSummary(res.sum) + ' — окно обновлено'); } catch { /* не страшно */ }
  location.reload();
}

// Закрытие программы и смена профиля: отправить последнее (окно не перезагружается)
async function cloudFinal() {
  const c = cloud();
  if (!c.on || !c.auto) return;
  while (clBusy) await new Promise((r) => setTimeout(r, 200));
  await cloudRun({ pushOnly: true });
}

window.api.onCloudProgress((p) => { clProg = p; if (clVisible() && clBusy) clPaint(); });

// Другое место — первая синхронизация с ним вручную (с вопросом, что взять)
$('clPlace').addEventListener('change', () => { cloud().provider = $('clPlace').value; cloud().on = false; saveSettings(); $('clChoice').hidden = true; renderCloud(); });
$('clSignIn').addEventListener('click', async () => {
  $('clSignIn').disabled = true;
  $('clGoogleState').textContent = 'Войдите в аккаунт Google в браузере и разрешите доступ, потом вернитесь сюда.';
  const r = await window.api.cloudSignIn(cloud());
  $('clSignIn').disabled = false;
  clSt = r.state;
  clPaint();
  if (!r.ok) showNotice('Google: ' + (r.error || 'вход не удался'), true);
  else flashStatus('Вход в Google выполнен');
});
$('clSignOut').addEventListener('click', async () => {
  if (!(await askYes('Выйти из аккаунта Google? Данные в облаке и на этом компьютере останутся, синхронизация остановится.', 'Выйти'))) return;
  clSt = await window.api.cloudSignOut(cloud());
  cloud().on = false;
  saveSettings();
  clPaint();
});
$('clPickDir').addEventListener('click', async () => {
  const dir = await window.api.cloudPickDir();
  if (!dir) return;
  cloud().dir = dir;
  cloud().on = false;
  saveSettings();
  renderCloud();
});
$('clNow').addEventListener('click', () => { $('clChoice').hidden = true; cloudRun({ manual: true }); });
$('clTakeCloud').addEventListener('click', () => { $('clChoice').hidden = true; cloudRun({ manual: true, prefer: 'remote' }); });
$('clTakeAll').addEventListener('click', () => { $('clChoice').hidden = true; cloudRun({ manual: true, prefer: 'remote', adopt: true }); });
$('clTakeMine').addEventListener('click', () => { $('clChoice').hidden = true; cloudRun({ manual: true, prefer: 'local' }); });
$('clChoiceNo').addEventListener('click', () => { $('clChoice').hidden = true; });
$('clAuto').addEventListener('change', () => { cloud().auto = $('clAuto').checked; saveSettings(); });
$('clConflicts').addEventListener('click', () => window.api.cloudConflicts());
$('partsAll').addEventListener('click', () => { cloud().parts = REPO_ALL.slice(); repo().parts = REPO_ALL.slice(); saveSettings(); dataPartsPaint(); });
$('partsDefault').addEventListener('click', () => { cloud().parts = CLOUD_DEF_PARTS.slice(); repo().parts = REPO_ALL.slice(); saveSettings(); dataPartsPaint(); });
$('clDevSave').addEventListener('click', async () => {
  const r = await window.api.cloudClient({ cfg: cloud(), clientId: $('clDevId').value, clientSecret: $('clDevSecret').value });
  if (!r.ok) { showNotice(r.error, true); return; }
  $('clDevId').value = ''; $('clDevSecret').value = '';
  clSt = r.state; clPaint();
  flashStatus('Пропуск Google сохранён');
});
$('clDevClear').addEventListener('click', async () => {
  const r = await window.api.cloudClient({ cfg: cloud(), clientId: '' });
  clSt = r.state; clPaint();
});

// После перезагрузки из-за пришедших данных — сказать, что было
try {
  const m = sessionStorage.getItem('cp-cloud-msg');
  if (m) { sessionStorage.removeItem('cp-cloud-msg'); setTimeout(() => flashStatus(m), 1500); }
} catch { /* не страшно */ }

// Автоматически: при запуске программы (один раз за запуск окна — не после своей же перезагрузки) и раз в 5 минут
(function cloudAuto() {
  const c = cloud();
  let boot = false;
  const key = 'cp-cloud-boot-' + (localStorage.getItem('cp.profile') || 'main'); // открыли другой профиль — у него своё облако
  try { boot = !sessionStorage.getItem(key); sessionStorage.setItem(key, '1'); } catch { boot = false; }
  if (boot && c.on && c.auto) setTimeout(() => cloudRun({}), 4000);
  setInterval(() => { const x = cloud(); if (x.on && x.auto && !clBusy) cloudRun({ pushOnly: true }); }, 5 * 60 * 1000);
})();
