const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, listener) => {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', {
  getMetadata: () => ipcRenderer.invoke('app:metadata'),
  notifications: {
    getState: () => ipcRenderer.invoke('qq:state'),
    save: values => ipcRenderer.invoke('qq:save', values),
    verify: () => ipcRenderer.invoke('qq:verify'),
    bind: kind => ipcRenderer.invoke('qq:bind', kind),
    unbind: kind => ipcRenderer.invoke('qq:unbind', kind),
    sendTest: () => ipcRenderer.invoke('qq:test'),
    confirmTest: () => ipcRenderer.invoke('qq:confirm'),
    cancel: bindingOnly => ipcRenderer.invoke('qq:cancel', bindingOnly),
    onState: listener => subscribe('qq:state', listener),
  },
  devices: {
    getState: () => ipcRenderer.invoke('devices:state'),
    onState: listener => subscribe('devices:state', listener),
    onEvent: listener => subscribe('devices:event', listener),
    controller: {
      list: () => ipcRenderer.invoke('controller:list'),
      connect: port => ipcRenderer.invoke('controller:connect', { port }),
      disconnect: () => ipcRenderer.invoke('controller:disconnect'),
      press: key => ipcRenderer.invoke('controller:press', { key }),
      key: (key, down) => ipcRenderer.invoke('controller:key', { key, down }),
      stick: (side, x, y) => ipcRenderer.invoke('controller:stick', { side, x, y }),
      reset: () => ipcRenderer.invoke('controller:reset'),
      stop: () => ipcRenderer.invoke('controller:stop'),
    },
    execution: {
      start: script => ipcRenderer.invoke('execution:start', script),
      validate: script => ipcRenderer.invoke('execution:validate', script),
      stop: () => ipcRenderer.invoke('execution:stop'),
    },
    video: {
      list: backend => ipcRenderer.invoke('video:list', { backend }),
      connect: config => ipcRenderer.invoke('video:connect', config),
      disconnect: () => ipcRenderer.invoke('video:disconnect'),
      snapshot: () => ipcRenderer.invoke('video:snapshot'),
      getSnapshot: () => ipcRenderer.invoke('video:get-snapshot'),
      ocr: (imageBase64, language = '') => ipcRenderer.invoke('video:ocr', { imageBase64, language }),
      onSnapshot: listener => subscribe('video:snapshot-updated', listener),
    },
  },
  overlay: {
    getState: () => ipcRenderer.invoke('controller-overlay:state'),
    show: () => ipcRenderer.invoke('controller-overlay:show'),
    hide: () => ipcRenderer.invoke('controller-overlay:hide'),
    toggle: () => ipcRenderer.invoke('controller-overlay:toggle'),
    toggleActive: () => ipcRenderer.invoke('controller-overlay:toggle-active'),
    setActive: active => ipcRenderer.invoke('controller-overlay:set-active', { active }),
    suspend: () => ipcRenderer.invoke('controller-overlay:suspend'),
    resume: () => ipcRenderer.invoke('controller-overlay:resume'),
    setMapping: mapping => ipcRenderer.invoke('controller-overlay:set-mapping', { mapping }),
    resetPosition: () => ipcRenderer.invoke('controller-overlay:reset-position'),
    moveBy: (dx, dy) => ipcRenderer.invoke('controller-overlay:move-by', { dx, dy }),
    setScale: scale => ipcRenderer.invoke('controller-overlay:set-scale', { scale }),
    onState: listener => subscribe('controller-overlay:state', listener),
    onInput: listener => subscribe('controller-overlay:input', listener),
    onError: listener => subscribe('controller-overlay:error', listener),
  },
  scripts: {
    list: () => ipcRenderer.invoke('scripts:list'),
    create: folder => ipcRenderer.invoke('scripts:create', { folder }),
    save: script => ipcRenderer.invoke('scripts:save', script),
    labelsList: folder => ipcRenderer.invoke('scripts:labels-list', { folder }),
    labelRead: (folder, name) => ipcRenderer.invoke('scripts:label-read', { folder, name }),
    labelSave: label => ipcRenderer.invoke('scripts:label-save', label),
  },
  panels: {
    open: tool => ipcRenderer.invoke('panels:open', tool),
    getState: () => ipcRenderer.invoke('panels:get-state'),
    publishLogs: logs => ipcRenderer.invoke('panels:publish-logs', logs),
    setLogSource: source => ipcRenderer.invoke('panels:log-source', source),
    clearLogs: () => ipcRenderer.invoke('panels:clear-logs'),
    dock: () => ipcRenderer.invoke('panels:dock'),
    setAlwaysOnTop: enabled => ipcRenderer.invoke('panels:always-on-top', enabled),
    setVideoLabelsOpen: open => ipcRenderer.invoke('panels:video-labels', open),
    onState: listener => subscribe('panels:state', listener),
    onAction: listener => subscribe('panels:action', listener),
  },
});
