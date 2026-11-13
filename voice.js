/* ===== Библия по голосу (окно оператора) =====
   Программа слушает проповедника (микрофон → скрытое окно voice.html → Vosk, без интернета; voicesrv.js)
   и, когда он называет место («Иоанна три шестнадцать», «Римлянам 8:28», «шестнадцатый стих третьей главы
   от Иоанна», «John three sixteen»), предлагает оператору этот стих одной кнопкой «Показать».
   Сам на экран ничего не выводит. Панель — плавающая #vcPanel (тянуть за шапку, место — settings.vcPos) или блок #vcBox
   под предпросмотром (settings.vcDock, кнопка в шапке панели). Рисуется в vcHost() — одно и то же в обоих местах.
   Настройки — settings.voice = { lang: 'ru'|'en'|'de', mic: { id, label } }. Разбор речи — vcFind (числа словами → цифры). */

let vcState = 'off'; // off | loading | on | error
let vcHeard = '';    // последнее услышанное (частично)
const VC_KEEP = 40;  // сколько мест держать в списке (видно одно целиком и половину следующего, остальные — прокруткой)
let vcSugs = [];     // [{ bi, ci, v1, v2, ref, text, at }] — найденные места, новые сверху
let vcModels = null; // из voicesrv: { models: [{ id, name, mb, have }] }
let vcGetting = null; // { lang, got, total, unpack }
let vcLevel = 0;      // громкость микрофона 0–1 (полоска)
let vcErr = '';       // почему не включилось — видно в самой панели, а не только во всплывающем сообщении
let vcWarn = '';      // предупреждение при работе (взят другой микрофон, нет звука)
const vcOn = () => vcState === 'on' || vcState === 'loading';
const vcCfg = () => { if (!settings.voice || typeof settings.voice !== 'object') settings.voice = { lang: 'ru', mic: null }; return settings.voice; };

/* ---------- Разбор сказанного ---------- */

// Слово подходит по встроенному правилу или есть в списке включённых пакетов языков (voicepack.js)
const vcRe = (re, key) => ({ test: (t) => re.test(t) || (typeof vpHas === 'function' && vpHas(key, t)) });
const VC_FILL = vcRe(/^(глава|главы|главе|главу|главой|глав|стих|стиха|стихи|стихе|стихов|стихам|стихах|chapter|chapters|verse|verses|и|and|с|со|from|в|во|in|of|номер|number|kapitel|vers|verse|versen|und|von|im|aus|nach|der|die|das|den|dem|des)$/, 'filler');
const VC_RANGE = vcRe(/^(по|до|through|to|till|thru|until|bis)$/, 'range');
const VC_CH = vcRe(/^(глава|главы|главе|главу|главой|chapter|kapitel)$/, 'chapter');
const VC_VS = vcRe(/^(стих|стиха|стихи|стихе|стихов|verse|verses|vers|versen)$/, 'verse');
// Слова между числами и книгой: «…восьмой стих КНИГИ ИИСУСА Навина», «1:8 из книги…», «Kapitel 3 im Evangelium nach Johannes»
const VC_PRE = vcRe(/^(книги|книга|книге|книгу|из|в|во|от|евангелия|евангелие|евангелии|послания|послание|послании|к|ко|апостола|святого|пророка|иисуса|of|the|book|from|in|gospel|letter|epistle|to|according|aus|im|dem|der|des|buch|buche|evangelium|nach|brief|an|die)$/, 'prefix');

// «В ЭТОЙ ЖЕ главе», «в той же книге» — подпись не номер, а ссылка на текущее место
const VC_SAME = vcRe(/^(этой|этом|эта|эту|этого|той|том|та|ту|того|же|самой|самом|this|same|that|selben|derselben|demselben|diesem|dieser|gleichen)$/, 'same');
// «Следующий стих» — стих после последнего
const VC_NEXT = vcRe(/^(следующий|следующем|следующего|следующую|следующая|дальше|next|following|nächste|nächsten|nächster|folgende|folgenden)$/, 'next');

// Числа словами: «двадцать пять», «сто девятнадцатый», «twenty five»
const VC_UNITS = [
  [/^(один|одна|одно|одного|одной|одному|одном)$|^перв(ый|ая|ое|ого|ой|ому|ом|ую|ые)$|^(one|first|1st)$|^(eins|erste|ersten|erster|erstes)$/, 1],
  [/^(два|две|двух|двум)$|^втор(ой|ая|ое|ого|ому|ом|ую)$|^(two|second|2nd)$|^(zwei|zweite|zweiten|zweiter|zweites)$/, 2],
  [/^(три|трех|трем)$|^трет(ий|ья|ье|ьего|ьей|ьему|ьем|ью)$|^(three|third|3rd)$|^(drei|dritte|dritten|dritter|drittes)$/, 3],
  [/^(четыре|четырех)$|^четверт(ый|ая|ое|ого|ой|ом|ую)$|^(four|fourth)$|^(vier|vierte|vierten|vierter)$/, 4],
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
// Немецкие числа одним словом: «einundzwanzig», «hundertneunzehnten», «sechzehnte», «dritten»
const DE_U = { ein: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const DE_T = { zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
  zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const DE_ORD = { erst: 1, zweit: 2, dritt: 3, viert: 4, fünft: 5, sechst: 6, siebt: 7, siebent: 7, acht: 8, neunt: 9 };
function deBase(x) {
  if (x in DE_T) return DE_T[x];
  if (x in DE_U) return DE_U[x];
  const y = x.replace(/(e|en|er|es)$/, ''); // окончание порядкового: «dritte», «sechzehnten», «zwanzigsten»
  if (y in DE_ORD) return DE_ORD[y];
  const z = y.replace(/s?t$/, '');
  if (z in DE_T) return DE_T[z];
  if (z in DE_U) return DE_U[z];
  return 0;
}
function deNum(w) {
  let t = String(w || '');
  if (!/^(ein|zwei|drei|vier|fünf|sech|sieb|acht|neun|zehn|elf|zwölf|zwanzig|dreißig|dreissig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig|hundert|erst|zweit|dritt)/.test(t)) return 0;
  let v = 0;
  let m = t.match(/^(ein|zwei)?hundert(und)?(.*)$/);
  if (m) { v = m[1] === 'zwei' ? 200 : 100; t = m[3]; if (!t || /^(ste|sten|ster)$/.test(t)) return v; }
  m = t.match(/^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(.+)$/);
  if (m) { const te = deBase(m[2]); return te >= 20 ? v + DE_U[m[1]] + te : 0; }
  const b = deBase(t);
  return b ? v + b : 0;
}
// Число с позиции i: { v, n — сколько слов } или null
function vcNum(tk, i) {
  const t = tk[i];
  if (t == null) return null;
  if (/^\d+$/.test(t)) return { v: Number(t), n: 1 };
  const pk = typeof vpNum === 'function' && vpNum(tk, i);
  if (pk) return pk;
  const de = deNum(t);
  if (de) {
    // «ein und zwanzig» (раздельно)
    if (de < 10 && tk[i + 1] === 'und' && DE_T[tk[i + 2]] >= 20) return { v: de + DE_T[tk[i + 2]], n: 3 };
    return { v: de, n: 1 };
  }
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
const vcOrd = (t) => (/^[1-4]$/.test(t || '') ? Number(t) : vcHit(VC_UNITS.slice(0, 4), t || '') || (typeof vpOrd === 'function' ? vpOrd(t) : 0));

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
  // Deutsch (Luther, Einheitsübersetzung)
  [/^mose$/, { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }], [/^josua$/, 6], [/^richtern?$/, 7], [/^ruth?$/, 8], [/^könige?n?$/, { 1: 11, 2: 12 }],
  [/^chronik$/, { 1: 13, 2: 14 }], [/^esra$/, 15], [/^nehemia$/, 16], [/^esth?er$/, 17], [/^(hiob|ijob)$/, 18], [/^psalm(en|s)?$/, 19],
  [/^sprüchen?$/, 20], [/^(prediger|kohelet)$/, 21], [/^hohe(s)?lied$/, 22], [/^jesaja$/, 23], [/^jeremia$/, 24], [/^klageliedern?$/, 25],
  [/^(hesekiel|ezechiel)$/, 26], [/^obadja$/, 31], [/^jona$/, 32], [/^micha$/, 33], [/^habakuk$/, 35], [/^(zefanja|zephanja)$/, 36],
  [/^sacharja$/, 38], [/^maleachi$/, 39], [/^matthäus$/, 40], [/^markus$/, 41], [/^lukas$/, 42], [/^johannes$/, { 0: 43, 1: 62, 2: 63, 3: 64 }],
  [/^apostelgeschichte$/, 44], [/^römern?$/, 45], [/^korinthern?$/, { 1: 46, 2: 47 }], [/^galatern?$/, 48], [/^epheser?n?$/, 49],
  [/^philippern?$/, 50], [/^kolossern?$/, 51], [/^thessalonichern?$/, { 1: 52, 2: 53 }], [/^timotheus$/, { 1: 54, 2: 55 }],
  [/^hebräern?$/, 58], [/^jakobus$/, 59], [/^petrus$/, { 1: 60, 2: 61 }], [/^judas$/, 65], [/^offenbarung$/, 66],
];
// Порядковый номер перед книгой: «первое послание к коринфянам», «2 Царств», «second Kings»
function vcOrdBefore(tk, i) {
  for (let j = i - 1, k = 0; j >= 0 && k < 7; j--, k++) {
    const o = vcOrd(tk[j]) || (deNum(tk[j]) <= 5 ? deNum(tk[j]) : 0);
    if (o) return o;
    if (!/^(послание|послании|послания|книга|книги|книге|книгу|к|ко|апостола|святого|соборное|соборном|the|book|of|letter|epistle|to|buch|brief|des|der|die|das|dem|den|paulus|an|von)$/.test(tk[j]) && !(typeof vpHas === 'function' && (vpHas('bookWords', tk[j]) || vpHas('prefix', tk[j])))) break;
  }
  return 0;
}

// Текст → места Писания: [{ canon, ch, v1, v2 }]
function vcFind(text) {
  const tk = String(text).toLowerCase().replace(/ё/g, 'е').replace(/(\d)\s*[:.]\s*(\d)/g, '$1 $2').replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 по $2')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = [];
  for (let i = 0; i < tk.length; i++) {
    const b = (typeof vpBook === 'function' && vpBook(tk, i)) || VC_BOOKS.find(([re, , ok]) => re.test(tk[i]) && (!ok || ok(tk, i)));
    if (!b) continue;
    const bLen = b.len || 1; // название из нескольких слов (пакет): числа — после последнего
    let canon = b[1];
    if (typeof canon === 'object') { const o = vcOrdBefore(tk, i); canon = canon[o] || canon[0] || canon[1]; }
    // Числа после книги: глава, стих, «по» стих
    let ch = 0, v1 = 0, v2 = 0;
    let range = false;
    let j = i + bLen + (!b.len && b[1] === 22 ? (tk[i] === 'song' ? 2 : 1) : 0); // «Песнь песней», «Song of Songs»
    let lastLabel = '';
    for (let guard = 0; j < tk.length && guard < 10; guard++) {
      const t = tk[j];
      if (VC_RANGE.test(t)) { range = true; j++; continue; }
      if (VC_CH.test(t)) { lastLabel = 'ch'; j++; continue; }
      if (VC_VS.test(t)) { lastLabel = 'v'; j++; continue; }
      if (VC_FILL.test(t) || (typeof vpHas === 'function' && vpHas('bookWords', t))) { j++; continue; } // «Johannese KIRI üks üheksa»
      const n = vcNum(tk, j);
      if (!n) break;
      j += n.n;
      // Подпись после числа: «три главы», «шестнадцатый стих»
      const after = tk[j] || '';
      // (только у порядковых: «третья глава», а «стих один» — подпись к следующему числу)
      const isOrd = (w) => /(ый|ой|ий|ая|ое|ья|ье|ого|его|ей|ом|ем|ую|th|st|nd|rd|te|ten|ter|tes)$/.test(w || '') || (typeof vpIsOrd === 'function' && vpIsOrd(w));
      const nx = (VC_CH.test(after) || VC_VS.test(after)) && vcNum(tk, j + 1);
      const ord = isOrd(tk[j - 1]) && !(nx && !isOrd(tk[j + nx.n])); // «…второй стих один» — подпись к «один»
      const lb = lastLabel || (ord && VC_CH.test(after) ? 'ch' : ord && VC_VS.test(after) ? 'v' : '');
      lastLabel = '';
      if (range && v1) { v2 = n.v; range = false; continue; }
      if (lb === 'ch' && !ch) ch = n.v;
      else if (lb === 'v' && !v1) v1 = n.v;
      else if (!ch) ch = n.v;
      else if (!v1) v1 = n.v;
      else break;
    }
    // Числа до книги: «шестнадцатый стих третьей главы евангелия от Иоанна»
    // «1 глава 8 стих книги Иисуса Навина», «глава один стих восемь из книги…», «1:8 Иисуса Навина»
    if (!ch) {
      let e = i; // начало книги: «книги», «из», «Иисуса», порядковый номер книги («первое послание…»)
      const pre = (t) => VC_PRE.test(t) || (typeof vpHas === 'function' && vpHas('bookWords', t));
      while (e > 0 && pre(tk[e - 1])) e--;
      if (typeof b[1] === 'object' && e > 0 && vcOrd(tk[e - 1])) { e--; while (e > 0 && pre(tk[e - 1])) e--; }
      const s0 = Math.max(0, e - 10);
      // Число, которое кончается ровно на позиции end (самое длинное: «двадцать пять»)
      const numEnd = (end) => { for (let x = Math.max(s0, end - 4); x < end; x++) { const n = vcNum(tk, x); if (n && x + n.n === end) return { ...n, s: x }; } return null; };
      let cc = 0, vv = 0;
      // Число перед подписью («восьмой стих», «1 глава») или после неё («стих восемь»): как начата фраза
      const isLb = (k) => VC_CH.test(tk[k]) || VC_VS.test(tk[k]);
      let fl = s0;
      while (fl < e && !isLb(fl)) fl++;
      const before = fl < e && !!numEnd(fl);
      for (let k = e - 1; k >= s0; k--) {
        const isCh = VC_CH.test(tk[k]), isVs = VC_VS.test(tk[k]);
        if (!isCh && !isVs) continue;
        const a = vcNum(tk, k + 1);
        const n = before ? numEnd(k) : a && k + 1 + a.n <= e ? a : null;
        if (!n) continue;
        if (isCh) cc = cc || n.v; else vv = vv || n.v;
      }
      if (cc) { ch = cc; v1 = v1 || vv; }
      else if (!vv && e > 0) {
        // Без подписей — два числа подряд прямо перед книгой: «один восемь Иисуса Навина», «1.8 Иисуса Навина»
        const n2 = numEnd(e);
        const n1 = n2 && numEnd(n2.s);
        if (n1 && n2) { ch = n1.v; v1 = n2.v; }
      }
    }
    if (ch) out.push({ canon, ch, v1, v2: v2 && v2 >= v1 ? v2 : v1, at: i });
    if (bLen > 1) i += bLen - 1;
  }
  if (!out.length) { const c = vcFindCtx(tk); if (c) out.push(c); }
  return out;
}

/* ----- Контекст: проповедник назвал место, потом говорит только стих или главу ----- */
// Последнее место: названное голосом, найденное по словам или показанное оператором (bShown). Живёт 40 минут.
let vcCtx = null;  // { bi, ci, v, at }
let vcCtxB = null; // bShown, с которого взят контекст (показали новое — новый объект)
const VC_CTX_MS = 40 * 60000;
function vcCtxSet(bi, ci, v) { vcCtx = { bi, ci, v: v || 0, at: Date.now() }; vcCtxB = typeof bShown !== 'undefined' ? bShown : null; }
function vcContext() {
  const b = typeof bShown !== 'undefined' ? bShown : null;
  if (b && b !== vcCtxB && typeof bible !== 'undefined' && bible && b.bid === bible.id) { vcCtxB = b; vcCtx = { bi: b.bi, ci: b.ci, v: b.v2 || b.v1 || 0, at: Date.now() }; }
  return vcCtx && Date.now() - vcCtx.at < VC_CTX_MS ? vcCtx : null;
}
// «в этой же главе 17 стих», «стих семнадцатый», «стихи 17 по 20», «пятая глава третий стих», «следующий стих»
function vcFindCtx(tk) {
  const ctx = vcContext();
  if (!ctx) return null;
  const isLb = (k) => (VC_CH.test(tk[k]) || VC_VS.test(tk[k])) && !(k > 0 && VC_SAME.test(tk[k - 1])); // «этой же главе» — не номер главы
  // «следующий стих»
  for (let k = 0; k + 1 < tk.length; k++) {
    if (VC_NEXT.test(tk[k]) && VC_VS.test(tk[k + 1]) && ctx.v) return { bi: ctx.bi, ch: ctx.ci + 1, v1: ctx.v + 1, v2: ctx.v + 1, ctx: true };
  }
  // Число кончается ровно на позиции end
  const numEnd = (end) => { for (let x = Math.max(0, end - 4); x < end; x++) { const n = vcNum(tk, x); if (n && x + n.n === end) return n; } return null; };
  let fl = 0;
  while (fl < tk.length && !isLb(fl)) fl++;
  if (fl >= tk.length) return null;
  const before = !!numEnd(fl); // «17 стих», «пятая глава» — числа перед подписями; иначе — после
  let cc = 0, vv = 0, v2 = 0;
  for (let k = fl; k < tk.length; k++) {
    if (!isLb(k)) continue;
    let n = null;
    let after = k + 1;
    if (before) n = numEnd(k);
    else { n = vcNum(tk, k + 1); if (n) after = k + 1 + n.n; }
    if (!n) continue;
    if (VC_CH.test(tk[k])) { cc = cc || n.v; continue; }
    if (vv) continue;
    vv = n.v;
    // «стихи 17 по 20»
    if (!before && VC_RANGE.test(tk[after] || '')) { const m = vcNum(tk, after + 1); if (m && m.v > vv) v2 = m.v; }
  }
  if (!vv && !cc) return null;
  return { bi: ctx.bi, ch: cc || ctx.ci + 1, v1: vv, v2: v2 || vv, ctx: true };
}

// Место → стих текущего перевода; null — такого нет
function vcResolve(r) {
  if (!bible || !bible.books) return null;
  let bi = r.bi != null ? r.bi : bible.books.findIndex((b) => b.canon === r.canon);
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
  if (m.level != null) { vcLevel = m.level; const l = document.querySelector('.vc-ui .vc-lvl > i'); if (l) { l.style.width = Math.min(100, m.level * 160) + '%'; l.parentNode.classList.toggle('clip', !!m.clip); l.parentNode.title = 'Уровень после автоусиления' + (m.gain ? ` (×${m.gain})` : '') + (m.clip ? ' — вход перегружен!' : ''); } return; }
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
    else if (m.final) flashStatus((r.ctx ? 'Голос (та же глава): ' : 'Голос: ') + x.ref);
    // Сначала прозвучала только глава («Иоанна три…»), потом стих — главу из списка убираем
    if (!x.whole) vcSugs = vcSugs.filter((y) => !(y.whole && y.bi === x.bi && y.ci === x.ci && Date.now() - y.at < 20000));
    if (r.ctx) x.ctx = true; // карточка «та же глава»
    vcSugs.unshift({ ...x, at: Date.now() });
    vcCtxSet(x.bi, x.ci, x.whole ? 0 : x.v2);
  }
  vcSugs = vcSugs.slice(0, VC_KEEP);
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
  vcCtxSet(s.bi, s.ci, s.whole ? 0 : s.v2);
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
    .vc-ui .vc-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); cursor: move; user-select: none; }
    .vc-ui .vc-head b { flex: 1; }
    .vc-ui .vc-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: none; }
    .vc-ui .vc-tg.on { background: var(--live); border-color: var(--live); color: #fff; }
    .vc-ui .vc-tg.loading { border-color: var(--warn); }
    .vc-ui .vc-dot.on { background: var(--live); box-shadow: 0 0 8px var(--live); }
    .vc-ui .vc-dot.loading { background: var(--warn); }
    .vc-ui .vc-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; max-height: 56vh; overflow-y: auto; }
    .vc-ui .vc-heard { color: var(--muted); font-style: italic; min-height: 18px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .vc-ui .vc-lvl { height: 4px; background: var(--field); border-radius: 2px; overflow: hidden; }
    .vc-ui .vc-lvl > i { display: block; height: 100%; width: 0; background: var(--live); transition: width .2s; }
    .vc-ui .vc-lvl.clip > i { background: #d6453d; }
    .vc-ui .vc-sugs { display: flex; flex-direction: column; gap: 8px; }
    .vc-ui .vc-sugs:empty { display: none; }
    .vc-ui .vc-sug { border: 1px solid var(--line); border-radius: calc(8px * var(--rk, 1)); padding: 7px 8px; display: flex; flex-direction: column; gap: 5px; }
    .vc-ui .vc-sug.new { border-color: var(--live); }
    .vc-ui .vc-sug .rf { font-weight: 700; font-size: 14px; }
    .vc-ui .vc-sug .tx { color: var(--muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .vc-ui .vc-sug .bt { display: flex; gap: 6px; }
    .vc-ui .vc-sug .bt .primary { flex: 1; }
    .vc-ui .vc-err { color: var(--warn); font-weight: 600; margin: 0; }
    .vc-ui .vc-warn { color: var(--warn); font-size: 12px; }
    .vc-ui .vc-bar { height: 6px; background: var(--field); border-radius: 3px; overflow: hidden; }
    .vc-ui .vc-bar > i { display: block; height: 100%; background: var(--live); }
    .vc-ui select { max-width: 100%; }
    .vc-ui .vc-wd { padding: 3px 6px; display: inline-flex; align-items: center; }
    .vc-ui .vc-wd.on { background: var(--live); border-color: var(--live); }
    .vc-ui .vc-wdl { color: var(--muted); font-size: 12px; }
    .vc-ui .vc-sug .top { display: flex; align-items: center; gap: 6px; }
    .vc-ui .vc-by { font-size: 11px; padding: 1px 7px; border-radius: 9px; background: var(--field); color: var(--muted); white-space: nowrap; }
    .vc-ui .vc-lh { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
    .vc-ui .vc-lh span { flex: 1; }
    .vc-ui .vc-lh:empty { display: none; }
    .vc-ui .vc-sugs { overflow-y: auto; overscroll-behavior: contain; padding-right: 2px; }
    .vc-ui .vc-dk { padding: 3px 6px; display: inline-flex; align-items: center; }
    #vcDockIn .vc-head { cursor: default; padding: 4px 6px 6px; }
    #vcDockIn .vc-head b { font-size: 11px; font-weight: 400; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); } /* как «Макросы», «Таймеры» */
    #vcDockIn .vc-body { max-height: none; overflow: visible; padding: 6px 4px 4px; }
  `;
  document.head.append(css);
})();

// Где панель: блок под предпросмотром (#vcBox → #vcDockIn) или плавающее окно #vcPanel
const vcDocked = () => !!settings.vcDock && !!document.getElementById('vcDockIn');
const vcHost = () => document.getElementById(vcDocked() ? 'vcDockIn' : 'vcPanel');
function vcShown() {
  if (vcDocked()) return !document.getElementById('vcBox').hidden;
  const p = document.getElementById('vcPanel');
  return !!p && !p.hidden;
}
function vcOpen() {
  if (vcDocked()) {
    const b = document.getElementById('vcBox');
    b.hidden = false;
    if (settings.vcDockOpen === false) { settings.vcDockOpen = true; saveSettings(); }
    const fp = document.getElementById('vcPanel');
    if (fp) fp.hidden = true;
    window.api.voiceState().then((st) => { vcModels = st; vcState = st.on ? (vcState === 'off' ? 'on' : vcState) : vcState === 'loading' ? 'loading' : 'off'; vcPaint(); });
    vcPaint();
    b.scrollIntoView({ block: 'nearest' });
    return;
  }
  const db = document.getElementById('vcBox');
  if (db) db.hidden = true;
  let p = document.getElementById('vcPanel');
  if (!p) {
    p = svEl('div');
    p.id = 'vcPanel';
    p.className = 'ui-pop vc-ui'; // стекло и размытие — как у других всплывающих панелей (index.html)
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
document.getElementById('voiceOpen')?.addEventListener('click', () => { if (vcShown()) vcClose(); else vcOpen(); });
function vcClose() {
  const p = document.getElementById(vcDocked() ? 'vcBox' : 'vcPanel');
  if (p) p.hidden = true;
  if (vcDocked()) { settings.vcDockOpen = false; saveSettings(); } // блок спрятан — и после перезапуска
}
// Перенесённая под предпросмотр панель видна сразу после запуска (как другие блоки), если её не прятали
if (settings.vcDock && settings.vcDockOpen !== false) setTimeout(vcOpen, 0);
// Перенести: плавающее окно ↔ блок под предпросмотром (рядом со «Слоями», «Проигрывателем», «Макросами», «Таймерами»)
function vcDockSet(on) {
  settings.vcDock = !!on;
  saveSettings();
  const old = document.getElementById(on ? 'vcPanel' : 'vcDockIn');
  if (old) old.replaceChildren();
  vcOpen();
}

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
  const p = vcHost();
  if (!p || !vcShown()) return;
  const c = vcCfg();
  const docked = vcDocked();
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
  if (!docked) head.addEventListener('pointerdown', (e) => vcDrag(e, p));
  head.append(svEl('span', 'vc-dot ' + (vcState === 'on' ? 'on' : vcState === 'loading' ? 'loading' : '')), svEl('b', '', 'Библия по голосу'));
  // Переключатель: надпись — состояние (владелец: «Вкл» — работает, «Выкл» — нет), нажатие — сменить
  const tg = svBtn(vcState === 'loading' ? 'Включаю…' : vcState === 'on' ? 'Вкл' : 'Выкл', () => { if (vcTap()) (vcOn() ? vcStop('кнопка в панели') : vcStart()); }, 'vc-tg' + (vcState === 'on' ? ' on' : vcState === 'loading' ? ' loading' : ''), 'mic');
  tg.title = vcState === 'loading' ? 'Распознавание включается — подождите несколько секунд' : vcState === 'on' ? 'Включено — нажмите, чтобы выключить' : 'Выключено — нажмите, чтобы включить';
  const x = svBtn('×', vcClose);
  x.title = 'Спрятать панель (распознавание продолжится)';
  // Перенести панель: вниз — в блок под предпросмотром, вверх — снова плавающим окном
  const dk = svBtn('', () => vcDockSet(!docked), 'vc-dk');
  dk.prepend(Icons.el(docked ? 'up' : 'down'));
  dk.title = docked ? 'Сделать плавающим окном' : 'Перенести в нижнюю панель под предпросмотром (рядом с «Макросами», «Таймерами», «Слоями»)';
  // Значок «по словам» (Шазам): ищет стих по тексту, который читают, — вместе с поиском названных мест
  const wd = svBtn('', vsToggle, 'vc-wd' + (c.words ? ' on' : ''));
  wd.prepend(Icons.el('vtext'));
  wd.title = c.words ? 'Поиск места по словам включён: стих, который читают, найдётся по тексту — нажмите, чтобы выключить' : 'Поиск места по словам выключен: нажмите — программа будет находить стих по тексту, который читают (если прослушали, какое место назвали)';
  head.append(wd, tg, dk, x);
  const body = svEl('div', 'vc-body');
  const ms = (vcModels && vcModels.models) || [];
  const m = ms.find((y) => y.id === c.lang);
  const line = svEl('div', 'sv-line');
  line.append(svSelect(ms.map((y) => [y.id, y.name + (y.have ? '' : ` — скачать ${y.mb} МБ`)]), c.lang, (v) => { c.lang = v; saveSettings(); if (vcOn()) vcStart(); vcPaint(); }),
    svBtn('Микрофон ▾', vcMicMenu), svBtn('Языки…', () => vpOpen()));
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
  // Найденные места: шапка «Найдено: N · Очистить всё» и список с прокруткой
  const lh = svEl('div', 'vc-lh');
  const list = svEl('div', 'vc-sugs');
  body.append(lh, list);
  vcCards(list);
  const old = p.querySelector('.vc-body');
  const st = old ? old.scrollTop : 0;
  const lst = old ? old.querySelector('.vc-sugs') : null;
  const lsTop = lst ? lst.scrollTop : 0;
  p.replaceChildren(head, body);
  if (fromText) body.scrollTop = st;
  list.scrollTop = lsTop;
  vcFit(list);
  const h = p.querySelector('.vc-heard');
  if (h) h.dataset.noi18n = '';
}
const vcHeardText = () => (vcHeard ? '«' + vcHeard + '»' : 'Слушаю… Назовите место: «Иоанна три шестнадцать».');
// Карточки мест; перерисовываются, только когда список или подсветка «нового» поменялись
function vcCards(list) {
  const key = vcSugs.map((s, i) => s.ref + '@' + s.at + (i === 0 && Date.now() - s.at < 8000 ? '!' : '')).join('|');
  if (list.dataset.k === key) return;
  const firstOld = list.dataset.first || '';
  list.dataset.k = key;
  list.dataset.first = vcSugs[0] ? vcSugs[0].ref + '@' + vcSugs[0].at : '';
  const lh = list.previousElementSibling;
  if (lh && lh.classList.contains('vc-lh')) {
    lh.replaceChildren();
    if (vcSugs.length) {
      const clr = svBtn('Очистить всё', () => { vcSugs = []; vcPaint(); flashStatus('Список мест очищен'); });
      clr.title = 'Убрать из списка все найденные и предложенные места';
      lh.append(svEl('span', '', `Найдено: ${vcSugs.length}`), clr);
    }
  }
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
  if (list.dataset.first !== firstOld) list.dataset.top = '1';
  if (list.isConnected) vcFit(list); // при сборке панели — vcFit после вставки (vcPaint)
}
// Высота списка: первое место целиком, следующее — наполовину (видно, что дальше есть ещё); новое место — прокрутка вверх
function vcFit(list) {
  const [a, b] = list.children;
  list.style.maxHeight = a && b ? Math.round(a.offsetHeight + 8 + b.offsetHeight / 2) + 'px' : '';
  if (list.dataset.top) { list.scrollTop = 0; delete list.dataset.top; }
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
      vcCtxSet(r.bi, r.ci, prev.v2);
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
  vcCtxSet(r.bi, r.ci, r.v2 || r.v1);
  vcSugs = vcSugs.slice(0, VC_KEEP);
  flashStatus('По словам: ' + r.ref);
  vcPaint(true);
}
