/* Провайдер «в памяти» — для проверок и тестов (то же, что папка, но без диска). */
'use strict';

function memoryProvider(now = Date.now) {
  const files = new Map(); // путь → { buf, mtime }
  return {
    id: 'memory', name: 'Память', files,
    async read(p) { const f = files.get(p); return f ? Buffer.from(f.buf) : null; },
    async write(p, buf) { files.set(p, { buf: Buffer.from(buf), mtime: now() }); },
    async list(prefix) { return [...files].filter(([n]) => n.startsWith(prefix)).map(([name, f]) => ({ name, size: f.buf.length, mtime: f.mtime })); },
    async remove(p) { files.delete(p); },
  };
}

module.exports = { memoryProvider };
