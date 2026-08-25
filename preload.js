const { contextBridge, ipcRenderer } = require('electron');
const platform = process.platform;

contextBridge.exposeInMainWorld('cue', {
  platform,
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  usageLifetimeReset: () => ipcRenderer.invoke('usage:lifetime-reset'),
  sessionsList: () => ipcRenderer.invoke('sessions:list'),
  sessionsGet: (id) => ipcRenderer.invoke('sessions:get', id),
  sessionsDelete: (id) => ipcRenderer.invoke('sessions:delete', id),
  sessionsExport: (id) => ipcRenderer.invoke('sessions:export', id),
  sessionsSearch: (query) => ipcRenderer.invoke('sessions:search', query),
  whisperModels: () => ipcRenderer.invoke('whisper:models'),
  whisperModelDownload: (modelId) => ipcRenderer.invoke('whisper:model-download', modelId),
  whisperModelCancel: (modelId) => ipcRenderer.invoke('whisper:model-cancel', modelId),
  whisperModelDelete: (modelId) => ipcRenderer.invoke('whisper:model-delete', modelId),
  whisperModelImport: (modelId) => ipcRenderer.invoke('whisper:model-import', modelId),
  platformInfo: () => ipcRenderer.invoke('platform:info'),
  ask: (payload) => ipcRenderer.send('ask', payload),
  actionInvoke: ({ id, kind, payload }) => ipcRenderer.send('action:invoke', { id, kind, payload }),
  captureToggle: () => ipcRenderer.invoke('capture:toggle').catch((err) => {
    console.error('[cue] captureToggle error', err);
    return false;
  }),
  captureState: () => ipcRenderer.invoke('capture:state'),
  voiceprintStatus: () => ipcRenderer.invoke('voiceprint:status'),
  voiceprintEnroll: () => ipcRenderer.invoke('voiceprint:enroll'),
  voiceprintDelete: () => ipcRenderer.invoke('voiceprint:delete'),
  captureInputFailed: (channel, message) => ipcRenderer.invoke('capture:input-failed', { channel, message }),
  micPcm: (arrayBuffer) => ipcRenderer.send('mic:pcm', arrayBuffer),
  systemPcm: (arrayBuffer) => ipcRenderer.send('system:pcm', arrayBuffer),
  setIgnoreMouse: (v) => ipcRenderer.send('mouse:ignore', v),
  clearTranscript: () => ipcRenderer.invoke('transcript:clear'),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  appLinkState: () => ipcRenderer.invoke('applink:state'),
  appLinkRevoke: (callerId) => ipcRenderer.invoke('applink:revoke', callerId),
  appLinkConsentRespond: (id, allowed) => ipcRenderer.send('applink:consent-response', { id, allowed }),
  searchRespond: (id, allowed) => ipcRenderer.send('search:respond', { id, allowed }),
  pickProfileDocument: () => ipcRenderer.invoke('profile:pickDocument'),
  pickDocuments: () => ipcRenderer.invoke('documents:pick'),
  quit: () => ipcRenderer.send('app:quit'),
  permissionsCheck: () => ipcRenderer.invoke('permissions:check'),
  permissionsRequest: () => ipcRenderer.invoke('permissions:request'),
  permissionsContinue: () => ipcRenderer.send('permissions:continue'),
  log: (msg) => ipcRenderer.send('log', msg),
  on: (channel, cb) => {
    const allowed = ['capture:state', 'llm:start', 'llm:token', 'llm:done', 'llm:error', 'status', 'transcript', 'stt:interim', 'stt:final', 'stt:status', 'vad:state', 'applink:consent-request', 'search:request', 'hide:toggle', 'whisper:download-progress', 'whisper:models-changed', 'insights:new', 'insights:clear', 'actions:new', 'usage:update'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
