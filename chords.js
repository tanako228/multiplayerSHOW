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

  return { RE, norm, isRow, mergeAbove, sheet, forText, split, keyOf, keyShift, interval, shift, flatFor: flatFor2, nameOf, mod };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Chords;
