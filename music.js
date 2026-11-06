/* ===== Музыка: корневая папка, плейлисты; проигрыватель под предпросмотром ===== */

// tracks (быстрая очередь), curTrack, audio, fmt — в renderer.js
let playList = null;      // список, который сейчас играет: очередь, плейлист или песни папки
let musicLists = loadMusicLists(); // плейлисты музыки: [{ id, name, tracks }]
let muDirSongs = [];      // песни открытой папки
let muDirData = { ok: true, dirs: [], files: [] };
const muSeen = new Map(); // папка → её список (открывается мгновенно)
let muToken = 0;
let gain = 1;             // множитель громкости для плавности (0…1)
let fadeTimer = null;
let playToken = 0;        // каждое новое переключение отменяет прежние плавности
let endingFade = false;   // песня уже затухает перед следующей
let dragSrc = null;       // { list, i, songs } — какие песни тянут мышью внутри программы
const SONGS = 'text/x-cp-songs';

function loadMusicLists() {
  try {
    const v = JSON.parse(localStorage.getItem('cp.musicLists') || '[]');
    return Array.isArray(v) ? v.filter((x) => x && x.id && Array.isArray(x.tracks)) : [];
  } catch { return []; }
}
function saveMusicLists() {
  try { localStorage.setItem('cp.musicLists', JSON.stringify(musicLists.map((l) => ({ id: l.id, name: l.name, tracks: l.tracks.map(pickKeys) })))); } catch { /* не страшно */ }
}

const songOf = (f) => ({ type: 'audio', name: f.name, path: f.path, url: f.url });
const curSong = () => (playList && playList[curTrack]) || null;
const hasNext = () => !!playList && curTrack + 1 < playList.length;
const muBtn = (text, title, fn) => {
  const b = Object.assign(document.createElement('button'), { textContent: text, title });
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  return b;
};

// Что открыто в середине: папка ({ kind: 'dir', path }) или плейлист ({ kind: 'pl', id })
function muSrc() {
  const s = settings.musicSrc;
  if (s && s.kind === 'pl' && musicLists.some((l) => l.id === s.id)) return s;
  if (s && s.kind === 'dir' && settings.musicRoot && String(s.path).startsWith(settings.musicRoot)) return s;
  return settings.musicRoot ? { kind: 'dir', path: settings.musicRoot } : null;
}
function setMuSrc(s) {
  settings.musicSrc = s;
  saveSettings();
  $('muFilter').value = '';
  renderMusic();
}
const muPl = () => { const s = muSrc(); return s && s.kind === 'pl' ? musicLists.find((l) => l.id === s.id) : null; };

// Изменить список так, чтобы играющая песня не потерялась (а если её убрали — остановить)
function editList(list, fn) {
  const playing = playList === list ? list[curTrack] : null;
  fn();
  if (playList !== list) return;
  curTrack = playing ? list.indexOf(playing) : -1;
  if (playing && curTrack < 0) {
    playToken += 1;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    playList = null;
  }
}
function listChanged() { saveMusicLists(); renderMusic(); }

function queueAdd(songs, at = tracks.length) {
  editList(tracks, () => tracks.splice(at, 0, ...songs.map(songOf)));
  renderTracks();
}
function removeSong(list, i) {
  editList(list, () => list.splice(i, 1));
  listChanged();
}

/* ----- Отрисовка ----- */

function renderMusic() {
  renderMuSide();
  renderMuSongs();
  renderTracks();
}

function renderMuSide() {
  const src = muSrc();
  const root = $('muRoot');
  root.replaceChildren();
  if (settings.musicRoot) {
    const r = Object.assign(document.createElement('div'), { className: 'svc-row' + (src && src.kind === 'dir' ? ' cur' : ''), title: settings.musicRoot, tabIndex: 0 });
    r.append(document.createTextNode('📁 ' + baseName(settings.musicRoot)));
    r.addEventListener('click', () => setMuSrc({ kind: 'dir', path: settings.musicRoot }));
    root.append(r);
  } else {
    root.append(Object.assign(document.createElement('p'), { className: 'svc-tip', textContent: 'Нажмите 📁 и выберите папку, где лежит музыка. Подпапки откроются здесь же.' }));
  }
  const box = $('muLists');
  box.replaceChildren();
  for (const l of musicLists) {
    const r = Object.assign(document.createElement('div'), { className: 'svc-row' + (src && src.kind === 'pl' && src.id === l.id ? ' cur' : ''), title: l.name, tabIndex: 0 });
    const name = Object.assign(document.createElement('span'), { textContent: '♫ ' + l.name });
    name.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    r.append(name, Object.assign(document.createElement('span'), { className: 'cnt', textContent: l.tracks.length }));
    r.addEventListener('click', () => setMuSrc({ kind: 'pl', id: l.id }));
    r.addEventListener('dblclick', () => renameMusicList(l));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); musicListMenu(e, l); });
    dropZone(r, () => l.tracks, false);
    box.append(r);
  }
  if (!musicLists.length) box.append(Object.assign(document.createElement('p'), { className: 'svc-tip', textContent: '«＋» — новый плейлист. Песни в него можно перетащить.' }));
}

async function renderMuSongs() {
  const src = muSrc();
  const box = $('muSongs');
  const q = $('muFilter').value.trim().toLowerCase();
  const match = (n) => !q || n.toLowerCase().includes(q);
  const token = ++muToken;
  $('muUp').hidden = !src || src.kind !== 'dir' || src.path.replace(/[\\/]+$/, '') === settings.musicRoot.replace(/[\\/]+$/, '');
  if (!src) {
    $('muTitle').textContent = 'Музыка';
    box.replaceChildren(Object.assign(document.createElement('div'), { className: 'mu-msg', textContent: 'Выберите корневую папку музыки (📁 слева) или создайте плейлист.' }));
    return;
  }
  if (src.kind === 'pl') {
    const l = muPl();
    $('muTitle').textContent = l.name;
    $('muTitle').title = l.name;
    box.replaceChildren(...l.tracks.map((s, i) => [s, i]).filter(([s]) => match(s.name)).map(([s, i]) => songRow(s, l.tracks, i, 'pl')));
    if (!l.tracks.length) box.append(Object.assign(document.createElement('div'), { className: 'mu-msg', textContent: 'Перетащите сюда песни из папки или из Проводника.' }));
    updateMusicRows(true);
    return;
  }
  // Папка: сразу то, что видели раньше, потом свежий список с диска
  const rel = src.path.slice(settings.musicRoot.replace(/[\\/]+$/, '').length);
  $('muTitle').textContent = baseName(settings.musicRoot) + rel;
  $('muTitle').title = src.path;
  const draw = (data) => {
    muDirData = data;
    muDirSongs = data.files.filter((f) => f.type === 'audio').map(songOf);
    const rows = [];
    for (const d of data.dirs.filter((x) => match(x.name))) {
      const r = Object.assign(document.createElement('div'), { className: 'row dir', tabIndex: 0, title: d.name });
      r.append(Object.assign(document.createElement('span'), { className: 'ic', textContent: '📁' }), Object.assign(document.createElement('span'), { className: 'name', textContent: d.name }));
      r.addEventListener('click', () => setMuSrc({ kind: 'dir', path: d.path }));
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter') setMuSrc({ kind: 'dir', path: d.path }); });
      rows.push(r);
    }
    muDirSongs.forEach((s, i) => { if (match(s.name)) rows.push(songRow(s, muDirSongs, i, 'dir')); });
    box.replaceChildren(...rows);
    if (!data.ok) box.append(Object.assign(document.createElement('div'), { className: 'mu-msg', textContent: `Не удалось открыть: ${data.error}` }));
    else if (!rows.length) box.append(Object.assign(document.createElement('div'), { className: 'mu-msg', textContent: q ? 'Ничего не найдено' : 'В этой папке нет музыки' }));
    updateMusicRows(true);
  };
  const old = muSeen.get(src.path);
  if (old) draw(old);
  else box.replaceChildren(Object.assign(document.createElement('div'), { className: 'mu-msg', textContent: 'Читаю папку…' }));
  const res = (await window.api.poolList(src.path)) || { ok: false, error: 'нет ответа', dirs: [], files: [] };
  if (token !== muToken) return; // пока читали, открыли другое
  muSeen.set(src.path, res);
  if (!old || JSON.stringify(old) !== JSON.stringify(res)) draw(res);
}

// Быстрая очередь на экране больше не показывается (владелец убрал), но список tracks остался:
// через него играют музыкальные слайды, макросы и песни, добавленные без открытого плейлиста
function renderTracks() {
  saveLists();
  updateAudioUi();
}

// Песни, добавленные кнопкой «Добавить файлы» или из медиапула: в открытый плейлист, иначе — сразу играть
function musicAdd(songs) {
  if (!songs.length) return;
  const l = muPl();
  if (l) {
    editList(l.tracks, () => l.tracks.push(...songs.map(songOf)));
    listChanged();
    flashStatus(`Добавлено в «${l.name}»`);
    return;
  }
  const at = tracks.length;
  queueAdd(songs);
  playTrack(at, tracks);
}

function songRow(song, list, i, kind) {
  const row = Object.assign(document.createElement('div'), { className: 'row', tabIndex: 0, title: song.name });
  row.dataset.i = i;
  row.dataset.url = song.url;
  row.append(Object.assign(document.createElement('span'), { className: 'ic', textContent: '♪' }), Object.assign(document.createElement('span'), { className: 'name', textContent: song.name }));
  if (kind !== 'dir') row.append(muBtn('×', 'Убрать из плейлиста', () => removeSong(list, i)));
  // Выбрали песню — она играет
  row.addEventListener('click', () => playTrack(i, list));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') playTrack(i, list);
    if (e.key === 'Delete' && kind !== 'dir') removeSong(list, i);
  });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); songMenu(e, song, list, i, kind); });
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    dragSrc = { list, i, songs: [song] };
    e.dataTransfer.setData(SONGS, '1');
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  row.addEventListener('dragend', () => { dragSrc = null; clearDropMarks(); });
  return row;
}

// Подсветка играющей песни во всех списках (по адресу файла)
let rowsKey = '';
function updateMusicRows(force) {
  const s = curSong();
  const key = s ? s.url + (audio.paused ? '|p' : '|') : '';
  if (!force && key === rowsKey) return;
  rowsKey = key;
  document.querySelectorAll('#musicView .row[data-url]').forEach((r) => {
    const on = !!s && r.dataset.url === s.url;
    r.classList.toggle('playing', on);
    r.querySelector('.ic').textContent = on ? (audio.paused ? '❚❚' : '▶') : '♪';
  });
}

/* ----- Перетаскивание песен ----- */

function clearDropMarks() { document.querySelectorAll('#musicView .drop, #musicView .drop-before').forEach((x) => x.classList.remove('drop', 'drop-before')); }

// Куда можно бросить песни: открытый плейлист, плейлист слева (rows — вставка перед строкой)
function dropZone(el, getList, rows = true) {
  const ok = (e) => !!getList() && ((dragSrc && e.dataTransfer.types.includes(SONGS)) || e.dataTransfer.types.includes('Files'));
  el.addEventListener('dragover', (e) => {
    if (!ok(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dragSrc && dragSrc.list === getList() ? 'move' : 'copy';
    clearDropMarks();
    el.classList.add('drop');
    const row = rows && e.target.closest('.row[data-i]');
    if (row && el.contains(row)) row.classList.add('drop-before');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) clearDropMarks(); });
  el.addEventListener('drop', async (e) => {
    if (!ok(e)) return;
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('dragging');
    clearDropMarks();
    const list = getList();
    const row = rows && e.target.closest('.row[data-i]');
    let at = row && el.contains(row) ? Number(row.dataset.i) : list.length;
    const src = dragSrc;
    if (src) {
      if (src.list === list) {
        editList(list, () => { const [x] = list.splice(src.i, 1); if (at > src.i) at -= 1; list.splice(at, 0, x); });
      } else {
        editList(list, () => list.splice(at, 0, ...src.songs.map(songOf)));
      }
    } else {
      const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
      const res = await window.api.describeFiles(paths, { slideWidth: slideWidth() });
      const songs = ((res && res.items) || []).filter((x) => x.type === 'audio');
      if (!songs.length) { flashStatus('Сюда можно только музыку: mp3, wav, ogg, m4a, flac'); return; }
      editList(list, () => list.splice(at, 0, ...songs.map(songOf)));
    }
    listChanged();
  });
}
dropZone($('muSongs'), () => { const l = muPl(); return l && l.tracks; });

/* ----- Меню и плейлисты ----- */

function songMenu(e, song, list, i, kind) {
  const items = [
    { label: 'Играть', fn: () => playTrack(i, list) },
  ];
  const others = musicLists.filter((l) => l.tracks !== list);
  if (others.length) items.push('-', ...others.map((l) => ({ label: `В плейлист «${l.name}»`, fn: () => { l.tracks.push(songOf(song)); listChanged(); flashStatus(`Добавлено в «${l.name}»`); } })));
  // Аудиоредактор: из плейлиста/очереди «Сохранить» подменит песню в списке, из папки — сохранит новым файлом
  if (song.path) items.push('-', { label: 'Открыть в аудиоредакторе', fn: () => openAudioEditor(song, kind === 'dir' ? { kind: 'file' } : { kind: 'music', list }) });
  if (song.path) items.push({ label: 'Показать в проводнике', fn: () => revealFile(song.path) });
  if (kind !== 'dir') items.push('-', { label: 'Убрать из плейлиста', key: 'Delete', fn: () => removeSong(list, i) });
  showMenu(e, items);
}

function musicListMenu(e, l) {
  showMenu(e, [
    { label: 'Играть с начала', disabled: !l.tracks.length, fn: () => playTrack(0, l.tracks) },
    '-',
    { label: 'Переименовать', fn: () => renameMusicList(l) },
    { label: 'Удалить плейлист', fn: () => {
      if (!window.confirm(`Удалить плейлист «${l.name}»? Сами файлы песен останутся на диске.`)) return;
      musicLists = musicLists.filter((x) => x !== l);
      listChanged();
    } },
  ]);
}

async function renameMusicList(l) {
  const name = await askName('Название плейлиста', l.name);
  if (!name) return;
  l.name = name;
  listChanged();
}

$('muPlNew').addEventListener('click', () => {
  const base = 'Плейлист ' + new Date().toLocaleDateString('ru-RU');
  let name = base;
  for (let n = 2; musicLists.some((l) => l.name === name); n++) name = `${base} (${n})`;
  const l = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, tracks: [] };
  musicLists.push(l);
  saveMusicLists();
  setMuSrc({ kind: 'pl', id: l.id });
});
$('muRootPick').addEventListener('click', async () => {
  const dir = await window.api.poolPickFolder('Корневая папка музыки');
  if (!dir) return;
  settings.musicRoot = dir;
  setMuSrc({ kind: 'dir', path: dir });
});
$('muUp').addEventListener('click', () => {
  const s = muSrc();
  if (s && s.kind === 'dir') setMuSrc({ kind: 'dir', path: parentDir(s.path) });
});
$('muFilter').addEventListener('input', renderMuSongs);

/* ----- Воспроизведение и плавные переходы ----- */

// Громкость = ползунок × плавность (в квадрате — на слух ровнее)
function applyVol() { audio.volume = settings.musicMute ? 0 : Math.max(0, Math.min(1, settings.musicVol * gain * gain)); }

// Плавно довести громкость до target за ms (если уже почти там — быстрее)
function fadeTo(target, ms) {
  clearInterval(fadeTimer);
  fadeTimer = null;
  const from = gain;
  const dur = (ms || 0) * Math.abs(target - from);
  if (dur < 30) { gain = target; applyVol(); return Promise.resolve(); }
  const t0 = performance.now();
  return new Promise((resolve) => {
    fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      gain = from + (target - from) * k;
      applyVol();
      if (k >= 1) { clearInterval(fadeTimer); fadeTimer = null; resolve(); }
    }, 40);
  });
}

async function playTrack(i, list = playList || tracks) {
  if (!list || i < 0 || i >= list.length) return;
  const token = ++playToken;
  const song = list[i];
  // Сначала плавно гасим то, что играет
  if (!audio.paused && audio.src && settings.fadeOut > 0) {
    await fadeTo(0, settings.fadeOut * 1000);
    if (token !== playToken) return;
  }
  playList = list;
  curTrack = i;
  endingFade = false;
  audio.src = song.url;
  gain = settings.fadeIn > 0 ? 0 : 1;
  applyVol();
  updateAudioUi();
  try {
    await audio.play();
  } catch (err) {
    if (token === playToken && (!err || err.name !== 'AbortError')) showNotice(`Не удалось воспроизвести «${song.name}»`, true);
    return;
  }
  if (token === playToken) fadeTo(1, settings.fadeIn * 1000);
}

async function stopMusic() {
  const token = ++playToken;
  if (!audio.paused && settings.fadeOut > 0) {
    await fadeTo(0, settings.fadeOut * 1000);
    if (token !== playToken) return;
  }
  audio.pause();
  if (audio.src) audio.currentTime = 0;
  gain = 1;
  applyVol();
  updateAudioUi();
}

function pauseMusic() {
  playToken += 1;
  clearInterval(fadeTimer);
  audio.pause();
  gain = 1;
  endingFade = false;
  applyVol();
}

// Предыдущая / следующая песня того списка, что играет (или очереди)
function musicStep(d) {
  const list = playList || tracks;
  if (!list.length) { flashStatus('Нет песен: выберите песню в папке или плейлисте'); return; }
  if (d < 0 && curTrack >= 0 && audio.currentTime > 3) { audio.currentTime = 0; return; } // как в плеерах: сначала к началу песни
  const i = curTrack < 0 ? 0 : curTrack + d;
  if (i < 0 || i >= list.length) return;
  playTrack(i, list);
}

audio.addEventListener('play', () => { lastPlayed = 'audio'; updateAudioUi(); });
audio.addEventListener('pause', updateAudioUi);
audio.addEventListener('loadedmetadata', updateAudioUi);
audio.addEventListener('timeupdate', () => {
  // Сам переход: за «Затухание» секунд до конца начинаем гасить и переходим к следующей
  const d = audio.duration;
  const fo = settings.fadeOut;
  if (settings.autoNext && fo > 0 && !endingFade && !audio.paused && hasNext() && Number.isFinite(d) && d > fo * 2 && d - audio.currentTime <= fo) {
    endingFade = true;
    playTrack(curTrack + 1);
  }
  updateAudioUi();
});
audio.addEventListener('ended', () => {
  if (endingFade) return; // переход уже идёт
  if (settings.autoNext && hasNext()) playTrack(curTrack + 1);
  else updateAudioUi();
});

/* ----- Fade In / Fade Out: кнопки под проигрывателем, у каждой своя шкала ----- */

function toggleFadeBox(name) {
  const box = $(name + 'Box');
  box.hidden = !box.hidden;
  $(name + 'Btn').classList.toggle('open', !box.hidden);
}
$('fadeInBtn').addEventListener('click', () => toggleFadeBox('fadeIn'));
$('fadeOutBtn').addEventListener('click', () => toggleFadeBox('fadeOut'));

/* ----- Проигрыватель под предпросмотром: видео на экране или музыка ----- */

// Видео на экране и открыта музыка — два проигрывателя: верхний — музыка, второй (#vplayer) — видео
const twoPlayers = () => !!pv && pv.isConnected && !!curSong();

function playerMode() {
  const hasVideo = !!pv && pv.isConnected;
  const hasAudio = !!curSong();
  if (hasVideo && hasAudio) return 'audio';
  if (hasVideo && (lastPlayed === 'video' || !hasAudio || audio.paused)) return 'video';
  return hasAudio ? 'audio' : hasVideo ? 'video' : '';
}

// Видео: команда и предпросмотру, и окну вывода
function videoCtl(cmd, value) {
  if (!pv) return;
  if (cmd === 'play') pv.play().catch(() => {});
  if (cmd === 'pause') pv.pause();
  if (cmd === 'seek') pv.currentTime = value;
  if (cmd === 'volume') { videoVol = settings.videoVol = value; sendVideoAudio(); } // с учётом Mute
  else window.api.videoCtl({ cmd, value });
  updateAudioUi();
}

// После показа: найти новое видео в предпросмотре и следить за ним
function watchPreviewVideo(content) {
  // Видеофайл в своём слое (живые источники проигрывателем не управляются)
  const v = content && content.type === 'video' ? [...prevStage.querySelectorAll('.layer:not(.live) > video.media')].pop() : null;
  if (v !== pv) {
    pv = v || null;
    if (pv) {
      lastPlayed = 'video';
      ['play', 'pause', 'timeupdate', 'loadedmetadata', 'ended'].forEach((ev) => pv.addEventListener(ev, updateAudioUi));
      // Макросы: пуск, пауза, конец видео (macros.js); пауза в самом конце — это «закончилось», не «пауза»
      const v = pv;
      ['play', 'pause', 'ended'].forEach((ev) => v.addEventListener(ev, () => { if (typeof mcVideoEvt === 'function' && v === pv && !(ev === 'pause' && v.ended)) mcVideoEvt(ev); }));
      sendVideoAudio(); // громкость, Mute, устройство — и для нового видео
    }
  }
  updateAudioUi(); // и обложку: экран пустой — во весь предпросмотр, иначе в углу
}

// Проигрыватель виден всегда; когда ничего не играет — тусклее
function updateAudioUi() {
  updateMusicRows();
  const mode = playerMode();
  const box = $('player');
  const m = mode === 'video' ? pv : mode === 'audio' ? audio : null;
  box.classList.toggle('video', mode === 'video');
  box.classList.toggle('audio', mode === 'audio');
  box.classList.toggle('idle', !m || m.paused);
  $('playerKind').textContent = mode === 'video' ? 'Видео' : mode === 'audio' ? 'Музыка' : 'Тишина';
  const s = curSong();
  $('trackName').textContent = mode === 'video' ? (videoLayer() || {}).label || 'Видео' : s ? s.name : 'Ничего не играет';
  $('trackName').title = $('trackName').textContent;
  $('playPause').textContent = m && !m.paused ? '❚❚' : '▶';
  $('playPause').title = m && !m.paused ? 'Пауза' : 'Играть';
  const list = playList || tracks;
  $('muPrev').disabled = !list.length;
  $('muNext').disabled = !list.length;
  $('muPick').disabled = !list.length;
  const d = m ? m.duration : NaN;
  $('time').textContent = fmt(m ? m.currentTime : 0);
  $('timeEnd').textContent = fmt(d);
  if (document.activeElement !== $('seek')) $('seek').value = Number.isFinite(d) && d > 0 ? String(Math.round((m.currentTime / d) * 1000)) : '0';
  if (document.activeElement !== $('volume')) $('volume').value = String(Math.round((mode === 'video' ? videoVol : settings.musicVol) * 100));
  // Mute: у видео и у музыки свой
  const muted = mode === 'audio' ? settings.musicMute : settings.videoMute;
  $('muteBtn').classList.toggle('on', !!muted);
  $('muteBtn').setAttribute('aria-pressed', String(!!muted));
  $('muteBtn').title = (mode === 'audio' ? 'Музыка' : 'Видео') + (muted ? ': звук выключен — включить' : ': выключить звук (Mute)');
  $('player').classList.toggle('muted', !!muted);
  updateVideoPlayer();
}

// Второй проигрыватель — только видео
function updateVideoPlayer() {
  const box = $('vplayer');
  box.hidden = !twoPlayers();
  if (box.hidden) return;
  $('vName').textContent = (videoLayer() || {}).label || 'Видео';
  $('vName').title = $('vName').textContent;
  box.classList.toggle('idle', pv.paused);
  $('vPlay').textContent = pv.paused ? '▶' : '❚❚';
  $('vPlay').title = pv.paused ? 'Видео: играть' : 'Видео: пауза';
  const d = pv.duration;
  $('vTime').textContent = fmt(pv.currentTime);
  $('vTimeEnd').textContent = fmt(d);
  if (document.activeElement !== $('vSeek')) $('vSeek').value = Number.isFinite(d) && d > 0 ? String(Math.round((pv.currentTime / d) * 1000)) : '0';
  if (document.activeElement !== $('vVolume')) $('vVolume').value = String(Math.round(videoVol * 100));
  const muted = !!settings.videoMute;
  $('vMute').classList.toggle('on', muted);
  $('vMute').setAttribute('aria-pressed', String(muted));
  $('vMute').title = 'Видео' + (muted ? ': звук выключен — включить' : ': выключить звук (Mute)');
  box.classList.toggle('muted', muted);
}

$('vPlay').addEventListener('click', () => { if (pv) videoCtl(pv.paused ? 'play' : 'pause'); });
$('vStop').addEventListener('click', () => { if (pv) { videoCtl('pause'); videoCtl('seek', 0); } });
$('vSeek').addEventListener('input', (e) => {
  if (pv && Number.isFinite(pv.duration)) videoCtl('seek', (pv.duration * e.target.value) / 1000);
});
$('vVolume').addEventListener('input', (e) => { settings.videoMute = false; videoCtl('volume', e.target.value / 100); });
$('vVolume').addEventListener('change', saveSettings);
$('vMute').addEventListener('click', () => {
  settings.videoMute = !settings.videoMute;
  sendVideoAudio();
  flashStatus(settings.videoMute ? 'Звук видео выключен' : 'Звук видео включён');
  saveSettings();
  updateAudioUi();
});

// Mute: выключить/включить звук того, что в проигрывателе (видео — на выводе, музыка — здесь); громкость не теряется
$('muteBtn').addEventListener('click', () => {
  if (playerMode() === 'audio') { settings.musicMute = !settings.musicMute; applyVol(); }
  else { settings.videoMute = !settings.videoMute; sendVideoAudio(); flashStatus(settings.videoMute ? 'Звук видео выключен' : 'Звук видео включён'); }
  saveSettings();
  updateAudioUi();
});

$('playPause').addEventListener('click', () => {
  const mode = playerMode();
  if (mode === 'video') videoCtl(pv.paused ? 'play' : 'pause');
  else if (mode === 'audio') {
    if (audio.paused) { gain = 1; applyVol(); audio.play().catch(() => {}); } else pauseMusic();
  } else musicStep(1);
});
$('stop').addEventListener('click', () => {
  if (playerMode() === 'video') { videoCtl('pause'); videoCtl('seek', 0); return; }
  stopMusic();
});
$('muPrev').addEventListener('click', () => musicStep(-1));
$('muNext').addEventListener('click', () => musicStep(1));
// Список песен того, что играет, — выбрать прямо из проигрывателя
$('muPick').addEventListener('click', (e) => {
  const list = playList || tracks;
  const r = e.currentTarget.getBoundingClientRect();
  showMenu({ clientX: r.left, clientY: r.bottom + 4 }, list.map((s, i) => ({ label: (list === playList && i === curTrack ? '▶ ' : '') + s.name, fn: () => playTrack(i, list) })));
});
$('seek').addEventListener('input', (e) => {
  const m = playerMode() === 'video' ? pv : audio;
  if (!m || !Number.isFinite(m.duration)) return;
  const t = (m.duration * e.target.value) / 1000;
  if (m === pv) videoCtl('seek', t); else audio.currentTime = t;
});
$('volume').addEventListener('input', (e) => {
  // Двинули громкость — Mute снимается
  if (playerMode() === 'video') { settings.videoMute = false; videoCtl('volume', e.target.value / 100); }
  else { settings.musicMute = false; settings.musicVol = e.target.value / 100; applyVol(); updateAudioUi(); }
});
$('volume').addEventListener('change', saveSettings);

applyVol();
renderTracks();
