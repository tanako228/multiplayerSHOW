/* Ноты песни и «Поделиться» аккордами и нотами (приложение группы).
   Ноты — листы-картинки из программы (песня: sheets = [{ f, name, w, h }]; программа делает их из фото и PDF, main.js).
   Листы качаются после синхронизации в IndexedDB (sheets) — открываются и без сети. Кнопка «Ноты» — в начале песни.
   С правом «Может править аккорды и ноты» — добавить фото/PDF (фото сжимаем тут, PDF разбирает программа) и убрать лист.
   Поделиться (то же право) — файл .txt: сверху аккорды текстом (его видно в любом чате), ниже строка MPS-DATA и данные:
   аккорды, тональность, текст песни, листы нот (base64). Получатель открывает файл в приложении («…» → «Открыть файл
   с аккордами и нотами», на Android — «Поделиться» → «MP Группа»). Аккорды ложатся на ЕГО текст песни (Chords.align):
   с правом — в его программу, без права — только у него на телефоне (got: { id песни, chords, key, who, sheets }).
   Такой песни нет — можно просто посмотреть. Общие функции ($, el, toast, ask, cur, canChords, plainOf, openSong,
   openView, runSync, shareFile) — из app.js. */
'use strict';
const Sheets = (() => {
  const MARK = '--- MPS-DATA ---';
  const MAX_PX = 2400;
  const urls = new Map(); // ключ листа → objectURL
  let got = new Map();    // id песни → запись got
  let cv = null;          // песня в окне нот
  let zoom = 1;
  let busy = false;
  let inc = null;         // открытый файл: { who, song: { name, key, tempo, time, ccli, chords, text }, sheets: [{ name, type, data }] }
  let tgt = null;         // песня, на которую накладываем
  let tgtChords = '';

  const canEdit = () => !!(Store.me && Store.me.perms && Store.me.perms.chords);
  const b64 = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
  const fromB64 = (s) => { const t = atob(s); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u.buffer; };

  async function init() {
    try { got = new Map((await Store.allRec('got')).map((r) => [r.id, r])); } catch { got = new Map(); }
  }

  /* ----- Листы программы: скачать, хранить, показать ----- */

  async function fetchSheet(f) {
    let r;
    try { r = await fetch('/api/v1/sheets/' + encodeURIComponent(f), { cache: 'no-store', headers: { Authorization: 'Bearer ' + Store.token } }); } catch { throw new Error('Лист ещё не скачан — нужна связь с программой'); }
    if (!r.ok) throw new Error(r.status === 404 ? 'Этого листа в программе уже нет' : 'Лист нот не скачался (' + r.status + ')');
    const rec = { id: f, type: r.headers.get('Content-Type') || 'image/jpeg', buf: await r.arrayBuffer() };
    await Store.putRec('sheets', rec).catch(() => { /* мало места — покажем и так */ });
    return rec;
  }
  async function recOf(f) { return (await Store.getRec('sheets', f).catch(() => null)) || fetchSheet(f); }
  async function urlOf(x) {
    if (urls.has(x.key)) return urls.get(x.key);
    const r = x.rec || await recOf(x.f);
    const u = URL.createObjectURL(new Blob([r.buf], { type: r.type }));
    urls.set(x.key, u);
    return u;
  }
  // После синхронизации: скачать листы, которых нет на телефоне; листы убранных песен — стереть
  let pre = false;
  async function prefetch() {
    if (pre || !Store.token) return;
    pre = true;
    try {
      const need = new Set();
      for (const s of Store.songs.values()) for (const x of s.sheets || []) need.add(x.f);
      const have = new Set(await Store.allKeys('sheets'));
      // листы, на которые ссылается правка без связи (пришли в файле), — не стирать, пока она не ушла
      const keep = new Set(need);
      for (const r of got.values()) for (const [k, a] of (r.ed && r.ed.sh) || []) if (k === 'f') keep.add(a);
      for (const f of have) if (!keep.has(f)) await Store.delRec('sheets', f).catch(() => {});
      for (const f of need) if (!have.has(f)) { try { await fetchSheet(f); } catch { break; } } // нет связи — в другой раз
    } catch { /* хранилище недоступно */ } finally { pre = false; }
  }

  // Листы песни: из программы, из чужого файла (got), из файла «только посмотреть» (tmp)
  function list(v) {
    // Правка без связи — список листов целиком (как у того, кто правил)
    const g = v.got;
    if (g && g.ed && g.ed.sh) {
      return g.ed.sh.map(([k, a, name]) => {
        if (k === 'f') return { key: a, f: a, name, own: 'prog' };
        const x = (g.sheets || []).find((y) => y.h === a);
        return x ? { key: x.f, name, own: 'got', rec: x } : null;
      }).filter(Boolean);
    }
    const out = [];
    for (const x of ((v.base || v.src || {}).sheets || [])) out.push({ key: x.f, f: x.f, name: x.name, own: 'prog' });
    for (const x of (v.got && v.got.sheets) || []) out.push({ key: x.f, name: x.name, own: 'got', rec: x });
    for (const x of v.tmpSheets || []) out.push({ key: x.f, name: x.name, own: 'tmp', rec: x });
    return out;
  }

  // В начале песни: «Аккорды и ноты из файла от …» и кнопка «Ноты»
  function bar(v, body) {
    if (v.got) {
      const b = el('div', 'gotbar');
      const g = v.got;
      b.append(el('span', '', g.ed && !g.mine ? `Правка от ${g.who || '?'} — уйдёт в программу, когда телефон подключится`
        : g.pend ? 'Ваша правка без связи — уйдёт в программу, когда телефон подключится'
          : g.who ? `Аккорды и ноты из файла от ${g.who}` : 'Аккорды и ноты из файла'));
      const x = el('button', '', g.pend ? 'Отменить правку' : 'Убрать');
      x.onclick = () => dropGot(v.id);
      b.append(x);
      body.append(b);
    }
    const n = list(v).length;
    if (!n && !(canEdit() && (online() || canSign()) && v.id && !v.tmp)) return;
    const b = el('button', 'shbtn' + (n ? '' : ' add'), n ? `Ноты · листов: ${n}` : '＋ Добавить ноты');
    b.type = 'button';
    b.onclick = () => open(v);
    body.append(b);
  }
  async function dropGot(id) {
    const g = got.get(id);
    if (g && g.pend ? !(await ask('Отменить правку без связи? Останется версия из программы.', 'Отменить правку'))
      : !(await ask('Убрать аккорды и ноты из файла? Останется то, что пришло из программы.', 'Убрать'))) return;
    await Store.delRec('got', id).catch(() => {});
    got.delete(id);
    for (const x of (g && g.sheets) || []) { const u = urls.get(x.f); if (u) { URL.revokeObjectURL(u); urls.delete(x.f); } }
    window.renderExt && window.renderExt();
    if (cur && cur.id === id) reopen(id);
  }
  function reopen(id) {
    const y = window.scrollY;
    if (openSong(id, false, { pl: cur.pl, eid: cur.eid, key: cur.key })) { window.scrollTo(0, y); markLive(false); }
  }

  /* ----- Окно «Ноты» ----- */

  function open(v, fs) {
    cv = v;
    zoom = 1;
    pg = 0;
    fsOn = !!fs && list(v).length > 0;
    $('shDlg').classList.toggle('fs', fsOn);
    paint();
    if (!$('shDlg').open) $('shDlg').showModal();
    if (fsOn) showBar(2800);
  }
  // Пианист: песня с нотами сразу открывается нотами на весь экран (текст и аккорды — «выйти» из полного экрана)
  function auto(v) {
    if (!v || !v.song || !Store.me || !Store.me.person || Store.me.person.role !== 'pianist' || $('shDlg').open || !list(v).length) return;
    open(v, true);
  }

  /* ----- Полный экран: один лист на экране, листание свайпом и касанием краёв ----- */

  let fsOn = false;
  let pg = 0;
  let fsTok = 0;
  let barT = 0;
  const fit = () => { try { return localStorage.getItem('mps.sheetFit') === 'width' ? 'width' : 'page'; } catch { return 'page'; } };
  function showBar(ms) {
    const b = $('shFsBar');
    b.classList.remove('off');
    clearTimeout(barT);
    if (ms) barT = setTimeout(() => b.classList.add('off'), ms);
  }
  function setFs(on) {
    fsOn = !!on && !!cv && list(cv).length > 0;
    $('shDlg').classList.toggle('fs', fsOn);
    if (!fsOn) TouchKit.fsExit();
    paint();
    if (fsOn) showBar(2800);
  }
  function paintFs() {
    const items = list(cv);
    if (!items.length) { setFs(false); return; }
    pg = Math.max(0, Math.min(pg, items.length - 1));
    const st = $('shStage');
    st.className = 'sh-stage ' + fit();
    $('shFit').textContent = fit() === 'width' ? 'Вся страница' : 'По ширине';
    paintFull();
    $('shPg').textContent = `${pg + 1} / ${items.length}`;
    const img = $('shImg');
    const my = ++fsTok;
    img.alt = items[pg].name;
    urlOf(items[pg]).then((u) => { if (my === fsTok) img.src = u; }).catch((e) => toast(e.message || 'Лист не открылся'));
    st.scrollTop = 0;
    if (items[pg + 1]) urlOf(items[pg + 1]).catch(() => {});
  }
  function go(d) {
    const n = list(cv).length;
    const p = pg + d;
    if (p < 0 || p >= n) { showBar(1200); return; } // край — просто показать, где мы
    pg = p;
    paintFs();
    showBar(1200);
  }
  // Кнопка «Весь экран»: есть только там, где браузер умеет (iPhone — нет; iPad до 16.4 — с приставкой webkit, touch.js).
  // Во весь экран — блок нот внутри окна (.sh-fs), а не <html>: окно <dialog> в верхнем слое, и <html> под ним
  // в Safari / Chrome то не разворачивался, то закрывал ноты — нажимали второй раз
  const fsBox = () => document.querySelector('#shDlg .sh-fs');
  function paintFull() {
    const b = $('shFull');
    b.hidden = !TouchKit.fsCan(fsBox());
    b.textContent = TouchKit.fsElement() ? 'Обычный экран' : 'Весь экран';
  }
  function toggleFull() {
    // Сразу, в самом обработчике нажатия: после await/таймера Safari уже не считает это нажатием
    if (TouchKit.fsElement()) TouchKit.fsExit();
    else TouchKit.fsEnter(fsBox()).catch(() => toast('Этот телефон не пускает во весь экран'));
    showBar(2800);
  }
  // Свайп/касание. Решает направление движения, а не точность линии: уверенный горизонтальный жест листает, даже кривой.
  let tp = null;
  function wireFs() {
    const st = $('shStage');
    st.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      if (tp) { tp.multi = true; return; }
      tp = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), max: 0, multi: false };
      // Отпустят над панелью или за краем — pointerup всё равно придёт сюда. Раньше tp оставался «висеть»,
      // и все следующие касания считались вторым пальцем: панель с кнопками больше не появлялась
      try { st.setPointerCapture(e.pointerId); } catch { /* уже */ }
    });
    st.addEventListener('pointermove', (e) => {
      if (tp && e.pointerId === tp.id) tp.max = Math.max(tp.max, Math.abs(e.clientX - tp.x), Math.abs(e.clientY - tp.y));
    });
    const end = (e, cancel) => {
      if (!tp || e.pointerId !== tp.id) return;
      const s = tp;
      tp = null;
      if (cancel || s.multi) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const quick = Date.now() - s.t < 400;
      if (ax >= (quick ? 28 : 56) && ax > ay * 0.8) { go(dx < 0 ? 1 : -1); return; } // горизонтальный жест, пусть и кривой
      if (s.max < 12) { // касание: края листают, середина — показать/спрятать кнопки
        const w = st.clientWidth || 1;
        const r = (e.clientX - st.getBoundingClientRect().left) / w;
        if (r < 0.3) go(-1); else if (r > 0.7) go(1); else if ($('shFsBar').classList.contains('off')) showBar(0); else showBar(1);
      }
    };
    st.addEventListener('pointerup', (e) => end(e, false));
    st.addEventListener('pointercancel', (e) => end(e, true));
    // Подстраховка: касание кончилось, а сюда не дошло (захват не сработал) — забыть его
    st.addEventListener('lostpointercapture', (e) => { if (tp && e.pointerId === tp.id) tp = null; });
    $('shFsExit').onclick = () => $('shDlg').close();
    $('shFit').onclick = () => { try { localStorage.setItem('mps.sheetFit', fit() === 'width' ? 'page' : 'width'); } catch { /* нет доступа */ } paintFs(); showBar(2800); };
    $('shFull').onclick = toggleFull;
    // Отказ: у стандартного API о нём скажет обещание (toggleFull), у webkit-приставки обещания нет — только событие
    const noPromise = !(fsBox() && typeof fsBox().requestFullscreen === 'function');
    TouchKit.fsListen(() => { paintFull(); if (fsOn) showBar(2800); }, () => { paintFull(); if (noPromise) toast('Этот телефон не пускает во весь экран'); });
    $('shFsOn').onclick = () => setFs(true);
    $('shDlg').addEventListener('close', () => { fsOn = false; tp = null; $('shDlg').classList.remove('fs'); TouchKit.fsExit(); });
    $('shDlg').addEventListener('keydown', (e) => {
      if (!fsOn || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.code;
      if (['ArrowRight', 'ArrowDown', 'PageDown', 'Space', 'Enter'].includes(k)) { e.preventDefault(); go(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); go(-1); }
    });
  }

  function paint() {
    const v = cv;
    if (!v) return;
    if (fsOn) { paintFs(); return; }
    const items = list(v);
    const off = !online();
    const edit = canChords() && (!off || canSign()) && !!v.id && !v.tmp && Store.songs.has(v.id);
    $('shTitle').textContent = v.name;
    $('shAdd').hidden = !edit;
    $('shShare').hidden = !canShare(v);
    $('shFsOn').hidden = !items.length;
    $('shZoom').textContent = Math.round(zoom * 100) + '%';
    const box = $('shBody');
    box.style.setProperty('--shz', String(zoom));
    box.replaceChildren();
    if (!items.length) {
      box.append(el('p', 'hint', !edit ? 'У этой песни нет нот.' : off ? 'У песни нет нот. Без связи можно добавить фото нот — они уйдут в программу, когда телефон подключится.'
        : 'У песни нет нот. Добавьте фото или PDF — их увидит вся группа, и без сети тоже.'));
      return;
    }
    for (const x of items) {
      const fig = el('figure', 'shp');
      const img = el('img');
      img.alt = x.name;
      fig.append(img);
      const cap = el('figcaption');
      const nm = el('span', '', x.name);
      nm.dataset.noi18n = '';
      cap.append(nm);
      if (x.own === 'got') cap.append(el('i', '', 'из файла'));
      if (edit && (x.own === 'prog' || (off && x.own === 'got' && v.got && v.got.ed))) {
        const del = el('button', 'danger', 'Убрать');
        del.type = 'button';
        del.onclick = () => delSheet(x);
        cap.append(del);
      }
      fig.append(cap);
      box.append(fig);
      urlOf(x).then((u) => { img.src = u; }).catch((e) => { img.replaceWith(el('p', 'hint', e.message)); });
    }
  }
  function setZoom(z) {
    zoom = Math.max(1, Math.min(4, Math.round(z * 4) / 4));
    $('shBody').style.setProperty('--shz', String(zoom));
    $('shZoom').textContent = Math.round(zoom * 100) + '%';
  }
  // После записи в программу: докачать песню и листы, показать заново
  async function afterSave(id) {
    await runSync();
    await prefetch();
    if (cur && cur.id === id && cur.base !== Store.songs.get(id)) reopen(id);
    if ($('shDlg').open && cur && cur.id === id) { cv = cur; paint(); }
  }

  // Фото → JPEG не больше 2400 px (телефонные снимки по 5–10 МБ; программе хватит и так)
  function toJpeg(file) {
    return new Promise((ok, no) => {
      const u = URL.createObjectURL(file);
      const i = new Image();
      i.onload = () => {
        URL.revokeObjectURL(u);
        const k = Math.min(1, MAX_PX / Math.max(i.naturalWidth, i.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(i.naturalWidth * k));
        c.height = Math.max(1, Math.round(i.naturalHeight * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(i, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', 0.86).split(',')[1]);
      };
      i.onerror = () => { URL.revokeObjectURL(u); no(new Error(`«${file.name}» не открылось — подходят фото (JPEG, PNG) и PDF`)); };
      i.src = u;
    });
  }
  async function addFiles(files) {
    const v = cv;
    if (!v || !v.id || busy || !files.length) return;
    if (!canChords()) { toast('Право править ноты снято — ноты не добавлены'); return; }
    if (!online()) { await addOffline(v, files); return; }
    busy = true;
    $('shAdd').disabled = true;
    let n = 0;
    let lost = false;
    try {
      for (const f of files) {
        const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        if (f.size > 30e6) { toast(`«${f.name}» больше 30 МБ — не отправлен`); continue; }
        toast(pdf ? `Отправляю «${f.name}» — страницы разберёт программа…` : 'Отправляю фото…');
        const data = pdf ? await b64(f) : await toJpeg(f);
        await Store.api('/songs/sheets', { method: 'POST', body: { id: v.id, add: { name: f.name.replace(/\.[^.]+$/, ''), data } }, timeout: 240000 });
        n++;
      }
    } catch (e) {
      lost = e.code === 'net';
      if (!lost) toast(e.message || 'Ноты не отправлены');
    } finally {
      busy = false;
      $('shAdd').disabled = false;
    }
    if (n) { toast('Ноты сохранены в программе'); await afterSave(v.id); }
    // связь пропала посреди отправки — остальное сохранить на телефоне, уйдёт при подключении
    if (lost) await addOffline(v, files.slice(n));
  }
  async function delSheet(x) {
    const v = cv;
    if (!v || busy) return;
    if (!(await ask(`Убрать лист «${x.name}» из песни у всей группы? В программе Ctrl+Z вернёт.`, 'Убрать'))) return;
    if (!online()) {
      try { await myEdit(v.id, { del: x.key }); } catch (e) { toast(e.message || 'Не получилось'); return; }
      toast('Лист убран у вас — у группы уберётся, когда телефон подключится к программе');
      afterOffline(v.id);
      return;
    }
    busy = true;
    try {
      await Store.api('/songs/sheets', { method: 'POST', body: { id: v.id, del: x.f } });
      toast('Лист убран');
    } catch (e) { toast(e.message || 'Не получилось убрать лист'); busy = false; return; }
    busy = false;
    await afterSave(v.id);
  }

  /* ----- Правка без связи: подпись ключом из программы (Store.me.ek), отправка после синхронизации (flush) -----
     got-запись { id, ed, edl, pend: true, mine, who, name, song, at, chords, key, sheets: [{ f, h, name, type, buf }] }:
     ed — правка целиком (аккорды, тональность, все листы: ['f', файл программы, имя] / ['h', sha256, имя] — байты в sheets),
     edl — то же без листов (sh: null) для ссылки. Донести до программы может любой телефон группы — подпись проверит она. */

  const canSign = () => canEdit() && !!(Store.me.ek && Store.me.person && Store.me.person.id && Store.meta.lib);
  const sign = (e) => ({ ...e, sig: Sig.hmac(Store.me.ek, Sig.editMsg(e)) });
  const rank = (e) => e.at * 2 + (e.sh ? 1 : 0);
  // Правка от себя: то, что сейчас видно у песни, плюс изменение ch: { chords } | { add: [{ name, type, buf }] } | { del: ключ листа }.
  // at — время правки (часы программы); 0 — «как в программе» (поделиться без своих правок)
  function makeEdit(v, ch, at) {
    const src = v.src || {};
    const t = Date.now().toString(36);
    const sheets = [];
    const sh = [];
    for (const x of list(v)) {
      if (ch.del && x.key === ch.del) continue;
      if (x.own === 'prog') { sh.push(['f', x.f, x.name]); continue; }
      const r = x.rec;
      const h = r.h || Sig.hashBuf(r.buf);
      sh.push(['h', h, x.name]);
      sheets.push({ f: r.f, h, name: x.name, type: r.type || 'image/jpeg', buf: r.buf });
    }
    (ch.add || []).forEach((x, i) => {
      const h = Sig.hashBuf(x.buf);
      sh.push(['h', h, x.name]);
      sheets.push({ f: `g${t}-${i}`, h, name: x.name, type: x.type, buf: x.buf });
    });
    const chords = ch.chords !== undefined ? ch.chords : String(src.chords || '');
    const key = String(src.key || '');
    const base = { v: 1, lib: Store.meta.lib, sid: v.id, at, by: Store.me.person.id, bn: Store.me.person.name, chords, key };
    return { ed: sign({ ...base, sh }), edl: sign({ ...base, sh: null }), chords, key, sheets };
  }
  async function myEdit(id, ch) {
    const s = Store.songs.get(id);
    if (!s) throw new Error('Такой песни на телефоне нет');
    if (!canSign()) throw new Error('Без связи править можно после того, как телефон хоть раз подключится к обновлённой программе');
    const m = makeEdit(songView(s), ch, Math.max(1, Math.round(srvNow())));
    const r = { id, ed: m.ed, edl: m.edl, pend: true, mine: true, who: Store.me.person.name, name: s.name, at: Date.now(), chords: m.chords, key: m.key, sheets: m.sheets };
    try { await Store.putRec('got', r); } catch { throw new Error('Не хватило места на телефоне'); }
    got.set(id, r);
    window.renderExt && window.renderExt();
    return r;
  }
  function afterOffline(id) {
    if (cur && cur.id === id) reopen(id);
    if ($('shDlg').open && cur && cur.id === id) { cv = cur; paint(); }
  }
  // Без связи: фото → JPEG здесь же; PDF разбирает только программа
  async function addOffline(v, files) {
    if (!canSign()) { toast('Без связи ноты добавить нельзя: телефон ещё ни разу не подключался к обновлённой программе'); return; }
    busy = true;
    $('shAdd').disabled = true;
    const add = [];
    try {
      for (const f of files) {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { toast(`PDF без связи не разобрать — добавьте фото нот или PDF, когда телефон будет на связи («${f.name}»)`); continue; }
        if (f.size > 30e6) { toast(`«${f.name}» больше 30 МБ — не добавлен`); continue; }
        add.push({ name: f.name.replace(/\.[^.]+$/, '') || 'Ноты', type: 'image/jpeg', buf: fromB64(await toJpeg(f)) });
      }
      if (!add.length) return;
      await myEdit(v.id, { add });
      toast('Ноты добавлены у вас — группе уйдут, когда телефон подключится к программе');
    } catch (e) {
      toast(e.message || 'Ноты не добавлены');
      return;
    } finally {
      busy = false;
      $('shAdd').disabled = false;
    }
    afterOffline(v.id);
  }
  async function saveMyEdit(id, chords) { return myEdit(id, { chords }); }

  // Пришла правка (файл или ссылка): в «Не синхронизированные»; песня есть — правка видна на ней
  const editLike = (e) => !!e && typeof e.sid === 'string' && e.sid && typeof e.lib === 'string' && Number.isSafeInteger(e.at) && typeof e.by === 'string'
    && typeof e.chords === 'string' && typeof e.key === 'string' && typeof e.sig === 'string' && (e.sh === null || Array.isArray(e.sh));
  const sameProg = (e) => !Store.meta.lib || e.lib === Store.meta.lib;
  async function takeEdit(d) {
    const e = d.edit;
    const id = e.sid;
    const old = got.get(id);
    if (e.at === 0 && Store.songs.has(id)) { toast('Это версия из программы — она уже у вас на телефоне'); openSong(id, true); return; }
    if (old && old.ed && rank(old.ed) >= rank(e)) { toast('Эта правка уже есть на телефоне'); showRec(id); return; }
    const t = Date.now().toString(36);
    const sheets = [];
    for (const [i, x] of d.sheets.entries()) {
      const buf = fromB64(x.data);
      if (x.f) await Store.putRec('sheets', { id: x.f, type: x.type || 'image/jpeg', buf }).catch(() => {}); // лист из программы — в кэш
      else if (x.h) sheets.push({ f: `g${t}-${i}`, h: x.h, name: String(x.name || 'Ноты'), type: x.type || 'image/jpeg', buf });
    }
    const r = { id, ed: e, edl: d.edl || (e.sh === null ? e : null), pend: true, mine: false, who: String(e.bn || d.who || ''), name: d.song.name,
      song: d.song, at: Date.now(), chords: e.chords, key: e.key, sheets };
    try { await Store.putRec('got', r); } catch { toast('Не хватило места на телефоне'); return; }
    got.set(id, r);
    window.renderExt && window.renderExt();
    showRec(id);
    // на связи — сразу в программу (flush сам скажет, что вышло); нет — ждёт в «Не синхронизированные»
    if (online()) flush(true); else toast(`Правка от ${r.who || '?'} — в «Не синхронизированные». Уйдёт в программу, когда телефон подключится`);
  }
  function showRec(id) { if (Store.songs.has(id)) openSong(id, true); else openExt(id); }

  // После синхронизации: правки — в программу. Принята, старая или уже есть — запись убираем (дальше всё придёт из программы)
  let flushing = false;
  // here — правку только что открыли на связи: сказать и тогда, когда она чужая и уже не нужна
  async function flush(here) {
    if (flushing) return;
    const todo = [...got.values()].filter((r) => r.pend && (r.ed || (canEdit() && Store.songs.has(r.id))));
    if (!todo.length) return;
    flushing = true;
    let n = 0;
    let oldMine = 0;
    let already = 0; // та же правка уже в программе (её донёс другой телефон)
    let why = '';
    const gone = [];
    try {
      for (const r of todo) {
        if (r.ed) {
          let e = r.ed;
          const data = {};
          for (const [k, h] of e.sh || []) {
            if (k !== 'h') continue;
            const x = (r.sheets || []).find((y) => y.h === h);
            if (!x) { e = r.edl; break; }
            data[h] = await b64(new Blob([x.buf]));
          }
          if (!e) { gone.push(r.id); continue; }
          const res = await Store.api('/songs/edit', { method: 'POST', body: { e, data: e.sh ? data : {} }, timeout: 240000 });
          if (res.drop) why = why || res.text || '';
          else if (res.applied) n++;
          else if (res.same && (r.mine || here)) already++;
          else if (res.old && (r.mine || here)) oldMine++;
        } else {
          // своя правка аккордов без подписи (телефон ещё не получил ключ) — как обычно
          await Store.api('/songs/chords', { method: 'POST', body: { id: r.id, chords: r.chords, ...(r.key ? { key: r.key } : {}) } });
          await dropPend(r.id);
          n++;
          gone.push(r.id);
          continue;
        }
        await Store.delRec('got', r.id).catch(() => {});
        got.delete(r.id);
        gone.push(r.id);
      }
    } catch (e) {
      if (e.code !== 'net') toast('Правка не ушла в программу: ' + (e.message || e));
    } finally { flushing = false; }
    window.renderExt && window.renderExt();
    if (n) toast(`Правки без связи отправлены в программу: ${n}`);
    else if (already && !oldMine) toast('Эта правка уже в программе');
    else if (oldMine) toast(here ? 'В программе уже эта или более новая версия песни — она у вас на телефоне' : 'В программе уже более новая версия песни — ваша правка без связи не понадобилась');
    if (why) setTimeout(() => toast(why), n || oldMine ? 2500 : 0);
    if (n) await runSync();
    if (cur && gone.includes(cur.id) && Store.songs.has(cur.id)) reopen(cur.id);
  }

  /* ----- Поделиться: файл .txt, который понятен и человеку, и приложению ----- */

  const canShare = (v) => !!v && !!v.song && !!v.id && !v.tmp && (canEdit() || !!(v.got && v.got.ed)) && (!!(v.src && v.src.chords) || list(v).length > 0);
  async function share(v) {
    if (!canShare(v) || busy) return;
    const s = v.src || {};
    busy = true;
    try {
      const sheets = [];
      for (const x of list(v)) {
        let r;
        try { r = x.rec || await recOf(x.f); } catch { toast('Не все листы нот на телефоне — нужна связь с программой'); return; }
        const tag = x.own === 'prog' ? { f: x.f } : { h: (x.rec && x.rec.h) || Sig.hashBuf(r.buf) };
        sheets.push({ name: x.name, type: r.type, ...tag, data: await b64(new Blob([r.buf], { type: r.type })) });
      }
      // Подпись: правка без связи — как есть; иначе «как сейчас у песни» (at 0 — программа её уже знает)
      const g = v.got;
      const m = g && g.ed ? { ed: g.ed, edl: g.edl } : canSign() ? makeEdit(v, {}, 0) : null;
      const song = { name: v.name, text: plainOf(v) };
      for (const k of ['key', 'tempo', 'time', 'ccli', 'number']) if (s[k]) song[k] = s[k];
      if (s.chords) song.chords = s.chords;
      const d = { app: 'church-presenter', kind: 'team-song', v: 1, at: Date.now(), who: g && g.ed ? g.who : Store.me ? Store.me.person.name : '', song, sheets,
        ...(m ? { edit: m.ed, edl: m.edl } : {}) };
      const meta = [s.key && `Тональность ${s.key}`, s.tempo && `♩ = ${s.tempo}`, s.time, sheets.length && `листов нот: ${sheets.length}`].filter(Boolean).join(' · ');
      const link = await makeLink(song, d.who, m && m.edl);
      const text = [v.name, meta, '', 'Аккорды и ноты для приложения «MP Группа».',
        'Ссылка (аккорды и текст — сразу в «Не синхронизированные»): ' + link,
        'Ноты — из этого файла: «…» → «Открыть файл с аккордами и нотами».', '',
        s.chords ? Chords.toRows(s.chords) : '', '', '', MARK, JSON.stringify(d), ''].join('\n');
      const name = (String(v.name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Песня') + ' — аккорды и ноты.txt';
      await shareFile(new Blob([text], { type: 'text/plain' }), name, `${v.name} — аккорды и ноты для «MP Группа». Откройте ссылку: ${link}`);
    } catch (e) {
      toast(e.message || 'Не получилось сделать файл');
    } finally { busy = false; }
  }

  /* ----- Открыть файл: найти свою песню и наложить ----- */

  function parse(t) {
    const s = String(t || '').replace(/^﻿/, '');
    const i = s.indexOf(MARK);
    let d = null;
    try { d = JSON.parse(i >= 0 ? s.slice(i + MARK.length) : s); } catch { return null; }
    if (!d || d.kind !== 'team-song' || !d.song || typeof d.song.name !== 'string') return null;
    d.sheets = (Array.isArray(d.sheets) ? d.sheets : []).filter((x) => x && typeof x.data === 'string');
    return d;
  }
  async function openFile(f) {
    if (f.size > 80e6) { toast('Файл слишком большой'); return; }
    let t = '';
    try { t = await f.text(); } catch { toast('Не получилось прочитать файл'); return; }
    if (!openText(t)) toast('Это не файл с аккордами и нотами из приложения группы');
  }
  function openText(t) {
    const d = parse(t);
    if (!d) return false;
    if (editLike(d.edit) && sameProg(d.edit)) { takeEdit(d); return true; } // правка из своей программы — сразу в «Не синхронизированные»
    inc = d;
    const s = d.song;
    const what = [s.chords ? 'аккорды' + (s.key ? ` (${s.key})` : '') : '', d.sheets.length ? `листов нот: ${d.sheets.length}` : ''].filter(Boolean).join(', ') || 'только текст';
    const w = $('imWhat');
    w.replaceChildren(el('b', '', s.name), document.createTextNode(` — ${what}`), ...(d.who ? [document.createTextNode(`. Прислал(а): ${d.who}`)] : []));
    w.firstChild.dataset.noi18n = '';
    $('imQ').value = '';
    step(1);
    fillList(candidates());
    $('imDlg').showModal();
    return true;
  }
  // Насколько текст песни s похож на текст из файла (0…1)
  function cover(s) {
    const src = inc.song.chords || inc.song.text || '';
    const a = Chords.align(src, plainOf({ slides: s.slides }));
    return a.total ? (a.exact + a.fuzzy * 0.7) / a.total : 0;
  }
  function candidates() {
    const d = inc.song;
    const seen = new Map();
    const add = (s) => { if (s && !seen.has(s.id)) seen.set(s.id, s); };
    Store.search(d.name).slice(0, 12).forEach(add);
    const first = Chords.lyricLines(d.text || '')[0];
    if (first) Store.search(first).slice(0, 8).forEach(add);
    if (d.ccli) for (const s of Store.songs.values()) if (s.ccli === d.ccli) add(s);
    const nm = Chords.norm(d.name.replace(/^\s*\d+[.)\s]+/, ''));
    return [...seen.values()].map((s) => {
      const c = cover(s);
      const same = Chords.norm(s.name.replace(/^\s*\d+[.)\s]+/, '')) === nm;
      return { s, c, score: c + (same ? 0.5 : 0) + (d.ccli && s.ccli === d.ccli ? 0.5 : 0) };
    }).filter((x) => x.score >= 0.25).sort((a, b) => b.score - a.score).slice(0, 6);
  }
  function fillList(rows) {
    const box = $('imList');
    box.replaceChildren();
    if (!rows.length) { box.append(el('p', 'hint', 'Похожей песни на телефоне не нашлось. Найдите её по названию или откройте «Только посмотреть».')); return; }
    for (const r of rows) {
      const b = el('button', 'im-row');
      b.type = 'button';
      const nm = el('b', '', r.s.name);
      nm.dataset.noi18n = '';
      b.append(nm, el('span', 'hint', `слова совпадают на ${Math.round(r.c * 100)}%`));
      b.onclick = () => choose(r.s);
      box.append(b);
    }
  }
  function search() {
    const q = $('imQ').value.trim();
    fillList(q ? Store.search(q).slice(0, 8).map((s) => ({ s, c: cover(s) })) : candidates());
  }
  function step(n) {
    $('imS1').hidden = n !== 1;
    $('imS2').hidden = n !== 2;
  }
  function choose(s) {
    tgt = s;
    const plain = plainOf({ slides: s.slides });
    const ch = inc.song.chords && Chords.hasChords(inc.song.chords) ? Chords.align(inc.song.chords, plain) : null;
    tgtChords = ch && ch.exact + ch.fuzzy ? ch.text : '';
    const to = $('imTo');
    const nm = el('b', '', s.name);
    nm.dataset.noi18n = '';
    to.replaceChildren(document.createTextNode('На песню: '), nm);
    const n = inc.sheets.length;
    const parts = [];
    if (ch) parts.push(ch.exact + ch.fuzzy ? `Аккорды легли на ${ch.exact + ch.fuzzy} из ${ch.total} строк${ch.fuzzy ? ` (${ch.fuzzy} — по похожести)` : ''}.` : 'Аккорды не легли: строки не похожи на текст этой песни.');
    if (ch && ch.total && (ch.exact + ch.fuzzy) / ch.total < 0.4) parts.push('Похоже, это другая песня — проверьте.');
    if (n) parts.push(`Листов нот: ${n}.`);
    if (!tgtChords && !n) parts.push('Накладывать нечего.');
    $('imHint').textContent = parts.join(' ');
    const can = canEdit();
    $('imProg').hidden = !can;
    $('imProgHint').textContent = !can ? 'Сохранить в программу может тот, кому оператор разрешил править аккорды и ноты. Сейчас — только у вас на телефоне.'
      : (s.chords && tgtChords ? 'В программе у песни уже есть аккорды — они заменятся (в программе Ctrl+Z вернёт). ' : '') + 'Ноты добавятся к нотам песни у всей группы.';
    $('imProg').disabled = !tgtChords && !n;
    $('imMine').disabled = !tgtChords && !n;
    step(2);
  }
  async function saveProg() {
    if (!tgt || busy) return;
    if (!canChords() || !online()) { toast('Нет связи с программой — сохраните пока «Только у меня»'); return; }
    busy = true;
    $('imProg').disabled = true;
    const id = tgt.id;
    try {
      if (tgtChords) await Store.api('/songs/chords', { method: 'POST', body: { id, chords: tgtChords, ...(inc.song.key ? { key: String(inc.song.key) } : {}) } });
      let i = 0;
      for (const x of inc.sheets) {
        toast(`Отправляю ноты: ${++i} из ${inc.sheets.length}…`);
        await Store.api('/songs/sheets', { method: 'POST', body: { id, add: { name: String(x.name || 'Ноты'), data: x.data } }, timeout: 240000 });
      }
      $('imDlg').close();
      toast('Сохранено в программе — группа увидит');
    } catch (e) {
      toast(e.message || 'Не получилось сохранить в программу');
      return;
    } finally {
      busy = false;
      $('imProg').disabled = false;
    }
    await runSync();
    await prefetch();
    openSong(id, true);
  }
  async function saveMine() {
    if (!tgt) return;
    const t = Date.now().toString(36);
    const r = {
      id: tgt.id, chords: tgtChords, key: tgtChords ? String(inc.song.key || '') : '', who: String(inc.who || ''), name: inc.song.name, at: Date.now(),
      sheets: inc.sheets.map((x, i) => ({ f: `g${t}-${i}`, name: String(x.name || 'Ноты'), type: x.type || 'image/jpeg', buf: fromB64(x.data) })),
    };
    try { await Store.putRec('got', r); } catch { toast('Не хватило места на телефоне'); return; }
    got.set(r.id, r);
    $('imDlg').close();
    toast('Готово — видно только на этом телефоне');
    openSong(r.id, true);
  }
  // Песни нет — показать то, что в файле, как песню (без записи)
  function viewSong(song, sheets, note) {
    const slides = [];
    let part = '';
    let pi = 0;
    let buf = [];
    const flush = () => { if (buf.length) { slides.push({ id: 't' + slides.length, part, label: part, occ: 1, pi: pi++, text: buf.join('\n') }); buf = []; } };
    for (const l of String(song.text || '').split('\n')) {
      const m = l.trim().match(/^\[([^\]]+)\]$/);
      if (m) { flush(); part = m[1]; pi = 0; } else if (!l.trim()) flush(); else buf.push(l.trim());
    }
    flush();
    const t = Date.now().toString(36);
    const src = {};
    for (const k of ['key', 'tempo', 'time', 'chords']) if (song[k]) src[k] = song[k];
    openView({ id: '', name: song.name, slides, song: true, src, tmp: true, ...(note ? { note } : {}),
      tmpSheets: sheets.map((x, i) => ({ f: `t${t}-${i}`, name: String(x.name || 'Ноты'), type: x.type || 'image/jpeg', buf: x.buf })) }, true);
  }
  function viewOnly() {
    $('imDlg').close();
    viewSong(inc.song, inc.sheets.map((x) => ({ name: x.name, type: x.type, buf: fromB64(x.data) })));
  }

  /* ----- Аккорды, исправленные без связи: got с pend: true; уходят в программу после синхронизации (flush) ----- */

  async function saveMyChords(id, chords) {
    const old = got.get(id);
    const s = Store.songs.get(id) || {};
    const r = old ? { ...old, chords, pend: true, at: Date.now() } : { id, chords, key: '', who: '', name: s.name || '', at: Date.now(), sheets: [], pend: true };
    await Store.putRec('got', r);
    got.set(id, r);
  }
  // Отправлено в программу: чужие листы нот (если были) оставить, правку — убрать
  async function dropPend(id) {
    const r = got.get(id);
    if (!r || !r.pend) return;
    if (r.sheets && r.sheets.length) {
      const k = { ...r, chords: '', key: '', pend: false };
      await Store.putRec('got', k).catch(() => {});
      got.set(id, k);
    } else {
      await Store.delRec('got', id).catch(() => {});
      got.delete(id);
    }
  }

  /* ----- «Не синхронизированные»: песни из ссылки/файла, которых ещё нет в программе (got с ext: true) ----- */

  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const extId = (song) => 'ext-' + hash(Chords.norm(String(song.name).replace(/^\s*\d+[.)\s]+/, '')) + '|' + Chords.norm(Chords.lyricLines(song.text || song.chords || '')[0] || ''));
  const extList = () => [...got.values()].filter((r) => r.ext || r.ed).sort((a, b) => b.at - a.at);
  // sheets — [{ name, type, buf }]; песня уже была (ссылка, потом файл) — дополняем, а не затираем
  async function addExt(song, sheets, who) {
    const id = extId(song);
    const old = got.get(id);
    const t = Date.now().toString(36);
    const r = {
      id, ext: true, name: song.name, who: String(who || (old && old.who) || ''), at: Date.now(), chords: '', key: '',
      song: { ...(old ? old.song : {}), ...song, ...(song.chords || !old ? {} : { chords: old.song.chords }) },
      sheets: sheets.length ? sheets.map((x, i) => ({ f: `g${t}-${i}`, name: String(x.name || 'Ноты'), type: x.type || 'image/jpeg', buf: x.buf })) : old ? old.sheets : [],
    };
    await Store.putRec('got', r);
    got.set(id, r);
    return r;
  }
  async function openExt(id) {
    const r = got.get(id);
    if (!r) return;
    if (r.ed) {
      if (Store.songs.has(id)) { openSong(id, true); return; }
      // песни на телефоне ещё нет: показать как в файле; листы программы — из кэша, если пришли в файле
      const sheets = [];
      for (const [k, a, name] of r.ed.sh || []) {
        const x = k === 'h' ? (r.sheets || []).find((y) => y.h === a) : await Store.getRec('sheets', a).catch(() => null);
        if (x) sheets.push({ name, type: x.type, buf: x.buf });
      }
      viewSong({ ...r.song, chords: r.chords, key: r.key || r.song.key || '' }, sheets, `Правка от ${r.who || '?'}: этой песни на телефоне ещё нет. Уйдёт в программу, когда телефон подключится.`);
      return;
    }
    viewSong(r.song, r.sheets, 'Ещё не синхронизирована с программой: сохранена только на этом телефоне.');
  }
  async function delExt(id) { got.delete(id); await Store.delRec('got', id).catch(() => {}); if (cur && cur.id === id && Store.songs.has(id)) reopen(id); }
  async function addFromInc() {
    try { const r = await addExt(inc.song, inc.sheets.map((x) => ({ name: x.name, type: x.type, buf: fromB64(x.data) })), inc.who); $('imDlg').close(); toast('Добавлено в «Не синхронизированные»'); window.renderExt && window.renderExt(); openExt(r.id); } catch { toast('Не хватило места на телефоне'); }
  }

  /* ----- Ссылка: песня без нот в адресе (#mps=…), чтобы открыть её в приложении одним нажатием ----- */

  const toB64u = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64u = (s) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  async function pipe(u8, S) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new S('deflate-raw'))).arrayBuffer()); }
  // e — подписанная правка без листов (edl): аккорды в ней те же, что c
  async function makeLink(song, who, e) {
    const o = { n: song.name, t: song.text || '', c: e ? e.chords : song.chords || '', k: song.key || '', p: song.tempo || '', m: song.time || '', w: who || '',
      ...(e ? { e: { l: e.lib, s: e.sid, a: e.at, b: e.by, n: e.bn, k: e.key, g: e.sig } } : {}) };
    const raw = new TextEncoder().encode(JSON.stringify(o));
    let p = 'r.' + toB64u(raw);
    try { if (window.CompressionStream) p = 'z.' + toB64u(await pipe(raw, CompressionStream)); } catch { /* без сжатия */ }
    return new URL('./', location.href).href + '#mps=' + p;
  }
  // Открыли ссылку из чата: песню — в «Не синхронизированные». true — добавили
  async function fromLink() {
    const m = /^#mps=([rz])\.([\w-]+)$/.exec(location.hash);
    if (!m) return false;
    history.replaceState(history.state, '', location.pathname + location.search);
    try {
      let u = fromB64u(m[2]);
      if (m[1] === 'z') u = await pipe(u, DecompressionStream);
      const o = JSON.parse(new TextDecoder().decode(u));
      if (!o || typeof o.n !== 'string') throw new Error('x');
      const song = { name: o.n, text: String(o.t || '') };
      for (const [k, v] of [['chords', o.c], ['key', o.k], ['tempo', o.p], ['time', o.m]]) if (v) song[k] = String(v);
      const x = o.e;
      const e = x && { v: 1, lib: String(x.l || ''), sid: String(x.s || ''), at: Number(x.a), by: String(x.b || ''), bn: String(x.n || ''), chords: String(o.c || ''), key: String(x.k || ''), sh: null, sig: String(x.g || '') };
      if (e && editLike(e) && sameProg(e)) { await takeEdit({ edit: e, song, sheets: [], who: o.w }); return true; }
      const r = await addExt(song, [], o.w);
      toast('Песня добавлена в «Не синхронизированные»');
      window.renderExt && window.renderExt();
      if (Store.songs.size) openExt(r.id);
      return true;
    } catch { toast('Ссылка повреждена или не открылась'); return false; }
  }

  // Android: файл прислали в приложение («Поделиться» → «MP Группа»); sw.js положил его в кэш share-in
  async function fromShare() {
    if (!/[?&]share=1/.test(location.search)) return;
    history.replaceState(history.state, '', location.pathname);
    try {
      const c = await caches.open('share-in');
      const r = await c.match('/app/share-in');
      if (!r) return;
      const t = await r.text();
      await c.delete('/app/share-in');
      if (!openText(t)) toast('Это не файл с аккордами и нотами из приложения группы');
    } catch { /* кэша нет */ }
  }

  function wire() {
    $('shX').onclick = () => $('shDlg').close();
    $('shAdd').onclick = () => $('shFile').click();
    $('shFile').onchange = () => { const list = [...$('shFile').files]; $('shFile').value = ''; addFiles(list); };
    $('shShare').onclick = () => share(cv);
    wireFs();
    $('shIn').onclick = () => setZoom(zoom + 0.25);
    $('shOut').onclick = () => setZoom(zoom - 0.25);
    $('imX').onclick = () => $('imDlg').close();
    $('imQ').oninput = search;
    $('imView').onclick = viewOnly;
    $('imExt').onclick = addFromInc;
    $('imBack').onclick = () => step(1);
    $('imProg').onclick = saveProg;
    $('imMine').onclick = saveMine;
  }

  return { init, wire, prefetch, flush, saveMyChords, saveMyEdit, canSign, dropPend, bar, open, auto, share, canShare, openFile, openText, fromShare, fromLink, extList, openExt, delExt, got: (id) => got.get(id) || null };
})();
