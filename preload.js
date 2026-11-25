const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data));
let lsFlush = () => {}; // записать настройки окна в файл профиля сейчас (только окно оператора)
let wpRemote = false; // окно управляет другим компьютером (workplace.js): перетащенные файлы — туда

// Запасная копия настроек (только окно оператора): localStorage «cp.*» ↔ settings-backup.json (main.js).
// Хранилище пропало (нет cp.settings) — до запуска скриптов окна возвращаем всё из файла.
if (/\/index\.html$/i.test(location.pathname)) {
  const snap = () => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('cp.')) o[k] = localStorage.getItem(k); }
    return o;
  };
  // Профили (profiles.js): localStorage окна один на всю программу, а настройки у каждого профиля свои.
  // В записи cp.profile — чьи настройки сейчас в хранилище. Открыт другой профиль — свои отдаём в файл
  // прежнего (вдруг уходящее окно что-то дописало), хранилище очищаем и берём настройки открытого из его файла
  const fill = (old) => { if (old && old['cp.settings']) for (const [k, v] of Object.entries(old)) if (k.startsWith('cp.') && typeof v === 'string') localStorage.setItem(k, v); };
  try {
    const boot = ipcRenderer.sendSync('profile:boot') || {};
    const owner = localStorage.getItem('cp.profile') || 'main';
    if (boot.fresh) {
      // Окно вернулось после управления с другого компьютера (workplace.js): настройки менял он — в файле свежее
      const back = ipcRenderer.sendSync('ls:restore');
      if (back && back['cp.settings']) { for (const k of Object.keys(snap())) localStorage.removeItem(k); fill(back); }
    } else if (boot.id && boot.id !== owner) {
      const mine = snap();
      if (mine['cp.settings']) ipcRenderer.sendSync('ls:backupFor', { id: owner, data: mine });
      for (const k of Object.keys(mine)) localStorage.removeItem(k);
      fill(ipcRenderer.sendSync('ls:restore'));
    } else if (!localStorage.getItem('cp.settings')) fill(ipcRenderer.sendSync('ls:restore'));
    if (boot.id) localStorage.setItem('cp.profile', boot.id);
    wpRemote = !!boot.remote;
  } catch { /* нет копии — первый запуск */ }
  // Пишем копию, когда что-то поменялось (проверка раз в 5 секунд) и при закрытии окна
  let last = '';
  const backup = (sync) => {
    try {
      const o = snap();
      const s = JSON.stringify(o);
      if (s === last || !o['cp.settings']) return;
      last = s;
      if (sync) ipcRenderer.sendSync('ls:backup', o); else ipcRenderer.send('ls:backup', o);
    } catch { /* не страшно */ }
  };
  setInterval(() => backup(false), 5000);
  // Профили: открыть другой профиль или перезагрузить окно после правки общих данных (profpanel.js).
  // Перед этим — последняя копия настроек в файл текущего профиля
  lsFlush = () => backup(true);
  window.addEventListener('beforeunload', () => backup(true));
}

contextBridge.exposeInMainWorld('api', {
  getDisplays: () => ipcRenderer.invoke('displays:get'),
  identifyDisplays: () => ipcRenderer.invoke('displays:identify'), // большие номера на мониторах на 3 с
  pickMedia: (opts) => ipcRenderer.invoke('media:pick', opts),
  describeFiles: (paths, opts) => ipcRenderer.invoke('media:describe', paths, opts),
  addPick: (opts) => ipcRenderer.invoke('add:pick', opts), // «Добавить…»: одно окно для файлов, песен, презентаций, тем
  addRead: (paths, opts) => ipcRenderer.invoke('add:read', paths, opts),
  // Перетащенный файл. Окно управляет другим компьютером — путь, где файл будет там (он уже едет туда, workplace.js)
  pathForFile: (file) => { const p = webUtils.getPathForFile(file); return wpRemote && p ? ipcRenderer.sendSync('wp:upmap', p) : p; },

  openOutput: (displayId) => ipcRenderer.invoke('output:open', displayId),
  closeOutput: () => ipcRenderer.invoke('output:close'),
  setOutputSettings: (s) => ipcRenderer.invoke('output:settings', s),
  saverSet: (cfg) => ipcRenderer.invoke('saver:set', cfg), // заставка от выгорания OLED
  saverTest: () => ipcRenderer.invoke('saver:test'),
  guardSet: (cfg) => ipcRenderer.invoke('guard:set', cfg), // защита экранов показа: курсор не уходит на мониторы вывода
  show: (payload) => ipcRenderer.invoke('output:show', payload),
  clear: (payload) => ipcRenderer.invoke('output:clear', payload),
  layers: (msg) => ipcRenderer.invoke('output:layers', msg),
  // Экраны и экранные сцены (compose.js, screens.js)
  screensConfig: (cfg) => ipcRenderer.invoke('screens:config', cfg),
  screensStage: (info) => ipcRenderer.invoke('screens:stage', info),
  screensState: () => ipcRenderer.invoke('screens:state'),
  screensFocus: (key) => ipcRenderer.invoke('screens:focus', key),
  screensFloat: (x) => ipcRenderer.invoke('screens:float', x),
  onScreensState: (cb) => on('screens:state', cb),
  onScreenConfig: (cb) => on('screen:config', cb),
  onScreenStage: (cb) => on('screen:stage', cb),

  bibleList: () => ipcRenderer.invoke('bible:list'),
  biblePick: () => ipcRenderer.invoke('bible:pick'),
  bibleRead: (file) => ipcRenderer.invoke('bible:read', file),
  bibleSave: (bible) => ipcRenderer.invoke('bible:save', bible),
  bibleLoad: (id) => ipcRenderer.invoke('bible:load', id),
  bibleDelete: (id) => ipcRenderer.invoke('bible:delete', id),
  bibleSetIndex: (list) => ipcRenderer.invoke('bible:setIndex', list),

  libLoad: () => ipcRenderer.invoke('lib:load'),
  libSave: (data) => ipcRenderer.invoke('lib:save', data),
  libPatch: (msg) => ipcRenderer.invoke('lib:patch', msg), // только изменённые презентации (playlist.js: libSend)
  // Профили (profiles.js): список, свои и общие библиотеки; команды { act: create|rename|remove|connect|disconnect|cat|switch, … }
  profState: () => ipcRenderer.invoke('profile:state'),
  profDo: (a) => ipcRenderer.invoke('profile:do', a),
  profFlushLs: () => lsFlush(),
  // Удалённый режим (workplace.js, окно — wpui.js; плашка на A — wplock.html)
  wpState: () => ipcRenderer.invoke('wp:state'),
  wpHost: (on) => ipcRenderer.invoke('wp:host', !!on),
  wpSetName: (n) => ipcRenderer.invoke('wp:setName', String(n || '')),
  wpConnect: (x) => ipcRenderer.invoke('wp:connect', x), // { addr, code } → { ok, error?, name? }
  wpDisconnect: () => ipcRenderer.invoke('wp:disconnect'),
  wpTake: () => ipcRenderer.invoke('wp:take'),
  wpFind: () => ipcRenderer.invoke('wp:find'),
  wpForget: (id) => ipcRenderer.invoke('wp:forget', id),
  wpFlushed: (r) => ipcRenderer.invoke('wp:flushed', r),
  wpShow: () => ipcRenderer.invoke('wp:show'), // R5: что на экране — окну после перехвата или возврата
  wpShowPut: (s) => ipcRenderer.send('wp:showPut', s),
  wpWatchStop: () => ipcRenderer.invoke('wp:watchStop'),
  wpBye: () => ipcRenderer.invoke('wp:bye'),
  onWpState: (cb) => on('wp:state', cb),
  onWpFlush: (cb) => on('wp:flush', cb),
  onWpNotice: (cb) => on('wp:notice', cb),
  onWpDialog: (cb) => on('wp:dialog', cb), // A просит выбрать файлы (wpbrowse.js)
  wpDialogDone: (x) => ipcRenderer.invoke('wp:dialogDone', x),
  wpfsList: (dir) => ipcRenderer.invoke('wpfs:list', dir), // папка компьютера A

  setInk: (shapes, opts) => ipcRenderer.invoke('output:ink', shapes, opts),
  setView: (view, ms) => ipcRenderer.invoke('output:view', view, ms),
  videoCtl: (msg) => ipcRenderer.invoke('output:video', msg),
  // Стоп-кадр в зале (main.js: freezeSet): on — включить/отменить, null — узнать; окну вывода — свой кадр
  freeze: (on, by) => ipcRenderer.invoke('output:freeze', on == null ? null : !!on, by || ''),
  onFrozen: (cb) => on('output:frozen', cb),
  onFreeze: (cb) => on('output:freeze', cb),
  freezeSnap: (sid, fresh, alpha) => ipcRenderer.invoke('output:freezeSnap', sid, !!fresh, !!alpha),
  freezePrev: (r) => ipcRenderer.invoke('output:freezePrev', r),

  openEditor: (payload) => ipcRenderer.invoke('editor:open', payload),
  editorSave: (msg) => ipcRenderer.invoke('editor:save', msg),
  sendThemes: (themes) => ipcRenderer.invoke('editor:themes', themes),
  pickFile: (opts) => ipcRenderer.invoke('file:pick', opts),
  saveImage: (data) => ipcRenderer.invoke('image:save', data),
  loadImage: (file) => ipcRenderer.invoke('image:load', file),
  audioRead: (file) => ipcRenderer.invoke('audio:read', file),
  audioSave: (data) => ipcRenderer.invoke('audio:save', data),
  onEditorLoad: (cb) => on('editor:load', cb),
  onEditorSaved: (cb) => on('editor:saved', cb),
  onEditorThemes: (cb) => on('editor:themes', cb),

  // Репозиторий (папка со всеми данными) и восстановление старых резервных копий
  repoSync: (opts) => ipcRenderer.invoke('repo:sync', opts),
  repoPick: () => ipcRenderer.invoke('repo:pick'),
  repoReveal: (dir) => ipcRenderer.invoke('repo:reveal', dir),
  repoSnapshot: (dir) => ipcRenderer.invoke('repo:snapshot', dir), // снимок локальной копии → { ok, dir, marker }
  revealFile: (p) => ipcRenderer.invoke('file:reveal', p),
  repoExists: (dir) => ipcRenderer.invoke('repo:exists', dir),
  repoOpen: () => ipcRenderer.invoke('repo:open'),
  repoRestore: (opts) => ipcRenderer.invoke('repo:restore', opts),
  backupRestore: (opts) => ipcRenderer.invoke('backup:restore', opts),
  // Облако (cloudsrv.js): cfg — settings.cloud окна ({ provider: 'gdrive'|'folder', dir, parts, auto })
  cloudState: (cfg) => ipcRenderer.invoke('cloud:state', cfg),
  cloudSync: (opts) => ipcRenderer.invoke('cloud:sync', opts), // { cfg, ls, parts, prefer?, pushOnly? }
  cloudSignIn: (cfg) => ipcRenderer.invoke('cloud:signin', cfg),
  cloudSignOut: (cfg) => ipcRenderer.invoke('cloud:signout', cfg),
  cloudClient: (x) => ipcRenderer.invoke('cloud:client', x), // свой пропуск Google { cfg, clientId, clientSecret }
  cloudPickDir: () => ipcRenderer.invoke('cloud:pickDir'),
  cloudConflicts: () => ipcRenderer.invoke('cloud:conflicts'),
  onCloudProgress: (cb) => on('cloud:progress', cb),
  dataOpen: () => ipcRenderer.invoke('data:open'),
  dataPath: () => ipcRenderer.invoke('data:path'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  // Производительность (perf.js): { mode, lite, ram, cpu, gpu, parts }; режим 'auto' | 'quality' | 'eco'
  perfInfo: () => ipcRenderer.invoke('perf:info'),
  perfMode: (m) => ipcRenderer.invoke('perf:mode', m),
  perfRestart: () => ipcRenderer.invoke('perf:restart'),
  // Обновление программы с GitHub
  updGet: () => ipcRenderer.invoke('update:get'),
  updCheck: (o) => ipcRenderer.invoke('update:check', o),
  updConfig: (c) => ipcRenderer.invoke('update:config', c),
  updDownload: () => ipcRenderer.invoke('update:download'),
  updInstall: () => ipcRenderer.invoke('update:install'),
  updPage: (v) => ipcRenderer.invoke('update:page', v),
  onUpdate: (cb) => on('update:state', cb),

  clipSet: (data) => ipcRenderer.invoke('clip:set', data),
  clipGet: () => ipcRenderer.invoke('clip:get'),

  fontsSystem: () => ipcRenderer.invoke('fonts:system'),
  fontsUser: () => ipcRenderer.invoke('fonts:user'),
  fontsAdd: () => ipcRenderer.invoke('fonts:add'),
  fontsRemove: (file) => ipcRenderer.invoke('fonts:remove', file),
  onFonts: (cb) => on('fonts:changed', cb),
  saveJson: (opts) => ipcRenderer.invoke('json:save', opts),
  openJson: (opts) => ipcRenderer.invoke('json:open', opts),
  songsOpen: (opts) => ipcRenderer.invoke('songs:open', opts), // opts.other — базы и файлы других программ
  mapsPick: (opts) => ipcRenderer.invoke('maps:pick', opts), // карты (maps.js): PNG/JPEG → { maps: [{ name, w, h, img, t, p, b }], errors }; opts.small — картинки к точке
  mapsImport: (opts) => ipcRenderer.invoke('maps:import', opts), // то же для брошенных файлов: { paths, small }
  sheetsPick: () => ipcRenderer.invoke('sheets:pick'), // ноты песни: фото/PDF → { sheets: [{ file, name, w, h }], errors }
  songSave: (opts) => ipcRenderer.invoke('songs:save', opts),
  songsSaveMany: (songs) => ipcRenderer.invoke('songs:saveMany', songs),

  poolPickFolder: (title) => ipcRenderer.invoke('pool:pickFolder', title),
  poolList: (dir) => ipcRenderer.invoke('pool:list', dir),
  poolWatch: (dir) => ipcRenderer.invoke('pool:watch', dir),
  onPoolChanged: (cb) => on('pool:changed', cb),
  poolScan: (roots) => ipcRenderer.invoke('pool:scan', roots),
  poolThumb: (file) => ipcRenderer.invoke('pool:thumb', file),
  musicCover: (file) => ipcRenderer.invoke('music:cover', file),
  startDrag: (file) => ipcRenderer.send('drag:start', file), // путь или массив путей
  sourcesScreens: () => ipcRenderer.invoke('sources:screens'),
  sourcesNdi: () => ipcRenderer.invoke('sources:ndi'),
  ndiFind: () => ipcRenderer.invoke('ndi:find'),
  ndiOpen: (name) => ipcRenderer.invoke('ndi:open', name),
  ndiClose: (key) => ipcRenderer.send('ndi:close', key),
  setLang: (lang) => ipcRenderer.send('ui:lang', lang), // язык окон выбора файлов (i18n.js → main.js)
  ndiAck: (key) => ipcRenderer.send('ndi:ack', key),
  onNdiVideo: (cb) => on('ndi:video', cb),
  onNdiAudio: (cb) => on('ndi:audio', cb),
  onNdiState: (cb) => on('ndi:state', cb),
  castState: (again) => ipcRenderer.invoke('cast:state', again),
  castWindow: (kind) => ipcRenderer.invoke('cast:window', kind),
  castMiracast: () => ipcRenderer.invoke('cast:miracast'),
  onCastEvent: (cb) => on('cast:event', cb),
  onCastOpen: (cb) => on('cast:open', cb),
  fileUrl: (p) => encodeURI('file:///' + String(p).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F'),

  onDisplays: (cb) => on('displays:changed', cb),
  onOutputState: (cb) => on('output:state', cb),
  onAskClose: (cb) => on('app:ask-close', cb), // вопрос «Закрыть программу?» — своё окно без звука
  closeOk: () => ipcRenderer.invoke('app:close-ok'),
  refocus: (strong) => ipcRenderer.send('win:refocus', !!strong), // вернуть клавиатуру окну (icons.js, main.js: fixFocus)
  onStatus: (cb) => on('media:status', cb),
  onSettings: (cb) => on('output:settings', cb),
  onShow: (cb) => on('output:show', cb),
  onClear: (cb) => on('output:clear', cb),
  onLayers: (cb) => on('output:layers', cb),
  onInk: (cb) => on('output:ink', cb),
  onView: (cb) => on('output:view', cb),
  onVideo: (cb) => on('output:video', cb),
  // Пульт с телефона (remote.js, main.js) и картинки слайдов для него (thumb.html)
  remoteState: (st) => ipcRenderer.invoke('remote:state', st),
  remoteInfo: () => ipcRenderer.invoke('remote:info'),
  remoteFw: () => ipcRenderer.invoke('remote:fw'),
  remoteFwFix: () => ipcRenderer.invoke('remote:fwFix'),
  onRemoteInfo: (cb) => on('remote:info', cb),
  onRemoteCmd: (cb) => on('remote:cmd', cb),
  // Сервер группы (teamsrv.js, окно «Группа» — team.js): адрес, токен, сертификат, запись в DNS, проверка.
  // set/token/cert/dns/check → { ok, error?, info }
  teamInfo: () => ipcRenderer.invoke('team:info'),
  teamSet: (p) => ipcRenderer.invoke('team:set', p),
  teamToken: (t) => ipcRenderer.invoke('team:token', t),
  teamCert: (o) => ipcRenderer.invoke('team:cert', o), // o.staging: false — настоящий после тестового
  teamDns: () => ipcRenderer.invoke('team:dns'),
  teamCheck: () => ipcRenderer.invoke('team:check'),
  teamDo: (a) => ipcRenderer.invoke('team:do', a), // люди и устройства: { act, id, … } (teamapi.js: act)
  teamLive: (l) => ipcRenderer.invoke('team:live', l), // что на экране — телефонам группы
  onTeamCmd: (cb) => on('team:cmd', cb), // телефон листает: { cmd: next|prev|show|clear, item, sid, pl, eid, who }
  onTeamChords: (cb) => on('team:chords', cb), // аккорды песни с телефона: { id, chords, key?, who, rid }
  onTeamSheets: (cb) => on('team:sheets', cb), // ноты песни с телефона: { id, add: [листы], del: имя файла, who, rid }
  onTeamSong: (cb) => on('team:song', cb), // песня с планшета: { id ('' — новая), lib, name, text, arrangements, arr, key, tempo, time, who, rid }
  onTeamEdit: (cb) => on('team:edit', cb), // правка без связи: { id, chords, key, sheets: null | [листы], who, via, rid }
  teamChordsDone: (r) => ipcRenderer.invoke('team:chordsDone', r), // ответ: { rid, err? }
  // Пульт оператора на планшете (opctl.js): состояние разделами, команды { rid, a, x, who } и ответ { rid, res }
  teamOpState: (st) => ipcRenderer.invoke('team:opState', st),
  onTeamOp: (cb) => on('team:op', cb),
  onTeamOpWant: (cb) => on('team:opWant', cb), // true — пульт открыт хотя бы на одном планшете
  teamOpDone: (r) => ipcRenderer.invoke('team:opDone', r),
  // Трансляция экрана видео (opcast.js): сообщения WebRTC планшета { peer, m }, ответ ему, кадры зеркала { sid, seq, jpg }
  onTeamRtc: (cb) => on('team:rtc', cb),
  teamRtcOut: (r) => ipcRenderer.invoke('team:rtcOut', r),
  onTeamCastFrame: (cb) => on('team:castFrame', cb),
  teamCastKeep: (sids) => ipcRenderer.invoke('team:castKeep', sids), // какие экраны сейчас идут видео (раз в секунду)
  onTeamInfo: (cb) => on('team:info', cb),
  // Библия по голосу (voice.js, voicesrv.js): модели Vosk, скрытое окно распознавания
  voiceState: () => ipcRenderer.invoke('voice:state'),
  voiceGet: (lang) => ipcRenderer.invoke('voice:get', lang), // скачать модель языка
  voiceFile: (lang) => ipcRenderer.invoke('voice:file', lang), // своя модель из .zip
  voiceAdd: (x) => ipcRenderer.invoke('voice:add', x), // другой язык { lang, name, url, mb }
  voiceRemove: (lang) => ipcRenderer.invoke('voice:remove', lang), // убрать свой язык / скачанную модель
  voiceStart: (cfg) => ipcRenderer.invoke('voice:start', cfg), // { lang, mic, label }
  voiceStop: (why) => ipcRenderer.invoke('voice:stop', why), // why — откуда выключили (в журнал)
  onVoiceText: (cb) => on('voice:text', cb), // { text, final } | { state, error } | { level }
  onVoiceProgress: (cb) => on('voice:progress', cb),
  voiceSend: (m) => ipcRenderer.send('voice:send', m), // только из voice.html
  // Проверка перед служением: какие файлы есть на диске → [true|false]
  filesCheck: (paths) => ipcRenderer.invoke('files:check', paths),
  onThumbDraw: (cb) => on('thumb:draw', cb),
  thumbReady: () => ipcRenderer.send('thumb:ready'),
  appReady: () => ipcRenderer.send('app:ready'), // окно программы загрузилось — убрать заставку (splash.js → main.js)
});
