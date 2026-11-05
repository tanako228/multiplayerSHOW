/* ---------- Темы с шаблонами слайдов (Theme Editor, как в ProPresenter) ----------
   Тема: { id, name, style, templates?: [шаблон], std? }
     style — старое оформление (шрифт, цвет, фон…): им рисуются темы без шаблонов и миниатюры старых версий.
     std — стандартная тема из программы (BUILTIN): не хранится в library.json, править — только копию.
   Шаблон: { id, name, use, bg, objs: [объект], media?, safe?, guides?: [{ d: 'v'|'h', v: % }] — направляющие редактора }
     use — для каких слайдов сам выбирается: song | bible | ref | title | any (у слайда можно указать вручную: slide.tpl);
     bg — фон: { type: none|color|gradient|image|video, color, a, b, angle, radial, url, path, name, fit, op, blur, dim, sat, bright };
       none — по-настоящему прозрачный: виден слой «Медиа» и «Источники» под слайдом;
     media — Media Action: { type: image|video, url, path, name, loop } — при показе слайда это идёт в слой «Медиа» (если там не оно же);
     safe — безопасная зона в редакторе, % от края.
   Объект (координаты и размеры — % экрана, толщины и размеры — % высоты экрана):
     общее: { id, kind, name, x, y, w, h, rot, flipX, flipY, opacity, blend (mix-blend-mode), hidden, locked, group,
              fill: { type: none|color|gradient|media, color, a, b, angle, radial, op, url }, stroke: { w, color, op },
              shadow: { on, color, op, blur, angle, dist }, radius, feather,
              fx: { blur, invert, sat, bright } — эффекты того, что ПОД объектом (backdrop-filter),
              anim: { in: { type: none|fade|move|scale|blur, by: all|lines|words|chars, ms, delay, dir, trigger: slide|cmd, order }, out: { type, ms, delay, dir } } }
     kind: text | rect | ellipse | line | arrow | poly | image | video
     text: { bind: content|ref|title|ccli|translation|label|number|static, text, font, size, color, weight, italic, underline, strike, upper, case: ''|upper|lower|title,
             align: left|center|right|justify, valign, lh, ls, pad, fit: none|shrink|grow|both|box, min, max,
             tfill: { type: color|gradient|media|cut, a, b, angle, url, op }, tstroke, tshadow, scroll: { on, dir: left|up, speed, fade },
             plate: { on, mode: block|lines|fixed|wide, color, op, blur, pad, radius, w, h, dx, dy, stroke, shadow } }
     poly: { shape, pts: [[x, y] 0…1] }; image/video: { url, path, name, fit, crop: { l, t, r, b }, loop, mute, filt: { blur, sat, bright, contrast, hue, gray } }
   Рисует scene.js (style.tpls → Scene.build). Правится во вкладке «Темы» (themeeditor.js). */

const Themes = (() => {
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const USES = { song: 'Текст песни', bible: 'Библия', ref: 'Ссылка на отрывок', title: 'Заголовок', any: 'Любой слайд' };
  const BINDS = {
    content: 'Текст слайда (песня или стих)', ref: 'Ссылка Писания (Ин 3:16)', title: 'Название песни или презентации',
    ccli: 'CCLI и авторы', translation: 'Перевод Библии', label: 'Подпись слайда (Куплет 1…)', number: 'Номер песни', static: 'Свой текст',
  };
  const KINDS = { text: 'Текст', rect: 'Прямоугольник', ellipse: 'Эллипс', line: 'Линия', arrow: 'Стрелка', poly: 'Фигура', image: 'Картинка', video: 'Видео' };
  const POLYS = {
    triangle: { name: 'Треугольник', pts: [[0.5, 0], [1, 1], [0, 1]] },
    diamond: { name: 'Ромб', pts: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
    hexagon: { name: 'Шестиугольник', pts: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]] },
    star: { name: 'Звезда', pts: [[0.5, 0], [0.61, 0.35], [0.98, 0.35], [0.68, 0.57], [0.79, 0.91], [0.5, 0.7], [0.21, 0.91], [0.32, 0.57], [0.02, 0.35], [0.39, 0.35]] },
    chevron: { name: 'Шеврон', pts: [[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]] },
    banner: { name: 'Лента', pts: [[0, 0], [1, 0], [0.92, 0.5], [1, 1], [0, 1], [0.08, 0.5]] },
  };

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  // Недостающие поля — из образца (на один-два уровня вглубь), лишние не трогаем
  function fill(x, def) {
    const out = isObj(x) ? x : {};
    for (const [k, v] of Object.entries(def)) {
      if (!(k in out) || out[k] == null) out[k] = clone(v);
      else if (isObj(v) && isObj(out[k])) fill(out[k], v);
    }
    return out;
  }

  const SHADOW = { on: false, color: '#000000', op: 0.6, blur: 1.5, angle: 90, dist: 0.5 };
  const BG = { type: 'none', color: '#000000', a: '#0b2a3a', b: '#000000', angle: 180, radial: false, url: '', path: '', name: '', fit: 'cover', op: 1, blur: 0, dim: 0, sat: 1, bright: 1 };
  const ANIM = { in: { type: 'none', by: 'all', ms: 600, delay: 0, dir: 'up', trigger: 'slide', order: 1 }, out: { type: 'none', ms: 400, delay: 0, dir: 'down' } };
  const COMMON = {
    name: '', x: 20, y: 20, w: 60, h: 30, rot: 0, flipX: false, flipY: false, opacity: 1, blend: 'normal', hidden: false, locked: false, group: '',
    fill: { type: 'color', color: '#ffffff', a: '#ffffff', b: '#7c5841', angle: 90, radial: false, op: 1, url: '' },
    stroke: { w: 0, color: '#ffffff', op: 1 }, shadow: SHADOW, radius: 0, feather: 0,
    fx: { blur: 0, invert: false, sat: 1, bright: 1 }, anim: ANIM,
  };
  const TEXT = {
    bind: 'static', text: 'Текст', font: 'segoe', size: 7, weight: 500, italic: false, underline: false, strike: false, upper: false, case: '',
    align: 'center', valign: 'middle', lh: 1.25, ls: 0, pad: 1, fit: 'shrink', min: 1, max: 14,
    tfill: { type: 'color', color: '#ffffff', a: '#ffffff', b: '#aa7452', angle: 90, url: '', op: 1 },
    tstroke: { w: 0, color: '#000000', op: 1 }, tshadow: { ...SHADOW, op: 0.75, blur: 0.8, dist: 0.25 },
    scroll: { on: false, dir: 'left', speed: 10, fade: 6 },
    plate: { on: false, mode: 'block', color: '#000000', op: 0.5, blur: 0, pad: 1.5, radius: 1, w: 80, h: 20, dx: 0, dy: 0, stroke: { w: 0, color: '#ffffff', op: 1 }, shadow: { ...SHADOW } },
  };
  const MEDIA = { url: '', path: '', name: '', fit: 'cover', crop: { l: 0, t: 0, r: 0, b: 0 }, loop: true, mute: true, filt: { blur: 0, sat: 1, bright: 1, contrast: 1, hue: 0, gray: 0 } };

  // Новый объект или дополнить старый всеми полями
  function norm(o) {
    const kind = KINDS[o.kind] ? o.kind : 'rect';
    const def = { ...clone(COMMON), name: KINDS[kind] };
    if (kind === 'text') Object.assign(def, clone(TEXT), { fill: { ...def.fill, type: 'none' } });
    if (kind === 'line' || kind === 'arrow') Object.assign(def, { h: 4, stroke: { w: 0.5, color: '#ffffff', op: 1 }, fill: { ...def.fill, type: 'none' } });
    if (kind === 'poly') Object.assign(def, { shape: 'star', pts: POLYS.star.pts });
    if (kind === 'image' || kind === 'video') Object.assign(def, clone(MEDIA), { fill: { ...def.fill, type: 'none' } });
    // Регистр: раньше было только upper: true — теперь case (upper | lower | title)
    if (kind === 'text' && o.case == null) o.case = o.upper ? 'upper' : '';
    const out = fill(o, def);
    out.kind = kind;
    if (!out.id) out.id = newId();
    return out;
  }
  const obj = (kind, p = {}) => norm({ ...clone(p), kind });

  function tpl(p = {}) {
    const t = fill(clone(p), { name: 'Шаблон', use: 'any', bg: BG, objs: [], media: null, safe: 5, guides: [] });
    if (!t.id) t.id = newId();
    t.objs = t.objs.map(norm);
    return t;
  }
  // Тема для редактора: у каждой есть шаблоны (старые — переносом из style), у объектов — все поля
  function ensure(t) {
    if (!Array.isArray(t.templates) || !t.templates.length) t.templates = [fromStyle(t.style || {})];
    t.templates = t.templates.map(tpl);
    return t;
  }

  // Старая тема (style) → шаблон, который выглядит так же: фон и один блок текста слайда во весь экран с полями
  function fromStyle(st) {
    const pad = st.pad != null ? Number(st.pad) : 5;
    const scale = Number(st.scale) || 1;
    const bg = st.bgUrl ? { type: st.bgVideo ? 'video' : 'image', url: st.bgUrl, blur: (Number(st.blur) || 0) / 10.8, dim: Number(st.dim) || 0 }
      : st.bg && st.bg.toLowerCase() !== '#000000' ? { type: 'color', color: st.bg, dim: Number(st.dim) || 0 } : { type: 'none' };
    const body = obj('text', {
      name: 'Текст слайда', bind: 'content', x: pad * 1.4, y: pad, w: 100 - pad * 2.8, h: 100 - pad * 2, pad: 0,
      font: st.font || 'segoe', size: 12 * scale, max: 12 * scale, min: 0.4, fit: 'both', weight: Number(st.weight) || 500, italic: !!st.italic, upper: !!st.upper,
      align: st.align || 'center', valign: st.valign || 'middle', lh: Number(st.lineHeight) || 1.25,
      tfill: { type: 'color', color: st.color || '#ffffff' }, tshadow: { on: !!st.shadow, color: '#000000', op: 0.85, blur: 1.2, angle: 90, dist: 0.3 },
    });
    return tpl({ name: 'Основной', use: 'any', bg, objs: [body] });
  }

  /* ----- Стандартные темы (только чтение; «Копия» — своя тема, её можно менять) ----- */
  const plate50 = { on: true, mode: 'block', color: '#000000', op: 0.5, blur: 1.2, pad: 2, radius: 1.6 };
  const shadowT = { on: true, color: '#000000', op: 0.8, blur: 0.8, angle: 90, dist: 0.25 };
  const BUILTIN = [
    {
      id: 'std-church', std: true, name: 'Церковь (стандартная)', style: { font: 'segoe', color: '#ffffff', bg: '#000000', weight: 600, shadow: true },
      templates: [
        { id: 'std-church-song', name: 'Текст песни', use: 'song', objs: [
          { kind: 'text', name: 'Текст слайда', bind: 'content', x: 6, y: 8, w: 88, h: 84, size: 10, max: 10, min: 1, fit: 'both', weight: 600, tshadow: shadowT },
        ] },
        { id: 'std-church-plate', name: 'Песня с подложкой', use: 'any', objs: [
          { kind: 'text', name: 'Текст слайда', bind: 'content', x: 8, y: 10, w: 84, h: 80, size: 8, max: 8, min: 1, fit: 'both', weight: 600, plate: plate50 },
        ] },
        { id: 'std-church-bible', name: 'Библия', use: 'bible', objs: [
          { kind: 'text', name: 'Стих', bind: 'content', x: 6, y: 52, w: 88, h: 32, size: 6, max: 6, min: 1, fit: 'shrink', align: 'left', valign: 'bottom', weight: 500, lh: 1.3, plate: { ...plate50, mode: 'wide', op: 0.6, radius: 0, pad: 2 } },
          { kind: 'text', name: 'Ссылка', bind: 'ref', x: 6, y: 86, w: 88, h: 8, size: 4, max: 4, fit: 'shrink', align: 'left', valign: 'top', weight: 700, tfill: { type: 'color', color: '#e6c9a8' }, tshadow: shadowT },
        ] },
        { id: 'std-church-ref', name: 'Ссылка на отрывок', use: 'ref', objs: [
          { kind: 'rect', name: 'Полоса', x: 0, y: 40, w: 100, h: 20, fill: { type: 'gradient', a: '#051822', b: '#7c5841', angle: 90, op: 0.75 }, fx: { blur: 1 } },
          { kind: 'text', name: 'Ссылка', bind: 'ref', x: 5, y: 40, w: 90, h: 20, size: 9, max: 9, fit: 'shrink', weight: 700, upper: true, ls: 0.04 },
          { kind: 'text', name: 'Перевод', bind: 'translation', x: 5, y: 61, w: 90, h: 6, size: 3, fit: 'shrink', weight: 500, tfill: { type: 'color', color: '#d4c9c7' } },
        ] },
        { id: 'std-church-title', name: 'Заголовок', use: 'title', objs: [
          { kind: 'text', name: 'Название', bind: 'title', x: 8, y: 34, w: 84, h: 20, size: 11, max: 11, fit: 'shrink', weight: 800, upper: true, tfill: { type: 'gradient', a: '#ffffff', b: '#e6c9a8', angle: 180 }, tshadow: shadowT,
            anim: { in: { type: 'move', by: 'words', ms: 700, dir: 'up' } } },
          { kind: 'line', name: 'Черта', x: 38, y: 57, w: 24, h: 2, stroke: { w: 0.35, color: '#aa7452' }, anim: { in: { type: 'scale', ms: 600, delay: 300 } } },
          { kind: 'text', name: 'CCLI', bind: 'ccli', x: 8, y: 88, w: 84, h: 6, size: 2.6, fit: 'shrink', weight: 400, tfill: { type: 'color', color: '#d4c9c7', op: 0.85 } },
        ] },
      ],
    },
    {
      id: 'std-lower', std: true, name: 'Нижняя треть (стандартная)', style: { valign: 'bottom', pad: 4, scale: 0.7, weight: 700, shadow: true },
      templates: [
        { id: 'std-lower-text', name: 'Текст внизу', use: 'any', objs: [
          { kind: 'rect', name: 'Тень снизу', x: 0, y: 62, w: 100, h: 38, fill: { type: 'gradient', a: '#000000', b: '#000000', angle: 180, op: 0.75, opA: 0 } },
          { kind: 'text', name: 'Текст слайда', bind: 'content', x: 6, y: 72, w: 88, h: 22, size: 5.5, max: 5.5, min: 1, fit: 'shrink', valign: 'bottom', weight: 700, tshadow: shadowT,
            plate: { on: true, mode: 'lines', color: '#051822', op: 0.85, pad: 0.8, radius: 0.6 } },
          { kind: 'text', name: 'Ссылка', bind: 'ref', x: 6, y: 94, w: 88, h: 5, size: 2.8, fit: 'shrink', valign: 'top', weight: 600, tfill: { type: 'color', color: '#aa7452' } },
        ] },
      ],
    },
  ].map((t) => ensure(t));

  const all = (user) => [...BUILTIN, ...(user || [])];
  const find = (user, id) => (id ? all(user).find((t) => t.id === id) || null : null);

  // Оформление для сцены: старый style + шаблоны (style.tpls)
  const style = (t) => (t.templates && t.templates.length ? { ...t.style, tpls: t.templates } : { ...t.style });

  // Шаблоны темы, из которых можно выбрать для слайда
  const templatesOf = (t) => (t && Array.isArray(t.templates) ? t.templates : []);

  // Копия темы с новыми id (для «Копия» и импорта): ссылки на шаблоны у слайдов указывают на старые id, поэтому id шаблонов меняем только по просьбе
  function copy(t, newTplIds) {
    const c = clone(t);
    c.id = newId();
    delete c.std;
    if (newTplIds) c.templates = (c.templates || []).map((x) => ({ ...x, id: newId(), objs: (x.objs || []).map((o) => ({ ...o, id: newId() })) }));
    return c;
  }

  // Файл темы (открытый формат JSON): { app, kind: 'theme', version, themes: [...] }
  const exportData = (list) => ({ app: 'church-presenter', kind: 'theme', version: 1, themes: clone(list).map((t) => { delete t.std; return t; }) });
  function importData(data) {
    const list = data && data.kind === 'theme' && Array.isArray(data.themes) ? data.themes : data && Array.isArray(data.templates) ? [data] : null;
    if (!list) return null;
    return list.filter((t) => t && typeof t === 'object').map((t) => ensure({ ...copy(t, true), name: String(t.name || 'Тема') }));
  }

  return { newId, USES, BINDS, KINDS, POLYS, norm, obj, tpl, ensure, fromStyle, BUILTIN, all, find, style, templatesOf, copy, exportData, importData };
})();
