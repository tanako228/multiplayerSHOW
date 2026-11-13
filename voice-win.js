// Скрытое окно «Библия по голосу»: микрофон → Vosk → текст окну оператора (voice.js) через main.js.
// Окно живёт, пока включено распознавание; выключили — main.js его закрывает.
// { log } — только в журнал voice\log.txt (voicesrv.js), окну оператора не уходит.
(async () => {
  const q = new URLSearchParams(location.search);
  const lang = q.get('lang') || 'ru';
  const say = (m) => window.api.voiceSend(m);
  const log = (t) => say({ log: t });
  const why = (err) => (err ? [err.name, err.message, err.constraint].filter(Boolean).join(': ') : '') || 'неизвестная ошибка';
  window.addEventListener('error', (e) => log('ошибка: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => log('ошибка: ' + why(e.reason)));
  try {
    say({ state: 'loading' });
    log('загружаю модель ' + lang);
    // Модель распаковывается один раз и лежит в IndexedDB этого окна (ключ — адрес); дальше грузится за секунды
    const model = await Vosk.createModel(`mpsvoice://model/${lang}.tar.gz?v=${q.get('v') || '0'}`, -2);
    log('модель готова');
    // Микрофон: выбранный в программе (по id, иначе по названию), иначе — как в Windows
    let id = q.get('mic') || '';
    const label = q.get('label') || '';
    const ins = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    log('микрофоны: ' + (ins.map((d) => d.label || d.deviceId.slice(0, 8)).join(' | ') || 'нет'));
    if (id || label) {
      const d = ins.find((x) => x.deviceId === id) || ins.find((x) => label && x.label === label);
      id = d ? d.deviceId : '';
      if (!d) say({ warn: `Микрофон «${label || 'выбранный'}» не найден — слушаю микрофон Windows` });
    }
    const open = (dev) => navigator.mediaDevices.getUserMedia({
      video: false,
      audio: { ...(dev ? { deviceId: { exact: dev } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    let stream;
    try { stream = await open(id); } catch (err) {
      if (!id) throw err;
      // Выбранный не открылся (Bluetooth-наушники, занят другой программой) — берём микрофон Windows
      log('выбранный микрофон не открылся: ' + why(err));
      say({ warn: `Микрофон «${label || 'выбранный'}» не открылся (${why(err)}) — слушаю микрофон Windows` });
      stream = await open('');
    }
    const tr = stream.getAudioTracks()[0];
    log('микрофон открыт: ' + (tr ? tr.label : '?'));
    if (tr) tr.addEventListener('ended', () => say({ state: 'error', error: 'микрофон отключился (' + (tr.label || '') + ')' }));
    const ctx = new AudioContext();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    log('звук: ' + ctx.state + ', ' + ctx.sampleRate + ' Гц');
    const rec = new model.KaldiRecognizer(ctx.sampleRate);
    // Частичный текст Vosk шлёт на каждый кусок звука, даже без изменений — передаём только новый
    let part = '';
    rec.on('result', (m) => { part = ''; const t = m && m.result && m.result.text; if (t) { log('услышал: ' + t); say({ text: t, final: true }); } });
    rec.on('partialresult', (m) => { const t = m && m.result && m.result.partial; if (t && t !== part) { part = t; say({ text: t, final: false }); } });
    /* Автоуровень: микрофон → усиление (само подстраивается) → компрессор → лимитер → Vosk.
       Громкий вход (пульт «в красном») распознаётся плохо: искажения. Усиление держит речь около −20 dBFS,
       компрессор выравнивает громкие и тихие слова, лимитер не даёт дойти до 0 dBFS.
       Уже перегруженный на входе звук (клиппинг до компьютера) исправить нельзя — тогда предупреждаем. */
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    const raw = ctx.createAnalyser(); // вход до обработки — мерить уровень и клиппинг
    raw.fftSize = 2048;
    const rawBuf = new Float32Array(raw.fftSize);
    src.connect(raw);
    src.connect(gain).connect(comp).connect(lim);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const TARGET = 0.1; // RMS речи после усиления (≈ −20 dBFS)
    const GATE = 0.004; // тише — пауза/шум: усиление не трогаем, чтобы не раздувать шум
    let g = 1;
    let level = 0;
    let lastLvl = 0;
    let chunks = 0;
    let clipT = 0; // когда последний раз был клиппинг входа
    let clipN = 0; // кусков с клиппингом подряд (за ~3 с)
    let clipWarned = 0;
    node.onaudioprocess = (e) => {
      chunks++;
      // Вход до обработки: RMS и пики у 0 dBFS
      raw.getFloatTimeDomainData(rawBuf);
      let sum = 0;
      let peak = 0;
      let clips = 0;
      for (let i = 0; i < rawBuf.length; i++) { const v = Math.abs(rawBuf[i]); sum += v * v; if (v > peak) peak = v; if (v > 0.985) clips++; }
      const rms = Math.sqrt(sum / rawBuf.length);
      if (rms > GATE) {
        // Громко — убавляем быстро, тихо — прибавляем медленно; пики не выше −3 dBFS до компрессора
        let want = Math.min(8, Math.max(0.15, TARGET / rms));
        if (peak * want > 0.7) want = Math.max(0.15, 0.7 / peak);
        g += (want - g) * (want < g ? 0.5 : 0.06);
        gain.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
      }
      const now = performance.now();
      if (clips > 3) { clipN = now - clipT < 3000 ? clipN + 1 : 1; clipT = now; }
      if (clipN >= 6 && now - clipWarned > 60000) {
        clipWarned = now;
        clipN = 0;
        say({ warn: 'Вход микрофона перегружен (звук «в красном») — уменьшите уровень на пульте или в Windows: искажённый звук распознаётся хуже' });
      }
      // Уровень для индикатора — после обработки (что слышит распознавание)
      const ch = e.inputBuffer.getChannelData(0);
      let s = 0;
      for (let i = 0; i < ch.length; i += 8) s = Math.max(s, Math.abs(ch[i]));
      level = Math.max(s, level * 0.8);
      if (now - lastLvl > 250) { lastLvl = now; say({ level: Math.round(level * 100) / 100, gain: Math.round(g * 100) / 100, clip: now - clipT < 1500 }); }
      try { rec.acceptWaveform(e.inputBuffer); } catch { /* пропускаем кусок */ }
    };
    lim.connect(node);
    node.connect(ctx.destination); // без выхода ScriptProcessor не работает; звука нет — буфер выхода пустой
    say({ state: 'on' });
    // Звук не идёт совсем — сказать, а не молчать
    setTimeout(() => { log('кусков звука за 4 с: ' + chunks); if (!chunks) say({ warn: 'От микрофона не приходит звук — выберите другой («Микрофон ▾»)' }); }, 4000);
  } catch (err) {
    log('не включилось: ' + why(err));
    say({ state: 'error', error: why(err) });
  }
})();
