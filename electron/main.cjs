const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { registerPanelWindows } = require('./panel-windows.cjs');

let mainWindow = null;
let panels;

function loadWindow(window, query = {}) {
  if (!app.isPackaged) {
    const url = new URL('http://127.0.0.1:5173');
    url.search = new URLSearchParams(query).toString();
    return window.loadURL(url.toString());
  }
  return window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#191a1a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#191a1a', symbolColor: '#acafaf', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  void loadWindow(window);
  window.on('closed', () => { mainWindow = null; panels.closeAll(); });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: app.getVersion(), platform: process.platform }));
  panels = registerPanelWindows({ getMainWindow: () => mainWindow, loadWindow });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
