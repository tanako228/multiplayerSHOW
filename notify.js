/* Уведомления-«островки» (как Dynamic Island): одна система для всех сообщений программы.
   Островки выпадают сверху по центру окна, друг под другом (новый — сверху), не больше MAX сразу.
   Каждый исчезает через 10 с; наведение мыши останавливает отсчёт, уход мыши — новые 10 с; «×» — закрыть.
   Контейнер — popover (верхний слой браузера), поэтому островок виден и поверх открытых окон <dialog>.

   Notify.show({ kind, title, text, actions, id, group, sticky, percent }) → { id, update(o), close() }
     kind:    'info' | 'ok' | 'warn' | 'error' | 'progress' (progress — крутилка, не исчезает сам)
     actions: [{ label, run, primary }] — кнопки (после нажатия островок закрывается, если run не вернул false)
     id:      свой ключ: повторный show с тем же id меняет островок на месте
     group:   'status' — короткие сообщения flashStatus: новое в течение MERGE мс заменяет предыдущее
     percent: полоска прогресса (0–100)
   Тот же текст ещё раз — островок не повторяется, а показывает счётчик ×2, ×3…
   Старые showNotice/flashStatus теперь идут сюда (renderer.js, playlist.js). */
const Notify = (() => {
  const LIFE = 10000;
  const MAX = 4;
  const MERGE = 2500;
  const items = new Map();
  let host = null;
  let seq = 0;

  const ICONS = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9.5"/>',
    warn: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.3v.01"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    update: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v8M8.5 12.5 12 16l3.5-3.5"/>',
    progress: '<circle class="isle-spin" cx="12" cy="12" r="8"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ICONS.info}</svg>`;

  function ensureHost() {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.id = 'isles';
    host.setAttribute('aria-live', 'polite');
    if ('popover' in host) host.popover = 'manual';
    document.body.appendChild(host);
    return host;
  }
  // Поднять над открытыми окнами: элемент верхнего слоя, показанный последним, — сверху
  function raise() {
    const h = ensureHost();
    // Под верхней строкой разделов — не закрывать вкладки и кнопки
    const bar = document.querySelector('body > .tabs');
    const r = bar && bar.offsetParent !== null ? bar.getBoundingClientRect() : null;
    h.style.setProperty('--isle-top', (r && r.bottom > 0 && r.bottom < 120 ? Math.round(r.bottom + 6) : 8) + 'px');
    if (!h.showPopover) return;
    try { if (h.matches(':popover-open')) h.hidePopover(); h.showPopover(); } catch { /* старый движок */ }
  }

  // По горизонтали — всегда ровно по центру окна программы (left: 50% + translateX(-50%) в index.html):
  // окно 2000 px — середина на 1000, окно сжато до 1000 px — на 500; при изменении размера окна следует само

  // Угадать вид по тексту (для старых вызовов flashStatus без вида)
  function guessKind(text) {
    const t = String(text || '').trim();
    if (/^(Не удалось|Не получилось|Ошибка|Не найден|Не вышло|Не скачал|Нельзя)/i.test(t)) return 'error';
    if (/^(Сначала|Нет |В файле нет|Выделите презентацию)/i.test(t)) return 'warn';
    if (/^(Сохранено|Сохранён|Готово|Скопирован|Создан|Добавлен|Импортирован|Удален|Удалён|Вставлен|Подключ|Установлен)/i.test(t)) return 'ok';
    return 'info';
  }

  function build(it) {
    const slot = document.createElement('div');
    slot.className = 'isle-slot';
    slot.innerHTML = '<div class="isle ui-pop"><span class="isle-ico"></span>'
      + '<div class="isle-body"><b class="isle-title"></b><div class="isle-text"></div><div class="isle-acts"></div></div>'
      + '<span class="isle-n" hidden></span><button type="button" class="isle-x" title="Закрыть" aria-label="Закрыть">×</button>'
      + '<i class="isle-bar"></i></div>';
    const card = slot.firstChild;
    it.slot = slot;
    it.card = card;
    card.addEventListener('mouseenter', () => { it.hover = true; stopTimer(it); card.classList.add('hold'); });
    card.addEventListener('mouseleave', () => { it.hover = false; card.classList.remove('hold'); startTimer(it); });
    card.querySelector('.isle-x').addEventListener('click', (e) => { e.stopPropagation(); close(it.id); });
    return slot;
  }

  function paint(it) {
    const o = it.o;
    const kind = o.kind || 'info';
    const card = it.card;
    card.className = 'isle ui-pop k-' + kind + (it.hover ? ' hold' : '') + (o.title ? '' : ' one');
    card.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    card.querySelector('.isle-ico').innerHTML = svg(o.icon || kind);
    const ti = card.querySelector('.isle-title');
    ti.textContent = o.title || '';
    ti.hidden = !o.title;
    const tx = card.querySelector('.isle-text');
    tx.textContent = o.text || '';
    tx.hidden = !o.text;
    const acts = card.querySelector('.isle-acts');
    acts.textContent = '';
    (o.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        let keep = false;
        try { keep = (await a.run()) === false; } catch (err) { console.error(err); }
        if (!keep) close(it.id);
      });
      acts.appendChild(b);
    });
    acts.hidden = !acts.children.length;
    const n = card.querySelector('.isle-n');
    n.hidden = it.count < 2;
    n.textContent = it.count;
    const bar = card.querySelector('.isle-bar');
    const pct = o.percent;
    bar.classList.toggle('pct', pct != null);
    if (pct != null) bar.style.setProperty('--p', Math.max(0, Math.min(100, pct)) / 100);
  }

  function sticky(it) { return it.o.sticky || it.o.kind === 'progress' || it.o.percent != null; }
  function stopTimer(it) { clearTimeout(it.timer); it.timer = 0; }
  function startTimer(it) {
    stopTimer(it);
    if (sticky(it) || it.hover) { it.card.classList.remove('run'); return; }
    // полоска отсчёта — заново с полной длины
    it.card.classList.remove('run');
    void it.card.offsetWidth;
    it.card.style.setProperty('--life', LIFE + 'ms');
    it.card.classList.add('run');
    it.timer = setTimeout(() => close(it.id), LIFE);
  }
  // Сменился текст на месте — короткое «перетекание»
  function morph(it) {
    it.card.classList.remove('morph');
    void it.card.offsetWidth;
    it.card.classList.add('morph');
  }

  function show(o) {
    if (typeof o === 'string') o = { text: o };
    o = { ...o };
    if (!o.text && !o.title) return null;
    if (!o.kind) o.kind = guessKind(o.text || o.title);
    const h = ensureHost();
    const now = Date.now();
    // 1) тот же ключ — обновить; 2) тот же текст — счётчик; 3) группа status — заменить свежий
    let it = o.id != null ? items.get(o.id) : null;
    if (!it) {
      for (const x of items.values()) {
        if (x.closing) continue;
        if (x.o.text === o.text && x.o.title === o.title && x.o.kind === o.kind && !(o.actions && o.actions.length)) { it = x; it.count++; break; }
      }
    }
    if (!it && o.group) {
      for (const x of items.values()) {
        if (!x.closing && x.o.group === o.group && !x.hover && (now - x.at < MERGE || /…$/.test(String(x.o.text || '').trim()))) { it = x; it.count = 1; break; }
      }
    }
    if (it && !it.closing) {
      const changed = it.o.text !== o.text || it.o.title !== o.title;
      const wasKind = it.o.kind;
      it.o = { ...o, id: it.id };
      it.at = now;
      paint(it);
      const busy = it.o.kind === 'progress' && wasKind === 'progress'; // идёт прогресс — без «перетекания» на каждый процент
      if (!busy && (changed || it.count > 1)) morph(it);
      startTimer(it);
      if (!busy) raise();
      return api(it);
    }
    const id = o.id != null ? o.id : 'n' + (++seq);
    it = { id, o: { ...o, id }, at: now, count: 1, hover: false, timer: 0 };
    items.set(id, it);
    const slot = build(it);
    paint(it);
    h.prepend(slot); // перевод надписей — наблюдатель i18n.js сам
    requestAnimationFrame(() => requestAnimationFrame(() => slot.classList.add('in')));
    startTimer(it);
    trim();
    raise();
    return api(it);
  }

  function api(it) {
    return { id: it.id, update: (o) => show({ ...it.o, ...o, id: it.id }), close: () => close(it.id) };
  }

  // Больше MAX — убрать самые старые (кроме прогресса и того, что под мышью)
  function trim() {
    const live = [...items.values()].filter((x) => !x.closing);
    let extra = live.length - MAX;
    for (const x of live.sort((a, b) => a.at - b.at)) {
      if (extra <= 0) break;
      if (x.hover || x.o.kind === 'progress') continue;
      close(x.id);
      extra--;
    }
  }

  function close(id) {
    const it = items.get(id);
    if (!it || it.closing) return;
    it.closing = true;
    stopTimer(it);
    if (it.o.onClose) { try { it.o.onClose(); } catch { /* не страшно */ } }
    it.slot.classList.remove('in');
    it.slot.classList.add('out');
    const done = () => {
      it.slot.remove();
      if (items.get(id) === it) items.delete(id); // под тем же id мог уже появиться новый островок
      if (!items.size && host && host.hidePopover) { try { host.hidePopover(); } catch { /* уже скрыт */ } }
    };
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) done(); else setTimeout(done, 380);
  }

  // Закрыть всё, что подходит под условие (например, все островки одного источника)
  function clear(fn) { [...items.values()].forEach((x) => { if (!fn || fn(x.o)) close(x.id); }); }
  const has = (id) => items.has(id) && !items.get(id).closing;

  return { show, close, clear, has, guessKind, LIFE };
})();
window.Notify = Notify;
