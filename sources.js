/* ===== Медиапул → «Источники»: камеры, карты захвата, экраны и окна, звук, NDI =====
   Кнопка «Источники» слева под «Файлами» открывает отдельный раздел вместо файлов: слева все источники по видам,
   справа живое превью, уровень звука, «На экран», «В плейлист». Назад — кнопка «Файлы».
   Источник: { type, id, label, kind (подпись), audio?, thumb?, noAdd? (почему нельзя показать) }.
   Новый вид источника — строка в SOURCE_KINDS (как найти) и в Scene.LIVE (как открыть поток);
   в плейлист он попадает слайдом { k: 'live', src } — кнопкой или перетаскиванием строки. */

// Карты видеозахвата видны Windows как камеры — различаем по названию
const CAPTURE_RE = /capture|cam ?link|elgato|avermedia|magewell|blackmagic|decklink|hdmi|ezcap|uvc|usb video|game ?capture|захват/i;

const SOURCE_KINDS = [
  { type: 'camera', title: 'Камеры и карты захвата', icon: 'camera', find: findCameras },
  { type: 'screen', title: 'Экраны и окна компьютера', icon: 'screen', find: findScreens },
  { type: 'mic', title: 'Звук: микрофоны и входы', icon: 'mic', find: findMics },
  { type: 'system', title: 'Звук компьютера', icon: 'audio', find: async () => [{ type: 'system', id: '', label: 'Звук компьютера', kind: 'Всё, что сейчас играет в Windows', audio: true, noAdd: 'Звук компьютера — только для проверки уровня: на выводе он дал бы эхо' }] },
  { type: 'ndi', title: 'NDI в локальной сети', icon: 'web', find: findNdi },
  { type: 'cast', title: 'Экран телефона (AirPlay, Miracast)', icon: 'cast', find: () => findCast(true) },
];

// Повтор экрана с телефона/компьютера (cast.js): строка есть всегда — её можно заранее положить в плейлист,
// картинка появится, когда кто-то подключится
async function findCast(again) {
  const api = window.api;
  if (!api.castState) return [];
  const st = await api.castState(!!again); // again — искать UxPlay и «Беспроводной дисплей» заново
  const a = st.airplay;
  const m = st.miracast;
  return [
    {
      type: 'cast', id: 'airplay', label: 'AirPlay — iPhone, iPad, Mac',
      kind: !a.found ? 'Не установлен UxPlay' : a.error ? 'Ошибка: ' + a.error : a.ready ? `Показывает: ${a.name || 'устройство Apple'}` : `Ждём: «Повтор экрана» → ${st.name}`,
      noAdd: a.found ? '' : 'Для AirPlay положите UxPlay (uxplay.exe) в папку программы → uxplay\\ и установите Bonjour от Apple, затем «↻ Найти»',
    },
    {
      type: 'cast', id: 'miracast', label: 'Miracast — Android, Windows (Win+K)',
      kind: !m.found ? 'Не включён «Беспроводной дисплей» Windows' : m.ready ? 'Показывает экран' : 'Ждём: «Трансляция»/Smart View → имя этого компьютера',
      noAdd: m.found ? '' : 'Включите в Windows: Параметры → Система → Дополнительные компоненты → «Беспроводной дисплей», затем Параметры → Система → «Проецирование на этот компьютер» → «Доступно везде», и «↻ Найти»',
    },
  ];
}

// Телефон подключился/отключился: уведомление (системное — в cast.js), список обновляется
if (window.api.onCastEvent) {
  window.api.onCastEvent((m) => {
    if (m.notice) flashStatus(m.notice);
    if (!$('srcPane').hidden && !$('pool').hidden && (m.ready || m.on === false || m.state)) {
      findCast().then((list) => { srcFound.cast = list; renderSrcList(); }, () => {});
    }
  });
}
// Щелчок по уведомлению Windows — открыть Медиапул → Источники
if (window.api.onCastOpen) {
  window.api.onCastOpen(() => {
    if ($('pool').hidden) togglePool();
    if ($('srcPane').hidden) setSrcMode(true);
  });
}

let srcFound = {};   // вид → список источников (нет ключа — ещё ищем)
let srcSel = null;   // выбранный источник
let srcAsked = false;
const srcKey = (s) => s.type + ':' + s.id;

// Названия устройств Windows отдаёт только после первого разрешения — один раз коротко открываем и сразу закрываем
async function mediaDevices(kind) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  let list = await navigator.mediaDevices.enumerateDevices();
  if (!srcAsked && list.some((d) => !d.label)) {
    srcAsked = true;
    for (const c of [{ video: true, audio: true }, { audio: true }, { video: true }]) {
      try { (await navigator.mediaDevices.getUserMedia(c)).getTracks().forEach((t) => t.stop()); break; } catch { /* такого устройства нет */ }
    }
    list = await navigator.mediaDevices.enumerateDevices();
  }
  // «По умолчанию» и «Связь» — те же устройства ещё раз
  return list.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
}

async function findCameras() {
  return (await mediaDevices('videoinput')).map((d, i) => ({
    type: 'camera', id: d.deviceId, label: d.label || `Камера ${i + 1}`, kind: CAPTURE_RE.test(d.label) ? 'Карта видеозахвата (USB)' : 'Веб-камера',
  }));
}

async function findMics() {
  return (await mediaDevices('audioinput')).map((d, i) => ({
    type: 'mic', id: d.deviceId, label: d.label || `Вход звука ${i + 1}`, audio: true,
    kind: /stereo mix|стерео ?микшер|line|линейн/i.test(d.label) ? 'Линейный вход' : CAPTURE_RE.test(d.label) ? 'Звук карты захвата' : 'Микрофон',
  }));
}

async function findScreens() {
  const list = window.api.sourcesScreens ? (await window.api.sourcesScreens()) || [] : [];
  const screens = list.filter((s) => s.kind === 'screen');
  return list.map((s) => ({
    type: 'screen', id: s.id, label: s.kind === 'screen' ? (screens.length > 1 ? `Экран ${screens.indexOf(s) + 1}` : 'Весь экран') : s.name,
    kind: s.kind === 'screen' ? 'Экран компьютера' : 'Окно программы', thumb: s.thumb,
  }));
}

// Есть NDI Tools (NDI Runtime) — ищем и показываем через них; нет — только имена из сети (mDNS)
async function findNdi() {
  const api = window.api;
  const real = api.ndiFind && Scene.LIVE.ndi ? await api.ndiFind() : null;
  if (Array.isArray(real)) {
    return real.map((s) => ({ type: 'ndi', id: s.name, label: s.name, kind: 'NDI' + (s.url ? ' · ' + s.url.split(':')[0] : ''), audio: true }));
  }
  const list = api.sourcesNdi ? (await api.sourcesNdi()) || [] : [];
  return list.map((s) => ({
    type: 'ndi', id: s.name, label: s.name, kind: 'NDI · ' + s.host,
    noAdd: 'Для показа NDI установите бесплатные NDI Tools (ndi.video) и перезапустите программу',
  }));
}

// Найти всё заново; каждый вид появляется в списке, как только найден
function srcRefresh() {
  srcFound = {};
  renderSrcList();
  for (const k of SOURCE_KINDS) {
    k.find().then((list) => list, () => []).then((list) => {
      srcFound[k.type] = list;
      if (srcSel && srcSel.type === k.type && !list.some((s) => s.id === srcSel.id)) srcPick(null);
      renderSrcList();
    });
  }
}

function renderSrcList() {
  const box = $('srcList');
  box.replaceChildren();
  for (const k of SOURCE_KINDS) {
    const list = srcFound[k.type];
    const head = Object.assign(document.createElement('div'), { className: 'src-group' });
    head.append(Icons.el(k.icon), document.createTextNode(k.title), Object.assign(document.createElement('span'), { className: 'n', textContent: list ? `· ${list.length}` : '· ищем…' }));
    box.append(head);
    if (list && !list.length) box.append(Object.assign(document.createElement('div'), { className: 'src-empty', textContent: k.type === 'ndi' ? 'Не найдено — включите выход NDI в программе-источнике и нажмите «↻ Найти»' : 'Не найдено' }));
    for (const s of list || []) box.append(srcRow(s, k.icon));
  }
}

function srcRow(s, icon) {
  const canUse = !s.noAdd && s.type !== 'system';
  const row = Object.assign(document.createElement('div'), {
    className: 'src-row' + (s.noAdd ? ' off' : ''), tabIndex: 0, draggable: canUse,
    title: s.noAdd || `${s.label}\nДвойной щелчок — на экран, перетащите — в плейлист`,
  });
  row.classList.toggle('cur', !!srcSel && srcKey(srcSel) === srcKey(s));
  row.append(s.thumb ? Object.assign(document.createElement('img'), { src: s.thumb, alt: '' }) : Icons.el(icon));
  const t = Object.assign(document.createElement('div'), { className: 't' });
  t.append(Object.assign(document.createElement('b'), { textContent: s.label }), Object.assign(document.createElement('small'), { textContent: s.kind }));
  row.append(t);
  row.addEventListener('click', () => srcPick(s));
  row.addEventListener('dblclick', () => srcShow(s));
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') srcShow(s); });
  // Перетащить в плейлист, библиотеку или ленту — встанет туда, куда бросили (playlist.js: dropList)
  row.addEventListener('dragstart', (e) => {
    if (!canUse) { e.preventDefault(); return; }
    e.dataTransfer.setData(SOURCE_DT, JSON.stringify({ type: s.type, id: s.id, label: s.label }));
    e.dataTransfer.setData('text/plain', s.label);
    e.dataTransfer.effectAllowed = 'copy';
    const tag = Object.assign(document.createElement('div'), { className: 'drag-tag', textContent: '● ' + s.label });
    document.body.append(tag);
    e.dataTransfer.setDragImage(tag, 12, 12);
    requestAnimationFrame(() => tag.remove());
    document.body.classList.add('bible-dragging'); // та же подсветка мест, куда можно бросить
  });
  return row;
}

/* ----- Превью выбранного: живая картинка и уровень звука ----- */

let meter = null; // { node, raf }

function srcStopPreview() {
  Scene.clear($('srcView'));
  if (meter) {
    cancelAnimationFrame(meter.raf);
    try { meter.node.disconnect(); } catch { /* уже отключён */ }
    meter = null;
  }
  Scene.liveRelease($('srcMeter'));
  $('srcMeter').hidden = true;
}

function srcPick(s) {
  srcSel = s;
  srcStopPreview();
  renderSrcList();
  $('srcShow').disabled = $('srcAdd').disabled = !s || !!s.noAdd || s.type === 'system';
  $('srcInfo').textContent = !s ? 'Выберите источник слева' : s.noAdd || `${s.kind}: ${s.label}`;
  if (!s) return;
  // Miracast: Windows 11 принимает, только пока открыт «Беспроводной дисплей» — открываем
  if (s.type === 'cast' && s.id === 'miracast' && !s.noAdd && !/Показывает/.test(s.kind) && window.api.castMiracast) {
    window.api.castMiracast();
    $('srcInfo').textContent = 'Открыт «Беспроводной дисплей» — на телефоне: «Трансляция»/Smart View → имя этого компьютера';
  }
  if (s.type !== 'system') Scene.show($('srcView'), { type: 'live', src: s, fit: 'contain', sound: false });
  if (s.audio) startMeter(s);
}

let srcCtx = null;
const audioCtx = () => (srcCtx = srcCtx || new AudioContext());

function startMeter(s) {
  const el = $('srcMeter');
  el.hidden = false;
  el.firstElementChild.style.width = '100%';
  Scene.liveStream(s, el).then((st) => {
    if (srcSel !== s || !st.getAudioTracks().length) return;
    const ctx = audioCtx();
    ctx.resume().catch(() => {});
    const node = ctx.createMediaStreamSource(st);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    node.connect(an);
    const buf = new Float32Array(an.fftSize);
    meter = { node, raf: 0 };
    let shown = 0;
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      // Децибелы: −60 дБ — пусто, 0 дБ — до конца; спадает плавно
      const lvl = peak > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(peak) + 60) / 60)) : 0;
      shown = Math.max(lvl, shown - 0.02);
      el.firstElementChild.style.width = ((1 - shown) * 100).toFixed(1) + '%';
      meter.raf = requestAnimationFrame(tick);
    };
    tick();
  }, () => { if (srcSel === s) $('srcInfo').textContent = `«${s.label}» не открывается — проверьте подключение`; });
}

/* ----- Использовать источник: на экран или в плейлист обычным слайдом ----- */

const srcSlide = (s) => ({ id: newId(), k: 'live', src: { type: s.type, id: s.id, label: s.label }, name: s.label });

function srcShow(s) {
  if (!s || s.noAdd || s.type === 'system') { if (s && s.noAdd) flashStatus(s.noAdd); return; }
  const slide = srcSlide(s);
  live = -1;
  bShown = null;
  plShown = null;
  present(() => Slides.content(slide, styleOf('media'), { fit: settings.fit }), s.label);
}

// Источник — отдельной презентацией в плейлист/библиотеку x (перед пунктом beforeKey или в конец)
function srcPut(s, kind, x, beforeKey) {
  if (!s || !s.type || !x) return false;
  const it = { id: newId(), type: 'pres', kind: 'media', name: s.label || 'Источник', slides: [srcSlide(s)] };
  lib.items[it.id] = it;
  putItem(kind, x, it.id, beforeKey);
  saveLib();
  renderService();
  flashStatus(`Источник «${it.name}» → «${x.name}»`);
  return true;
}

function srcAdd(s) {
  if (!s || s.noAdd) { if (s) flashStatus(s.noAdd); return; }
  const v = lib ? findView() : null;
  if (!v) { showNotice('Сначала создайте плейлист: «＋» у «Плейлистов» слева', true); return; }
  srcPut(s, lib.view.kind, v, null);
}

/* ----- Плавающее окошко «Предпросмотр» (правая кнопка по источнику в плейлисте) -----
   Одно на всю программу: повторный вызов только меняет источник. Экран и основной «Предпросмотр» не трогает. */

function srcPopup(src, e) {
  if (!src) return;
  popOpen('src:' + srcKey(src), src.label || 'Источник', { type: 'live', src, fit: 'contain', sound: false }, e);
}

// То же окошко для любого содержимого (файл из медиапула); key — что показано, acts — кнопки [{ text, title, fn }]
function popOpen(key, name, content, e, acts) {
  const pop = $('srcPop');
  const stage = $('srcPopStage');
  const same = !pop.hidden && pop._key === key;
  pop._key = key;
  $('srcPopName').textContent = name;
  $('srcPopName').title = name;
  $('srcPopActs').replaceChildren(...(acts || []).map((a) => {
    const b = Object.assign(document.createElement('button'), { textContent: a.text, title: a.title || '' });
    b.addEventListener('click', a.fn);
    return b;
  }));
  if (pop.hidden) {
    // Возле мыши, но целиком в окне
    pop.hidden = false;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const x = e && e.clientX != null ? e.clientX + 12 : (innerWidth - w) / 2;
    const y = e && e.clientY != null ? e.clientY + 12 : (innerHeight - h) / 2;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px';
    pop.style.top = Math.max(8, Math.min(innerHeight - h - 8, y)) + 'px';
  }
  if (!same) { Scene.clear(stage); Scene.show(stage, content); }
}

function srcPopClose() {
  const pop = $('srcPop');
  if (pop.hidden) return;
  pop.hidden = true;
  pop._key = null;
  Scene.clear($('srcPopStage')); // поток закрывается, если его больше никто не показывает
}

$('srcPopX').addEventListener('click', srcPopClose);
// Щелчок мимо окошка — закрыть (но работать с плейлистом это окошко не мешает)
document.addEventListener('pointerdown', (e) => { if (!$('srcPop').hidden && !$('srcPop').contains(e.target)) srcPopClose(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') srcPopClose(); });
// Перетаскивание окошка за заголовок
$('srcPop').querySelector('.pop-head').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  const pop = $('srcPop');
  const sx = e.clientX - pop.offsetLeft;
  const sy = e.clientY - pop.offsetTop;
  const head = e.currentTarget;
  head.setPointerCapture(e.pointerId);
  const move = (ev) => {
    pop.style.left = Math.max(0, Math.min(innerWidth - 60, ev.clientX - sx)) + 'px';
    pop.style.top = Math.max(0, Math.min(innerHeight - 30, ev.clientY - sy)) + 'px';
  };
  const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
  head.addEventListener('pointermove', move);
  head.addEventListener('pointerup', up);
});

/* ----- Открыть и закрыть раздел ----- */

function setSrcMode(on) {
  settings.poolSrc = on;
  saveSettings();
  $('pool').classList.toggle('src-mode', on);
  $('srcPane').hidden = !on;
  // Ищем, только когда раздел виден: поиск ненадолго включает камеру, чтобы узнать названия устройств
  if (on && !$('pool').hidden) srcRefresh();
  if (!on) srcPick(null);
}

$('poolSrc').addEventListener('click', () => setSrcMode(true));
$('srcBack').addEventListener('click', () => setSrcMode(false));
$('srcClose').addEventListener('click', togglePool);
$('srcRefresh').addEventListener('click', srcRefresh);
$('srcShow').addEventListener('click', () => srcShow(srcSel));
$('srcAdd').addEventListener('click', () => srcAdd(srcSel));
// Подключили или отключили камеру, карту захвата, микрофон — список обновляется сам
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => { if (!$('srcPane').hidden && !$('pool').hidden) srcRefresh(); });
}
// Медиапул закрыли (кнопкой или F8) — превью гасим, камера выключается
new MutationObserver(() => {
  if ($('pool').hidden) srcStopPreview();
  else if (!$('srcPane').hidden) { if (!Object.keys(srcFound).length) srcRefresh(); if (srcSel) srcPick(srcSel); }
}).observe($('pool'), { attributes: true, attributeFilter: ['hidden'] });

if (settings.poolSrc) setSrcMode(true);
