const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getMetadata: () => ipcRenderer.invoke('app:metadata'),
});
