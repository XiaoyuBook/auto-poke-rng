const { app, BrowserWindow, ipcMain, shell, safeStorage, nativeImage } = require('electron');
const path = require('node:path');
const { registerPanelWindows } = require('./panel-windows.cjs');
const { registerScriptFiles } = require('./script-files.cjs');
const { registerDevices } = require('./devices.cjs');
const { registerQQNotifications } = require('./qq-notifications.cjs');
const { registerRng } = require('./rng-client.cjs');
const { registerBlink } = require('./blink-client.cjs');

let mainWindow = null;
let panels;
let devices;
let notifications;
let rng;
let blink;
let quitting = false;

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
  window.webContents.on('render-process-gone', () => { void devices?.stopInputs().catch(() => {}); notifications?.cancel(); });
  void loadWindow(window);
  window.on('closed', () => { notifications?.cancel(); mainWindow = null; panels.closeAll(); void devices?.controllerOverlay?.close(); });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: app.getVersion(), platform: process.platform }));
  panels = registerPanelWindows({ getMainWindow: () => mainWindow, loadWindow });
  registerScriptFiles({ getMainWindow: () => mainWindow, getLabelWindows: () => [panels.getVideoWindow()], rootDirectory: path.join(app.getAppPath(), 'scripts') });
  // The unpackaged GUI is the local development entry point. Keep mock
  // hardware available there even when a shell drops environment variables;
  // packaged production builds remain real-device only unless explicitly
  // launched with the test flag.
  const testDevices = !app.isPackaged || process.env.AUTO_POKE_TEST_DEVICES === '1';
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), loadWindow, testMode: testDevices });
  notifications = registerQQNotifications({ ipcMain, getMainWindow: () => mainWindow, safeStorage, nativeImage, userData: app.getPath('userData') });
  rng = registerRng({ ipcMain, getMainWindow: () => mainWindow });
  blink = registerBlink({ ipcMain, getMainWindow: () => mainWindow, getVideo: () => devices.getState().video });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', event => {
  if (quitting || !devices) return;
  event.preventDefault(); quitting = true;
  notifications?.close();
  void Promise.allSettled([devices.close(), rng?.close?.(), blink?.close()]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
