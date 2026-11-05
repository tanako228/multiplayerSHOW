/* ---------- Единая модель: всё — презентация из слайдов ----------
   Презентация: { id, type: 'pres', kind, name, theme?, slides: [слайд] }
     kind — только подпись в списке: song | bible | media | deck | audio | custom | mixed.
   Слайд: { id, k, label?, theme?, ... } — вид слайда k:
     text   { text }                       — песня или любой текст
     bible  { ref, verses: [{n, t}], translation, trs?, extra? }
                                           — trs: тот же стих во всех переводах на экране [{ ref, verses, translation }],
                                             основной первым (куда каждый — settings.bSlots); у слайдов 04.11.2026 — par (второй);
                                             extra: дополнительный стих, загруженный заранее (в ленте бледнее)
     image  { url, path, name, fit? }      — fit: contain | cover | fill | none
     video  { url, path, name, fit? }
     audio  { url, path, name }            — на экран не выводится, играет музыку
     tpl?   — у текстовых слайдов: id шаблона темы (themes.js), иначе шаблон выбирается сам по виду слайда
     look?  — у text | bible | custom: свой вид слайда — шаблон темы только для этого слайда (Themes.tpl: фон и объекты).
              Правится в редакторе тем («Изменить в редакторе», themeeditor.js). Важнее темы и шаблона; тема экрана — важнее его.
     custom { elements: [...] }            — свой слайд: блоки текста и картинок
     live   { src: { type, id, label }, name, fit? } — живой источник из «Медиапул → Источники»
                                           (type: camera | screen | mic | ndi …, см. Scene.LIVE)
   Слайды любого вида можно копировать и вставлять в любую презентацию.
   Подключается и в окне оператора, и в редакторе. */

const Slides = (() => {
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const SLIDE_NAMES = { text: 'Текст', bible: 'Библия', image: 'Картинка', video: 'Видео', audio: 'Музыка', custom: 'Свой слайд', live: 'Источник' };
  const PRES_NAMES = { song: 'Песня', bible: 'Библия', media: 'Медиа', deck: 'Презентация', audio: 'Музыка', custom: 'Слайды', mixed: 'Презентация' };

  // Какая «общая» тема действует для слайда этого вида (Настройки темы по умолчанию)
  const themeKind = (s) => ({ text: 'song', bible: 'bible', custom: 'custom', image: 'media', video: 'media', live: 'media' })[s.k] || '';

  // Слайд → то, что рисует сцена (scene.js)
  // opt.meta — данные для полей шаблона темы: { title, ccli, number }; slide.tpl — шаблон темы, выбранный для слайда вручную
  function content(slide, style, opt = {}) {
    const th = { tpl: slide.tpl || undefined, meta: { ...(opt.meta || {}), label: slide.label || '' } };
    // Свой вид слайда — единственный шаблон для этого слайда
    if (slide.look && slide.look.id && ['text', 'bible', 'custom'].includes(slide.k)) {
      style = { ...style, tpls: [slide.look], tpl: slide.look.id };
      th.tpl = slide.look.id;
    }
    switch (slide.k) {
      case 'text': return { type: 'text', text: slide.text || ' ', style, ...th };
      case 'bible': return { type: 'text', verses: slide.verses || [], ref: slide.ref || '', translation: slide.translation, trs: slide.trs || undefined, par: slide.par || undefined, style, ...th };
      case 'custom': return { type: 'custom', elements: slide.elements || [], style, ...th };
      case 'image': return { type: 'image', url: slide.url, fit: slide.fit || opt.fit, style };
      case 'video': return { type: 'video', url: slide.url, fit: slide.fit || opt.fit, sound: opt.sound, loop: opt.loop, style };
      // Звук источника слышен на выводе только у звуковых источников (у камеры — нет, чтобы не было эха)
      case 'live': return { type: 'live', src: slide.src || {}, fit: slide.fit || opt.fit, sound: !!(slide.src && ['mic', 'ndi'].includes(slide.src.type)), style };
      // Музыку на экран не выводим; эта картинка — только для редактора
      case 'audio': return { type: 'text', text: '♪ ' + (slide.name || 'Музыка'), style: { bg: '#0d212b', color: '#aa7452', font: 'segoe', weight: 600, scale: 0.6 } };
      default: return { type: 'text', text: ' ', style };
    }
  }

  // Вид презентации по её слайдам — для подписи в списке
  function presKind(p) {
    const ks = new Set(p.slides.map((s) => s.k));
    if (ks.size !== 1) return ks.size ? 'mixed' : p.kind || 'custom';
    const k = [...ks][0];
    if (k === 'text') return 'song';
    if (k === 'image') return p.kind === 'deck' || p.slides.length > 1 ? 'deck' : 'media';
    if (k === 'video' || k === 'live') return 'media';
    return k;
  }

  // Копия слайдов с новыми id — для вставки
  function copy(slides) {
    return JSON.parse(JSON.stringify(slides)).map((s) => {
      s.id = newId();
      if (s.elements) s.elements.forEach((e) => { e.id = newId(); });
      return s;
    });
  }

  // Текстом — чтобы скопированное можно было вставить и в Word или блокнот
  function toText(slides) {
    return slides.map((s) => {
      if (s.k === 'text') return s.text;
      if (s.k === 'bible') return (s.verses || []).map((v) => v.t).join(' ') + (s.ref ? `\n(${s.ref})` : '');
      if (s.k === 'custom') return (s.elements || []).filter((e) => e.kind === 'text').map((e) => e.text).join('\n') || '[свой слайд]';
      return `[${SLIDE_NAMES[s.k] || 'слайд'}: ${s.name || ''}]`;
    }).join('\n\n');
  }

  /* Песня текстом: пустая строка — новый слайд, «Куплет 1», «Припев» — подписи */
  const LABEL_RE = /^(куплет|припев|пред-?припев|бридж|мост|запев|вступление|окончание|концовка|кода|verse|chorus|pre-?chorus|bridge|tag|intro|outro|ending)[\s\d.]*:?$/i; // \b не работает с кириллицей

  function parseText(text) {
    const blocks = String(text).replace(/\r/g, '').split(/\n[ \t]*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
    const slides = [];
    let pending = '';
    for (const lines of blocks) {
      let label = '';
      if (LABEL_RE.test(lines[0])) label = lines.shift().replace(/:$/, '');
      if (!lines.length) {
        // Одна подпись без текста: «Припев» после того, как он уже был, — повторить его
        const prev = slides.filter((s) => s.label && s.label.toLowerCase() === label.toLowerCase());
        if (prev.length) prev.forEach((s) => slides.push({ ...s, id: newId() }));
        else pending = label;
        continue;
      }
      slides.push({ id: newId(), k: 'text', label: label || pending, text: lines.join('\n') });
      pending = '';
    }
    return slides;
  }

  const textOf = (slides) => slides.filter((s) => s.k === 'text').map((s) => (s.label ? s.label + '\n' : '') + s.text).join('\n\n');

  // Файл (из диалога, медиапула или перетаскивания) → презентация
  function fromFile(f) {
    if (f.type === 'deck') {
      return { id: newId(), type: 'pres', kind: 'deck', name: f.name, slides: f.slides.map((s, i) => ({ id: newId(), k: 'image', url: s.url, path: s.path, name: `${f.name} — ${i + 1}` })) };
    }
    const s = { id: newId(), k: f.type, url: f.url, path: f.path, name: f.name };
    if (f.fit) s.fit = f.fit;
    return { id: newId(), type: 'pres', kind: f.type === 'audio' ? 'audio' : 'media', name: f.name, slides: [s] };
  }

  // Старые элементы (до «всё — слайды») → презентации
  function migrate(it) {
    if (!it || it.type === 'pres') return it;
    const base = { id: it.id, type: 'pres', name: it.name };
    if (it.theme) base.theme = it.theme;
    const sl = (s) => ({ id: newId(), ...s });
    switch (it.type) {
      case 'song': return { ...base, kind: 'song', slides: it.slides.map((s) => sl({ k: 'text', label: s.label || '', text: s.text, theme: s.theme })) };
      case 'bible': return { ...base, kind: 'bible', slides: it.slides.map((s) => sl({ k: 'bible', label: s.label, ref: s.ref, verses: s.verses, translation: it.translation })) };
      case 'custom': return { ...base, kind: 'custom', slides: it.slides.map((s) => sl({ k: 'custom', label: s.label, theme: s.theme, elements: s.elements || [] })) };
      case 'deck': return { ...base, kind: 'deck', slides: it.slides.map((s, i) => sl({ k: 'image', url: s.url, path: s.path, name: `${it.name} — ${i + 1}`, fit: it.fit })) };
      case 'image': case 'video': return { ...base, kind: 'media', slides: [sl({ k: it.type, url: it.url, path: it.path, name: it.name, fit: it.fit })] };
      case 'audio': return { ...base, kind: 'audio', slides: [sl({ k: 'audio', url: it.url, path: it.path, name: it.name })] };
      default: return { ...base, kind: 'custom', slides: [] };
    }
  }

  // Стихи из Библии → слайды, по стиху на слайд
  function fromBible(book, ci, v1, v2, chapter, translation) {
    const out = [];
    for (let v = v1; v <= v2; v++) {
      if (chapter[v - 1]) out.push({ id: newId(), k: 'bible', label: String(v), ref: `${book} ${ci + 1}:${v}`, verses: [{ n: v, t: chapter[v - 1] }], translation });
    }
    return out;
  }

  return { newId, SLIDE_NAMES, PRES_NAMES, themeKind, content, presKind, copy, toText, parseText, textOf, fromFile, migrate, fromBible };
})();
