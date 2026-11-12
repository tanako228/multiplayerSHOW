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
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    let level = 0;
    let lastLvl = 0;
    let chunks = 0;
    node.onaudioprocess = (e) => {
      chunks++;
      const ch = e.inputBuffer.getChannelData(0);
      let s = 0;
      for (let i = 0; i < ch.length; i += 8) s = Math.max(s, Math.abs(ch[i]));
      level = Math.max(s, level * 0.8);
      if (performance.now() - lastLvl > 250) { lastLvl = performance.now(); say({ level: Math.round(level * 100) / 100 }); }
      try { rec.acceptWaveform(e.inputBuffer); } catch { /* пропускаем кусок */ }
    };
    src.connect(node);
    node.connect(ctx.destination); // без выхода ScriptProcessor не работает; звука нет — буфер выхода пустой
    say({ state: 'on' });
    // Звук не идёт совсем — сказать, а не молчать
    setTimeout(() => { log('кусков звука за 4 с: ' + chunks); if (!chunks) say({ warn: 'От микрофона не приходит звук — выберите другой («Микрофон ▾»)' }); }, 4000);
  } catch (err) {
    log('не включилось: ' + why(err));
    say({ state: 'error', error: why(err) });
  }
})();
