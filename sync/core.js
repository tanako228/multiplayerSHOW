/* ---------- Ядро синхронизации между компьютерами (облако) ----------
   Ядро ничего не знает ни про Google Диск, ни про программу: оно сравнивает «документы» и решает, что отправить,
   что забрать и что делать при одновременной правке. Всё внешнее подключается через два интерфейса:

   ПРОВАЙДЕР (куда синхронизируем: Google Диск, папка, WebDAV…). Файловое хранилище из четырёх действий, пути вида 'a/b':
     read(path)   → Buffer | null (нет файла)
     write(path, Buffer)              — создать или заменить
     list(prefix) → [{ name, size, mtime }]   (name — полный путь, prefix — 'devices/' или 'blobs/')
     remove(path)
   ИСТОЧНИК (откуда берём данные программы; пишет main.js — собирает library.json, настройки, файлы в «документы»):
     scan()                → Map ключ → { h (sha1 содержимого), t (когда менялся, мс), z (размер) }
     read(key)             → Buffer
     apply(key, Buffer|null, { t, dev })   — записать пришедшую версию; null — удалить документ
     keep(key, Buffer|null, { t, dev, from: 'local'|'remote' })   — проигравшая версия при конфликте (положить в «конфликты»)

   Раскладка в облаке (у каждого файла — ОДИН автор, поэтому записи никогда не спорят и «конфликтных копий» от
   облачных клиентов не бывает; нет и условных записей «если не менялось», которых Google Диск не даёт):
     devices/<id устройства>.json — опись устройства: { v:1, id, name, t, docs: { ключ: { h, t, z, d? } } }
                                    в описи — только те версии, которые это устройство само записало (d: 1 — удалён)
     blobs/<xx>/<sha1>            — содержимое документа по хэшу; неизменяемо, одинаковые файлы хранятся один раз

   Решение по каждому ключу — «трёхсторонее»: что было при прошлой синхронизации (base), что сейчас здесь (local) и
   какая версия новейшая у других устройств (remote: по большему t, при равенстве — по id устройства).
     не менялось ни там, ни там    — ничего
     менялось только здесь         — отправить (или отправить «удалено»)
     менялось только там           — забрать (или удалить здесь)
     менялось и там, и здесь       — одинаково → принять; «правка против удаления» → побеждает правка;
                                     иначе побеждает более поздняя, проигравшая уходит в source.keep (ничего не теряется)
   Время версии t при отправке = max(часы, t прежней версии + 1, t чужой версии + 1): уйти «в прошлое» нельзя,
   даже если часы компьютера отстают. */
'use strict';
const crypto = require('crypto');

const DAY = 864e5;
const TOMB_KEEP = 90 * DAY; // «удалён» помним 90 дней
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const devPath = (id) => `devices/${id}.json`;
const blobPath = (h) => `blobs/${h.slice(0, 2)}/${h}`;
const DEV_RE = /^devices\/([^/]+)\.json$/;

// Версия новее? (t, затем id устройства). a, b — { t, dev }; b может быть пустым
const newer = (a, b) => !b || a.t > b.t || (a.t === b.t && a.dev > (b.dev || ''));

function emptyState() { return { v: 1, base: {} }; }

/* state: { load(): Promise<obj|null>, save(obj): Promise } — где ядро помнит прошлую синхронизацию (файл в папке программы).
   opts: provider, source, deviceId, deviceName, state, now, include(key) → bool, onProgress({ step, key, i, n }) */
function createSync(opts) {
  const { provider, source, deviceId, state } = opts;
  const now = opts.now || Date.now;
  const include = opts.include || (() => true);
  const progress = opts.onProgress || (() => {});
  if (!provider || !source || !deviceId || !state) throw new Error('createSync: нужны provider, source, deviceId, state');
  let busy = false;

  async function readJson(p) {
    const b = await provider.read(p);
    if (!b) return null;
    try { const m = JSON.parse(b.toString('utf8')); return m && m.v === 1 && m.docs && typeof m.docs === 'object' ? m : null; } catch { return null; }
  }

  // Новейшие версии по всем ДРУГИМ устройствам: ключ → { h, t, z, d, dev }
  async function remoteWinners() {
    const out = new Map();
    const files = await provider.list('devices/');
    for (const f of files) {
      const m = DEV_RE.exec(f.name);
      if (!m || m[1] === deviceId) continue;
      const man = await readJson(f.name);
      if (!man) continue;
      for (const [k, e] of Object.entries(man.docs)) {
        if (!include(k) || !e || typeof e.t !== 'number') continue;
        const v = { ...e, dev: m[1] };
        if (newer(v, out.get(k))) out.set(k, v);
      }
    }
    return out;
  }

  // Есть ли в облаке данные других устройств (для вопроса при первой синхронизации)
  async function others() {
    return (await provider.list('devices/')).some((f) => { const m = DEV_RE.exec(f.name); return m && m[1] !== deviceId; });
  }

  /* Одна синхронизация. prefer: 'remote' | 'local' — при конфликте не смотреть на время, а брать облако / свой компьютер;
     pushOnly — только отправить своё (ничего не забирать и не применять);
     adopt — вместе с prefer: 'remote': чего в облаке нет и здесь раньше не синхронизировалось — отложить и убрать здесь.
     Возвращает { pushed, pulled, deleted, conflicts: [{ key, won }], pending, errors } — списки ключей. */
  async function sync(run = {}) {
    if (busy) throw new Error('Синхронизация уже идёт');
    busy = true;
    const st = (await state.load()) || emptyState();
    st.base = st.base || {};
    const res = { pushed: [], pulled: [], deleted: [], conflicts: [], pending: [], errors: [] };
    try {
      const remote = await remoteWinners();
      const local = new Map([...(await source.scan())].filter(([k]) => include(k)));
      const keys = new Set([...local.keys(), ...remote.keys(), ...Object.keys(st.base).filter(include)]);

      const own = (await readJson(devPath(deviceId))) || { v: 1, id: deviceId, docs: {} };
      let have = null; // какие содержимые уже лежат в облаке (список читаем лениво, один раз)
      const hasBlob = async (h) => { if (!have) have = new Set((await provider.list('blobs/')).map((f) => f.name)); return have.has(blobPath(h)); };
      let ownChanged = false;
      const list = [...keys];

      for (let i = 0; i < list.length; i++) {
        const key = list[i];
        try {
          progress({ step: 'check', key, i, n: list.length });
          const bs = st.base[key]; // { h|null, t, dev } — версия, которой равен документ здесь после прошлой синхронизации
          const bh = bs ? bs.h : null;
          const L = local.get(key);
          const lh = L ? L.h : null;
          const R = remote.get(key);
          const rh = R ? (R.d ? null : R.h) : null;
          const localChanged = lh !== bh;
          const remoteNew = !!R && newer(R, bs);
          const remoteChanged = remoteNew && rh !== bh;

          if (!localChanged && !remoteChanged) { // тишина; лишь запоминаем более новую метку времени
            if (remoteNew) st.base[key] = { h: bh, t: R.t, dev: R.dev };
            continue;
          }
          if (localChanged && remoteChanged && lh === rh) { // сделали одно и то же — спорить не о чем
            st.base[key] = { h: rh, t: R.t, dev: R.dev };
            continue;
          }
          // «Заменить моё облачным» (новый компьютер): своё, чего в облаке никогда не было, не отправляем,
          // а откладываем (source.keep) и убираем здесь — иначе пустые «Песни» новой программы задвоятся у всех
          if (run.adopt && !bs && !R && lh !== null) {
            await source.keep(key, await source.read(key), { t: L.t, dev: deviceId, from: 'local' });
            await source.apply(key, null, { t: 0, dev: '' });
            st.base[key] = { h: null, t: 0, dev: '' };
            res.deleted.push(key);
            continue;
          }
          // Только отправить (по таймеру, при закрытии): пришедшее и споры — в следующий полный раз
          if (run.pushOnly && remoteChanged) { res.pending.push(key); continue; }

          let action; // 'push' | 'pull'
          if (!remoteChanged) action = 'push';
          else if (!localChanged) action = 'pull';
          else { // конфликт
            let win;
            if (lh === null) win = 'remote'; // здесь удалили, там правили — правка важнее
            else if (rh === null) win = 'local';
            else if (run.prefer) win = run.prefer;
            else {
              const lt = L.t || 0;
              win = lt > R.t || (lt === R.t && deviceId > R.dev) ? 'local' : 'remote';
            }
            if (win === 'remote') {
              if (lh !== null) await source.keep(key, await source.read(key), { t: L.t, dev: deviceId, from: 'local' });
              action = 'pull';
            } else {
              if (rh !== null) {
                const rb = await provider.read(blobPath(R.h));
                if (rb) await source.keep(key, rb, { t: R.t, dev: R.dev, from: 'remote' });
              }
              action = 'push';
            }
            res.conflicts.push({ key, won: win });
          }

          if (action === 'pull') {
            if (rh === null) {
              await source.apply(key, null, { t: R.t, dev: R.dev });
              res.deleted.push(key);
            } else {
              progress({ step: 'pull', key, i, n: list.length });
              const buf = await provider.read(blobPath(R.h));
              if (!buf) { res.pending.push(key); continue; } // содержимое ещё не долили в облако — в следующий раз
              if (sha1(buf) !== R.h) { res.errors.push({ key, error: 'содержимое в облаке повреждено' }); continue; }
              await source.apply(key, buf, { t: R.t, dev: R.dev });
              res.pulled.push(key);
            }
            st.base[key] = { h: rh, t: R.t, dev: R.dev };
            continue;
          }

          // push
          const t = Math.max(now(), (bs ? bs.t : 0) + 1, (R ? R.t : 0) + 1);
          if (lh === null) {
            own.docs[key] = { h: bs && bs.h || '', t, d: 1 };
            st.base[key] = { h: null, t, dev: deviceId };
            res.deleted.push(key);
          } else {
            progress({ step: 'push', key, i, n: list.length });
            const buf = await source.read(key);
            const h = sha1(buf); // файл мог измениться после scan — верим тому, что прочитали
            if (!(await hasBlob(h))) { await provider.write(blobPath(h), buf); have.add(blobPath(h)); }
            own.docs[key] = { h, t, z: buf.length };
            st.base[key] = { h, t, dev: deviceId };
            res.pushed.push(key);
          }
          ownChanged = true;
        } catch (err) {
          res.errors.push({ key, error: String(err && err.message || err) });
        }
      }

      // Старые «удалён» убираем из описи
      for (const [k, e] of Object.entries(own.docs)) if (e.d && now() - e.t > TOMB_KEEP) { delete own.docs[k]; ownChanged = true; }
      if (ownChanged) {
        own.id = deviceId; own.name = opts.deviceName || deviceId; own.t = now();
        await provider.write(devPath(deviceId), Buffer.from(JSON.stringify(own)));
      }
      return res;
    } finally {
      try { await state.save(st); } catch { /* следующая синхронизация разберётся: версия, равная облачной, принимается без передачи */ }
      busy = false;
    }
  }

  /* Уборка облака: содержимое, на которое не ссылается ни одна опись, старше grace (по умолчанию 14 дней) — удалить.
     Запас нужен, чтобы не стереть то, что другое устройство уже отправило, но ещё не записало в опись. */
  async function gc({ graceMs = 14 * DAY } = {}) {
    const used = new Set();
    for (const f of await provider.list('devices/')) {
      if (!DEV_RE.test(f.name)) continue;
      const m = await readJson(f.name);
      if (m) for (const e of Object.values(m.docs)) if (e && !e.d && e.h) used.add(blobPath(e.h));
    }
    const removed = [];
    for (const f of await provider.list('blobs/')) {
      if (used.has(f.name) || now() - (f.mtime || 0) < graceMs) continue;
      await provider.remove(f.name);
      removed.push(f.name);
    }
    return removed;
  }

  return { sync, gc, others, fresh: async () => { const s = await state.load(); return !s || !s.base || !Object.keys(s.base).length; } };
}

module.exports = { createSync, sha1, devPath, blobPath, TOMB_KEEP };
