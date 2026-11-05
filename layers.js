/* ===== Панель «Слои» под «Предпросмотром» (Media Layers, как в ProPresenter) =====
   Модель слоёв — в renderer.js (LAYER_KINDS, layerDefs, layerOn, present, clearLayer, clearScreen).
   Здесь только управление: строка на слой (сверху — верхний), индикатор, что показано, глаз, пуск/пауза,
   очистка, настройки (прозрачность, громкость, порядок, ещё один слой того же вида). */

const lyIcon = (name) => { const s = document.createElement('span'); s.dataset.icon = name; return s; };

/* ----- Иконка слоя: своя (l.icon — имя значка из icons.js или картинка data:) или по виду слоя ----- */
const layerIconOf = (l) => l.icon || LAYER_KINDS[l.kind].icon;
function lyIconEl(l) {
  const ic = layerIconOf(l);
  if (!/^data:image\//.test(ic)) return Icons.el(ic);
  const s = Object.assign(document.createElement('span'), { className: 'mp-icon own' });
  s.append(Object.assign(new Image(), { src: ic, alt: '' }));
  return s;
}

// Значки для слоёв по темам (один значок можно дать нескольким слоям)
const LY_ICON_CATS = [
  ['Видео', ['video', 'show', 'output']],
  ['Изображения', ['image', 'pool', 'slides']],
  ['Презентации', ['presentation', 'screen', 'arrange']],
  ['Текст', ['text', 'bible', 'parts', 'list']],
  ['Камера', ['camera', 'cast', 'eye']],
  ['Звук', ['music', 'audio', 'mic', 'playlist']],
  ['NDI и источники', ['ndi', 'sources', 'web', 'screens']],
  ['Overlay', ['overlay', 'layers', 'scene', 'front']],
  ['Другие', ['announce', 'message', 'props', 'star', 'bookmark', 'timer', 'draw', 'theme', 'trigger', 'logic', 'lock', 'macro']],
];
const lyPlayable = (c) => !!c && (c.type === 'video' || c.type === 'live' || !!(c.style && c.style.bgVideo));

function lyButton(text, title, fn, cls) {
  const b = Object.assign(document.createElement('button'), { textContent: text, title, className: cls || '' });
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
  return b;
}

function renderLayers() {
  const box = $('lyRows');
  const defs = layerDefs();
  box.replaceChildren(...defs.slice().reverse().map((l) => {
    const k = LAYER_KINDS[l.kind];
    const x = layerOn[l.id];
    const row = Object.assign(document.createElement('div'), { className: 'ly-row' + (x ? ' on' : '') + (l.hidden ? ' off' : '') + (x && x.paused ? ' paused' : '') });
    const txt = Object.assign(document.createElement('div'), { className: 'ly-txt' });
    txt.append(Object.assign(document.createElement('span'), { className: 'ly-name', textContent: layerName(l) }),
      Object.assign(document.createElement('span'), { className: 'ly-what', textContent: x ? x.label || 'Показано' : 'Пусто' }));
    txt.title = x ? `${layerName(l)}: ${x.label || ''}` : `${layerName(l)}: пусто. Сюда само попадает: ${lyTakes(k)}`;
    const eye = lyButton(l.hidden ? '◌' : '◉', l.hidden ? 'Слой скрыт — показать' : 'Скрыть слой (содержимое продолжает идти)', () => lySet(l, { hidden: !l.hidden }), l.hidden ? '' : 'lit');
    const play = lyButton(x && x.paused ? '▶' : '❚❚', x && x.paused ? 'Продолжить' : 'Пауза', () => { x.paused = !x.paused; layerPlay(l.id, !x.paused); });
    play.disabled = !x || !lyPlayable(x.content);
    const clr = lyButton('✕', 'Очистить только этот слой', () => clearLayer(l.id), 'ly-x');
    clr.disabled = !x;
    const set = lyButton('⋯', 'Настройки слоя: прозрачность, громкость, порядок, иконка', (e) => lyOpenPop(l, e.currentTarget));
    const ico = lyButton('', 'Сменить иконку слоя', (e) => lyIconPick(l, e.currentTarget), 'ly-ico');
    ico.append(lyIconEl(l));
    row.append(ico, Object.assign(document.createElement('span'), { className: 'ly-dot' }), txt, eye, play, set, clr);
    return row;
  }));
  Icons.apply(box);
  const any = Object.keys(layerOn).length > 0;
  if (!any) lyAsk = '';
  const all = $('lyClearAll');
  all.disabled = !any;
  all.classList.toggle('ask', lyAsk === 'head');
  all.textContent = lyAsk === 'head' ? 'Точно очистить?' : 'Очистить всё';
  lyFoldUi();
  renderLyRail();
}

/* ----- Свернуть/развернуть панель «Слои» (settings.lyFold — помнится и между разделами, и после перезапуска) ----- */
function lyFoldUi() {
  const fold = !!settings.lyFold;
  const n = layerDefs().filter((l) => layerOn[l.id]).length;
  $('layersBox').classList.toggle('fold', fold);
  $('lyFold').setAttribute('aria-expanded', String(!fold));
  $('lyFold').title = fold ? 'Развернуть панель слоёв: все слои, их состояние и очистка' : 'Свернуть панель слоёв';
  $('lySum').textContent = n ? `· занято ${n}` : fold ? '· пусто' : '';
}
$('lyFold').addEventListener('click', () => {
  settings.lyFold = !settings.lyFold;
  saveSettings();
  lyClosePop();
  lyFoldUi();
});

/* ----- Кнопки слоёв справа от предпросмотра (как в ProPresenter) -----
   Сверху — верхний слой. Занятый слой подсвечен цветом интерфейса; щелчок по нему — очистить только его.
   Правая кнопка — сменить иконку. Внизу — «Очистить всё». */
function renderLyRail() {
  const rail = $('lyRail');
  const btns = layerDefs().slice().reverse().map((l) => {
    const x = layerOn[l.id];
    const b = lyButton('', '', () => {
      if (layerOn[l.id]) clearLayer(l.id); else flashStatus(`Слой «${layerName(l)}» и так пуст`);
    }, 'ly-rb' + (x ? ' on' : '') + (l.hidden ? ' off' : ''));
    b.title = (x ? `${layerName(l)}: ${x.label || 'показано'} — щелчок очистит только этот слой` : `${layerName(l)}: пусто`)
      + (l.hidden ? ' (слой скрыт)' : '') + '. Правая кнопка — сменить иконку';
    b.append(lyIconEl(l));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); lyIconPick(l, b); });
    return b;
  });
  const all = lyButton('', lyAsk === 'rail' ? 'Нажмите ещё раз — очистить все слои' : 'Очистить всё: убрать вывод со всех экранов (нажать два раза)',
    () => lyClearAllAsk('rail'), 'ly-rb ly-rall' + (lyAsk === 'rail' ? ' ask' : ''));
  all.append(Icons.el('close'));
  all.disabled = !Object.keys(layerOn).length;
  rail.replaceChildren(...btns, all);
}

/* ----- «Очистить всё» с подтверждением: первое нажатие — кнопка краснеет, второе за 3 с — очистка ----- */
let lyAsk = ''; // какая кнопка ждёт второго нажатия: 'head' (под экраном) или 'rail' (справа)
let lyAskT = 0;
function lyClearAllAsk(where) {
  clearTimeout(lyAskT);
  if (!Object.keys(layerOn).length) { lyAsk = ''; renderLayers(); return; }
  if (lyAsk === where) {
    lyAsk = '';
    clearScreen(); // слои, их настройки, библиотеки и плейлисты не трогаются — только то, что на экранах
    flashStatus('Все слои очищены');
    return;
  }
  lyAsk = where;
  lyAskT = setTimeout(() => { lyAsk = ''; renderLayers(); }, 3000);
  flashStatus('Нажмите ещё раз, чтобы очистить все слои');
  renderLayers();
}

/* ----- Выбор иконки слоя: значки по темам, свой файл, «как у вида» ----- */
function lyIconPick(l, anchor) {
  const again = lyPop && lyPop.dataset.id === 'ic:' + l.id;
  lyClosePop();
  if (again) return;
  const pop = Object.assign(document.createElement('div'), { className: 'ly-pop ly-icpop' });
  pop.dataset.id = 'ic:' + l.id;
  pop.append(Object.assign(document.createElement('div'), { className: 't', textContent: `Иконка слоя «${layerName(l)}»` }));
  const cur = layerIconOf(l);
  for (const [name, list] of LY_ICON_CATS) {
    const ics = Object.assign(document.createElement('div'), { className: 'ics' });
    ics.append(...list.filter((n) => Icons.names.includes(n)).map((n) => {
      const b = lyButton('', '', () => { lyClosePop(); lySet(l, { icon: n }); }, n === cur ? 'cur' : '');
      b.append(Icons.el(n));
      return b;
    }));
    pop.append(Object.assign(document.createElement('div'), { className: 'cat', textContent: name }), ics);
  }
  const acts = Object.assign(document.createElement('div'), { className: 'acts' });
  acts.append(lyButton('Свой файл…', 'Своя картинка: PNG, SVG, JPG (сохраняется в настройках слоя)', () => lyIconFile(l)));
  const def = lyButton('Как у вида', `Обычная иконка слоя «${LAYER_KINDS[l.kind].name}»`, () => { lyClosePop(); lySet(l, { icon: undefined }); });
  def.disabled = !l.icon;
  acts.append(def);
  pop.append(acts);
  lyPlacePop(pop, anchor);
}

// Своя иконка из файла: уменьшаем до 64×64 PNG и храним в настройках слоя (сам файл не трогаем)
async function lyIconFile(l) {
  lyClosePop();
  const [f] = await window.api.pickFile({ kinds: ['image'], title: 'Своя иконка слоя (PNG, SVG)' });
  if (!f) return;
  const src = await window.api.loadImage(f.path);
  if (!src) { showNotice('Не удалось открыть картинку для иконки', true); return; }
  const img = new Image();
  img.onload = () => {
    const S = 64;
    const w0 = img.naturalWidth || S, h0 = img.naturalHeight || S;
    const k = Math.min(S / w0, S / h0);
    const c = Object.assign(document.createElement('canvas'), { width: S, height: S });
    c.getContext('2d').drawImage(img, (S - w0 * k) / 2, (S - h0 * k) / 2, w0 * k, h0 * k);
    lySet(l, { icon: c.toDataURL('image/png') });
    flashStatus(`Слой «${layerName(l)}»: своя иконка`);
  };
  img.onerror = () => showNotice('Не удалось открыть картинку для иконки', true);
  img.src = src;
}

const lyTakes = (k) => k.takes.map((t) => ({ live: 'камеры, NDI, захват экрана', image: 'фото', video: 'видео', text: 'песни, Библия, текст', custom: 'свои слайды' })[t]).join(', ');

// Поменять свойство слоя: запомнить, отправить окну вывода и предпросмотру
function lySet(l, patch) {
  Object.assign(l, patch);
  saveSettings();
  sendLayers();
  if ('hidden' in patch) layersChanged(); else renderLayers();
}

/* ----- Настройки слоя: маленькое окошко рядом с кнопкой ----- */

let lyPop = null;
function lyClosePop() { if (lyPop) { lyPop.remove(); lyPop = null; } }

function lyOpenPop(l, anchor) {
  const again = lyPop && lyPop.dataset.id === l.id;
  lyClosePop();
  if (again) return;
  const k = LAYER_KINDS[l.kind];
  const pop = Object.assign(document.createElement('div'), { className: 'ly-pop' });
  pop.dataset.id = l.id;
  pop.append(Object.assign(document.createElement('div'), { className: 't', textContent: layerName(l) }));
  const slider = (name, key, def) => {
    const lab = document.createElement('label');
    const r = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, value: Math.round((l[key] != null ? l[key] : def) * 100) });
    r.dataset.def = Math.round(def * 100); // двойной щелчок — по умолчанию
    const o = Object.assign(document.createElement('output'), { textContent: r.value + '%' });
    r.addEventListener('input', () => { o.textContent = r.value + '%'; l[key] = r.value / 100; sendLayers(); });
    r.addEventListener('change', saveSettings);
    lab.append(document.createTextNode(name), r, o);
    pop.append(lab);
  };
  slider('Прозрачность', 'opacity', 1);
  if (k.sound) slider('Громкость', 'volume', 1);
  const defs = layerDefs();
  const i = defs.indexOf(l);
  // Пункты меню — столбиком, видны всегда (не класс .row: он прячет кнопки до наведения)
  const items = Object.assign(document.createElement('div'), { className: 'ly-items' });
  const item = (icon, text, title, fn, cls) => { const b = lyButton('', title, fn, cls); b.append(lyIcon(icon), document.createTextNode(text)); items.append(b); return b; };
  item('up', 'Переместить выше', 'Поднять слой над соседним', () => lyMove(l, 1)).disabled = i === defs.length - 1;
  item('down', 'Переместить ниже', 'Опустить слой под соседний', () => lyMove(l, -1)).disabled = i === 0;
  item('add', 'Добавить слой', 'Новый слой над этим — выберите вид ниже', () => lyAdd(l, l.kind));
  // Вид нового слоя: любой, сколько угодно (Медиа 2, Презентации 3…)
  const kinds = Object.assign(document.createElement('div'), { className: 'ly-kinds' });
  kinds.append(...Object.entries(LAYER_KINDS).map(([kind, x]) => lyButton(x.name, `Добавить слой «${x.name}» над этим`, () => lyAdd(l, kind))));
  items.append(kinds);
  item('editor', 'Переименовать…', 'Своё название слоя', () => lyRename(l));
  item('theme', 'Иконка…', 'Выбрать значок слоя или свою картинку', () => lyIconPick(l, anchor));
  const del = item('trash', 'Удалить слой', 'Убрать этот слой (последний слой своего вида убрать нельзя)', () => lyRemove(l), 'danger');
  del.disabled = defs.filter((x) => x.kind === l.kind).length < 2;
  pop.append(items);
  pop.append(Object.assign(document.createElement('div'), { className: 'hint', textContent: `Сюда само попадает: ${lyTakes(k)}. Любой пункт можно отправить в другой слой: кнопка «Авто» у пункта в «Содержании» или в ленте.` }));
  lyPlacePop(pop, anchor);
}

// Показать окошко у кнопки (снизу, а если не влезает — сверху)
function lyPlacePop(pop, anchor) {
  Icons.apply(pop);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(r.right - w.width, window.innerWidth - w.width - 6)) + 'px';
  pop.style.top = Math.max(6, r.bottom + w.height + 6 > window.innerHeight ? r.top - w.height - 4 : r.bottom + 4) + 'px';
  lyPop = pop;
}

function lyMove(l, d) {
  const defs = layerDefs();
  const i = defs.indexOf(l);
  const j = i + d;
  if (j < 0 || j >= defs.length) return;
  [defs[i], defs[j]] = [defs[j], defs[i]];
  lyClosePop();
  lySet(l, {});
  layersChanged();
}

// Новый слой вида kind над слоем l (без l — наверх); имя «Медиа 2», «Медиа 3»… без повторов
function lyAdd(l, kind) {
  const defs = layerDefs();
  const base = LAYER_KINDS[kind].name;
  const names = new Set(defs.map(layerName));
  let n = defs.filter((x) => x.kind === kind).length + 1;
  while (names.has(`${base} ${n}`)) n++;
  const nl = { id: kind + '-' + newId(), kind, name: `${base} ${n}` };
  defs.splice(l ? defs.indexOf(l) + 1 : defs.length, 0, nl);
  lyClosePop();
  lySet(nl, {});
  flashStatus(`Добавлен слой «${nl.name}». Отправить в него пункт — кнопка «Авто» у пункта`);
}

async function lyRename(l) {
  lyClosePop();
  const name = await askName('Название слоя', layerName(l));
  if (!name) return;
  lySet(l, { name });
  if (typeof renderService === 'function') renderService(); // имя слоя на кнопках пунктов
}

// «＋» в шапке панели: добавить слой любого вида наверх
$('lyAdd').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu({ clientX: r.left, clientY: r.bottom + 2 }, Object.entries(LAYER_KINDS).map(([kind, x]) => ({ label: `Слой «${x.name}»`, fn: () => lyAdd(null, kind) })));
});

function lyRemove(l) {
  const defs = layerDefs();
  if (defs.filter((x) => x.kind === l.kind).length < 2) return;
  clearLayer(l.id, true);
  defs.splice(defs.indexOf(l), 1);
  lyClosePop();
  saveSettings();
  sendLayers();
  layersChanged();
  if (typeof renderService === 'function') renderService(); // пункты с этим слоем — снова «Авто»
  flashStatus(`Слой «${layerName(l)}» удалён`);
}

$('lyClearAll').addEventListener('click', () => lyClearAllAsk('head'));
window.addEventListener('pointerdown', (e) => { if (lyPop && !lyPop.contains(e.target) && !e.target.closest('.ly-row, .ly-rail')) lyClosePop(); }, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lyPop) { lyClosePop(); e.stopPropagation(); } }, true);

renderLayers();
