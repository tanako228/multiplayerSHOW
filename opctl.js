/* ---------- Пульт оператора на планшете (приложение группы, право «Полное управление») ----------
   Телефон или планшет (app/op.js) управляет программой целиком: плейлисты и библиотеки, слайды, Библия, медиапул,
   слои и выходы «Зал» / «Сцена», таймеры, сообщение сцене, плашки, макросы, «что на экране» картинкой.
   Связь: WebSocket группы (teamapi.js) → main.js (opCall) → сюда (team:op) → ответ team:opDone.
   Все действия — те же функции, что щелчок мышью и клавиши (showSlide, clearLayer, showVerses, poolShow, mcRunManual…):
   программа ведёт себя так же, Ctrl+Z работает, на экране оператора видно, что сделал пульт.
   Состояние (разделы lists, live, bible, macros, timers, stage, plates, pool) считаем, только пока пульт открыт хоть
   на одном планшете (team:opWant), раз в 250 мс, и отдаём в main только изменившиеся разделы; сразу после команды —
   без ожидания, чтобы планшет увидел результат мгновенно.
   Слайды презентаций — по запросу (item / items) с версией: не поменялась — планшет берёт свою копию.
   В ответе у слайда — его содержимое (contentOf); main.js меняет его на отпечаток картинки. */

let opWantOn = false;
let opVolSave = 0;
const opSent = {}; // раздел → JSON, отправленный последним
let opListsHist = null;
let opListsKey = '';

window.api.onTeamOpWant((on) => {
  opWantOn = !!on;
  for (const k of Object.keys(opSent)) delete opSent[k]; // новый планшет — всё заново
  opListsHist = null;
  if (opWantOn) opTick();
});

/* ----- Версия презентации: отпечаток её строки в снимке отмены (histCur) + вид (темы, размер экрана) ----- */

function opFnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const opVerCache = new Map(); // id → [строка, отпечаток]
let opLook = { hist: null, key: '', h: '' };
function opLookSig() {
  const key = JSON.stringify([textStyle(), settings.fit, outputSize(), settings.showTr, settings.refShort]);
  if (opLook.hist !== histCur || opLook.key !== key) opLook = { hist: histCur, key, h: opFnv(key + '|' + (histCur ? histCur.rest : '')) };
  return opLook.h;
}
function opVer(id) {
  const s = histCur && histCur.items.get(id);
  if (!s) return '';
  let c = opVerCache.get(id);
  if (!c || c[0] !== s) { c = [s, opFnv(s)]; opVerCache.set(id, c); }
  return c[1] + '.' + opLookSig();
}

// Текст слайда для подписи и правки
function opSlideText(s) {
  if (s.k === 'custom') return grSlideText(s);
  return rmText(s);
}
function opItemPay(item) {
  return {
    id: item.id, name: item.name, kind: item.kind || '', ver: opVer(item.id),
    slides: item.slides.map((s) => {
      let content = null;
      if (!['audio', 'live'].includes(s.k)) { try { content = contentOf(item, s); } catch { content = null; } }
      const label = s.k === 'bible' ? s.ref || s.label || '' : s.label || s.name || '';
      return { id: s.id, k: s.k, label, c: item.kind === 'song' ? partColor(s.label) : '', text: String(opSlideText(s) || '').slice(0, 600), content };
    }),
  };
}

/* ----- Разделы состояния ----- */

// rev — номер сохранения библиотеки: поменялся — планшет сверит открытый список (слайды могли поменяться)
let opRev = 0;
function opLists() {
  const pl = lib.playlists.map((p) => ({ id: p.id, name: p.name, n: p.entries.length, date: (p.team && p.team.date) || '' }));
  const lb = lib.libraries.map((l) => ({ id: l.id, name: l.name, n: l.items.length }));
  return { pl, lib: lb, work: workKey(), view: viewKey(), rev: opRev };
}
function opLiveSec() {
  let at = null;
  if (plShown) {
    const x = entryByKey(plShown.key, keyView(plShown.view));
    if (x) at = { vk: plShown.view, key: plShown.key, sid: plShown.sid, item: x.item.id };
  }
  const layers = layerDefs().map((l) => {
    const on = layerOn[l.id];
    return { id: l.id, name: layerName(l), kind: l.kind, on: !!on, label: on ? on.label || '' : '', play: !!on && ['video', 'live'].includes(on.content.type), hidden: !!l.hidden };
  });
  const grp = (g) => { const m = outGroupMembers(g); return { on: m.some((x) => x.on), n: m.length }; };
  const b = bShown && bible && bShown.bid === bible.id ? { bi: bShown.bi, ci: bShown.ci, v1: bShown.v1, v2: bShown.v2 } : null;
  return { at, bible: b, label: liveLabel || '', layers, hall: grp('hall'), stage: grp('stage'), frozen: !!outFrozen, size: outputSize(), auto: !!autoT, screens: opScreens() };
}
// Что можно смотреть на пульте: экраны и сцены (как выбор в «Предпросмотре»)
function opScreens() {
  const sc = (lib.screens || []).map((s) => ({ id: s.id, name: s.name || (s.id === 'main' ? 'Основной' : 'Экран') }));
  if (!sc.some((s) => s.id === 'main')) sc.unshift({ id: 'main', name: 'Основной' });
  sc.sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : 0));
  return [...sc, ...(lib.scenes || []).map((s) => ({ id: 'scene:' + s.id, name: s.name || 'Сцена', scene: true }))];
}
// Встроенный проигрыватель (music.js): музыка и видео на экране; время — до секунды (раздел шлётся раз в секунду, пока играет)
function opPlayer() {
  if (typeof playerMode !== 'function') return null;
  const fin = (x) => (Number.isFinite(x) ? Math.round(x) : 0);
  const s = curSong();
  const a = { on: !!s, name: s ? s.name : '', play: !!s && !audio.paused, t: Math.floor(audio.currentTime || 0), d: fin(audio.duration), vol: Math.round((settings.musicVol ?? 1) * 100), mute: !!settings.musicMute };
  const hasV = !!pv && pv.isConnected;
  const v = hasV ? { name: (videoLayer() || {}).label || 'Видео', play: !pv.paused, t: Math.floor(pv.currentTime || 0), d: fin(pv.duration), vol: Math.round(videoVol * 100), mute: !!settings.videoMute } : null;
  const list = playList || tracks;
  return { mode: playerMode(), a, v, n: list.length, cur: curTrack, lists: (musicLists || []).map((l) => ({ id: l.id, name: l.name, n: l.tracks.length })) };
}
function opBibleSec() {
  return { list: bibleIndex.map((b) => ({ id: b.id, name: b.name, lang: b.lang || '' })), cur: bible ? bible.id : '', name: bible ? bible.name || '' : '' };
}
function opMacros() {
  return (lib.macros || []).filter((m) => m && m.enabled !== false).map((m) => ({ id: m.id, name: m.name || 'Макрос' }));
}
function opTimers() {
  return { list: (lib.timers || []).map((t) => { const r = stRun[t.id] || {}; return { id: t.id, name: t.name, mode: t.mode || 'down', dur: t.dur || 0, at: t.at || '', run: !!r.run, base: r.base || 0, t0: r.at || 0 }; }), now: Date.now() };
}
function opPlates() {
  return { list: ltList().map((p) => ({ id: p.id, name: p.name || p.title || 'Плашка', sub: p.title || '' })), live: ltLiveId() };
}
function opPool() {
  const f = (settings.poolFolders || []).map((p) => ({ path: p, name: baseName(p) }));
  if (settings.musicRoot && !f.some((x) => x.path === settings.musicRoot)) f.push({ path: settings.musicRoot, name: baseName(settings.musicRoot), music: true });
  return { folders: f };
}
const opRoots = () => [...(settings.poolFolders || []), ...(settings.musicRoot ? [settings.musicRoot] : [])];

/* ----- Поиск (лупа на пульте): презентации и песни, файлы медиапула и музыки, место Писания ----- */
const opNorm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
let opFileIdx = { at: 0, key: '', files: [] };
let opFileIdxP = null;
// Все файлы закреплённых папок (с подпапками): обход раз в минуту, не больше 400 папок и 20000 файлов
function opPoolIndex() {
  const key = opRoots().join('|');
  if (opFileIdx.key === key && Date.now() - opFileIdx.at < 60000) return Promise.resolve(opFileIdx.files);
  if (opFileIdxP) return opFileIdxP;
  opFileIdxP = (async () => {
    const files = [];
    const q = [...opRoots()];
    const seen = new Set();
    let dirs = 0;
    while (q.length && dirs < 400 && files.length < 20000) {
      const d = q.shift();
      if (seen.has(d)) continue;
      seen.add(d);
      dirs++;
      let r;
      try { r = await window.api.poolList(d); } catch { continue; }
      if (!r || !r.ok) continue;
      for (const x of r.dirs || []) q.push(x.path);
      for (const f of r.files || []) if (['image', 'video', 'audio'].includes(f.type)) files.push({ ...f, n: opNorm(f.name), dir: d });
    }
    opFileIdx = { at: Date.now(), key, files };
    return files;
  })().finally(() => { opFileIdxP = null; });
  return opFileIdxP;
}
// Где открыть презентацию: первая библиотека, где она есть (иначе плейлист)
function opWhere(id) {
  for (const l of lib.libraries) if (l.items.includes(id)) { const v = keyView('lib:' + l.id); const e = v && viewEntries(v).find((x) => x.item.id === id); if (e) return { vk: 'lib:' + l.id, key: e.key, list: l.name }; }
  for (const p of lib.playlists) { const v = keyView('pl:' + p.id); const e = v && viewEntries(v).find((x) => x.item.id === id); if (e) return { vk: 'pl:' + p.id, key: e.key, list: p.name }; }
  return null;
}
async function opSearch(q0) {
  const q = opNorm(q0).trim().slice(0, 80);
  if (!q) return { items: [], files: [] };
  const words = q.split(/\s+/).filter(Boolean);
  const has = (s) => { const n = opNorm(s); return words.every((w) => n.includes(w)); };
  const byName = [];
  const byText = [];
  for (const it of Object.values(lib.items)) {
    if (!it || !Array.isArray(it.slides)) continue;
    if (has(it.name) || (it.number && String(it.number) === q)) { byName.push({ it }); continue; }
    if (byText.length >= 40) continue;
    const src = it.song && it.song.text ? [it.song.text] : it.slides.map((s) => s.text || '');
    const line = src.join('\n').split('\n').find((l) => has(l));
    if (line) byText.push({ it, hit: line.trim().slice(0, 120) });
  }
  const items = [...byName.slice(0, 40), ...byText].slice(0, 60).map(({ it, hit }) => ({ id: it.id, name: it.name, kind: it.kind || '', n: it.slides.length, hit: hit || '', at: opWhere(it.id) })).filter((x) => x.at);
  const all = await opPoolIndex();
  const files = all.filter((f) => words.every((w) => f.n.includes(w))).slice(0, 60).map((f) => ({ name: f.name, path: f.path, url: f.url, type: f.type, dir: baseName(f.dir) }));
  let ref = '';
  if (bible) {
    try {
      const r = oneChapterFix(Bible.parseRef(String(q0).slice(0, 80)));
      const bi = r ? Bible.findBook(bible, r.token) : -1;
      if (bi >= 0 && bible.books[bi].chapters[r.ch - 1]) ref = `${bible.books[bi].name} ${r.ch}${r.v1 ? ':' + r.v1 + (r.v2 > r.v1 ? '-' + r.v2 : '') : ''}`;
    } catch { /* не место Писания */ }
  }
  return { items, files, ref };
}

function opTick() {
  if (!opWantOn || typeof lib === 'undefined' || !lib) return;
  const st = {};
  const put = (k, fn) => {
    let v;
    try { v = fn(); } catch { return; }
    const s = JSON.stringify(v);
    if (opSent[k] === s) return;
    opSent[k] = s;
    st[k] = v;
  };
  // Списки — только когда библиотеку сохранили или открыли другой список
  const lk = workKey() + '|' + viewKey();
  if (histCur !== opListsHist || lk !== opListsKey) {
    if (histCur !== opListsHist && opListsHist) opRev++;
    opListsHist = histCur;
    opListsKey = lk;
    put('lists', opLists);
  }
  put('live', opLiveSec);
  put('bible', opBibleSec);
  put('macros', opMacros);
  put('timers', opTimers);
  put('stage', () => ({ msg: stMsg.text || '' }));
  put('plates', opPlates);
  put('pool', opPool);
  put('player', opPlayer);
  if (Object.keys(st).length) window.api.teamOpState(st).catch(() => {});
}
setInterval(opTick, 250);

/* ----- Команды ----- */

const opErr = (text) => ({ err: text });
function opBook(bi) { return bible && bible.books[bi] ? bible.books[bi] : null; }
function opShowVerses(bi, ci, v1, v2) {
  const book = opBook(bi);
  const ch = book && book.chapters[ci];
  if (!ch || !ch[v1 - 1]) return opErr('Такого стиха нет в этом переводе');
  openChapter(bi, ci);
  anchor = { pane: 'main', bi, ci, v: v1 };
  showVerses(bi, ci, v1, Math.max(v1, Math.min(v2 || v1, ch.length)));
  scrollToVerse(v1);
  return { ok: true, ref: `${book.name} ${ci + 1}:${v1}${v2 > v1 ? '-' + v2 : ''}` };
}

async function opDo(a, x, who) {
  if (typeof lib === 'undefined' || !lib) return opErr('Программа ещё загружается');
  const by = `Планшет${who ? ` (${who})` : ''}`;
  switch (a) {
    case 'view': {
      const v = keyView(String(x.vk || ''));
      const list = v && findView(v);
      if (!list) return opErr('Такого списка уже нет');
      return { vk: viewKey(v), name: list.name, kind: v.kind,
        entries: viewEntries(v).map((e) => ({ key: e.key, id: e.item.id, name: e.item.name, kind: e.item.kind || '', n: e.item.slides.length, ver: opVer(e.item.id) })) };
    }
    case 'item': {
      const item = lib.items[String(x.id || '')];
      if (!item) return opErr('Такой презентации уже нет');
      if (x.have && x.have === opVer(item.id)) return { same: true, ver: x.have };
      return { ...opItemPay(item), size: outputSize() };
    }
    case 'items': {
      const have = x.have && typeof x.have === 'object' ? x.have : {};
      const items = {};
      for (const id of (Array.isArray(x.ids) ? x.ids : []).slice(0, 80)) {
        const item = lib.items[String(id)];
        if (!item) { items[id] = { gone: true }; continue; }
        const ver = opVer(item.id);
        items[id] = have[id] === ver ? { same: true, ver } : opItemPay(item);
      }
      return { items, size: outputSize() };
    }
    case 'show': {
      const vk = String(x.vk || '');
      const e = entryByKey(String(x.key || ''), keyView(vk));
      if (!e || !e.item.slides.some((s) => s.id === x.sid)) return opErr('Этого слайда уже нет');
      if (vk === workKey()) { sel = [{ key: e.key, sid: x.sid }]; selAnchor = sel[0]; }
      showSlide(e.key, String(x.sid), vk);
      return { ok: true };
    }
    case 'open': { // сделать список рабочим (в ленте программы)
      const v = keyView(String(x.vk || ''));
      if (!v || !findView(v)) return opErr('Такого списка уже нет');
      setView(v.kind, v.id);
      work = { ...v };
      openKey = null;
      renderService();
      flashStatus(`${by}: открыт «${findView(v).name}»`);
      return { ok: true };
    }
    case 'step': grStep(Number(x.d) < 0 ? -1 : 1); return { ok: true };
    case 'item.step': plJumpItem(Number(x.d) < 0 ? -1 : 1); return { ok: true };
    case 'clear': {
      const w = String(x.what || '');
      if (w === 'all') { clearScreen(); flashStatus(`${by}: экран очищен`); }
      else if (['pres', 'media', 'source', 'overlay', 'lower'].includes(w)) clearKind(w);
      else if (w === 'layer' && layerOn[x.id]) clearLayer(String(x.id));
      else return opErr('Нечего убирать');
      return { ok: true };
    }
    case 'layer.play': if (!layerOn[x.id]) return opErr('Слой пуст'); layerPlay(String(x.id), !!x.play); return { ok: true };
    case 'out': {
      const g = x.g === 'stage' ? 'stage' : 'hall';
      if (!outGroupMembers(g).length) return opErr(g === 'hall' ? 'Нет экранов в группе «Зал» (Редактор сцен)' : 'Нет сцен в группе «Сцена» (Редактор сцен)');
      outGroupSet(g, !!x.on);
      return { ok: true };
    }
    // Стоп-кадр в зале (renderer.js: frzSet) — включить и отменить, в том числе включённый с телефона по QR
    case 'freeze': await frzSet(!!x.on, 'op'); return { ok: true };
    case 'bible.set': {
      if (!bibleIndex.some((b) => b.id === x.id)) return opErr('Такого перевода нет');
      await selectBible(String(x.id));
      return { ok: true };
    }
    case 'bible.ref': {
      if (!bible) return opErr('Библия не загружена — добавьте перевод в программе');
      const r = oneChapterFix(Bible.parseRef(String(x.text || '').slice(0, 80)));
      if (!r) return opErr('Не понял место. Пример: Ин 3:16 или 1 Кор 13:4-7');
      const bi = Bible.findBook(bible, r.token);
      if (bi < 0) return opErr(`Книга «${r.token}» не найдена в этом переводе`);
      const ch = bible.books[bi].chapters[r.ch - 1];
      if (!ch || !ch.length) return opErr(`В книге «${bible.books[bi].name}» нет главы ${r.ch}`);
      if (!r.v1) { openChapter(bi, r.ch - 1); return { ok: true, bi, ci: r.ch - 1, open: true }; }
      return { ...opShowVerses(bi, r.ch - 1, r.v1, r.v2), bi, ci: r.ch - 1 };
    }
    case 'bible.books':
      if (!bible) return opErr('Библия не загружена');
      return { id: bible.id, books: bible.books.map((b, bi) => ({ bi, name: b.name, n: b.chapters.length, o: bookOrd(bi) })).sort((p, q) => p.o - q.o) };
    case 'bible.chapter': {
      const book = opBook(Number(x.bi));
      const ch = book && book.chapters[Number(x.ci)];
      if (!ch) return opErr('Такой главы нет');
      return { id: bible.id, bi: Number(x.bi), ci: Number(x.ci), name: `${book.name} ${Number(x.ci) + 1}`, n: book.chapters.length, verses: ch.map((t) => t || '') };
    }
    case 'bible.verse': return opShowVerses(Number(x.bi), Number(x.ci), Number(x.v1), Number(x.v2) || Number(x.v1));
    case 'bible.step': bibleStep(Number(x.d) < 0 ? -1 : 1); return { ok: true };
    case 'bible.search': {
      if (!bible) return opErr('Библия не загружена');
      const q = String(x.q || '').trim().slice(0, 100);
      if (!q) return { results: [] };
      const { results, more } = Bible.search(bible, q, 'all', 80);
      return { more, results: results.slice(0, 80).map((r) => ({ bi: r.bi, ci: r.ci, v: r.v, ref: `${bible.books[r.bi].name} ${r.ci + 1}:${r.v}`, text: String(r.text || '').slice(0, 300) })) };
    }
    case 'macro': {
      const m = (lib.macros || []).find((y) => y.id === x.id);
      if (!m) return opErr('Такого макроса уже нет');
      mcRunManual(m, false);
      flashStatus(`${by}: макрос «${m.name}»`);
      return { ok: true };
    }
    case 'timer': {
      const t = stTimer(String(x.id || ''));
      if (!t) return opErr('Такого таймера уже нет');
      const op = String(x.op || '');
      if (op === 'toggle') stToggle(t.id);
      else if (op === 'reset') stReset(t.id, !!x.start);
      else if (op === 'dur') {
        const d = stParseDur(x.v);
        if (d == null || d <= 0) return opErr('Не понял время. Пример: 5 или 4:30');
        tmSet(t, { dur: d });
        if (!(stRun[t.id] || {}).run) stReset(t.id);
      } else return opErr('Неизвестная команда таймера');
      return { ok: true };
    }
    case 'stage.msg': stSetMsg(String(x.text || '').slice(0, 300)); return { ok: true };
    case 'plate': {
      if (!x.id) { ltHide(); return { ok: true }; }
      const p = ltList().find((y) => y.id === x.id);
      if (!p) return opErr('Такой плашки уже нет');
      ltShow(p);
      return { ok: true };
    }
    case 'pool.list': {
      const dir = String(x.dir || '');
      const roots = opRoots();
      const norm = (p) => p.replace(/[\\/]+$/, '').toLowerCase();
      // Только закреплённые папки медиапула и их подпапки
      if (!opRoots().some((r) => norm(dir) === norm(r) || norm(dir).startsWith(norm(r) + '\\') || norm(dir).startsWith(norm(r) + '/'))) return opErr('Эта папка не закреплена в медиапуле');
      if (/(^|[\\/])\.\.([\\/]|$)/.test(dir)) return opErr('Эта папка не закреплена в медиапуле');
      const r = await window.api.poolList(dir);
      if (!r.ok) return opErr('Не удалось открыть папку: ' + (r.error || ''));
      const up = roots.some((f) => norm(f) === norm(dir)) ? '' : parentDir(dir);
      return { dir, name: baseName(dir), up, dirs: r.dirs.map((d) => ({ name: d.name, path: d.path })), files: r.files.filter((f) => ['image', 'video', 'audio'].includes(f.type)) };
    }
    case 'pool.show': {
      const f = x.file;
      if (!f || !f.url) return opErr('Файла уже нет');
      poolShow(f);
      return { ok: true };
    }
    case 'slide.text': {
      const item = lib.items[String(x.id || '')];
      const s = item && item.slides.find((z) => z.id === x.sid);
      if (!s || s.k !== 'text') return opErr('Этот слайд нельзя править текстом');
      const text = String(x.text == null ? '' : x.text).slice(0, 20000);
      if (s.text === text) return { ok: true };
      s.text = text;
      touched(item);
      renderService();
      if (plShown && plShown.sid === s.id) { const e = entryByKey(plShown.key, keyView(plShown.view)); if (e && e.item === item) showSlide(plShown.key, s.id, plShown.view); }
      flashStatus(`${by}: текст слайда в «${item.name}» изменён (Ctrl+Z — вернуть)`, true);
      return { ok: true, ver: opVer(item.id) };
    }
    case 'undo': libUndo(); return { ok: true };
    case 'search': return opSearch(x.q);
    // Проигрыватель: which 'v' — видео на экране, иначе музыка
    case 'player.play': {
      if (x.which === 'v') { if (!pv) return opErr('Видео на экране нет'); videoCtl(pv.paused ? 'play' : 'pause'); return { ok: true }; }
      if (!curSong()) { musicStep(1); return { ok: true }; }
      if (audio.paused) { gain = 1; applyVol(); audio.play().catch(() => {}); } else pauseMusic();
      return { ok: true };
    }
    case 'player.stop':
      if (x.which === 'v') { if (pv) { videoCtl('pause'); videoCtl('seek', 0); } } else stopMusic();
      return { ok: true };
    case 'player.step': musicStep(Number(x.d) < 0 ? -1 : 1); return { ok: true };
    case 'player.seek': {
      const t = Math.max(0, Number(x.t) || 0);
      if (x.which === 'v') { if (pv) videoCtl('seek', t); } else if (curSong()) audio.currentTime = t;
      return { ok: true };
    }
    case 'player.vol': {
      const v = Math.max(0, Math.min(100, Number(x.v) || 0)) / 100;
      if (x.which === 'v') { settings.videoMute = false; videoCtl('volume', v); } else { settings.musicMute = false; settings.musicVol = v; applyVol(); updateAudioUi(); }
      clearTimeout(opVolSave);
      opVolSave = setTimeout(saveSettings, 800);
      return { ok: true };
    }
    case 'player.mute':
      if (x.which === 'v') { settings.videoMute = !settings.videoMute; sendVideoAudio(); } else { settings.musicMute = !settings.musicMute; applyVol(); }
      saveSettings();
      updateAudioUi();
      return { ok: true };
    case 'player.list': { // песни: того, что играет (id пусто), или плейлиста музыки
      const l = x.id ? (musicLists || []).find((y) => y.id === x.id) : null;
      if (x.id && !l) return opErr('Такого плейлиста музыки уже нет');
      const list = l ? l.tracks : playList || tracks;
      return { id: l ? l.id : '', name: l ? l.name : 'Сейчас играет', cur: !l || list === playList ? curTrack : -1, tracks: list.slice(0, 500).map((s) => s.name || '') };
    }
    case 'player.track': {
      const l = x.id ? (musicLists || []).find((y) => y.id === x.id) : null;
      const list = l ? l.tracks : playList || tracks;
      const i = Number(x.i);
      if (!list[i]) return opErr('Такой песни уже нет');
      playTrack(i, list);
      return { ok: true };
    }
    default: return opErr('Неизвестная команда');
  }
}

window.api.onTeamOp(async (c) => {
  if (!c) return;
  let res;
  try { res = await opDo(String(c.a || ''), c.x && typeof c.x === 'object' ? c.x : {}, c.who); } catch (e) { res = { err: (e && e.message) || 'Ошибка в программе' }; }
  window.api.teamOpDone({ rid: c.rid, res }).catch(() => {});
  // Результат — планшету сразу, не ждать следующего круга
  if (!['view', 'item', 'items', 'bible.books', 'bible.chapter', 'bible.search', 'pool.list', 'search', 'player.list'].includes(c.a)) { opTick(); setTimeout(opTick, 60); }
});
