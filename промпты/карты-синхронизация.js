// Переносит инструкцию для нейросети из «промпты/ПРОМПТ-КАРТЫ.md» в mapsai.js (строка «const SKILL = …; // @skill»).
// Запуск: node промпты/карты-синхронизация.js — после правки файла «промпты/ПРОМПТ-КАРТЫ.md»
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const MD = path.join(__dirname, 'ПРОМПТ-КАРТЫ.md');
const MARK = 'ИНСТРУКЦИЯ ДЛЯ НЕЙРОСЕТИ';
function skillFromMd() {
  const t = fs.readFileSync(MD, 'utf8').replace(/\r\n/g, '\n');
  const i = t.indexOf(MARK);
  if (i < 0) throw new Error('В «промпты/ПРОМПТ-КАРТЫ.md» нет строки «' + MARK + '»');
  return t.slice(i + MARK.length).trim();
}
module.exports = { skillFromMd };
if (require.main === module) {
  const file = path.join(root, 'mapsai.js');
  const src = fs.readFileSync(file, 'utf8');
  const re = /const SKILL = .*; \/\/ @skill.*\n/;
  if (!re.test(src)) throw new Error('В mapsai.js нет строки «const SKILL = …; // @skill»');
  fs.writeFileSync(file, src.replace(re, () => 'const SKILL = ' + JSON.stringify(skillFromMd()) + '; // @skill — копия из «промпты/ПРОМПТ-КАРТЫ.md»\n'));
  console.log('mapsai.js: инструкция обновлена');
}
