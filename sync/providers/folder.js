/* ---------- Провайдер «Папка» ----------
   Обычные файлы в папке на диске. Если папка лежит внутри «Google Диск для компьютера», OneDrive, Dropbox или на
   сетевом диске / флешке — файлы между компьютерами переносит уже тот клиент, а ядро (core.js) работает как обычно.
   Запись — через временный файл и переименование (клиенты облака не видят недописанное). Временные файлы *.part в списке не показываем. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function folderProvider(root) {
  const full = (p) => {
    const parts = String(p).split('/');
    if (!parts.length || parts.some((s) => !s || s === '.' || s === '..' || /[\\:]/.test(s))) throw new Error('Недопустимый путь: ' + p);
    return path.join(root, ...parts);
  };

  async function walk(dir, rel, out) {
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const e of ents) {
      const name = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), name, out);
      else if (!e.name.endsWith('.part')) {
        const st = await fs.promises.stat(path.join(dir, e.name));
        out.push({ name, size: st.size, mtime: st.mtimeMs });
      }
    }
  }

  return {
    id: 'folder', name: 'Папка', root,
    async read(p) {
      try { return await fs.promises.readFile(full(p)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async write(p, buf) {
      const f = full(p);
      await fs.promises.mkdir(path.dirname(f), { recursive: true });
      const tmp = f + '.' + crypto.randomBytes(4).toString('hex') + '.part';
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, f);
    },
    async list(prefix) {
      const out = [];
      const rel = String(prefix).replace(/\/+$/, '');
      await walk(rel ? full(rel) : root, rel, out);
      return out.filter((f) => f.name.startsWith(prefix));
    },
    async remove(p) { await fs.promises.rm(full(p), { force: true }); },
  };
}

module.exports = { folderProvider };
