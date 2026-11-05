/* ===== Макросы (Node-Based Automation, как Node Editor в Fusion) =====
   Макрос — схема из нод, соединённых линиями. Хранится в lib.macros (library.json, входит в отмену Ctrl+Z):
     { id, name, enabled, key?, repeat: 'skip'|'restart'|'parallel', cooldown (мс), note?,
       nodes: [{ id, type, x, y, p: {параметры} }], links: [{ id, from: [nodeId, port], to: [nodeId, port] }],
       frames: [{ id, name, x, y, w, h }] — группы, notes: [{ id, text, x, y, w, h }] — комментарии }
   Ноды четырёх видов (+ значения): триггер запускает макрос, датчик отдаёт данные о программе, действие выполняет команду,
   логика ветвит и ждёт. Белые точки — порядок выполнения (exec), цветные — данные. Один выход exec на несколько нод —
   они идут параллельно; цепочка — по очереди. Новая нода — Macros.register('тип', { … }) (см. MC_NODES ниже).
   Привязка: макрос перетаскивают на слайд, пункт плейлиста, песню, часть песни или файл медиапула —
   slide.macros, item.macros, entry.macros, item.partMacros[часть], lib.fileMacros[путь]; макрос получает триггер «При запуске привязанного».
   Защита: цепочка макросов не вызывает сама себя (mcFire), не глубже MC_DEPTH, не больше MC_STEPS шагов,
   повтор того же триггера чаще cooldown — пропускается, уже идущий макрос — по правилу repeat. */

const MC_DT = 'application/x-cp-macro';     // перетаскивание макроса (из списка или панели) на слайд и т. п.
const MC_NODE_DT = 'application/x-cp-mcnode'; // нода из библиотеки на холст
const MC_DEPTH = 8;
const MC_STEPS = 5000;

const MC_CATS = {
  trigger: { name: 'Триггеры', icon: 'trigger', hint: 'Запускают макрос' },
  sensor: { name: 'Датчики', icon: 'sensor', hint: 'Узнают, что сейчас в программе' },
  action: { name: 'Действия', icon: 'show', hint: 'Выполняют команды' },
  logic: { name: 'Логика', icon: 'logic', hint: 'Условия, задержки, повторы' },
  value: { name: 'Значения', icon: 'value', hint: 'Число, текст, да/нет' },
};
// Подсказка в свойствах ноды: как пользоваться нодой этого вида
const MC_CAT_TIPS = {
  trigger: 'Как работает: макрос начинается отсюда, когда это случится. Белую точку справа соедините с первым действием.',
  sensor: 'Как работает датчик: сам не запускается и ничего не меняет — только отвечает, что на экране в эту секунду. Соедините его выход (точка справа) с входом «Если», «Сравнить» или действия.',
  action: 'Как работает: выполняется, когда до него дошла белая линия. Дальше — по белой точке справа.',
  logic: 'Как работает: решает, куда идти дальше (Да/Нет), ждёт или повторяет. Условие подаётся цветной линией от датчика.',
  value: 'Как работает: просто значение. Соедините с входом другой ноды.',
};
const MC_PIN_NAMES ={ exec: 'порядок', bool: 'да/нет', num: 'число', str: 'текст', any: 'любое' };

/* ----- Значения: всё переводится друг в друга, чтобы любой выход можно было подать на любой вход ----- */
const mcBool = (v) => (typeof v === 'string' ? !!v.trim() && !/^(нет|false|0|no)$/i.test(v.trim()) : !!v);
const mcNum = (v) => (typeof v === 'boolean' ? +v : Number(String(v == null ? '' : v).replace(',', '.')) || 0);
const mcStr = (v) => (v == null ? '' : typeof v === 'boolean' ? (v ? 'да' : 'нет') : String(v));

/* ----- Списки для параметров ----- */
const mcItems = (pred) => (lib ? Object.values(lib.items).filter((it) => !pred || pred(it)).sort((a, b) => a.name.localeCompare(b.name, 'ru')) : []);
const mcItemOpts = (pred, none) => [['', none || '— выберите —'], ...mcItems(pred).map((it) => [it.id, `${it.name} · ${Slides.PRES_NAMES[it.kind] || 'Презентация'}`])];
const mcSongOpts = (none) => [['', none || 'Любая песня'], ...mcItems((it) => !!it.song || it.kind === 'song').map((it) => [it.id, it.name])];
const mcThemeOpts = (none) => [['', none || '— выберите —'], ...(lib ? Themes.all(appliedThemes()) : []).map((t) => [t.id, t.name])];
const mcLayerOpts = (none) => [['', none], ...layerDefs().slice().reverse().map((l) => [l.id, layerName(l)])];
const mcPlOpts = (none) => [['', none], ...(lib ? lib.playlists.map((p) => [p.id, p.name]) : [])];
const mcMacroOpts = () => [['', '— выберите —'], ...(lib && lib.macros ? lib.macros.map((m) => [m.id, m.name]) : [])];
const mcLiveOpts = () => [['', '— выберите —'], ...mcItems((it) => it.slides.some((s) => s.k === 'live')).flatMap((it) => it.slides.filter((s) => s.k === 'live').map((s) => [it.id + ':' + s.id, s.name || it.name]))];
const mcActOpts = () => [['', '— выберите —'], ...ACTIONS.flatMap(([g, list]) => list.filter(([id]) => id !== 'undo' && id !== 'redo').map(([id, label]) => [id, `${g}: ${label}`]))];
const mcBibleOpts = () => [['', '— выберите —'], ...bibleIndex.map((b) => [b.id, b.name])];
const MC_KIND_SLIDE = [['', 'Любой'], ['text', 'Песня / текст'], ['bible', 'Библия'], ['image', 'Картинка'], ['video', 'Видео'], ['custom', 'Свой слайд'], ['live', 'Источник'], ['audio', 'Музыка']];
const MC_THEME_KINDS = [['song', 'Песни'], ['bible', 'Библия'], ['media', 'Картинки и видео'], ['custom', 'Свои слайды']];
const mcOptName = (opts, v) => { const o = (typeof opts === 'function' ? opts() : opts).find((x) => x[0] === v); return o ? o[1] : ''; };

/* ----- Что сейчас на экране (для датчиков) ----- */
function mcShown() {
  if (!plShown || !lib) return null;
  const x = entryByKey(plShown.key, keyView(plShown.view));
  const slide = x && x.item.slides.find((s) => s.id === plShown.sid);
  return slide ? { x, item: x.item, slide, index: x.item.slides.indexOf(slide), total: x.item.slides.length } : null;
}
// Части песни по порядку показа: [{ part, occ }]; где сейчас и последняя ли
function mcParts(item, slide) {
  const seq = [];
  for (const s of item.slides) {
    if (s.part === undefined || s.k !== 'text') continue;
    const last = seq[seq.length - 1];
    if (!last || last.part !== s.part || last.occ !== s.occ) seq.push({ part: s.part, occ: s.occ });
  }
  const i = slide ? seq.findIndex((x) => x.part === slide.part && x.occ === slide.occ) : -1;
  return { seq, index: i, count: seq.length, last: i >= 0 && i === seq.length - 1, lastName: seq.length ? seq[seq.length - 1].part : '' };
}
const mcSlideText = (s) => (s.k === 'text' ? s.text || '' : s.k === 'bible' ? (s.verses || []).map((v) => v.t).join(' ') : s.name || '');

/* ===== Ноды: реестр. Описание ноды:
   { cat, name, icon?, help, params: [{ id, name, t, def, opts, show(p) }], ins/outs: [{ id, name, t }] или функция (p) → список,
     on: [события] и match(p, ev) — для триггеров, out(ev, p) — данные триггера, eval(c, p, inp) — датчики и логика без порядка,
     run(c, p, inp) — действия и логика: вернуть id выхода exec (или список, или null — дальше не идти),
     sum(p) — короткая подпись на ноде, preview(p) — что показать в тестовом режиме, safe — выполнять и в тесте }
   Типы параметров: text, area, num, check, select (opts), key, file (kinds). Вход данных с тем же id, что параметр, —
   если к нему ничего не подключено, берётся значение параметра. */
const MC_NODES = {};
const Macros = {
  NODES: MC_NODES,
  // Подключить свою ноду (плагин): Macros.register('my.node', { cat: 'action', name: '…', run(c, p, inp) { … } })
  register(type, def) {
    if (!MC_CATS[def.cat]) throw new Error('Неизвестный вид ноды: ' + def.cat);
    MC_NODES[type] = { params: [], ins: [], outs: [], ...def };
    if (typeof mcRenderLib === 'function' && $('mcLib')) mcRenderLib();
  },
};
const R = Macros.register;
const EXEC_IN = [{ id: 'in', name: '', t: 'exec' }];
const EXEC_OUT = [{ id: 'out', name: '', t: 'exec' }];
const fileName = (p) => String(p || '').split(/[\\/]/).pop();

/* ----- Триггеры ----- */
R('trig.manual', { cat: 'trigger', name: 'Ручной запуск', icon: 'show', help: 'Кнопка «Запустить», горячая клавиша макроса или нода «Запустить макрос» из другого макроса.', on: ['manual'], outs: EXEC_OUT });
R('trig.key', {
  cat: 'trigger', name: 'Горячая клавиша', icon: 'keys', help: 'Срабатывает по сочетанию клавиш (в полях ввода — только с Ctrl/Alt или F1–F12). Макрос сильнее команды программы с тем же сочетанием.',
  params: [{ id: 'key', name: 'Сочетание', t: 'key', def: '' }], on: ['key'], match: (p, ev) => !!p.key && p.key === ev.combo,
  outs: EXEC_OUT, sum: (p) => (p.key ? prettyCombo(p.key) : 'не задано'),
});
R('trig.bound', {
  cat: 'trigger', name: 'При запуске привязанного', icon: 'macro',
  help: 'Срабатывает, когда показан объект, к которому привязан макрос: перетащите макрос на слайд, пункт плейлиста, песню, часть песни или файл медиапула.',
  on: [], outs: [...EXEC_OUT, { id: 'name', name: 'Название', t: 'str' }, { id: 'label', name: 'Подпись слайда', t: 'str' }],
  out: (ev) => ({ name: ev.name || '', label: ev.label || '' }),
});
const SLIDE_OUTS = [...EXEC_OUT, { id: 'name', name: 'Презентация', t: 'str' }, { id: 'label', name: 'Подпись', t: 'str' }, { id: 'text', name: 'Текст', t: 'str' }, { id: 'index', name: 'Номер', t: 'num' }, { id: 'total', name: 'Всего', t: 'num' }];
const slideOut = (ev) => ({ name: ev.name || '', label: ev.label || '', text: ev.text || '', index: (ev.index || 0) + 1, total: ev.total || 0 });
R('trig.slide', {
  cat: 'trigger', name: 'Запуск слайда', icon: 'slides', help: 'Любой показанный слайд из плейлиста или библиотеки (можно ограничить видом, презентацией, подписью).',
  params: [
    { id: 'kind', name: 'Вид слайда', t: 'select', opts: MC_KIND_SLIDE, def: '' },
    { id: 'item', name: 'Презентация', t: 'item', none: 'Любая', opts: () => mcItemOpts(null, 'Любая'), def: '' },
    { id: 'label', name: 'Подпись содержит', t: 'text', def: '' },
  ],
  on: ['slide'], match: (p, ev) => (!p.kind || ev.kind === p.kind) && (!p.item || ev.itemId === p.item) && (!p.label || (ev.label || '').toLowerCase().includes(p.label.toLowerCase())),
  outs: SLIDE_OUTS, out: slideOut,
  sum: (p) => [mcOptName(MC_KIND_SLIDE, p.kind || ''), p.item && mcOptName(() => mcItemOpts(), p.item).split(' · ')[0], p.label && `«${p.label}»`].filter(Boolean).join(' · '),
});
R('trig.song', {
  cat: 'trigger', name: 'Запуск песни', icon: 'music', help: 'Показан первый слайд песни (перешли на неё с другого пункта).',
  params: [{ id: 'song', name: 'Песня', t: 'item', pred: (it) => !!it.song || it.kind === 'song', none: 'Любая песня', opts: () => mcSongOpts(), def: '' }],
  on: ['song'], match: (p, ev) => !p.song || ev.itemId === p.song,
  outs: [...EXEC_OUT, { id: 'name', name: 'Песня', t: 'str' }, { id: 'number', name: 'Номер', t: 'str' }, { id: 'genre', name: 'Жанр', t: 'str' }],
  out: (ev) => ({ name: ev.name, number: (ev.item && ev.item.song && ev.item.song.number) || '', genre: (ev.item && ev.item.song && ev.item.song.genre) || '' }),
  sum: (p) => mcOptName(() => mcSongOpts(), p.song || ''),
});
R('trig.part', {
  cat: 'trigger', name: 'Переход к части', icon: 'parts', help: 'Песня перешла к части: «Припев», «Куплет 2»… Пусто — к любой. Срабатывает на первом слайде части.',
  params: [{ id: 'part', name: 'Часть (начинается с)', t: 'text', def: 'Припев' }, { id: 'song', name: 'Песня', t: 'item', pred: (it) => !!it.song || it.kind === 'song', none: 'Любая песня', opts: () => mcSongOpts(), def: '' }],
  on: ['part'], match: (p, ev) => (!p.song || ev.itemId === p.song) && (!p.part || (ev.part || '').toLowerCase().startsWith(p.part.toLowerCase())),
  outs: [...EXEC_OUT, { id: 'part', name: 'Часть', t: 'str' }, { id: 'occ', name: 'Повтор №', t: 'num' }, { id: 'name', name: 'Песня', t: 'str' }],
  out: (ev) => ({ part: ev.part, occ: ev.occ, name: ev.name }),
  sum: (p) => (p.part ? `«${p.part}»` : 'любая часть'),
});
R('trig.lastPart', {
  cat: 'trigger', name: 'Последняя часть аранжировки', icon: 'arrange', help: 'Начался последний элемент аранжировки песни.',
  params: [{ id: 'song', name: 'Песня', t: 'item', pred: (it) => !!it.song || it.kind === 'song', none: 'Любая песня', opts: () => mcSongOpts(), def: '' }],
  on: ['lastPart'], match: (p, ev) => !p.song || ev.itemId === p.song,
  outs: [...EXEC_OUT, { id: 'part', name: 'Часть', t: 'str' }, { id: 'name', name: 'Песня', t: 'str' }], out: (ev) => ({ part: ev.part, name: ev.name }),
});
R('trig.presEnd', {
  cat: 'trigger', name: 'Завершение презентации', icon: 'done', help: '«Последний слайд» — показан последний слайд; «Ушли» — после последнего слайда перешли к другому пункту.',
  params: [{ id: 'mode', name: 'Когда', t: 'select', opts: [['last', 'Показан последний слайд'], ['leave', 'Ушли после последнего']], def: 'last' }, { id: 'item', name: 'Презентация', t: 'item', none: 'Любая', opts: () => mcItemOpts(null, 'Любая'), def: '' }],
  on: ['presLast', 'presEnd'], match: (p, ev, type) => (type === ((p.mode || 'last') === 'leave' ? 'presEnd' : 'presLast')) && (!p.item || ev.itemId === p.item),
  outs: [...EXEC_OUT, { id: 'name', name: 'Презентация', t: 'str' }], out: (ev) => ({ name: ev.name }),
  sum: (p) => ((p.mode || 'last') === 'leave' ? 'ушли после последнего' : 'последний слайд'),
});
const MC_VIDEO_EVS = [['start', 'Новое видео на экране'], ['play', 'Пуск'], ['pause', 'Пауза'], ['ended', 'Видео закончилось']];
R('trig.video', {
  cat: 'trigger', name: 'Видео', icon: 'video', help: 'Запуск, пауза или окончание видео на экране.',
  params: [{ id: 'ev', name: 'Событие', t: 'select', opts: MC_VIDEO_EVS, def: 'ended' }],
  on: ['video'], match: (p, ev) => ev.ev === (p.ev || 'ended'),
  outs: [...EXEC_OUT, { id: 'name', name: 'Видео', t: 'str' }], out: (ev) => ({ name: ev.name || '' }), sum: (p) => mcOptName(MC_VIDEO_EVS, p.ev || 'ended'),
});
const MC_LAYER_EVS = [['on', 'Слой включился (был пуст)'], ['change', 'Любой показ в слое'], ['off', 'Слой очищен']];
R('trig.layer', {
  cat: 'trigger', name: 'Медиаслой', icon: 'layers', help: 'Что-то появилось в слое или слой очистили.',
  params: [{ id: 'layer', name: 'Слой', t: 'select', opts: () => mcLayerOpts('Любой'), def: '' }, { id: 'ev', name: 'Событие', t: 'select', opts: MC_LAYER_EVS, def: 'on' }],
  on: ['layer'], match: (p, ev) => (!p.layer || ev.layer === p.layer) && ({ on: ev.ev === 'show' && !ev.was, change: ev.ev === 'show', off: ev.ev === 'clear' })[p.ev || 'on'],
  outs: [...EXEC_OUT, { id: 'layer', name: 'Слой', t: 'str' }, { id: 'label', name: 'Что показано', t: 'str' }], out: (ev) => ({ layer: ev.name, label: ev.label || '' }),
  sum: (p) => `${p.layer ? mcOptName(() => mcLayerOpts(''), p.layer) : 'любой'} · ${mcOptName(MC_LAYER_EVS, p.ev || 'on')}`,
});
R('trig.plAdd', {
  cat: 'trigger', name: 'Добавлено в плейлист', icon: 'playlist', help: 'В плейлист добавили пункт (кнопкой, перетаскиванием, вставкой).',
  params: [{ id: 'pl', name: 'Плейлист', t: 'select', opts: () => mcPlOpts('Любой'), def: '' }],
  on: ['plAdd'], match: (p, ev) => !p.pl || ev.plId === p.pl,
  outs: [...EXEC_OUT, { id: 'name', name: 'Пункт', t: 'str' }, { id: 'pl', name: 'Плейлист', t: 'str' }], out: (ev) => ({ name: ev.name, pl: ev.plName }),
  sum: (p) => mcOptName(() => mcPlOpts('Любой'), p.pl || ''),
});
R('trig.bible', {
  cat: 'trigger', name: 'Показ стиха Библии', icon: 'bible', help: 'Место: «Ин 3:16», «Ин 3» (вся глава), «Пс» (вся книга). Пусто — любой стих. Срабатывает и в «Библии», и для слайдов Библии в плейлисте.',
  params: [{ id: 'ref', name: 'Место', t: 'text', def: '' }],
  on: ['bible'], match: (p, ev) => mcRefMatch(p.ref, ev),
  outs: [...EXEC_OUT, { id: 'ref', name: 'Место', t: 'str' }, { id: 'text', name: 'Текст', t: 'str' }], out: (ev) => ({ ref: ev.ref, text: ev.text || '' }),
  sum: (p) => p.ref || 'любой стих',
});
R('trig.media', {
  cat: 'trigger', name: 'Показ файла', icon: 'image', help: 'На экран вывели фото или видео (из медиапула или слайдом). Имя файла содержит… (пусто — любой).',
  params: [{ id: 'name', name: 'Имя содержит', t: 'text', def: '' }],
  on: ['media'], match: (p, ev) => !p.name || (ev.name || '').toLowerCase().includes(p.name.toLowerCase()),
  outs: [...EXEC_OUT, { id: 'name', name: 'Файл', t: 'str' }], out: (ev) => ({ name: ev.name }), sum: (p) => (p.name ? `«${p.name}»` : 'любой файл'),
});
R('trig.output', {
  cat: 'trigger', name: 'Внешний экран', icon: 'output', help: 'Вывод на внешний экран включили или выключили.',
  params: [{ id: 'ev', name: 'Событие', t: 'select', opts: [['on', 'Включили'], ['off', 'Выключили']], def: 'on' }],
  on: ['output'], match: (p, ev) => ev.on === ((p.ev || 'on') === 'on'), outs: EXEC_OUT, sum: (p) => ((p.ev || 'on') === 'on' ? 'включили' : 'выключили'),
});

/* ----- Датчики: только данные, без порядка; читают программу в момент, когда их спросили ----- */
R('sen.song', {
  cat: 'sensor', name: 'Текущая песня', icon: 'music', help: 'Песня, слайд которой сейчас на экране.',
  outs: [{ id: 'name', name: 'Название', t: 'str' }, { id: 'is', name: 'Это песня', t: 'bool' }, { id: 'number', name: 'Номер', t: 'str' }, { id: 'genre', name: 'Жанр', t: 'str' }, { id: 'arr', name: 'Аранжировка', t: 'str' }],
  eval() {
    const s = mcShown();
    const song = s && s.item.song;
    const a = song && Songs.arrOf(song);
    return { name: s ? s.item.name : '', is: !!song, number: (song && song.number) || '', genre: (song && song.genre) || '', arr: a ? a.name : song ? 'Как в тексте' : '' };
  },
});
R('sen.part', {
  cat: 'sensor', name: 'Текущая часть', icon: 'parts', help: 'Часть песни на экране и её место в аранжировке.',
  outs: [{ id: 'part', name: 'Часть', t: 'str' }, { id: 'occ', name: 'Повтор №', t: 'num' }, { id: 'index', name: 'Номер части', t: 'num' }, { id: 'count', name: 'Частей', t: 'num' }, { id: 'last', name: 'Последняя', t: 'bool' }],
  eval() {
    const s = mcShown();
    if (!s || s.slide.part === undefined) return { part: '', occ: 0, index: 0, count: 0, last: false };
    const pi = mcParts(s.item, s.slide);
    return { part: s.slide.part, occ: s.slide.occ, index: pi.index + 1, count: pi.count, last: pi.last };
  },
});
R('sen.lastPart', {
  cat: 'sensor', name: 'Последняя часть?', icon: 'arrange', help: 'Да, если часть на экране — последняя в аранжировке. Подключите «Часть» — проверится эта часть по названию.',
  ins: [{ id: 'part', name: 'Часть', t: 'str' }], outs: [{ id: 'yes', name: 'Да', t: 'bool' }, { id: 'lastName', name: 'Последняя часть', t: 'str' }],
  eval(c, p, inp) {
    const s = mcShown();
    if (!s) return { yes: false, lastName: '' };
    const pi = mcParts(s.item, s.slide);
    const name = c.linked('part') ? mcStr(inp('part')) : '';
    return { yes: c.linked('part') ? !!name && name === pi.lastName && pi.last : pi.last, lastName: pi.lastName };
  },
});
R('sen.lastSlide', {
  cat: 'sensor', name: 'Последний слайд?', icon: 'slides', help: 'Да, если на экране последний слайд презентации.',
  outs: [{ id: 'yes', name: 'Да', t: 'bool' }, { id: 'left', name: 'Осталось', t: 'num' }],
  eval() { const s = mcShown(); return s ? { yes: s.index === s.total - 1, left: s.total - 1 - s.index } : { yes: false, left: 0 }; },
});
R('sen.left', {
  cat: 'sensor', name: 'Сколько слайдов осталось', icon: 'list', help: 'Номер слайда на экране, всего и сколько осталось до конца презентации.',
  outs: [{ id: 'left', name: 'Осталось', t: 'num' }, { id: 'index', name: 'Номер', t: 'num' }, { id: 'total', name: 'Всего', t: 'num' }],
  eval() { const s = mcShown(); return s ? { left: s.total - 1 - s.index, index: s.index + 1, total: s.total } : { left: 0, index: 0, total: 0 }; },
});
R('sen.slide', {
  cat: 'sensor', name: 'Текущий слайд', icon: 'slides', help: 'Слайд на экране: подпись, текст, вид, презентация.',
  outs: [{ id: 'label', name: 'Подпись', t: 'str' }, { id: 'text', name: 'Текст', t: 'str' }, { id: 'kind', name: 'Вид', t: 'str' }, { id: 'name', name: 'Презентация', t: 'str' }],
  eval() { const s = mcShown(); return s ? { label: s.slide.label || '', text: mcSlideText(s.slide), kind: s.slide.k, name: s.item.name } : { label: '', text: '', kind: '', name: '' }; },
});
R('sen.layer', {
  cat: 'sensor', name: 'Медиаслой', icon: 'layers', help: 'Занят ли слой и что в нём. Без выбора — верхний видимый слой (активный).',
  params: [{ id: 'layer', name: 'Слой', t: 'select', opts: () => mcLayerOpts('Верхний (активный)'), def: '' }],
  outs: [{ id: 'busy', name: 'Занят', t: 'bool' }, { id: 'name', name: 'Слой', t: 'str' }, { id: 'label', name: 'Что показано', t: 'str' }, { id: 'hidden', name: 'Скрыт', t: 'bool' }],
  eval(c, p) {
    const id = p.layer || topLayer();
    const l = id && layerById(id);
    return { busy: !!(id && layerOn[id]), name: l ? layerName(l) : '', label: id && layerOn[id] ? layerOn[id].label || '' : '', hidden: !!(l && l.hidden) };
  },
  sum: (p) => (p.layer ? mcOptName(() => mcLayerOpts(''), p.layer) : 'верхний'),
});
R('sen.video', {
  cat: 'sensor', name: 'Состояние видео', icon: 'video', help: 'Видео на экране: играет ли, закончилось ли, время.',
  outs: [{ id: 'playing', name: 'Играет', t: 'bool' }, { id: 'ended', name: 'Закончилось', t: 'bool' }, { id: 'time', name: 'Секунда', t: 'num' }, { id: 'dur', name: 'Длина, с', t: 'num' }, { id: 'name', name: 'Видео', t: 'str' }],
  eval() {
    const v = pv && pv.isConnected ? pv : null;
    const vl = videoLayer();
    return { playing: !!v && !v.paused && !v.ended, ended: !!v && v.ended, time: v ? Math.round(v.currentTime * 10) / 10 : 0, dur: v && Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : 0, name: vl ? vl.label || '' : '' };
  },
});
R('sen.output', { cat: 'sensor', name: 'Внешний экран включён?', icon: 'output', help: 'Идёт ли вывод на внешний экран.', outs: [{ id: 'on', name: 'Включён', t: 'bool' }], eval: () => ({ on: !!outputOpen }) });
R('sen.file', {
  cat: 'sensor', name: 'Что на экране', icon: 'screen', help: 'Подпись того, что на верхнем слое, и имя файла (для фото и видео).',
  outs: [{ id: 'label', name: 'Подпись', t: 'str' }, { id: 'file', name: 'Файл', t: 'str' }, { id: 'type', name: 'Вид', t: 'str' }],
  eval() {
    const c = topContent();
    return { label: liveLabel || '', file: c && c.url ? decodeURIComponent(fileName(c.url)) : '', type: c ? c.type : '' };
  },
});
R('sen.playlist', {
  cat: 'sensor', name: 'Текущий плейлист', icon: 'playlist', help: 'Плейлист или библиотека, открытая в ленте.',
  outs: [{ id: 'name', name: 'Название', t: 'str' }, { id: 'kind', name: 'Вид', t: 'str' }, { id: 'count', name: 'Пунктов', t: 'num' }],
  eval() { const v = lib && findView(work); return { name: v ? v.name : '', kind: v ? (work.kind === 'pl' ? 'плейлист' : 'библиотека') : '', count: v ? workEntries().length : 0 }; },
});
R('sen.music', {
  cat: 'sensor', name: 'Музыка', icon: 'audio', help: 'Играет ли музыка, что и с какой громкостью.',
  outs: [{ id: 'playing', name: 'Играет', t: 'bool' }, { id: 'name', name: 'Песня', t: 'str' }, { id: 'vol', name: 'Громкость, %', t: 'num' }],
  eval() { const s = curSong(); return { playing: !audio.paused && !!audio.src, name: s ? s.name : '', vol: Math.round(settings.musicVol * 100) }; },
});
R('sen.bible', {
  cat: 'sensor', name: 'Стих на экране', icon: 'bible', help: 'Место из Библии, показанное последним, и перевод.',
  outs: [{ id: 'ref', name: 'Место', t: 'str' }, { id: 'tr', name: 'Перевод', t: 'str' }, { id: 'on', name: 'Показан', t: 'bool' }],
  eval() { return { ref: mcLastRef, tr: bible ? bible.name : '', on: !!bShown }; },
});

/* ----- Значения ----- */
R('val.num', { cat: 'value', name: 'Число', icon: 'value', params: [{ id: 'v', name: 'Число', t: 'num', def: 0 }], outs: [{ id: 'v', name: '', t: 'num' }], eval: (c, p) => ({ v: mcNum(p.v) }), sum: (p) => String(mcNum(p.v)) });
R('val.text', { cat: 'value', name: 'Текст', icon: 'text', params: [{ id: 'v', name: 'Текст', t: 'text', def: '' }], outs: [{ id: 'v', name: '', t: 'str' }], eval: (c, p) => ({ v: mcStr(p.v) }), sum: (p) => (p.v ? `«${p.v}»` : 'пусто') });
R('val.bool', { cat: 'value', name: 'Да / Нет', icon: 'done', params: [{ id: 'v', name: 'Да', t: 'check', def: true }], outs: [{ id: 'v', name: '', t: 'bool' }], eval: (c, p) => ({ v: !!p.v }), sum: (p) => (p.v ? 'да' : 'нет') });

/* ----- Логика ----- */
R('log.if', {
  cat: 'logic', name: 'Если / Иначе', icon: 'logic', help: 'Условие «да» — идём по выходу «Да», иначе — по «Нет». Не подключено — «нет».',
  ins: [...EXEC_IN, { id: 'cond', name: 'Условие', t: 'bool' }], outs: [{ id: 'yes', name: 'Да', t: 'exec' }, { id: 'no', name: 'Нет', t: 'exec' }],
  run: (c, p, inp) => (mcBool(inp('cond')) ? 'yes' : 'no'),
});
const boolInputs = [{ id: 'a', name: 'А', t: 'bool' }, { id: 'b', name: 'Б', t: 'bool' }, { id: 'c', name: 'В', t: 'bool' }, { id: 'd', name: 'Г', t: 'bool' }];
R('log.and', {
  cat: 'logic', name: 'И', icon: 'logic', help: 'Да, если «да» на всех подключённых входах.', ins: boolInputs, outs: [{ id: 'v', name: '', t: 'bool' }],
  eval(c, p, inp) { const on = boolInputs.filter((x) => c.linked(x.id)); return { v: on.length > 0 && on.every((x) => mcBool(inp(x.id))) }; },
});
R('log.or', {
  cat: 'logic', name: 'ИЛИ', icon: 'logic', help: 'Да, если «да» хотя бы на одном входе.', ins: boolInputs, outs: [{ id: 'v', name: '', t: 'bool' }],
  eval(c, p, inp) { return { v: boolInputs.some((x) => c.linked(x.id) && mcBool(inp(x.id))) }; },
});
R('log.not', { cat: 'logic', name: 'НЕ', icon: 'logic', help: 'Наоборот: да ↔ нет.', ins: [{ id: 'a', name: '', t: 'bool' }], outs: [{ id: 'v', name: '', t: 'bool' }], eval: (c, p, inp) => ({ v: !mcBool(inp('a')) }) });
const MC_OPS = [['eq', '= равно'], ['ne', '≠ не равно'], ['gt', '> больше'], ['lt', '< меньше'], ['ge', '≥ не меньше'], ['le', '≤ не больше'], ['has', 'содержит'], ['starts', 'начинается с']];
R('log.compare', {
  cat: 'logic', name: 'Сравнить', icon: 'logic', help: 'Сравнивает А и Б. Числа — как числа, текст — без учёта регистра. Неподключённый вход берётся из свойств.',
  params: [{ id: 'a', name: 'А', t: 'text', def: '' }, { id: 'op', name: 'Как', t: 'select', opts: MC_OPS, def: 'eq' }, { id: 'b', name: 'Б', t: 'text', def: '' }],
  ins: [{ id: 'a', name: 'А', t: 'any' }, { id: 'b', name: 'Б', t: 'any' }], outs: [{ id: 'v', name: '', t: 'bool' }],
  eval(c, p, inp) {
    const a = inp('a');
    const b = inp('b');
    const num = (x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x.replace(',', '.')))));
    const n = num(a) && num(b);
    const A = n ? mcNum(a) : mcStr(a).toLowerCase().trim();
    const B = n ? mcNum(b) : mcStr(b).toLowerCase().trim();
    const v = { eq: A === B, ne: A !== B, gt: A > B, lt: A < B, ge: A >= B, le: A <= B, has: String(A).includes(String(B)), starts: String(A).startsWith(String(B)) }[p.op || 'eq'];
    return { v: !!v };
  },
  sum: (p) => `${p.a || 'А'} ${mcOptName(MC_OPS, p.op || 'eq').split(' ')[0]} ${p.b || 'Б'}`,
});
R('log.delay', {
  cat: 'logic', name: 'Задержка', icon: 'timer', help: 'Подождать и идти дальше. Остальная программа не ждёт.',
  params: [{ id: 'sec', name: 'Секунд', t: 'num', def: 1, min: 0, step: 0.1 }], ins: [...EXEC_IN, { id: 'sec', name: 'Секунд', t: 'num' }], outs: EXEC_OUT,
  async run(c, p, inp) { await c.wait(Math.max(0, mcNum(inp('sec'))) * 1000); return 'out'; },
  sum: (p) => `${mcNum(p.sec != null ? p.sec : 1)} с`,
});
const MC_WAIT_EVS = [['slide', 'Следующий слайд'], ['part', 'Следующая часть песни'], ['song', 'Следующая песня'], ['videoEnd', 'Конец видео'], ['layerOff', 'Очистка слоя'], ['bible', 'Стих Библии'], ['key', 'Любое сочетание клавиш'], ['output', 'Внешний экран вкл/выкл']];
const MC_WAIT_MAP = { slide: ['slide'], part: ['part'], song: ['song'], videoEnd: ['video', (ev) => ev.ev === 'ended'], layerOff: ['layer', (ev) => ev.ev === 'clear'], bible: ['bible'], key: ['key'], output: ['output'] };
R('log.wait', {
  cat: 'logic', name: 'Ждать событие', icon: 'timer', help: 'Ждёт событие и идёт по «Дождались». Время ожидания 0 — ждать сколько угодно (остановить — «Стоп»).',
  params: [{ id: 'ev', name: 'Событие', t: 'select', opts: MC_WAIT_EVS, def: 'slide' }, { id: 'sec', name: 'Ждать не дольше, с', t: 'num', def: 0, min: 0 }],
  ins: EXEC_IN, outs: [{ id: 'out', name: 'Дождались', t: 'exec' }, { id: 'late', name: 'Не дождались', t: 'exec' }],
  async run(c, p) {
    const [type, ok] = MC_WAIT_MAP[p.ev || 'slide'];
    const ev = await c.waitEvent(type, ok, mcNum(p.sec) * 1000);
    return ev ? 'out' : 'late';
  },
  sum: (p) => mcOptName(MC_WAIT_EVS, p.ev || 'slide') + (mcNum(p.sec) ? ` · до ${mcNum(p.sec)} с` : ''),
});
const mcCounters = new Map(); // счётчики живут до перезапуска программы
R('log.counter', {
  cat: 'logic', name: 'Счётчик', icon: 'value', help: 'Считает, сколько раз через него прошли. «Каждый N-й» — срабатывает на N-й, 2N-й… раз. Сбросить — кнопкой в свойствах или входом «Сброс».',
  params: [{ id: 'n', name: 'Каждый N-й', t: 'num', def: 3, min: 1 }],
  ins: [...EXEC_IN, { id: 'reset', name: 'Сброс', t: 'exec' }], outs: [{ id: 'out', name: 'Каждый раз', t: 'exec' }, { id: 'nth', name: 'Каждый N-й', t: 'exec' }, { id: 'count', name: 'Сколько', t: 'num' }],
  run(c, p, inp, port) {
    const k = c.macro.id + ':' + c.node.id;
    if (port === 'reset') { mcCounters.set(k, 0); c.set('count', 0); return null; }
    const n = (mcCounters.get(k) || 0) + 1;
    mcCounters.set(k, n);
    c.set('count', n);
    const every = Math.max(1, Math.round(mcNum(p.n) || 1));
    return n % every === 0 ? ['out', 'nth'] : 'out';
  },
  sum: (p) => `каждый ${Math.max(1, Math.round(mcNum(p.n) || 1))}-й`,
});
R('log.flip', {
  cat: 'logic', name: 'Чередовать', icon: 'logic', help: 'Туда-обратно: 1-е нажатие — выход «А», 2-е — «Б», 3-е — снова «А»… Подключите к «А» одно действие, к «Б» — другое (например, две сцены). «Сброс» — следующим будет «А».',
  ins: [...EXEC_IN, { id: 'reset', name: 'Сброс', t: 'exec' }], outs: [{ id: 'a', name: 'А', t: 'exec' }, { id: 'b', name: 'Б', t: 'exec' }],
  run(c, p, inp, port) {
    const k = c.macro.id + ':' + c.node.id;
    if (port === 'reset') { mcCounters.set(k, 0); return null; }
    const n = (mcCounters.get(k) || 0) + 1;
    mcCounters.set(k, n);
    return n % 2 ? 'a' : 'b';
  },
});
const mcCases = (p) => String(p.cases || '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, 12);
R('log.switch', {
  cat: 'logic', name: 'Выбор (Switch)', icon: 'logic', help: 'Сравнивает значение с вариантами (через «|») и идёт по совпавшему выходу, иначе — «Иначе».',
  params: [{ id: 'cases', name: 'Варианты через |', t: 'text', def: 'Куплет | Припев | Мост' }, { id: 'mode', name: 'Совпадение', t: 'select', opts: [['starts', 'Начинается с'], ['eq', 'Точно'], ['has', 'Содержит']], def: 'starts' }, { id: 'v', name: 'Значение', t: 'text', def: '' }],
  ins: [...EXEC_IN, { id: 'v', name: 'Значение', t: 'any' }],
  outs: (p) => [...mcCases(p).map((x, i) => ({ id: 'c' + i, name: x, t: 'exec' })), { id: 'def', name: 'Иначе', t: 'exec' }],
  run(c, p, inp) {
    const v = mcStr(inp('v')).toLowerCase().trim();
    const i = mcCases(p).findIndex((x) => { const y = x.toLowerCase(); return { eq: v === y, has: v.includes(y), starts: v.startsWith(y) }[p.mode || 'starts']; });
    return i >= 0 ? 'c' + i : 'def';
  },
});
R('log.loop', {
  cat: 'logic', name: 'Повтор', icon: 'redo', help: '«Каждый раз» — N раз по очереди (с паузой), потом «Готово». Не больше 1000 раз.',
  params: [{ id: 'n', name: 'Сколько раз', t: 'num', def: 3, min: 1 }, { id: 'sec', name: 'Пауза между, с', t: 'num', def: 0, min: 0, step: 0.1 }],
  ins: [...EXEC_IN, { id: 'n', name: 'Раз', t: 'num' }], outs: [{ id: 'body', name: 'Каждый раз', t: 'exec' }, { id: 'done', name: 'Готово', t: 'exec' }, { id: 'i', name: '№', t: 'num' }],
  async run(c, p, inp) {
    const n = Math.min(1000, Math.max(0, Math.round(mcNum(inp('n')))));
    for (let i = 1; i <= n && !c.stopped(); i++) {
      c.set('i', i);
      await c.follow('body');
      if (i < n && mcNum(p.sec) > 0) await c.wait(mcNum(p.sec) * 1000);
      else await null;
    }
    return 'done';
  },
  sum: (p) => `${Math.round(mcNum(p.n != null ? p.n : 3))} раз`,
});
R('log.seq', {
  cat: 'logic', name: 'По очереди', icon: 'list', help: 'Выполняет выходы 1, 2, 3 строго по очереди: следующий — когда закончился предыдущий. (Один выход на несколько нод — они идут параллельно.)',
  ins: EXEC_IN, outs: [{ id: 'o1', name: '1', t: 'exec' }, { id: 'o2', name: '2', t: 'exec' }, { id: 'o3', name: '3', t: 'exec' }, { id: 'o4', name: '4', t: 'exec' }],
  async run(c) { for (const o of ['o1', 'o2', 'o3', 'o4']) { if (c.stopped()) break; await c.follow(o); } return null; },
});

/* ----- Действия ----- */
const MC_SLIDE_PICK = [['first', 'Первый'], ['n', 'По номеру'], ['label', 'По подписи / части']];
function mcPickSlide(item, mode, n, label) {
  const vis = item.slides;
  if (mode === 'n') return vis[Math.max(0, Math.min(vis.length - 1, Math.round(mcNum(n)) - 1))];
  if (mode === 'label' && label) { const l = String(label).toLowerCase(); return vis.find((s) => (s.part || s.label || '').toLowerCase().startsWith(l)) || null; }
  return vis.find((s) => s.k !== 'audio') || vis[0];
}
// Где пункт есть: в ленте (рабочий список), в списке слева, в открытом плейлисте
function mcFindEntry(itemId) {
  for (const view of [work, lib.view, curPl() && { kind: 'pl', id: curPl().id }]) {
    if (!view || !findView(view)) continue;
    const x = viewEntries(view).find((e) => e.item.id === itemId);
    if (x) return { x, vk: viewKey(view) };
  }
  return null;
}
const mcItemOf = (id) => { const it = lib && lib.items[id]; if (!it) throw new Error(id ? 'Презентация не найдена (удалена?)' : 'Не выбрана презентация'); return it; };
const mcLayerOf = (id) => { if (!id) return ''; if (!layerById(id)) throw new Error('Слой удалён — выберите другой'); return id; };

R('act.showItem', {
  cat: 'action', name: 'Запустить презентацию', icon: 'slides', help: 'Показать слайд презентации (песни, Библии, своих слайдов). Тема и слой — только для этого показа.',
  params: [
    { id: 'item', name: 'Презентация', t: 'item', opts: () => mcItemOpts(), def: '' },
    { id: 'mode', name: 'Слайд', t: 'select', opts: MC_SLIDE_PICK, def: 'first' },
    { id: 'n', name: 'Номер слайда', t: 'num', def: 1, min: 1, show: (p) => p.mode === 'n' },
    { id: 'label', name: 'Подпись или часть', t: 'text', def: '', show: (p) => p.mode === 'label' },
    { id: 'theme', name: 'Тема', t: 'select', opts: () => mcThemeOpts('Как у презентации'), def: '' },
    { id: 'layer', name: 'Слой', t: 'select', opts: () => mcLayerOpts('Авто (как у пункта)'), def: '' },
    { id: 'open', name: 'Открыть в ленте', t: 'check', def: true },
  ],
  ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) {
    const item = mcItemOf(p.item);
    const slide = mcPickSlide(item, p.mode, p.n, p.label);
    if (!slide) throw new Error('В презентации нет такого слайда');
    const f = mcFindEntry(item.id);
    if (f && p.open !== false && f.vk === workKey() && !feedAll() && openKey !== f.x.key) { openKey = f.x.key; renderFeed(); }
    if (f && !p.theme && !p.layer) { showSlide(f.x.key, slide.id, f.vk); return 'out'; }
    const it = p.theme ? { ...item, theme: p.theme } : item;
    live = -1; bShown = null;
    present(() => contentOf(it, slide), item.name + (item.slides.length > 1 ? ` — ${slide.label || item.slides.indexOf(slide) + 1}` : ''), false, mcLayerOf(p.layer) || (f ? pickedLayer(f.x) : ''));
    plShown = f ? { view: f.vk, key: f.x.key, sid: slide.id } : null;
    if (f) mcSlideShown(f.x, slide, f.vk);
    updatePlaylistLive();
    return 'out';
  },
  preview(p) { const it = lib.items[p.item]; const s = it && mcPickSlide(it, p.mode, p.n, p.label); return s && s.k !== 'audio' && s.k !== 'live' ? contentOf(p.theme ? { ...it, theme: p.theme } : it, s) : null; },
  sum: (p) => (lib && lib.items[p.item] ? lib.items[p.item].name : 'не выбрана'),
});
R('act.openSong', {
  cat: 'action', name: 'Открыть песню', icon: 'music', help: 'Открыть песню в ленте, выбрать аранжировку и (по желанию) показать первый слайд. Нет в ленте — добавится в открытый плейлист.',
  params: [
    { id: 'song', name: 'Песня', t: 'item', pred: (it) => !!it.song || it.kind === 'song', opts: () => mcSongOpts('— выберите —'), def: '' },
    { id: 'arr', name: 'Аранжировка (название)', t: 'text', def: '' },
    { id: 'part', name: 'Начать с части', t: 'text', def: '' },
    { id: 'show', name: 'Показать на экране', t: 'check', def: true },
  ],
  ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) {
    const item = mcItemOf(p.song);
    if (p.arr && item.song) {
      const a = (item.song.arrangements || []).find((x) => x.name.toLowerCase() === p.arr.trim().toLowerCase());
      if (!a && !/^как в тексте$/i.test(p.arr.trim())) throw new Error(`У песни нет аранжировки «${p.arr}»`);
      if ((a ? a.id : '') !== (item.song.arr || '')) setSongArr(item, a ? a.id : '');
    }
    let f = mcFindEntry(item.id);
    if (!f) {
      const pl = curPl();
      if (!pl) throw new Error('Нет плейлиста, куда добавить песню');
      pl.entries.push({ eid: newId(), item: item.id });
      saveLib();
      f = mcFindEntry(item.id);
    }
    work = keyView(f.vk);
    openKey = f.x.key;
    renderService();
    const s = mcPickSlide(item, p.part ? 'label' : 'first', 0, p.part);
    if (p.show !== false && s) showSlide(f.x.key, s.id, f.vk);
    return 'out';
  },
  preview(p) { const it = lib.items[p.song]; const s = it && mcPickSlide(it, p.part ? 'label' : 'first', 0, p.part); return p.show !== false && s ? contentOf(it, s) : null; },
  sum: (p) => (lib && lib.items[p.song] ? lib.items[p.song].name : 'не выбрана') + (p.arr ? ` · ${p.arr}` : ''),
});
const MC_GO = [['next', 'Следующий'], ['prev', 'Предыдущий'], ['first', 'Первый в презентации'], ['last', 'Последний в презентации'], ['n', 'По номеру'], ['label', 'Часть / подпись'], ['nextItem', 'Следующий пункт плейлиста'], ['prevItem', 'Предыдущий пункт плейлиста']];
R('act.goSlide', {
  cat: 'action', name: 'Перейти к слайду', icon: 'slides', help: 'Листать ленту: следующий слайд, к части «Припев», к номеру — в той презентации, что на экране.',
  params: [{ id: 'mode', name: 'Куда', t: 'select', opts: MC_GO, def: 'next' }, { id: 'n', name: 'Номер', t: 'num', def: 1, min: 1, show: (p) => p.mode === 'n' }, { id: 'label', name: 'Часть или подпись', t: 'text', def: 'Припев', show: (p) => p.mode === 'label' }],
  ins: [...EXEC_IN, { id: 'n', name: 'Номер', t: 'num' }], outs: EXEC_OUT,
  run(c, p, inp) {
    const m = p.mode || 'next';
    if (m === 'next' || m === 'prev') { plStep(m === 'next' ? 1 : -1); return 'out'; }
    if (m === 'nextItem' || m === 'prevItem') { plJumpItem(m === 'nextItem' ? 1 : -1); return 'out'; }
    const s = mcShown();
    const x = s ? s.x : openKey && workEntry(openKey);
    if (!x) throw new Error('Нет презентации на экране или в ленте');
    const item = x.item;
    const slide = m === 'first' ? item.slides[0] : m === 'last' ? item.slides[item.slides.length - 1] : mcPickSlide(item, m, inp('n'), p.label);
    if (!slide) throw new Error(`Нет слайда «${m === 'n' ? mcNum(inp('n')) : p.label}»`);
    showSlide(x.key, slide.id, s ? plShown.view : workKey());
    return 'out';
  },
  sum: (p) => (p.mode === 'label' ? `к «${p.label || ''}»` : p.mode === 'n' ? `№ ${mcNum(p.n || 1)}` : mcOptName(MC_GO, p.mode || 'next').toLowerCase()),
});
const MC_THEME_TO = [['shown', 'Презентации на экране'], ['slide', 'Только слайду на экране'], ['kind', 'По умолчанию для вида']];
R('act.theme', {
  cat: 'action', name: 'Применить тему', icon: 'theme', help: 'Сменить тему презентации на экране, одного слайда или тему по умолчанию для песен, Библии… Отменяется Ctrl+Z.',
  params: [{ id: 'theme', name: 'Тема', t: 'select', opts: () => mcThemeOpts('Без темы (по умолчанию)'), def: '' }, { id: 'to', name: 'Кому', t: 'select', opts: MC_THEME_TO, def: 'shown' }, { id: 'kind', name: 'Вид', t: 'select', opts: MC_THEME_KINDS, def: 'song', show: (p) => p.to === 'kind' }],
  ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) {
    if (p.theme && !themeById(p.theme)) throw new Error('Тема не найдена (удалена?)');
    const to = p.to || 'shown';
    if (to === 'kind') lib.themeFor[p.kind || 'song'] = p.theme || '';
    else {
      const s = mcShown();
      if (!s) throw new Error('На экране нет слайда из плейлиста');
      const o = to === 'slide' ? s.slide : s.item;
      if (p.theme) o.theme = p.theme; else delete o.theme;
    }
    saveLib();
    renderService();
    refreshLive();
    return 'out';
  },
  preview(p) { const s = mcShown(); return s && s.slide.k !== 'audio' && s.slide.k !== 'live' ? contentOf({ ...s.item, theme: p.theme }, { ...s.slide, theme: p.theme }) : null; },
  sum: (p) => (mcOptName(() => mcThemeOpts('без темы'), p.theme || '') || 'без темы') + ' → ' + mcOptName(MC_THEME_TO, p.to || 'shown').toLowerCase(),
});
const mcAfterEnd = new Map(); // слой → { url, fade } — очистить, когда видео закончится
const MC_AFTER = [['stay', 'Остановиться на последнем кадре'], ['loop', 'Повторять'], ['clear', 'Очистить слой']];
R('act.media', {
  cat: 'action', name: 'Запустить видео или фото', icon: 'video', help: 'Файл в медиаслой (по умолчанию «Медиа» — под текстом). Громкость — громкость слоя. Тот же файл уже на экране — не перезапускается.',
  params: [
    { id: 'file', name: 'Файл', t: 'file', kinds: ['image', 'video'], def: null },
    { id: 'layer', name: 'Слой', t: 'select', opts: () => mcLayerOpts('Авто («Медиа»)'), def: '' },
    { id: 'vol', name: 'Громкость, %', t: 'num', def: 100, min: 0, max: 100 },
    { id: 'fadeIn', name: 'Fade In, с', t: 'num', def: 0, min: 0, step: 0.5 },
    { id: 'fadeOut', name: 'Fade Out перед очисткой, с', t: 'num', def: 0, min: 0, step: 0.5, show: (p) => p.after === 'clear' },
    { id: 'after', name: 'После конца видео', t: 'select', opts: MC_AFTER, def: 'stay' },
  ],
  ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) {
    const f = p.file;
    if (!f || !f.url) throw new Error('Не выбран файл');
    const content = { type: f.type === 'video' ? 'video' : 'image', url: f.url, fit: settings.fit, sound: true, loop: p.after === 'loop', style: styleOf('media') };
    const id = mcLayerOf(p.layer) || autoLayer(content);
    const vol = Math.max(0, Math.min(100, mcNum(p.vol != null ? p.vol : 100))) / 100;
    const l = layerById(id);
    const same = layerOn[id] && layerOn[id].content.url === f.url;
    if (!same) {
      if (mcNum(p.fadeIn) > 0 && l) { l.volume = 0; sendLayers(); }
      present(() => content, f.name || fileName(f.path), false, id);
      queueMicrotask(() => { if (layerOn[id]) layerOn[id].marks = {}; }); // подсветку в списках ставит слайд, а не макрос
    }
    if (l) mcRamp(() => (l.volume != null ? l.volume : 1), vol, same ? 0 : mcNum(p.fadeIn) * 1000, (v) => { l.volume = v; sendLayers(); }, c);
    if (p.after === 'clear' && content.type === 'video') mcAfterEnd.set(id, { url: f.url, fade: mcNum(p.fadeOut) * 1000 }); else mcAfterEnd.delete(id);
    return 'out';
  },
  preview: (p) => (p.file && p.file.url ? { type: p.file.type === 'video' ? 'video' : 'image', url: p.file.url, fit: settings.fit, sound: false, loop: true, style: styleOf('media') } : null),
  sum: (p) => (p.file ? p.file.name || fileName(p.file.path) : 'файл не выбран') + (mcNum(p.vol != null ? p.vol : 100) !== 100 ? ` · ${mcNum(p.vol)}%` : ''),
});
R('act.live', {
  cat: 'action', name: 'Запустить Live-источник', icon: 'sources', help: 'Камера, NDI, захват экрана — любой источник, который есть в библиотеке (добавьте его через «＋» → «Live-источник»).',
  params: [{ id: 'src', name: 'Источник', t: 'select', opts: mcLiveOpts, def: '' }, { id: 'layer', name: 'Слой', t: 'select', opts: () => mcLayerOpts('Авто («Источники»)'), def: '' }],
  ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) {
    const [iid, sid] = String(p.src || '').split(':');
    const item = mcItemOf(iid);
    const slide = item.slides.find((s) => s.id === sid);
    if (!slide) throw new Error('Источник не найден');
    const f = mcFindEntry(item.id);
    if (f && !p.layer) { showSlide(f.x.key, sid, f.vk); return 'out'; }
    present(() => contentOf(item, slide), slide.name || item.name, false, mcLayerOf(p.layer) || autoLayer({ type: 'live' }));
    return 'out';
  },
  sum: (p) => mcOptName(mcLiveOpts, p.src || '') || 'не выбран',
});
R('act.clearLayer', {
  cat: 'action', name: 'Очистить медиаслой', icon: 'erase', help: 'Убрать содержимое одного слоя (остальные не трогаются) или всех слоёв.',
  params: [{ id: 'layer', name: 'Слой', t: 'select', opts: () => mcLayerOpts('Все слои'), def: 'media' }],
  ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) { if (!p.layer) clearScreen(); else clearLayer(mcLayerOf(p.layer)); return 'out'; },
  sum: (p) => (p.layer ? mcOptName(() => mcLayerOpts(''), p.layer) : 'все слои'),
});
const MC_LSET = [['show', 'Показать'], ['hide', 'Скрыть'], ['toggle', 'Показать / скрыть'], ['opacity', 'Прозрачность'], ['volume', 'Громкость'], ['pause', 'Пауза'], ['play', 'Продолжить']];
R('act.layerSet', {
  cat: 'action', name: 'Переключить медиаслой', icon: 'layers', help: 'Показать или скрыть слой (содержимое продолжает идти), прозрачность и громкость — плавно за «Время».',
  params: [
    { id: 'layer', name: 'Слой', t: 'select', opts: () => mcLayerOpts('— выберите —'), def: 'media' },
    { id: 'what', name: 'Что сделать', t: 'select', opts: MC_LSET, def: 'opacity' },
    { id: 'v', name: 'Значение, %', t: 'num', def: 100, min: 0, max: 100, show: (p) => p.what === 'opacity' || p.what === 'volume' || !p.what },
    { id: 'sec', name: 'Время, с', t: 'num', def: 0, min: 0, step: 0.1, show: (p) => p.what === 'opacity' || p.what === 'volume' || !p.what },
  ],
  ins: [...EXEC_IN, { id: 'v', name: 'Значение', t: 'num' }], outs: EXEC_OUT,
  async run(c, p, inp) {
    const l = layerById(mcLayerOf(p.layer));
    if (!l) throw new Error('Не выбран слой');
    const w = p.what || 'opacity';
    if (w === 'show' || w === 'hide' || w === 'toggle') { lySet(l, { hidden: w === 'toggle' ? !l.hidden : w === 'hide' }); return 'out'; }
    if (w === 'pause' || w === 'play') { if (layerOn[l.id]) { layerOn[l.id].paused = w === 'pause'; layerPlay(l.id, w === 'play'); } return 'out'; }
    const key = w === 'volume' ? 'volume' : 'opacity';
    const to = Math.max(0, Math.min(100, mcNum(inp('v')))) / 100;
    await mcRamp(() => (l[key] != null ? l[key] : 1), to, mcNum(p.sec) * 1000, (v) => { l[key] = v; sendLayers(); }, c);
    saveSettings();
    renderLayers();
    return 'out';
  },
  sum: (p) => `${mcOptName(() => mcLayerOpts(''), p.layer || '') || '?'} · ${mcOptName(MC_LSET, p.what || 'opacity').toLowerCase()}${['opacity', 'volume'].includes(p.what || 'opacity') ? ` ${mcNum(p.v != null ? p.v : 100)}%` : ''}`,
});
const MC_VOL_TO = [['music', 'Музыка'], ['video', 'Видео (проигрыватель)'], ['layer', 'Медиаслой']];
R('act.volume', {
  cat: 'action', name: 'Изменить громкость', icon: 'audio', help: 'Громкость музыки, видео или слоя — сразу или плавно.',
  params: [
    { id: 'to', name: 'Чего', t: 'select', opts: MC_VOL_TO, def: 'music' },
    { id: 'layer', name: 'Слой', t: 'select', opts: () => mcLayerOpts('— выберите —'), def: 'media', show: (p) => p.to === 'layer' },
    { id: 'v', name: 'Громкость, %', t: 'num', def: 30, min: 0, max: 100 },
    { id: 'sec', name: 'Плавно за, с', t: 'num', def: 0, min: 0, step: 0.5 },
  ],
  ins: [...EXEC_IN, { id: 'v', name: 'Громкость', t: 'num' }], outs: EXEC_OUT,
  async run(c, p, inp) {
    const v = Math.max(0, Math.min(100, mcNum(inp('v')))) / 100;
    const ms = mcNum(p.sec) * 1000;
    const to = p.to || 'music';
    if (to === 'music') await mcRamp(() => settings.musicVol, v, ms, (x) => { settings.musicVol = x; applyVol(); updateAudioUi(); }, c);
    else if (to === 'video') await mcRamp(() => videoVol, v, ms, (x) => { videoVol = settings.videoVol = x; sendVideoAudio(); if (pv) updateAudioUi(); }, c);
    else {
      const l = layerById(mcLayerOf(p.layer));
      if (!l) throw new Error('Не выбран слой');
      await mcRamp(() => (l.volume != null ? l.volume : 1), v, ms, (x) => { l.volume = x; sendLayers(); }, c);
      renderLayers();
    }
    saveSettings();
    return 'out';
  },
  sum: (p) => `${mcOptName(MC_VOL_TO, p.to || 'music')}${p.to === 'layer' ? ` «${mcOptName(() => mcLayerOpts(''), p.layer || '')}»` : ''} → ${mcNum(p.v != null ? p.v : 30)}%`,
});
const MC_STOP = [['all', 'Музыку и видео'], ['music', 'Музыку'], ['video', 'Видео']];
R('act.stop', {
  cat: 'action', name: 'Остановить воспроизведение', icon: 'close', help: 'Музыка — с затуханием (Fade Out из проигрывателя), видео — пауза и в начало.',
  params: [{ id: 'what', name: 'Что', t: 'select', opts: MC_STOP, def: 'all' }], ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) {
    const w = p.what || 'all';
    if (w !== 'video') stopMusic();
    if (w !== 'music' && pv) { videoCtl('pause'); videoCtl('seek', 0); }
    return 'out';
  },
  sum: (p) => mcOptName(MC_STOP, p.what || 'all').toLowerCase(),
});
const MC_MUSIC = [['play', 'Играть (следующая в очереди)'], ['pause', 'Пауза'], ['next', 'Следующая песня'], ['prev', 'Предыдущая песня'], ['file', 'Включить файл']];
R('act.music', {
  cat: 'action', name: 'Музыка', icon: 'music', help: 'Управление музыкой: пуск, пауза, следующая, включить файл.',
  params: [{ id: 'what', name: 'Что', t: 'select', opts: MC_MUSIC, def: 'play' }, { id: 'file', name: 'Файл', t: 'file', kinds: ['audio'], def: null, show: (p) => p.what === 'file' }],
  ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) {
    const w = p.what || 'play';
    if (w === 'file') { if (!p.file) throw new Error('Не выбран файл'); playAudioItem(p.file); }
    else if (w === 'pause') pauseMusic();
    else if (w === 'next' || w === 'prev') musicStep(w === 'next' ? 1 : -1);
    else if (audio.paused && audio.src) { gain = 1; applyVol(); audio.play().catch(() => {}); } else if (audio.paused) musicStep(1);
    return 'out';
  },
  sum: (p) => (p.what === 'file' ? (p.file ? p.file.name : 'файл не выбран') : mcOptName(MC_MUSIC, p.what || 'play').toLowerCase()),
});
R('act.plAdd', {
  cat: 'action', name: 'Добавить в плейлист', icon: 'playlist', help: 'Добавить презентацию или файл в конец плейлиста.',
  params: [
    { id: 'pl', name: 'Плейлист', t: 'select', opts: () => mcPlOpts('Открытый'), def: '' },
    { id: 'what', name: 'Что', t: 'select', opts: [['item', 'Презентацию'], ['file', 'Файл']], def: 'item' },
    { id: 'item', name: 'Презентация', t: 'item', opts: () => mcItemOpts(), def: '', show: (p) => (p.what || 'item') === 'item' },
    { id: 'file', name: 'Файл', t: 'file', kinds: ['image', 'video', 'audio'], def: null, show: (p) => p.what === 'file' },
  ],
  ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) {
    const pl = p.pl ? lib.playlists.find((x) => x.id === p.pl) : curPl();
    if (!pl) throw new Error('Плейлист не найден');
    let id = p.item;
    if (p.what === 'file') {
      if (!p.file) throw new Error('Не выбран файл');
      const it = Slides.fromFile(p.file);
      lib.items[it.id] = it;
      id = it.id;
    } else mcItemOf(id);
    pl.entries.push({ eid: newId(), item: id });
    saveLib();
    renderService();
    return 'out';
  },
  sum: (p) => `→ ${p.pl ? mcOptName(() => mcPlOpts(''), p.pl) : 'открытый'}`,
});
R('act.output', {
  cat: 'action', name: 'Внешний экран', icon: 'output', help: 'Включить или выключить вывод на внешний экран (как F9).',
  params: [{ id: 'mode', name: 'Что', t: 'select', opts: [['on', 'Включить'], ['off', 'Выключить'], ['toggle', 'Переключить']], def: 'on' }], ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) { const m = p.mode || 'on'; if (m === 'toggle' || (m === 'on') !== outputOpen) toggleOutput(); return 'out'; },
  sum: (p) => ({ on: 'включить', off: 'выключить', toggle: 'переключить' })[p.mode || 'on'],
});
R('act.command', {
  cat: 'action', name: 'Команда программы', icon: 'keys', help: 'Любая команда из «Настройки → Горячие клавиши»: следующий слайд, вкладка, рисование, медиапул…',
  params: [{ id: 'act', name: 'Команда', t: 'select', opts: mcActOpts, def: 'next' }], ins: EXEC_IN, outs: EXEC_OUT,
  run(c, p) { const a = ACTION_LIST.find(([id]) => id === p.act); if (!a) throw new Error('Команда не выбрана'); a[3](); return 'out'; },
  sum: (p) => { const a = ACTION_LIST.find(([id]) => id === p.act); return a ? a[1] : 'не выбрана'; },
});
R('act.bible', {
  cat: 'action', name: 'Показать стих', icon: 'bible', help: 'Показать место из Библии в открытом переводе: «Ин 3:16», «1 Кор 13:4-7».',
  params: [{ id: 'ref', name: 'Место', t: 'text', def: 'Ин 3:16' }], ins: [...EXEC_IN, { id: 'ref', name: 'Место', t: 'str' }], outs: EXEC_OUT,
  run(c, p, inp) {
    const v = mcBibleRef(mcStr(inp('ref')));
    showVerses(v.bi, v.ci, v.v1, v.v2);
    return 'out';
  },
  preview(p) { try { const v = mcBibleRef(p.ref); const ch = bible.books[v.bi].chapters[v.ci]; const verses = []; for (let n = v.v1; n <= v.v2; n++) if (ch[n - 1]) verses.push({ n, t: ch[n - 1] }); return { type: 'text', verses, ref: p.ref, translation: bibleLabel(), style: styleOf('bible') }; } catch { return null; } },
  sum: (p) => p.ref || 'место не задано',
});
R('act.bibleTr', {
  cat: 'action', name: 'Сменить перевод Библии', icon: 'bible', help: 'Открыть другой перевод Библии.',
  params: [{ id: 'tr', name: 'Перевод', t: 'select', opts: mcBibleOpts, def: '' }], ins: EXEC_IN, outs: EXEC_OUT,
  async run(c, p) { if (!bibleIndex.some((b) => b.id === p.tr)) throw new Error('Перевод не найден'); await selectBible(p.tr); return 'out'; },
  sum: (p) => mcOptName(mcBibleOpts, p.tr || '') || 'не выбран',
});
R('act.macro', {
  cat: 'action', name: 'Запустить макрос', icon: 'macro', safe: true, help: 'Запускает ноды «Ручной запуск» другого макроса. Сам себя макрос не запустит (защита от зацикливания).',
  params: [{ id: 'macro', name: 'Макрос', t: 'select', opts: mcMacroOpts, def: '' }, { id: 'wait', name: 'Ждать, пока закончится', t: 'check', def: false }],
  ins: EXEC_IN, outs: EXEC_OUT,
  async run(c, p) {
    const m = lib.macros.find((x) => x.id === p.macro);
    if (!m) throw new Error('Макрос не найден');
    if (!m.enabled && !c.test) throw new Error(`Макрос «${m.name}» выключен`);
    const starts = m.nodes.filter((n) => n.type === 'trig.manual');
    if (!starts.length) throw new Error(`У макроса «${m.name}» нет ноды «Ручной запуск»`);
    const runs = starts.map((n) => mcFire(m, n, c.ev, { force: true, test: c.test, parent: c.run })).filter(Boolean);
    if (p.wait) await Promise.all(runs.map((r) => r.done));
    return 'out';
  },
  sum: (p) => mcOptName(mcMacroOpts, p.macro || '') || 'не выбран',
});
R('act.message', {
  cat: 'action', name: 'Сообщение оператору', icon: 'text', help: 'Строка внизу окна (только оператору, не на экране). Удобно проверять, что приходит по линиям.',
  params: [{ id: 'text', name: 'Текст', t: 'text', def: 'Готово' }], ins: [...EXEC_IN, { id: 'text', name: 'Текст', t: 'any' }], outs: EXEC_OUT,
  run(c, p, inp) { const t = mcStr(inp('text')); flashStatus(t); c.log('Сообщение: ' + t); return 'out'; },
  sum: (p) => (p.text ? `«${p.text}»` : ''),
});

/* ===== Выполнение ===== */

let mcSeq = 0;
let mcCur = null;               // запуск, чья нода выполняется прямо сейчас (события изнутри него — его цепочка)
const mcRuns = new Set();       // идущие запуски
const mcLastFire = new Map();   // «макрос:нода» → время срабатывания (защита от повторов)
const mcLastRun = new Map();    // макрос → последний запуск (подсветка нод в редакторе)
const mcWaiters = new Set();    // ноды «Ждать событие»
const mcLog = [];               // журнал: { t, mid, nid, text, lvl }
let mcLastRef = '';             // последнее показанное место Библии

const mcDefOf = (n) => MC_NODES[n.type] || null;
const mcPorts = (n, side) => { const d = mcDefOf(n); const x = d ? d[side] : []; return typeof x === 'function' ? x(n.p || {}) : x || []; };
const mcParam = (n, id) => { const d = mcDefOf(n); const pr = d && d.params.find((x) => x.id === id); const v = n.p ? n.p[id] : undefined; return v !== undefined ? v : pr ? pr.def : undefined; };
const mcParams = (n) => { const d = mcDefOf(n); const out = {}; if (d) for (const pr of d.params) out[pr.id] = mcParam(n, pr.id); return { ...(n.p || {}), ...out }; };

function mcLogAdd(m, nid, text, lvl = 'info') {
  mcLog.push({ t: Date.now(), mid: m ? m.id : '', name: m ? m.name : '', nid, text, lvl });
  if (mcLog.length > 300) mcLog.splice(0, mcLog.length - 300);
  mcDirty();
}

// Сработал триггер: запуск макроса от ноды node. opts: force (кнопка — без защиты от повторов), test, parent (кто вызвал)
function mcFire(m, node, ev, opts = {}) {
  const parent = opts.parent !== undefined ? opts.parent : mcCur;
  const chain = parent ? parent.chain : [];
  const name = mcDefOf(node) ? mcDefOf(node).name : node.type;
  if (chain.includes(m.id)) { mcLogAdd(m, node.id, `Зацикливание: «${m.name}» уже идёт в этой цепочке — повторный запуск пропущен`, 'warn'); return null; }
  if (chain.length >= MC_DEPTH) { mcLogAdd(m, node.id, `Слишком длинная цепочка макросов (больше ${MC_DEPTH}) — остановлено`, 'warn'); return null; }
  const busy = [...mcRuns].filter((r) => r.macro.id === m.id && !r.stopped);
  if (!opts.force) {
    const k = m.id + ':' + node.id;
    const cd = m.cooldown != null ? m.cooldown : 300;
    const now = Date.now();
    if (cd > 0 && now - (mcLastFire.get(k) || 0) < cd) return null; // то же событие подряд — один раз
    mcLastFire.set(k, now);
    if (busy.length && (m.repeat || 'skip') === 'skip') return null;
    if (busy.length && m.repeat === 'restart') busy.forEach(mcStopRun);
  }
  const run = { id: ++mcSeq, macro: m, test: !!opts.test || !!(parent && parent.test), chain: [...chain, m.id], ev: ev || {}, vals: {}, marks: new Map(), errs: new Map(), stopped: false, steps: 0, timers: new Set(), waits: new Set(), evaluating: new Set() };
  mcRuns.add(run);
  if (!parent) mcLastRun.set(m.id, run);
  mcLogAdd(m, node.id, (run.test ? 'Тест · ' : '') + `Запуск: ${name}${ev && ev.name ? ` — ${ev.name}${ev.label ? ' · ' + ev.label : ''}` : ''}`, run.test ? 'test' : 'info');
  run.done = (async () => {
    await null; // не в том же вызове, что показ слайда: интерфейс не ждёт макрос
    try {
      const d = mcDefOf(node);
      run.vals[node.id] = d && d.out ? d.out(ev || {}, mcParams(node)) : {};
      run.marks.set(node.id, 'ok');
      await mcFollow(run, node, 'out');
    } catch (err) {
      mcLogAdd(m, node.id, 'Ошибка: ' + (err && err.message ? err.message : err), 'err');
    } finally {
      mcRuns.delete(run);
      run.ended = true;
      run.timers.forEach(clearTimeout);
      if (!run.errs.size && !run.stopped) mcLogAdd(m, '', (run.test ? 'Тест · ' : '') + 'Готово', 'ok');
      mcDirty();
    }
  })();
  mcDirty();
  return run;
}

// Идти по выходу exec: все подключённые ноды — параллельно
function mcFollow(run, node, port) {
  const targets = run.macro.links.filter((l) => l.from[0] === node.id && l.from[1] === port);
  return Promise.all(targets.map((l) => mcExec(run, l.to[0], l.to[1])));
}

async function mcExec(run, nodeId, port) {
  if (run.stopped) return;
  const m = run.macro;
  const n = m.nodes.find((x) => x.id === nodeId);
  if (!n) return;
  if (++run.steps > MC_STEPS) { mcFail(run, n, new Error(`Больше ${MC_STEPS} шагов — похоже на зацикливание, макрос остановлен`)); mcStopRun(run); return; }
  const d = mcDefOf(n);
  if (!d) { mcFail(run, n, new Error(`Неизвестная нода «${n.type}» (плагин не подключён?)`)); return; }
  run.marks.set(n.id, 'run');
  mcDirty();
  let next;
  try {
    const c = mcCtx(run, n);
    const p = mcParams(n);
    const inp = (id) => mcIn(run, n, id);
    let r;
    mcCur = run;
    try {
      if (run.test && d.cat === 'action' && !d.safe) r = mcSimulate(run, n, d, p);
      else r = d.run ? d.run(c, p, inp, port) : 'out';
    } finally { mcCur = null; }
    next = await r;
  } catch (err) { mcFail(run, n, err); return; }
  if (run.stopped) return;
  run.marks.set(n.id, 'ok');
  mcDirty();
  if (next == null) return;
  await Promise.all((Array.isArray(next) ? next : [next]).map((pt) => mcFollow(run, n, pt)));
}

// Значение входа данных: по линии — выход другой ноды (датчик спрашиваем сейчас), без линии — параметр ноды
function mcIn(run, n, id) {
  const l = run.macro.links.find((x) => x.to[0] === n.id && x.to[1] === id);
  if (!l) return mcParam(n, id);
  const src = run.macro.nodes.find((x) => x.id === l.from[0]);
  if (!src) return undefined;
  const d = mcDefOf(src);
  if (d && d.eval) {
    if (run.evaluating.has(src.id)) throw new Error(`Линии данных замкнуты в круг через «${d.name}»`);
    run.evaluating.add(src.id);
    try {
      const out = d.eval(mcCtx(run, src), mcParams(src), (q) => mcIn(run, src, q)) || {};
      run.marks.set(src.id, 'ok');
      return out[l.from[1]];
    } catch (err) {
      mcFail(run, src, err);
      throw new Error(`Нет данных от «${d.name}»`);
    } finally { run.evaluating.delete(src.id); }
  }
  return (run.vals[src.id] || {})[l.from[1]];
}

function mcCtx(run, n) {
  return {
    run, node: n, macro: run.macro, ev: run.ev, test: run.test,
    stopped: () => run.stopped,
    linked: (id) => run.macro.links.some((l) => l.to[0] === n.id && l.to[1] === id),
    set: (port, v) => { (run.vals[n.id] = run.vals[n.id] || {})[port] = v; },
    follow: (port) => mcFollow(run, n, port),
    log: (text) => mcLogAdd(run.macro, n.id, text),
    // Пауза, которую «Стоп» прерывает сразу
    wait: (ms) => new Promise((resolve) => {
      if (run.stopped || ms <= 0) { resolve(); return; }
      const t = setTimeout(() => { run.timers.delete(t); run.waits.delete(resolve); resolve(); }, ms);
      run.timers.add(t);
      run.waits.add(resolve);
    }),
    // Ждать событие программы (type как у триггеров), ok — фильтр; null — не дождались
    waitEvent: (type, ok, ms) => new Promise((resolve) => {
      const w = { type, ok: ok || (() => true), done: (ev) => { mcWaiters.delete(w); run.waits.delete(stop); clearTimeout(t); resolve(ev); } };
      const stop = () => w.done(null);
      const t = ms > 0 ? setTimeout(stop, ms) : 0;
      mcWaiters.add(w);
      run.waits.add(stop);
    }),
  };
}

function mcFail(run, n, err) {
  const msg = err && err.message ? err.message : String(err);
  run.marks.set(n.id, 'err');
  run.errs.set(n.id, msg);
  const d = mcDefOf(n);
  mcLogAdd(run.macro, n.id, `«${d ? d.name : n.type}»: ${msg}`, 'err');
}

// Тестовый режим: действие не выполняется — пишем в журнал, картинку показываем в тестовом окне
function mcSimulate(run, n, d, p) {
  const sum = d.sum ? d.sum(p) : '';
  mcLogAdd(run.macro, n.id, `Тест · ${d.name}${sum ? ': ' + sum : ''}`, 'test');
  let content = null;
  try { content = d.preview ? d.preview(p) : null; } catch { content = null; }
  if (content) mcTestShow(content, d.name + (sum ? ' · ' + sum : ''));
  return 'out';
}

function mcStopRun(run) {
  if (run.stopped) return;
  run.stopped = true;
  run.timers.forEach(clearTimeout);
  [...run.waits].forEach((f) => f());
  mcLogAdd(run.macro, '', 'Остановлен', 'warn');
}
function mcStopMacro(m) { [...mcRuns].filter((r) => r.macro.id === m.id).forEach(mcStopRun); }
function mcStopAll() { [...mcRuns].forEach(mcStopRun); }

// Плавно довести значение до to за ms (40 мс шаг); «Стоп» — сразу к цели
function mcRamp(get, to, ms, set, c) {
  const from = get();
  if (!(ms > 30) || Math.abs(from - to) < 0.005) { set(to); return Promise.resolve(); }
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const k = c && c.stopped() ? 1 : Math.min(1, (performance.now() - t0) / ms);
      set(from + (to - from) * k);
      if (k >= 1) { resolve(); return; }
      setTimeout(tick, 40);
    };
    tick();
  });
}

/* ----- События программы → триггеры ----- */

// type — 'slide', 'song', 'part', 'lastPart', 'presLast', 'presEnd', 'video', 'layer', 'plAdd', 'bible', 'media', 'output', 'key', 'manual'
function mcEmit(type, ev = {}) {
  for (const w of [...mcWaiters]) if (w.type === type && w.ok(ev)) w.done(ev);
  if (!lib || !Array.isArray(lib.macros)) return false;
  let any = false;
  for (const m of lib.macros) {
    if (!m.enabled) continue;
    for (const n of m.nodes) {
      const d = mcDefOf(n);
      if (!d || d.cat !== 'trigger' || !d.on || !d.on.includes(type)) continue;
      if (d.match && !d.match(mcParams(n), ev, type)) continue;
      mcFire(m, n, ev);
      any = true;
    }
  }
  return any;
}

// Привязанные макросы (ids) — их ноды «При запуске привязанного»
function mcBound(ids, ev) {
  if (!ids.length || !lib || !lib.macros) return;
  for (const id of new Set(ids)) {
    const m = lib.macros.find((x) => x.id === id);
    if (!m || !m.enabled) continue;
    m.nodes.filter((n) => n.type === 'trig.bound').forEach((n) => mcFire(m, n, ev));
  }
}

let mcPrev = null; // что было на экране до этого слайда: { vk, key, itemId, part, occ, wasLast, name }

// Показан слайд из плейлиста или библиотеки (playlist.js → showSlide)
function mcSlideShown(x, slide, vk) {
  if (!lib) return;
  const item = x.item;
  const index = item.slides.indexOf(slide);
  const ev = {
    item, itemId: item.id, slide, entry: x.entry, key: x.key, view: vk, name: item.name, label: slide.label || '',
    text: mcSlideText(slide), kind: slide.k, index, total: item.slides.length, part: slide.part !== undefined ? slide.part : '', occ: slide.occ || 0,
  };
  const prev = mcPrev;
  const newItem = !prev || prev.vk !== vk || prev.key !== x.key;
  const pi = slide.part !== undefined ? mcParts(item, slide) : null;
  const newPart = !!pi && (newItem || prev.part !== slide.part || prev.occ !== slide.occ);
  mcPrev = { vk, key: x.key, itemId: item.id, part: slide.part, occ: slide.occ, wasLast: index === item.slides.length - 1, name: item.name, item };
  if (newItem && prev && prev.wasLast) mcEmit('presEnd', { item: prev.item, itemId: prev.itemId, name: prev.name });
  mcEmit('slide', ev);
  if (newItem && (item.song || item.kind === 'song')) mcEmit('song', ev);
  if (newPart) mcEmit('part', ev);
  if (newPart && pi.last) mcEmit('lastPart', ev);
  if (index === item.slides.length - 1) mcEmit('presLast', ev);
  if (slide.k === 'bible') { const v = mcBibleFromSlide(slide); if (v) mcBibleShown(v, true); }
  if (slide.k === 'image' || slide.k === 'video') mcEmit('media', { name: slide.name || fileName(slide.path), path: slide.path });
  // Привязанные макросы: к слайду, к части (на первом её слайде), к пункту и презентации (при переходе на неё), к файлу
  const ids = [...(slide.macros || [])];
  if (newPart && item.partMacros) ids.push(...(item.partMacros[slide.part] || []));
  if (newItem) ids.push(...(item.macros || []), ...((x.entry && x.entry.macros) || []));
  if (slide.path && lib.fileMacros && lib.fileMacros[slide.path]) ids.push(...lib.fileMacros[slide.path]);
  mcBound(ids, ev);
}

// Показано место из Библии (renderer.js → showVerses/showKeys; слайд Библии из плейлиста)
function mcBibleShown(v, fromSlide) {
  mcLastRef = v.ref || '';
  if (!fromSlide) mcPrev = null;
  const text = bible && bible.books[v.bi] ? (bible.books[v.bi].chapters[v.ci] || []).slice(v.v1 - 1, v.v2).join(' ') : '';
  mcEmit('bible', { ...v, text, name: v.ref });
}
function mcBibleFromSlide(s) {
  if (!bible || !s.ref) return null;
  const r = Bible.parseRef(s.ref);
  const bi = r ? Bible.findBook(bible, r.token) : -1;
  return bi < 0 ? { ref: s.ref, bi: -1, ci: 0, v1: 0, v2: 0 } : { ref: s.ref, bi, ci: r.ch - 1, v1: r.v1, v2: r.v2 };
}
// «Ин 3:16» в параметре триггера ↔ показанное место
function mcRefMatch(ref, ev) {
  if (!ref || !ref.trim()) return true;
  if (!bible || ev.bi < 0) return (ev.ref || '').toLowerCase().startsWith(ref.trim().toLowerCase());
  const r = Bible.parseRef(ref);
  const bi = r ? Bible.findBook(bible, r.token) : -1;
  if (bi < 0 || bi !== ev.bi) return false;
  if (!/\d/.test(ref)) return true;         // только книга
  if (r.ch - 1 !== ev.ci) return false;
  if (!r.v1) return true;                   // вся глава
  return ev.v1 <= r.v2 && ev.v2 >= r.v1;    // стихи пересекаются
}
function mcBibleRef(ref) {
  if (!bible) throw new Error('Библия не загружена');
  const r = oneChapterFix(Bible.parseRef(ref || ''));
  if (!r) throw new Error(`Не понятно место «${ref}». Пример: Ин 3:16`);
  const bi = Bible.findBook(bible, r.token);
  if (bi < 0) throw new Error(`Книга «${r.token}» не найдена в переводе`);
  const ch = bible.books[bi].chapters[r.ch - 1];
  if (!ch || !ch.length) throw new Error(`Нет главы ${r.ch}`);
  const v1 = Math.max(1, r.v1 || 1);
  return { bi, ci: r.ch - 1, v1, v2: Math.min(ch.length, Math.max(v1, r.v2 || v1)) };
}

// Фото или видео из медиапула (tools.js → poolShow)
function mcMediaShown(f) {
  if (!lib) return;
  const ev = { name: f.name, path: f.path, label: f.name };
  mcEmit('media', ev);
  if (lib.fileMacros && lib.fileMacros[f.path]) mcBound(lib.fileMacros[f.path], ev);
}

// Слой: что-то показали (was — слой уже был занят) или очистили (renderer.js → present, clearLayer, clearScreen)
function mcLayerEvt(evName, id, was, label) {
  const l = layerById(id);
  mcEmit('layer', { ev: evName, layer: id, was, name: l ? layerName(l) : id, label: label || '' });
  if (evName === 'clear') mcAfterEnd.delete(id);
}

// Видео: start — новое на экране (present), play / pause / ended — от видео в предпросмотре (music.js)
function mcVideoEvt(evName, name) {
  mcEmit('video', { ev: evName, name: name || ((videoLayer() || {}).label || '') });
  if (evName !== 'ended') return;
  for (const [id, w] of [...mcAfterEnd]) {
    if (!layerOn[id] || layerOn[id].content.url !== w.url) { mcAfterEnd.delete(id); continue; }
    mcAfterEnd.delete(id);
    const l = layerById(id);
    if (w.fade > 0 && l) {
      const was = l.opacity != null ? l.opacity : 1;
      mcRamp(() => was, 0, w.fade, (v) => { l.opacity = v; sendLayers(); }).then(() => { clearLayer(id, true); l.opacity = was; sendLayers(); });
    } else clearLayer(id);
  }
}

// Плейлисты сохранились — новые записи → «Добавлено в плейлист» (ловим все пути добавления разом)
let mcPlSeen = null;
function mcPlSnap() { mcPlSeen = new Map((lib.playlists || []).map((p) => [p.id, new Set(p.entries.map((e) => e.eid))])); }
function mcLibSaved() {
  if (!lib) return;
  if (!mcPlSeen) { mcPlSnap(); return; }
  const added = [];
  for (const p of lib.playlists) {
    const seen = mcPlSeen.get(p.id);
    if (!seen) continue; // новый плейлист — его содержимое не считаем добавленным
    for (const e of p.entries) if (!seen.has(e.eid) && lib.items[e.item]) added.push({ plId: p.id, plName: p.name, item: lib.items[e.item], itemId: e.item, name: lib.items[e.item].name });
  }
  mcPlSnap();
  added.forEach((ev) => mcEmit('plAdd', ev));
}

// Горячая клавиша: макрос (своя клавиша → ручной запуск) или нода «Горячая клавиша». true — клавишу забрал макрос
function mcKey(combo) {
  if (!lib || !Array.isArray(lib.macros) || mcKeyWait) return false;
  let any = false;
  for (const m of lib.macros) if (m.enabled && m.key === combo) { mcRunManual(m, false); any = true; }
  return mcEmit('key', { combo, name: prettyCombo(combo) }) || any;
}

// Ручной запуск (кнопка, клавиша макроса): ноды «Ручной запуск»; если их нет — все триггеры, с данными того, что на экране
function mcRunManual(m, test) {
  let starts = m.nodes.filter((n) => n.type === 'trig.manual');
  if (!starts.length) starts = m.nodes.filter((n) => mcDefOf(n) && mcDefOf(n).cat === 'trigger');
  if (!starts.length) { flashStatus(`В макросе «${m.name}» нет триггера — добавьте «Ручной запуск»`); return []; }
  const ev = mcNowEvent();
  if (test) mcTestOpen();
  return starts.map((n) => mcFire(m, n, ev, { force: true, test, parent: null })).filter(Boolean);
}
// Данные «как будто событие сейчас» — для ручного и тестового запуска
function mcNowEvent() {
  const s = mcShown();
  if (s) return { item: s.item, itemId: s.item.id, slide: s.slide, entry: s.x.entry, name: s.item.name, label: s.slide.label || '', text: mcSlideText(s.slide), kind: s.slide.k, index: s.index, total: s.total, part: s.slide.part || '', occ: s.slide.occ || 0 };
  return { name: liveLabel || '', label: '', ref: mcLastRef };
}

/* ===== Привязка макросов к слайдам, пунктам, частям песен и файлам ===== */

const mcById = (id) => (lib && lib.macros ? lib.macros.find((m) => m.id === id) || null : null);
const mcList = (arr) => (arr || []).filter((id) => mcById(id));

// Нет триггера «При запуске привязанного» — добавить слева и соединить с первой нодой без входа
function mcEnsureBound(m) {
  if (m.nodes.some((n) => n.type === 'trig.bound')) return;
  const start = m.nodes.filter((n) => mcDefOf(n) && mcDefOf(n).cat !== 'trigger' && mcPorts(n, 'ins').some((p) => p.t === 'exec' && p.id === 'in') && !m.links.some((l) => l.to[0] === n.id && l.to[1] === 'in'))
    .sort((a, b) => a.x - b.x)[0];
  const xs = m.nodes.map((n) => n.x);
  const node = { id: newId(), type: 'trig.bound', x: (xs.length ? Math.min(...xs) : 80) - 250, y: start ? start.y : 80, p: {} };
  m.nodes.push(node);
  if (start) m.links.push({ id: newId(), from: [node.id, 'out'], to: [start.id, 'in'] });
}

function mcAttach(list, holder, key, m) {
  if (!holder[key]) holder[key] = [];
  if (holder[key].includes(m.id)) { flashStatus(`«${m.name}» уже привязан: ${list}`); return; }
  holder[key].push(m.id);
  mcEnsureBound(m);
  saveLib();
  renderService();
  if (typeof drawPoolGrid === 'function' && poolData && $('poolGrid') && !$('pool').hidden) drawPoolGrid();
  mcRenderAll();
  flashStatus(`Макрос «${m.name}» → ${list}. Сработает при запуске · Ctrl+Z — отменить`);
}

// Куда бросили макрос (слайд ленты, заголовок пункта ленты, строка «Содержания», файл медиапула)
function mcDropTarget(el) {
  if (!el || !el.closest || !lib) return null;
  const sl = el.closest('#svcFeed .sl[data-sid]');
  if (sl) return { kind: 'slide', el: sl, key: sl.dataset.key, sid: sl.dataset.sid };
  const head = el.closest('#svcFeed .svc-ihead');
  if (head && head.parentElement.dataset.key) return { kind: 'item', el: head, key: head.parentElement.dataset.key };
  const sub = el.closest('.svc-sub[data-key]');
  if (sub) return { kind: 'entry', el: sub, key: sub.dataset.key };
  const pf = el.closest('.pf[data-path]');
  if (pf) return { kind: 'file', el: pf, path: pf.dataset.path, name: pf.title.split('\n')[0] };
  return null;
}

function mcDropAt(t, m, e) {
  if (t.kind === 'file') { if (!lib.fileMacros) lib.fileMacros = {}; mcAttach(`файл «${t.name}»`, lib.fileMacros, t.path, m); return; }
  if (t.kind === 'entry') {
    const x = entryByKey(t.key);
    if (!x) return;
    if (x.entry) mcAttach(`пункт плейлиста «${x.item.name}»`, x.entry, 'macros', m);
    else mcAttach(`«${x.item.name}»`, x.item, 'macros', m);
    return;
  }
  const x = workEntry(t.key);
  if (!x) return;
  if (t.kind === 'item') { mcAttach(`«${x.item.name}» (вся презентация)`, x.item, 'macros', m); return; }
  const slide = x.item.slides.find((s) => s.id === t.sid);
  if (!slide) return;
  const label = slide.label || `слайд ${x.item.slides.indexOf(slide) + 1}`;
  const opts = [{ label: `Этот слайд («${label}»)`, fn: () => mcAttach(`слайд «${label}»`, slide, 'macros', m) }];
  if (slide.part !== undefined && slide.part !== '') opts.push({ label: `Часть «${slide.part}» (все её повторы)`, fn: () => { if (!x.item.partMacros) x.item.partMacros = {}; mcAttach(`часть «${slide.part}» песни «${x.item.name}»`, x.item.partMacros, slide.part, m); } });
  if (x.item.slides.length > 1) opts.push({ label: `${x.item.song ? 'Вся песня' : 'Вся презентация'} «${x.item.name}»`, fn: () => mcAttach(`«${x.item.name}»`, x.item, 'macros', m) });
  if (x.entry) opts.push({ label: 'Только этот пункт плейлиста', fn: () => mcAttach(`пункт плейлиста «${x.item.name}»`, x.entry, 'macros', m) });
  if (opts.length === 1) { opts[0].fn(); return; }
  showMenu(e, [{ label: `Привязать «${m.name}» к…`, disabled: true, fn: () => {} }, '-', ...opts]);
}

// То же без мыши: правая кнопка по слайду или пункту → «Привязать макрос…»
function mcAttachMenu(e, t) {
  showMenu(e, lib.macros.map((m) => ({ label: m.name + (m.enabled ? '' : ' (выключен)'), fn: () => mcDropAt(t, m, e) })));
}

let mcHot = null;
function mcHilite(el) { if (mcHot === el) return; if (mcHot) mcHot.classList.remove('mc-drop'); mcHot = el; if (el) el.classList.add('mc-drop'); }
document.addEventListener('dragover', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.types.includes(MC_DT)) return;
  const t = mcDropTarget(e.target);
  mcHilite(t ? t.el : null);
  if (!t) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
}, true);
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.types.includes(MC_DT)) return;
  e.preventDefault();
  e.stopPropagation();
  mcHilite(null);
  const m = mcById(e.dataTransfer.getData(MC_DT));
  const t = mcDropTarget(e.target);
  if (!m) return;
  if (!t) { flashStatus('Бросьте макрос на слайд, пункт плейлиста, заголовок песни или файл медиапула'); return; }
  mcDropAt(t, m, e);
}, true);
document.addEventListener('dragend', () => mcHilite(null), true);

// Значок макроса на слайде, пункте, файле: число привязанных; щелчок — меню (открыть, отвязать)
// refs: [{ holder, key, where }] — где лежат списки id
function mcBadge(el, refs) {
  if (!lib || !lib.macros || !lib.macros.length) return;
  const list = refs.flatMap((r) => mcList(r.holder && r.holder[r.key]).map((id) => ({ ...r, m: mcById(id) })));
  if (!list.length) return;
  const b = Object.assign(document.createElement('span'), { className: 'mc-badge', title: 'Макросы: ' + list.map((x) => `«${x.m.name}» (${x.where})`).join(', ') + '\nЩелчок — открыть или отвязать' });
  b.innerHTML = Icons.svg('macro');
  if (list.length > 1) b.append(Object.assign(document.createElement('b'), { textContent: list.length }));
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  b.addEventListener('dblclick', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    showMenu(e, list.flatMap((x) => [
      { label: `Открыть «${x.m.name}»`, fn: () => openMacroTab(x.m.id) },
      { label: `Запустить «${x.m.name}»`, fn: () => mcRunManual(x.m, false) },
      { label: `Отвязать от: ${x.where}`, fn: () => { x.holder[x.key] = x.holder[x.key].filter((id) => id !== x.m.id); if (!x.holder[x.key].length) delete x.holder[x.key]; saveLib(); renderService(); mcRenderAll(); flashStatus(`«${x.m.name}» отвязан · Ctrl+Z — вернуть`); } },
      '-',
    ]).slice(0, -1));
  });
  el.append(b);
}
// Для слайда ленты: слайд, его часть, его файл
function mcSlideBadge(el, item, slide) {
  const refs = [{ holder: slide, key: 'macros', where: 'слайд' }];
  if (slide.part !== undefined && item.partMacros) refs.push({ holder: item.partMacros, key: slide.part, where: `часть «${slide.part}»` });
  if (slide.path && lib.fileMacros) refs.push({ holder: lib.fileMacros, key: slide.path, where: 'файл' });
  mcBadge(el.querySelector('.pic') || el, refs);
}
function mcItemBadge(el, x) {
  mcBadge(el, [{ holder: x.item, key: 'macros', where: 'презентация' }, ...(x.entry ? [{ holder: x.entry, key: 'macros', where: 'пункт плейлиста' }] : [])]);
}
function mcFileBadge(el, path) { if (lib && lib.fileMacros) mcBadge(el, [{ holder: lib.fileMacros, key: path, where: 'файл' }]); }

// Где привязан макрос: [{ where, remove }]
function mcBindings(m) {
  const out = [];
  const add = (holder, key, where) => { if ((holder[key] || []).includes(m.id)) out.push({ where, remove: () => { holder[key] = holder[key].filter((id) => id !== m.id); if (!holder[key].length) delete holder[key]; } }); };
  for (const it of Object.values(lib.items)) {
    add(it, 'macros', `«${it.name}»`);
    for (const [part, ids] of Object.entries(it.partMacros || {})) if (ids.includes(m.id)) add(it.partMacros, part, `«${it.name}» · часть «${part}»`);
    it.slides.forEach((s, i) => add(s, 'macros', `«${it.name}» · слайд ${i + 1}${s.label ? ` «${s.label}»` : ''}`));
  }
  for (const p of lib.playlists) for (const e of p.entries) if (lib.items[e.item]) add(e, 'macros', `плейлист «${p.name}» · «${lib.items[e.item].name}»`);
  for (const path of Object.keys(lib.fileMacros || {})) add(lib.fileMacros, path, `файл «${fileName(path)}»`);
  return out;
}
// Макрос удалили — убрать его отовсюду (Ctrl+Z вернёт всё вместе)
function mcPrune(id) {
  const m = { id };
  mcBindings(m).forEach((b) => b.remove());
}

/* ===== Редактор (вкладка «Макросы») ===== */

let mcOpenId = '';
const mcSel = { nodes: new Set(), links: new Set(), frames: new Set(), notes: new Set() };
let mcView = { x: 0, y: 0, z: 1 };   // сдвиг и масштаб холста (свои у каждого макроса — m.view)
let mcClip = null;                  // скопированные ноды
let mcKeyWait = null;               // ждём сочетание клавиш для параметра или макроса
const mcOpen = () => mcById(mcOpenId);

function mcNewMacro(name) {
  return { id: newId(), name: name || freeMacroName('Макрос'), enabled: true, repeat: 'skip', cooldown: 300, nodes: [], links: [], frames: [], notes: [] };
}
function freeMacroName(base) {
  const names = new Set((lib.macros || []).map((m) => m.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
// Макрос из старых данных или файла — дописать недостающие поля
function mcNorm(m) {
  m.nodes = Array.isArray(m.nodes) ? m.nodes.filter((n) => n && n.id && n.type) : [];
  m.links = Array.isArray(m.links) ? m.links.filter((l) => l && Array.isArray(l.from) && Array.isArray(l.to)) : [];
  m.frames = Array.isArray(m.frames) ? m.frames : [];
  m.notes = Array.isArray(m.notes) ? m.notes : [];
  if (m.enabled === undefined) m.enabled = true;
  if (!m.repeat) m.repeat = 'skip';
  if (m.cooldown == null) m.cooldown = 300;
  return m;
}

// Открыть вкладку «Макросы» (с нужным макросом)
function openMacroTab(id) {
  if (id) mcSelectMacro(id);
  setTab('macros');
}
function mcTabOpen() {
  if (!lib) return;
  if (!mcOpen()) mcOpenId = lib.macros[0] ? lib.macros[0].id : '';
  mcRenderAll();
  requestAnimationFrame(mcRenderWires);
}

function mcSelectMacro(id) {
  const old = mcOpen();
  if (old) old.view = { ...mcView };
  mcOpenId = id;
  mcClearSel();
  const m = mcOpen();
  mcView = m && m.view ? { ...m.view } : { x: 40, y: 40, z: 1 };
  mcRenderAll();
}
function mcClearSel() { Object.values(mcSel).forEach((s) => s.clear()); }

function mcEdit(fn) { const m = mcOpen(); if (!m) return; fn(m); saveLib(); }

function mcRenderAll() {
  if (!lib || !$('macrosView')) return;
  mcRenderList();
  mcRenderDock();
  if (tab !== 'macros') return;
  mcRenderCanvas();
  mcRenderProps();
  mcRenderLog();
}

// Обновление после выполнения (подсветка нод, точки в списке, журнал) — не чаще кадра
let mcDirtyRaf = 0;
function mcDirty() {
  if (mcDirtyRaf) return;
  mcDirtyRaf = requestAnimationFrame(() => {
    mcDirtyRaf = 0;
    mcPaintStatus();
    if (tab === 'macros') mcRenderLog();
  });
}
function mcPaintStatus() {
  if (!lib || !lib.macros) return;
  document.querySelectorAll('[data-mc-status]').forEach((el) => {
    const id = el.dataset.mcStatus;
    const running = [...mcRuns].some((r) => r.macro.id === id && !r.stopped);
    const last = mcLastRun.get(id);
    el.className = 'mc-st' + (running ? ' run' : last && last.errs.size ? ' err' : last && last.ended ? ' ok' : '');
    el.title = running ? 'Выполняется' : last && last.errs.size ? 'Последний запуск — с ошибкой' : last ? 'Последний запуск — без ошибок' : 'Ещё не запускался';
  });
  const m = mcOpen();
  if (!m || tab !== 'macros') return;
  const run = mcLastRun.get(m.id);
  $('mcWorld').querySelectorAll('.mc-node').forEach((el) => {
    const st = run ? run.marks.get(el.dataset.id) : '';
    el.classList.toggle('run', st === 'run' && !run.ended && !run.stopped);
    el.classList.toggle('ok', st === 'ok');
    el.classList.toggle('err', st === 'err');
    const err = run && run.errs.get(el.dataset.id);
    const box = el.querySelector('.mc-nerr');
    box.hidden = !err;
    box.textContent = err || '';
  });
  $('mcStop').disabled = ![...mcRuns].some((r) => r.macro.id === m.id);
}

/* ----- Список макросов ----- */

function mcRenderList() {
  const box = $('mcList');
  const list = lib.macros || [];
  if (!list.length) {
    box.replaceChildren(Object.assign(document.createElement('div'), { className: 'te-empty', textContent: 'Макросов пока нет. «＋» — новый, или возьмите готовый пример (кнопка рядом).' }));
    return;
  }
  box.replaceChildren(...list.map((m) => {
    const row = Object.assign(document.createElement('div'), { className: 'mc-mrow' + (m.id === mcOpenId ? ' sel' : '') + (m.enabled ? '' : ' off'), draggable: true, title: 'Перетащите на слайд, пункт плейлиста или файл медиапула — привяжется. Правая кнопка — меню' });
    const chk = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!m.enabled, title: m.enabled ? 'Включён — выключить' : 'Выключен — включить' });
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => { m.enabled = chk.checked; saveLib(); mcRenderAll(); });
    const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: m.name });
    const st = Object.assign(document.createElement('span'), { className: 'mc-st' });
    st.dataset.mcStatus = m.id;
    row.append(chk, mcIconEl(m), st, nm);
    if (m.key) row.append(Object.assign(document.createElement('span'), { className: 'mc-key', textContent: prettyCombo(m.key) }));
    const n = mcBindings(m).length;
    if (n) row.append(Object.assign(document.createElement('span'), { className: 'mc-cnt', textContent: String(n), title: `Привязан к объектам: ${n}` }));
    row.addEventListener('click', () => mcSelectMacro(m.id));
    row.addEventListener('dblclick', () => mcRenameMacro(m));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); mcMacroMenu(e, m); });
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData(MC_DT, m.id); e.dataTransfer.effectAllowed = 'copy'; });
    return row;
  }));
  mcPaintStatus();
}

function mcMacroMenu(e, m) {
  showMenu(e, [
    { label: 'Запустить', fn: () => mcRunManual(m, false) },
    { label: 'Тест (без вывода на экран)', fn: () => mcRunManual(m, true) },
    '-',
    { label: 'Переименовать…', fn: () => mcRenameMacro(m) },
    { label: 'Иконка…', fn: () => mcIconPick({ getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY, bottom: e.clientY }) }, m) },
    { label: m.enabled ? 'Выключить' : 'Включить', fn: () => { m.enabled = !m.enabled; saveLib(); mcRenderAll(); } },
    { label: 'Копия макроса', fn: () => mcDuplicate(m) },
    { label: 'Экспорт в файл…', fn: () => mcExport([m]) },
    '-',
    { label: 'Удалить', fn: () => mcDelete(m) },
  ]);
}
async function mcRenameMacro(m) {
  const name = await askName('Название макроса', m.name);
  if (!name) return;
  m.name = name;
  saveLib();
  mcRenderAll();
}
function mcDuplicate(m) {
  const c = mcNorm(JSON.parse(JSON.stringify(m)));
  c.id = newId();
  c.name = freeMacroName(m.name + ' (копия)');
  delete c.key; // одна клавиша — один макрос
  lib.macros.splice(lib.macros.indexOf(m) + 1, 0, c);
  saveLib();
  mcSelectMacro(c.id);
}
function mcDelete(m) {
  mcStopMacro(m);
  lib.macros = lib.macros.filter((x) => x !== m);
  mcPrune(m.id);
  if (mcOpenId === m.id) mcOpenId = lib.macros[0] ? lib.macros[0].id : '';
  saveLib();
  renderService();
  mcSelectMacro(mcOpenId);
  flashStatus(`Макрос «${m.name}» удалён · Ctrl+Z — вернуть`);
}
function mcAdd(m) {
  lib.macros.push(m);
  saveLib();
  mcSelectMacro(m.id);
  if (tab !== 'macros') setTab('macros');
}

/* ----- Готовые примеры (из ТЗ) ----- */
const MC_TEMPLATES = [
  {
    name: 'Пустой с ручным запуском',
    about: 'Только «Ручной запуск» — дальше собираете сами.',
    make: () => ({ nodes: [{ id: 'n1', type: 'trig.manual', x: 60, y: 80, p: {} }], links: [] }),
  },
  {
    name: 'Запустить презентацию по клавише',
    about: 'Одна клавиша — нужная презентация на экране. Презентацию найдите поиском, клавишу задайте у макроса.',
    make: () => ({
      nodes: [
        { id: 'n1', type: 'trig.manual', x: 40, y: 60, p: {} },
        { id: 'n2', type: 'act.showItem', x: 320, y: 60, p: { mode: 'first', open: true } },
      ],
      links: [{ id: 'l1', from: ['n1', 'out'], to: ['n2', 'in'] }],
      notes: [{ id: 'c1', x: 40, y: 260, w: 420, h: 130, text: '1. Щёлкните по ноде «Запустить презентацию» → справа выберите, где искать (библиотека или плейлист), напишите часть названия и щёлкните по нужной.\n2. Щёлкните по пустому месту холста → «Горячая клавиша» макроса.\n3. Включите галочку у макроса в списке.' }],
    }),
  },
  {
    name: 'Предупредить: осталось 2 слайда',
    about: 'Пример датчика: на каждом слайде спрашиваем «сколько осталось?» и пишем оператору, когда пора готовить следующее.',
    make: () => ({
      nodes: [
        { id: 'n1', type: 'trig.slide', x: 40, y: 60, p: {} },
        { id: 'n2', type: 'sen.left', x: 40, y: 280, p: {} },
        { id: 'n3', type: 'log.compare', x: 320, y: 280, p: { op: 'le', b: '2' } },
        { id: 'n4', type: 'log.if', x: 600, y: 60, p: {} },
        { id: 'n5', type: 'act.message', x: 880, y: 40, p: { text: 'Осталось 2 слайда — готовьте следующий пункт' } },
      ],
      links: [
        { id: 'l1', from: ['n1', 'out'], to: ['n4', 'in'] },
        { id: 'l2', from: ['n2', 'left'], to: ['n3', 'a'] },
        { id: 'l3', from: ['n3', 'v'], to: ['n4', 'cond'] },
        { id: 'l4', from: ['n4', 'yes'], to: ['n5', 'in'] },
      ],
      notes: [{ id: 'c1', x: 600, y: 280, w: 380, h: 120, text: 'Датчик «Сколько слайдов осталось» сам ничего не делает: когда «Если» доходит до проверки, он смотрит на экран и отвечает числом. «Сравнить»: число ≤ 2 → да. Поменяйте 2 на своё в свойствах «Сравнить».' }],
    }),
  },
  {
    name: 'Объявления по кругу (каждые 6 с)',
    about: 'Показать презентацию объявлений и листать слайды сами, 20 раз подряд. Кнопка «Стоп» — прервать.',
    make: () => ({
      nodes: [
        { id: 'n1', type: 'trig.manual', x: 40, y: 60, p: {} },
        { id: 'n2', type: 'act.showItem', x: 300, y: 60, p: { mode: 'first', open: true } },
        { id: 'n3', type: 'log.loop', x: 580, y: 60, p: { n: 20, sec: 0 } },
        { id: 'n4', type: 'log.delay', x: 840, y: 40, p: { sec: 6 } },
        { id: 'n5', type: 'act.goSlide', x: 1080, y: 40, p: { mode: 'next' } },
      ],
      links: [
        { id: 'l1', from: ['n1', 'out'], to: ['n2', 'in'] },
        { id: 'l2', from: ['n2', 'out'], to: ['n3', 'in'] },
        { id: 'l3', from: ['n3', 'body'], to: ['n4', 'in'] },
        { id: 'l4', from: ['n4', 'out'], to: ['n5', 'in'] },
      ],
      notes: [{ id: 'c1', x: 300, y: 280, w: 420, h: 110, text: 'В «Запустить презентацию» найдите презентацию объявлений. «Повтор» 20 раз: подождать 6 с → следующий слайд. Время — в «Задержке», число повторов — в «Повторе».' }],
    }),
  },
  {
    name: 'Припев — какой по счёту',
    about: 'Датчик «Текущая часть» передаёт данные по линии: какой раз пошёл припев — и это число пишется оператору.',
    make: () => ({
      nodes: [
        { id: 'n1', type: 'trig.part', x: 40, y: 60, p: { part: 'Припев' } },
        { id: 'n2', type: 'sen.part', x: 40, y: 280, p: {} },
        { id: 'n3', type: 'act.message', x: 340, y: 60, p: { text: '' } },
      ],
      links: [
        { id: 'l1', from: ['n1', 'out'], to: ['n3', 'in'] },
        { id: 'l2', from: ['n2', 'occ'], to: ['n3', 'text'] },
      ],
      notes: [{ id: 'c1', x: 340, y: 280, w: 380, h: 100, text: 'Каждый раз, когда начинается припев, датчик «Текущая часть» говорит, какой это по счёту повтор, а «Сообщение» показывает это число внизу окна.' }],
    }),
  },
  {
    name: 'Фоновое видео на последней части песни',
    about: 'Датчики «Текущая часть» и «Последняя часть?»: на последней части песни включается видео и стихает звук.',
    make: () => ({
      nodes: [
        { id: 'n1', type: 'trig.slide', x: 40, y: 60, p: { kind: 'text' } },
        { id: 'n2', type: 'sen.part', x: 40, y: 300, p: {} },
        { id: 'n3', type: 'sen.lastPart', x: 300, y: 300, p: {} },
        { id: 'n4', type: 'log.if', x: 560, y: 80, p: {} },
        { id: 'n5', type: 'act.media', x: 820, y: 40, p: { file: null, layer: 'media', vol: 100, after: 'loop' } },
        { id: 'n6', type: 'act.volume', x: 1090, y: 40, p: { to: 'layer', layer: 'media', v: 30, sec: 0 } },
      ],
      links: [
        { id: 'l1', from: ['n1', 'out'], to: ['n4', 'in'] },
        { id: 'l2', from: ['n2', 'part'], to: ['n3', 'part'] },
        { id: 'l3', from: ['n3', 'yes'], to: ['n4', 'cond'] },
        { id: 'l4', from: ['n4', 'yes'], to: ['n5', 'in'] },
        { id: 'l5', from: ['n5', 'out'], to: ['n6', 'in'] },
      ],
      notes: [{ id: 'c1', x: 560, y: 300, w: 300, h: 110, text: 'Выберите видео в ноде «Запустить видео или фото». Если часть не последняя — макрос ничего не делает.' }],
    }),
  },
  {
    name: 'Фон для стиха Библии',
    about: 'Показали Ин 3:16 — под стихом появляется выбранная картинка.',
    make: () => ({
      nodes: [
        { id: 'n1', type: 'trig.bible', x: 40, y: 60, p: { ref: 'Ин 3:16' } },
        { id: 'n2', type: 'act.clearLayer', x: 300, y: 60, p: { layer: 'media' } },
        { id: 'n3', type: 'act.media', x: 560, y: 60, p: { file: null, layer: 'media' } },
        { id: 'n4', type: 'act.layerSet', x: 830, y: 60, p: { layer: 'media', what: 'opacity', v: 100, sec: 0 } },
      ],
      links: [
        { id: 'l1', from: ['n1', 'out'], to: ['n2', 'in'] },
        { id: 'l2', from: ['n2', 'out'], to: ['n3', 'in'] },
        { id: 'l3', from: ['n3', 'out'], to: ['n4', 'in'] },
      ],
      notes: [{ id: 'c1', x: 300, y: 300, w: 320, h: 100, text: 'Выберите картинку в ноде «Запустить видео или фото». Картинка остаётся при смене слайда, пока её не уберёт другая команда.' }],
    }),
  },
  {
    name: 'Припев — другая тема',
    about: 'На первом слайде припева слайду ставится другая тема.',
    make: () => ({
      nodes: [
        { id: 'n1', type: 'trig.part', x: 40, y: 60, p: { part: 'Припев' } },
        { id: 'n2', type: 'act.theme', x: 300, y: 60, p: { to: 'slide' } },
      ],
      links: [{ id: 'l1', from: ['n1', 'out'], to: ['n2', 'in'] }],
    }),
  },
];
function mcFromTemplate(t) {
  const m = mcNewMacro(freeMacroName(t.name));
  const g = t.make();
  // свои id: ноды можно копировать между макросами без путаницы
  const map = {};
  m.nodes = g.nodes.map((n) => { map[n.id] = newId(); return { ...n, id: map[n.id] }; });
  m.links = g.links.map((l) => ({ id: newId(), from: [map[l.from[0]], l.from[1]], to: [map[l.to[0]], l.to[1]] }));
  m.notes = (g.notes || []).map((x) => ({ ...x, id: newId() }));
  m.frames = (g.frames || []).map((x) => ({ ...x, id: newId() }));
  mcAdd(m);
}

/* ----- Импорт и экспорт ----- */
async function mcExport(list) {
  if (!list.length) return;
  const file = await window.api.saveJson({ name: list.length === 1 ? list[0].name : 'Макросы', data: { app: 'church-presenter', kind: 'macros', version: 1, macros: list }, title: 'Экспорт макросов', label: 'Макросы MP Show' });
  if (file) flashStatus('Сохранено: ' + fileName(file));
}
async function mcImport() {
  const res = await window.api.openJson({ title: 'Импорт макросов', label: 'Макросы (JSON)' });
  if (!res) return;
  const list = res.ok && res.data && Array.isArray(res.data.macros) ? res.data.macros.filter((m) => m && Array.isArray(m.nodes)) : [];
  if (!list.length) { showNotice('В файле нет макросов', true); return; }
  // новые id макросов; ссылки «Запустить макрос» внутри файла — на новые id
  const map = {};
  list.forEach((m) => { map[m.id] = newId(); });
  const keys = new Set(lib.macros.map((m) => m.key).filter(Boolean));
  for (const src of list) {
    const m = mcNorm(JSON.parse(JSON.stringify(src)));
    m.id = map[src.id];
    m.name = freeMacroName(m.name || 'Макрос');
    if (m.key && keys.has(m.key)) delete m.key;
    m.nodes.forEach((n) => { if (n.type === 'act.macro' && n.p && map[n.p.macro]) n.p.macro = map[n.p.macro]; });
    lib.macros.push(m);
  }
  saveLib();
  mcSelectMacro(map[list[0].id]);
  flashStatus(`Добавлено макросов: ${list.length}. Презентации и файлы в нодах проверьте — на этом компьютере их может не быть`);
}

/* ----- Библиотека нод (слева): перетащите на холст или двойной щелчок ----- */
function mcRenderLib() {
  const q = $('mcLibFilter').value.trim().toLowerCase();
  const box = $('mcLib');
  box.replaceChildren();
  for (const [cat, c] of Object.entries(MC_CATS)) {
    const types = Object.entries(MC_NODES).filter(([, d]) => d.cat === cat && (!q || d.name.toLowerCase().includes(q) || (d.help || '').toLowerCase().includes(q)));
    if (!types.length) continue;
    const g = Object.assign(document.createElement('div'), { className: 'mc-lgrp cat-' + cat });
    g.append(Object.assign(document.createElement('div'), { className: 'mc-lhead', textContent: c.name, title: c.hint }));
    for (const [type, d] of types) {
      const it = Object.assign(document.createElement('div'), { className: 'mc-litem', draggable: true, title: (d.help || d.name) + '\nПеретащите на холст или дважды щёлкните' });
      it.append(Icons.el(d.icon || c.icon), Object.assign(document.createElement('span'), { textContent: d.name }));
      it.addEventListener('dragstart', (e) => { e.dataTransfer.setData(MC_NODE_DT, type); e.dataTransfer.effectAllowed = 'copy'; });
      it.addEventListener('dblclick', () => mcAddNodeAt(type, mcCenter()));
      g.append(it);
    }
    box.append(g);
  }
}

/* ----- Холст ----- */
const mcWorldPt = (cx, cy) => { const r = $('mcCanvas').getBoundingClientRect(); return { x: (cx - r.left - mcView.x) / mcView.z, y: (cy - r.top - mcView.y) / mcView.z }; };
const mcCenter = () => { const r = $('mcCanvas').getBoundingClientRect(); return mcWorldPt(r.left + r.width / 2 - 100, r.top + r.height / 2 - 40); };
function mcApplyView() {
  $('mcWorld').style.transform = `translate(${mcView.x}px, ${mcView.y}px) scale(${mcView.z})`;
  $('mcCanvas').style.backgroundPosition = `${mcView.x}px ${mcView.y}px`;
  $('mcCanvas').style.backgroundSize = `${24 * mcView.z}px ${24 * mcView.z}px`;
  $('mcZoom').textContent = Math.round(mcView.z * 100) + '%';
}

function mcAddNodeAt(type, pt, from) {
  const m = mcOpen();
  if (!m) { flashStatus('Сначала создайте макрос («＋» слева)'); return null; }
  const d = MC_NODES[type];
  const p = {};
  for (const pr of d.params) if (pr.def !== undefined) p[pr.id] = pr.def && typeof pr.def === 'object' ? JSON.parse(JSON.stringify(pr.def)) : pr.def;
  const n = { id: newId(), type, x: Math.round(pt.x), y: Math.round(pt.y), p };
  m.nodes.push(n);
  // Протянули линию и отпустили в пустоте — сразу соединить с подходящим портом новой ноды
  if (from) {
    const side = from.dir === 'out' ? 'ins' : 'outs';
    const port = mcPorts(n, side).find((x) => mcCompat(from.t, x.t));
    if (port) mcConnect(m, from.dir === 'out' ? [from.node, from.port] : [n.id, port.id], from.dir === 'out' ? [n.id, port.id] : [from.node, from.port]);
  }
  saveLib();
  mcClearSel();
  mcSel.nodes.add(n.id);
  mcRenderCanvas();
  mcRenderProps();
  return n;
}

const mcCompat = (a, b) => (a === 'exec') === (b === 'exec');
const mcPortType = (m, nid, pid, side) => { const n = m.nodes.find((x) => x.id === nid); const p = n && mcPorts(n, side).find((x) => x.id === pid); return p ? p.t : null; };
// Соединить выход from с входом to. Вход данных принимает одну линию (новая заменяет), exec — сколько угодно
function mcConnect(m, from, to) {
  if (from[0] === to[0]) return false;
  const ft = mcPortType(m, from[0], from[1], 'outs');
  const tt = mcPortType(m, to[0], to[1], 'ins');
  if (!ft || !tt || !mcCompat(ft, tt)) { flashStatus('Так не соединить: белые точки (порядок) — только с белыми, цветные (данные) — с цветными'); return false; }
  if (m.links.some((l) => l.from[0] === from[0] && l.from[1] === from[1] && l.to[0] === to[0] && l.to[1] === to[1])) return false;
  if (tt !== 'exec') m.links = m.links.filter((l) => !(l.to[0] === to[0] && l.to[1] === to[1]));
  m.links.push({ id: newId(), from, to });
  return true;
}

function mcNodeEl(m, n) {
  const d = mcDefOf(n);
  const cat = d ? d.cat : 'action';
  const el = Object.assign(document.createElement('div'), { className: 'mc-node cat-' + cat + (mcSel.nodes.has(n.id) ? ' sel' : '') + (d ? '' : ' unknown') });
  el.dataset.id = n.id;
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  const head = Object.assign(document.createElement('div'), { className: 'mc-nh', title: d ? d.help || d.name : 'Нода из плагина, который не подключён' });
  head.append(Icons.el(d ? d.icon || MC_CATS[cat].icon : 'close'), Object.assign(document.createElement('span'), { className: 'nm', textContent: n.title || (d ? d.name : n.type) }));
  el.append(head);
  const p = mcParams(n);
  const sum = d && d.sum ? d.sum(p) : '';
  if (sum) el.append(Object.assign(document.createElement('div'), { className: 'mc-nsum', textContent: sum, title: sum }));
  const ports = Object.assign(document.createElement('div'), { className: 'mc-ports' });
  const col = (side) => {
    const c = Object.assign(document.createElement('div'), { className: 'mc-col ' + side });
    for (const pt of mcPorts(n, side === 'in' ? 'ins' : 'outs')) {
      const linked = m.links.some((l) => (side === 'in' ? l.to : l.from)[0] === n.id && (side === 'in' ? l.to : l.from)[1] === pt.id);
      const row = Object.assign(document.createElement('div'), { className: `mc-pin t-${pt.t}${linked ? ' on' : ''}`, title: `${pt.name || (pt.t === 'exec' ? (side === 'in' ? 'Вход' : 'Выход') : '')} · ${MC_PIN_NAMES[pt.t]}` });
      row.dataset.port = pt.id;
      row.dataset.side = side;
      row.dataset.t = pt.t;
      const dot = Object.assign(document.createElement('i'), { className: 'dot' });
      const lab = Object.assign(document.createElement('span'), { textContent: pt.name });
      // Неподключённый вход данных со значением из свойств — показываем значение
      if (side === 'in' && pt.t !== 'exec' && !linked && d && d.params.some((x) => x.id === pt.id)) lab.append(Object.assign(document.createElement('small'), { textContent: ' ' + mcStr(p[pt.id]).slice(0, 14) }));
      if (side === 'in') row.append(dot, lab); else row.append(lab, dot);
      c.append(row);
    }
    return c;
  };
  ports.append(col('in'), col('out'));
  el.append(ports, Object.assign(document.createElement('div'), { className: 'mc-nerr', hidden: true }));
  return el;
}

function mcRenderCanvas() {
  const world = $('mcWorld');
  const m = mcOpen();
  [...world.querySelectorAll('.mc-node, .mc-frame, .mc-note')].forEach((x) => x.remove());
  $('mcEmpty').hidden = !!(m && m.nodes.length);
  $('mcEmpty').textContent = !m ? 'Создайте макрос: «＋» слева или готовый пример. Не понятно, как — кнопка «?» слева.' : 'Перетащите ноды из списка слева (или дважды щёлкните по холсту). Начните с триггера — он запускает макрос.';
  $('mcCenterBox').classList.toggle('none', !m);
  mcApplyView();
  if (!m) { $('mcWires').replaceChildren(); return; }
  for (const f of m.frames) world.insertBefore(mcFrameEl(m, f), $('mcWires'));
  for (const n of m.nodes) world.append(mcNodeEl(m, n));
  for (const c of m.notes) world.append(mcNoteEl(m, c));
  mcRenderWires();
  mcPaintStatus();
  $('mcTitle').textContent = m.name;
  $('mcOn').checked = !!m.enabled;
}

// Центр точки порта в координатах холста
function mcPinPos(nid, pid, side) {
  const el = $('mcWorld').querySelector(`.mc-node[data-id="${nid}"] .mc-pin[data-side="${side}"][data-port="${pid}"] .dot`);
  if (!el) return null;
  const wr = $('mcWorld').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.width / 2 - wr.left) / mcView.z, y: (r.top + r.height / 2 - wr.top) / mcView.z };
}
const mcCurve = (a, b) => { const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
function mcRenderWires() {
  const m = mcOpen();
  const svg = $('mcWires');
  svg.replaceChildren();
  if (!m || tab !== 'macros') return;
  for (const l of m.links) {
    const a = mcPinPos(l.from[0], l.from[1], 'out');
    const b = mcPinPos(l.to[0], l.to[1], 'in');
    if (!a || !b) continue;
    const t = mcPortType(m, l.from[0], l.from[1], 'outs') || 'any';
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `mc-wire t-${t}${mcSel.links.has(l.id) ? ' sel' : ''}`);
    g.dataset.id = l.id;
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', mcCurve(a, b));
    hit.setAttribute('class', 'hit');
    const line = hit.cloneNode();
    line.setAttribute('class', 'ln');
    g.append(hit, line);
    svg.append(g);
  }
  if (mcWire) svg.append(mcWire.path);
}

/* Группы (рамки) и комментарии */
function mcFrameEl(m, f) {
  const el = Object.assign(document.createElement('div'), { className: 'mc-frame' + (mcSel.frames.has(f.id) ? ' sel' : '') });
  el.dataset.id = f.id;
  Object.assign(el.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
  if (f.color) el.style.setProperty('--fc', f.color);
  const head = Object.assign(document.createElement('div'), { className: 'mc-fh', textContent: f.name || 'Группа', title: 'Тяните — двигается вместе с нодами внутри. Двойной щелчок — переименовать' });
  head.addEventListener('dblclick', async (e) => {
    e.stopPropagation();
    const v = await askName('Название группы', f.name || 'Группа');
    if (!v) return;
    mcEdit(() => { f.name = v; });
    mcRenderCanvas();
  });
  el.append(head, Object.assign(document.createElement('i'), { className: 'mc-rs', title: 'Размер' }));
  return el;
}
function mcNoteEl(m, c) {
  const el = Object.assign(document.createElement('div'), { className: 'mc-note' + (mcSel.notes.has(c.id) ? ' sel' : '') });
  el.dataset.id = c.id;
  Object.assign(el.style, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' });
  const ta = Object.assign(document.createElement('textarea'), { value: c.text || '', placeholder: 'Комментарий…', spellcheck: false });
  ta.addEventListener('input', () => { c.text = ta.value; saveLib(); });
  ta.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.append(Object.assign(document.createElement('div'), { className: 'mc-cbar', title: 'Тяните, чтобы передвинуть' }), ta, Object.assign(document.createElement('i'), { className: 'mc-rs', title: 'Размер' }));
  return el;
}
function mcGroupSel() {
  const m = mcOpen();
  if (!m) return;
  const nodes = m.nodes.filter((n) => mcSel.nodes.has(n.id));
  if (!nodes.length) { flashStatus('Выделите ноды (рамкой мышью или Ctrl+щелчок), потом «Группа»'); return; }
  const els = nodes.map((n) => $('mcWorld').querySelector(`.mc-node[data-id="${n.id}"]`));
  const x1 = Math.min(...nodes.map((n) => n.x)) - 20;
  const y1 = Math.min(...nodes.map((n) => n.y)) - 40;
  const x2 = Math.max(...nodes.map((n, i) => n.x + (els[i] ? els[i].offsetWidth : 200))) + 20;
  const y2 = Math.max(...nodes.map((n, i) => n.y + (els[i] ? els[i].offsetHeight : 80))) + 20;
  const f = { id: newId(), name: 'Группа', x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  mcEdit((mm) => mm.frames.push(f));
  mcClearSel();
  mcSel.frames.add(f.id);
  mcRenderCanvas();
}
function mcAddNote() {
  const m = mcOpen();
  if (!m) return;
  const pt = mcCenter();
  const c = { id: newId(), text: '', x: Math.round(pt.x), y: Math.round(pt.y), w: 240, h: 110 };
  mcEdit((mm) => mm.notes.push(c));
  mcRenderCanvas();
  const ta = $('mcWorld').querySelector(`.mc-note[data-id="${c.id}"] textarea`);
  if (ta) ta.focus();
}

/* Мышь на холсте: ноды тянутся, линии тянутся от точек, пустое место — рамка выделения, колёсико — масштаб,
   средняя или правая кнопка (или пробел) — двигать холст */
let mcDrag = null;
let mcWire = null;
let mcSpace = false;

function mcPointerDown(e) {
  const m = mcOpen();
  if (!m) return;
  const t = e.target;
  if (t.closest('textarea, input, select, button')) return;
  const pan = e.button === 1 || e.button === 2 || (e.button === 0 && mcSpace);
  if (pan) {
    e.preventDefault();
    mcDrag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: mcView.x, vy: mcView.y, moved: false, button: e.button };
    return;
  }
  if (e.button !== 0) return;
  const pin = t.closest('.mc-pin');
  if (pin) {
    e.preventDefault();
    const nid = pin.closest('.mc-node').dataset.id;
    let from = { node: nid, port: pin.dataset.port, dir: pin.dataset.side, t: pin.dataset.t };
    // Тянем от занятого входа — снимаем линию и тянем её от прежнего выхода (перекинуть на другой вход)
    if (from.dir === 'in') {
      const l = [...m.links].reverse().find((x) => x.to[0] === nid && x.to[1] === from.port);
      if (l) {
        m.links = m.links.filter((x) => x !== l);
        from = { node: l.from[0], port: l.from[1], dir: 'out', t: mcPortType(m, l.from[0], l.from[1], 'outs') };
        saveLib();
        const el = $('mcWorld').querySelector(`.mc-node[data-id="${nid}"] .mc-pin[data-side="in"][data-port="${pin.dataset.port}"]`);
        if (el && !m.links.some((x) => x.to[0] === nid && x.to[1] === pin.dataset.port)) el.classList.remove('on');
      }
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'mc-wire-tmp t-' + from.t);
    mcWire = { from, path, a: mcPinPos(from.node, from.port, from.dir) };
    mcRenderWires();
    mcWireMove(e);
    return;
  }
  const wire = t.closest('.mc-wire');
  if (wire) {
    if (!e.ctrlKey && !e.shiftKey) mcClearSel();
    mcSel.links.add(wire.dataset.id);
    mcRenderWires();
    mcRenderProps();
    return;
  }
  const rs = t.closest('.mc-rs');
  if (rs) {
    e.preventDefault();
    const box = rs.parentElement;
    const list = box.classList.contains('mc-note') ? m.notes : m.frames;
    const o = list.find((x) => x.id === box.dataset.id);
    mcDrag = { kind: 'size', o, el: box, sx: e.clientX, sy: e.clientY, w: o.w, h: o.h };
    return;
  }
  const node = t.closest('.mc-node');
  const frameHead = t.closest('.mc-fh');
  const noteBar = t.closest('.mc-cbar');
  if (node || frameHead || noteBar) {
    e.preventDefault();
    const add = e.ctrlKey || e.shiftKey;
    const pick = (set, id) => {
      if (add) { if (set.has(id)) set.delete(id); else set.add(id); } else if (!set.has(id)) { mcClearSel(); set.add(id); }
    };
    if (node) pick(mcSel.nodes, node.dataset.id);
    if (frameHead) pick(mcSel.frames, frameHead.parentElement.dataset.id);
    if (noteBar) pick(mcSel.notes, noteBar.parentElement.dataset.id);
    // Что едет: выделенные ноды, рамки (с нодами внутри), комментарии
    const nodes = new Set(mcSel.nodes);
    for (const f of m.frames) {
      if (!mcSel.frames.has(f.id)) continue;
      for (const n of m.nodes) if (n.x >= f.x && n.y >= f.y && n.x < f.x + f.w && n.y < f.y + f.h) nodes.add(n.id);
    }
    const objs = [...m.nodes.filter((n) => nodes.has(n.id)), ...m.frames.filter((f) => mcSel.frames.has(f.id)), ...m.notes.filter((c) => mcSel.notes.has(c.id))];
    mcDrag = { kind: 'move', sx: e.clientX, sy: e.clientY, objs: objs.map((o) => ({ o, x: o.x, y: o.y })), moved: false };
    mcPaintSel();
    mcRenderProps();
    return;
  }
  // Пустое место: рамка выделения
  if (!e.ctrlKey && !e.shiftKey) { mcClearSel(); mcPaintSel(); mcRenderProps(); }
  const p0 = mcWorldPt(e.clientX, e.clientY);
  const band = Object.assign(document.createElement('div'), { className: 'mc-band' });
  $('mcCanvas').append(band);
  mcDrag = { kind: 'band', p0, band, sx: e.clientX, sy: e.clientY, base: { nodes: new Set(mcSel.nodes) } };
}

function mcPointerMove(e) {
  if (mcWire) { mcWireMove(e); return; }
  if (!mcDrag) return;
  const dx = e.clientX - mcDrag.sx;
  const dy = e.clientY - mcDrag.sy;
  if (mcDrag.kind === 'pan') {
    if (Math.abs(dx) + Math.abs(dy) > 3) mcDrag.moved = true;
    mcView.x = mcDrag.vx + dx;
    mcView.y = mcDrag.vy + dy;
    mcApplyView();
    return;
  }
  if (mcDrag.kind === 'move') {
    if (Math.abs(dx) + Math.abs(dy) > 2) mcDrag.moved = true;
    for (const x of mcDrag.objs) {
      x.o.x = Math.round(x.x + dx / mcView.z);
      x.o.y = Math.round(x.y + dy / mcView.z);
      const el = $('mcWorld').querySelector(`[data-id="${x.o.id}"]`);
      if (el) { el.style.left = x.o.x + 'px'; el.style.top = x.o.y + 'px'; }
    }
    mcRenderWires();
    return;
  }
  if (mcDrag.kind === 'size') {
    mcDrag.o.w = Math.max(120, Math.round(mcDrag.w + dx / mcView.z));
    mcDrag.o.h = Math.max(60, Math.round(mcDrag.h + dy / mcView.z));
    mcDrag.el.style.width = mcDrag.o.w + 'px';
    mcDrag.el.style.height = mcDrag.o.h + 'px';
    return;
  }
  if (mcDrag.kind === 'band') {
    const r = $('mcCanvas').getBoundingClientRect();
    const x1 = Math.min(e.clientX, mcDrag.sx) - r.left;
    const y1 = Math.min(e.clientY, mcDrag.sy) - r.top;
    Object.assign(mcDrag.band.style, { left: x1 + 'px', top: y1 + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
    const p1 = mcWorldPt(e.clientX, e.clientY);
    const [ax, bx] = [Math.min(mcDrag.p0.x, p1.x), Math.max(mcDrag.p0.x, p1.x)];
    const [ay, by] = [Math.min(mcDrag.p0.y, p1.y), Math.max(mcDrag.p0.y, p1.y)];
    mcSel.nodes = new Set(mcDrag.base.nodes);
    $('mcWorld').querySelectorAll('.mc-node').forEach((el) => {
      const n = mcOpen().nodes.find((x) => x.id === el.dataset.id);
      if (n && n.x < bx && n.x + el.offsetWidth > ax && n.y < by && n.y + el.offsetHeight > ay) mcSel.nodes.add(n.id);
    });
    mcPaintSel();
  }
}

function mcPointerUp(e) {
  const m = mcOpen();
  if (mcWire) {
    const w = mcWire;
    mcWire = null;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const pin = t && t.closest && t.closest('.mc-pin');
    if (pin && m) {
      const nid = pin.closest('.mc-node').dataset.id;
      const dir = pin.dataset.side;
      if (dir !== w.from.dir) {
        const from = w.from.dir === 'out' ? [w.from.node, w.from.port] : [nid, pin.dataset.port];
        const to = w.from.dir === 'out' ? [nid, pin.dataset.port] : [w.from.node, w.from.port];
        mcConnect(m, from, to);
      }
      saveLib();
      mcRenderCanvas();
    } else if (m && t && t.closest && t.closest('#mcCanvas')) {
      // Отпустили в пустом месте — выбрать ноду, она сразу подключится
      const pt = mcWorldPt(e.clientX, e.clientY);
      mcPicker(e.clientX, e.clientY, (type) => mcAddNodeAt(type, { x: pt.x - (w.from.dir === 'out' ? 0 : 200), y: pt.y - 20 }, w.from), w.from);
      mcRenderCanvas();
    } else mcRenderCanvas();
    return;
  }
  if (!mcDrag) return;
  const d = mcDrag;
  mcDrag = null;
  if (d.kind === 'pan') {
    if (m) m.view = { ...mcView };
    if (d.button === 2 && !d.moved) mcCanvasMenu(e); // правая кнопка без сдвига — меню
    return;
  }
  if (d.kind === 'band') { d.band.remove(); mcRenderProps(); return; }
  if ((d.kind === 'move' && d.moved) || d.kind === 'size') saveLib();
}

function mcWireMove(e) {
  const b = mcWorldPt(e.clientX, e.clientY);
  const a = mcWire.a || b;
  mcWire.path.setAttribute('d', mcWire.from.dir === 'out' ? mcCurve(a, b) : mcCurve(b, a));
}

function mcPaintSel() {
  $('mcWorld').querySelectorAll('.mc-node').forEach((el) => el.classList.toggle('sel', mcSel.nodes.has(el.dataset.id)));
  $('mcWorld').querySelectorAll('.mc-frame').forEach((el) => el.classList.toggle('sel', mcSel.frames.has(el.dataset.id)));
  $('mcWorld').querySelectorAll('.mc-note').forEach((el) => el.classList.toggle('sel', mcSel.notes.has(el.dataset.id)));
  $('mcWires').querySelectorAll('.mc-wire').forEach((el) => el.classList.toggle('sel', mcSel.links.has(el.dataset.id)));
}

function mcWheel(e) {
  if (!mcOpen()) return;
  e.preventDefault();
  const r = $('mcCanvas').getBoundingClientRect();
  const k = Math.exp(-e.deltaY * 0.0015);
  const z = Math.max(0.25, Math.min(2, mcView.z * k));
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  mcView.x = cx - (cx - mcView.x) * (z / mcView.z);
  mcView.y = cy - (cy - mcView.y) * (z / mcView.z);
  mcView.z = z;
  mcApplyView();
  mcOpen().view = { ...mcView };
}

// Показать все ноды
function mcFit() {
  const m = mcOpen();
  if (!m || !m.nodes.length) return;
  const els = [...$('mcWorld').querySelectorAll('.mc-node, .mc-frame, .mc-note')];
  const objs = [...m.nodes, ...m.frames, ...m.notes];
  const box = objs.map((o) => { const el = els.find((x) => x.dataset.id === o.id); return { x1: o.x, y1: o.y, x2: o.x + (el ? el.offsetWidth : 200), y2: o.y + (el ? el.offsetHeight : 80) }; });
  const x1 = Math.min(...box.map((b) => b.x1)); const y1 = Math.min(...box.map((b) => b.y1));
  const x2 = Math.max(...box.map((b) => b.x2)); const y2 = Math.max(...box.map((b) => b.y2));
  const r = $('mcCanvas').getBoundingClientRect();
  const z = Math.max(0.25, Math.min(1.2, Math.min((r.width - 60) / (x2 - x1), (r.height - 60) / (y2 - y1))));
  mcView = { z, x: (r.width - (x2 - x1) * z) / 2 - x1 * z, y: (r.height - (y2 - y1) * z) / 2 - y1 * z };
  m.view = { ...mcView };
  mcApplyView();
  requestAnimationFrame(mcRenderWires);
}

// Окошко выбора ноды (двойной щелчок, правая кнопка, линия в пустоту): поиск и список по видам
let mcPick = null;
function mcPickerClose() { if (mcPick) { mcPick.remove(); mcPick = null; } }
function mcPicker(cx, cy, onPick, from) {
  mcPickerClose();
  const pop = Object.assign(document.createElement('div'), { className: 'mc-picker' });
  const q = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'Найти ноду…' });
  const list = Object.assign(document.createElement('div'), { className: 'mc-plist' });
  pop.append(q, list);
  let items = [];
  let cur = 0;
  // Протянули линию — только ноды, у которых есть подходящий порт
  const fits = (d) => {
    if (!from) return true;
    const side = d[from.dir === 'out' ? 'ins' : 'outs'];
    return (typeof side === 'function' ? side({}) : side || []).some((p) => mcCompat(from.t, p.t));
  };
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    items = Object.entries(MC_NODES).filter(([, d]) => fits(d) && (!s || d.name.toLowerCase().includes(s)));
    cur = Math.min(cur, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map(([type, d], i) => {
      const b = Object.assign(document.createElement('button'), { className: 'cat-' + d.cat + (i === cur ? ' cur' : ''), title: d.help || '' });
      b.append(Icons.el(d.icon || MC_CATS[d.cat].icon), Object.assign(document.createElement('span'), { textContent: d.name }), Object.assign(document.createElement('small'), { textContent: MC_CATS[d.cat].name }));
      b.addEventListener('click', () => { mcPickerClose(); onPick(type); });
      return b;
    }));
  };
  q.addEventListener('input', () => { cur = 0; draw(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))); draw(); list.children[cur] && list.children[cur].scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && items[cur]) { e.preventDefault(); const t = items[cur][0]; mcPickerClose(); onPick(t); }
    if (e.key === 'Escape') { e.stopPropagation(); mcPickerClose(); }
  });
  document.body.append(pop);
  draw();
  const w = pop.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(cx, window.innerWidth - w.width - 6)) + 'px';
  pop.style.top = Math.max(6, Math.min(cy, window.innerHeight - w.height - 6)) + 'px';
  q.focus();
  mcPick = pop;
}
window.addEventListener('pointerdown', (e) => { if (mcPick && !mcPick.contains(e.target)) mcPickerClose(); }, true);

function mcCanvasMenu(e) {
  const m = mcOpen();
  if (!m) return;
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const node = t && t.closest('.mc-node');
  const wire = t && t.closest('.mc-wire');
  const pt = mcWorldPt(e.clientX, e.clientY);
  if (wire) { showMenu(e, [{ label: 'Удалить связь', fn: () => { mcEdit((mm) => { mm.links = mm.links.filter((l) => l.id !== wire.dataset.id); }); mcRenderCanvas(); } }]); return; }
  if (node) {
    if (!mcSel.nodes.has(node.dataset.id)) { mcClearSel(); mcSel.nodes.add(node.dataset.id); mcPaintSel(); mcRenderProps(); }
    const n = mcSel.nodes.size;
    showMenu(e, [
      { label: 'Копировать' + (n > 1 ? ` (${n})` : ''), key: 'Ctrl+C', fn: mcCopy },
      { label: 'Дублировать', key: 'Ctrl+D', fn: () => { mcCopy(); mcPaste(30); } },
      { label: 'Сгруппировать', key: 'Ctrl+G', fn: mcGroupSel },
      { label: 'Отсоединить все линии', fn: () => { mcEdit((mm) => { mm.links = mm.links.filter((l) => !mcSel.nodes.has(l.from[0]) && !mcSel.nodes.has(l.to[0])); }); mcRenderCanvas(); } },
      '-',
      { label: 'Удалить', key: 'Delete', fn: mcDeleteSel },
    ]);
    return;
  }
  showMenu(e, [
    { label: 'Добавить ноду…', fn: () => mcPicker(e.clientX, e.clientY, (type) => mcAddNodeAt(type, pt)) },
    { label: 'Комментарий', fn: () => { const c = { id: newId(), text: '', x: Math.round(pt.x), y: Math.round(pt.y), w: 240, h: 110 }; mcEdit((mm) => mm.notes.push(c)); mcRenderCanvas(); } },
    { label: 'Вставить', key: 'Ctrl+V', disabled: !mcClip, fn: () => mcPaste(0, pt) },
    { label: 'Выделить всё', key: 'Ctrl+A', fn: mcSelectAll },
    { label: 'Показать всё', key: 'F', fn: mcFit },
  ]);
}

function mcDeleteSel() {
  const m = mcOpen();
  if (!m) return;
  const any = Object.values(mcSel).some((s) => s.size);
  if (!any) return;
  mcEdit((mm) => {
    mm.nodes = mm.nodes.filter((n) => !mcSel.nodes.has(n.id));
    mm.links = mm.links.filter((l) => !mcSel.links.has(l.id) && !mcSel.nodes.has(l.from[0]) && !mcSel.nodes.has(l.to[0]));
    mm.frames = mm.frames.filter((f) => !mcSel.frames.has(f.id));
    mm.notes = mm.notes.filter((c) => !mcSel.notes.has(c.id));
  });
  mcClearSel();
  mcRenderCanvas();
  mcRenderProps();
  flashStatus('Удалено · Ctrl+Z — вернуть');
}
function mcSelectAll() {
  const m = mcOpen();
  if (!m) return;
  m.nodes.forEach((n) => mcSel.nodes.add(n.id));
  m.notes.forEach((c) => mcSel.notes.add(c.id));
  mcPaintSel();
  mcRenderProps();
}
function mcCopy() {
  const m = mcOpen();
  if (!m || !mcSel.nodes.size) return;
  const nodes = m.nodes.filter((n) => mcSel.nodes.has(n.id));
  const links = m.links.filter((l) => mcSel.nodes.has(l.from[0]) && mcSel.nodes.has(l.to[0]));
  mcClip = JSON.parse(JSON.stringify({ nodes, links }));
  flashStatus(`Скопировано нод: ${nodes.length} — вставьте в этот или другой макрос (Ctrl+V)`);
}
function mcPaste(shift = 30, at) {
  const m = mcOpen();
  if (!m || !mcClip) return;
  const map = {};
  const x0 = Math.min(...mcClip.nodes.map((n) => n.x));
  const y0 = Math.min(...mcClip.nodes.map((n) => n.y));
  const pt = at || null;
  const nodes = mcClip.nodes.map((n) => { map[n.id] = newId(); return { ...JSON.parse(JSON.stringify(n)), id: map[n.id], x: pt ? Math.round(pt.x + n.x - x0) : n.x + shift, y: pt ? Math.round(pt.y + n.y - y0) : n.y + shift }; });
  const links = mcClip.links.map((l) => ({ id: newId(), from: [map[l.from[0]], l.from[1]], to: [map[l.to[0]], l.to[1]] }));
  mcEdit((mm) => { mm.nodes.push(...nodes); mm.links.push(...links); });
  mcClearSel();
  nodes.forEach((n) => mcSel.nodes.add(n.id));
  if (!at) mcClip = { nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) }; // следующая вставка — ещё ниже
  mcRenderCanvas();
  mcRenderProps();
}

// Клавиши во вкладке «Макросы» (renderer.js зовёт раньше общих). true — обработано
function mcEdKey(e) {
  if (e.code === 'Space') return true; // пробел — двигать холст, а не листать слайды
  if (!mcOpen()) return false;
  const c = (e.ctrlKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + e.code;
  if (c === 'Delete' || c === 'Backspace') { mcDeleteSel(); return true; }
  if (c === 'Ctrl+KeyC') { mcCopy(); return true; }
  if (c === 'Ctrl+KeyV') { mcPaste(); return true; }
  if (c === 'Ctrl+KeyD') { mcCopy(); mcPaste(); return true; }
  if (c === 'Ctrl+KeyA') { mcSelectAll(); return true; }
  if (c === 'Ctrl+KeyG') { mcGroupSel(); return true; }
  if (c === 'KeyF') { mcFit(); return true; }
  if (c === 'Escape' && Object.values(mcSel).some((s) => s.size)) { mcClearSel(); mcPaintSel(); mcRenderProps(); return true; }
  return false;
}

/* ----- Свойства справа: выбранная нода или сам макрос ----- */
const mcField = (label, input, hint) => {
  const row = Object.assign(document.createElement('label'), { className: 'mc-f' });
  row.append(Object.assign(document.createElement('span'), { textContent: label }), input);
  if (hint) row.append(Object.assign(document.createElement('small'), { textContent: hint }));
  return row;
};
function mcSelect(opts, value, onChange) {
  const s = document.createElement('select');
  const list = typeof opts === 'function' ? opts() : opts;
  for (const [v, t] of list) s.append(new Option(t, v));
  if (value && !list.some((x) => x[0] === value)) s.append(new Option('(нет такого — удалено?)', value));
  s.value = value == null ? '' : value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function mcKeyBtn(value, onSet) {
  const b = Object.assign(document.createElement('button'), { className: 'mc-keybtn', textContent: value ? prettyCombo(value) : 'Назначить…', title: 'Нажмите и затем сочетание клавиш. Esc — отмена, Delete — убрать' });
  b.addEventListener('click', () => { mcKeyWait = { onSet, btn: b }; b.textContent = 'Нажмите сочетание…'; b.classList.add('wait'); });
  return b;
}
window.addEventListener('keydown', (e) => {
  if (!mcKeyWait) return;
  e.preventDefault();
  e.stopPropagation();
  const w = mcKeyWait;
  if (e.code === 'Escape') { mcKeyWait = null; mcRenderProps(); return; }
  if (e.code === 'Delete' || e.code === 'Backspace') { mcKeyWait = null; w.onSet(''); return; }
  const combo = comboOf(e);
  if (!combo) return;
  mcKeyWait = null;
  const a = ACTION_LIST.find(([id]) => keymap()[id].includes(combo));
  if (a) flashStatus(`Сочетание ${prettyCombo(combo)} было у команды «${a[1]}» — теперь его выполняет макрос`);
  w.onSet(combo);
}, true);

/* ----- Выбор презентации: где искать (все / библиотека / плейлист) + поиск по названию и тексту ----- */
const mcPickState = new Map(); // нода:параметр → { from, q } — только пока открыта программа
const mcLow = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
function mcItemPicker(key, pr, value, onChange) {
  const st = mcPickState.get(key) || { from: '', q: '' };
  mcPickState.set(key, st);
  const okItem = (it) => !!it && (!pr.pred || pr.pred(it));
  // По умолчанию — там, где лежит уже выбранная презентация
  if (!st.from && !st.q && value && lib.items[value]) {
    const l = lib.libraries.find((x) => x.items.includes(value));
    if (l && lib.libraries.length > 1) st.from = 'lib:' + l.id;
  }
  const box = Object.assign(document.createElement('div'), { className: 'mc-ipick' });
  const from = document.createElement('select');
  from.title = 'Где искать';
  from.append(new Option(pr.pred ? 'Все песни' : 'Все презентации', ''));
  const grp = (label, list, kind) => {
    if (!list.length) return;
    const g = Object.assign(document.createElement('optgroup'), { label });
    for (const x of list) g.append(new Option(`${x.name} (${viewEntries({ kind, id: x.id }).filter((e) => okItem(e.item)).length})`, kind + ':' + x.id));
    from.append(g);
  };
  grp('Библиотеки', lib.libraries, 'lib');
  grp('Плейлисты', lib.playlists, 'pl');
  if (st.from && !findView(keyView(st.from))) st.from = '';
  from.value = st.from;
  const q = Object.assign(document.createElement('input'), { type: 'search', value: st.q, placeholder: 'Поиск: название или слова из текста…' });
  const list = Object.assign(document.createElement('select'), { size: 8, className: 'mc-ilist' });
  const info = Object.assign(document.createElement('small'), { className: 'mc-iinfo' });
  const fill = () => {
    let items;
    if (st.from) {
      const seen = new Set();
      items = viewEntries(keyView(st.from)).map((e) => e.item).filter((it) => okItem(it) && !seen.has(it.id) && seen.add(it.id));
    } else items = mcItems(okItem);
    const words = mcLow(st.q).split(/\s+/).filter(Boolean);
    if (words.length) {
      const has = (s) => words.every((w) => s.includes(w));
      const byName = items.filter((it) => has(mcLow(it.name)));
      const byText = items.filter((it) => !byName.includes(it) && has(mcLow(it.slides.map(mcSlideText).join(' '))));
      items = [...byName, ...byText];
    }
    const MAX = 300;
    list.replaceChildren();
    if (pr.none) list.append(new Option(pr.none, ''));
    for (const it of items.slice(0, MAX)) list.append(new Option(`${it.name} · ${Slides.PRES_NAMES[it.kind] || 'Презентация'}`, it.id));
    if (value && ![...list.options].some((o) => o.value === value)) {
      const it = lib.items[value];
      list.prepend(new Option(it ? `✓ ${it.name} (выбрана, не в этом списке)` : '(нет такой — удалена?)', value));
    }
    list.value = value || '';
    info.textContent = !items.length ? 'Ничего не найдено' : items.length > MAX ? `Найдено ${items.length}, показаны первые ${MAX} — уточните поиск` : `Найдено: ${items.length}`;
  };
  from.addEventListener('change', () => { st.from = from.value; fill(); });
  q.addEventListener('input', () => { st.q = q.value; fill(); });
  // Enter в поиске — взять первую найденную
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const o = [...list.options].find((x) => x.value && x.value !== value);
    if (o) onChange(o.value);
  });
  list.addEventListener('change', () => onChange(list.value));
  fill();
  const cur = lib.items[value];
  const chosen = Object.assign(document.createElement('div'), { className: 'mc-ichosen', textContent: cur ? 'Выбрана: ' + cur.name : value ? 'Выбранной нет — удалена?' : pr.none ? 'Сейчас: ' + pr.none.toLowerCase() : 'Не выбрана — найдите и щёлкните' });
  box.append(from, q, list, info, chosen);
  return box;
}

function mcParamInput(n, pr, p, onChange) {
  const v = p[pr.id];
  if (pr.t === 'item') return mcItemPicker(n.id + ':' + pr.id, pr, v, onChange);
  if (pr.t === 'select') return mcSelect(pr.opts, v, onChange);
  if (pr.t === 'check') { const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!v }); c.addEventListener('change', () => onChange(c.checked)); return c; }
  if (pr.t === 'key') return mcKeyBtn(v, onChange);
  if (pr.t === 'file') {
    const box = Object.assign(document.createElement('div'), { className: 'mc-file' });
    const b = Object.assign(document.createElement('button'), { textContent: v ? v.name || fileName(v.path) : 'Выбрать файл…', title: v ? v.path : '' });
    b.addEventListener('click', async () => { const [f] = await window.api.pickFile({ kinds: pr.kinds || ['image', 'video'], title: pr.name }); if (f) onChange({ type: f.type, name: f.name, path: f.path, url: f.url }); });
    box.append(b);
    if (v) { const x = Object.assign(document.createElement('button'), { textContent: '✕', title: 'Убрать файл' }); x.addEventListener('click', () => onChange(null)); box.append(x); }
    return box;
  }
  const inp = Object.assign(document.createElement(pr.t === 'area' ? 'textarea' : 'input'), { value: v == null ? '' : v });
  if (pr.t === 'num') Object.assign(inp, { type: 'number', step: pr.step || 1, min: pr.min != null ? pr.min : '', max: pr.max != null ? pr.max : '' });
  else if (pr.t !== 'area') inp.type = 'text';
  inp.addEventListener('input', () => onChange(pr.t === 'num' ? (inp.value === '' ? 0 : Number(inp.value)) : inp.value, true));
  return inp;
}

function mcRenderProps() {
  const box = $('mcProps');
  if (!box || tab !== 'macros') return;
  box.replaceChildren();
  const m = mcOpen();
  if (!m) { $('mcPropsTitle').textContent = 'Свойства'; return; }
  const one = mcSel.nodes.size === 1 ? m.nodes.find((n) => mcSel.nodes.has(n.id)) : null;
  if (one) return mcNodeProps(box, m, one);
  if (mcSel.nodes.size > 1) {
    $('mcPropsTitle').textContent = `Выделено нод: ${mcSel.nodes.size}`;
    box.append(Object.assign(document.createElement('div'), { className: 'te-empty', textContent: 'Ctrl+G — сгруппировать, Ctrl+C — копировать, Delete — удалить. Тяните любую — едут все.' }));
    return;
  }
  if (mcSel.links.size) {
    $('mcPropsTitle').textContent = 'Связь';
    const b = Object.assign(document.createElement('button'), { textContent: 'Удалить связь (Delete)' });
    b.addEventListener('click', mcDeleteSel);
    box.append(b);
    return;
  }
  mcMacroProps(box, m);
}

function mcNodeProps(box, m, n) {
  const d = mcDefOf(n);
  $('mcPropsTitle').textContent = d ? d.name : n.type;
  if (!d) { box.append(Object.assign(document.createElement('div'), { className: 'te-empty', textContent: `Нода «${n.type}» из плагина, которого нет. Её можно только удалить.` })); return; }
  box.append(Object.assign(document.createElement('div'), { className: 'mc-cat cat-' + d.cat, textContent: MC_CATS[d.cat].name + ' · ' + MC_CATS[d.cat].hint }));
  if (d.help) box.append(Object.assign(document.createElement('p'), { className: 'mc-help', textContent: d.help }));
  if (MC_CAT_TIPS[d.cat]) {
    const tip = Object.assign(document.createElement('p'), { className: 'mc-tip', textContent: MC_CAT_TIPS[d.cat] + ' ' });
    const more = Object.assign(document.createElement('a'), { href: '#', textContent: 'Подробнее…' });
    more.addEventListener('click', (e) => { e.preventDefault(); mcShowHelp(); });
    tip.append(more);
    box.append(tip);
  }
  const title =Object.assign(document.createElement('input'), { type: 'text', value: n.title || '', placeholder: d.name });
  title.addEventListener('input', () => { n.title = title.value.trim() || undefined; saveLib(); const el = $('mcWorld').querySelector(`.mc-node[data-id="${n.id}"] .nm`); if (el) el.textContent = n.title || d.name; });
  box.append(mcField('Подпись на холсте', title));
  const p = mcParams(n);
  for (const pr of d.params) {
    if (pr.show && !pr.show(p)) continue;
    const linked = m.links.some((l) => l.to[0] === n.id && l.to[1] === pr.id);
    const input = mcParamInput(n, pr, p, (v, typing) => {
      if (!n.p) n.p = {};
      n.p[pr.id] = v;
      saveLib();
      // Набор текста — не перерисовываем свойства (курсор на месте), только ноду
      const el = $('mcWorld').querySelector(`.mc-node[data-id="${n.id}"]`);
      if (el) { el.replaceWith(mcNodeEl(m, n)); mcRenderWires(); mcPaintStatus(); }
      if (!typing) mcRenderProps();
    });
    if (linked) { input.disabled = true; input.title = 'Значение приходит по линии'; }
    box.append(mcField(pr.name, input, linked ? 'приходит по линии' : ''));
  }
  if (n.type === 'log.counter') {
    const k = m.id + ':' + n.id;
    const b = Object.assign(document.createElement('button'), { textContent: `Сбросить (сейчас ${mcCounters.get(k) || 0})` });
    b.addEventListener('click', () => { mcCounters.delete(k); mcRenderProps(); });
    box.append(b);
  }
  const ports = (list, side) => list.filter((x) => x.t !== 'exec' || x.name).map((x) => `${side} ${x.name || '—'} (${MC_PIN_NAMES[x.t]})`);
  const info = [...ports(mcPorts(n, 'ins'), '←'), ...ports(mcPorts(n, 'outs'), '→')];
  if (info.length) box.append(Object.assign(document.createElement('div'), { className: 'mc-ports-info', textContent: info.join('\n') }));
  const run = mcLastRun.get(m.id);
  const err = run && run.errs.get(n.id);
  if (err) box.append(Object.assign(document.createElement('div'), { className: 'mc-errbox', textContent: 'Ошибка в последнем запуске: ' + err }));
}

// Иконка макроса: m.icon — знак из iconlib.js ('знак' или 'знак:цвет') или своя картинка (data:); нет — обычная
const mcIconEl = (m) => (typeof IconLib === 'object' ? IconLib.el(m.icon, 'macro') : Icons.el('macro'));
function mcIconPick(anchor, m) {
  IconLib.pick(anchor, {
    title: `Иконка «${m.name}»`,
    value: m.icon,
    onPick: (v) => {
      if (v) m.icon = v; else delete m.icon;
      saveLib();
      mcRenderAll();
      flashStatus(v ? `«${m.name}»: новая иконка · Ctrl+Z — вернуть` : `«${m.name}»: обычная иконка`);
    },
  });
}

function mcMacroProps(box, m) {
  $('mcPropsTitle').textContent = 'Макрос';
  const name = Object.assign(document.createElement('input'), { type: 'text', value: m.name });
  name.addEventListener('input', () => { m.name = name.value.trim() || 'Макрос'; saveLib(); $('mcTitle').textContent = m.name; mcRenderList(); mcRenderDock(); });
  box.append(mcField('Название', name));
  const ic = Object.assign(document.createElement('button'), { className: 'mc-icbtn', title: 'Выбрать иконку: больше 250 значков по темам, 16 цветов или своя картинка' });
  ic.append(mcIconEl(m), document.createTextNode(m.icon ? (m.icon.startsWith('data:') ? 'Своя картинка' : IconLib.name(m.icon) || 'Иконка') : 'Обычная — выбрать…'));
  ic.addEventListener('click', () => mcIconPick(ic, m));
  box.append(mcField('Иконка', ic, 'Видна в списке, в быстрых макросах и на панели макросов'));
  const on = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!m.enabled });
  on.addEventListener('change', () => { m.enabled = on.checked; saveLib(); mcRenderAll(); });
  box.append(mcField('Включён', on, 'Выключенный макрос не срабатывает сам, но его можно запустить кнопкой'));
  const quick = Object.assign(document.createElement('input'), { type: 'checkbox', checked: m.quick !== false });
  quick.addEventListener('change', () => { if (quick.checked) delete m.quick; else m.quick = false; saveLib(); mcRenderQuick(); });
  box.append(mcField('В быстрых макросах', quick, 'Кнопка в окне «Макросы» под «Предпросмотром»'));
  box.append(mcField('Горячая клавиша', mcKeyBtn(m.key, (k) => {
    if (k) lib.macros.forEach((x) => { if (x !== m && x.key === k) delete x.key; });
    if (k) m.key = k; else delete m.key;
    saveLib(); mcRenderAll();
  }), 'Запускает ноды «Ручной запуск» (или все триггеры, если их нет)'));
  box.append(mcField('Если уже выполняется', mcSelect([['skip', 'Не запускать повторно'], ['restart', 'Перезапустить'], ['parallel', 'Запустить ещё раз параллельно']], m.repeat || 'skip', (v) => { m.repeat = v; saveLib(); })));
  const cd = Object.assign(document.createElement('input'), { type: 'number', min: 0, step: 100, value: m.cooldown != null ? m.cooldown : 300 });
  cd.addEventListener('input', () => { m.cooldown = Math.max(0, Number(cd.value) || 0); saveLib(); });
  box.append(mcField('Не чаще, чем раз в (мс)', cd, 'Защита от повторов при непрерывном событии'));
  const note = Object.assign(document.createElement('textarea'), { value: m.note || '', rows: 3, placeholder: 'Что делает этот макрос' });
  note.addEventListener('input', () => { m.note = note.value; saveLib(); });
  box.append(mcField('Описание', note));
  const binds = mcBindings(m);
  const bb = Object.assign(document.createElement('div'), { className: 'mc-binds' });
  bb.append(Object.assign(document.createElement('b'), { textContent: binds.length ? `Привязан (${binds.length}):` : 'Не привязан. Перетащите макрос из списка слева (или из панели «Макросы» на «Экране») на слайд, пункт плейлиста, песню или файл медиапула.' }));
  for (const x of binds) {
    const row = Object.assign(document.createElement('div'), { className: 'mc-bind' });
    const del = Object.assign(document.createElement('button'), { textContent: '✕', title: 'Отвязать' });
    del.addEventListener('click', () => { x.remove(); saveLib(); renderService(); mcRenderAll(); });
    row.append(Object.assign(document.createElement('span'), { textContent: x.where }), del);
    bb.append(row);
  }
  box.append(bb);
  box.append(Object.assign(document.createElement('div'), { className: 'mc-help', textContent: `Нод: ${m.nodes.length} · связей: ${m.links.length}. Колёсико — масштаб, средняя/правая кнопка или пробел — двигать холст, двойной щелчок — добавить ноду, F — показать всё.` }));
}

/* ----- Журнал и тестовое окно ----- */
function mcRenderLog() {
  const box = $('mcLog');
  if (!box) return;
  const m = mcOpen();
  const only = $('mcLogMine').checked && m;
  const list = mcLog.filter((x) => !only || x.mid === m.id).slice(-120);
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  box.replaceChildren(...list.map((x) => {
    const r = Object.assign(document.createElement('div'), { className: 'mc-lrow ' + x.lvl, title: 'Щелчок — показать ноду' });
    const t = new Date(x.t);
    r.append(Object.assign(document.createElement('time'), { textContent: t.toLocaleTimeString('ru-RU') }), Object.assign(document.createElement('span'), { textContent: (only ? '' : x.name + ': ') + x.text }));
    r.addEventListener('click', () => { if (x.mid && x.mid !== mcOpenId) mcSelectMacro(x.mid); if (x.nid) { mcClearSel(); mcSel.nodes.add(x.nid); mcPaintSel(); mcRenderProps(); } });
    return r;
  }));
  if (!list.length) box.append(Object.assign(document.createElement('div'), { className: 'te-empty', textContent: 'Здесь видно, что делали макросы и где ошибка.' }));
  if (atEnd) box.scrollTop = box.scrollHeight;
}

function mcTestOpen() {
  $('mcTestBox').hidden = false;
  Scene.clear($('mcTestStage'));
  $('mcTestCap').textContent = 'Тест: здесь — что было бы на экране';
  mcLayoutTest();
}
function mcTestShow(content, label) {
  $('mcTestBox').hidden = false;
  Scene.show($('mcTestStage'), { ...content, sound: false });
  $('mcTestCap').textContent = 'Тест: ' + label;
  mcLayoutTest();
}
function mcLayoutTest() {
  const wrap = $('mcTestWrap');
  const st = $('mcTestStage');
  const { W, H } = outputSize();
  wrap.style.aspectRatio = `${W} / ${H}`;
  st.style.width = W + 'px';
  st.style.height = H + 'px';
  st.style.transform = `scale(${wrap.clientWidth / W})`;
  Scene.refit(st);
}

/* ----- Панель «Макросы» на «Экране»: перетащить макрос на слайд, запустить кнопкой ----- */
function mcRenderDock() {
  const box = $('mcDockList');
  if (!box || !lib) return;
  const list = lib.macros || [];
  $('mcDock').hidden = !settings.mcDock || tab === 'macros';
  box.replaceChildren(...list.map((m) => {
    const chip = Object.assign(document.createElement('div'), { className: 'mc-chip' + (m.enabled ? '' : ' off'), draggable: true, title: `${m.name}${m.note ? '\n' + m.note : ''}\nПеретащите на слайд, пункт плейлиста, заголовок песни или файл медиапула` });
    const st = Object.assign(document.createElement('span'), { className: 'mc-st' });
    st.dataset.mcStatus = m.id;
    chip.append(mcIconEl(m), st, Object.assign(document.createElement('span'), { className: 'nm', textContent: m.name }));
    const run = Object.assign(document.createElement('button'), { textContent: '▶', title: 'Запустить' + (m.key ? ` (${prettyCombo(m.key)})` : '') });
    run.addEventListener('click', (e) => { e.stopPropagation(); mcRunManual(m, false); });
    chip.append(run);
    chip.addEventListener('dblclick', () => openMacroTab(m.id));
    chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData(MC_DT, m.id); e.dataTransfer.effectAllowed = 'copy'; });
    return chip;
  }));
  if (!list.length) box.append(Object.assign(document.createElement('div'), { className: 'te-empty', textContent: 'Макросов нет — создайте во вкладке «Макросы».' }));
  mcRenderQuick();
}

/* ----- Быстрые макросы под «Предпросмотром»: щелчок — запустить, сеткой или списком (settings.mcQuickView) ----- */
function mcRenderQuick() {
  const box = $('mcqBody');
  if (!box || !lib) return;
  const view = settings.mcQuickView === 'list' ? 'list' : 'grid';
  box.className = view;
  $('mcqGrid').classList.toggle('on', view === 'grid');
  $('mcqList').classList.toggle('on', view === 'list');
  const list = (lib.macros || []).filter((m) => m.quick !== false);
  box.replaceChildren(...list.map((m) => {
    const b = Object.assign(document.createElement('button'), { className: 'mcq' + (m.enabled ? '' : ' off'), draggable: true, title: `${m.name}${m.note ? '\n' + m.note : ''}\nЩелчок — запустить, правая кнопка — меню. Перетащите на слайд или пункт — привяжется` });
    const st = Object.assign(document.createElement('span'), { className: 'mc-st' });
    st.dataset.mcStatus = m.id;
    b.append(mcIconEl(m), Object.assign(document.createElement('span'), { className: 'nm', textContent: m.name }));
    if (m.key) b.append(Object.assign(document.createElement('span'), { className: 'ky', textContent: prettyCombo(m.key) }));
    b.append(st);
    b.addEventListener('click', () => mcRunManual(m, false));
    b.addEventListener('dragstart', (e) => { e.dataTransfer.setData(MC_DT, m.id); e.dataTransfer.effectAllowed = 'copy'; });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const running = [...mcRuns].some((r) => r.macro.id === m.id);
      showMenu(e, [
        { label: 'Запустить', fn: () => mcRunManual(m, false) },
        ...(running ? [{ label: 'Остановить', fn: () => mcStopMacro(m) }] : []),
        { label: 'Открыть в редакторе', fn: () => openMacroTab(m.id) },
        { label: 'Иконка…', fn: () => mcIconPick(b, m) },
        '-',
        { label: m.enabled ? 'Выключить' : 'Включить', fn: () => { m.enabled = !m.enabled; saveLib(); mcRenderAll(); } },
        { label: 'Убрать из быстрых', fn: () => { m.quick = false; saveLib(); mcRenderQuick(); flashStatus(`«${m.name}» убран из быстрых · вернуть — галочка в свойствах макроса`); } },
      ]);
    });
    return b;
  }));
  if (!list.length) box.append(Object.assign(document.createElement('div'), { className: 'mcq-empty', textContent: lib.macros && lib.macros.length ? 'Все макросы убраны из быстрых — включите галочку «В быстрых макросах» в свойствах макроса.' : 'Макросов пока нет — создайте во вкладке «Макросы» (Ctrl+5).' }));
  mcPaintStatus();
}
function mcQuickView(v) { settings.mcQuickView = v; saveSettings(); mcRenderQuick(); }
$('mcqGrid').addEventListener('click', () => mcQuickView('grid'));
$('mcqList').addEventListener('click', () => mcQuickView('list'));
$('mcqStop').addEventListener('click', () => { const n = mcRuns.size; mcStopAll(); flashStatus(n ? 'Макросы остановлены' : 'Ничего не выполняется'); });
function mcToggleDock() {
  settings.mcDock = !settings.mcDock;
  saveSettings();
  if (tab === 'macros' && settings.mcDock) setTab('service');
  mcRenderDock();
}

/* ----- Подключение ----- */

// После загрузки library.json (playlist.js → initService)
function mcInit() {
  if (!Array.isArray(lib.macros)) lib.macros = [];
  lib.macros.forEach(mcNorm);
  if (!lib.fileMacros || typeof lib.fileMacros !== 'object') lib.fileMacros = {};
  mcPlSnap();
  mcRenderLib();
  mcRenderAll();
}
// Ctrl+Z вернул старые макросы
function mcAfterUndo() {
  if (!Array.isArray(lib.macros)) lib.macros = [];
  lib.macros.forEach(mcNorm);
  if (!lib.fileMacros) lib.fileMacros = {};
  mcPlSnap();
  const ids = new Set(Object.values(mcSel).flatMap((s) => [...s]));
  mcClearSel();
  const m = mcOpen();
  if (m) for (const id of ids) { if (m.nodes.some((n) => n.id === id)) mcSel.nodes.add(id); }
  mcRenderAll();
}

$('mcNew').addEventListener('click', () => mcAdd(mcNorm(Object.assign(mcNewMacro(), { nodes: [{ id: newId(), type: 'trig.manual', x: 60, y: 80, p: {} }] }))));
$('mcTpl').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu({ clientX: r.left, clientY: r.bottom + 2 }, [...MC_TEMPLATES.map((t) => ({ label: t.name, fn: () => mcFromTemplate(t) })), '-', { label: 'Как работают макросы…', fn: mcShowHelp }]); });
// Инструкция: что такое триггер, датчик, линии + готовые примеры одной кнопкой
function mcShowHelp() {
  $('mcHelpTpl').replaceChildren(...MC_TEMPLATES.slice(1).map((t) => {
    const b = document.createElement('button');
    b.append(Object.assign(document.createElement('b'), { textContent: '＋ ' + t.name }), Object.assign(document.createElement('small'), { textContent: t.about || '' }));
    b.addEventListener('click', () => { $('mcHelpDialog').close(); mcFromTemplate(t); flashStatus(`Добавлен пример «${t.name}» — прочитайте заметку на холсте`); });
    return b;
  }));
  $('mcHelpDialog').showModal();
}
$('mcHelp').addEventListener('click', mcShowHelp);
$('mcImport').addEventListener('click', mcImport);
$('mcExport').addEventListener('click', () => { const m = mcOpen(); if (m) mcExport([m]); });
$('mcExportAll').addEventListener('click', () => mcExport(lib.macros || []));
$('mcLibFilter').addEventListener('input', mcRenderLib);
$('mcRun').addEventListener('click', () => { const m = mcOpen(); if (m) mcRunManual(m, false); });
$('mcTest').addEventListener('click', () => { const m = mcOpen(); if (m) mcRunManual(m, true); });
$('mcStop').addEventListener('click', () => { const m = mcOpen(); if (m) mcStopMacro(m); });
$('mcStopAll').addEventListener('click', mcStopAll);
$('mcGroup').addEventListener('click', mcGroupSel);
$('mcNoteBtn').addEventListener('click', mcAddNote);
$('mcDel').addEventListener('click', mcDeleteSel);
$('mcFit').addEventListener('click', mcFit);
$('mcOn').addEventListener('change', () => { const m = mcOpen(); if (m) { m.enabled = $('mcOn').checked; saveLib(); mcRenderAll(); } });
$('mcLogClear').addEventListener('click', () => { mcLog.length = 0; mcRenderLog(); });
$('mcLogMine').addEventListener('change', mcRenderLog);
$('mcTestClose').addEventListener('click', () => { $('mcTestBox').hidden = true; Scene.clear($('mcTestStage')); });
$('mcDockClose').addEventListener('click', mcToggleDock); // кнопки панели наверху больше нет (владелец убрал) — только закрыть
$('mcDockEdit').addEventListener('click', () => openMacroTab());

const mcCanvasEl = $('mcCanvas');
mcCanvasEl.addEventListener('pointerdown', mcPointerDown);
window.addEventListener('pointermove', (e) => { if (mcDrag || mcWire) mcPointerMove(e); });
window.addEventListener('pointerup', (e) => { if (mcDrag || mcWire) mcPointerUp(e); });
mcCanvasEl.addEventListener('wheel', mcWheel, { passive: false });
mcCanvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
mcCanvasEl.addEventListener('dblclick', (e) => {
  if (!mcOpen() || e.target.closest('.mc-node, .mc-note, .mc-frame .mc-fh, .mc-wire')) return;
  const pt = mcWorldPt(e.clientX, e.clientY);
  mcPicker(e.clientX, e.clientY, (type) => mcAddNodeAt(type, pt));
});
mcCanvasEl.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(MC_NODE_DT)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; } });
mcCanvasEl.addEventListener('drop', (e) => {
  const type = e.dataTransfer.getData(MC_NODE_DT);
  if (!type || !MC_NODES[type]) return;
  e.preventDefault();
  e.stopPropagation();
  const pt = mcWorldPt(e.clientX, e.clientY);
  mcAddNodeAt(type, { x: pt.x - 90, y: pt.y - 18 });
});
// Пробел — двигать холст мышью (как в Fusion/Photoshop)
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && tab === 'macros' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) { if (!mcSpace) mcCanvasEl.classList.add('pan'); mcSpace = true; } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { mcSpace = false; mcCanvasEl.classList.remove('pan'); } });
new ResizeObserver(() => { if (tab === 'macros') { mcRenderWires(); if (!$('mcTestBox').hidden) mcLayoutTest(); } }).observe(mcCanvasEl);
