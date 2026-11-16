/* ---------- Трансляция экрана на пульт видеопотоком (WebRTC) ----------
   Пульт (app/op.js) показывает «что на экране» видео, а не картинками: так плавнее и намного меньше трафика.
   Кадры берём у скрытого зеркала вывода в main.js (opMirror: только когда картинка сменилась, JPEG) → рисуем на холст →
   холст становится видеопотоком (captureStream) → WebRTC каждому планшету. Кодек — какой примет планшет (VP8 / H.264),
   битрейт и частота ограничены режимом планшета: экономно ~150 кбит/с, авто ~450, чётко ~1500; размер — под его окно.
   В локальной сети WebRTC сам подстраивается под пропускную способность (сеть хуже — меньше битрейт).
   Договорённость (offer / answer / ice) идёт по WebSocket группы: планшет → teamapi.js (rtc) → main.js → сюда (team:rtc),
   ответ — team:rtcOut. Не соединилось — пульт сам переходит на картинки (/op/live). */

const castSrc = new Map(); // sid экрана → { canvas, ctx, track, stream, w, h, seq, drawn }
const castPeers = new Map(); // peer (номер соединения) → { pc, sid, sender, mode, w }
const CAST_MODES = {
  eco: { br: 150000, fps: 5 },
  auto: { br: 450000, fps: 10 },
  hq: { br: 1500000, fps: 15 },
};

function castSource(sid) {
  let s = castSrc.get(sid);
  if (s) return s;
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 0 — кадр в поток только по requestFrame (когда картинка сменилась), без лишних кадров
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  try { track.contentHint = 'detail'; } catch { /* старый Chromium */ }
  s = { canvas, ctx, stream, track, seq: 0, drawn: 0 };
  castSrc.set(sid, s);
  return s;
}

function castOut(peer, m) { window.api.teamRtcOut({ peer, m }).catch(() => {}); }

function castDrop(peer) {
  const p = castPeers.get(peer);
  if (!p) return;
  castPeers.delete(peer);
  try { p.pc.close(); } catch { /* уже */ }
  // Источник никому не нужен — освободить
  if (![...castPeers.values()].some((x) => x.sid === p.sid)) {
    const s = castSrc.get(p.sid);
    if (s) { try { s.track.stop(); } catch { /* уже */ } castSrc.delete(p.sid); }
  }
}

// Битрейт, частота и уменьшение — по режиму и ширине окна на планшете
async function castParams(p) {
  const s = castSrc.get(p.sid);
  const m = CAST_MODES[p.mode] || CAST_MODES.auto;
  const want = p.mode === 'eco' ? Math.min(p.w, 480) : p.w;
  const scale = s ? Math.max(1, s.canvas.width / Math.max(160, want)) : 1;
  try {
    const prm = p.sender.getParameters();
    if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
    prm.encodings[0].maxBitrate = m.br;
    prm.encodings[0].maxFramerate = m.fps;
    prm.encodings[0].scaleResolutionDownBy = scale;
    prm.degradationPreference = 'maintain-resolution'; // текст на экране — лучше реже, но чётко
    await p.sender.setParameters(prm);
  } catch { /* соединение ещё не готово — повторим на connected */ }
}

async function castStart(peer, m) {
  castDrop(peer);
  const sid = String(m.sid || 'main');
  const src = castSource(sid);
  const pc = new RTCPeerConnection({ iceServers: [] }); // только локальная сеть
  const sender = pc.addTrack(src.track, src.stream);
  const p = { pc, sid, sender, mode: m.mode || 'auto', w: Number(m.w) || 640 };
  castPeers.set(peer, p);
  pc.onicecandidate = (e) => castOut(peer, { k: 'ice', c: e.candidate ? e.candidate.toJSON() : null });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') { castParams(p); try { src.track.requestFrame(); } catch { /* нет */ } }
    if (['failed', 'closed'].includes(pc.connectionState)) { castOut(peer, { k: 'fail' }); castDrop(peer); }
  };
  await castParams(p);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  castOut(peer, { k: 'offer', sdp: pc.localDescription.sdp, sid });
  castKeep();
}

window.api.onTeamRtc(async ({ peer, m } = {}) => {
  if (!m) return;
  try {
    if (m.k === 'start') await castStart(peer, m);
    else if (m.k === 'bye') castDrop(peer);
    else {
      const p = castPeers.get(peer);
      if (!p) return;
      if (m.k === 'answer') await p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      else if (m.k === 'ice') { if (m.c) await p.pc.addIceCandidate(m.c); }
      else if (m.k === 'mode') { p.mode = m.mode || p.mode; p.w = Number(m.w) || p.w; castParams(p); }
    }
  } catch (e) {
    castOut(peer, { k: 'fail', text: (e && e.message) || '' });
    castDrop(peer);
  }
});

// Кадр зеркала → холст → поток
window.api.onTeamCastFrame(async ({ sid, seq, jpg } = {}) => {
  const s = castSrc.get(sid);
  if (!s || !jpg || seq <= s.seq) return;
  s.seq = seq;
  let bmp;
  try { bmp = await createImageBitmap(new Blob([jpg], { type: 'image/jpeg' })); } catch { return; }
  if (s.canvas.width !== bmp.width || s.canvas.height !== bmp.height) {
    s.canvas.width = bmp.width;
    s.canvas.height = bmp.height;
    for (const p of castPeers.values()) if (p.sid === sid) castParams(p);
  }
  s.ctx.drawImage(bmp, 0, 0);
  bmp.close();
  s.drawn = Date.now();
  try { s.track.requestFrame(); } catch { /* нет */ }
});

// Раз в секунду: main.js держит зеркала этих экранов; картинка стоит — повторить кадр (новому зрителю и чтобы видео не «замирало»)
function castKeep() {
  const sids = [...new Set([...castPeers.values()].map((p) => p.sid))];
  if (!sids.length) return;
  window.api.teamCastKeep(sids).catch(() => {});
  for (const sid of sids) {
    const s = castSrc.get(sid);
    if (s && Date.now() - s.drawn > 900) { try { s.track.requestFrame(); } catch { /* нет */ } }
  }
}
setInterval(castKeep, 1000);
