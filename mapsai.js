/* Карты + нейросеть: инструкция (промпт), разбор ответа (JSON) и расстановка точек по координатам.
   Текст инструкции — копия раздела «ИНСТРУКЦИЯ ДЛЯ НЕЙРОСЕТИ» из файла «промпты/ПРОМПТ-КАРТЫ.md»
   (test/maps.test.js проверяет, что они совпадают; поменяли файл — обновите SKILL: node промпты/карты-синхронизация.js). */
const MapsAI = (() => {
  const SKILL = "Ты — помощник служителя, который показывает библейские карты на экране в церкви (программа multiplayerSHOW, вкладка «Карты»). По названию места ты готовишь проверяемую карточку места; по теме карты — список мест с карточками. Отвечай по-русски. Ответ — только JSON по схеме ниже, без текста до и после него.\n\n## Достоверность — главное правило\n1. Пиши только то, что подтверждается источниками. Основной источник — Библия (Синодальный перевод). Дальше — признанные справочники: библейские энциклопедии и словари (Библейская энциклопедия Брокгауза; Библейская энциклопедия архимандрита Никифора; «Новый библейский словарь»; The Anchor Yale Bible Dictionary; International Standard Bible Encyclopedia; Eerdmans Dictionary of the Bible), библейские атласы (Aharoni, Avi-Yonah и др. — The Carta / Macmillan Bible Atlas; Oxford Bible Atlas; Zondervan Atlas of the Bible), археологические публикации (Israel Antiquities Authority, отчёты раскопок), географические базы (Pleiades — pleiades.stoa.org; OpenBible.info Bible Geocoding).\n2. Никогда не придумывай источники, авторов, страницы и ссылки. Ссылку (URL) давай только если уверен, что она существует; иначе — только название издания и статьи.\n3. Отделяй текст Библии от предания и от научных гипотез: «по преданию…», «по одной из версий…», «отождествление спорно».\n4. Даты древних событий почти всегда приблизительны: пиши «ок.», а если у учёных несколько датировок — укажи обе коротко (например, «ок. 1446 или ок. 1260 г. до Р. Х.»). Эпохи: «до Р. Х.» / «по Р. Х.».\n5. Если место не отождествлено — так и скажи в «history», «geo» поставь null, «confidence» — \"low\".\n6. Не выдумывай события, которых нет в Библии, и не приписывай месту события другого города с похожим названием (например, Вифсаида и Вифания, Кесария Приморская и Кесария Филиппова — разные места).\n\n## Места Писания\nТолько сокращения Синодального перевода и его нумерация стихов (у Псалмов она отличается от западной): Быт, Исх, Лев, Чис, Втор, Нав, Суд, Руф, 1 Цар, 2 Цар, 3 Цар, 4 Цар, 1 Пар, 2 Пар, Езд, Неем, Есф, Иов, Пс, Притч, Еккл, Песн, Ис, Иер, Плач, Иез, Дан, Ос, Иоил, Ам, Авд, Ион, Мих, Наум, Авв, Соф, Агг, Зах, Мал, Мф, Мк, Лк, Ин, Деян, Иак, 1 Пет, 2 Пет, 1 Ин, 2 Ин, 3 Ин, Иуд, Рим, 1 Кор, 2 Кор, Гал, Еф, Флп, Кол, 1 Фес, 2 Фес, 1 Тим, 2 Тим, Тит, Флм, Евр, Откр.\nФормат: «Ин 4:5», «1 Кор 13:4-7», «Быт 12:6» — книга, пробел, глава:стих или глава:стих-стих. Одно место — одна строка, без слов «см.» и без глав целиком.\n\n## Что писать в каждом поле\n- **name** — название, как в Синодальном переводе. Если в Библии место называется по-разному — основное название, другие в «history».\n- **type** — одно из: city (город), village (селение), mountain (гора), water (море, озеро), river (река), region (область, страна), desert (пустыня), event (место события), place (другое место).\n- **dates** — коротко: время существования или главный библейский период (до 60 знаков). Например: «ок. 1800 г. до Р. Х. — I в. по Р. Х.».\n- **short** — подпись у точки на экране: одна строка до 80 знаков, без точки в конце. Например: «Город, где родился Иисус».\n- **desc** — для зала: 2–4 простых предложения (до 350 знаков) — что это за место и чем оно важно в Библии. Без сносок и ссылок в тексте: это читают с экрана крупным шрифтом.\n- **history** — 2–5 предложений (до 600 знаков): история, другие названия, современное название и где находится, что нашли археологи, насколько надёжно отождествление.\n- **events** — 2–6 главных библейских событий в хронологическом порядке: { \"t\": краткое название события (до 60 знаков), \"ref\": место Писания }.\n- **refs** — 3–8 ключевых мест Писания, где упоминается место (не повторяй те, что уже в events).\n- **geo** — современное отождествление в десятичных градусах: { \"lat\": 31.7767, \"lon\": 35.2345 } (северная широта и восточная долгота — положительные). Если неизвестно — null.\n- **confidence** — насколько надёжно отождествление места: \"high\", \"medium\" или \"low\".\n- **sources** — 2–5 источников строками: «Издание — статья или раздел», при уверенности — с URL через пробел. Например: «Библейская энциклопедия Брокгауза — ст. «Вифлеем»».\n\n## Схема ответа\nОдно место — объект:\n```json\n{\n  \"name\": \"Вифлеем\",\n  \"type\": \"city\",\n  \"dates\": \"ок. XIV в. до Р. Х. — по Р. Х.\",\n  \"short\": \"Город Давида, место рождения Иисуса\",\n  \"desc\": \"Небольшой город в Иудее. Здесь жили Руфь и Вооз, отсюда родом царь Давид. По пророчеству Михея и по Евангелиям здесь родился Иисус Христос.\",\n  \"history\": \"...\",\n  \"events\": [{ \"t\": \"Рождество Христово\", \"ref\": \"Лк 2:4-7\" }],\n  \"refs\": [\"Мих 5:2\", \"Руф 1:19\", \"1 Цар 16:1\"],\n  \"geo\": { \"lat\": 31.704, \"lon\": 35.207 },\n  \"confidence\": \"high\",\n  \"sources\": [\"Библейская энциклопедия Брокгауза — ст. «Вифлеем»\", \"Oxford Bible Atlas — раздел об Иудее времён Нового Завета\"]\n}\n```\nСписок мест для карты — объект { \"map\": \"тема карты\", \"places\": [ ...такие же объекты... ] }. Включай только места, которые действительно относятся к теме карты, в порядке, удобном для рассказа (по маршруту или по хронологии), обычно 5–20 мест."; // @skill — копия из «промпты/ПРОМПТ-КАРТЫ.md»

  const TYPES = ['city', 'village', 'mountain', 'water', 'river', 'region', 'desert', 'event', 'place'];
  const s = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
  const norm = (v) => s(v, 400).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'()]/g, '').replace(/\s+/g, ' ').trim();

  // Запрос: про одно место или про все места карты
  function prompt(kind, name, mapName) {
    const ask = kind === 'list'
      ? `ЗАПРОС: все места для карты «${name}». Ответь объектом { "map": ..., "places": [...] }.`
      : `ЗАПРОС: карточка места «${name}»` + (mapName ? ` (для карты «${mapName}»)` : '') + '. Ответь одним объектом.';
    return SKILL + '\n\n' + ask;
  }

  // Из текста ответа — JSON: без ```json, без слов до и после
  function parse(text) {
    let t = String(text || '').replace(/```(?:json)?/gi, '').trim();
    const a = t.search(/[[{]/);
    if (a < 0) throw new Error('В ответе нет JSON');
    const close = t[a] === '[' ? ']' : '}';
    const b = t.lastIndexOf(close);
    if (b <= a) throw new Error('JSON в ответе оборван');
    t = t.slice(a, b + 1);
    let data;
    try { data = JSON.parse(t); } catch {
      // «Умные» кавычки и запятые в конце — частые огрехи
      data = JSON.parse(t.replace(/[“”„]/g, '"').replace(/,\s*([}\]])/g, '$1'));
    }
    const list = Array.isArray(data) ? data : Array.isArray(data.places) ? data.places : Array.isArray(data.points) ? data.points : [data];
    const places = list.filter((x) => x && typeof x === 'object' && s(x.name)).map(place);
    if (!places.length) throw new Error('В ответе нет ни одного места с названием');
    return { map: s(data.map, 200), places, many: list.length > 1 || Array.isArray(data) || Array.isArray(data.places) };
  }

  // Одно место из ответа → поля точки (только то, что есть)
  function place(x) {
    const o = { name: s(x.name, 200) };
    if (TYPES.includes(x.type)) o.type = x.type;
    for (const k of ['dates', 'short', 'desc', 'history']) if (s(x[k])) o[k] = s(x[k], k === 'dates' ? 200 : k === 'short' ? 600 : 4000);
    const ev = Array.isArray(x.events) ? x.events : [];
    o.events = ev.map((e) => (typeof e === 'string' ? { t: s(e, 400), ref: '' } : { t: s(e && (e.t || e.title || e.event), 400), ref: s(e && (e.ref || e.reference), 120) })).filter((e) => e.t || e.ref);
    o.refs = (Array.isArray(x.refs) ? x.refs : typeof x.refs === 'string' ? x.refs.split(/[;\n]+/) : []).map((r) => s(r, 120)).filter(Boolean);
    o.sources = (Array.isArray(x.sources) ? x.sources : typeof x.sources === 'string' ? x.sources.split(/\n+/) : [])
      .map((r) => (typeof r === 'string' ? s(r, 600) : r && typeof r === 'object' ? [s(r.title || r.name, 400), s(r.url, 600)].filter(Boolean).join(' ') : '')).filter(Boolean);
    const g = x.geo || x.coords || x.coordinates;
    const lat = Number(g && (g.lat ?? g.latitude));
    const lon = Number(g && (g.lon ?? g.lng ?? g.longitude));
    if (g && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) o.geo = { lat, lon };
    if (['high', 'medium', 'low'].includes(x.confidence)) o.confidence = x.confidence;
    return o;
  }

  // Слить ответ в точку: тексты заменяются, если в ответе есть; события, места и источники — добавляются без повторов
  function merge(p, o, keepName) {
    if (!keepName && o.name) p.name = o.name;
    if (o.type) p.type = o.type;
    for (const k of ['dates', 'short', 'desc', 'history']) if (o[k]) p[k] = o[k];
    const evKey = (e) => norm(e.t) + '|' + norm(e.ref);
    const evHave = new Set(p.events.map(evKey));
    for (const e of o.events || []) if (!evHave.has(evKey(e))) { p.events.push(e); evHave.add(evKey(e)); }
    const rHave = new Set(p.refs.map(norm));
    for (const r of o.refs || []) if (!rHave.has(norm(r))) { p.refs.push(r); rHave.add(norm(r)); }
    p.sources = Array.isArray(p.sources) ? p.sources : [];
    const sHave = new Set(p.sources.map(norm));
    for (const r of o.sources || []) if (!sHave.has(norm(r))) { p.sources.push(r); sHave.add(norm(r)); }
    if (o.geo) p.geo = o.geo;
    return p;
  }

  const findByName = (points, name) => { const k = norm(name); return points.find((p) => norm(p.name) === k) || null; };

  // Привязка картинки к координатам по точкам, поставленным вручную (у них есть geo и нет auto).
  // 3+ точки — общий наклон (x и y от широты и долготы), 2 — отдельно по осям. Нет — null
  function calib(points) {
    const a = points.filter((p) => p.geo && !p.auto);
    if (a.length < 2) return null;
    if (a.length >= 3) {
      const fx = fit3(a, (p) => p.x);
      const fy = fit3(a, (p) => p.y);
      if (fx && fy) return (g) => [fx[0] * g.lon + fx[1] * g.lat + fx[2], fy[0] * g.lon + fy[1] * g.lat + fy[2]];
    }
    const fx = fit2(a.map((p) => [p.geo.lon, p.x]));
    const fy = fit2(a.map((p) => [p.geo.lat, p.y]));
    if (!fx || !fy) return null;
    return (g) => [fx[0] * g.lon + fx[1], fy[0] * g.lat + fy[1]];
  }
  // y = k·x + b по методу наименьших квадратов
  function fit2(pts) {
    const n = pts.length;
    const mx = pts.reduce((t, [x]) => t + x, 0) / n;
    const my = pts.reduce((t, [, y]) => t + y, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
    if (sxx < 1e-9) return null;
    const k = sxy / sxx;
    return [k, my - k * mx];
  }
  // v = a·lon + b·lat + c (нормальные уравнения 3×3)
  function fit3(pts, val) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const R = [0, 0, 0];
    for (const p of pts) {
      const r = [p.geo.lon, p.geo.lat, 1];
      for (let i = 0; i < 3; i++) { R[i] += r[i] * val(p); for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; }
    }
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det(M);
    if (Math.abs(d) < 1e-9 * Math.max(1, Math.abs(M[0][0] * M[1][1]))) return null;
    const out = [];
    for (let c = 0; c < 3; c++) { const m = M.map((row, i) => row.map((v, j) => (j === c ? R[i] : v))); out.push(det(m) / d); }
    return out;
  }

  return { SKILL, TYPES, prompt, parse, place, merge, findByName, calib };
})();
if (typeof module !== 'undefined') module.exports = MapsAI;
