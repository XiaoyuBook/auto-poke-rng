const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, listener) => {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', {
  getMetadata: () => ipcRenderer.invoke('app:metadata'),
  panels: {
    open: tool => ipcRenderer.invoke('panels:open', tool),
    getState: () => ipcRenderer.invoke('panels:get-state'),
    publishLogs: logs => ipcRenderer.invoke('panels:publish-logs', logs),
    setLogSource: source => ipcRenderer.invoke('panels:log-source', source),
    clearLogs: () => ipcRenderer.invoke('panels:clear-logs'),
    dock: () => ipcRenderer.invoke('panels:dock'),
    setAlwaysOnTop: enabled => ipcRenderer.invoke('panels:always-on-top', enabled),
    onState: listener => subscribe('panels:state', listener),
    onAction: listener => subscribe('panels:action', listener),
  },
});
