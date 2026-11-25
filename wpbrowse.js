/* ---------- Удалённое управление, R3: окна выбора файлов компьютера A на компьютере B ----------
   Пока это окно управляет компьютером A (workplace.js), любое окно выбора, которое A открыл бы у себя
   (dialog.showOpenDialog / showSaveDialog / showMessageBox в main.js A), приходит сюда (wp:dialog): A его не видит.
   #wpBrowse — папки КОМПЬЮТЕРА A (api.wpfsList → wpfs:list на A), ответ — в виде ответа Electron (api.wpDialogDone).
   #wpAsk — вопрос с кнопками (showMessageBox). Одно окно за раз, остальные ждут в очереди. */
(function () {
  const $ = (id) => document.getElementById(id);
  const IMG = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic)$/i;
  const VID = /\.(mp4|webm|mov|m4v|ogv|mkv|avi|wmv)$/i;
  const AUD = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|wma)$/i;
  const queue = [];
  let cur = null;      // { id, kind, opts, dirMode, multi, save }
  let view = null;     // ответ wpfs:list
  let sel = new Set(); // выбранные имена
  let anchor = -1;     // для Shift+щелчка
  let lastDir = '';    // папка прошлого выбора — следующее окно открывается там же
  let filters = [];    // [{ name, ext: Set | null }]

  const sizeTxt = (n) => (n < 1024 ? n + ' Б' : n < 1048576 ? Math.round(n / 1024) + ' КБ' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' МБ' : (n / 1073741824).toFixed(1) + ' ГБ');
  const dateTxt = (t) => (t ? new Date(t).toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const join = (d, n) => (d.endsWith(view.sep) ? d + n : d + view.sep + n);
  const dirOf = (p) => { const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')); return i > 2 ? p.slice(0, i) : i >= 0 ? p.slice(0, i + 1) : ''; };
  const baseOf = (p) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1);
  const iconOf = (e) => (e.dir ? 'folder' : IMG.test(e.name) ? 'image' : VID.test(e.name) ? 'video' : AUD.test(e.name) ? 'audio' : 'text');
  // Папка — своя жёлтая плитка в стиле Icons (в наборе иконок папки нет)
  const FOLDER = '<path d="M5 7.5a1.5 1.5 0 0 1 1.5-1.5h3.3l1.7 1.8h6A1.5 1.5 0 0 1 19 9.3v7.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 16.5z" fill="#fff"/>';
  const svgOf = (name) => (name === 'folder' ? Icons.tile('#FFD465', '#E9A10A', FOLDER) : Icons.svg(name));

  function next() {
    if (cur || !queue.length) return;
    cur = queue.shift();
    if (cur.kind === 'showMessageBox') { ask(); return; }
    const props = Array.isArray(cur.opts.properties) ? cur.opts.properties : [];
    cur.save = cur.kind === 'showSaveDialog';
    cur.dirMode = !cur.save && props.includes('openDirectory') && !props.includes('openFile');
    cur.multi = !cur.save && props.includes('multiSelections');
    // Фильтры: «Картинки (*.jpg, *.png)» и т. п.; '*' — все файлы
    filters = (Array.isArray(cur.opts.filters) ? cur.opts.filters : []).map((f) => {
      const ex = (f.extensions || []).map((x) => String(x).toLowerCase());
      return { name: String(f.name || ''), ext: ex.includes('*') || !ex.length ? null : new Set(ex) };
    });
    if (!cur.save && !cur.dirMode && !filters.some((f) => !f.ext)) filters.push({ name: 'Все файлы', ext: null });
    const fs = $('wbFilter');
    fs.innerHTML = '';
    filters.forEach((f, i) => { const o = document.createElement('option'); o.value = i; o.textContent = f.name + (f.ext ? ' (' + [...f.ext].map((x) => '*.' + x).join(', ') + ')' : ''); fs.append(o); });
    fs.hidden = cur.dirMode || filters.length < 2 && !filters[0]?.ext;
    $('wbTitle').textContent = cur.opts.title || (cur.save ? 'Сохранить как' : cur.dirMode ? 'Выбор папки' : 'Выбор файлов');
    $('wbNameBox').hidden = !cur.save;
    $('wbOk').textContent = cur.opts.buttonLabel || (cur.save ? 'Сохранить' : cur.dirMode ? 'Выбрать папку' : 'Открыть');
    $('wbWhere').textContent = 'Папки компьютера «' + ((window.wpHostName && window.wpHostName()) || 'A') + '»';
    let start = String(cur.opts.defaultPath || '');
    if (cur.save) { $('wbName').value = baseOf(start) || ''; start = dirOf(start) || start; }
    $('wbInfo').textContent = '';
    const dlg = $('wpBrowse');
    if (!dlg.open) dlg.showModal();
    load(start || lastDir).then(() => { if (start && view && view.error) load(lastDir); });
    (cur.save ? $('wbName') : $('wbList')).focus();
  }

  async function load(dir) {
    let r;
    try { r = await window.api.wpfsList(dir || ''); } catch (e) { $('wbInfo').textContent = String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); return; }
    if (!cur) return;
    view = r;
    sel = new Set();
    anchor = -1;
    $('wbPath').value = r.dir;
    $('wbUp').disabled = !r.parent;
    places(r);
    render();
    if (r.error) $('wbInfo').textContent = r.error;
  }

  function places(r) {
    const nav = $('wbPlaces');
    nav.innerHTML = '';
    const sec = (t) => { const d = document.createElement('div'); d.className = 'wb-sec'; d.textContent = t; nav.append(d); };
    const btn = (name, p, icon) => {
      const b = document.createElement('button');
      const ic = document.createElement('span'); ic.className = 'ic'; ic.innerHTML = svgOf(icon);
      b.append(ic, document.createTextNode(name));
      b.title = p;
      b.addEventListener('click', () => load(p));
      nav.append(b);
    };
    sec('Места');
    for (const p of r.places || []) btn(p.name, p.path, 'folder');
    const pool = (typeof settings !== 'undefined' && settings.poolFolders) || [];
    if (pool.length) { sec('Медиапул'); for (const p of pool) btn(baseOf(p) || p, p, 'pool'); }
    sec('Диски');
    for (const d of r.drives || []) btn(d, d, 'database');
  }

  const filt = () => filters[Number($('wbFilter').value) || 0];
  function visible() {
    if (!view) return [];
    const f = filt();
    return view.entries.filter((e) => e.dir || (!cur.dirMode && (!f || !f.ext || f.ext.has((e.name.split('.').pop() || '').toLowerCase()))));
  }

  function render() {
    const list = $('wbList');
    list.innerHTML = '';
    const items = visible();
    if (!items.length) { const d = document.createElement('div'); d.className = 'wb-empty'; d.textContent = view && view.error ? view.error : 'Здесь нет подходящих файлов'; list.append(d); }
    items.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'wb-row' + (sel.has(e.name) ? ' sel' : '');
      row.setAttribute('role', 'option');
      row.dataset.i = i;
      const ic = document.createElement('span'); ic.className = 'ic'; ic.innerHTML = svgOf(iconOf(e));
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = e.name; nm.title = e.name; nm.dataset.noi18n = '';
      const sz = document.createElement('span'); sz.className = 'sz'; sz.textContent = e.dir ? '' : sizeTxt(e.size);
      const dt = document.createElement('span'); dt.className = 'dt'; dt.textContent = dateTxt(e.mtime);
      row.append(ic, nm, sz, dt);
      row.addEventListener('click', (ev) => pick(items, i, ev));
      row.addEventListener('dblclick', () => (e.dir ? load(join(view.dir, e.name)) : (sel = new Set([e.name]), ok())));
      list.append(row);
    });
    info();
  }

  function pick(items, i, ev) {
    const e = items[i];
    if (cur.multi && ev.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      sel = new Set(items.slice(a, b + 1).filter((x) => !x.dir).map((x) => x.name));
    } else if (cur.multi && (ev.ctrlKey || ev.metaKey)) {
      if (sel.has(e.name)) sel.delete(e.name); else sel.add(e.name);
      anchor = i;
    } else { sel = new Set([e.name]); anchor = i; }
    if (cur.save && !e.dir) $('wbName').value = e.name;
    $('wbList').querySelectorAll('.wb-row').forEach((r) => r.classList.toggle('sel', sel.has(items[r.dataset.i].name)));
    info();
  }

  function info() {
    if (!cur || !view) return;
    const files = view.entries.filter((e) => sel.has(e.name) && !e.dir);
    $('wbInfo').textContent = cur.dirMode ? 'Папка: ' + (selDir() || view.dir) : files.length > 1 ? 'Выбрано файлов: ' + files.length : '';
  }
  const selDir = () => { const d = view && view.entries.find((e) => e.dir && sel.has(e.name)); return d ? join(view.dir, d.name) : ''; };

  function ok() {
    if (!cur || !view) return;
    if (cur.save) {
      let n = $('wbName').value.trim();
      if (!n) { $('wbName').focus(); return; }
      const f = filt();
      if (f && f.ext && !/\.[^.\\/]+$/.test(n)) n += '.' + [...f.ext][0];
      done({ canceled: false, filePath: /^[a-z]:[\\/]|^[\\/]/i.test(n) ? n : join(view.dir, n) });
      return;
    }
    if (cur.dirMode) { done({ canceled: false, filePaths: [selDir() || view.dir] }); return; }
    const picked = view.entries.filter((e) => sel.has(e.name));
    if (picked.length === 1 && picked[0].dir) { load(join(view.dir, picked[0].name)); return; }
    const files = picked.filter((e) => !e.dir).map((e) => join(view.dir, e.name));
    if (!files.length) { $('wbInfo').textContent = 'Выберите файл'; return; }
    done({ canceled: false, filePaths: cur.multi ? files : files.slice(0, 1) });
  }

  function done(res) {
    if (!cur) return;
    const x = cur;
    cur = null;
    if (view && !res.canceled) lastDir = view.dir;
    window.api.wpDialogDone({ id: x.id, res });
    const d = x.kind === 'showMessageBox' ? $('wpAsk') : $('wpBrowse');
    if (d.open) d.close();
    view = null;
    next();
  }

  // Вопрос с кнопками (showMessageBox): кнопки — как просил A, Esc — cancelId
  function ask() {
    const o = cur.opts;
    $('waTitle').textContent = o.title || 'multiplayerSHOW';
    $('waMsg').textContent = o.message || '';
    $('waDetail').textContent = o.detail || '';
    const box = $('waBtns');
    box.innerHTML = '';
    const btns = Array.isArray(o.buttons) && o.buttons.length ? o.buttons : ['OK'];
    btns.forEach((t, i) => {
      const b = document.createElement('button');
      b.textContent = t;
      if (i === (o.defaultId != null ? o.defaultId : 0)) b.className = 'primary';
      b.addEventListener('click', () => done({ response: i, checkboxChecked: false }));
      box.append(b);
    });
    $('wpAsk').showModal();
    const def = box.querySelector('.primary');
    if (def) def.focus();
  }

  const cancel = () => { if (!cur) return; done(cur.kind === 'showMessageBox' ? { response: cur.opts.cancelId != null ? cur.opts.cancelId : 0 } : { canceled: true }); };

  window.api.onWpDialog((m) => { if (m && m.id) { queue.push({ id: m.id, kind: m.kind, opts: m.opts || {} }); next(); } });

  const wire = () => {
    // Esc и × — «отмена»; закрытие окна чем угодно — тоже ответ A, чтобы его обработчик не ждал вечно
    for (const id of ['wpBrowse', 'wpAsk']) $(id).addEventListener('close', () => { if (cur) cancel(); });
    document.querySelectorAll('#wpBrowse .wb-x').forEach((b) => b.addEventListener('click', cancel));
    $('wbOk').addEventListener('click', ok);
    $('wbUp').addEventListener('click', () => view && view.parent && load(view.parent));
    $('wbPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); load($('wbPath').value.trim()); } });
    $('wbFilter').addEventListener('change', render);
    $('wbName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    $('wbList').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Backspace' && view && view.parent) { e.preventDefault(); load(view.parent); }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
