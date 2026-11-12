/* Аккорды — один файл для окна оператора (сценический экран, stage.js) и телефонов группы (сервер отдаёт его как
   /app/chords.js — teamsrv.js). Песня: song.chords («Аккорды для сцены») — тот же текст с аккордами «[Am]Слава [G]Богу»
   или строкой аккордов над словами; [Куплет 1] — обозначения частей (пропускаются). Тональность — song.key (G, Am, F#),
   темп song.tempo, размер song.time. Транспонирование — на n полутонов; капо k — аппликатура на k полутонов ниже. */
'use strict';
const Chords = (() => {
  const RE = /^\(?[A-H](?:#|b)?(?:maj|min|m|dim|aug|sus|add|M|\+|°)?\d*(?:(?:sus|add|maj|b|#)\d+)*(?:\/[A-H](?:#|b)?)?\)?$/;
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
  // Строка из одних аккордов: «Am   G  |  C»
  const isRow = (line) => {
    if (line.includes('[')) return false;
    const toks = line.trim().split(/\s+/).filter((x) => x && x !== '|' && x !== '-');
    return toks.length > 0 && toks.every((x) => RE.test(x));
  };
  // Аккорды над строкой → в строку: «Am    G» + «Слава Богу» → «[Am]Слава [G]Богу»
  function mergeAbove(chords, text) {
    const marks = [...chords.matchAll(/\S+/g)].map((m) => ({ c: m[0], at: m.index }));
    let t = text;
    for (const m of marks.reverse()) {
      if (t.length < m.at) t = t.padEnd(m.at, ' ');
      t = t.slice(0, m.at) + `[${m.c}]` + t.slice(m.at);
    }
    return t;
  }
  // Текст с аккордами → строки { raw: «[Am]Слава», plain: «слава» } (plain — чтобы найти строку слайда)
  function sheet(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t) continue;
      const mk = t.match(/^\[([^\]]+)\]$/);
      if (mk && !RE.test(mk[1].trim())) continue; // [Припев]
      let raw = line;
      const nx = lines[i + 1];
      if (isRow(line) && nx && nx.trim() && !isRow(nx) && !/^\[[^\]]+\]$/.test(nx.trim())) { raw = mergeAbove(line, nx); i++; }
      out.push({ raw: raw.trimEnd(), plain: norm(raw.replace(/\[[^\]]*\]/g, '')) });
    }
    return out;
  }
  // Строки слайда (непустые) → те же строки с аккордами (по тексту, по порядку); нет ни одного аккорда — пусто
  function forText(sh, text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const res = [];
    let pos = 0;
    for (const l of lines) {
      const p = norm(l);
      let j = p ? sh.findIndex((x, k) => k >= pos && x.plain === p) : -1;
      if (j < 0 && p) j = sh.findIndex((x) => x.plain === p);
      if (j < 0) { res.push(l); continue; }
      res.push(sh[j].raw.trim());
      pos = j + 1;
    }
    return res.some((r) => r.includes('[')) ? res : [];
  }
  // «[Am]Сла[G]ва» → { text: 'Слава', marks: [{ at: 0, c: 'Am' }, { at: 3, c: 'G' }] }
  function split(line) {
    const marks = [];
    let text = '';
    for (const m of String(line).matchAll(/\[([^\]]*)\]|[^[]+|\[/g)) {
      if (m[1] !== undefined) { if (m[1].trim()) marks.push({ at: text.length, c: m[1].trim() }); } else text += m[0];
    }
    return { text, marks };
  }

  /* ----- Тональность и транспонирование ----- */

  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const IDX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0, H: 11, Hb: 10 };
  const mod = (n) => ((n % 12) + 12) % 12;
  // «G», «Am», «F#m», «Bb», «Hm», «C♯ moll» → { i: 0–11, minor }
  function keyOf(k) {
    const m = /^\s*([A-Ha-h])\s*(#|b|♯|♭)?\s*(m(?!aj)|min|moll)?/.exec(String(k || ''));
    if (!m) return null;
    const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2] || '';
    const i = IDX[m[1].toUpperCase() + acc];
    if (i === undefined) return null;
    return { i, minor: !!m[3] };
  }
  // Бемольные тональности — аккорды пишем с b (Bb, Eb), остальные — с #
  const FLAT_MAJ = [5, 10, 3, 8, 1, 6];   // F Bb Eb Ab Db Gb
  const FLAT_MIN = [2, 7, 0, 5, 10, 3];   // Dm Gm Cm Fm Bbm Ebm
  const flatFor = (key) => !!key && (key.minor ? FLAT_MIN : FLAT_MAJ).includes(key.i);
  const nameOf = (key, flat) => (key ? (flat === undefined ? (flatFor(key) ? FLAT : SHARP) : flat ? FLAT : SHARP)[key.i] + (key.minor ? 'm' : '') : '');
  // Тональность на n полутонов выше: «G», 2 → «A»
  function keyShift(k, n) {
    const key = keyOf(k);
    if (!key) return '';
    return nameOf({ i: mod(key.i + n), minor: key.minor });
  }
  // Сколько полутонов от одной тональности до другой (−5…+6)
  function interval(from, to) {
    const a = keyOf(from);
    const b = keyOf(to);
    if (!a || !b) return 0;
    const d = mod(b.i - a.i);
    return d > 6 ? d - 12 : d;
  }
  // Аккорд на n полутонов: «Am7/G», 2 → «Bm7/A»; flat — писать бемолями
  function shift(ch, n, flat) {
    if (!mod(n)) return ch;
    return String(ch).replace(/(^\(?|\/)([A-H])(#|b)?/g, (m, pre, l, acc) => {
      const i = IDX[l + (acc || '')] !== undefined ? IDX[l + (acc || '')] : IDX[l];
      return pre + (flat ? FLAT : SHARP)[mod(i + n)];
    });
  }
  // Писать ли бемолями: по тональности, в которой играем; тональности нет — как в исходных аккордах
  function flatFor2(key, n, sample) {
    const k = keyOf(key);
    if (k) return flatFor({ i: mod(k.i + n), minor: k.minor });
    return /^[A-H]b/.test(String(sample || ''));
  }


  /* ----- Загрузка аккордов к готовому тексту песни ----- */

  const isLabel = (l) => /^\s*\[[^\]]+\]\s*$/.test(l);
  // В тексте есть аккорды: «[Am]» в строке или строка из одних аккордов над словами
  function hasChords(src) {
    return String(src || '').replace(/\r/g, '').split('\n').some((l) => (/\[[A-H][^\]\n]{0,8}\]/.test(l) && !isLabel(l)) || (l.trim() && isRow(l)));
  }
  // Строки текста песни (без пустых и обозначений частей [Куплет 1])
  const lyricLines = (text) => String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim() && !isLabel(l));
  const wordsOf = (s) => [...String(s).matchAll(/\S+/g)].map((m) => ({ a: m.index, b: m.index + m[0].length }));
  const bigrams = (s) => { const t = norm(s); const o = new Map(); for (let i = 0; i + 1 < t.length; i++) { const g = t.slice(i, i + 2); o.set(g, (o.get(g) || 0) + 1); } return o; };
  function dice(a, b) {
    const x = bigrams(a); const y = bigrams(b);
    let n = 0; let tx = 0; let ty = 0;
    for (const [g, c] of x) { tx += c; if (y.has(g)) n += Math.min(c, y.get(g)); }
    for (const c of y.values()) ty += c;
    return tx + ty ? (2 * n) / (tx + ty) : 0;
  }
  // Аккорды из чужого текста (src) → на ОРИГИНАЛЬНЫЙ текст песни (text): строки и обозначения частей остаются как есть,
  // добавляются только аккорды. Строка находится по словам; если слова чуть другие — по похожести (от 0.55),
  // аккорды переносятся по номеру слова. Результат — текст для поля «Аккорды» и счёт { text, exact, fuzzy, none, total }
  function align(src, text) {
    const sh = sheet(src).map((r) => ({ ...r, sp: split(r.raw) })).filter((r) => r.sp.text.trim());
    const out = [];
    const st = { exact: 0, fuzzy: 0, none: 0, total: 0 };
    let pos = 0;
    for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
      if (!line.trim() || isLabel(line)) { out.push(line.trimEnd()); continue; }
      st.total++;
      const p = norm(line);
      let j = p ? sh.findIndex((x, k) => k >= pos && x.plain === p) : -1;
      if (j < 0 && p) j = sh.findIndex((x) => x.plain === p);
      let fuzzy = false;
      if (j < 0) {
        let best = 0;
        sh.forEach((x, k) => { const d = dice(x.sp.text, line) - (k < pos ? 0.05 : 0); if (d > best) { best = d; j = k; } });
        if (best < 0.55) j = -1; else fuzzy = true;
      }
      if (j < 0) { st.none++; out.push(line.trimEnd()); continue; }
      pos = j + 1;
      if (fuzzy) st.fuzzy++; else st.exact++;
      const r = sh[j];
      const sw = wordsOf(r.sp.text);
      const dw = wordsOf(line);
      const ins = r.sp.marks.map((m) => {
        let wi = sw.findIndex((w) => m.at >= w.a && m.at < w.b);
        let off = 0;
        if (wi < 0) { wi = sw.findIndex((w) => w.a >= m.at); if (wi < 0) wi = sw.length; } else off = m.at - sw[wi].a;
        if (!dw.length || wi >= dw.length) return { at: line.trimEnd().length, c: m.c };
        const w = dw[wi];
        return { at: w.a + Math.min(off, w.b - w.a), c: m.c };
      }).sort((a, b) => a.at - b.at);
      let t = line.trimEnd();
      for (const m of ins.reverse()) t = t.slice(0, m.at) + '[' + m.c + ']' + t.slice(m.at);
      out.push(t);
    }
    return { text: out.join('\n'), ...st };
  }
  // Сколько строк текста песни получают аккорды из chordsText: { total, matched } — для подсказки «легли на N из M строк»
  function coverage(chordsText, text) {
    const lines = lyricLines(text);
    return { total: lines.length, matched: forText(sheet(chordsText), lines.join('\n')).filter((l) => l.includes('[')).length };
  }

  // «[Am]Сла[G]ва» → две строки: аккорды над словами (по колонкам) и сам текст; строки без аккордов и [части] не меняются
  function toRows(src) {
    const out = [];
    for (const line of String(src || '').replace(/\r/g, '').split('\n')) {
      const sp = isLabel(line) ? { marks: [] } : split(line);
      if (!sp.marks.length) { out.push(line.trimEnd()); continue; }
      let row = '';
      for (const m of sp.marks) { row = row.padEnd(Math.max(m.at, row.length ? row.length + 1 : 0), ' ') + m.c; }
      out.push(row, sp.text.trimEnd());
    }
    return out.join('\n');
  }
  // Обратно: строка аккордов над строкой текста → «[Am]Сла[G]ва» (так хранится в песне)
  function toInline(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const nx = lines[i + 1];
      if (l.trim() && isRow(l) && nx && nx.trim() && !isRow(nx) && !isLabel(nx)) { out.push(mergeAbove(l, nx).trimEnd()); i++; } else out.push(l.trimEnd());
    }
    return out.join('\n');
  }

  return { RE, norm, isRow, toRows, toInline, mergeAbove, sheet, forText, split, hasChords, align, coverage, lyricLines, keyOf, keyShift, interval, shift, flatFor: flatFor2, nameOf, mod };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Chords;
