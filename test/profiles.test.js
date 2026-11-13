// Тесты профилей (profiles.js): свои и общие данные, переключение, одновременные правки, удаление.
// Запуск: node --test test/   (или npm test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../profiles.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mps-prof-'));
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const song = (id, text) => ({ id, type: 'pres', kind: 'song', name: 'Песня ' + id, slides: [{ id: id + 's', k: 'text', text }] });

// Основной профиль с библиотекой «Песни» (s1, s2), плейлистом и темой
function mainLib() {
  return {
    version: 2,
    items: { s1: song('s1', 'один'), s2: song('s2', 'два'), p1: song('p1', 'своя') },
    libraries: [{ id: 'L1', name: 'Песни', items: ['s1', 's2'] }, { id: 'L2', name: 'Своё', items: ['p1'] }],
    playlists: [{ id: 'PL', name: 'Служение', entries: [{ eid: 'e1', item: 's1' }] }],
    themes: [{ id: 'T1', name: 'Тема 1' }],
  };
}

test('основной профиль: данные там же, где были до профилей', () => {
  const root = tmp();
  const st = P.store(root);
  assert.equal(st.active(), 'main');
  assert.equal(st.load(), null); // первый запуск — окно создаст пустую библиотеку само
  st.save(mainLib());
  assert.equal(read(path.join(root, 'library.json')).libraries.length, 2);
  assert.equal(st.libFile(), path.join(root, 'library.json'));
  assert.equal(st.lsFile(), path.join(root, 'settings-backup.json'));
});

test('новый профиль пустой и не видит чужое', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('Молодёжь');
  assert.equal(st.state().list.length, 2);
  const fresh = st.load(b);
  assert.deepEqual(fresh.items, {});
  assert.deepEqual(fresh.libraries.map((L) => L.items.length), [0]);
  assert.deepEqual(fresh.playlists.map((p) => p.entries.length), [0]);
  assert.ok(!fresh.themes);
  st.setActive(b);
  assert.equal(st.active(), b);
  assert.equal(st.lsFile(), path.join(root, 'profiles', b, 'settings-backup.json'));
  const lb = P.freshLib();
  lb.items.x = song('x', 'молодёжная');
  lb.libraries[0].items.push('x');
  st.save(lb);
  // основной не изменился
  const m = st.load('main');
  assert.ok(!m.items.x);
  assert.equal(m.libraries.length, 2);
  // и состояние переживает перезапуск программы
  const st2 = P.store(root);
  assert.equal(st2.active(), b);
  assert.ok(st2.load().items.x);
});

test('общая библиотека: правка в одном профиле видна в другом, файл хранится один раз', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('Вечер', { libs: ['L1'] });
  // у основного на месте библиотеки — заглушка, сама она и её песни — в shared.json
  const own = read(path.join(root, 'library.json'));
  assert.deepEqual(own.libraries[0], { id: 'L1', shared: true });
  assert.ok(!own.items.s1 && !own.items.s2 && own.items.p1);
  const sh = read(path.join(root, 'shared', 'shared.json'));
  assert.deepEqual(sh.libs.L1.items, ['s1', 's2']);
  // второй профиль видит общую библиотеку, своей «Своё» — нет
  const lb = st.load(b);
  const L1 = lb.libraries.find((L) => L.id === 'L1');
  assert.ok(L1 && L1.shared);
  assert.ok(!lb.libraries.some((L) => L.id === 'L2'));
  assert.equal(lb.items.s2.slides[0].text, 'два');
  // правит песню и добавляет новую в общую библиотеку
  lb.items.s2.slides[0].text = 'два (правка)';
  lb.items.s3 = song('s3', 'три');
  L1.items.push('s3');
  st.save(lb, b);
  const m = st.load('main');
  assert.equal(m.items.s2.slides[0].text, 'два (правка)');
  assert.ok(m.items.s3);
  assert.deepEqual(m.libraries[0].items, ['s1', 's2', 's3']);
  assert.equal(m.libraries[0].name, 'Песни');
  // порядок библиотек основного сохранён
  assert.deepEqual(m.libraries.map((L) => L.id), ['L1', 'L2']);
  // песня не задвоилась в личных файлах
  assert.ok(!read(st.libFile(b)).items.s3);
});

test('неизменённое общее не затирает чужую правку', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('B', { libs: ['L1'] });
  const m = st.load('main'); // основной открыл до правки
  const lb = st.load(b);
  lb.items.s1.slides[0].text = 'правка B';
  st.save(lb, b);
  m.playlists[0].name = 'Служение 2'; // основной меняет только своё
  st.save(m, 'main');
  assert.equal(st.load('main').items.s1.slides[0].text, 'правка B');
});

test('одновременная правка одной песни: побеждает последнее, другое — в shared/conflicts', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('B', { libs: ['L1'] });
  const m = st.load('main');
  const lb = st.load(b);
  lb.items.s1.slides[0].text = 'версия B';
  st.save(lb, b);
  m.items.s1.slides[0].text = 'версия основного';
  const r = st.save(m, 'main');
  assert.deepEqual(r.conflicts, ['i:s1']);
  assert.equal(st.load(b).items.s1.slides[0].text, 'версия основного');
  const files = fs.readdirSync(path.join(root, 'shared', 'conflicts'));
  assert.equal(files.length, 1);
  assert.equal(read(path.join(root, 'shared', 'conflicts', files[0])).value.slides[0].text, 'версия B');
});

test('удалить общую библиотеку в профиле — профиль отключается, у других она остаётся', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('B', { libs: ['L1'] });
  const lb = st.load(b);
  lb.libraries = lb.libraries.filter((L) => L.id !== 'L1');
  st.save(lb, b);
  assert.ok(!st.load(b).libraries.some((L) => L.id === 'L1'));
  const m = st.load('main');
  assert.ok(m.libraries.some((L) => L.id === 'L1'));
  assert.ok(m.items.s1 && m.items.s2);
});

test('отключить от общей: с копией и без; песня из плейлиста остаётся', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('B', { libs: ['L1'] });
  const c = st.create('C', { libs: ['L1'] });
  // B ставит s2 в свой плейлист
  const lb = st.load(b);
  lb.playlists[0].entries.push({ eid: 'eb', item: 's2' });
  st.save(lb, b);
  st.disconnect('L1', b, false);
  const lb2 = st.load(b);
  assert.ok(!lb2.libraries.some((L) => L.id === 'L1'));
  assert.ok(lb2.items.s2, 'песня из плейлиста осталась');
  assert.ok(!lb2.items.s1, 'остальные песни библиотеки профилю не нужны');
  // C — с копией: своя библиотека с новым id, дальше не общая
  st.disconnect('L1', c, true);
  const lc = st.load(c);
  const copy = lc.libraries.find((L) => !L.shared && L.items.length);
  assert.ok(copy && copy.id !== 'L1');
  assert.deepEqual(copy.items, ['s1', 's2']);
  // основной по-прежнему с общей
  assert.ok(st.load('main').libraries.find((L) => L.id === 'L1').shared);
  // последний участник оставляет себе — библиотека снова своя, общая хранилка пустеет
  st.disconnect('L1', 'main', true);
  const m = st.load('main');
  assert.ok(m.libraries.find((L) => L.id === 'L1' && !L.shared));
  assert.ok(m.items.s1 && m.items.s2);
  const sh = read(path.join(root, 'shared', 'shared.json'));
  assert.ok(!sh.libs.L1);
  assert.ok(!sh.items.s1, 's1 больше никому не нужна в общем');
  assert.ok(sh.items.s2 === undefined || st.load(b).items.s2, 's2 есть у B');
});

test('удаление профиля не трогает общие данные', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('B', { libs: ['L1'] });
  assert.equal(st.remove('main'), false, 'основной не удаляется');
  st.setActive(b);
  assert.equal(st.remove(b), false, 'открытый не удаляется');
  st.setActive('main');
  assert.equal(st.remove(b), true);
  assert.equal(st.state().list.length, 1);
  assert.ok(st.load('main').items.s1);
  assert.ok(read(path.join(root, 'shared', 'shared.json')).libs.L1);
  assert.ok(fs.readdirSync(path.join(root, 'profiles', '.deleted')).length === 1, 'папка профиля отложена, не стёрта');
});

test('общие темы: объединяются, правка видна всем, отключение оставляет копию', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('B', { cats: ['themes'] });
  assert.deepEqual(st.state().cats.themes.sort(), ['main', b].sort());
  const lb = st.load(b);
  assert.deepEqual(lb.themes.map((t) => t.id), ['T1']);
  lb.themes.push({ id: 'T2', name: 'Тема B' });
  st.save(lb, b);
  assert.deepEqual(st.load('main').themes.map((t) => t.id), ['T1', 'T2']);
  assert.ok(!read(path.join(root, 'library.json')).themes, 'темы не задвоены в личном файле');
  st.setCat('themes', ['main']);
  const lb2 = st.load(b);
  assert.deepEqual(lb2.themes.map((t) => t.id), ['T1', 'T2'], 'B остался со своей копией');
  lb2.themes.push({ id: 'T3', name: 'Только B' });
  st.save(lb2, b);
  assert.ok(!st.load('main').themes.some((t) => t.id === 'T3'));
});

test('подключить чужую своя-библиотеку к открытому профилю', () => {
  const root = tmp();
  const st = P.store(root);
  st.load(); st.save(mainLib());
  const b = st.create('B');
  st.setActive(b);
  const lb = P.freshLib();
  lb.items.y = song('y', 'игрек');
  lb.libraries = [{ id: 'LB', name: 'Песни B', items: ['y'] }];
  st.save(lb);
  const cat = st.catalog();
  assert.deepEqual(cat.profiles.find((p) => p.id === b).libs.map((L) => L.id), ['LB']);
  assert.ok(st.connect('LB', 'main'));
  assert.ok(st.load('main').items.y);
  const cat2 = st.catalog();
  assert.deepEqual(cat2.shared.find((L) => L.id === 'LB').members.sort(), ['main', b].sort());
});

test('unionCat: своё не теряется', () => {
  const u = P.unionCat({ themes: [{ id: 'a' }], themesLive: { a: 1 } }, { themes: [{ id: 'a', x: 2 }, { id: 'b' }], themesLive: { a: 9, b: 2 } });
  assert.deepEqual(u.themes.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(u.themesLive, { a: 1, b: 2 });
});
