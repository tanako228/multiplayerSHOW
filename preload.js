const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

// Запасная копия настроек (только окно оператора): localStorage «cp.*» ↔ settings-backup.json (main.js).
// Хранилище пропало (нет cp.settings) — до запуска скриптов окна возвращаем всё из файла.
if (/\/index\.html$/i.test(location.pathname)) {
  const snap = () => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('cp.')) o[k] = localStorage.getItem(k); }
    return o;
  };
  try {
    if (!localStorage.getItem('cp.settings')) {
      const old = ipcRenderer.sendSync('ls:restore');
      if (old && old['cp.settings']) for (const [k, v] of Object.entries(old)) if (k.startsWith('cp.') && typeof v === 'string') localStorage.setItem(k, v);
    }
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
  window.addEventListener('beforeunload', () => backup(true));
}

contextBridge.exposeInMainWorld('api', {
  getDisplays: () => ipcRenderer.invoke('displays:get'),
  identifyDisplays: () => ipcRenderer.invoke('displays:identify'), // большие номера на мониторах на 3 с
  pickMedia: (opts) => ipcRenderer.invoke('media:pick', opts),
  describeFiles: (paths, opts) => ipcRenderer.invoke('media:describe', paths, opts),
  pathForFile: (file) => webUtils.getPathForFile(file),

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

  setInk: (shapes, opts) => ipcRenderer.invoke('output:ink', shapes, opts),
  setView: (view, ms) => ipcRenderer.invoke('output:view', view, ms),
  videoCtl: (msg) => ipcRenderer.invoke('output:video', msg),

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
  revealFile: (p) => ipcRenderer.invoke('file:reveal', p),
  repoExists: (dir) => ipcRenderer.invoke('repo:exists', dir),
  repoOpen: () => ipcRenderer.invoke('repo:open'),
  repoRestore: (opts) => ipcRenderer.invoke('repo:restore', opts),
  backupRestore: (opts) => ipcRenderer.invoke('backup:restore', opts),
  dataOpen: () => ipcRenderer.invoke('data:open'),
  dataPath: () => ipcRenderer.invoke('data:path'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  // Обновление программы с GitHub
  updGet: () => ipcRenderer.invoke('update:get'),
  updCheck: () => ipcRenderer.invoke('update:check'),
  updInstall: () => ipcRenderer.invoke('update:install'),
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
  songsOpen: () => ipcRenderer.invoke('songs:open'),
  songSave: (opts) => ipcRenderer.invoke('songs:save', opts),
  songsSaveMany: (songs) => ipcRenderer.invoke('songs:saveMany', songs),

  poolPickFolder: (title) => ipcRenderer.invoke('pool:pickFolder', title),
  poolList: (dir) => ipcRenderer.invoke('pool:list', dir),
  poolWatch: (dir) => ipcRenderer.invoke('pool:watch', dir),
  onPoolChanged: (cb) => on('pool:changed', cb),
  poolScan: (roots) => ipcRenderer.invoke('pool:scan', roots),
  poolThumb: (file) => ipcRenderer.invoke('pool:thumb', file),
  musicCover: (file) => ipcRenderer.invoke('music:cover', file),
  startDrag: (file) => ipcRenderer.send('drag:start', file),
  sourcesScreens: () => ipcRenderer.invoke('sources:screens'),
  sourcesNdi: () => ipcRenderer.invoke('sources:ndi'),
  ndiFind: () => ipcRenderer.invoke('ndi:find'),
  ndiOpen: (name) => ipcRenderer.invoke('ndi:open', name),
  ndiClose: (key) => ipcRenderer.send('ndi:close', key),
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
  onTeamInfo: (cb) => on('team:info', cb),
  onThumbDraw: (cb) => on('thumb:draw', cb),
  thumbReady: () => ipcRenderer.send('thumb:ready'),
});
