/* ===== Импорт песен из других программ (songs.js → readSongFile) =====
   OpenLP — база songs.sqlite (строки читает main.js, songsFromDb) и файлы OpenLyrics .xml;
   EasyWorship 6/7 — Songs.db + SongWords.db (слова в RTF); ProPresenter .pro — 5/6 (XML) и 7 (двоичный protobuf);
   SongSelect (CCLI) — .usr и .txt. Результат — как у Songs.fromText: [{ name, song: { text, arrangements, arr, ccli?, number? } }].
   Части получают русские названия (Verse 1 → Куплет 1); повтор той же части — строкой [Припев] без текста,
   порядок исполнения из программы — аранжировкой. */
const SongImport = (() => {
  // Обозначение части в другой программе → наше название (без номера) и номер
  const TYPES = [
    [/^(pre-?chorus|pre|предприпев|p)$/i, 'Предприпев'],
    [/^(verse|vers|strophe|couplet|куплет|v)$/i, 'Куплет'],
    [/^(chorus|refrain|припев|c)$/i, 'Припев'],
    [/^(bridge|бридж|мост|b)$/i, 'Бридж'],
    [/^(intro|вступление|i)$/i, 'Вступление'],
    [/^(ending|outro|end|coda|концовка|окончание|завершение|e)$/i, 'Завершение'],
    [/^(interlude|instrumental|проигрыш)$/i, 'Проигрыш'],
    [/^(tag|тег|t)$/i, 'Тег'],
    [/^(other|часть|o)$/i, 'Часть'],
  ];
  function labelOf(raw) {
    const m = String(raw || '').trim().replace(/[:.]$/, '').match(/^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё -]*?)\s*(\d+)?$/);
    if (!m) return null;
    const t = TYPES.find(([re]) => re.test(m[1].trim()));
    if (!t) return null;
    return { type: t[1], n: m[2] ? Number(m[2]) : 0 };
  }

  // Части по порядку исполнения → текст песни. blocks: [{ id, type, n, slides: [текст] }], order — id по порядку (может быть пусто)
  function makeSong(name, blocks, order, meta = {}) {
    blocks = blocks.filter((b) => b.slides.some((s) => s.trim()));
    if (!blocks.length) return null;
    // Названия: у куплетов всегда номер, у остальных — только если их несколько
    const count = {};
    for (const b of blocks) count[b.type] = (count[b.type] || 0) + 1;
    const used = new Set();
    for (const b of blocks) {
      const num = b.type === 'Куплет' || count[b.type] > 1;
      let n = b.n || 0;
      let label = b.type + (num ? ' ' + (n || 1) : '');
      while (used.has(label)) { n = (n || 1) + 1; label = `${b.type} ${n}`; }
      used.add(label);
      b.label = label;
    }
    const byId = new Map(blocks.map((b) => [b.id, b]));
    let seq = (order || []).map((id) => byId.get(id)).filter(Boolean);
    if (!seq.length) seq = blocks;
    // Текст: каждая часть один раз в порядке первого появления, повтор — пустая строка с обозначением
    const out = [];
    const done = new Set();
    for (const b of seq) {
      out.push(`[${b.label}]`);
      if (!done.has(b)) { done.add(b); out.push(b.slides.map((s) => s.trim()).filter(Boolean).join('\n\n')); }
      out.push('');
    }
    // Части, которых нет в порядке, — в конец (иначе текст потеряется)
    for (const b of blocks) if (!done.has(b)) out.push(`[${b.label}]`, b.slides.join('\n\n'), '');
    const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // Порядок исполнения уже в тексте (повторы — пустыми [Припев]); свои аранжировки программы — отдельно
    const song = { text, arrangements: [], arr: '' };
    for (const a of meta.arrangements || []) {
      const ord = a.order.map((id) => byId.get(id)).filter(Boolean).map((b) => b.label);
      if (ord.length) song.arrangements.push({ id: Slides.newId(), name: a.name || 'Аранжировка', order: ord });
    }
    if (meta.ccli) song.ccli = String(meta.ccli).replace(/\D/g, '') || undefined;
    if (!song.ccli) delete song.ccli;
    if (meta.number) song.number = String(meta.number);
    const title = String(name || 'Песня').trim() || 'Песня';
    return { name: meta.number ? `${meta.number}. ${title}` : title, song };
  }

  // Текст с обозначениями частей строками («Verse 1», «Chorus») → части; без обозначений — по пустым строкам
  function blocksFromPlain(text) {
    const blocks = [];
    let cur = null;
    const paras = String(text).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
    for (const p of paras) {
      const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const lb = labelOf(lines[0]);
      if (lb) {
        cur = { id: 'b' + blocks.length, type: lb.type, n: lb.n, slides: [] };
        blocks.push(cur);
        lines.shift();
        if (!lines.length) continue;
      } else if (!cur) {
        cur = { id: 'b' + blocks.length, type: 'Куплет', n: 0, slides: [] };
        blocks.push(cur);
      }
      cur.slides.push(lines.join('\n'));
    }
    // Без обозначений каждая строфа — свой куплет
    if (blocks.length === 1 && !labelOf(String(text).trim().split('\n')[0]) && blocks[0].slides.length > 1) {
      return blocks[0].slides.map((s, i) => ({ id: 'b' + i, type: 'Куплет', n: i + 1, slides: [s] }));
    }
    // Одна и та же часть с тем же текстом (EasyWorship повторяет припев) — один блок, порядок — повторами
    return blocks;
  }
  // Повторы одинаковых частей → один блок и порядок
  function dedupe(blocks) {
    const uniq = [];
    const order = [];
    for (const b of blocks) {
      const key = b.type + '|' + b.slides.join('\n\n').toLowerCase().replace(/\s+/g, ' ');
      let u = uniq.find((x) => x._k === key);
      if (!u) { u = { ...b, _k: key }; uniq.push(u); }
      order.push(u.id);
    }
    return { blocks: uniq, order: order.length !== uniq.length ? order : [] };
  }

  /* ----- RTF → текст (EasyWorship, ProPresenter) ----- */
  function rtfToText(rtf) {
    rtf = String(rtf || '');
    if (!/^\s*\{\\rtf/.test(rtf)) return rtf;
    const cp = (rtf.match(/\\ansicpg(\d+)/) || [])[1] || '1252';
    let dec;
    try { dec = new TextDecoder('windows-' + cp); } catch { dec = new TextDecoder('windows-1252'); }
    const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|header|footer|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|mmathPr|themedata|colorschememapping|latentstyles|datastore|expandedcolortbl|sdfsdef)$/;
    let out = '';
    const stack = [];
    let skip = false;
    let uc = 1;
    let bytes = [];
    const flush = () => { if (bytes.length) { out += dec.decode(new Uint8Array(bytes)); bytes = []; } };
    for (let i = 0; i < rtf.length; i++) {
      const ch = rtf[i];
      if (ch === '{') { stack.push({ skip, uc }); continue; }
      if (ch === '}') { flush(); const s = stack.pop(); if (s) { skip = s.skip; uc = s.uc; } continue; }
      if (ch === '\\') {
        const nx = rtf[i + 1];
        if (nx === '\\' || nx === '{' || nx === '}') { flush(); if (!skip) out += nx; i++; continue; }
        if (nx === "'") { const h = parseInt(rtf.substr(i + 2, 2), 16); if (!skip && !Number.isNaN(h)) bytes.push(h); i += 3; continue; }
        if (nx === '*') { skip = true; i++; continue; }
        if (nx === '~') { flush(); if (!skip) out += ' '; i++; continue; }
        if (nx === '-' || nx === '_') { i++; continue; }
        if (nx === '\n' || nx === '\r') { flush(); if (!skip) out += '\n'; i++; continue; }
        const m = rtf.slice(i + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
        if (!m) { i++; continue; }
        i += m[0].length;
        const w = m[1];
        const n = m[2] != null ? Number(m[2]) : null;
        flush();
        if (SKIP.test(w)) { skip = true; continue; }
        if (skip) continue;
        if (w === 'par' || w === 'line' || w === 'sect' || w === 'page') out += '\n';
        else if (w === 'tab') out += ' ';
        else if (w === 'uc' && n != null) uc = n;
        else if (w === 'u' && n != null) {
          out += String.fromCharCode(n < 0 ? n + 65536 : n);
          // пропустить замену для старых программ (uc символов)
          for (let k = 0; k < uc && i + 1 < rtf.length; k++) {
            if (rtf[i + 1] === '\\' && rtf[i + 2] === "'") i += 4; else if (rtf[i + 1] !== '\\' && rtf[i + 1] !== '{' && rtf[i + 1] !== '}') i++;
          }
        } else if (w === 'emdash') out += '—';
        else if (w === 'endash') out += '–';
        else if (w === 'lquote' || w === 'rquote') out += '’';
        else if (w === 'ldblquote' || w === 'rdblquote') out += '"';
        else if (w === 'bullet') out += '•';
        continue;
      }
      if (ch === '\r' || ch === '\n') continue;
      if (skip) continue;
      flush();
      out += ch;
    }
    flush();
    return out.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ----- OpenLP ----- */
  const OLP_TYPE = { v: 'Куплет', c: 'Припев', b: 'Бридж', p: 'Предприпев', i: 'Вступление', e: 'Завершение', o: 'Часть' };
  const olpClean = (t) => String(t || '').replace(/\{\/?[a-z0-9]+\}/gi, '').replace(/\[---\]|\[===\]/g, '\n\n').replace(/\r\n?/g, '\n');
  // lyrics из базы OpenLP: <song><lyrics><verse type="v" label="1"><![CDATA[…]]></verse>…
  function openlpRow(r) {
    const doc = new DOMParser().parseFromString(String(r.lyrics || ''), 'text/xml');
    const blocks = [];
    for (const v of doc.getElementsByTagName('verse')) {
      const type = (v.getAttribute('type') || 'v').toLowerCase()[0];
      const label = v.getAttribute('label') || '1';
      const text = olpClean(v.textContent);
      blocks.push({ id: type + label, type: OLP_TYPE[type] || 'Часть', n: Number(label) || 0, slides: text.split(/\n[ \t]*\n/) });
    }
    if (!blocks.length && r.lyrics && !/^\s*</.test(r.lyrics)) return makeSong(r.title, blocksFromPlain(olpClean(r.lyrics)), [], { ccli: r.ccli, number: r.number });
    const order = String(r.order || '').toLowerCase().split(/\s+/).filter(Boolean).map((x) => (/^[a-z]$/.test(x) ? x + '1' : x));
    return makeSong(r.title, blocks, order, { ccli: r.ccli, number: r.number, arrName: 'Как в OpenLP' });
  }
  // OpenLyrics (.xml, экспорт OpenLP и др.): properties/titles/title, verseOrder; lyrics/verse name="v1"/lines (<br/>)
  function openLyrics(doc) {
    const all = (n, tag) => [...n.getElementsByTagName('*')].filter((e) => e.localName === tag);
    const one = (n, tag) => all(n, tag)[0];
    const title = (one(doc, 'title') || {}).textContent || '';
    const blocks = [];
    for (const v of all(doc, 'verse')) {
      const nm = (v.getAttribute('name') || 'v1').toLowerCase();
      const m = nm.match(/^([a-z])(\d*)/) || ['', 'v', '1'];
      const slides = all(v, 'lines').map((ln) => {
        const c = ln.cloneNode(true);
        for (const br of [...c.getElementsByTagName('*')].filter((e) => e.localName === 'br')) br.replaceWith('\n');
        for (const cm of [...c.getElementsByTagName('*')].filter((e) => e.localName === 'comment' || e.localName === 'chord')) cm.remove();
        return c.textContent.split('\n').map((l) => l.trim()).join('\n').trim();
      });
      blocks.push({ id: nm, type: OLP_TYPE[m[1]] || 'Часть', n: Number(m[2]) || 0, slides });
    }
    const order = String((one(doc, 'verseOrder') || {}).textContent || '').toLowerCase().split(/\s+/).filter(Boolean);
    return makeSong(title.trim(), blocks, order, { ccli: (one(doc, 'ccliNo') || {}).textContent, arrName: 'Как в программе' });
  }

  /* ----- EasyWorship 6/7 ----- */
  function ewRow(r) {
    const text = rtfToText(r.words);
    const d = dedupe(blocksFromPlain(text));
    return makeSong(r.title, d.blocks, d.order, { ccli: r.ccli, arrName: 'Как в EasyWorship' });
  }

  /* ----- ProPresenter ----- */
  const b64 = (s) => { try { const bin = atob(String(s).replace(/\s+/g, '')); return bin; } catch { return ''; } };
  // 5/6: <RVPresentationDocument> → RVSlideGrouping name → RVDisplaySlide → RTFData (атрибут или NSString)
  function pro6(doc, fileName) {
    const root = doc.documentElement;
    const all = (n, tag) => [...n.getElementsByTagName(tag)];
    const blocks = [];
    const groups = all(doc, 'RVSlideGrouping');
    groups.forEach((g, gi) => {
      const lb = labelOf(g.getAttribute('name')) || { type: 'Часть', n: gi + 1 };
      const slides = all(g, 'RVDisplaySlide').map((s) => {
        const t = all(s, 'RVTextElement').map((e) => {
          const ns = all(e, 'NSString').find((x) => x.getAttribute('rvXMLIvarName') === 'RTFData');
          const raw = e.getAttribute('RTFData') || (ns && ns.textContent) || '';
          const pl = all(e, 'NSString').find((x) => x.getAttribute('rvXMLIvarName') === 'PlainText');
          const rtf = raw ? b64(raw) : '';
          // RTF в байтах (latin1) — у \'hh и \u своя кодировка
          return rtf ? rtfToText(rtf) : pl ? decodeURIComponent(escape(b64(pl.textContent))) : '';
        }).filter(Boolean);
        return t.join('\n');
      });
      blocks.push({ id: g.getAttribute('uuid') || 'g' + gi, type: lb.type, n: lb.n, slides, name: g.getAttribute('name') || '' });
    });
    const arrs = all(doc, 'RVSongArrangement').map((a) => ({ name: a.getAttribute('name') || '', order: all(a, 'NSString').map((x) => x.textContent.trim()) }));
    const title = root.getAttribute('CCLISongTitle') || fileName;
    return makeSong(title, blocks, [], { ccli: root.getAttribute('CCLISongNumber'), arrangements: arrs });
  }

  // 7: protobuf без схемы. Группа (CueGroup) = { 1: { 2: имя }, 2: [UUID слайдов] }, слайд (Cue) = { 1: UUID, … RTF … }
  function pro7(bytes, fileName) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const latin = (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
    const utf = new TextDecoder('utf-8', { fatal: true });
    const str = (b) => { try { return utf.decode(b); } catch { return null; } };
    const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
    const cache = new WeakMap();
    // Поля сообщения или null, если байты — не сообщение
    function fields(b) {
      if (cache.has(b)) return cache.get(b);
      const out = [];
      let p = 0;
      const vint = () => { let v = 0, m = 1; for (let k = 0; k < 10; k++) { if (p >= b.length) throw 0; const x = b[p++]; v += (x & 127) * m; if (x < 128) return v; m *= 128; } throw 0; };
      try {
        while (p < b.length) {
          const tag = vint();
          const f = Math.floor(tag / 8);
          const w = tag % 8;
          if (!f) throw 0;
          if (w === 0) out.push({ f, v: vint() });
          else if (w === 1) { p += 8; if (p > b.length) throw 0; }
          else if (w === 5) { p += 4; if (p > b.length) throw 0; }
          else if (w === 2) { const n = vint(); if (p + n > b.length) throw 0; out.push({ f, b: b.subarray(p, p + n) }); p += n; }
          else throw 0;
        }
      } catch { cache.set(b, null); return null; }
      cache.set(b, out);
      return out;
    }
    const isRtf = (b) => b.length > 6 && b[0] === 123 && b[1] === 92 && b[2] === 114 && b[3] === 116 && b[4] === 102;
    const uuidOf = (b) => { const fs = fields(b); const f1 = fs && fs.find((x) => x.f === 1 && x.b); const s = f1 && str(f1.b); return s && UUID.test(s) ? s : null; };
    const firstRtf = (b, d = 0) => {
      if (d > 30) return null;
      if (isRtf(b)) return b;
      const fs = fields(b);
      if (!fs) return null;
      for (const x of fs) if (x.b && x.b.length > 4) { const r = firstRtf(x.b, d + 1); if (r) return r; }
      return null;
    };
    const groups = [];
    const cues = new Map(); // uuid → байты слайда
    const walk = (b, d) => {
      if (d > 12 || isRtf(b)) return;
      const fs = fields(b);
      if (!fs) return;
      // Сообщение с полем 1 = UUID — возможно слайд
      const own = fs.find((x) => x.f === 1 && x.b);
      const id = own && uuidOf(own.b);
      if (id && !cues.has(id)) cues.set(id, b);
      // Группа: поле 1 — { 1: UUID, 2: имя }, поле 2 (несколько) — UUID слайдов
      if (own) {
        const g = fields(own.b);
        const nm = g && g.find((x) => x.f === 2 && x.b);
        const name = nm && str(nm.b);
        const refs = fs.filter((x) => x.f === 2 && x.b).map((x) => uuidOf(x.b)).filter(Boolean);
        if (name != null && !UUID.test(name) && name.length < 80 && g.some((x) => x.f === 1 && x.b && uuidOf(x.b)) && refs.length && refs.length === fs.filter((x) => x.f === 2).length) groups.push({ name, refs });
      }
      for (const x of fs) if (x.b && x.b.length > 2) walk(x.b, d + 1);
    };
    walk(u8, 0);
    const textOf = (b) => { const r = firstRtf(b); return r ? rtfToText(latin(r)) : ''; };
    let blocks = groups.map((g, gi) => {
      const lb = labelOf(g.name) || { type: 'Часть', n: gi + 1 };
      return { id: 'g' + gi, type: lb.type, n: lb.n, slides: g.refs.map((u) => (cues.has(u) ? textOf(cues.get(u)) : '')).filter(Boolean) };
    }).filter((b) => b.slides.length);
    if (!blocks.length) {
      // Без групп: все тексты по порядку, каждый — слайд
      const texts = [];
      const collect = (b, d) => { if (d > 30) return; if (isRtf(b)) { const t = rtfToText(latin(b)); if (t && texts[texts.length - 1] !== t) texts.push(t); return; } const fs = fields(b); if (fs) for (const x of fs) if (x.b && x.b.length > 4) collect(x.b, d + 1); };
      collect(u8, 0);
      blocks = blocksFromPlain(texts.join('\n\n'));
    }
    return makeSong(fileName, blocks, []);
  }

  /* ----- SongSelect (CCLI) ----- */
  // .usr: [File] Type=SongSelect Import File; Title=, Author=, Fields=Verse 1/tChorus, Words=строка/nстрока/t…
  function usr(text, fileName) {
    const get = (k) => { const m = text.match(new RegExp('^' + k + '=(.*)$', 'mi')); return m ? m[1].trim() : ''; };
    const names = get('Fields').split('/t');
    const words = get('Words').split('/t');
    const blocks = names.map((nm, i) => {
      const lb = labelOf(nm) || { type: 'Часть', n: i + 1 };
      return { id: 'b' + i, type: lb.type, n: lb.n, slides: [(words[i] || '').split('/n').map((l) => l.trim()).join('\n')] };
    });
    const ccli = get('CCLI') || (text.match(/^\[S\s*A?(\d+)\]/mi) || [])[1] || '';
    return makeSong(get('Title') || fileName, blocks, [], { ccli });
  }
  // .txt: название, части с подписями, внизу «CCLI Song # 1234», ©, «CCLI License # …»
  function songSelectTxt(text, fileName) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const end = lines.findIndex((l) => /^\s*CCLI\s+Song\s*#/i.test(l));
    const ccli = end >= 0 ? (lines[end].match(/(\d+)/) || [])[1] : '';
    const body = (end >= 0 ? lines.slice(0, end) : lines);
    const ti = body.findIndex((l) => l.trim());
    const title = ti >= 0 ? body[ti].trim() : fileName;
    const d = dedupe(blocksFromPlain(body.slice(ti + 1).join('\n')));
    return makeSong(title, d.blocks, d.order, { ccli });
  }

  /* ----- Что за файл ----- */
  // f — из songs:open (main.js): { name, ext, bytes } или { name, ext, db: { from, songs } }. null — не наш формат
  function read(f, decodeText) {
    if (f.db) {
      const rows = f.db.songs || [];
      return rows.map((r) => { try { return f.db.from === 'openlp' ? openlpRow(r) : ewRow(r); } catch { return null; } }).filter(Boolean);
    }
    if (!f.bytes) return null;
    const u8 = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 600));
    const ext = f.ext || '';
    if (/^pro[567]?$/.test(ext) && !/^\s*\{/.test(head)) {
      if (/<\?xml|<RVPresentationDocument/i.test(head)) {
        const doc = new DOMParser().parseFromString(decodeText(u8), 'text/xml');
        const r = pro6(doc, f.name);
        return r ? [r] : [];
      }
      // Двоичный — ProPresenter 7 (в начале нет текста ChordPro)
      if ([...u8.subarray(0, 64)].some((x) => x < 9)) { const r = pro7(u8, f.name); return r ? [r] : []; }
    }
    if (ext === 'xml' || /<song[\s>]/i.test(head)) {
      const doc = new DOMParser().parseFromString(decodeText(u8), 'text/xml');
      if (doc.documentElement && doc.documentElement.localName === 'song') { const r = openLyrics(doc); return r ? [r] : []; }
      if (ext === 'xml') return [];
    }
    if (ext === 'usr' || /Type=SongSelect Import File/i.test(head)) { const r = usr(decodeText(u8), f.name); return r ? [r] : []; }
    if (ext === 'txt') {
      const t = decodeText(u8);
      if (/^\s*CCLI\s+Song\s*#\s*\d+/im.test(t) && !/^\s*(@@|title\s*:)/im.test(t)) { const r = songSelectTxt(t, f.name); return r ? [r] : []; }
    }
    return null;
  }

  return { read, rtfToText, labelOf };
})();
