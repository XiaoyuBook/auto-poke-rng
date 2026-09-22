const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, listener) => {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', {
  getMetadata: () => ipcRenderer.invoke('app:metadata'),
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
      stop: () => ipcRenderer.invoke('execution:stop'),
    },
    video: {
      list: backend => ipcRenderer.invoke('video:list', { backend }),
      connect: config => ipcRenderer.invoke('video:connect', config),
      disconnect: () => ipcRenderer.invoke('video:disconnect'),
      snapshot: () => ipcRenderer.invoke('video:snapshot'),
      getSnapshot: () => ipcRenderer.invoke('video:get-snapshot'),
      onSnapshot: listener => subscribe('video:snapshot-updated', listener),
    },
  },
  scripts: {
    list: () => ipcRenderer.invoke('scripts:list'),
    create: folder => ipcRenderer.invoke('scripts:create', { folder }),
    save: script => ipcRenderer.invoke('scripts:save', script),
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
