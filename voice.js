/* ===== Библия по голосу (окно оператора) =====
   Программа слушает проповедника (микрофон → скрытое окно voice.html → Vosk, без интернета; voicesrv.js)
   и, когда он называет место («Иоанна три шестнадцать», «Римлянам 8:28», «шестнадцатый стих третьей главы
   от Иоанна», «John three sixteen»), предлагает оператору этот стих одной кнопкой «Показать».
   Сам на экран ничего не выводит. Панель #vcPanel — плавающая (тянуть за шапку), место — settings.vcPos.
   Настройки — settings.voice = { lang: 'ru'|'en', mic: { id, label } }. Разбор речи — vcFind (числа словами → цифры). */

let vcState = 'off'; // off | loading | on | error
let vcHeard = '';    // последнее услышанное (частично)
let vcSugs = [];     // [{ bi, ci, v1, v2, ref, text, at }] — найденные места, новые сверху
let vcModels = null; // из voicesrv: { models: [{ id, name, mb, have }] }
let vcGetting = null; // { lang, got, total, unpack }
let vcLevel = 0;      // громкость микрофона 0–1 (полоска)
let vcErr = '';       // почему не включилось — видно в самой панели, а не только во всплывающем сообщении
let vcWarn = '';      // предупреждение при работе (взят другой микрофон, нет звука)
const vcOn = () => vcState === 'on' || vcState === 'loading';
const vcCfg = () => { if (!settings.voice || typeof settings.voice !== 'object') settings.voice = { lang: 'ru', mic: null }; return settings.voice; };

/* ---------- Разбор сказанного ---------- */

const VC_FILL = /^(глава|главы|главе|главу|главой|глав|стих|стиха|стихи|стихе|стихов|стихам|стихах|chapter|chapters|verse|verses|и|and|с|со|from|в|во|in|of|номер|number)$/;
const VC_RANGE = /^(по|до|through|to|till|thru|until)$/;
const VC_CH = /^(глава|главы|главе|главу|главой|chapter)$/;
const VC_VS = /^(стих|стиха|стихи|стихе|стихов|verse|verses)$/;

// Числа словами: «двадцать пять», «сто девятнадцатый», «twenty five»
const VC_UNITS = [
  [/^(один|одна|одно|одного|одной|одному|одном)$|^перв(ый|ая|ое|ого|ой|ому|ом|ую|ые)$|^(one|first|1st)$/, 1],
  [/^(два|две|двух|двум)$|^втор(ой|ая|ое|ого|ому|ом|ую)$|^(two|second|2nd)$/, 2],
  [/^(три|трех|трем)$|^трет(ий|ья|ье|ьего|ьей|ьему|ьем|ью)$|^(three|third|3rd)$/, 3],
  [/^(четыре|четырех)$|^четверт(ый|ая|ое|ого|ой|ом|ую)$|^(four|fourth)$/, 4],
  [/^(пять|пяти)$|^пят(ый|ая|ое|ого|ой|ом|ую)$|^(five|fifth)$/, 5],
  [/^(шесть|шести)$|^шест(ой|ая|ое|ого|ом|ую)$|^(six|sixth)$/, 6],
  [/^(семь|семи)$|^седьм(ой|ая|ое|ого|ом|ую)$|^(seven|seventh)$/, 7],
  [/^(восемь|восьми)$|^восьм(ой|ая|ое|ого|ом|ую)$|^(eight|eighth)$/, 8],
  [/^(девять|девяти)$|^девят(ый|ая|ое|ого|ой|ом|ую)$|^(nine|ninth)$/, 9],
];
const VC_TEENS = [
  [/^десят/, 10], [/^одиннадцат/, 11], [/^двенадцат/, 12], [/^тринадцат/, 13], [/^четырнадцат/, 14], [/^пятнадцат/, 15],
  [/^шестнадцат/, 16], [/^семнадцат/, 17], [/^восемнадцат/, 18], [/^девятнадцат/, 19],
  [/^(ten|tenth)$/, 10], [/^eleven/, 11], [/^twelv|^twelf/, 12], [/^thirteen/, 13], [/^fourteen/, 14], [/^fifteen/, 15], [/^sixteen/, 16], [/^seventeen/, 17], [/^eighteen/, 18], [/^nineteen/, 19],
];
const VC_TENS = [
  [/^двадцат/, 20], [/^тридцат/, 30], [/^сорок/, 40], [/^(пятьдесят|пятидесят)/, 50], [/^(шестьдесят|шестидесят)/, 60],
  [/^(семьдесят|семидесят)/, 70], [/^(восемьдесят|восьмидесят)/, 80], [/^девяност/, 90],
  [/^(twenty|twentieth)$/, 20], [/^(thirty|thirtieth)$/, 30], [/^(forty|fortieth)$/, 40], [/^(fifty|fiftieth)$/, 50], [/^(sixty|sixtieth)$/, 60],
  [/^(seventy|seventieth)$/, 70], [/^(eighty|eightieth)$/, 80], [/^(ninety|ninetieth)$/, 90],
];
const VC_HUND = [[/^(сто|ста|сотый|сотая|сотого|сотом|сотой|hundred|hundredth)$/, 100], [/^(двести|двухсот)/, 200]];
const vcHit = (list, t) => { for (const [re, v] of list) if (re.test(t)) return v; return 0; };
// Число с позиции i: { v, n — сколько слов } или null
function vcNum(tk, i) {
  const t = tk[i];
  if (t == null) return null;
  if (/^\d+$/.test(t)) return { v: Number(t), n: 1 };
  let v = 0;
  let n = 0;
  if (/^(one|a)$/.test(t) && tk[i + 1] && /^hundred/.test(tk[i + 1])) { n = 1; }
  const h = vcHit(VC_HUND, tk[i + n] || '');
  if (h) { v += h; n++; if (tk[i + n] === 'and') n++; }
  const te = vcHit(VC_TENS, tk[i + n] || '');
  if (te) { v += te; n++; }
  const tn = !te && vcHit(VC_TEENS, tk[i + n] || '');
  if (tn) { v += tn; n++; } else {
    const u = vcHit(VC_UNITS, tk[i + n] || '');
    if (u) { v += u; n++; }
  }
  return v ? { v, n } : null;
}
const vcOrd = (t) => (/^[1-4]$/.test(t || '') ? Number(t) : vcHit(VC_UNITS.slice(0, 4), t || ''));

// Книги: [проверка слова, канон или { порядковый номер: канон }, (по умолчанию для номерных)]
const VC_BOOKS = [
  [/^быти/, 1], [/^исход/, 2], [/^левит/, 3], [/^(числа|числах|чисел)$/, 4], [/^второзакон/, 5], [/^навин/, 6], [/^суд(ей|ьях|ьи|ьям)$/, 7], [/^руф(ь|и|ью)$/, 8],
  [/^царств/, { 1: 9, 2: 10, 3: 11, 4: 12 }], [/^царей$/, { 1: 11, 2: 12 }], [/^самуил/, { 1: 9, 2: 10 }], [/^(паралипоменон|летопис)/, { 1: 13, 2: 14 }],
  [/^ездр/, 15], [/^неем/, 16], [/^есфир/, 17], [/^иов(а|е|у)?$/, 18], [/^псал/, 19], [/^притч/, 20], [/^(екклесиаст|экклесиаст)/, 21],
  [/^песн/, 22, (tk, i) => /^песн/.test(tk[i + 1] || '')], [/^(исаи|исай)/, 23], [/^иереми/, 24, (tk, i) => tk[i - 1] !== 'плач'], [/^плач$/, 25],
  [/^иезекиил/, 26], [/^даниил/, 27], [/^оси[яиюе]$/, 28], [/^иоил/, 29], [/^амос/, 30], [/^авди/, 31], [/^ион(а|ы|е|у)$/, 32], [/^михе/, 33], [/^наум/, 34],
  [/^аввакум/, 35], [/^софони/, 36], [/^агге/, 37], [/^захари/, 38], [/^малахи/, 39],
  [/^(матфе|матве)/, 40], [/^марк(а|е|у)?$/, 41], [/^лук(и|а|е)$/, 42], [/^иоанн/, { 0: 43, 1: 62, 2: 63, 3: 64 }], [/^деян/, 44], [/^римлян/, 45],
  [/^коринфян/, { 1: 46, 2: 47 }], [/^галат/, 48], [/^(ефесян|эфесян)/, 49], [/^(филиппийц|филипийц)/, 50], [/^(колоссян|колосян)/, 51],
  [/^(фессалоникийц|солунян)/, { 1: 52, 2: 53 }], [/^тимофе/, { 1: 54, 2: 55 }], [/^тит(у|а)$/, 56], [/^филимон/, 57], [/^евре(ям|и|ев|ях)$/, 58],
  [/^иаков/, 59], [/^петр(а|у)$/, { 1: 60, 2: 61 }], [/^иуд(ы|а)$/, 65], [/^(откровени|апокалипс)/, 66],
  // English
  [/^genesis$/, 1], [/^exodus$/, 2], [/^leviticus$/, 3], [/^numbers$/, 4], [/^deuteronomy$/, 5], [/^joshua$/, 6], [/^judges$/, 7], [/^ruth$/, 8],
  [/^samuel$/, { 1: 9, 2: 10 }], [/^kings$/, { 1: 11, 2: 12 }], [/^chronicles$/, { 1: 13, 2: 14 }], [/^ezra$/, 15], [/^nehemiah$/, 16], [/^esther$/, 17], [/^job$/, 18],
  [/^psalms?$/, 19], [/^proverbs$/, 20], [/^ecclesiastes$/, 21], [/^song$/, 22, (tk, i) => tk[i + 1] === 'of'], [/^isaiah$/, 23], [/^jeremiah$/, 24], [/^lamentations$/, 25],
  [/^ezekiel$/, 26], [/^daniel$/, 27], [/^hosea$/, 28], [/^joel$/, 29], [/^amos$/, 30], [/^obadiah$/, 31], [/^jonah$/, 32], [/^micah$/, 33], [/^nahum$/, 34],
  [/^habakkuk$/, 35], [/^zephaniah$/, 36], [/^haggai$/, 37], [/^zechariah$/, 38], [/^malachi$/, 39], [/^matthew$/, 40], [/^mark$/, 41], [/^luke$/, 42],
  [/^john$/, { 0: 43, 1: 62, 2: 63, 3: 64 }], [/^acts$/, 44], [/^romans$/, 45], [/^corinthians$/, { 1: 46, 2: 47 }], [/^galatians$/, 48], [/^ephesians$/, 49],
  [/^philippians$/, 50], [/^colossians$/, 51], [/^thessalonians$/, { 1: 52, 2: 53 }], [/^timothy$/, { 1: 54, 2: 55 }], [/^titus$/, 56], [/^philemon$/, 57],
  [/^hebrews$/, 58], [/^james$/, 59], [/^peter$/, { 1: 60, 2: 61 }], [/^jude$/, 65], [/^revelations?$/, 66],
];
// Порядковый номер перед книгой: «первое послание к коринфянам», «2 Царств», «second Kings»
function vcOrdBefore(tk, i) {
  for (let j = i - 1, k = 0; j >= 0 && k < 4; j--, k++) {
    const o = vcOrd(tk[j]);
    if (o) return o;
    if (!/^(послание|послании|послания|книга|книги|книге|книгу|к|ко|апостола|святого|соборное|соборном|the|book|of|letter|epistle|to)$/.test(tk[j])) break;
  }
  return 0;
}

// Текст → места Писания: [{ canon, ch, v1, v2 }]
function vcFind(text) {
  const tk = String(text).toLowerCase().replace(/ё/g, 'е').replace(/(\d)\s*[:.]\s*(\d)/g, '$1 $2').replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 по $2')
    .split(/[^0-9a-zа-я]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < tk.length; i++) {
    const b = VC_BOOKS.find(([re, , ok]) => re.test(tk[i]) && (!ok || ok(tk, i)));
    if (!b) continue;
    let canon = b[1];
    if (typeof canon === 'object') { const o = vcOrdBefore(tk, i); canon = canon[o] || canon[0] || canon[1]; }
    // Числа после книги: глава, стих, «по» стих
    let ch = 0, v1 = 0, v2 = 0;
    let range = false;
    let j = i + 1 + (b[1] === 22 ? (tk[i] === 'song' ? 2 : 1) : 0); // «Песнь песней», «Song of Songs»
    let lastLabel = '';
    for (let guard = 0; j < tk.length && guard < 10; guard++) {
      const t = tk[j];
      if (VC_RANGE.test(t)) { range = true; j++; continue; }
      if (VC_CH.test(t)) { lastLabel = 'ch'; j++; continue; }
      if (VC_VS.test(t)) { lastLabel = 'v'; j++; continue; }
      if (VC_FILL.test(t)) { j++; continue; }
      const n = vcNum(tk, j);
      if (!n) break;
      j += n.n;
      // Подпись после числа: «три главы», «шестнадцатый стих»
      const after = tk[j] || '';
      // (только у порядковых: «третья глава», а «стих один» — подпись к следующему числу)
      const isOrd = (w) => /(ый|ой|ий|ая|ое|ья|ье|ого|его|ей|ом|ем|ую|th|st|nd|rd)$/.test(w || '');
      const nx = (VC_CH.test(after) || VC_VS.test(after)) && vcNum(tk, j + 1);
      const ord = isOrd(tk[j - 1]) && !(nx && !isOrd(tk[j + nx.n])); // «…второй стих один» — подпись к «один»
      const lb = ord && VC_CH.test(after) ? 'ch' : ord && VC_VS.test(after) ? 'v' : lastLabel;
      lastLabel = '';
      if (range && v1) { v2 = n.v; range = false; continue; }
      if (lb === 'ch' && !ch) ch = n.v;
      else if (lb === 'v' && !v1) v1 = n.v;
      else if (!ch) ch = n.v;
      else if (!v1) v1 = n.v;
      else break;
    }
    // Числа до книги: «шестнадцатый стих третьей главы евангелия от Иоанна»
    if (!ch) {
      for (let k = i - 1, g = 0; k >= 0 && g < 9; k--, g++) {
        const t = tk[k];
        if (VC_CH.test(t) || VC_VS.test(t)) {
          let s = k - 1;
          while (s > 0 && vcNum(tk, s - 1) && vcNum(tk, s - 1).n + s - 1 === k) s--; // составное число
          const n = vcNum(tk, s);
          if (n && s + n.n === k) { if (VC_CH.test(t)) ch = ch || n.v; else v1 = v1 || n.v; }
        }
      }
    }
    if (ch) out.push({ canon, ch, v1, v2: v2 && v2 >= v1 ? v2 : v1, at: i });
  }
  return out;
}

// Место → стих текущего перевода; null — такого нет
function vcResolve(r) {
  if (!bible || !bible.books) return null;
  let bi = bible.books.findIndex((b) => b.canon === r.canon);
  if (bi < 0) bi = Bible.findBook(bible, Bible.canonName(r.canon));
  if (bi < 0) return null;
  const book = bible.books[bi];
  let { ch, v1, v2 } = r;
  // Книга из одной главы: одно число — это стих («Иуды 3»)
  if (book.chapters.length === 1 && !v1 && ch > 1) { v1 = ch; v2 = ch; ch = 1; }
  const chap = book.chapters[ch - 1];
  if (!chap || !chap.length) return null;
  if (v1 && !chap[v1 - 1]) return null;
  if (!v1) { v1 = 1; v2 = 0; }
  const last = v2 ? Math.min(v2, chap.length) : v1;
  const ref = `${book.name} ${ch}` + (r.v1 || book.chapters.length === 1 ? `:${v1}${last > v1 ? '–' + last : ''}` : '');
  return { bi, ci: ch - 1, v1, v2: last, whole: !r.v1 && book.chapters.length > 1, ref, text: chap[v1 - 1] || '' };
}

/* ---------- Связь с распознаванием ---------- */

window.api.onVoiceText((m) => {
  if (!m) return;
  if (m.level != null) { vcLevel = m.level; const l = document.querySelector('#vcPanel .vc-lvl > i'); if (l) l.style.width = Math.min(100, m.level * 160) + '%'; return; }
  if (m.warn) { vcWarn = m.warn; flashStatus('Голос: ' + m.warn); vcPaint(); return; }
  if (m.state) {
    vcState = m.state === 'off' ? 'off' : m.state;
    if (m.state === 'error') vcErr = m.error || 'ошибка';
    if (m.state === 'error') showNotice('Библия по голосу: ' + (m.error || 'ошибка') + (/Permission|NotAllowed|NotFound|device/i.test(m.error || '') ? ' — проверьте микрофон (Параметры Windows → Конфиденциальность → Микрофон)' : ''), true);
    vcPaint();
    return;
  }
  if (!m.text) return;
  vcHeard = m.text;
  if (vsOn()) vsFeed(m.text, m.final); // поиск места по словам (ниже)
  // Места ищем и в частичном тексте (быстрее), повтор того же места за 40 с — просто поднимается наверх
  for (const r of vcFind(m.text)) {
    const x = vcResolve(r);
    if (!x) continue;
    const old = vcSugs.findIndex((s) => s.ref === x.ref);
    if (old >= 0) { const [s] = vcSugs.splice(old, 1); if (Date.now() - s.at < 40000 && !m.final) { vcSugs.unshift(s); continue; } }
    else if (m.final) flashStatus('Голос: ' + x.ref);
    // Сначала прозвучала только глава («Иоанна три…»), потом стих — главу из списка убираем
    if (!x.whole) vcSugs = vcSugs.filter((y) => !(y.whole && y.bi === x.bi && y.ci === x.ci && Date.now() - y.at < 20000));
    vcSugs.unshift({ ...x, at: Date.now() });
  }
  vcSugs = vcSugs.slice(0, 6);
  vcPaint(true);
});
window.api.onVoiceProgress((p) => { vcGetting = p; vcPaint(); });

async function vcStart() {
  const c = vcCfg();
  vcErr = '';
  vcWarn = '';
  if (typeof vsPrep === 'function') vsPrep();
  vcState = 'loading'; // сразу — нажатие видно, пока main готовит модель
  vcPaint();
  let r;
  try {
    vcModels = await window.api.voiceState();
    const m = vcModels.models.find((x) => x.id === c.lang);
    if (!m || !m.have) { vcState = 'off'; vcPaint(); return; }
    r = await window.api.voiceStart({ lang: c.lang, mic: c.mic && c.mic.id, label: c.mic && c.mic.label });
  } catch (err) { r = { ok: false, error: err.message }; }
  if (!r.ok) { vcState = 'error'; vcErr = r.error || 'не включилось'; showNotice('Библия по голосу: ' + vcErr, true); }
  vcPaint();
}
async function vcStop(why) { await window.api.voiceStop(why || ''); vcState = 'off'; vcPaint(); }
// Повторное нажатие сразу после «Вкл» (двойной щелчок, «ещё раз, раз не видно») выключало распознавание,
// пока модель грузилась, — 2 с после нажатия кнопка и клавиша ничего не делают
let vcTapAt = 0;
const vcTap = () => { if (Date.now() - vcTapAt < 2000) return false; vcTapAt = Date.now(); return true; };
function vcToggle(why) { if (!vcTap()) return; if (vcOn()) vcStop(why || 'клавиша'); else { vcOpen(); vcStart(); } }

// Показать место: глава во вкладке «Библия» и стихи на экран
function vcShow(s) {
  if (!s || !bible) return;
  openChapter(s.bi, s.ci);
  if (s.whole) { flashStatus(`Открыта глава: ${s.ref}`); return; }
  showVerses(s.bi, s.ci, s.v1, s.v2);
  scrollToVerse(s.v1);
}
function vcShowTop() { if (vcSugs[0]) vcShow(vcSugs[0]); else flashStatus('Голос: места ещё не названы'); }
// Только открыть главу, на экран не выводить
function vcPeek(s) { openChapter(s.bi, s.ci); if (!s.whole) { refSel = { v1: s.v1, v2: s.v2 }; updateBibleHighlight(); scrollToVerse(s.v1); } setTab('bible'); }

/* ---------- Панель ---------- */

(() => {
  const css = svEl('style');
  css.textContent = `
    #vcPanel { position: fixed; z-index: 60; width: 340px; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: calc(10px * var(--rk, 1)); box-shadow: 0 10px 34px rgba(0,0,0,.45); font-size: 13px; }
    #vcPanel .vc-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); cursor: move; user-select: none; }
    #vcPanel .vc-head b { flex: 1; }
    #vcPanel .vc-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: none; }
    #vcPanel .vc-tg.on { background: var(--live); border-color: var(--live); color: #fff; }
    #vcPanel .vc-tg.loading { border-color: var(--warn); }
    #vcPanel .vc-dot.on { background: var(--live); box-shadow: 0 0 8px var(--live); }
    #vcPanel .vc-dot.loading { background: var(--warn); }
    #vcPanel .vc-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; max-height: 56vh; overflow-y: auto; }
    #vcPanel .vc-heard { color: var(--muted); font-style: italic; min-height: 18px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    #vcPanel .vc-lvl { height: 4px; background: var(--field); border-radius: 2px; overflow: hidden; }
    #vcPanel .vc-lvl > i { display: block; height: 100%; width: 0; background: var(--live); transition: width .2s; }
    #vcPanel .vc-sugs { display: flex; flex-direction: column; gap: 8px; }
    #vcPanel .vc-sugs:empty { display: none; }
    #vcPanel .vc-sug { border: 1px solid var(--line); border-radius: calc(8px * var(--rk, 1)); padding: 7px 8px; display: flex; flex-direction: column; gap: 5px; }
    #vcPanel .vc-sug.new { border-color: var(--live); }
    #vcPanel .vc-sug .rf { font-weight: 700; font-size: 14px; }
    #vcPanel .vc-sug .tx { color: var(--muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    #vcPanel .vc-sug .bt { display: flex; gap: 6px; }
    #vcPanel .vc-sug .bt .primary { flex: 1; }
    #vcPanel .vc-err { color: var(--warn); font-weight: 600; margin: 0; }
    #vcPanel .vc-warn { color: var(--warn); font-size: 12px; }
    #vcPanel .vc-bar { height: 6px; background: var(--field); border-radius: 3px; overflow: hidden; }
    #vcPanel .vc-bar > i { display: block; height: 100%; background: var(--live); }
    #vcPanel select { max-width: 100%; }
    #vcPanel .vc-wd { padding: 3px 6px; display: inline-flex; align-items: center; }
    #vcPanel .vc-wd.on { background: var(--live); border-color: var(--live); }
    #vcPanel .vc-wdl { color: var(--muted); font-size: 12px; }
    #vcPanel .vc-sug .top { display: flex; align-items: center; gap: 6px; }
    #vcPanel .vc-by { font-size: 11px; padding: 1px 7px; border-radius: 9px; background: var(--field); color: var(--muted); white-space: nowrap; }
  `;
  document.head.append(css);
})();

function vcOpen() {
  let p = document.getElementById('vcPanel');
  if (!p) {
    p = svEl('div');
    p.id = 'vcPanel';
    p.className = 'ui-pop'; // стекло и размытие — как у других всплывающих панелей (index.html)
    document.body.append(p);
    const pos = settings.vcPos || {};
    p.style.right = pos.r != null ? pos.r + 'px' : '24px';
    p.style.bottom = pos.b != null ? pos.b + 'px' : '60px';
  }
  p.hidden = false;
  window.api.voiceState().then((s) => { vcModels = s; vcState = s.on ? (vcState === 'off' ? 'on' : vcState) : vcState === 'loading' ? 'loading' : 'off'; vcPaint(); }); // «Включаю…» не сбрасывать
  vcPaint();
}
// Значок в верхней строке (рядом с «Медиапулом»): открыть панель или спрятать (распознавание не выключается)
document.getElementById('voiceOpen')?.addEventListener('click', () => { const p = document.getElementById('vcPanel'); if (p && !p.hidden) vcClose(); else vcOpen(); });
function vcClose() { const p = document.getElementById('vcPanel'); if (p) p.hidden = true; }

// Перетаскивание панели за шапку; место — от правого нижнего угла окна
function vcDrag(e, p) {
  if (e.button !== 0 || e.target.closest('button,select')) return;
  const r = p.getBoundingClientRect();
  const dx = e.clientX - r.left;
  const dy = e.clientY - r.top;
  const move = (ev) => {
    const x = Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - dx));
    const y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
    p.style.right = Math.round(window.innerWidth - x - r.width) + 'px';
    p.style.bottom = Math.round(window.innerHeight - y - p.offsetHeight) + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    settings.vcPos = { r: parseInt(p.style.right, 10) || 0, b: parseInt(p.style.bottom, 10) || 0 };
    saveSettings();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

async function vcMicMenu(e) {
  let ins = [];
  try { ins = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { /* нет доступа */ }
  const c = vcCfg();
  showMenu(e, [
    { label: (!c.mic ? '✓ ' : '') + 'Как в Windows', fn: () => { c.mic = null; saveSettings(); if (vcOn()) vcStart(); vcPaint(); } },
    ...ins.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ label: (c.mic && c.mic.id === d.deviceId ? '✓ ' : '') + (d.label || 'Микрофон'), fn: () => { c.mic = { id: d.deviceId, label: d.label }; saveSettings(); if (vcOn()) vcStart(); vcPaint(); } })),
  ]);
}

async function vcGet(lang) {
  const r = await window.api.voiceGet(lang);
  vcGetting = null;
  if (!r.ok) { showNotice('Модель не скачалась: ' + (r.error || 'ошибка') + '. Проверьте интернет или возьмите .zip модели Vosk с другого компьютера («Из файла…»)', true); vcPaint(); return; }
  vcModels = r.state;
  flashStatus('Модель языка готова');
  vcStart();
}
async function vcFromFile(lang) {
  const r = await window.api.voiceFile(lang);
  if (!r.ok) { if (r.error) showNotice('Модель: ' + r.error, true); return; }
  vcModels = r.state;
  vcStart();
}

function vcPaint(fromText) {
  const vb = document.getElementById('voiceOpen');
  if (vb) vb.classList.toggle('listen', vcState === 'on');
  const p = document.getElementById('vcPanel');
  if (!p || p.hidden) return;
  const c = vcCfg();
  // Частый случай — пришёл текст (до 10 раз в секунду): только текст и карточки. Раньше панель собиралась
  // заново целиком — закрывался открытый список, терялись нажатия, полоска звука падала в ноль
  if (fromText) {
    const h = p.querySelector('.vc-heard');
    const list = p.querySelector('.vc-sugs');
    if (list && (h || vcState !== 'on')) {
      if (h && h.textContent !== vcHeardText()) h.textContent = vcHeardText();
      vcCards(list);
      return;
    }
  }
  const head = svEl('div', 'vc-head');
  head.addEventListener('pointerdown', (e) => vcDrag(e, p));
  head.append(svEl('span', 'vc-dot ' + (vcState === 'on' ? 'on' : vcState === 'loading' ? 'loading' : '')), svEl('b', '', 'Библия по голосу'));
  // Переключатель: надпись — состояние (владелец: «Вкл» — работает, «Выкл» — нет), нажатие — сменить
  const tg = svBtn(vcState === 'loading' ? 'Включаю…' : vcState === 'on' ? 'Вкл' : 'Выкл', () => { if (vcTap()) (vcOn() ? vcStop('кнопка в панели') : vcStart()); }, 'vc-tg' + (vcState === 'on' ? ' on' : vcState === 'loading' ? ' loading' : ''), 'mic');
  tg.title = vcState === 'loading' ? 'Распознавание включается — подождите несколько секунд' : vcState === 'on' ? 'Включено — нажмите, чтобы выключить' : 'Выключено — нажмите, чтобы включить';
  const x = svBtn('×', vcClose);
  x.title = 'Спрятать панель (распознавание продолжится)';
  // Значок «по словам» (Шазам): ищет стих по тексту, который читают, — вместе с поиском названных мест
  const wd = svBtn('', vsToggle, 'vc-wd' + (c.words ? ' on' : ''));
  wd.prepend(Icons.el('vtext'));
  wd.title = c.words ? 'Поиск места по словам включён: стих, который читают, найдётся по тексту — нажмите, чтобы выключить' : 'Поиск места по словам выключен: нажмите — программа будет находить стих по тексту, который читают (если прослушали, какое место назвали)';
  head.append(wd, tg, x);
  const body = svEl('div', 'vc-body');
  const ms = (vcModels && vcModels.models) || [];
  const m = ms.find((y) => y.id === c.lang);
  const line = svEl('div', 'sv-line');
  line.append(svSelect(ms.map((y) => [y.id, y.name + (y.have ? '' : ` — скачать ${y.mb} МБ`)]), c.lang, (v) => { c.lang = v; saveSettings(); if (vcOn()) vcStart(); vcPaint(); }),
    svBtn('Микрофон ▾', vcMicMenu));
  body.append(line);
  if (vcGetting) {
    const pct = vcGetting.total ? Math.round((vcGetting.got / vcGetting.total) * 100) : 0;
    const bar = svEl('div', 'vc-bar');
    const i = svEl('i');
    i.style.width = pct + '%';
    bar.append(i);
    body.append(svEl('div', '', vcGetting.unpack ? 'Распаковываю модель…' : `Скачиваю модель языка: ${pct}%`), bar);
  } else if (m && !m.have) {
    body.append(svEl('p', 'hint', `Один раз нужно скачать модель языка (${m.mb} МБ, с alphacephei.com — сайт распознавания Vosk). Потом всё работает без интернета, голос никуда не отправляется.`));
    const ln = svEl('div', 'sv-line');
    ln.append(svBtn('Скачать', () => vcGet(c.lang), 'primary'), svBtn('Из файла…', () => vcFromFile(c.lang)));
    body.append(ln);
  } else if (vcState === 'loading') {
    body.append(svEl('p', 'hint', 'Включаю распознавание… Первый раз модель распаковывается около минуты, потом — несколько секунд.'));
  } else if (vcState === 'on') {
    const lvl = svEl('div', 'vc-lvl');
    const li = svEl('i');
    li.style.width = Math.min(100, vcLevel * 160) + '%';
    lvl.append(li);
    body.append(lvl, svEl('div', 'vc-heard', vcHeardText()));
    if (vcWarn) body.append(svEl('div', 'vc-warn', vcWarn));
    if (c.words) body.append(svEl('div', 'vc-wdl', 'Поиск по словам включён: стих, который читают, появится ниже с пометкой «по словам».'));
  } else if (vcState === 'error') {
    body.append(svEl('p', 'vc-err', 'Не включилось: ' + vcErr), svEl('p', 'hint', 'Попробуйте «Микрофон ▾» → «Как в Windows» и включите снова кнопкой вверху. Подробности — в файле voice\\log.txt в папке данных программы.'));
  } else body.append(svEl('p', 'hint', 'Сейчас выключено. Нажмите «Выкл» вверху — станет «Вкл», и программа начнёт слушать проповедника; когда он называет место Писания, стих появится здесь. На экран — только по кнопке «Показать».'));
  if (!bible) body.append(svEl('p', 'hint', 'Перевод Библии не загружен — места искать негде.'));
  const list = svEl('div', 'vc-sugs');
  vcCards(list);
  body.append(list);
  const old = p.querySelector('.vc-body');
  const st = old ? old.scrollTop : 0;
  p.replaceChildren(head, body);
  if (fromText) body.scrollTop = st;
  const h = p.querySelector('.vc-heard');
  if (h) h.dataset.noi18n = '';
}
const vcHeardText = () => (vcHeard ? '«' + vcHeard + '»' : 'Слушаю… Назовите место: «Иоанна три шестнадцать».');
// Карточки мест; перерисовываются, только когда список или подсветка «нового» поменялись
function vcCards(list) {
  const key = vcSugs.map((s, i) => s.ref + '@' + s.at + (i === 0 && Date.now() - s.at < 8000 ? '!' : '')).join('|');
  if (list.dataset.k === key) return;
  list.dataset.k = key;
  list.replaceChildren();
  vcSugs.forEach((s, i) => {
    const card = svEl('div', 'vc-sug' + (i === 0 && Date.now() - s.at < 8000 ? ' new' : ''));
    const bt = svEl('div', 'bt');
    const show = svBtn(s.whole ? 'Открыть главу' : 'Показать', () => vcShow(s), 'primary', s.whole ? 'bible' : 'show');
    show.title = s.whole ? 'Открыть главу во вкладке «Библия»' : 'Вывести стихи на экран';
    const peek = svBtn('Найти', () => vcPeek(s));
    peek.title = 'Открыть во вкладке «Библия», на экран не выводить';
    const del = svBtn('×', () => { vcSugs = vcSugs.filter((y) => y !== s); vcPaint(); });
    del.title = 'Убрать из списка';
    bt.append(show, ...(s.whole ? [] : [peek]), del);
    const top = svEl('div', 'top');
    const rf = svEl('div', 'rf', s.ref);
    const tx = svEl('div', 'tx', s.text);
    rf.dataset.noi18n = tx.dataset.noi18n = '';
    top.append(rf);
    if (s.words) { const by = svEl('span', 'vc-by', 'по словам'); by.title = 'Найдено по тексту, который читают'; top.append(by); }
    card.append(top, tx, bt);
    list.append(card);
  });
}
// Подсветка «нового» гаснет сама
setInterval(() => { if (vcSugs[0] && Date.now() - vcSugs[0].at < 9000) vcPaint(true); }, 3000);

/* ---------- Поиск места по словам («Шазам») ----------
   Значок рядом с «Вкл/Выкл» в шапке панели (settings.voice.words). Включён — вместе с поиском названных мест
   программа всё время сравнивает последние 40 услышанных слов с текстом открытого перевода (основы слов,
   редкие слова весят больше, пары слов подряд как в стихе — ещё больше). Один стих явно впереди — карточка
   в общем списке с пометкой «по словам»; слова сбрасываются, поиск идёт дальше. Читают дальше той же главы —
   карточка растёт (Ин 3:16–17). Для оператора, который прослушал, какое место назвали. На экран — только «Показать». */

let vsDone = '';      // окончательный текст после последней находки
let vsPart = '';      // текущий (частичный) кусок
let vsSkipN = 0;      // столько первых слов текущей фразы уже ушло в находку — не считать
let vsIdx = null;     // указатель по переводу (vsIndex)
let vsLast = '';      // слова, по которым уже искали
const VS_WIN = 40;    // ищем по последним 40 словам
const vsOn = () => !!vcCfg().words;

// Слова: строчные, ё → е, без разметки и знаков
const vsWords = (t) => String(t || '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Основа слова — без окончания, чтобы «мира/миру/мир», «возлюбил/возлюбит» совпадали
function vsStem(w) {
  const n = w.length;
  if (n <= 3) return w;
  if (n <= 5) return w.slice(0, n - 1);
  if (n === 6) return w.slice(0, 5);
  return w.slice(0, 6);
}

// Указатель: основа → номера стихов; строится один раз на перевод (доли секунды)
function vsIndex(b) {
  const at = [];          // номер → [bi, ci, vi]
  const post = new Map(); // основа → [номера стихов]
  b.books.forEach((book, bi) => book.chapters.forEach((ch, ci) => ch.forEach((txt, vi) => {
    const k = at.length;
    at.push([bi, ci, vi]);
    for (const w of vsWords(txt)) {
      const s = vsStem(w);
      let l = post.get(s);
      if (!l) post.set(s, (l = []));
      if (l[l.length - 1] !== k) l.push(k);
    }
  })));
  return { b, at, post, acc: new Float32Array(at.length) };
}

// Поиск по словам: лучшие стихи с баллами
function vsScore(idx, words) {
  const N = idx.at.length;
  const st = words.map(vsStem).filter((s) => s.length >= 2);
  const idf = new Map();
  for (const s of st) {
    if (idf.has(s)) continue;
    const l = idx.post.get(s);
    // слова, которые есть почти в каждом десятом стихе («и», «в», «не»…), не помогают
    idf.set(s, l && l.length < N * 0.08 ? Math.log(N / l.length) : 0);
  }
  const acc = idx.acc;
  const touched = [];
  for (const [s, w] of idf) {
    if (!w) continue;
    for (const k of idx.post.get(s)) { if (!acc[k]) touched.push(k); acc[k] += w; }
  }
  touched.sort((a, b) => acc[b] - acc[a]);
  const top = touched.slice(0, 40).map((k) => ({ k, base: acc[k] }));
  for (const k of touched) acc[k] = 0;
  // Пары слов подряд, как в стихе, — сильный признак того самого места
  for (const c of top) {
    const [bi, ci, vi] = idx.at[c.k];
    const vs = vsWords(idx.b.books[bi].chapters[ci][vi]).map(vsStem);
    const pairs = new Set();
    for (let i = 1; i < vs.length; i++) pairs.add(vs[i - 1] + ' ' + vs[i]);
    const vset = new Set(vs);
    let bonus = 0;
    const seen = new Set();
    for (let i = 1; i < st.length; i++) {
      const p = st[i - 1] + ' ' + st[i];
      if (seen.has(p) || !pairs.has(p)) continue;
      seen.add(p);
      bonus += ((idf.get(st[i - 1]) || 0.5) + (idf.get(st[i]) || 0.5)) / 2;
    }
    c.pairs = seen.size;
    c.hits = [...idf.keys()].filter((s) => idf.get(s) && vset.has(s)).length;
    c.score = c.base + bonus;
  }
  top.sort((a, b) => b.score - a.score);
  return top.slice(0, 5).map((c) => {
    const [bi, ci, vi] = idx.at[c.k];
    const book = idx.b.books[bi];
    return { bi, ci, v1: vi + 1, v2: vi + 1, whole: false, ref: `${book.name} ${ci + 1}:${vi + 1}`, text: book.chapters[ci][vi], score: c.score, hits: c.hits, pairs: c.pairs };
  });
}
// Уверенно: достаточно совпавших слов и первый стих заметно впереди второго
function vsSure(res, nWords) {
  const [a, b] = res;
  if (!a || nWords < 5 || a.hits < 4 || a.pairs < 2) return false; // два слова подряд, как в стихе, — хотя бы дважды
  const r = a.score / Math.max(1, b ? b.score : 0);
  return (a.score >= 14 && r >= 1.6) || (a.hits >= 7 && r >= 1.3);
}


// Значок в шапке: включить/выключить поиск по словам. Распознавание выключено — включаем и его
function vsToggle() {
  const c = vcCfg();
  c.words = !c.words;
  saveSettings();
  vsReset(0);
  if (c.words) {
    flashStatus('Поиск места по словам включён');
    vsPrep();
    if (!vcOn()) { vcOpen(); if (vcTap()) vcStart(); }
  } else flashStatus('Поиск места по словам выключен');
  vcPaint();
}
// Указатель заранее, чтобы первая фраза не ждала ~0,6 с
function vsPrep() { setTimeout(() => { if (vsOn() && bible && bible.books && (!vsIdx || vsIdx.b !== bible)) vsIdx = vsIndex(bible); }, 300); }
function vsReset(skip) { vsDone = ''; vsPart = ''; vsSkipN = skip; vsLast = ''; }

// Новый текст от распознавания: частичный кусок растёт до окончательного, потом начинается новая фраза
function vsFeed(text, final) {
  const t = vsWords(text).slice(vsSkipN).join(' ');
  if (final) { vsDone = vsWords(vsDone + ' ' + t).slice(-VS_WIN * 2).join(' '); vsPart = ''; vsSkipN = 0; } else vsPart = t;
  vsRun();
}
function vsRun() {
  if (!bible || !bible.books) return;
  if (!vsIdx || vsIdx.b !== bible) vsIdx = vsIndex(bible); // ~0,6 с, один раз на перевод
  const words = vsWords(vsDone + ' ' + vsPart).slice(-VS_WIN);
  const key = words.join(' ');
  if (key === vsLast) return;
  vsLast = key;
  const res = vsScore(vsIdx, words);
  if (!vsSure(res, words.length)) {
    // Читают дальше: следующий стих после недавней находки берём при меньшем перевесе —
    // соседний стих похож словами, и одного «явно впереди» тут может не быть
    const now = Date.now();
    const p = vcSugs.find((s) => s.words && now - s.at < 120000);
    const nx = p && res.find((r) => r.bi === p.bi && r.ci === p.ci && r.v1 === p.v2 + 1);
    const t = res[0];
    const ok = nx && nx.pairs >= 2 && nx.hits >= 3 && (t === nx || (t.bi === p.bi && t.ci === p.ci && t.v1 >= p.v1 && t.v1 <= p.v2));
    if (!ok) return;
    vsAdd(nx);
  } else vsAdd(res[0]);
  // Слова этой находки больше не считаем — дальше ищется следующий стих
  vsReset(vsSkipN + vsWords(vsPart).length);
}

// Находка → карточка в общем списке
function vsAdd(r) {
  const now = Date.now();
  const recent = (s) => !s.whole && s.bi === r.bi && s.ci === r.ci && now - s.at < 120000;
  // Читают дальше: следующий стих той же главы — та же карточка становится «16–17»
  const prev = vcSugs.find((s) => s.words && recent(s) && r.v1 >= s.v1 && r.v1 <= s.v2 + 1);
  if (prev) {
    if (r.v1 === prev.v2 + 1) {
      prev.v2 = r.v1;
      prev.ref = `${bible.books[r.bi].name} ${r.ci + 1}:${prev.v1}–${prev.v2}`;
      flashStatus('По словам: ' + prev.ref);
    }
    prev.at = now;
    vcSugs = [prev, ...vcSugs.filter((s) => s !== prev)];
    vcPaint(true);
    return;
  }
  // Это место только что назвали голосом — второй карточки не нужно
  if (vcSugs.some((s) => recent(s) && r.v1 >= s.v1 && r.v1 <= s.v2)) return;
  vcSugs.unshift({ ...r, words: true, at: now });
  vcSugs = vcSugs.slice(0, 6);
  flashStatus('По словам: ' + r.ref);
  vcPaint(true);
}
