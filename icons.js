/* Иконки Multi Play — общий стандарт для всей программы.
   Каждая иконка — цветная плитка (как обложки в библиотеке PlayStation): скруглённый квадрат 24×24,
   градиент сверху вниз «светлый → насыщенный», мягкий блик сверху и простой белый знак по центру.
   Новые разделы и кнопки получают иконку так же: <button data-icon="имя">Текст</button>.
   Своя иконка — строка в SET: [светлый цвет, тёмный цвет, знак]. В знаке {d} — тёмный цвет плитки. */
// Любой ползунок во всей программе: двойной щелчок — значение по умолчанию (как в Photoshop, Premiere).
// Умолчание — data-def, иначе атрибут value из HTML; data-nodef — не сбрасывать (перемотка). Своё событие input/change —
// значит, сброс проходит тем же путём, что и движение ползунка (сохранение, Ctrl+Z, подписи).
document.addEventListener('dblclick', (e) => {
  const r = e.target;
  if (!r || r.tagName !== 'INPUT' || r.type !== 'range' || r.disabled || r.dataset.nodef != null) return;
  const d = r.dataset.def != null && r.dataset.def !== '' ? r.dataset.def : r.getAttribute('value');
  if (d == null || d === '' || r.value === String(Number(d))) return;
  e.preventDefault();
  r.value = d;
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
}, true);
// Подсказка «двойной щелчок — по умолчанию» у ползунков, где умолчание известно
document.addEventListener('pointerover', (e) => {
  const r = e.target;
  if (!r || r.tagName !== 'INPUT' || r.type !== 'range' || r.title || r.dataset.nodef != null) return;
  if ((r.dataset.def != null && r.dataset.def !== '') || r.hasAttribute('value')) r.title = 'Двойной щелчок — по умолчанию';
}, true);

const Icons = (() => {
  const W = '#fff';
  const line = (d, w = 1.8) => `<path d="${d}" stroke="${W}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const SET = {
    // Разделы
    screen: ['#5b95ff', '#1d4fd8', `<rect x="5" y="6.3" width="14" height="9.6" rx="1.7" fill="none" stroke="${W}" stroke-width="1.8"/><rect x="7.3" y="8.6" width="9.4" height="5" rx=".6" fill="${W}" opacity=".35"/>` + line('M9.4 19h5.2M12 16v3')],
    bible: ['#e8b45a', '#9a5b17', `<path d="M6.3 6.4A1.6 1.6 0 0 1 7.9 4.8h9.8v12.6H7.9a1.6 1.6 0 0 0-1.6 1.6z" fill="${W}"/><path d="M6.3 19a1.6 1.6 0 0 1 1.6-1.6h9.8V19.2H7.9" fill="${W}" opacity=".6"/><path d="M12 7.2v7.2M9.4 9.7h5.2" stroke="{d}" stroke-width="1.7" stroke-linecap="round"/>`],
    music: ['#ff6aa8', '#c0266d', line('M10 16.6V7.1l8-1.9v9.4') + `<circle cx="7.9" cy="16.6" r="2.3" fill="${W}"/><circle cx="15.9" cy="14.6" r="2.3" fill="${W}"/>`],
    video: ['#a985ff', '#6431d6', `<rect x="4.4" y="7" width="11.2" height="10" rx="2.2" fill="${W}"/><path d="M16.6 10.6l3.4-2.1v7l-3.4-2.1z" fill="${W}"/><path d="M8.8 9.8v4.4l3.6-2.2z" fill="{d}"/>`],
    pool: ['#33d6c3', '#0a857a', `<rect x="7.6" y="4.8" width="11.6" height="9" rx="1.6" fill="${W}" opacity=".5"/><rect x="4.8" y="7.8" width="11.6" height="10.4" rx="1.6" fill="${W}"/><circle cx="8.5" cy="11.3" r="1.3" fill="{d}"/><path d="M6.4 16.7l3.1-3.2 2.2 2.2 1.6-1.6 2 2.6z" fill="{d}"/>`],
    editor: ['#ffa04a', '#d4570c', `<path d="M5.8 18.2l.9-3.8 8.8-8.8a1.7 1.7 0 0 1 2.4 0l.5.5a1.7 1.7 0 0 1 0 2.4l-8.8 8.8z" fill="${W}"/><path d="M14 7.1l2.9 2.9" stroke="{d}" stroke-width="1.4"/>`],
    settings: ['#93a3bb', '#46566f', `<circle cx="12" cy="12" r="6.4" fill="none" stroke="${W}" stroke-width="2.8" stroke-dasharray="2.55 2.48"/><circle cx="12" cy="12" r="4.9" fill="${W}"/><circle cx="12" cy="12" r="1.9" fill="{d}"/>`],
    web: ['#3fc8ff', '#1470dc', `<circle cx="12" cy="12" r="6.8" fill="none" stroke="${W}" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="2.9" ry="6.8" fill="none" stroke="${W}" stroke-width="1.5"/>` + line('M5.4 12h13.2M6.4 8.6h11.2M6.4 15.4h11.2', 1.3)],
    // Действия
    add: ['#4fe08a', '#14994d', line('M12 6.6v10.8M6.6 12h10.8', 2.6)],
    library: ['#f5be52', '#b56f15', `<rect x="5.3" y="6" width="3.3" height="12" rx=".8" fill="${W}"/><rect x="9.5" y="4.9" width="3.3" height="13.1" rx=".8" fill="${W}" opacity=".8"/><rect x="13.6" y="6.4" width="3.3" height="11.6" rx=".8" fill="${W}" transform="rotate(-14 15.3 12.2)"/>` + line('M5 19.2h14', 1.5)],
    bookmark: ['#ff7070', '#c92a3a', `<path d="M7.6 4.9h8.8v14.2l-4.4-3.2-4.4 3.2z" fill="${W}"/>`],
    star: ['#ffd84a', '#e59400', `<path d="M12 5l2.1 4.4 4.8.6-3.5 3.3.9 4.8L12 15.8l-4.3 2.3.9-4.8-3.5-3.3 4.8-.6z" fill="${W}"/>`],
    theme: ['#cb8cff', '#7b35e6', `<path d="M12 5a7 7 0 0 0 0 14c1.2 0 1.7-.8 1.3-1.8-.4-1 .2-2 1.3-2H16a3 3 0 0 0 3-3C19 8.1 15.9 5 12 5z" fill="${W}"/><circle cx="8.6" cy="11.4" r="1.2" fill="#ef4444"/><circle cx="10.6" cy="8.3" r="1.2" fill="#f59e0b"/><circle cx="14" cy="8.2" r="1.2" fill="#22c55e"/><circle cx="16" cy="11" r="1.2" fill="#3b82f6"/>`],
    draw: ['#ffc23d', '#e07f00', `<path d="M13.8 5.6l4.6 4.6-6.7 6.7-4.6-4.6z" fill="${W}"/><path d="M6.5 13.7l3.8 3.8c-.6 1.8-2.4 2.4-4.8 2.4.1-2.6.3-4.9 1-6.2z" fill="${W}" opacity=".85"/>`],
    playlist: ['#ffd04a', '#e09600', line('M5.6 7.6h9M5.6 11.6h9M5.6 15.6h5.4', 1.9) + `<path d="M14.8 13.4l4.6 2.7-4.6 2.7z" fill="${W}"/>`],
    copy: ['#5fc6ff', '#1c80d4', `<rect x="8.6" y="5" width="9.6" height="11" rx="1.6" fill="${W}" opacity=".55"/><rect x="5.6" y="8" width="9.6" height="11" rx="1.6" fill="${W}"/>`],
    list: ['#8291ff', '#4350d6', line('M9.6 7.6h8.2M9.6 12h8.2M9.6 16.4h8.2', 1.8) + `<circle cx="6.4" cy="7.6" r="1.2" fill="${W}"/><circle cx="6.4" cy="12" r="1.2" fill="${W}"/><circle cx="6.4" cy="16.4" r="1.2" fill="${W}"/>`],
    slides: ['#ff8d5e', '#dc4a24', `<rect x="5" y="5.6" width="6.2" height="5.4" rx="1.1" fill="${W}"/><rect x="12.8" y="5.6" width="6.2" height="5.4" rx="1.1" fill="${W}"/><rect x="5" y="13" width="6.2" height="5.4" rx="1.1" fill="${W}"/><rect x="12.8" y="13" width="6.2" height="5.4" rx="1.1" fill="${W}" opacity=".6"/>`],
    image: ['#5cd98d', '#1c9a55', `<rect x="4.8" y="6" width="14.4" height="12" rx="1.8" fill="${W}"/><circle cx="9" cy="10" r="1.5" fill="{d}"/><path d="M6.6 16.4l3.6-3.8 2.5 2.5 1.8-1.9 2.9 3.2z" fill="{d}"/>`],
    search: ['#5bd0ff', '#178ad9', `<circle cx="10.6" cy="10.6" r="4.6" fill="none" stroke="${W}" stroke-width="2.2"/>` + line('M14 14l4.4 4.4', 2.4)],
    // Быстрая анимация: крупный план, перемещение, ключевая точка, весь слайд
    zoom: ['#5bd0ff', '#178ad9', `<circle cx="10.6" cy="10.6" r="4.9" fill="none" stroke="${W}" stroke-width="2.1"/>` + line('M14.2 14.2l4.2 4.2', 2.4) + line('M10.6 8.4v4.4M8.4 10.6h4.4', 1.7)],
    zoomOut: ['#5bd0ff', '#178ad9', `<circle cx="10.6" cy="10.6" r="4.9" fill="none" stroke="${W}" stroke-width="2.1"/>` + line('M14.2 14.2l4.2 4.2', 2.4) + line('M8.4 10.6h4.4', 1.7)],
    pan: ['#7fb2ff', '#2f63d8', line('M12 5.2v13.6M5.2 12h13.6', 1.8) + line('M9.9 7.3L12 5.2l2.1 2.1M9.9 16.7l2.1 2.1 2.1-2.1M7.3 9.9L5.2 12l2.1 2.1M16.7 9.9l2.1 2.1-2.1 2.1', 1.8)],
    keyframe: ['#ffc23d', '#e07f00', `<path d="M12 5.2l6.8 6.8-6.8 6.8-6.8-6.8z" fill="${W}"/><circle cx="12" cy="12" r="1.8" fill="{d}"/>`],
    fit: ['#93a3bb', '#46566f', line('M5.6 9.4V5.6h3.8M14.6 5.6h3.8v3.8M18.4 14.6v3.8h-3.8M9.4 18.4H5.6v-3.8', 1.9)],
    // Рисование поверх слайда
    pen: ['#ff7a6b', '#d4301f', `<path d="M6 18l1-4.2 8.4-8.4a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L10.2 17z" fill="${W}"/>` + line('M5.6 19.4c2.4-.6 4.6-.4 7 .2s4.4.4 5.8-.4', 1.3)],
    marker: ['#ffe14d', '#e0a800', `<rect x="4.4" y="13.2" width="15.2" height="4.6" rx="1" fill="${W}" opacity=".55"/><path d="M9.6 14.6l6.8-9.2 3 2.2-6.8 9.2-3.6.8z" fill="${W}"/><path d="M13.4 9.6l3 2.2" stroke="{d}" stroke-width="1.2"/>`],
    line: ['#7fb2ff', '#2f63d8', line('M6.4 17.6L17.6 6.4', 2.2)],
    arrow: ['#6fd0ff', '#1786cf', line('M6.4 17.6L17.2 6.8M10.4 6.6h7v7', 2.1)],
    oval: ['#c38cff', '#7c3fe0', `<ellipse cx="12" cy="12" rx="7" ry="5" fill="none" stroke="${W}" stroke-width="2"/>`],
    rect: ['#8fa6ff', '#4659d8', `<rect x="5.4" y="7" width="13.2" height="10" rx="1.6" fill="none" stroke="${W}" stroke-width="2"/>`],
    undo: ['#a6b3c6', '#5a6a82', line('M9 7.4L5.8 10.6 9 13.8') + line('M6.2 10.6h7.6a4.2 4.2 0 0 1 0 8.4h-2.4', 1.9)],
    erase: ['#ff8fa3', '#d93a5c', `<path d="M10.6 18.4l-4.4-4.4a1.6 1.6 0 0 1 0-2.3l6.3-6.3a1.6 1.6 0 0 1 2.3 0l3.3 3.3a1.6 1.6 0 0 1 0 2.3l-7 7.4z" fill="${W}"/><path d="M8.6 9.6l5.6 5.6" stroke="{d}" stroke-width="1.4"/>` + line('M10.8 18.6h7.4', 1.6)],
    done: ['#4fe08a', '#14994d', line('M6.6 12.4l3.6 3.6 7.2-7.6', 2.6)],
    close: ['#ff7b7b', '#d42f3a', line('M8 8l8 8M16 8l-8 8', 2.6)],
    layers: ['#7fa8ff', '#3a5fe0', `<path d="M12 5l7.2 3.6L12 12.2 4.8 8.6z" fill="${W}"/><path d="M5.6 11.6L12 14.8l6.4-3.2" stroke="${W}" stroke-width="1.6" fill="none" stroke-linejoin="round" opacity=".8"/><path d="M5.6 14.8L12 18l6.4-3.2" stroke="${W}" stroke-width="1.6" fill="none" stroke-linejoin="round" opacity=".6"/>`],
    up: ['#9fb6dc', '#4c6690', line('M12 18V6.4M7.4 11L12 6.4l4.6 4.6', 2.2)],
    down: ['#9fb6dc', '#4c6690', line('M12 6v11.6M7.4 13L12 17.6l4.6-4.6', 2.2)],
    sources: ['#4fd6ff', '#0f7fd6', `<circle cx="12" cy="13.4" r="2.2" fill="${W}"/>` + line('M8.6 16.8a4.8 4.8 0 0 1 0-6.8M15.4 10a4.8 4.8 0 0 1 0 6.8M6.2 19.2a8.2 8.2 0 0 1 0-11.6M17.8 7.6a8.2 8.2 0 0 1 0 11.6', 1.6)],
    camera: ['#5bd0ff', '#1d7fe0', `<rect x="4.2" y="7.6" width="11" height="8.8" rx="2" fill="${W}"/><path d="M16.2 10.8l3.6-2.2v6.8l-3.6-2.2z" fill="${W}"/><circle cx="9.7" cy="12" r="2.1" fill="{d}"/>`],
    cast: ['#7ee0a8', '#16a35a', `<rect x="7.6" y="4.4" width="8.8" height="15.2" rx="2" fill="none" stroke="${W}" stroke-width="1.7"/><rect x="9.4" y="6.8" width="5.2" height="8.6" rx=".6" fill="${W}" opacity=".4"/>` + line('M11 17.6h2', 1.5)],
    // Пульт с телефона (remote.js): телефон и волны связи
    phone: ['#ffb36b', '#e0571b', `<rect x="6.4" y="4.4" width="7.6" height="15.2" rx="1.8" fill="none" stroke="${W}" stroke-width="1.7"/>` + line('M9.4 17.4h1.6', 1.5) + line('M16.4 8.6a4 4 0 0 1 0 6.8M18.4 6.6a7 7 0 0 1 0 10.8', 1.4)],
    // Группа (team.js): телефоны музыкантов — два человека
    team: ['#5fe0b4', '#0d8f68', `<circle cx="9.4" cy="8.9" r="2.7" fill="${W}"/><path d="M4.4 18c.3-3 2.4-4.8 5-4.8s4.7 1.8 5 4.8z" fill="${W}"/><circle cx="15.8" cy="9.6" r="2.2" fill="${W}" opacity=".65"/><path d="M15.2 13.5c2.4-.2 4.2 1.4 4.5 4.5h-3.9c-.1-1.8-.3-3.3-.6-4.5z" fill="${W}" opacity=".65"/>`],
    // Профиль: человек в рамке-карточке (как пользователь Windows)
    profile: ['#b69bff', '#6a3fd8', `<circle cx="12" cy="9.2" r="3.1" fill="${W}"/><path d="M6.2 18.6c.4-3.3 2.8-5.2 5.8-5.2s5.4 1.9 5.8 5.2z" fill="${W}"/>`],
    mic: ['#ff8fc0', '#d23a7a',`<rect x="9.4" y="4.6" width="5.2" height="9.4" rx="2.6" fill="${W}"/>` + line('M7 11.8a5 5 0 0 0 10 0M12 16.8v2.6M9.4 19.4h5.2', 1.6)],
    // Разделы настроек
    show: ['#5ea2ff', '#2a5fe0', `<path d="M9 6.8v10.4l8.4-5.2z" fill="${W}"/>`],
    text: ['#ffb45e', '#de731c', `<path d="M5.4 17.6L9 6.6h1.6l3.6 11" stroke="${W}" stroke-width="1.9" fill="none" stroke-linejoin="round" stroke-linecap="round"/>` + line('M6.7 14h6.2', 1.7) + `<circle cx="16.8" cy="15.6" r="2.2" fill="none" stroke="${W}" stroke-width="1.7"/>` + line('M19 13.2v4.4', 1.7)],
    bvoice: ['#e8b45a', '#9a5b17', `<path d="M4.8 6.4A1.4 1.4 0 0 1 6.2 5h6.6v11.6H6.2A1.4 1.4 0 0 0 4.8 18z" fill="${W}"/><path d="M4.8 18a1.4 1.4 0 0 1 1.4-1.4h6.6V19H6.2" fill="${W}" opacity=".6"/><path d="M8.8 7.4v5.8M6.9 9.5h3.8" stroke="{d}" stroke-width="1.6" stroke-linecap="round"/>` + line('M15.2 9.6a3.3 3.3 0 0 1 0 4.8M17.6 7.6a6.2 6.2 0 0 1 0 8.8', 1.7)], // Библия по голосу
    vtext: ['#6fe0b0', '#1e9a6a', line('M5 10.6v2.8M7.6 8.4v7.2M10.2 9.8v4.4', 1.8) + line('M13.4 8.2h5.4M13.4 12h5.4M13.4 15.8h3.6', 1.8)], // речь → текст (поиск места по словам)
    wave: ['#ffb35a', '#d9700f', line('M5.6 10.6v2.8M8.5 8.2v7.6M11.4 5.6v12.8M14.3 8.6v6.8M17.2 7.2v9.6', 1.9)],
    pause: ['#5ea2ff', '#2a5fe0', `<rect x="7.4" y="6.6" width="3.2" height="10.8" rx="1" fill="${W}"/><rect x="13.4" y="6.6" width="3.2" height="10.8" rx="1" fill="${W}"/>`],
    stop: ['#93a3bb', '#46566f', `<rect x="7.2" y="7.2" width="9.6" height="9.6" rx="1.6" fill="${W}"/>`],
    loop: ['#4fd1ff', '#1a7fd0', line('M6.4 12.4v-.9a3 3 0 0 1 3-3h8M15.4 6.2l2.3 2.3-2.3 2.3M17.6 11.6v.9a3 3 0 0 1-3 3h-8M8.6 17.8l-2.3-2.3 2.3-2.3', 1.7)],
    crop: ['#ffa04a', '#d4570c', line('M8.4 4.6v11h11M4.6 8.4h11v11', 1.9)],
    audio: ['#ff7cb2', '#d23a7a', `<path d="M5 10h3l4-3.4v10.8L8 14H5z" fill="${W}"/>` + line('M14.8 9.4a3.6 3.6 0 0 1 0 5.2M16.9 7.4a6.4 6.4 0 0 1 0 9.2', 1.6)],
    keys: ['#a0acbf', '#55627a', `<rect x="4.2" y="7.4" width="15.6" height="9.4" rx="1.8" fill="${W}"/><path d="M6.8 10h1.2M9.6 10h1.2M12.4 10h1.2M15.2 10h1.2M8.4 14.2h7.2" stroke="{d}" stroke-width="1.5" stroke-linecap="round"/>`],
    presets: ['#b991ff', '#7547e0', line('M6 7.5h12M6 12h12M6 16.5h12', 1.6) + `<circle cx="9" cy="7.5" r="1.9" fill="${W}"/><circle cx="15" cy="12" r="1.9" fill="${W}"/><circle cx="10.5" cy="16.5" r="1.9" fill="${W}"/>`],
    database: ['#62d796', '#1c9a60', `<ellipse cx="12" cy="7.2" rx="6" ry="2.4" fill="${W}"/><path d="M6 9.4c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4v3.2c0 1.3-2.7 2.4-6 2.4s-6-1.1-6-2.4z" fill="${W}" opacity=".85"/><path d="M6 14.6c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4v2.2c0 1.3-2.7 2.4-6 2.4s-6-1.1-6-2.4z" fill="${W}" opacity=".7"/>`],
    update: ['#5fd0ff', '#1478d6', line('M17.6 9.4A6 6 0 0 0 6.6 9.8M6.4 14.6a6 6 0 0 0 11 .4', 1.9) + line('M17.8 5.6v3.9h-3.9M6.2 18.4v-3.9h3.9', 1.9)],
    parts: ['#ff9f6b', '#e0562a', `<rect x="5" y="5.6" width="3" height="3" rx=".8" fill="${W}"/><rect x="5" y="10.5" width="3" height="3" rx=".8" fill="${W}" opacity=".75"/><rect x="5" y="15.4" width="3" height="3" rx=".8" fill="${W}" opacity=".55"/>` + line('M10.6 7.1h8.2M10.6 12h8.2M10.6 16.9h5.6', 1.8)],
    arrange: ['#7ea8ff', '#3557e0', `<rect x="4.4" y="9.2" width="4.4" height="5.6" rx="1.1" fill="${W}"/><rect x="9.8" y="9.2" width="4.4" height="5.6" rx="1.1" fill="${W}" opacity=".7"/><rect x="15.2" y="9.2" width="4.4" height="5.6" rx="1.1" fill="${W}"/>` + line('M6.6 6.6c2.4-2 8.4-2 10.8 0M15.6 5l1.8 1.6-2 1.2', 1.4)],
    // Редактор тем: выравнивание, порядок, привязка (одна серо-синяя гамма — не пестрит)
    alignL: ['#9fb6dc', '#4c6690', line('M6 5v14', 2) + `<rect x="8.2" y="7.4" width="10" height="3.6" rx="1" fill="${W}"/><rect x="8.2" y="13" width="6" height="3.6" rx="1" fill="${W}"/>`],
    alignC: ['#9fb6dc', '#4c6690', `<rect x="7" y="7.4" width="10" height="3.6" rx="1" fill="${W}"/><rect x="9" y="13" width="6" height="3.6" rx="1" fill="${W}"/>` + line('M12 5v2.4M12 11v2M12 16.6V19', 2)],
    alignR: ['#9fb6dc', '#4c6690', line('M18 5v14', 2) + `<rect x="5.8" y="7.4" width="10" height="3.6" rx="1" fill="${W}"/><rect x="9.8" y="13" width="6" height="3.6" rx="1" fill="${W}"/>`],
    alignT: ['#9fb6dc', '#4c6690', line('M5 6h14', 2) + `<rect x="7.4" y="8.2" width="3.6" height="10" rx="1" fill="${W}"/><rect x="13" y="8.2" width="3.6" height="6" rx="1" fill="${W}"/>`],
    alignM: ['#9fb6dc', '#4c6690', `<rect x="7.4" y="7" width="3.6" height="10" rx="1" fill="${W}"/><rect x="13" y="9" width="3.6" height="6" rx="1" fill="${W}"/>` + line('M5 12h2.4M11 12h2M16.6 12H19', 2)],
    alignB: ['#9fb6dc', '#4c6690', line('M5 18h14', 2) + `<rect x="7.4" y="5.8" width="3.6" height="10" rx="1" fill="${W}"/><rect x="13" y="9.8" width="3.6" height="6" rx="1" fill="${W}"/>`],
    distH: ['#9fb6dc', '#4c6690', line('M5.6 5v14M18.4 5v14', 1.7) + `<rect x="9.8" y="8" width="4.4" height="8" rx="1" fill="${W}"/>`],
    distV: ['#9fb6dc', '#4c6690', line('M5 5.6h14M5 18.4h14', 1.7) + `<rect x="8" y="9.8" width="8" height="4.4" rx="1" fill="${W}"/>`],
    sameW: ['#9fb6dc', '#4c6690', `<rect x="6" y="6" width="12" height="4.6" rx="1" fill="${W}"/><rect x="6" y="13.4" width="12" height="4.6" rx="1" fill="${W}" opacity=".65"/>`],
    front: ['#8fd0c0', '#2e8a77', `<rect x="5" y="5" width="9" height="9" rx="1.6" fill="none" stroke="${W}" stroke-width="1.6"/><rect x="10" y="10" width="9" height="9" rx="1.6" fill="${W}"/>`],
    back: ['#8fd0c0', '#2e8a77', `<rect x="5" y="5" width="9" height="9" rx="1.6" fill="${W}" opacity=".6"/><rect x="10" y="10" width="9" height="9" rx="1.6" fill="{d}" stroke="${W}" stroke-width="1.6"/>`],
    group: ['#c3a6ff', '#7148d6', `<rect x="4.6" y="4.6" width="14.8" height="14.8" rx="2" fill="none" stroke="${W}" stroke-width="1.4" stroke-dasharray="2.2 1.8"/><rect x="7.4" y="7.4" width="5" height="5" rx="1" fill="${W}"/><rect x="11.6" y="11.6" width="5" height="5" rx="1" fill="${W}" opacity=".75"/>`],
    lock: ['#ffc86b', '#d68a12', `<rect x="6.4" y="10.6" width="11.2" height="8" rx="1.8" fill="${W}"/>` + line('M8.8 10.6V8.4a3.2 3.2 0 0 1 6.4 0v2.2', 1.9) + `<circle cx="12" cy="14.6" r="1.3" fill="{d}"/>`],
    eye: ['#7fd0ff', '#2483d0', `<path d="M4.4 12s2.8-5 7.6-5 7.6 5 7.6 5-2.8 5-7.6 5-7.6-5-7.6-5z" fill="${W}"/><circle cx="12" cy="12" r="2.6" fill="{d}"/>`],
    grid: ['#9fb6dc', '#4c6690', line('M9.4 5v14M14.6 5v14M5 9.4h14M5 14.6h14', 1.4) + `<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="${W}" stroke-width="1.6"/>`],
    magnet: ['#ff8a8a', '#d23b3b', `<path d="M7 5.6h3v6.6a2 2 0 0 0 4 0V5.6h3v6.6a5 5 0 0 1-10 0z" fill="${W}"/><path d="M7 5.6h3v2.4H7zM14 5.6h3v2.4h-3z" fill="{d}" opacity=".55"/>`],
    safe: ['#7fe0d2', '#1f9c8a', `<rect x="4.6" y="6" width="14.8" height="12" rx="1.8" fill="none" stroke="${W}" stroke-width="1.6"/><rect x="7.6" y="8.6" width="8.8" height="6.8" rx="1" fill="none" stroke="${W}" stroke-width="1.4" stroke-dasharray="2 1.6"/>`],
    ruler: ['#ffcf7a', '#d9871c', `<rect x="4" y="9" width="16" height="6.4" rx="1.2" fill="${W}"/><path d="M7 9v2.6M10 9v1.6M13 9v2.6M16 9v1.6" stroke="{d}" stroke-width="1.3" stroke-linecap="round"/>`],
    redo: ['#a6b3c6', '#5a6a82', line('M15 7.4l3.2 3.2-3.2 3.2') + line('M17.8 10.6h-7.6a4.2 4.2 0 0 0 0 8.4h2.4', 1.9)],
    trash: ['#ff8a8a', '#d23b3b', `<path d="M7.4 8.6h9.2l-.8 10a1.4 1.4 0 0 1-1.4 1.2H9.6a1.4 1.4 0 0 1-1.4-1.2z" fill="${W}"/>` + line('M5.8 7h12.4M10 7V5.4h4V7', 1.7)],
    import: ['#6fd69a', '#1f9a58', line('M12 4.8v9M8.4 10.4L12 14l3.6-3.6', 2) + line('M5.6 15.6v2.6h12.8v-2.6', 1.8)],
    export: ['#6fb8ff', '#2368d6', line('M12 14V5M8.4 8.4L12 4.8l3.6 3.6', 2) + line('M5.6 15.6v2.6h12.8v-2.6', 1.8)],
    flip: ['#c3a6ff', '#7148d6', `<path d="M10.6 6.4L5 17.6h5.6z" fill="${W}"/><path d="M13.4 6.4l5.6 11.2h-5.6z" fill="none" stroke="${W}" stroke-width="1.5" stroke-linejoin="round"/>` + line('M12 4.6v14.8', 1.3)],
    pipette: ['#ff9fd0', '#d23f8a', `<path d="M14.6 5.6a2 2 0 0 1 2.8 0l1 1a2 2 0 0 1 0 2.8l-1.6 1.6-3.8-3.8z" fill="${W}"/><path d="M12.4 8.8l2.8 2.8-6.4 6.4H6v-2.8z" fill="none" stroke="${W}" stroke-width="1.6" stroke-linejoin="round"/>`],
    // Макросы и виды нод
    macro: ['#ffb057', '#e0662a', `<rect x="4.4" y="5.2" width="5.8" height="4.8" rx="1.2" fill="${W}"/><rect x="13.8" y="5.2" width="5.8" height="4.8" rx="1.2" fill="${W}" opacity=".75"/><rect x="9.1" y="14.2" width="5.8" height="4.8" rx="1.2" fill="${W}"/>` + line('M10.2 7.6h3.6M16.7 10v2a2 2 0 0 1-2 2H13.6M7.3 10v2.2a2 2 0 0 0 2 2', 1.4)],
    trigger: ['#ff7a6b', '#d4301f', `<path d="M13.6 4.4L6.8 13.2h4.6l-1.2 6.4 7-9h-4.6z" fill="${W}"/>`],
    sensor: ['#33d6c3', '#0a857a', line('M5.4 16a6.6 6.6 0 1 1 13.2 0', 1.9) + line('M12 16l3.4-4.2', 2.2) + `<circle cx="12" cy="16" r="1.6" fill="${W}"/>`],
    logic: ['#ffd04a', '#e09600', line('M5.6 12h3.6l3-4.6h5.6M9.2 12l3 4.6h5.6', 1.8) + `<circle cx="17.6" cy="7.4" r="1.6" fill="${W}"/><circle cx="17.6" cy="16.6" r="1.6" fill="${W}"/>`],
    value: ['#c38cff', '#7c3fe0', line('M10 5.8L8.6 18.2M15.6 5.8l-1.4 12.4M6.4 9.8h12M5.8 14.2h12', 1.7)],
    timer: ['#9fb6dc', '#4c6690', `<circle cx="12" cy="13" r="6.2" fill="none" stroke="${W}" stroke-width="1.8"/>` + line('M12 13V9.6M12 13l2.4 1.6M10 4.8h4', 1.8)],
    // Экраны и экранные сцены (screens.js)
    screens: ['#5b95ff', '#3730d6', `<rect x="3.8" y="5.4" width="10.4" height="7.4" rx="1.4" fill="${W}" opacity=".6"/><rect x="9.6" y="9.4" width="10.6" height="7.6" rx="1.4" fill="${W}"/>` + line('M12.6 19.4h4.6', 1.6)],
    scene: ['#ff8fd0', '#b8329a', `<rect x="4.4" y="5.6" width="15.2" height="12.8" rx="1.8" fill="none" stroke="${W}" stroke-width="1.7"/><rect x="6.6" y="7.8" width="6.4" height="5" rx=".8" fill="${W}"/><rect x="14.2" y="7.8" width="3.2" height="3.4" rx=".6" fill="${W}" opacity=".7"/><rect x="6.6" y="14.2" width="10.8" height="2.2" rx=".6" fill="${W}" opacity=".7"/>`],
    output: ['#4fa0ff', '#1d56d8', `<rect x="4.6" y="6.4" width="12" height="8.6" rx="1.5" fill="none" stroke="${W}" stroke-width="1.7"/>` + line('M8.6 18.6h4.2M10.6 15v3.6M15.2 10.8h4.4M17.6 8.6l2.2 2.2-2.2 2.2', 1.7)],
    // Сценический экран (Stage Display, stage.js): напольный монитор, запись, заметка, аккорды, счётчик
    stage: ['#ffb43d', '#d26a0c', `<path d="M4.4 17.6l2.4-9.8h10.4l2.4 9.8z" fill="${W}"/><path d="M8.6 10.4h6.8M8.2 12.8h7.6" stroke="{d}" stroke-width="1.3" stroke-linecap="round"/>` + line('M4 19.2h16', 1.5)],
    rec: ['#ff6b6b', '#c81e2e', `<circle cx="12" cy="12" r="6.6" fill="none" stroke="${W}" stroke-width="1.7"/><circle cx="12" cy="12" r="3.6" fill="${W}"/>`],
    note: ['#ffe066', '#d9a400', `<path d="M5.4 5.4h13.2v9l-4.2 4.2H5.4z" fill="${W}"/><path d="M14.4 18.6v-4.2h4.2" fill="${W}" opacity=".6"/><path d="M8 9h8M8 12h5.4" stroke="{d}" stroke-width="1.4" stroke-linecap="round"/>`],
    chord: ['#ff8a5c', '#cf3f1d', `<rect x="6" y="4.8" width="12" height="14.4" rx="1.6" fill="none" stroke="${W}" stroke-width="1.6"/>` + line('M10 4.8v14.4M14 4.8v14.4M6 9.6h12M6 14.4h12', 1.1) + `<circle cx="10" cy="12" r="1.6" fill="${W}"/><circle cx="14" cy="7.2" r="1.6" fill="${W}"/>`],
    counter: ['#7fd3ff', '#1f86c9', `<text x="12" y="15.4" font-size="8.4" font-weight="800" text-anchor="middle" fill="${W}" font-family="Arial, sans-serif">3/9</text>`],
    // Значки слоёв (layers.js: выбор иконки слоя)
    presentation: ['#ff9a5c', '#d9531f', `<rect x="4.6" y="5" width="14.8" height="9.8" rx="1.4" fill="${W}"/><path d="M7.4 8.2h6.4M7.4 11.2h9" stroke="{d}" stroke-width="1.5" stroke-linecap="round"/>` + line('M12 14.8v2.4M8.8 19.4l3.2-2.6 3.2 2.6', 1.6)],
    ndi: ['#4fd6a8', '#0f8a62', `<text x="12" y="14.9" font-size="7.6" font-weight="800" text-anchor="middle" fill="${W}" font-family="Arial, sans-serif">NDI</text>` + line('M5.4 18.2h13.2', 1.4)],
    overlay: ['#8fa6ff', '#4659d8', `<rect x="4.4" y="5.6" width="15.2" height="12.8" rx="1.8" fill="none" stroke="${W}" stroke-width="1.6" opacity=".7"/><rect x="6.4" y="13" width="11.2" height="3.4" rx=".8" fill="${W}"/><rect x="13.4" y="7.6" width="4.2" height="3" rx=".7" fill="${W}" opacity=".8"/>`],
    announce: ['#ffb057', '#e0662a', `<path d="M5 9.6h3l8.4-4v12.8L8 14.4H5z" fill="${W}"/>` + line('M8.6 14.6l1.4 4.2M18.8 10.2v3.6', 1.8)],
    message: ['#7fb2ff', '#2f63d8', `<path d="M4.8 11.6L19.4 5l-4.2 14.2-3.6-5.4z" fill="${W}"/><path d="M11.6 13.8L19.4 5" stroke="{d}" stroke-width="1.3"/>`],
    props: ['#c38cff', '#7c3fe0', `<path d="M12 4.8l6.4 3.6v7.2L12 19.2l-6.4-3.6V8.4z" fill="${W}"/><path d="M5.6 8.4L12 12l6.4-3.6M12 12v7.2" stroke="{d}" stroke-width="1.3" fill="none" stroke-linejoin="round"/>`],
    // Служение (service.js, voice.js)
    service: ['#7fd0ff', '#2a7fd6', `<path d="M12 4.4l1.2 2.4h-2.4z" fill="${W}"/><rect x="11.2" y="6.6" width="1.6" height="3" fill="${W}"/><path d="M6.4 19.2v-6.6l5.6-3.6 5.6 3.6v6.6z" fill="${W}"/><rect x="10.6" y="15" width="2.8" height="4.2" rx="1.2" fill="{d}"/>`],
    lowerthird: ['#ff8a7a', '#d43a2e', `<rect x="4.6" y="6" width="14.8" height="12" rx="1.8" fill="none" stroke="${W}" stroke-width="1.6"/><rect x="6.4" y="12.6" width="8" height="2.4" rx=".6" fill="${W}"/><rect x="6.4" y="15.4" width="5.4" height="1.4" rx=".5" fill="${W}" opacity=".7"/>`],
    check: ['#4fe08a', '#14994d', `<rect x="5" y="4.8" width="14" height="14.4" rx="2.4" fill="none" stroke="${W}" stroke-width="1.7"/>` + line('M8.4 12.2l2.6 2.6 4.8-5', 2.2)],
  };

  let seq = 0;
  // Готовая разметка SVG; у каждого экземпляра свой id градиента (иначе скрытая кнопка «гасит» остальные)
  function svg(name) {
    const [a, b, glyph] = SET[name] || SET.slides;
    return tile(a, b, glyph);
  }
  // Плитка Multi Play: градиент a → b, блик, белый знак glyph ({d} — тёмный цвет плитки). Её же берёт iconlib.js
  function tile(a, b, glyph) {
    const id = 'mpi' + ++seq;
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`
      + `<rect width="24" height="24" rx="6" fill="url(#${id})"/><path d="M6 0h12a6 6 0 0 1 6 6v3.2C18 11 6 11 0 9.2V6a6 6 0 0 1 6-6z" fill="#fff" opacity=".16"/>`
      + `<rect x=".5" y=".5" width="23" height="23" rx="5.5" fill="none" stroke="#000" stroke-opacity=".18"/>`
      + glyph.replace(/\{d\}/g, b) + '</svg>';
  }
  function el(name) {
    const s = document.createElement('span');
    s.className = 'mp-icon';
    s.innerHTML = svg(name);
    return s;
  }
  // Ставит иконки всем элементам с data-icon (повторный вызов ничего не дублирует)
  function apply(root = document) {
    root.querySelectorAll('[data-icon]').forEach((b) => {
      if (b.firstElementChild && b.firstElementChild.classList.contains('mp-icon')) return;
      b.prepend(el(b.dataset.icon));
    });
  }
  // Поменять подпись кнопки, не стирая иконку
  function label(btn, text) {
    const ic = btn.firstElementChild && btn.firstElementChild.classList.contains('mp-icon') ? btn.firstElementChild : null;
    btn.textContent = text;
    if (ic) btn.prepend(ic);
  }
  return { svg, tile, el, apply, label, names: Object.keys(SET) };
})();

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Icons.apply());
else Icons.apply();

/* Клавиатура не должна «отваливаться» (Windows + Electron; main.js: fixFocus). Бывало: в поле мигает курсор,
   а буквы не вводятся до перезапуска программы. Здесь — для всех окон с полями ввода:
   1) щелчок в поле ввода или окно снова впереди — main проверяет, у окна ли клавиатура, и возвращает её;
   2) буквы и правда пропадают: в поле для текста нажали букву, ничего не ввелось и никто нажатие не перехватил —
      дважды за 3 с — main переподключает клавиатуру к окну. */
(() => {
  if (!window.api || !window.api.refocus) return;
  const TEXT = new Set(['text', 'search', 'url', 'email', 'tel', 'password']);
  const textField = (t) => !!t && !t.disabled && !t.readOnly
    && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && TEXT.has(t.type)) || !!t.isContentEditable);
  let softAt = 0;
  const soft = () => {
    const now = Date.now();
    if (now - softAt < 300) return;
    softAt = now;
    window.api.refocus(false);
  };
  document.addEventListener('pointerdown', (e) => { if (textField(e.target) || (e.target && e.target.type === 'number')) soft(); }, true);
  window.addEventListener('focus', soft);
  let typedAt = 0; // когда последний раз что-то ввелось (в любом поле)
  let misses = []; // когда нажатая буква пропала
  for (const ev of ['beforeinput', 'input', 'compositionstart']) document.addEventListener(ev, () => { typedAt = performance.now(); }, true);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || !e.key || e.key.length !== 1) return;
    const t = e.target;
    if (!textField(t)) return;
    if (t.maxLength > 0 && t.value.length >= t.maxLength && t.selectionStart === t.selectionEnd) return; // поле полное — так и должно быть
    const at = performance.now();
    setTimeout(() => {
      if (e.defaultPrevented || typedAt >= at || document.activeElement !== t) return; // нажатие перехватили или текст ввёлся
      const now = performance.now();
      misses = misses.filter((x) => now - x < 3000);
      misses.push(now);
      if (misses.length >= 2) { misses = []; window.api.refocus(true); }
    }, 400);
  }, true);
})();
