// Разбор файлов Библии, поиск места по ссылке и поиск по словам.
const Bible = (() => {
  // Порядок книг — как в стандартном каноне (Римлянам = 45). Книги ищутся по названию,
  // поэтому переводы с другим порядком (например, синодальным) тоже работают.
  // [русское название, русские сокращения, английское название, английские сокращения]
  const CANON = [
    ['Бытие', 'быт|бт', 'Genesis', 'gen|ge|gn'],
    ['Исход', 'исх', 'Exodus', 'exo|ex|exod'],
    ['Левит', 'лев', 'Leviticus', 'lev|le|lv'],
    ['Числа', 'чис|числ', 'Numbers', 'num|nu|nm|nb'],
    ['Второзаконие', 'втор|вт', 'Deuteronomy', 'deu|dt|deut'],
    ['Иисус Навин', 'нав|навин|ис нав|иис нав', 'Joshua', 'jos|josh|jsh'],
    ['Судей', 'суд|судьи', 'Judges', 'jdg|judg|jg'],
    ['Руфь', 'руф', 'Ruth', 'rut|ru|rth'],
    ['1 Царств', '1цар|1сам|1самуила', '1 Samuel', '1sa|1sam|1sm'],
    ['2 Царств', '2цар|2сам|2самуила', '2 Samuel', '2sa|2sam|2sm'],
    ['3 Царств', '3цар|1царей', '1 Kings', '1ki|1kgs|1kin'],
    ['4 Царств', '4цар|2царей', '2 Kings', '2ki|2kgs|2kin'],
    ['1 Паралипоменон', '1пар|1хр|1летопись', '1 Chronicles', '1ch|1chr|1chron'],
    ['2 Паралипоменон', '2пар|2хр|2летопись', '2 Chronicles', '2ch|2chr|2chron'],
    ['Ездра', 'езд', 'Ezra', 'ezr'],
    ['Неемия', 'неем', 'Nehemiah', 'neh|ne'],
    ['Есфирь', 'есф', 'Esther', 'est|esth'],
    ['Иов', 'иов', 'Job', 'job|jb'],
    ['Псалтирь', 'пс|псалом|псалмы|псалтырь|псл', 'Psalms', 'psa|ps|psalm|pss'],
    ['Притчи', 'притч|прит|пр', 'Proverbs', 'pro|prov|pr|prv'],
    ['Екклесиаст', 'еккл|екк|эккл|экклесиаст', 'Ecclesiastes', 'ecc|eccl|ecl'],
    ['Песня Песней', 'песн|пес|песнь песней', 'Song of Solomon', 'song|sos|sng|songofsongs|canticles'],
    ['Исаия', 'ис|исайя|исаи', 'Isaiah', 'isa'],
    ['Иеремия', 'иер|иерем', 'Jeremiah', 'jer'],
    ['Плач Иеремии', 'плач|пл', 'Lamentations', 'lam'],
    ['Иезекииль', 'иез|иезек', 'Ezekiel', 'eze|ezk|ezek'],
    ['Даниил', 'дан', 'Daniel', 'dan|dn'],
    ['Осия', 'ос', 'Hosea', 'hos'],
    ['Иоиль', 'иоил', 'Joel', 'joe|jl'],
    ['Амос', 'ам', 'Amos', 'amo'],
    ['Авдий', 'авд', 'Obadiah', 'oba|obad|ob'],
    ['Иона', 'ион', 'Jonah', 'jon|jnh'],
    ['Михей', 'мих', 'Micah', 'mic'],
    ['Наум', 'наум', 'Nahum', 'nah|na'],
    ['Аввакум', 'авв', 'Habakkuk', 'hab'],
    ['Софония', 'соф', 'Zephaniah', 'zep|zeph'],
    ['Аггей', 'агг', 'Haggai', 'hag'],
    ['Захария', 'зах', 'Zechariah', 'zec|zech'],
    ['Малахия', 'мал', 'Malachi', 'mal'],
    ['Матфея', 'мф|матф|мат|матфей|от матфея', 'Matthew', 'mat|matt|mt'],
    ['Марка', 'мк|марк|от марка', 'Mark', 'mar|mrk|mk'],
    ['Луки', 'лк|лук|от луки', 'Luke', 'luk|lk'],
    ['Иоанна', 'ин|иоан|иоанн|от иоанна', 'John', 'joh|jhn|jn'],
    ['Деяния', 'деян|дея|деяния апостолов', 'Acts', 'act|ac'],
    ['Римлянам', 'рим', 'Romans', 'rom|ro|rm'],
    ['1 Коринфянам', '1кор', '1 Corinthians', '1co|1cor'],
    ['2 Коринфянам', '2кор', '2 Corinthians', '2co|2cor'],
    ['Галатам', 'гал', 'Galatians', 'gal'],
    ['Ефесянам', 'еф|ефес', 'Ephesians', 'eph'],
    ['Филиппийцам', 'флп|фил|филип', 'Philippians', 'phi|php|phil'],
    ['Колоссянам', 'кол|колос', 'Colossians', 'col'],
    ['1 Фессалоникийцам', '1фес|1солунянам', '1 Thessalonians', '1th|1thess|1thes'],
    ['2 Фессалоникийцам', '2фес|2солунянам', '2 Thessalonians', '2th|2thess|2thes'],
    ['1 Тимофею', '1тим', '1 Timothy', '1ti|1tim'],
    ['2 Тимофею', '2тим', '2 Timothy', '2ti|2tim'],
    ['Титу', 'тит', 'Titus', 'tit'],
    ['Филимону', 'флм|филим|филимон', 'Philemon', 'phm|phlm|philem'],
    ['Евреям', 'евр', 'Hebrews', 'heb'],
    ['Иакова', 'иак', 'James', 'jam|jas|jm'],
    ['1 Петра', '1пет|1пт', '1 Peter', '1pe|1pet|1pt'],
    ['2 Петра', '2пет|2пт', '2 Peter', '2pe|2pet|2pt'],
    ['1 Иоанна', '1ин|1иоан', '1 John', '1jn|1jo|1joh|1john'],
    ['2 Иоанна', '2ин|2иоан', '2 John', '2jn|2jo|2joh|2john'],
    ['3 Иоанна', '3ин|3иоан', '3 John', '3jn|3jo|3joh|3john'],
    ['Иуды', 'иуд|иуда', 'Jude', 'jud|jude|jde'],
    ['Откровение', 'откр|апок|апокалипсис', 'Revelation', 'rev|re|revelations'],
  ];

  const OSIS = ('gen exod lev num deut josh judg ruth 1sam 2sam 1kgs 2kgs 1chr 2chr ezra neh esth job ps prov eccl song ' +
    'isa jer lam ezek dan hos joel amos obad jonah mic nah hab zeph hag zech mal matt mark luke john acts rom 1cor 2cor ' +
    'gal eph phil col 1thess 2thess 1tim 2tim titus phlm heb jas 1pet 2pet 1john 2john 3john jude rev').split(' ');

  const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');

  // Приводит название книги к единому виду: «1 Кор.», «1-е кор», «I Cor» -> «1кор»
  function key(s) {
    let t = norm(s).replace(/[.\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
    // «Первое послание к Коринфянам», «К Римлянам», «Евангелие от Матфея» -> «1 коринфянам», «римлянам», «матфея»
    t = t.replace(/^(перв|втор|трет)(ое|ая|ой|ье)\s+/, (m, a) => ({ перв: '1', втор: '2', трет: '3' }[a] + ' '));
    t = t.replace(/^(\d\s+)?(соборное\s+)?(послание|евангелие)\s+(святого\s+)?(апостола\s+)?/, '$1');
    t = t.replace(/^(\d\s+)?(к|от)\s+/, '$1');
    t = t.replace(/^(iii|ii|i)(?=\s)/, (m) => ({ i: '1', ii: '2', iii: '3' }[m]));
    t = t.replace(/^([1-3])[-‑]?(?:е|я|ая|ое|й)?\s+/, '$1');
    return t.replace(/[\s\-‑]/g, '');
  }

  const ALIAS = new Map();
  CANON.forEach((b, i) => {
    for (const s of [b[0], b[2], ...b[1].split('|'), ...b[3].split('|')]) if (s) ALIAS.set(key(s), i + 1);
  });
  OSIS.forEach((s, i) => ALIAS.set(key(s), i + 1));

  const canonName = (canon) => (CANON[canon - 1] ? CANON[canon - 1][0] : '');

  /* ---------- Разбор файлов ---------- */

  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  const lname = (e) => e.localName.toLowerCase();
  const kids = (e, test) => [...e.children].filter(test);

  // Атрибуты XML читаем без учёта регистра (osisID, OsisID, osisid)
  function attr(e, name) {
    for (const a of e.attributes) if (a.name.toLowerCase() === name) return a.value;
    return null;
  }
  function numAttr(e, names) {
    for (const n of names) {
      const v = attr(e, n);
      if (v == null) continue;
      const m = String(v).match(/(\d+)(?!.*\d)/);
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  }
  function strAttr(e, names) {
    for (const n of names) {
      const v = attr(e, n);
      if (v && !/^\d+$/.test(v.trim())) return v.trim();
    }
    return '';
  }

  const SKIP = ['note', 'rmk', 'remark', 'fn'];
  function txt(node) {
    let s = '';
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3 || c.nodeType === 4) s += c.nodeValue;
      else if (c.nodeType === 1 && !SKIP.includes(lname(c))) s += txt(c);
    });
    return s;
  }

  function finish(raw, name) {
    const total = raw.length;
    const books = raw
      .map((b, i) => {
        let canon = b.canon >= 1 && b.canon <= 66 ? b.canon : 0;
        if (!canon) for (const nm of b.names) {
          const k = key(nm);
          if (k && ALIAS.has(k)) { canon = ALIAS.get(k); break; }
        }
        if (!canon) {
          // «Откровение Иоанна Богослова», «Деяния святых апостолов»: ищем самое длинное известное начало
          for (const nm of b.names) {
            const k = key(nm);
            let best = 0;
            for (const [a, id] of ALIAS) if (a.length >= 4 && k.startsWith(a) && a.length > best) { best = a.length; canon = id; }
            if (canon) break;
          }
        }
        if (!canon) {
          const cand = b.num || i + 1;
          if (total === 66 && cand >= 1 && cand <= 66) canon = cand;
        }
        return { canon, name: b.name || canonName(canon) || b.names.find(Boolean) || `Книга ${i + 1}`, chapters: b.chapters };
      })
      .filter((b) => b.chapters.some((c) => c.length));
    if (!books.length) throw new Error('в файле не найдено ни одного стиха');
    return { name, books };
  }

  const isChapter = (e) => ['chapter', 'c'].includes(lname(e)) || (lname(e) === 'div' && attr(e, 'type') === 'chapter');
  const isVerse = (e) => ['vers', 'verse', 'v'].includes(lname(e));
  const isBook = (e) => ['biblebook', 'book', 'b'].includes(lname(e)) || (lname(e) === 'div' && attr(e, 'type') === 'book');

  function parseXml(text, fileName) {
    text = text.replace(/&nbsp;/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('файл повреждён или это не XML-Библия');
    const root = doc.documentElement;

    let name = attr(root, 'biblename') || attr(root, 'name') || '';
    if (!name) {
      const t = [...doc.getElementsByTagName('*')].find((e) => lname(e) === 'title');
      if (t) name = clean(t.textContent);
    }

    const bookEls = [...doc.getElementsByTagName('*')].filter((e) => isBook(e) && kids(e, isChapter).length);
    // OSIS, где стихи — метки <verse sID/> … <verse eID/>, а не обёртки текста
    const milestones = [...doc.getElementsByTagName('*')].some((e) => isVerse(e) && (attr(e, 'sid') || attr(e, 'eid')));
    if (milestones || !bookEls.length) {
      const r = parseOsisMilestones(doc, name || fileName);
      if (r) return r;
    }
    if (!bookEls.length) throw new Error('не найдены книги: формат XML не распознан');

    let verseCount = 0;
    const raw = bookEls.map((be, bi) => {
      const chapters = [];
      kids(be, isChapter).forEach((ce, ci) => {
        const arr = [];
        let seq = 0;
        kids(ce, isVerse).forEach((ve) => {
          seq += 1;
          const n = numAttr(ve, ['vnumber', 'number', 'n', 'osisid']) || seq;
          arr[n - 1] = clean(txt(ve));
          verseCount += 1;
        });
        for (let i = 0; i < arr.length; i++) if (arr[i] == null) arr[i] = '';
        const cn = numAttr(ce, ['cnumber', 'number', 'n', 'osisid']) || ci + 1;
        chapters[cn - 1] = arr;
      });
      for (let i = 0; i < chapters.length; i++) if (!chapters[i]) chapters[i] = [];
      return {
        names: [strAttr(be, ['bname', 'name', 'n', 'title']), strAttr(be, ['bsname', 'shortname']), strAttr(be, ['osisid'])].filter(Boolean),
        name: strAttr(be, ['bname', 'name', 'n', 'title']),
        num: numAttr(be, ['bnumber', 'number', 'num']),
        chapters,
      };
    });
    if (!verseCount) throw new Error('в XML нет стихов в нужном виде');
    return finish(raw, name || fileName);
  }

  // Обходим документ по порядку: текст между <verse sID="Gen.1.1"/> и <verse eID/> — это стих
  function parseOsisMilestones(doc, name) {
    const col = makeCollector();
    const texts = new Map(); // osisID -> текст
    let cur = null;
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3 || c.nodeType === 4) { if (cur) texts.set(cur, (texts.get(cur) || '') + c.nodeValue); continue; }
        if (c.nodeType !== 1) continue;
        const ln = lname(c);
        if (SKIP.includes(ln) || ln === 'title') continue;
        if (isVerse(c)) {
          if (attr(c, 'eid')) { cur = null; continue; }
          const id = (attr(c, 'osisid') || attr(c, 'sid') || '').split(/\s+/)[0];
          if (!c.childNodes.length) { cur = id || null; continue; }
          // Стих-обёртка внутри OSIS
          if (id) texts.set(id, (texts.get(id) || '') + txt(c));
          continue;
        }
        walk(c);
      }
    };
    walk(doc.documentElement);
    for (const [id, t] of texts) {
      const m = id.match(/^(.+)\.(\d+)\.(\d+)$/);
      if (m) col.add(key(m[1]), m[1], 0, +m[2], +m[3], t);
    }
    try { return col.done(name); } catch { return null; }
  }

  // USFM: \id GEN, \h Бытие, \c 1, \v 1 текст; сноски \f … \f* и прочие пометки убираем
  function parseUsfm(text, fileName) {
    const col = makeCollector();
    let id = '', title = '', ch = 0, v = 0, buf = '';
    const flush = () => { if (id && ch && v) col.add(id, title || id, 0, ch, v, buf); buf = ''; };
    const cleanLine = (s) => s
      .replace(/\\(f|x|fe)\s.*?\\\1\*/g, '')
      .replace(/\\w\s+([^|\\]*)(\|[^\\]*)?\\w\*/g, '$1')
      .replace(/\\\+?[a-z]+\d*\*?/gi, '');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*\\([a-z]+\d*)\s*(.*)$/i);
      const tag = m ? m[1].toLowerCase() : '';
      const rest = m ? m[2] : line;
      if (tag === 'id') { flush(); id = rest.trim().split(/\s+/)[0]; title = ''; ch = 0; v = 0; continue; }
      if (['h', 'toc1', 'toc2', 'mt', 'mt1'].includes(tag)) { if (!title || tag === 'h') title = cleanLine(rest).trim() || title; continue; }
      if (tag === 'c') { flush(); ch = parseInt(rest, 10) || 0; v = 0; continue; }
      if (/^(s\d*|ms\d*|mr|r|d|sp|rem|toc\d|ide|sts|cl|cp)$/.test(tag)) continue;
      // В одной строке может быть несколько стихов: \v 1 … \v 2 …
      const pieces = (m ? line.trim() : rest).split(/\\v\s+/);
      if (pieces[0].trim() && v) buf += ' ' + cleanLine(pieces[0].replace(/^\\[a-z]+\d*\s*/i, ''));
      for (const p of pieces.slice(1)) {
        flush();
        const vm = p.match(/^(\d+)[a-z]?(?:-\d+)?\s*(.*)$/i);
        if (!vm) continue;
        v = +vm[1];
        buf = cleanLine(vm[2]);
      }
    }
    flush();
    return col.done(fileName);
  }

  // Готовые строки из баз MyBible / e-Sword: { canon, book, c, v, t }
  function fromRows(rows, name) {
    const col = makeCollector();
    for (const r of rows) {
      const bk = r.book || canonName(r.canon) || 'Книга';
      col.add(r.canon ? '#' + r.canon : key(bk), bk, 0, r.c, r.v, r.t, r.canon);
    }
    return col.done(name);
  }

  // Строка CSV с кавычками: "Быт",1,1,"В начале, сотворил…"
  function splitCsv(line, sep) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"' && !cur.trim()) q = true;
      else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  }

  // Книги из JSON/текста собираются по порядку появления
  function makeCollector() {
    const map = new Map();
    return {
      add(bookKey, bookName, num, ch, v, t, canon) {
        t = clean(String(t || ''));
        if (!t || !(ch >= 1) || !(v >= 1)) return;
        let b = map.get(bookKey);
        if (!b) { b = { names: [bookName], name: canon ? bookName : '', num, canon: canon || 0, chapters: [] }; map.set(bookKey, b); }
        const c = (b.chapters[ch - 1] = b.chapters[ch - 1] || []);
        c[v - 1] = t;
      },
      done(name) {
        const raw = [...map.values()];
        raw.forEach((b) => {
          b.chapters = b.chapters.map((c) => (c ? Array.from(c, (x) => x || '') : []));
          for (let i = 0; i < b.chapters.length; i++) if (!b.chapters[i]) b.chapters[i] = [];
        });
        return finish(raw, name);
      },
    };
  }

  function parseText(text, fileName) {
    const col = makeCollector();
    const lines = text.split(/\r?\n/);
    // Разделитель столбцов: табуляция (Unbound Bible), иначе «;» или «,» (CSV из Excel)
    const head = lines.slice(0, 50).join('\n');
    const sep = head.includes('\t') ? '\t'
      : /^[^;\n]*;\s*\d+\s*;\s*\d+\s*;/m.test(head) ? ';'
      : /^[^,\n]*,\s*"?\d+"?\s*,\s*"?\d+"?\s*,/m.test(head) ? ',' : '\t';
    for (const line of lines) {
      if (!line.trim() || /^\s*(#|\/\/)/.test(line)) continue;
      const cols = sep === '\t' ? line.split('\t') : splitCsv(line, sep).map((c) => c.trim());
      let m;
      if (sep === '\t' && cols.length >= 6 && /^\d+[ON]?$/i.test(cols[0].trim()) && /^\d+$/.test(cols[1].trim())) {
        const n = parseInt(cols[0], 10); // формат Unbound Bible
        col.add('#' + n, canonName(n), n, +cols[1], +cols[2], cols[cols.length - 1], n <= 66 ? n : 0);
      } else if (cols.length >= 4 && /^\d+$/.test(cols[1].trim()) && /^\d+$/.test(cols[2].trim())) {
        const bk = cols[0].trim();
        const n = /^\d+$/.test(bk) ? +bk : 0;
        if (n) col.add('#' + n, canonName(n) || bk, n, +cols[1], +cols[2], cols.slice(3).join(sep === '\t' ? ' ' : sep + ' '), n <= 66 ? n : 0);
        else col.add(key(bk), bk, 0, +cols[1], +cols[2], cols.slice(3).join(sep === '\t' ? ' ' : sep + ' '));
      } else if ((m = line.match(/^\s*((?:[1-3]\s*[-‑]?\s*(?:е|я)?\s*)?[^\d\s:][^\d:]*?)\s+(\d+)\s*[:.,]\s*(\d+)\s*[-.:)\]]?\s+(.+)$/))) {
        col.add(key(m[1]), m[1].trim(), 0, +m[2], +m[3], m[4]);
      }
    }
    return col.done(fileName);
  }

  function parseJson(text, fileName) {
    const data = JSON.parse(text);
    const name = (!Array.isArray(data) && (data.name || data.title || data.translation || data.version)) || fileName;
    const col = makeCollector();
    const vtext = (x) => (typeof x === 'string' ? x : x && (x.text || x.t || x.verse_text || x.content) || '');

    const addChapters = (bk, chs) => {
      const entries = Array.isArray(chs) ? chs.map((c, i) => [i + 1, c]) : Object.entries(chs).map(([k, c]) => [+k, c]);
      for (const [cn, c] of entries) {
        const vs = Array.isArray(c) ? c.map((v, i) => [i + 1, v]) : Object.entries(c || {}).map(([k, v]) => [+k, v]);
        for (const [vn, v] of vs) col.add(key(bk), bk, 0, cn, vn, vtext(v));
      }
    };

    let books = Array.isArray(data) ? data : data.books || data.bible || null;
    if (books && Array.isArray(books) && books.length && (books[0].chapters || books[0].chapter == null) && !('verse' in books[0])) {
      books.forEach((b, i) => addChapters(String(b.name || b.book || b.book_name || b.title || i + 1), b.chapters || []));
    } else if (Array.isArray(books)) {
      books.forEach((r) => {
        const bk = String(r.book_name || r.book || r.b || r.bookname || '');
        col.add(key(bk), bk, /^\d+$/.test(bk) ? +bk : 0, +(r.chapter ?? r.c), +(r.verse ?? r.v), vtext(r));
      });
    } else {
      const obj = books && !Array.isArray(books) ? books : data;
      for (const [bk, chs] of Object.entries(obj)) if (chs && typeof chs === 'object') addChapters(bk, chs);
    }
    return col.done(name);
  }

  function parse(text, fileName) {
    const t = text.replace(/^\uFEFF/, '').trimStart();
    try {
      if (t.startsWith('<')) return parseXml(t, fileName);
      if (t.startsWith('{') || t.startsWith('[')) return parseJson(t, fileName);
      if (/^\\id\s/m.test(t.slice(0, 5000)) || (/^\\c\s+\d/m.test(t) && /\\v\s+\d/.test(t))) return parseUsfm(t, fileName);
      return parseText(t, fileName);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error('не удалось прочитать файл');
      throw e;
    }
  }

  /* ---------- Ссылки: «Ин 3:16», «1 Кор 13:4-7», «Пс 22» ---------- */

  function parseRef(input) {
    const s = String(input).trim().replace(/[–—]/g, '-');
    const m = s.match(/^([1-3]?[\s.\-]*[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s.\-]*?)[\s.]*(\d+)?(?:[\s:.,]+(\d+)(?:\s*-\s*(\d+))?)?\s*$/);
    if (!m) return null;
    const v1 = m[3] ? +m[3] : 0;
    return { token: m[1].trim(), ch: m[2] ? +m[2] : 1, v1, v2: m[4] ? Math.max(+m[4], v1) : v1 };
  }

  // Находит номер книги в переводе по тексту, который ввёл пользователь
  function findBook(bible, token) {
    const k = key(token);
    if (!k) return -1;
    let i = bible.books.findIndex((b) => key(b.name) === k);
    if (i >= 0) return i;
    if (ALIAS.has(k)) {
      i = bible.books.findIndex((b) => b.canon === ALIAS.get(k));
      if (i >= 0) return i;
    }
    i = bible.books.findIndex((b) => key(b.name).startsWith(k));
    if (i >= 0) return i;
    if (k.length >= 2) {
      for (const [a, canon] of ALIAS) {
        if (a.startsWith(k)) {
          i = bible.books.findIndex((b) => b.canon === canon);
          if (i >= 0) return i;
        }
      }
    }
    return -1;
  }

  /* ---------- Поиск по словам ---------- */

  const normCache = new WeakMap();

  function search(bible, query, scope, limit = 400) {
    const words = norm(query).split(/[\s,.;:!?"«»()]+/).filter(Boolean);
    if (!words.length) return { results: [], words, more: false };
    let cache = normCache.get(bible);
    if (!cache) { cache = bible.books.map((b) => b.chapters.map((c) => c.map(norm))); normCache.set(bible, cache); }
    const results = [];
    let more = false;
    outer:
    for (let bi = 0; bi < bible.books.length; bi++) {
      const b = bible.books[bi];
      if (scope === 'ot' && !(b.canon >= 1 && b.canon <= 39)) continue;
      if (scope === 'nt' && !(b.canon >= 40 && b.canon <= 66)) continue;
      for (let ci = 0; ci < b.chapters.length; ci++) {
        const nv = cache[bi][ci];
        for (let vi = 0; vi < nv.length; vi++) {
          const t = nv[vi];
          if (t && words.every((w) => t.includes(w))) {
            if (results.length >= limit) { more = true; break outer; }
            results.push({ bi, ci, v: vi + 1, text: b.chapters[ci][vi] });
          }
        }
      }
    }
    return { results, words, more };
  }

  // Регулярное выражение для подсветки найденных слов (е и ё считаются одной буквой)
  function highlightRegex(words) {
    const parts = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]'));
    return parts.length ? new RegExp(parts.join('|'), 'gi') : null;
  }

  // Какой это формат — для библиотеки переводов
  function formatOf(text) {
    const t = text.replace(/^﻿/, '').trimStart();
    if (t.startsWith('<')) return /<osis/i.test(t.slice(0, 2000)) ? 'OSIS' : /<xmlbible|zefania/i.test(t.slice(0, 2000)) ? 'Zefania' : 'XML';
    if (t.startsWith('{') || t.startsWith('[')) return 'JSON';
    if (/^\\id\s/m.test(t.slice(0, 5000))) return 'USFM';
    return 'Текст';
  }

  return { parse, parseRef, findBook, search, highlightRegex, canonName, fromRows, formatOf };
})();
