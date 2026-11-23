// Карты (mapview.js): модель — координаты в долях картинки, маршруты по точкам, содержимое для экрана
const test = require('node:test');
const assert = require('node:assert');
const MapView = require('../mapview.js');

const file = { name: 'Палестина', w: 4000, h: 3000, img: { path: 'C:/m/a.png', url: 'file:///C:/m/a.png' }, p: { path: 'p', url: 'file:///p.jpg' }, b: { path: 'b', url: 'file:///b.jpg' }, t: { path: 't', url: 'file:///t.jpg' } };

test('новая карта: пустые точки и маршруты, вид по умолчанию', () => {
  const m = MapView.newMap(file);
  assert.ok(m.id);
  assert.deepStrictEqual(m.points, []);
  assert.deepStrictEqual(m.routes, []);
  assert.strictEqual(m.look.layout, 'side');
  assert.strictEqual(m.layers.labels, true);
});

test('точка: координаты зажаты в 0–1, неизвестный тип и значок — по умолчанию', () => {
  const p = MapView.normPoint({ name: 'Иерусалим', x: 1.7, y: -2, type: 'nope', icon: 'nope', color: 'red', refs: ['Ин 2:13', '', 5], events: [{ t: 'Вход Господень', ref: 'Мф 21:1' }, null] });
  assert.strictEqual(p.x, 1);
  assert.strictEqual(p.y, 0);
  assert.strictEqual(p.type, 'city');
  assert.strictEqual(p.icon, '');
  assert.strictEqual(p.color, '');
  assert.deepStrictEqual(p.refs, ['Ин 2:13']);
  assert.deepStrictEqual(p.events, [{ t: 'Вход Господень', ref: 'Мф 21:1' }]);
});

test('маршрут: остановки только из существующих точек', () => {
  const m = MapView.normMap({ ...file, points: [{ id: 'a', x: 0.1, y: 0.1 }, { id: 'b', x: 0.9, y: 0.9 }], routes: [{ id: 'r', stops: ['a', 'zzz', 'b'] }] });
  assert.deepStrictEqual(m.routes[0].stops, ['a', 'b']);
});

test('содержимое для экрана: выбранная точка с карточкой, скрытые слои и маршрут', () => {
  const m = MapView.normMap({
    ...file,
    points: [
      { id: 'a', name: 'Вифлеем', x: 0.4, y: 0.6, type: 'city', short: 'Город Давидов', refs: ['Мих 5:2'] },
      { id: 'b', name: 'Иерусалим', x: 0.45, y: 0.5, type: 'city' },
      { id: 'c', name: 'Мёртвое море', x: 0.6, y: 0.6, type: 'water' },
    ],
    routes: [{ id: 'r', stops: ['a', 'b'], color: '#2f80ed' }],
    layers: { hide: { water: true } },
  });
  const c = MapView.content(m, { point: 'a', layout: 'over' });
  assert.strictEqual(c.type, 'map');
  assert.strictEqual(c.key, m.id);
  assert.strictEqual(c.url, 'file:///b.jpg');   // на экран — большая копия
  assert.strictEqual(c.prev, 'file:///p.jpg');  // сначала — лёгкое превью
  assert.strictEqual(c.layout, 'over');
  assert.strictEqual(c.point.name, 'Вифлеем');
  assert.deepStrictEqual(c.point.refs, ['Мих 5:2']);
  assert.deepStrictEqual(c.points.map((p) => p.id), ['a', 'b']); // море скрыто слоем
  assert.strictEqual(c.routes.length, 1);
  assert.deepStrictEqual(c.routes[0].stops.map((s) => s[2]), ['a', 'b']);
  // Неизвестная компоновка — как у карты
  assert.strictEqual(MapView.content(m, { layout: 'xx' }).layout, 'side');
  // Только один маршрут и рамка по нему
  const r = MapView.content(m, { routes: ['r'], fit: MapView.bounds(m.points.slice(0, 2)) });
  assert.deepStrictEqual(r.fit, [0.4, 0.5, 0.45, 0.6]);
});

test('куда смотрит карта: панель справа сужает карту, «с подписью» приближает к точке', () => {
  const base = { w: 2000, h: 1000, look: { ...MapView.DEF_LOOK }, fit: null };
  const pt = { id: 'a', x: 0.5, y: 0.5 };
  const full = MapView.target({ ...base, layout: 'map', point: null }, 1920, 1080);
  assert.strictEqual(full.vw, 1920);
  assert.ok(Math.abs(full.s - 0.96) < 1e-9); // вписана по ширине
  const side = MapView.target({ ...base, layout: 'side', point: pt }, 1920, 1080);
  assert.ok(Math.abs(side.vw - 1920 * 0.62) < 1e-6);
  const focus = MapView.target({ ...base, layout: 'focus', point: pt }, 1920, 1080);
  assert.ok(focus.s > full.s * 2);
  // Точка в центре окна карты (картинка не уезжает за край, пока есть куда)
  assert.ok(Math.abs(focus.tx + 0.5 * 2000 * focus.s - 960) < 1);
  const card = MapView.target({ ...base, layout: 'card', point: pt }, 1920, 1080);
  assert.strictEqual(card.op, 0);
});

// ----- Нейросеть: инструкция, разбор ответа, расстановка по координатам (mapsai.js) -----
const MapsAI = require('../mapsai.js');
const { skillFromMd } = require('../промпты/карты-синхронизация.js');

test('инструкция в mapsai.js совпадает с промпты/ПРОМПТ-КАРТЫ.md', () => {
  assert.equal(MapsAI.SKILL, skillFromMd());
  assert.match(MapsAI.prompt('pt', 'Вифлеем', 'Палестина'), /ЗАПРОС: карточка места «Вифлеем» \(для карты «Палестина»\)/);
  assert.match(MapsAI.prompt('list', 'Путешествия Павла'), /places/);
});

test('ответ нейросети: JSON в тексте, кавычки, лишние запятые, список мест', () => {
  const one = MapsAI.parse('Вот:\n```json\n{ "name": "Вифлеем", "type": "city", "geo": { "lat": 31.7, "lon": 35.2 }, "events": [{ "t": "Рождество", "ref": "Лк 2:4-7" }], "refs": ["Мих 5:2",], "sources": [{ "title": "Брокгауз", "url": "" }] }\n```\nПроверьте.');
  assert.equal(one.many, false);
  assert.deepEqual(one.places[0].geo, { lat: 31.7, lon: 35.2 });
  assert.deepEqual(one.places[0].refs, ['Мих 5:2']);
  assert.deepEqual(one.places[0].sources, ['Брокгауз']);
  const list = MapsAI.parse('{ "map": "x", "places": [{ "name": "А" }, { "name": "Б", "type": "nonsense", "geo": { "lat": 200, "lon": 1 } }] }');
  assert.equal(list.many, true);
  assert.equal(list.places.length, 2);
  assert.equal(list.places[1].type, undefined);
  assert.equal(list.places[1].geo, undefined);
  assert.throws(() => MapsAI.parse('нет тут ничего'));
});

test('слияние в точку: тексты заменяются, списки без повторов, имя можно сохранить', () => {
  const p = { name: 'Мой Вифлеем', type: 'village', short: '', desc: 'старое', history: '', dates: '', events: [{ t: 'Рождество', ref: 'Лк 2:4-7' }], refs: ['Мих 5:2'], sources: [] };
  MapsAI.merge(p, MapsAI.place({ name: 'Вифлеем', type: 'city', desc: 'новое', events: [{ t: 'рождество', ref: 'Лк 2:4-7' }, { t: 'Помазание Давида', ref: '1 Цар 16:13' }], refs: ['Мих 5:2', 'Руф 1:19'], sources: ['Брокгауз'] }), true);
  assert.equal(p.name, 'Мой Вифлеем');
  assert.equal(p.type, 'city');
  assert.equal(p.desc, 'новое');
  assert.equal(p.events.length, 2);
  assert.deepEqual(p.refs, ['Мих 5:2', 'Руф 1:19']);
  assert.deepEqual(p.sources, ['Брокгауз']);
});

test('расстановка по координатам: 2 и 3 точки, поставленные вручную', () => {
  // Картинка: долгота 34–36 → x 0–1, широта 33–31 → y 0–1
  const at = (lon, lat) => ({ x: (lon - 34) / 2, y: (33 - lat) / 2, geo: { lat, lon } });
  assert.equal(MapsAI.calib([at(35, 32)]), null);
  const two = MapsAI.calib([at(34.5, 32.5), at(35.5, 31.5)]);
  const [x, y] = two({ lat: 31.75, lon: 35.25 });
  assert.ok(Math.abs(x - 0.625) < 1e-9 && Math.abs(y - 0.625) < 1e-9);
  const three = MapsAI.calib([at(34.5, 32.5), at(35.5, 31.5), at(34.2, 31.2), { ...at(35, 32), auto: true }]);
  const [x3, y3] = three({ lat: 32, lon: 35 });
  assert.ok(Math.abs(x3 - 0.5) < 1e-9 && Math.abs(y3 - 0.5) < 1e-9);
});
