// Общая «сцена»: рисует содержимое экрана (картинка, видео, текст, свой слайд) с переходами
// и слой рисунка поверх. Используется в окне вывода, в предпросмотре и в редакторе.
//
// Оформление текста (style, оно же «тема»):
//   font, scale, color, bg, showTranslation — как раньше;
//   bgUrl, bgVideo — фон-картинка или фон-видео; blur — размытие фона (пиксели при 1080p);
//   dim — затемнение фона 0…0.9; weight — 400/600/800; italic; align — left/center/right;
//   valign — top/middle/bottom; shadow; upper — заглавные буквы; lineHeight; pad — поля в %.
const Scene = (() => {
  const FONTS = {
    segoe: '"Segoe UI", system-ui, sans-serif',
    georgia: 'Georgia, "Times New Roman", serif',
    arial: 'Arial, Helvetica, sans-serif',
    times: '"Times New Roman", Times, serif',
    verdana: 'Verdana, Geneva, sans-serif',
    tahoma: 'Tahoma, Verdana, sans-serif',
    trebuchet: '"Trebuchet MS", sans-serif',
    calibri: 'Calibri, Carlito, sans-serif',
    cambria: 'Cambria, Georgia, serif',
    bahnschrift: 'Bahnschrift, "Segoe UI", sans-serif',
    impact: 'Impact, "Arial Black", sans-serif',
    courier: '"Courier New", monospace',
  };
  const FONT_NAMES = {
    segoe: 'Segoe UI', georgia: 'Georgia', arial: 'Arial', times: 'Times New Roman', verdana: 'Verdana', tahoma: 'Tahoma',
    trebuchet: 'Trebuchet MS', calibri: 'Calibri', cambria: 'Cambria', bahnschrift: 'Bahnschrift', impact: 'Impact', courier: 'Courier New',
  };
  const family = (f) => FONTS[f] || (f ? `"${String(f).replace(/"/g, '')}", sans-serif` : FONTS.segoe);

  // Переходы: in — как входит новый слайд, out — как уходит старый (нет — старый просто лежит под новым), ease — плавность.
  // Список для окон выбора — TRANS (id, название); новый переход — строка здесь
  const TL = (x, y) => `translate(${x}, ${y})`;
  const P3 = 'perspective(2400px) ';
  const TRD = {
    fade: { name: 'Плавно', in: [{ opacity: 0 }, { opacity: 1 }] },
    black: { name: 'Через чёрное', in: [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], out: [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], ease: 'linear' },
    blur: { name: 'Размытие', in: [{ opacity: 0, filter: 'blur(40px)' }, { opacity: 1, filter: 'blur(0px)' }] },
    slide: { name: 'Сдвиг', in: [{ opacity: 0, transform: 'translateX(6%)' }, { opacity: 1, transform: 'translateX(0)' }] },
    slideL: { name: 'Сдвиг слева', in: [{ opacity: 0, transform: 'translateX(-6%)' }, { opacity: 1, transform: 'translateX(0)' }] },
    slideUp: { name: 'Сдвиг снизу', in: [{ opacity: 0, transform: 'translateY(6%)' }, { opacity: 1, transform: 'translateY(0)' }] },
    slideDown: { name: 'Сдвиг сверху', in: [{ opacity: 0, transform: 'translateY(-6%)' }, { opacity: 1, transform: 'translateY(0)' }] },
    cover: { name: 'Наезд справа', in: [{ transform: TL('100%', 0) }, { transform: TL(0, 0) }], ease: 'ease-in-out' },
    coverL: { name: 'Наезд слева', in: [{ transform: TL('-100%', 0) }, { transform: TL(0, 0) }], ease: 'ease-in-out' },
    coverUp: { name: 'Наезд снизу', in: [{ transform: TL(0, '100%') }, { transform: TL(0, 0) }], ease: 'ease-in-out' },
    coverDown: { name: 'Наезд сверху', in: [{ transform: TL(0, '-100%') }, { transform: TL(0, 0) }], ease: 'ease-in-out' },
    push: { name: 'Толкнуть влево', in: [{ transform: TL('100%', 0) }, { transform: TL(0, 0) }], out: [{ transform: TL(0, 0) }, { transform: TL('-100%', 0) }], ease: 'ease-in-out' },
    pushR: { name: 'Толкнуть вправо', in: [{ transform: TL('-100%', 0) }, { transform: TL(0, 0) }], out: [{ transform: TL(0, 0) }, { transform: TL('100%', 0) }], ease: 'ease-in-out' },
    pushUp: { name: 'Толкнуть вверх', in: [{ transform: TL(0, '100%') }, { transform: TL(0, 0) }], out: [{ transform: TL(0, 0) }, { transform: TL(0, '-100%') }], ease: 'ease-in-out' },
    pushDown: { name: 'Толкнуть вниз', in: [{ transform: TL(0, '-100%') }, { transform: TL(0, 0) }], out: [{ transform: TL(0, 0) }, { transform: TL(0, '100%') }], ease: 'ease-in-out' },
    zoom: { name: 'Увеличение', in: [{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'scale(1)' }] },
    zoomIn: { name: 'Из глубины', in: [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }] },
    zoomOut: { name: 'Навстречу', in: [{ opacity: 0, transform: 'scale(1.5)' }, { opacity: 1, transform: 'scale(1)' }], out: [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.85)' }] },
    wipe: { name: 'Шторка вправо', in: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], ease: 'ease-in-out' },
    wipeL: { name: 'Шторка влево', in: [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }], ease: 'ease-in-out' },
    wipeUp: { name: 'Шторка вверх', in: [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], ease: 'ease-in-out' },
    wipeDown: { name: 'Шторка вниз', in: [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], ease: 'ease-in-out' },
    split: { name: 'Раскрытие от центра', in: [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }], ease: 'ease-in-out' },
    splitV: { name: 'Раскрытие по горизонтали', in: [{ clipPath: 'inset(50% 0 50% 0)' }, { clipPath: 'inset(0 0 0 0)' }], ease: 'ease-in-out' },
    circle: { name: 'Круг', in: [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }], ease: 'ease-in' },
    diamond: { name: 'Ромб', in: [{ clipPath: 'polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)' }, { clipPath: 'polygon(50% -50%, 150% 50%, 50% 150%, -50% 50%)' }], ease: 'ease-in' },
    flip: { name: 'Переворот', in: [{ opacity: 0, transform: P3 + 'rotateY(90deg)' }, { opacity: 0, transform: P3 + 'rotateY(90deg)', offset: 0.5 }, { opacity: 1, transform: P3 + 'rotateY(0deg)' }],
      out: [{ opacity: 1, transform: P3 + 'rotateY(0deg)' }, { opacity: 0, transform: P3 + 'rotateY(-90deg)', offset: 0.5 }, { opacity: 0, transform: P3 + 'rotateY(-90deg)' }], ease: 'linear' },
    flipV: { name: 'Переворот вверх', in: [{ opacity: 0, transform: P3 + 'rotateX(-90deg)' }, { opacity: 0, transform: P3 + 'rotateX(-90deg)', offset: 0.5 }, { opacity: 1, transform: P3 + 'rotateX(0deg)' }],
      out: [{ opacity: 1, transform: P3 + 'rotateX(0deg)' }, { opacity: 0, transform: P3 + 'rotateX(90deg)', offset: 0.5 }, { opacity: 0, transform: P3 + 'rotateX(90deg)' }], ease: 'linear' },
    spin: { name: 'Вращение', in: [{ opacity: 0, transform: 'rotate(-90deg) scale(.3)' }, { opacity: 1, transform: 'rotate(0deg) scale(1)' }] },
    drop: { name: 'Падение', in: [{ opacity: 0, transform: 'translateY(-12%)' }, { opacity: 1, transform: 'translateY(1.5%)', offset: 0.7 }, { opacity: 1, transform: 'translateY(0)' }] },
  };
  const FRAMES = Object.fromEntries(Object.entries(TRD).map(([k, v]) => [k, v.in]));
  const TRANS = [...Object.entries(TRD).map(([k, v]) => [k, v.name]), ['none', 'Без перехода']];
  // Анимация входа (и ухода старых слоёв, если у перехода есть out)
  function animIn(el, tr, ms) {
    const d = TRD[tr && tr.type] || TRD.fade;
    return el.animate(d.in, { duration: ms, easing: d.ease || 'ease-out' });
  }
  function animOut(els, tr, ms) {
    const d = TRD[tr && tr.type];
    if (!d || !d.out) return;
    els.forEach((n) => n.animate(d.out, { duration: ms, easing: d.ease || 'ease-out', fill: 'forwards' }));
  }

  const style = document.createElement('style');
  style.textContent = `
    .layer { position: absolute; inset: 0; background: #000; overflow: hidden; container-type: size; }
    .layer > img.media, .layer > video.media { width: 100%; height: 100%; display: block; }
    .layer .bgm { position: absolute; inset: -3%; width: 106%; height: 106%; object-fit: cover; }
    .layer .dim { position: absolute; inset: 0; }
    .layer .content { position: absolute; inset: 0; display: flex; flex-direction: column; box-sizing: border-box; }
    .layer.text .body { line-height: 1.25; font-weight: 500; max-width: 100%; overflow-wrap: break-word; }
    .layer.text sup { font-size: .55em; opacity: .7; margin-right: .15em; }
    .layer.text .ref { margin-top: .9em; opacity: .8; font-weight: 600; }
    .layer .par { display: flex; justify-content: space-between; gap: 1.2em; width: 100%; align-items: flex-start; }
    .layer .par > .pc { flex: 1 1 0; min-width: 0; overflow-wrap: break-word; }
    .layer .el { position: absolute; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; }
    .layer .el.t { white-space: pre-wrap; overflow-wrap: break-word; line-height: 1.2; }
    .layer .el img { width: 100%; height: 100%; display: block; }
    .layer .live-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 6%; text-align: center; color: #9fb3c8; font: 500 3.2cqh "Segoe UI", sans-serif; }
    svg.ink { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; overflow: visible; }
    .slot { position: absolute; inset: 0; overflow: hidden; }
    .slot > .layer { background: transparent; }
    .layer.themed { background: transparent; }
    .layer .tbg { position: absolute; inset: 0; overflow: hidden; }
    .layer .tbg > img, .layer .tbg > video { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .layer .tbg > .soft { inset: -3%; width: 106%; height: 106%; }
    .layer .ob { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; }
    .layer .ob.t2 { overflow: hidden; }
    .layer .ob.t2.vis { overflow: visible; }
    .layer .ob .pl { position: relative; max-width: 100%; box-sizing: border-box; }
    .layer .ob .tx { white-space: pre-line; overflow-wrap: break-word; }
    .layer .ob .tx sup { font-size: .55em; opacity: .7; margin-right: .15em; }
    .layer .ob .tx .ref { margin-top: .9em; opacity: .8; font-weight: 600; font-size: max(.5em, 2.5cqh); }
    .layer .ob .ln2 { -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .layer .ob .pf { position: absolute; left: 50%; top: 50%; box-sizing: border-box; }
    .layer .ob .w { display: inline-block; white-space: nowrap; }
    .layer .ob .w > .u { display: inline-block; }
    .layer .ob > .shp, .layer .ob > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .layer .ob > .ln { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); }
    .layer .ob > .ah { position: absolute; right: 0; top: 50%; transform: translateY(-50%); clip-path: polygon(0 0, 100% 50%, 0 100%); }
    .layer .ob > .m { width: 100%; height: 100%; display: block; }
    .layer.leaving > :not(.ob.dyn), .layer.leaving .pf { visibility: hidden; }
    .layer.leaving .ob.dyn, .layer.leaving .ob.dyn .pl, .layer.leaving .ob.dyn .ln2 { background: none !important; backdrop-filter: none !important; box-shadow: none !important; border-color: transparent !important; }
  `;
  document.head.append(style);

  function make(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
  const ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' };

  // Фон: цвет, картинка или видео с размытием, сверху затемнение
  function addBackground(layer, st) {
    layer.style.background = st.bg || '#000000';
    if (st.bgUrl) {
      const m = make(st.bgVideo ? 'video' : 'img', 'bgm');
      m.src = st.bgUrl;
      if (st.bgVideo) { m.autoplay = true; m.loop = true; m.muted = true; }
      if (st.blur > 0) m.style.filter = `blur(${(st.blur / 10.8).toFixed(3)}cqh)`;
      layer.append(m);
    }
    if (st.dim > 0) {
      const d = make('div', 'dim');
      d.style.background = `rgba(0,0,0,${Math.min(0.95, st.dim)})`;
      layer.append(d);
    }
  }

  function textLook(el, st) {
    el.style.fontFamily = family(st.font);
    el.style.color = st.color || '#ffffff';
    el.style.fontWeight = String(st.weight || 500);
    el.style.fontStyle = st.italic ? 'italic' : 'normal';
    el.style.textTransform = st.upper ? 'uppercase' : 'none';
    el.style.textShadow = st.shadow ? '0 0.06em 0.25em rgba(0,0,0,.85)' : 'none';
  }

  function buildMedia(c) {
    const st = c.style || {};
    const layer = make('div', 'layer');
    const m = document.createElement(c.type === 'video' ? 'video' : 'img');
    m.className = 'media';
    m.src = c.url;
    // contain — вписать, cover — заполнить с обрезкой, fill — растянуть, none — реальный размер
    m.style.objectFit = ['cover', 'fill', 'none'].includes(c.fit) ? c.fit : 'contain';
    if (st.blur > 0) m.style.filter = `blur(${(st.blur / 10.8).toFixed(3)}cqh)`;
    if (c.type === 'video') {
      m.autoplay = true;
      m.loop = !!c.loop;
      m.muted = !c.sound;
    }
    layer.append(m);
    if (st.dim > 0) {
      const d = make('div', 'dim');
      d.style.background = `rgba(0,0,0,${Math.min(0.95, st.dim)})`;
      layer.append(d);
    }
    return layer;
  }

  /* ----- Живые источники: камера, карта захвата, экран, звук -----
     content: { type: 'live', src: { type, id, label }, fit, sound }.
     Новый тип источника — строка в LIVE: как открыть его поток (getUserMedia; 'open' — свой поток, как NDI). Потоки общие для всего окна:
     один и тот же источник в предпросмотре и на миниатюре открывается один раз. */
  const LIVE = {
    camera: (s) => ({ audio: false, video: { deviceId: { exact: s.id }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } }),
    mic: (s) => ({ video: false, audio: { deviceId: { exact: s.id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
    screen: (s) => ({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: s.id, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 } } }),
    // Звук компьютера (Windows): берётся вместе с картинкой экрана, картинка сразу отбрасывается
    system: () => ({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 320, maxHeight: 180 } } }),
  };
  // NDI: кадры и звук приходят из главного процесса (ndi.js) и складываются в обычный MediaStream
  const ndiSinks = new Map(); // ключ приёмника → { v, a, st, at }
  const api = window.api;
  const NDI_OK = !!(api && api.ndiOpen && typeof MediaStreamTrackGenerator === 'function');
  if (NDI_OK) {
    LIVE.ndi = 'open';
    api.onNdiVideo((m) => {
      const s = ndiSinks.get(m.key);
      if (!s) return api.ndiAck(m.key);
      let f;
      try {
        f = new VideoFrame(m.data, { format: m.alpha ? 'RGBA' : 'RGBX', codedWidth: m.w, codedHeight: m.h, timestamp: Math.round(performance.now() * 1000), layout: [{ offset: 0, stride: m.stride }] });
      } catch { return api.ndiAck(m.key); }
      // следующий кадр — когда этот принят (медленное окно получает только свежие)
      s.v.write(f).catch(() => f.close()).finally(() => api.ndiAck(m.key));
    });
    api.onNdiAudio((m) => {
      const s = ndiSinks.get(m.key);
      if (!s) return;
      try {
        s.a.write(new AudioData({ format: 'f32-planar', sampleRate: m.rate, numberOfFrames: m.n, numberOfChannels: m.ch, timestamp: Math.round(s.at), data: m.data })).catch(() => {});
        s.at += (m.n / m.rate) * 1e6;
      } catch { /* странный кадр звука — пропускаем */ }
    });
    api.onNdiState((m) => {
      const s = ndiSinks.get(m.key);
      if (s) { s.st._ndiLive = m.live; s.st.dispatchEvent(new Event('ndistate')); }
    });
  }
  function ndiStream(src) {
    return api.ndiOpen(src.id).then((key) => {
      if (!key) throw new Error('NDI не открылся');
      const vg = new MediaStreamTrackGenerator({ kind: 'video' });
      const ag = new MediaStreamTrackGenerator({ kind: 'audio' });
      const st = new MediaStream([vg, ag]);
      st._ndiLive = true;
      st._close = () => { ndiSinks.delete(key); api.ndiClose(key); };
      ndiSinks.set(key, { v: vg.writable.getWriter(), a: ag.writable.getWriter(), st, at: performance.now() * 1000 });
      return st;
    });
  }

  // Экран телефона (AirPlay, Miracast): src.id — 'airplay' | 'miracast'; окно с картинкой у каждого подключения своё —
  // спрашиваем у main.js (cast.js), какое сейчас, и берём его как окно экрана
  if (api && api.castWindow) {
    LIVE.cast = 'cast';
    if (api.onCastEvent) api.onCastEvent((m) => {
      if (m && m.ready) setTimeout(() => document.querySelectorAll('.layer.live.lost').forEach((l) => l._retry && l._retry()), 300);
    });
  }
  function castStream(src) {
    return api.castWindow(src.id).then((id) => {
      if (!id) throw new Error('телефон не подключён');
      return navigator.mediaDevices.getUserMedia(LIVE.screen({ id }));
    });
  }

  const streams = new Map(); // ключ → { p: Promise<MediaStream>, users: Set<элемент> }
  const liveKey = (src) => src.type + ':' + (src.id || '');

  function liveStream(src, user) {
    const key = liveKey(src);
    let e = streams.get(key);
    if (!e) {
      const make = LIVE[src.type];
      const p = make === 'open' ? ndiStream(src) : make === 'cast' ? castStream(src) : make && navigator.mediaDevices
        ? navigator.mediaDevices.getUserMedia(make(src)).then((st) => {
          if (src.type === 'system') st.getVideoTracks().forEach((t) => { t.stop(); st.removeTrack(t); });
          return st;
        })
        : Promise.reject(new Error('нет такого источника'));
      e = { p, users: new Set(), born: Date.now() };
      p.catch(() => { if (streams.get(key) === e) streams.delete(key); });
      streams.set(key, e);
    }
    e.users.add(user);
    return e.p;
  }

  // Источник больше никто не показывает — через пару секунд закрыть (камера гаснет)
  function liveRelease(user) {
    for (const [key, e] of streams) {
      if (!e.users.delete(user) || e.users.size) continue;
      setTimeout(() => {
        if (e.users.size || streams.get(key) !== e) return;
        streams.delete(key);
        e.p.then((st) => { st.getTracks().forEach((t) => t.stop()); if (st._close) st._close(); }, () => {});
      }, 2000);
    }
  }
  // Подстраховка: слои, которые убрали со страницы без dispose (например, вместе со списком)
  setInterval(() => {
    for (const e of streams.values()) for (const u of [...e.users]) if (!u.isConnected && Date.now() - (u._born || 0) > 5000) liveRelease(u);
  }, 5000);

  function buildLive(c) {
    const layer = make('div', 'layer live');
    const src = c.src || {};
    const msg = (text) => layer.append(make('div', 'live-msg', text));
    if (!LIVE[src.type]) { msg(src.type === 'ndi' ? `NDI «${src.label || ''}»: установите бесплатные NDI Tools (ndi.video)` : 'Источник недоступен'); return layer; }
    const v = make('video', 'media');
    v.autoplay = true;
    v.playsInline = true;
    v.muted = !c.sound;
    v.style.objectFit = ['cover', 'fill', 'none'].includes(c.fit) ? c.fit : 'contain';
    layer.append(v);
    layer._born = Date.now();
    // Устройство отключили или его нет — надпись; подключат снова — картинка вернётся сама (devicechange)
    const name = src.label || 'Источник';
    const lost = (p, text) => {
      if (layer.classList.contains('lost')) return;
      layer.classList.add('lost');
      const e = streams.get(liveKey(src));
      if (e && e.p === p) streams.delete(liveKey(src)); // мёртвый поток больше никому не выдаём
      v.srcObject = null;
      msg(text);
    };
    layer._retry = () => {
      layer.classList.remove('lost');
      layer.querySelectorAll('.live-msg').forEach((m) => m.remove());
      const p = liveStream(src, layer);
      p.then((st) => {
        if (!st.getTracks().some((t) => t.readyState === 'live')) return lost(p, `«${name}» отключён — ждём подключения`);
        v.srcObject = st;
        v.play().catch(() => {});
        st.getTracks().forEach((t) => t.addEventListener('ended', () => lost(p, `«${name}» отключён — ждём подключения`), { once: true }));
        // NDI: сигнал пропал — надпись поверх (поток не закрываем: появится — картинка вернётся сама)
        const ndiState = () => {
          layer.querySelectorAll('.live-msg').forEach((m) => m.remove());
          if (!st._ndiLive) msg(`NDI «${name}» — нет сигнала, ждём`);
        };
        if (st._close) { st.addEventListener('ndistate', ndiState); ndiState(); }
      }, () => lost(p, src.type === 'cast' ? `«${name}» — ждём: на телефоне «Повтор экрана» → MP SHOW` : `«${name}» не найден — подключите устройство`));
    };
    layer._retry();
    return layer;
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => setTimeout(() => {
      document.querySelectorAll('.layer.live.lost').forEach((l) => l._retry && l._retry());
    }, 800));
  }

  function buildText(c) {
    const st = c.style || {};
    const layer = make('div', 'layer text');
    addBackground(layer, st);
    const content = make('div', 'content');
    const pad = st.pad != null ? st.pad : 5;
    content.style.padding = `${pad}% ${(pad * 1.4).toFixed(2)}%`;
    content.style.justifyContent = JUSTIFY[st.valign] || 'center';
    content.style.alignItems = ALIGN[st.align] || 'center';
    content.style.textAlign = st.align || 'center';
    layer.dataset.scale = String(st.scale || 1);
    const body = make('div', 'body');
    textLook(body, st);
    if (st.lineHeight) body.style.lineHeight = String(st.lineHeight);
    const ref = make('div', 'ref');
    textLook(ref, st);
    ref.style.fontWeight = '600';
    if (c.text != null) {
      // Текст песни: строки как есть, без ссылки внизу
      body.textContent = c.text;
      body.style.whiteSpace = 'pre-line';
      ref.hidden = true;
    } else {
      // Простая тема без своих окон: все переводы с текстом — колонками рядом, ссылки — под ними
      const T = bibleTrs(c, st);
      const txt = T.filter((x) => x.text !== '' && x.verses.length);
      const refs = T.filter((x) => x.ref !== '' && x.line);
      body.dataset.bv = '1';
      if (txt.length > 1) {
        body.style.alignSelf = 'stretch';
        cols(body, txt.map((x) => (d) => versesInto(d, x.verses)));
      } else if (txt.length) versesInto(body, txt[0].verses);
      if (txt.length > 1 && refs.length && refs.every((r) => txt.includes(r))) {
        ref.style.alignSelf = 'stretch';
        cols(ref, txt.map((x) => (d) => { if (refs.includes(x)) d.textContent = x.line; }));
      } else ref.textContent = refs.map((r) => r.line).join('   |   ');
      ref.hidden = !refs.length;
    }
    content.append(body, ref);
    layer.append(content);
    return layer;
  }

  /* Библия: несколько переводов — c.trs = [{ verses, ref, translation }], основной первым (у старых слайдов — c.par).
     Куда идёт каждый — style.bible.slots[i] = { text, ref } (окно «Библия» в программе):
     'auto' — обычное место (окно «текст слайда» / «ссылка» шаблона или под стихом), '' — не показывать,
     иначе — имя текстового окна шаблона темы (textLabels): там оформление, настроенное в «Темах». */
  function bibleTrs(c, st) {
    const list = Array.isArray(c.trs) && c.trs.length ? c.trs
      : [{ verses: c.verses, ref: c.ref, translation: c.translation }].concat(c.par && Array.isArray(c.par.verses) ? [c.par] : []);
    const slots = st.bible && Array.isArray(st.bible.slots) ? st.bible.slots : null;
    const tr = (x) => (st.showTranslation && x.translation ? ` · ${x.translation}` : '');
    return list.map((x, i) => {
      // Строки нет в настройках: основной — как обычно, остальные не показываем
      const s = (slots && slots[i]) || (i && slots ? { text: '', ref: '' } : { text: 'auto', ref: 'auto' });
      return {
        verses: x.verses || [], place: x.ref || '', tr: x.translation || '', line: x.ref ? x.ref + tr(x) : '',
        text: s.text == null ? 'auto' : s.text, ref: s.ref == null ? 'auto' : s.ref,
      };
    }).filter((x) => x.verses.length || x.place);
  }
  // Имена текстовых окон шаблона (повтор имени — «Текст (2)»): по ним переводы привязываются к окнам
  function textLabels(objs) {
    const m = new Map();
    const seen = {};
    for (const o of objs || []) {
      if (!o || o.kind !== 'text' || o.hidden) continue;
      const base = String(o.name || '').trim() || 'Текст';
      seen[base] = (seen[base] || 0) + 1;
      m.set(o, seen[base] > 1 ? `${base} (${seen[base]})` : base);
    }
    return m;
  }
  // Шаблон темы и переводы: что пойдёт в какое окно. Окна, которого нет в этом шаблоне, — как «Авто»
  function bibleBoxes(c, st, objs) {
    const labels = textLabels(objs);
    const names = new Set(labels.values());
    const T = bibleTrs(c, st).map((x) => ({
      ...x,
      textAt: x.text === '' ? '' : names.has(x.text) ? x.text : 'auto',
      refAt: x.ref === '' ? '' : names.has(x.ref) ? x.ref : 'auto',
    }));
    const taken = (o) => T.some((x) => x.textAt === labels.get(o) || x.refAt === labels.get(o));
    const first = (bind) => objs.find((o) => o.kind === 'text' && !o.hidden && o.bind === bind && !taken(o));
    return { T, labels, autoText: first('content'), autoRef: first('ref'), autoTr: first('translation') };
  }
  // Что Библия кладёт в окно шаблона: { verses: [перевод…], under: [ссылки под стихом] } | { value } | null — окно пустое; undefined — не окно Библии
  function bibleInBox(o, B) {
    const lb = B.labels.get(o);
    const T = B.T;
    const mineT = T.filter((x) => x.textAt === lb && x.verses.length);
    if (mineT.length) return { verses: mineT, under: [] };
    const mineR = T.filter((x) => x.refAt === lb && x.line);
    if (mineR.length) return { value: mineR.map((x) => x.line).join('  |  ') };
    if (o === B.autoText) {
      const vs = T.filter((x) => x.textAt === 'auto' && x.verses.length);
      // Своего окна для ссылки нет — ссылка под стихом, как в обычной теме
      return vs.length ? { verses: vs, under: B.autoRef ? [] : T.filter((x) => x.refAt === 'auto' && x.line) } : null;
    }
    if (o === B.autoRef) {
      const rs = T.filter((x) => x.refAt === 'auto' && x.place);
      return rs.length ? { value: rs.map((x) => (B.autoTr ? x.place : x.line)).join('  |  ') } : null;
    }
    if (o === B.autoTr) {
      const rs = T.filter((x) => x.refAt === 'auto' && x.tr);
      return rs.length ? { value: rs.map((x) => x.tr).join('  |  ') } : null;
    }
    if (['content', 'ref', 'translation'].includes(o.bind)) return null; // окно Библии, которому ничего не назначено
    return undefined;
  }
  // Стихи в элемент: номера — надстрочно, если стихов несколько
  function versesInto(el, vs) {
    vs = vs || [];
    const many = vs.length > 1;
    vs.forEach((v, i) => {
      if (many) el.append(make('sup', null, v.n));
      el.append(document.createTextNode(v.t + (i < vs.length - 1 ? ' ' : '')));
    });
  }
  // Колонки поровну: fills — по функции на колонку (заполняет её)
  function cols(parent, fills) {
    const row = make('div', 'par');
    fills.forEach((f) => { const d = make('div', 'pc'); f(d); row.append(d); });
    parent.append(row);
    return row;
  }

  // Свой слайд: блоки текста и картинки, координаты в процентах от экрана
  function buildCustom(c) {
    const st = c.style || {};
    const layer = make('div', 'layer custom');
    addBackground(layer, st);
    for (const e of c.elements || []) layer.append(buildElement(e, st));
    return layer;
  }

  function buildElement(e, st) {
    const el = make('div', 'el' + (e.kind === 'text' ? ' t' : ''));
    el.style.left = e.x + '%';
    el.style.top = e.y + '%';
    el.style.width = e.w + '%';
    el.style.height = e.h + '%';
    if (e.rot) el.style.transform = `rotate(${e.rot}deg)`;
    if (e.kind === 'text') {
      textLook(el, { ...st, ...e, font: e.font || st.font, color: e.color || st.color });
      el.dataset.fs = String(e.size || 6);
      el.style.fontSize = (e.size || 6) + 'cqh';
      el.style.justifyContent = JUSTIFY[e.valign] || 'center';
      el.style.textAlign = e.align || 'center';
      if (e.bgColor) el.style.background = e.bgColor;
      el.textContent = e.text || '';
    } else if (e.kind === 'image') {
      const img = make('img');
      img.src = e.url;
      img.style.objectFit = e.fit === 'cover' ? 'cover' : 'contain';
      el.append(img);
    }
    if (e.radius) el.style.borderRadius = e.radius + 'cqh';
    if (e.opacity != null && e.opacity < 1) el.style.opacity = String(e.opacity);
    return el;
  }

  // Подбирает самый крупный размер шрифта, при котором текст помещается на экран
  function fitText(layer) {
    const content = layer.querySelector('.content');
    const body = layer.querySelector('.body');
    const ref = layer.querySelector('.ref');
    const H = layer.clientHeight;
    if (!H || !content) return;
    const cs = getComputedStyle(content);
    const avail = content.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const scale = parseFloat(layer.dataset.scale) || 1;
    const apply = (px) => {
      body.style.fontSize = px + 'px';
      ref.style.fontSize = Math.max(px * 0.5, H * 0.025) + 'px';
    };
    const fits = (px) => {
      apply(px);
      const refH = ref.hidden ? 0 : ref.offsetHeight + parseFloat(getComputedStyle(ref).marginTop);
      return body.offsetHeight + refH <= avail;
    };
    // Нижняя граница маленькая: длинный текст должен помещаться целиком, пусть и мелко
    let lo = H * 0.004;
    let hi = H * 0.12;
    if (fits(hi)) lo = hi;
    else for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    // «Размер текста» больше 100% — только пока текст помещается
    let px = lo * scale;
    if (scale > 1 && !fits(px)) {
      let a = lo, b = px;
      for (let i = 0; i < 10; i++) { const mid = (a + b) / 2; if (fits(mid)) a = mid; else b = mid; }
      px = a;
    }
    apply(px);
  }

  // Блоки текста своего слайда: если текст не влезает в рамку, уменьшаем шрифт (в данных размер не меняется)
  function fitCustom(layer) {
    layer.querySelectorAll('.el.t').forEach((el) => {
      let size = parseFloat(el.dataset.fs) || 6;
      el.style.fontSize = size + 'cqh';
      for (let i = 0; i < 40 && size > 0.4 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1); i++) {
        size *= 0.92;
        el.style.fontSize = size + 'cqh';
      }
    });
  }

  /* ===== Шаблоны тем (Theme Editor): свой фон и объекты — текст с подложкой, фигуры, картинки, видео =====
     Модель — в themes.js. Здесь только отрисовка: style.tpls → шаблон слайда (pickTpl) → слой .layer.themed.
     Прозрачный фон шаблона — по-настоящему прозрачный: под ним видны нижние слои вывода. */

  const num = (v, d) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : d);
  function rgba(hex, op) {
    let h = String(hex || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, num(op, 1)))})`;
  }
  const cq = (v) => num(v, 0) + 'cqh';
  const offs = (s) => { const a = (num(s.angle, 90) * Math.PI) / 180; const d = num(s.dist, 0); return `${(Math.cos(a) * d).toFixed(3)}cqh ${(Math.sin(a) * d).toFixed(3)}cqh`; };
  const boxShadow = (s) => (s && s.on ? `${offs(s)} ${cq(s.blur)} ${rgba(s.color, s.op)}` : '');
  const dropShadow = (s) => (s && s.on ? `drop-shadow(${offs(s)} ${cq(s.blur)} ${rgba(s.color, s.op)})` : '');
  const cssUrl = (u) => `url("${String(u).replace(/"/g, '%22')}")`;

  // Заливка: цвет, градиент (opA/opB — прозрачность концов) или картинка
  function paint(f) {
    if (!f || !f.type || f.type === 'none') return '';
    if (f.type === 'gradient') {
      const a = rgba(f.a, f.opA != null ? f.opA : f.op);
      const b = rgba(f.b, f.opB != null ? f.opB : f.op);
      return f.radial ? `radial-gradient(circle, ${a}, ${b})` : `linear-gradient(${num(f.angle, 90)}deg, ${a}, ${b})`;
    }
    if (f.type === 'media') return f.url ? `center / cover no-repeat ${cssUrl(f.url)}` : '';
    return rgba(f.color, f.op);
  }
  // Эффекты того, что под объектом (Background Effects): размытие, инверсия, насыщенность, яркость
  function backdrop(fx) {
    if (!fx) return '';
    const p = [];
    if (num(fx.blur, 0) > 0) p.push(`blur(${cq(fx.blur)})`);
    if (fx.invert) p.push('invert(1)');
    if (num(fx.sat, 1) !== 1) p.push(`saturate(${num(fx.sat, 1)})`);
    if (num(fx.bright, 1) !== 1) p.push(`brightness(${num(fx.bright, 1)})`);
    return p.join(' ');
  }
  function mediaFilter(f) {
    if (!f) return '';
    const p = [];
    if (num(f.blur, 0) > 0) p.push(`blur(${cq(f.blur)})`);
    if (num(f.bright, 1) !== 1) p.push(`brightness(${num(f.bright, 1)})`);
    if (num(f.contrast, 1) !== 1) p.push(`contrast(${num(f.contrast, 1)})`);
    if (num(f.sat, 1) !== 1) p.push(`saturate(${num(f.sat, 1)})`);
    if (num(f.hue, 0)) p.push(`hue-rotate(${num(f.hue, 0)}deg)`);
    if (num(f.gray, 0) > 0) p.push(`grayscale(${num(f.gray, 0)})`);
    return p.join(' ');
  }

  // Какой шаблон темы у этого слайда: выбранный вручную (c.tpl), иначе по виду (песня, Библия, свой слайд)
  function pickTpl(c) {
    const list = c && c.style && c.style.tpls;
    if (!Array.isArray(list) || !list.length) return null;
    // Слайд → презентация/общий для вида (style.tpl, окно темы) → по виду; шаблона нет в этой теме — по виду
    const own = (c.tpl && list.find((t) => t.id === c.tpl)) || (c.style.tpl && list.find((t) => t.id === c.style.tpl));
    if (own) return own;
    const want = c.type === 'custom' ? 'any' : c.verses ? 'bible' : 'song';
    return list.find((t) => t.use === want) || list.find((t) => t.use === 'any') || list[0];
  }

  // Данные программы для текстового поля; пусто — поле не выводится (никаких «{title}» на экране)
  function bindValue(o, c) {
    const m = c.meta || {};
    switch (o.bind) {
      case 'ref': return c.ref || '';
      case 'translation': return c.translation || '';
      case 'title': return m.title || '';
      case 'ccli': return m.ccli || '';
      case 'label': return m.label || '';
      case 'number': return m.number ? String(m.number) : '';
      default: return o.text || '';
    }
  }

  // still — миниатюра: видео не играет, показывает первый кадр
  function mediaEl(type, url, still, loop, mute) {
    const m = make(type === 'video' ? 'video' : 'img');
    m.src = url;
    if (type === 'video') {
      m.muted = mute !== false;
      m.loop = loop !== false;
      m.playsInline = true;
      if (still) m.preload = 'metadata'; else m.autoplay = true;
    }
    return m;
  }

  function tplBackground(layer, bg, still) {
    if (!bg || !bg.type || bg.type === 'none') return;
    const d = make('div', 'tbg');
    if (bg.type === 'image' || bg.type === 'video') {
      if (!bg.url) return;
      const m = mediaEl(bg.type, bg.url, still, true, true);
      m.style.objectFit = ['contain', 'fill', 'none'].includes(bg.fit) ? bg.fit : 'cover';
      const f = mediaFilter({ blur: bg.blur, sat: bg.sat, bright: bg.bright });
      if (f) m.style.filter = f;
      if (num(bg.blur, 0) > 0) m.classList.add('soft'); // края размытия не просвечивают
      d.append(m);
    } else d.style.background = paint(bg.type === 'gradient' ? { ...bg, op: 1, opA: undefined, opB: undefined } : { type: 'color', color: bg.color, op: 1 });
    if (num(bg.op, 1) < 1) d.style.opacity = String(Math.max(0, bg.op));
    if (num(bg.dim, 0) > 0) {
      const x = make('div', 'dim');
      x.style.background = `rgba(0,0,0,${Math.min(0.95, bg.dim)})`;
      d.append(x);
    }
    layer.append(d);
  }

  function objBox(o, cls) {
    const el = make('div', 'ob ' + cls);
    el.dataset.oid = o.id || '';
    Object.assign(el.style, { left: num(o.x, 0) + '%', top: num(o.y, 0) + '%', width: num(o.w, 10) + '%', height: num(o.h, 10) + '%' });
    // Поворот и отражение (flipX / flipY)
    const tf = [num(o.rot, 0) ? `rotate(${num(o.rot, 0)}deg)` : '', o.flipX || o.flipY ? `scale(${o.flipX ? -1 : 1}, ${o.flipY ? -1 : 1})` : ''].filter(Boolean).join(' ');
    if (tf) el.style.transform = tf;
    if (num(o.opacity, 1) < 1) el.style.opacity = String(Math.max(0, num(o.opacity, 1)));
    if (o.blend && o.blend !== 'normal') el.style.mixBlendMode = o.blend; // наложение на то, что под объектом
    return el;
  }
  // Заливка, обводка, тень, скругление, эффекты фона (растушёвка и свечение — в objFx)
  function decorate(el, o, round) {
    const bg = paint(o.fill);
    if (bg) el.style.background = bg;
    const s = o.stroke;
    if (s && num(s.w, 0) > 0) el.style.border = `${cq(s.w)} solid ${rgba(s.color, s.op)}`;
    const sh = boxShadow(o.shadow);
    if (sh) el.style.boxShadow = sh;
    if (round) el.style.borderRadius = round;
    else if (num(o.radius, 0) > 0) el.style.borderRadius = cq(o.radius);
    const bd = backdrop(o.fx);
    if (bd) el.style.backdropFilter = bd;
  }

  // Растушёвка и внешнее свечение — у любого объекта.
  // Растушёвка: у картинки и видео — края плавно уходят в прозрачность (маска), у остальных — мягкие края (размытие).
  // Свечение (как Outer Glow в Photoshop) — тень без смещения вокруг всего, что нарисовано; «сила» — сколько раз наложить.
  const fade = (f, dir) => `linear-gradient(${dir}, transparent, #000 ${f}, #000 calc(100% - ${f}), transparent)`;
  function objFx(el, o) {
    const fl = el.style.filter ? [el.style.filter] : [];
    const fe = num(o.feather, 0);
    if (fe > 0) {
      const m = el.querySelector(':scope > .m');
      if (m) {
        const f = cq(fe);
        m.style.maskImage = o.featherRound ? `radial-gradient(closest-side, #000 calc(100% - ${f} * 2), transparent)` : `${fade(f, 'to right')}, ${fade(f, 'to bottom')}`;
        m.style.maskComposite = 'intersect';
      } else fl.push(`blur(${cq(fe)})`);
    }
    const g = o.glow;
    if (g && g.on && num(g.size, 0) > 0) {
      const one = `drop-shadow(0 0 ${cq(g.size)} ${rgba(g.color, g.op)})`;
      for (let i = 0; i < Math.max(1, Math.min(4, Math.round(num(g.power, 1)))); i++) fl.push(one);
    }
    el.style.filter = fl.join(' ');
  }

  // Подложка под текстом: цвет, прозрачность, размытие того, что за ней, поля, скругление, обводка, тень
  function plateLook(e, p, cut) {
    e.style.background = rgba(p.color, p.op);
    if (num(p.radius, 0) > 0) e.style.borderRadius = cq(p.radius);
    const s = p.stroke;
    if (s && num(s.w, 0) > 0) e.style.border = `${cq(s.w)} solid ${rgba(s.color, s.op)}`;
    const sh = boxShadow(p.shadow);
    if (sh) e.style.boxShadow = sh;
    if (num(p.blur, 0) > 0 && !cut) e.style.backdropFilter = `blur(${cq(p.blur)})`;
  }

  const FLEX = { left: 'flex-start', center: 'center', right: 'flex-end', justify: 'stretch' };

  /* ----- Таймеры в текстовых полях тем -----
     Поле с «Что выводить → Таймер» (bind 'timer', o.timer, вид o.tmFmt) или поле, выбранное в самом таймере
     (t.out → c.meta.tm[id объекта] = id таймера, playlist.js contentOf). Ход таймеров приходит из stage.js:
     stSend → Compose.progInfo → setTimers; цифры обновляются здесь каждые 250 мс во всех окнах. */
  let TM = {}; // id → { mode: 'down'|'up', dur (с), run, base, at }
  const p2 = (v) => String(v).padStart(2, '0');
  function tmText(id, fmt) {
    const t = TM[id];
    if (!t) return fmt === 'hms' ? '00:00:00' : '00:00';
    const now = Date.now();
    const el = num(t.base, 0) + (t.run ? now - num(t.at, now) : 0);
    const ms = t.mode === 'up' ? el : num(t.dur, 0) * 1000 - el;
    if (ms < 0 && fmt !== 'over') return fmt === 'hms' ? '00:00:00' : '00:00'; // вышло — стоит на нуле
    const neg = ms < 0;
    let s = Math.abs(ms) / 1000;
    s = t.mode === 'up' || neg ? Math.floor(s) : Math.ceil(s - 0.001);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const out = fmt === 'hms' ? `${p2(h)}:${p2(m)}:${p2(s % 60)}` : fmt === 'ms' ? `${p2(Math.floor(s / 60))}:${p2(s % 60)}` : h ? `${h}:${p2(m)}:${p2(s % 60)}` : `${p2(m)}:${p2(s % 60)}`;
    return (neg ? '−' : '') + out;
  }
  function tmPaint() {
    document.querySelectorAll('.ob[data-tm]').forEach((el) => {
      if (!el._tmText) return;
      const v = tmText(el.dataset.tm, el.dataset.tmf);
      if (el._tmText.textContent !== v) el._tmText.textContent = v;
    });
  }
  function setTimers(m) { TM = m && typeof m === 'object' ? m : {}; tmPaint(); }
  setInterval(tmPaint, 250);

  // B — слайд Библии (bibleBoxes): какие переводы в какие окна
  function buildTextObj(o, c, B, st) {
    let value = null;
    // Таймер: своя привязка поля или поле, выбранное в таймере для этой презентации
    const tmOver = c.meta && c.meta.tm ? c.meta.tm[o.id] : null;
    const isTm = o.bind === 'timer' || !!tmOver;
    const tmId = tmOver || o.timer || '';
    let bib = B && !isTm ? bibleInBox(o, B) : undefined;
    if (bib === null) return null;
    if (isTm) value = tmText(tmId, o.tmFmt);
    else if (bib && bib.value != null) { value = bib.value; bib = undefined; }
    else if (!bib && o.bind === 'content') { if (c.type === 'custom') return null; }
    else if (!bib) { value = bindValue(o, c); if (!String(value).trim()) return null; }
    const el = objBox(o, 't2' + (o.bind && o.bind !== 'static' ? ' dyn' : ''));
    if (o.bind) el.dataset.bind = o.bind;
    decorate(el, o);
    el.style.padding = cq(o.pad);
    el.style.justifyContent = JUSTIFY[o.valign] || 'center';
    el.style.alignItems = FLEX[o.align] || 'center';
    const p = o.plate || {};
    const plate = !!p.on;
    const lines = plate && p.mode === 'lines';
    const f = o.tfill || {};
    const cut = f.type === 'cut' && plate;
    const pl = make('div', 'pl');
    const tx = make('div', 'tx');
    // По строкам: подложка у каждой строки — текст в строчном span
    const holder = (parent) => { if (!lines) return parent; const s = make('span', 'ln2'); parent.append(s); return s; };
    const main = holder(tx);
    let two = false; // несколько переводов в одном окне — колонками во всю ширину
    if (bib) {
      el.dataset.bv = '1'; // здесь стихи (по нему меряют размер текста для деления длинных стихов)
      const vs = bib.verses;
      const under = bib.under || [];
      if (vs.length > 1) {
        two = true;
        if (main !== tx) main.remove();
        cols(tx, vs.map((x) => (d) => versesInto(d, x.verses)));
        if (under.length && under.every((r) => vs.includes(r))) cols(tx, vs.map((x) => (d) => { if (under.includes(x)) d.textContent = x.line; })).classList.add('ref');
        else if (under.length) tx.append(make('div', 'ref', under.map((r) => r.line).join('   |   ')));
      } else {
        versesInto(main, vs[0].verses);
        if (under.length) {
          const r = make('div', 'ref');
          holder(r).textContent = under.map((x) => x.line).join('   |   ');
          tx.append(r);
        }
      }
    } else if (o.bind === 'content' && !isTm) main.textContent = c.text != null ? c.text : '';
    else main.textContent = value;
    if (isTm) { el.dataset.tm = tmId; el.dataset.tmf = o.tmFmt || ''; el._tmText = main; }

    tx.style.fontFamily = family(o.font);
    tx.style.fontWeight = String(o.weight || 500);
    tx.style.fontStyle = o.italic ? 'italic' : 'normal';
    // Регистр: case (upper | lower | title), у старых тем — upper: true
    tx.style.textTransform = { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' }[o.case || (o.upper ? 'upper' : '')] || 'none';
    const deco = [o.underline && 'underline', o.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) tx.style.textDecoration = deco;
    tx.style.lineHeight = String(num(o.lh, 1.25));
    if (num(o.ls, 0)) tx.style.letterSpacing = num(o.ls, 0) + 'em';
    tx.style.textAlign = o.align || 'center';
    if (cut) {
      // Вырезанный текст: буквы — дырки в подложке (маска рисуется после подгонки, cutMask), сквозь них видно то, что под слайдом
      tx.style.color = 'transparent';
      el.dataset.cut = '1';
      splitText(tx, false);
    } else if ((f.type === 'gradient' || (f.type === 'media' && f.url)) && !lines) {
      tx.style.background = paint(f.type === 'gradient' ? f : { type: 'media', url: f.url });
      tx.style.webkitBackgroundClip = 'text';
      tx.style.backgroundClip = 'text';
      tx.style.color = 'transparent';
    } else tx.style.color = rgba(f.type === 'gradient' ? f.a : f.color || '#ffffff', f.op);
    const ts = o.tstroke;
    if (ts && num(ts.w, 0) > 0) { tx.style.webkitTextStroke = `${num(ts.w, 0) * 2}cqh ${rgba(ts.color, ts.op)}`; tx.style.paintOrder = 'stroke fill'; }
    if (!cut) { const ds = dropShadow(o.tshadow); if (ds) tx.style.filter = ds; }

    if (plate) {
      const off = num(p.dx, 0) || num(p.dy, 0) ? `translate(${cq(p.dx)}, ${cq(p.dy)})` : '';
      if (lines && !cut) {
        tx.querySelectorAll('.ln2').forEach((s) => { plateLook(s, p, cut); s.style.padding = `0 ${cq(p.pad)}`; s.style.backdropFilter = ''; });
        if (off) pl.style.transform = off;
      } else if (p.mode === 'fixed') {
        // Подложка своего размера (в % экрана) по центру блока — не зависит от длины текста
        const fx = make('div', 'pf');
        plateLook(fx, p, cut);
        fx.style.width = num(p.w, 80) + 'cqw';
        fx.style.height = num(p.h, 20) + 'cqh';
        fx.style.transform = `translate(-50%, -50%) ${off}`;
        el.prepend(fx);
        el._plate = fx;
        el.classList.add('vis');
      } else if (p.mode === 'wide') {
        // Во всю ширину экрана, по высоте — как текст
        const x = num(o.x, 0);
        const w = num(o.w, 0);
        const pd = num(o.pad, 0);
        plateLook(pl, p, cut);
        Object.assign(pl.style, {
          width: '100cqw', maxWidth: 'none', alignSelf: 'flex-start', marginLeft: `calc(${-x}cqw - ${pd}cqh)`,
          padding: `${cq(p.pad)} calc(${100 - x - w}cqw + ${pd}cqh) ${cq(p.pad)} calc(${x}cqw + ${pd}cqh)`,
        });
        if (off) pl.style.transform = off;
        el.classList.add('vis');
        el._plate = pl;
      } else {
        el._plate = pl;
        plateLook(pl, p, cut);
        pl.style.padding = cq(p.pad);
        if (off) pl.style.transform = off;
      }
    }

    const sc = o.scroll || {};
    if (sc.on) {
      el.dataset.scroll = sc.dir === 'up' ? 'up' : 'left';
      el.dataset.speed = String(num(sc.speed, 10));
      el.classList.remove('vis');
      if (el.dataset.scroll === 'left') { tx.style.whiteSpace = 'nowrap'; pl.style.maxWidth = 'none'; el.style.alignItems = 'flex-start'; }
      else el.style.justifyContent = 'flex-start';
      const fd = Math.max(0, Math.min(45, num(sc.fade, 6)));
      if (fd) el.style.maskImage = `linear-gradient(${el.dataset.scroll === 'up' ? 180 : 90}deg, transparent, #000 ${fd}%, #000 ${100 - fd}%, transparent)`;
    }
    el.dataset.fit = sc.on ? 'none' : o.fit || 'shrink';
    el.dataset.size = String(num(o.size, 7));
    el.dataset.min = String(num(o.min, 1));
    el.dataset.max = String(num(o.max, num(o.size, 7)));
    if (o.fit === 'box' && !sc.on) el.style.height = 'auto';
    el._tx = tx;
    el._pl = pl;
    if (two) { tx.style.width = '100%'; pl.style.width = '100%'; pl.style.alignSelf = 'stretch'; }
    pl.append(tx);
    el.append(pl);
    return el;
  }

  function buildShape(o) {
    const el = objBox(o, 'sh');
    if (o.kind === 'ellipse') decorate(el, o, '50%');
    else if (o.kind === 'poly') {
      const pts = Array.isArray(o.pts) && o.pts.length > 2 ? o.pts : [[0, 0], [1, 0], [1, 1], [0, 1]];
      const body = make('div', 'shp');
      decorate(body, { ...o, stroke: null, shadow: null, radius: 0 });
      body.style.clipPath = `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(',')})`;
      el.append(body);
      const s = o.stroke;
      if (s && num(s.w, 0) > 0) {
        const svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        const pg = document.createElementNS(SVGNS, 'polygon');
        pg.setAttribute('points', pts.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
        pg.setAttribute('fill', 'none');
        pg.setAttribute('vector-effect', 'non-scaling-stroke');
        pg.setAttribute('stroke-linejoin', 'round');
        pg.style.stroke = rgba(s.color, s.op);
        pg.style.strokeWidth = cq(s.w);
        svg.append(pg);
        el.append(svg);
      }
      const ds = dropShadow(o.shadow);
      if (ds) el.style.filter = ds;
    } else if (o.kind === 'line' || o.kind === 'arrow') {
      const s = o.stroke || {};
      const w = Math.max(0.05, num(s.w, 0.5));
      const color = rgba(s.color || '#ffffff', s.op);
      const ln = make('div', 'ln');
      ln.style.height = cq(w);
      ln.style.background = color;
      ln.style.borderRadius = cq(w / 2);
      el.append(ln);
      if (o.kind === 'arrow') {
        const head = make('div', 'ah');
        head.style.width = cq(w * 4);
        head.style.height = cq(w * 3.4);
        head.style.background = color;
        ln.style.right = cq(w * 3.5);
        el.append(head);
      }
      const ds = dropShadow(o.shadow);
      if (ds) el.style.filter = ds;
    } else decorate(el, o);
    return el;
  }

  function buildMediaObj(o, still) {
    if (!o.url) return null;
    const el = objBox(o, 'md');
    decorate(el, o);
    el.style.overflow = 'hidden';
    const m = mediaEl(o.kind, o.url, still, o.loop, o.mute);
    m.classList.add('m');
    m.style.objectFit = ['contain', 'fill', 'none'].includes(o.fit) ? o.fit : 'cover';
    const c = o.crop || {};
    if (num(c.l, 0) || num(c.t, 0) || num(c.r, 0) || num(c.b, 0)) m.style.setProperty('object-view-box', `inset(${num(c.t, 0)}% ${num(c.r, 0)}% ${num(c.b, 0)}% ${num(c.l, 0)}%)`);
    const f = mediaFilter(o.filt);
    if (f) m.style.filter = f;
    el.append(m);
    return el;
  }

  // По словам и по буквам — каждый кусок в своём span (по строкам — по словам, строки находятся при показе)
  function splitText(root, chars) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of n.nodeValue.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        const w = make('span', 'w');
        if (chars) for (const ch of part) w.append(make('span', 'u', ch));
        else { w.classList.add('u'); w.textContent = part; }
        frag.append(w);
      }
      n.replaceWith(frag);
    }
  }

  function buildThemed(c, t) {
    const st = c.style || {};
    const layer = make('div', 'layer themed' + (c.type === 'custom' ? ' custom' : ''));
    layer._tpl = t.id;
    tplBackground(layer, t.bg, st.still);
    const objs = (t.objs || []).filter((o) => o && !o.hidden);
    const B = c.type === 'text' && Array.isArray(c.verses) ? bibleBoxes(c, st, objs) : null; // слайд Библии
    for (const o of objs) {
      const el = o.kind === 'text' ? buildTextObj(o, c, B, st) : o.kind === 'image' || o.kind === 'video' ? buildMediaObj(o, st.still) : buildShape(o);
      if (!el) continue;
      objFx(el, o);
      const a = o.anim || {};
      if (a.in && a.in.type && a.in.type !== 'none') {
        el._in = a.in;
        if (el._tx && a.in.by && a.in.by !== 'all' && !el.dataset.cut) splitText(el._tx, a.in.by === 'chars');
      }
      if (a.out && a.out.type && a.out.type !== 'none') el._out = a.out;
      layer.append(el);
    }
    if (c.type === 'custom') for (const e of c.elements || []) layer.append(buildElement(e, st));
    return layer;
  }

  // Подгонка текста в блоках шаблона: уменьшать, увеличивать, в пределах min…max, блок по тексту, бегущая строка
  function fitObj(el) {
    const tx = el._tx;
    const pl = el._pl;
    if (!tx) return;
    const ds = el.dataset;
    const base = Math.max(0.2, num(ds.size, 7));
    const min = Math.max(0.2, Math.min(base, num(ds.min, 1)));
    const max = Math.max(base, num(ds.max, base));
    const set = (s) => { tx.style.fontSize = s + 'cqh'; };
    if (el._scroll) { el._scroll.cancel(); el._scroll = null; }
    set(base);
    if (ds.scroll) { startScroll(el); return; }
    fitSize(el, base, min, max, set);
    if (ds.cut) cutMask(el);
  }
  function fitSize(el, base, min, max, set) {
    const tx = el._tx;
    const pl = el._pl;
    const mode = el.dataset.fit;
    if (mode === 'none' || mode === 'box') return;
    const cs = getComputedStyle(el);
    const avail = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (!(avail > 0)) return;
    const fits = () => pl.offsetHeight <= avail + 0.5 && tx.scrollWidth <= tx.clientWidth + 1;
    const search = (lo, hi) => {
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; set(mid); if (fits()) lo = mid; else hi = mid; }
      set(lo);
    };
    if (mode === 'shrink') { if (!fits()) search(min, base); }
    else if (mode === 'grow') { if (fits()) { set(max); if (!fits()) search(base, max); } }
    else { set(max); if (!fits()) search(min, max); }
  }

  // Маска подложки «вырезанного текста»: подложка целиком, слова — прозрачные (тем же шрифтом, по местам слов на экране)
  function cutMask(el) {
    const plate = el._plate;
    const W = plate && plate.offsetWidth;
    const H = plate && plate.offsetHeight;
    if (!W || !H) return;
    const rot = el.style.transform;
    if (rot) el.style.transform = 'none'; // мерить без поворота
    const pr = plate.getBoundingClientRect();
    const sc = pr.width / W || 1;
    const k = Math.min(3, Math.max(0.25, sc * (window.devicePixelRatio || 1)));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(W * k);
    cv.height = Math.ceil(H * k);
    const ctx = cv.getContext('2d');
    ctx.scale(k, k);
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    const cs = getComputedStyle(el._tx);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ('letterSpacing' in ctx && cs.letterSpacing !== 'normal') ctx.letterSpacing = cs.letterSpacing;
    for (const w of el._tx.querySelectorAll('.w')) {
      const r = w.getBoundingClientRect();
      const t0 = w.textContent;
      const text = cs.textTransform === 'uppercase' ? t0.toUpperCase() : cs.textTransform === 'lowercase' ? t0.toLowerCase()
        : cs.textTransform === 'capitalize' ? t0.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()) : t0;
      const m = ctx.measureText(text);
      const top = (r.top - pr.top) / sc;
      const h = r.height / sc;
      ctx.fillText(text, (r.left - pr.left) / sc, top + (h - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent);
    }
    if (rot) el.style.transform = rot;
    const url = `url(${cv.toDataURL()})`;
    plate.style.webkitMaskImage = url;
    plate.style.maskImage = url;
    plate.style.webkitMaskSize = '100% 100%';
    plate.style.maskSize = '100% 100%';
  }

  // Бегущая строка: скорость — % высоты экрана в секунду
  function startScroll(el) {
    const up = el.dataset.scroll === 'up';
    const H = (el.closest('.layer') || el).clientHeight || 1080;
    const px = (Math.max(0.5, num(el.dataset.speed, 10)) * H) / 100;
    const from = up ? el.clientHeight : el.clientWidth;
    const to = up ? -el._pl.offsetHeight : -el._pl.offsetWidth;
    if (!(from - to > 0)) return;
    const at = (v) => (up ? `0 ${v}px` : `${v}px 0`);
    el._scroll = el._pl.animate([{ translate: at(from) }, { translate: at(to) }], { duration: ((from - to) / px) * 1000, iterations: Infinity });
  }

  function fitThemed(layer) {
    layer.querySelectorAll(':scope > .ob.t2').forEach(fitObj);
    if (layer.classList.contains('custom')) fitCustom(layer);
  }

  /* ----- Анимации объектов (Build In / Build Out) ----- */
  const IN_FROM = { up: '0 6cqh', down: '0 -6cqh', left: '6cqw 0', right: '-6cqw 0' };
  const OUT_TO = { up: '0 -6cqh', down: '0 6cqh', left: '-6cqw 0', right: '6cqw 0' };
  function frames(a, out) {
    let f;
    if (a.type === 'move') f = [{ opacity: 0, translate: (out ? OUT_TO : IN_FROM)[a.dir] || '0 6cqh' }, { opacity: 1, translate: '0 0' }];
    else if (a.type === 'scale') f = [{ opacity: 0, scale: '0.6' }, { opacity: 1, scale: '1' }];
    else if (a.type === 'blur') f = [{ opacity: 0, filter: 'blur(1.2cqh)' }, { opacity: 1, filter: 'blur(0)' }];
    else f = [{ opacity: 0 }, { opacity: 1 }];
    return out ? f.reverse() : f;
  }
  function playIn(el, a) {
    el.style.visibility = '';
    const ms = Math.max(0, num(a.ms, 600));
    const delay = Math.max(0, num(a.delay, 0));
    const opt = (d) => ({ duration: ms, delay: d, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
    const units = el._tx && a.by && a.by !== 'all' ? [...el._tx.querySelectorAll('.u')] : null;
    if (!units || !units.length) { el.animate(frames(a), opt(delay)); return; }
    let groups = units.map((u) => [u]);
    if (a.by === 'lines') {
      const rows = new Map();
      for (const u of units) { const k = Math.round(u.offsetTop); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(u); }
      groups = [...rows.values()];
    }
    const step = Math.min({ chars: 35, words: 90, lines: 240 }[a.by] || 90, (ms * 1.5) / groups.length);
    groups.forEach((g, i) => g.forEach((u) => u.animate(frames(a), opt(delay + i * step))));
  }
  const outTime = (layer, onlyDyn) => [...layer.querySelectorAll(':scope > .ob')].reduce((t, el) => (el._out && (!onlyDyn || el.classList.contains('dyn'))
    ? Math.max(t, Math.max(0, num(el._out.ms, 400)) + Math.max(0, num(el._out.delay, 0))) : t), 0);
  function playOut(layer, onlyDyn) {
    layer.querySelectorAll(':scope > .ob').forEach((el) => {
      if (el._out && (!onlyDyn || el.classList.contains('dyn'))) el.animate(frames(el._out, true), { duration: Math.max(0, num(el._out.ms, 400)), delay: Math.max(0, num(el._out.delay, 0)), easing: 'ease-in', fill: 'forwards' });
    });
  }
  // Новый слой появился: анимации появления; «по команде» — ждут buildNext. same — тот же шаблон: фон и фигуры уже на экране
  function startBuilds(layer, same) {
    layer.querySelectorAll(':scope > .ob').forEach((el) => {
      if (!el._in || (same && !el.classList.contains('dyn'))) return;
      if (el._in.trigger === 'cmd') { el.dataset.wait = String(num(el._in.order, 1)); el.style.visibility = 'hidden'; return; }
      playIn(el, el._in);
    });
  }
  // Следующий шаг «по команде»: показать объекты с наименьшим номером порядка. false — ждущих нет
  function buildNext(stage) {
    const waits = [...stage.querySelectorAll('.layer:not(.leaving):not(.gone) > .ob[data-wait]')];
    if (!waits.length) return false;
    const min = Math.min(...waits.map((e) => Number(e.dataset.wait) || 0));
    waits.filter((e) => (Number(e.dataset.wait) || 0) === min).forEach((e) => { delete e.dataset.wait; playIn(e, e._in); });
    return true;
  }

  const fitLayer = (layer) => {
    if (layer.classList.contains('themed')) fitThemed(layer);
    else if (layer.classList.contains('text')) fitText(layer);
    else if (layer.classList.contains('custom')) fitCustom(layer);
  };

  // Любой текстовый слайд (экран, предпросмотр, миниатюры) сам подгоняет текст, когда меняется его размер
  const sizer = new ResizeObserver((entries) => {
    for (const e of entries) {
      const layer = e.target;
      if (!layer.isConnected) { sizer.unobserve(layer); continue; }
      const h = Math.round(e.contentRect.height);
      if (!h || h === layer._fitH) continue;
      layer._fitH = h;
      fitLayer(layer);
    }
  });

  function build(content) {
    if (content.type === 'live') return buildLive(content);
    if (content.type !== 'text' && content.type !== 'custom') return buildMedia(content);
    const t = pickTpl(content);
    const layer = t ? buildThemed(content, t) : content.type === 'text' ? buildText(content) : buildCustom(content);
    sizer.observe(layer);
    return layer;
  }

  function dispose(layer) {
    sizer.unobserve(layer);
    if (layer.classList.contains('live')) {
      layer.querySelectorAll('video').forEach((v) => { v.srcObject = null; });
      liveRelease(layer);
    } else layer.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
    layer.remove();
  }

  const layers = (box) => [...box.children].filter((n) => n.classList.contains('layer'));

  /* ----- Слои вывода (Media Layers): у сцены стопка «слотов» снизу вверх — источники, медиа, презентации…
     Каждый слот живёт сам по себе: показ, очистка, видимость, прозрачность, громкость не трогают соседей.
     defs: [{ id, hidden, opacity, volume }] в порядке снизу вверх; набор и порядок задаёт программа (не жёстко три). */
  function slotOf(stage, id) {
    let s = stage.querySelector(`:scope > .slot[data-layer="${id}"]`);
    if (!s) {
      s = make('div', 'slot');
      s.dataset.layer = id;
      stage.insertBefore(s, stage.querySelector(':scope > svg.ink'));
      if (stage._view) viewOn(stage, s, 0);
      if (stage._layerDefs) setLayers(stage, stage._layerDefs);
    }
    return s;
  }

  function setLayers(stage, defs) {
    stage._layerDefs = defs;
    const ink = stage.querySelector(':scope > svg.ink');
    for (const d of defs) {
      let s = stage.querySelector(`:scope > .slot[data-layer="${d.id}"]`);
      if (!s) { s = make('div', 'slot'); s.dataset.layer = d.id; if (stage._view) viewOn(stage, s, 0); }
      stage.insertBefore(s, ink); // по порядку defs: каждый следующий — выше
      s.style.visibility = d.hidden ? 'hidden' : '';
      s.style.opacity = d.opacity != null && d.opacity < 1 ? String(Math.max(0, d.opacity)) : '';
    }
    applyVolume(stage);
  }

  // Громкость: видео слоя = громкость слоя × громкость проигрывателя (stage._baseVol); у живых источников — только слоя
  function applyVolume(stage) {
    const base = stage._baseVol != null ? stage._baseVol : 1;
    stage.querySelectorAll(':scope > .slot').forEach((s) => {
      const d = (stage._layerDefs || []).find((x) => x.id === s.dataset.layer);
      const lv = d && d.volume != null ? Math.max(0, Math.min(1, d.volume)) : 1;
      s.querySelectorAll('video').forEach((v) => {
        if (!v._leaving) v.volume = Math.max(0, Math.min(1, v.closest('.layer.live') ? lv : lv * base));
        // Устройство звука для видео (stage._sink: '' — как в Windows); задаёт окно вывода (compose.js → progVideo 'sink')
        if (stage._sink != null && v._sink !== stage._sink && typeof v.setSinkId === 'function') {
          v._sink = stage._sink;
          v.setSinkId(stage._sink).catch(() => {});
        }
      });
    });
  }

  // Уходящий слой: звук его видео плавно гаснет за ms (новое видео или очистка) — два звука не накладываются
  function fadeOutSound(layer, ms) {
    layer.querySelectorAll('video').forEach((v) => {
      if (v._leaving || v.muted) return;
      v._leaving = true;
      const from = v.volume;
      const t0 = performance.now();
      const dur = Math.max(0, Math.min(ms || 0, 1500));
      // Таймер, а не requestAnimationFrame: тот замирает, когда окно скрыто
      const step = () => {
        const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1;
        v.volume = from * (1 - k);
        if (k >= 1 || !v.isConnected) { clearInterval(t); v.muted = true; }
      };
      const t = setInterval(step, 30);
      step();
    });
  }

  // Пуск и пауза всего, что играет в слое (видео, фон-видео, живой источник — замирает кадр)
  function layerPlay(stage, id, play) {
    const s = stage.querySelector(`:scope > .slot[data-layer="${id}"]`);
    if (!s) return;
    s.querySelectorAll('video').forEach((v) => { if (play) v.play().catch(() => {}); else v.pause(); });
  }

  // layerId — в какой слой; без него — как раньше, одна картинка на всю сцену (редактор, окошки источников)
  function show(stage, content, tr, layerId) {
    tr = tr || { type: 'none', ms: 0 };
    const box = layerId ? slotOf(stage, layerId) : stage;
    const layer = build(content);
    // В слое чёрный фон темы — прозрачный: под текстом видны медиа и источники (пустой экран и так чёрный)
    if (layerId && layer.style.backgroundColor === 'rgb(0, 0, 0)') layer.style.background = 'transparent';
    const old = layers(box);
    const ink = box.querySelector(':scope > svg.ink');
    box.insertBefore(layer, ink); // рисунок всегда сверху
    if (!layerId && stage._view) viewOn(stage, layer, 0);
    // Тот же шаблон темы, что был (следующий куплет): фон, фигуры и видео шаблона остаются, меняется только текст
    const prev = old.filter((n) => !n.classList.contains('gone')).pop();
    const same = !!(prev && layer._tpl && prev._tpl === layer._tpl && !prev.classList.contains('leaving'));
    if (same) {
      layer.querySelectorAll('video').forEach((nv) => {
        const box = nv.closest('.ob');
        const sel = box ? `:scope > .ob[data-oid="${box.dataset.oid}"] > video` : ':scope > .tbg > video';
        const ov = prev.querySelector(sel);
        if (ov && ov.src === nv.src) { ov.className = nv.className; ov.style.cssText = nv.style.cssText; nv.replaceWith(ov); }
      });
    }
    fitLayer(layer);
    if (layerId) applyVolume(stage);
    if (!content.edit) startBuilds(layer, same);
    const done = () => old.forEach(dispose);
    const ms = tr.type === 'none' ? 0 : Math.max(0, Number(tr.ms) || 0);
    old.forEach((n) => fadeOutSound(n, ms)); // видео того же шаблона уже перенесено в новый слой и не гаснет
    // content.edit — редактор тем: без анимаций исчезновения при каждой правке
    if (!content.edit) old.forEach((n) => { if (!n.classList.contains('leaving') && !n.classList.contains('gone')) playOut(n, same); });
    const outMs = content.edit ? 0 : old.reduce((t, n) => Math.max(t, outTime(n, same)), 0);
    if (same) {
      old.forEach((n) => n.classList.add('leaving'));
      if (ms) {
        layer.querySelectorAll(':scope > .ob.dyn').forEach((el) => { if (el._tx && !el._in) el._tx.animate(FRAMES.fade, { duration: ms, easing: 'ease-out' }); });
        old.forEach((n) => n.querySelectorAll(':scope > .ob.dyn').forEach((el) => { if (el._tx && !el._out) el._tx.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }); }));
      }
      if (!ms && !outMs) return done();
      setTimeout(done, Math.max(ms, outMs));
      return;
    }
    if (!ms && !outMs) return done();
    if (!ms) { setTimeout(done, outMs); return; }
    animOut(old.filter((n) => !n.classList.contains('gone')), tr, ms);
    const anim = animIn(layer, tr, ms);
    if (outMs > ms) { setTimeout(done, outMs); return; }
    anim.onfinish = done;
    anim.oncancel = done;
  }

  // layerId — очистить только этот слой; без него — всё
  function clear(stage, tr, layerId) {
    const ms = !tr || tr.type === 'none' ? 0 : Math.max(0, Number(tr.ms) || 0);
    const boxes = layerId ? [stage.querySelector(`:scope > .slot[data-layer="${layerId}"]`)].filter(Boolean)
      : [stage, ...stage.querySelectorAll(':scope > .slot')];
    boxes.flatMap(layers).forEach((n) => {
      // Объекты шаблона с анимацией исчезновения — сначала она, потом слой уходит
      const out = n.classList.contains('leaving') || n.classList.contains('gone') ? 0 : outTime(n);
      n.classList.add('gone');
      fadeOutSound(n, out || ms);
      if (out) { playOut(n); setTimeout(() => dispose(n), out); return; }
      if (!ms) return dispose(n);
      const a = n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' });
      a.onfinish = () => dispose(n);
    });
  }

  function refit(stage) {
    stage.querySelectorAll('.layer.text, .layer.custom, .layer.themed').forEach(fitLayer);
    if (stage._ink) setInk(stage, stage._ink);
  }

  /* ----- Свои шрифты (файлы в userData\fonts, main.js): @font-face в каждом окне ----- */
  const fontCss = document.createElement('style');
  document.head.append(fontCss);
  let userFonts = [];
  function useFonts(list) {
    userFonts = Array.isArray(list) ? list : [];
    fontCss.textContent = userFonts.map((f) => `@font-face { font-family: "${String(f.family).replace(/["\\]/g, '')}"; src: url("${f.url}"); font-weight: ${Number(f.weight) || 400}; font-style: ${f.italic ? 'italic' : 'normal'}; font-display: block; }`).join('\n');
  }
  // Шрифт догрузился — текст подогнать заново
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => document.querySelectorAll('.layer.text, .layer.custom, .layer.themed').forEach(fitLayer));
  if (typeof window !== 'undefined' && window.api && window.api.fontsUser) {
    window.api.fontsUser().then(useFonts).catch(() => {});
    if (window.api.onFonts) window.api.onFonts(useFonts);
  }
  const fontsList = () => userFonts;

  /* ----- Рисунок поверх слайда -----
     Фигура: { t: 'pen'|'mk'|'hl'|'line'|'arrow'|'rect'|'ellipse', c: цвет, w: толщина (доля высоты), p: [[x, y], …] (доли 0…1) }
     'mk' — маркер: широкая полупрозрачная полоса поверх текста (w — сразу ширина полосы); 'hl' — старый маркер;
     'mt' — маркер по тексту: { t: 'mt', c, l: [[x0, x1, y, h], …] } — полоса на каждую строку (доли экрана) */

  const SVGNS = 'http://www.w3.org/2000/svg';

  function shapeNode(s, W, H) {
    if (s.t === 'mt') {
      if (!Array.isArray(s.l) || !s.l.length) return null;
      const g = document.createElementNS(SVGNS, 'g');
      for (const [x0, x1, y, h] of s.l) {
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', `M${(x0 * W).toFixed(1)} ${(y * H).toFixed(1)}L${(x1 * W).toFixed(1)} ${(y * H).toFixed(1)}`);
        p.setAttribute('stroke-width', Math.max(1, h * H).toFixed(1));
        g.append(p);
      }
      g.setAttribute('fill', 'none');
      g.setAttribute('stroke', s.c || '#ffe600');
      g.setAttribute('stroke-opacity', '0.42');
      g.setAttribute('stroke-linecap', 'butt');
      g.dataset.t = 'mt';
      return g;
    }
    const pts = (s.p || []).map(([x, y]) => [x * W, y * H]);
    if (!pts.length) return null;
    const sw = Math.max(1, (s.w || 0.006) * H);
    let n;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (s.t === 'pen' || s.t === 'hl' || s.t === 'mk') {
      n = document.createElementNS(SVGNS, 'path');
      n.setAttribute('d', pts.length === 1 ? `M${a[0]} ${a[1]}l0.01 0` : 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'));
    } else if (s.t === 'line' || s.t === 'arrow') {
      n = document.createElementNS(SVGNS, 'g');
      const line = document.createElementNS(SVGNS, 'path');
      let d = `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
      if (s.t === 'arrow') {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const len = sw * 4;
        const p1 = [b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45)];
        const p2 = [b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45)];
        d += `M${p1[0]} ${p1[1]}L${b[0]} ${b[1]}L${p2[0]} ${p2[1]}`;
      }
      line.setAttribute('d', d);
      n.append(line);
    } else if (s.t === 'rect') {
      n = document.createElementNS(SVGNS, 'rect');
      n.setAttribute('x', Math.min(a[0], b[0])); n.setAttribute('y', Math.min(a[1], b[1]));
      n.setAttribute('width', Math.abs(b[0] - a[0])); n.setAttribute('height', Math.abs(b[1] - a[1]));
      n.setAttribute('rx', sw);
    } else if (s.t === 'ellipse') {
      n = document.createElementNS(SVGNS, 'ellipse');
      n.setAttribute('cx', (a[0] + b[0]) / 2); n.setAttribute('cy', (a[1] + b[1]) / 2);
      n.setAttribute('rx', Math.abs(b[0] - a[0]) / 2); n.setAttribute('ry', Math.abs(b[1] - a[1]) / 2);
    } else return null;
    n.setAttribute('fill', 'none');
    n.setAttribute('stroke', s.c || '#ff3b30');
    n.setAttribute('stroke-width', s.t === 'hl' ? sw * 3 : sw);
    n.setAttribute('stroke-linecap', s.t === 'hl' || s.t === 'mk' ? 'butt' : 'round');
    n.setAttribute('stroke-linejoin', 'round');
    if (s.t === 'hl') n.setAttribute('stroke-opacity', '0.4');
    if (s.t === 'mk') n.setAttribute('stroke-opacity', '0.42');
    n.dataset.t = s.t;
    return n;
  }

  // Прорисовка по очереди, как рукой: линия «тянется» от начала к концу (stroke-dashoffset).
  // Скорость — около высоты экрана за 0,8 с; маркер ведётся ровнее и чуть медленнее
  function animateInk(nodes, H) {
    let delay = 120;
    for (const n of nodes) {
      const marker = n.dataset.t === 'mk' || n.dataset.t === 'hl' || n.dataset.t === 'mt';
      for (const p of n.tagName === 'g' ? [...n.children] : [n]) {
        let len = 0;
        try { len = p.getTotalLength(); } catch { len = 0; }
        if (!(len > 1)) continue;
        const ms = Math.round(Math.min(2200, 220 + (len / H) * (marker ? 950 : 800)));
        p.style.strokeDasharray = `${len} ${len}`;
        p.style.strokeDashoffset = String(len);
        const a = p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
          { duration: ms, delay, easing: marker ? 'cubic-bezier(.45,.05,.4,1)' : 'cubic-bezier(.3,.1,.3,1)', fill: 'both' });
        a.finished.then(() => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; a.cancel(); }, () => {});
        delay += ms + 90;
      }
    }
    return delay; // когда закончится вся прорисовка (мс)
  }

  // opts.animFrom — фигуры с этого номера появляются анимацией (после «Готово» в окне рисования).
  // Возвращает длительность прорисовки в мс (0 — без анимации)
  function setInk(stage, shapes, opts) {
    stage._ink = shapes && shapes.length ? shapes : null;
    let svg = stage.querySelector('svg.ink');
    if (!stage._ink) { if (svg) svg.remove(); return 0; }
    const W = stage.clientWidth || 1920;
    const H = stage.clientHeight || 1080;
    if (!svg) {
      svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'ink');
      stage.append(svg);
      if (stage._view) viewOn(stage, svg, 0);
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const nodes = stage._ink.map((s) => shapeNode(s, W, H));
    svg.replaceChildren(...nodes.filter(Boolean));
    if (opts && Number.isInteger(opts.animFrom)) return animateInk(nodes.slice(opts.animFrom).filter(Boolean), H);
    return 0;
  }

  /* ----- Крупный план (камера): { x, y, z } — центр в долях экрана и увеличение (1 — весь слайд).
     Двигаются все слои и рисунок вместе, плавно за ms. Рисунок хранится в координатах слайда — увеличивается со слайдом. */
  function viewCss(v) {
    if (!v || !(v.z > 1.001)) return '';
    return `translate(${((0.5 - v.x * v.z) * 100).toFixed(3)}%, ${((0.5 - v.y * v.z) * 100).toFixed(3)}%) scale(${v.z.toFixed(4)})`;
  }
  function viewOn(stage, el, ms) {
    el.style.transformOrigin = '0 0';
    el.style.transition = ms > 0 ? `transform ${ms}ms cubic-bezier(.45,0,.25,1)` : 'none';
    el.style.transform = viewCss(stage._view);
  }
  function setView(stage, v, ms) {
    stage._view = v && v.z > 1.001 ? { x: +v.x || 0.5, y: +v.y || 0.5, z: +v.z } : null;
    for (const el of stage.querySelectorAll(':scope > .slot, :scope > .layer, :scope > svg.ink')) viewOn(stage, el, Math.max(0, Number(ms) || 0));
  }

  return { TRANS, animIn, animOut, setTimers, setView, viewCss, show, clear, refit, build, fitText, setInk, shapeNode, liveStream, liveRelease, setLayers, applyVolume, layerPlay, pickTpl, textLabels, buildNext, useFonts, fontsList, family, LIVE, FONTS, FONT_NAMES };
})();
