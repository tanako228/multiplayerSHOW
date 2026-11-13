/* ---------- Профили: раздел «Настройки → Профили» (переключаются только здесь) ----------
   Хранение и общие данные — profiles.js (main). Здесь только окно: список профилей, создать,
   переименовать, удалить, открыть другой; общие библиотеки и категории (темы, макросы) — галочками.

   Открыть другой профиль или поменять общие данные открытого — окно перезагружается (программа и
   экраны показа работают дальше): перед этим всё несохранённое пишется на диск, а main.js до загрузки
   нового окна не принимает записи от старого. Настройки окна (localStorage) меняет preload.js. */

let profCat = null; // последнее от main: { active, list, cats, catNames, profiles: [{ id, name, libs }], shared: [{ id, name, count, members }] }
const profName = (id) => ((profCat && profCat.list.find((p) => p.id === id)) || { name: '?' }).name;

async function profLoad() {
  try { profCat = await window.api.profState(); } catch { profCat = null; }
  return profCat;
}

// Всё несохранённое — на диск: библиотека (и репозиторий, если подключён), настройки окна
async function profFlush() {
  try {
    if (typeof repoFinal === 'function') await repoFinal();
    else if (typeof lib !== 'undefined' && lib) { clearTimeout(saveTimer); saveTimer = 0; await window.api.libSave(lib); }
  } catch { /* дальше всё равно попробуем */ }
  if (typeof saveTimer !== 'undefined') { clearTimeout(saveTimer); saveTimer = 0; }
  if (typeof repoClosing !== 'undefined') repoClosing = true; // перезагрузка не отправит старое в репозиторий
  try { window.api.profFlushLs(); } catch { /* не страшно */ }
}

// Команда профилям. reload — после неё окно перезагрузится (открыт другой профиль или поменялись данные открытого)
let profBusy = false;
async function profRun(a, reload, reopen = 'profiles') {
  if (profBusy) return null;
  profBusy = true;
  try {
    if (reload) { flashStatus('Сохраняю…'); await profFlush(); }
    const r = await window.api.profDo({ ...a, reload: !!reload });
    if (!r || !r.ok) {
      if (reload && typeof repoClosing !== 'undefined') repoClosing = false;
      showNotice('Не получилось' + (r && r.error ? ': ' + r.error : ''), true);
      if (r && r.state) { profCat = r.state; profRender(); }
      return r;
    }
    if (reload) {
      try { sessionStorage.setItem('cp-prof-reopen', reopen || ''); } catch { /* не страшно */ }
      location.reload();
      return r;
    }
    profCat = r.state;
    profRender();
    return r;
  } finally { profBusy = false; }
}

function profSwitch(id) {
  if (!profCat || id === profCat.active) return;
  flashStatus(`Открываю профиль «${profName(id)}»…`);
  return profRun({ act: 'switch', id }, true); // после перезагрузки — снова «Настройки → Профили»
}

/* ----- Раздел «Настройки → Профили» ----- */

async function renderProfiles() {
  await profLoad();
  profRender();
}

function profRender() {
  if (!profCat) return;
  const act = profCat.active;
  // Список профилей
  $('profList').replaceChildren(...profCat.list.map((p) => {
    const row = Object.assign(document.createElement('div'), { className: 'prof-row' + (p.id === act ? ' cur' : '') });
    row.append(Icons.el('profile'), Object.assign(document.createElement('span'), { className: 'pr-name', textContent: p.name }));
    if (p.id === act) row.append(Object.assign(document.createElement('span'), { className: 'pr-tag', textContent: 'открыт' }));
    else row.append(Object.assign(document.createElement('button'), { textContent: 'Открыть', onclick: () => profSwitch(p.id) }));
    row.append(Object.assign(document.createElement('button'), {
      textContent: 'Переименовать',
      onclick: async () => {
        const name = await askName('Название профиля', p.name);
        if (name) await profRun({ act: 'rename', id: p.id, name });
      },
    }));
    const del = Object.assign(document.createElement('button'), { className: 'danger-btn', textContent: 'Удалить', disabled: p.id === 'main' || p.id === act });
    del.title = p.id === 'main' ? 'Основной профиль удалить нельзя' : p.id === act ? 'Сначала откройте другой профиль' : 'Удалить профиль и его свои данные';
    del.onclick = async () => {
      const ok = await askYes(`Удалить профиль «${p.name}»?\nЕго свои библиотеки, плейлисты и настройки уберутся (папка профиля откладывается в «profiles\\.deleted» в папке данных — её можно вернуть вручную). Общие данные остаются у других профилей.`, 'Удалить', true);
      if (ok) await profRun({ act: 'remove', id: p.id });
    };
    row.append(del);
    return row;
  }));
  profRenderShared();
  profRenderOwn();
}

const profCb = (checked, title, fn) => {
  const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked, title });
  cb.addEventListener('change', () => fn(cb));
  return cb;
};

// Таблица: общие библиотеки и категории × профили
function profRenderShared() {
  const box = $('profShared');
  const list = profCat.list;
  const t = document.createElement('table');
  const head = t.insertRow();
  head.append(Object.assign(document.createElement('th'), { textContent: '' }));
  for (const p of list) head.append(Object.assign(document.createElement('th'), { textContent: p.name }));
  const grp = (text) => { const r = t.insertRow(); r.className = 'grp'; const c = r.insertCell(); c.colSpan = list.length + 1; c.textContent = text; };
  // Категории
  grp('Категории');
  for (const cat of Object.keys(profCat.catNames || {})) {
    const on = profCat.cats[cat] || [];
    const r = t.insertRow();
    r.insertCell().textContent = profCat.catNames[cat];
    for (const p of list) {
      r.insertCell().append(profCb(on.includes(p.id), `${profCat.catNames[cat]}: общие для профиля «${p.name}»`, (cb) => profCatToggle(cat, p.id, cb)));
    }
  }
  // Библиотеки
  grp('Общие библиотеки');
  if (!profCat.shared.length) {
    const r = t.insertRow();
    const c = r.insertCell();
    c.colSpan = list.length + 1;
    c.innerHTML = '<small>Пока нет. Сделать библиотеку общей — ниже, в «Своих библиотеках», или при создании профиля.</small>';
  }
  for (const L of profCat.shared) {
    const r = t.insertRow();
    const c = r.insertCell();
    c.append(document.createTextNode(L.name + ' '), Object.assign(document.createElement('small'), { textContent: `(${L.count})` }));
    for (const p of list) r.insertCell().append(profCb(L.members.includes(p.id), `«${L.name}» у профиля «${p.name}»`, (cb) => profLibToggle(L, p.id, cb)));
  }
  box.replaceChildren(t);
}

async function profCatToggle(cat, pid, cb) {
  const on = new Set(profCat.cats[cat] || []);
  const name = profCat.catNames[cat];
  if (cb.checked) {
    // Первый, кто делает категорию общей, — открытый профиль (его темы станут общими) и тот, кого отметили
    if (!on.size && pid !== profCat.active) on.add(profCat.active);
    on.add(pid);
  } else {
    if (!(await askYes(`Сделать «${name}» снова своими у профиля «${profName(pid)}»?\nПрофиль оставит себе копию того, что сейчас общее; дальше правки не будут видны другим.`, 'Отключить'))) { cb.checked = true; return; }
    on.delete(pid);
    if (on.size === 1) on.clear(); // общим с самим собой быть незачем
  }
  const was = profCat.cats[cat] || [];
  const touches = was.includes(profCat.active) || on.has(profCat.active);
  await profRun({ act: 'cat', cat, ids: [...on] }, touches);
}

async function profLibToggle(L, pid, cb) {
  if (cb.checked) { await profRun({ act: 'connect', lib: L.id, id: pid }, pid === profCat.active); return; }
  const last = L.members.length === 1;
  if (!(await askYes(last
    ? `Сделать «${L.name}» снова своей библиотекой профиля «${profName(pid)}»?\nДругим профилям она не подключена — библиотека просто перестанет быть общей.`
    : `Отключить профиль «${profName(pid)}» от библиотеки «${L.name}»?\nУ других профилей она останется. Песни из неё, которые стоят в плейлистах этого профиля, останутся в плейлистах.`, 'Отключить'))) { cb.checked = true; return; }
  const keep = last ? true : await askYes(`Оставить профилю «${profName(pid)}» свою копию «${L.name}»?\nКопия — отдельная библиотека: её правки уже не будут видны другим.`, 'Оставить копию');
  await profRun({ act: 'disconnect', lib: L.id, id: pid, keep }, pid === profCat.active);
}

// Свои библиотеки каждого профиля: «Общая с…» — подключить другому профилю
function profRenderOwn() {
  const box = $('profOwn');
  box.replaceChildren();
  for (const p of profCat.profiles) {
    box.append(Object.assign(document.createElement('div'), { className: 'po-prof', textContent: p.name + (p.id === profCat.active ? ' (открыт)' : '') }));
    if (!p.libs.length) { box.append(Object.assign(document.createElement('div'), { className: 'po-row', innerHTML: '<small>Своих библиотек нет</small>' })); continue; }
    for (const L of p.libs) {
      const row = Object.assign(document.createElement('div'), { className: 'po-row' });
      row.append(Object.assign(document.createElement('span'), { textContent: L.name }), Object.assign(document.createElement('small'), { textContent: `${L.count}` }));
      const others = profCat.list.filter((q) => q.id !== p.id);
      const b = Object.assign(document.createElement('button'), { textContent: 'Общая с… ▾', disabled: !others.length, title: others.length ? 'Подключить эту библиотеку другому профилю: правки будут видны в обоих' : 'Создайте второй профиль' });
      b.addEventListener('click', () => {
        const r = b.getBoundingClientRect();
        showMenu({ clientX: r.left, clientY: r.bottom + 2 }, others.map((q) => ({
          label: q.name,
          fn: () => profRun({ act: 'connect', lib: L.id, id: q.id }, p.id === profCat.active || q.id === profCat.active),
        })));
      });
      row.append(b);
      box.append(row);
    }
  }
}

/* ----- Новый профиль ----- */

function profNewShow() {
  $('profNewBox').hidden = false;
  $('profNewName').value = '';
  const box = $('profNewPick');
  box.replaceChildren();
  const add = (value, text, note) => {
    const l = Object.assign(document.createElement('label'), { className: 'check' });
    l.append(Object.assign(document.createElement('input'), { type: 'checkbox', value }), document.createTextNode(' ' + text));
    if (note) l.append(Object.assign(document.createElement('small'), { textContent: ` — ${note}` }));
    box.append(l);
  };
  if (profCat) {
    box.append(Object.assign(document.createElement('b'), { textContent: 'Категории' }));
    for (const [cat, name] of Object.entries(profCat.catNames || {})) add('cat:' + cat, name, (profCat.cats[cat] || []).length ? 'общие с: ' + profCat.cats[cat].map(profName).join(', ') : 'из профиля «' + profName(profCat.active) + '»');
    const libs = [...profCat.shared.map((L) => ({ ...L, from: 'общая' })), ...profCat.profiles.flatMap((p) => p.libs.map((L) => ({ ...L, from: p.name, owner: p.id })))];
    if (libs.length) box.append(Object.assign(document.createElement('b'), { textContent: 'Библиотеки' }));
    for (const L of libs) add('lib:' + L.id, `${L.name} (${L.count})`, L.from);
  }
  setTimeout(() => $('profNewName').focus(), 0);
}

async function profCreate(open) {
  const name = $('profNewName').value.trim();
  if (!name) { $('profNewName').focus(); flashStatus('Введите название профиля'); return; }
  const picked = [...$('profNewPick').querySelectorAll('input:checked')].map((c) => c.value);
  const libs = picked.filter((v) => v.startsWith('lib:')).map((v) => v.slice(4));
  const cats = picked.filter((v) => v.startsWith('cat:')).map((v) => v.slice(4));
  const act = profCat ? profCat.active : 'main';
  // Данные открытого профиля поменяются, если его библиотека становится общей или его категория — общей впервые
  const ownLibs = new Set(((profCat && profCat.profiles.find((p) => p.id === act)) || { libs: [] }).libs.map((L) => L.id));
  const touches = libs.some((id) => ownLibs.has(id)) || cats.some((c) => !((profCat && profCat.cats[c]) || []).length || (profCat.cats[c] || []).includes(act));
  if (!open) {
    const r = await profRun({ act: 'create', name, libs, cats }, touches);
    if (r && r.ok) { $('profNewBox').hidden = true; flashStatus(`Профиль «${name}» создан`); }
    return;
  }
  // Создать и сразу открыть: сначала сохранить всё, создать, переключиться — одна перезагрузка
  if (profBusy) return;
  profBusy = true;
  try {
    flashStatus('Сохраняю…');
    await profFlush();
    const r = await window.api.profDo({ act: 'create', name, libs, cats, reload: true });
    if (!r || !r.ok) { if (typeof repoClosing !== 'undefined') repoClosing = false; showNotice('Не получилось создать профиль', true); return; }
    const s = await window.api.profDo({ act: 'switch', id: r.id, reload: true });
    if (!s || !s.ok) showNotice('Профиль создан, но не открылся', true);
    try { sessionStorage.setItem('cp-prof-reopen', 'profiles'); } catch { /* не страшно */ }
    location.reload();
  } finally { profBusy = false; }
}

$('profNew').addEventListener('click', profNewShow);
$('profNewCancel').addEventListener('click', () => { $('profNewBox').hidden = true; });
$('profNewGo').addEventListener('click', () => profCreate(false));
$('profNewOpen').addEventListener('click', () => profCreate(true));
$('profNewName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); profCreate(true); } });

// После перезагрузки из раздела «Профили» — открыть его снова и сказать, какой профиль открыт
(async () => {
  await profLoad();
  let reopen = null;
  try { reopen = sessionStorage.getItem('cp-prof-reopen'); sessionStorage.removeItem('cp-prof-reopen'); } catch { /* нет */ }
  if (reopen) setTimeout(() => openSettings(reopen), 300);
  if (reopen !== null && profCat) flashStatus(`Профиль «${profName(profCat.active)}»`);
})();
