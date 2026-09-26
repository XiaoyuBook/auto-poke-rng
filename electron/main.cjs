const { app, BrowserWindow, ipcMain, shell, safeStorage, nativeImage, dialog } = require('electron');
const path = require('node:path');
const { registerPanelWindows } = require('./panel-windows.cjs');
const { registerScriptFiles } = require('./script-files.cjs');
const { registerDevices } = require('./devices.cjs');
const { registerQQNotifications } = require('./qq-notifications.cjs');
const { registerRng } = require('./rng-client.cjs');
const { registerBlink } = require('./blink-client.cjs');
const { registerAutomation } = require('./automation.cjs');
const { createScriptGate, initializeUserScripts } = require('./script-storage.cjs');
const { registerScriptRepository } = require('./script-repository.cjs');
const scriptGate = createScriptGate();

let mainWindow = null;
let panels;
let devices;
let notifications;
let rng;
let blink;
let automation;
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
  window.webContents.on('render-process-gone', () => { void automation?.stop('主窗口已退出', true); void devices?.stopInputs().catch(() => {}); notifications?.cancel(); });
  void loadWindow(window);
  window.on('closed', () => { void automation?.stop('主窗口已关闭'); notifications?.cancel(); mainWindow = null; panels.closeAll(); void devices?.controllerOverlay?.close(); });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  // scripts/ is no longer shipped. Preserve an existing local folder from
  // older versions on first migration; otherwise create an empty user library.
  const rootDirectory = await initializeUserScripts(app.getPath('userData'), path.join(app.getAppPath(), 'scripts'));
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: app.getVersion(), platform: process.platform }));
  panels = registerPanelWindows({ getMainWindow: () => mainWindow, loadWindow });
  registerScriptFiles({ getMainWindow: () => mainWindow, getLabelWindows: () => [panels.getVideoWindow()], rootDirectory, serialize: scriptGate.run });
  // The unpackaged GUI is the local development entry point. Keep mock
  // hardware available there even when a shell drops environment variables;
  // packaged production builds remain real-device only unless explicitly
  // launched with the test flag.
  const testDevices = !app.isPackaged || process.env.AUTO_POKE_TEST_DEVICES === '1';
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), loadWindow, rootDirectory, testMode: testDevices, isScriptLibraryBusy: () => scriptGate.busy });
  notifications = registerQQNotifications({ ipcMain, getMainWindow: () => mainWindow, safeStorage, nativeImage, userData: app.getPath('userData') });
  rng = registerRng({ ipcMain, getMainWindow: () => mainWindow, isAutomationBusy: () => devices.isAutomationBusy() });
  blink = registerBlink({ ipcMain, getMainWindow: () => mainWindow, getVideo: () => devices.getState().video, isAutomationBusy: () => devices.isAutomationBusy() });
  automation = registerAutomation({ ipcMain, getMainWindow: () => mainWindow, getWindows: () => BrowserWindow.getAllWindows(), devices, rng, blink, userData: app.getPath('userData') });
  registerScriptRepository({ ipcMain, getMainWindow: () => mainWindow, dialog, rootDirectory, userData: app.getPath('userData'), appVersion: app.getVersion(), gate: scriptGate,
    isBusy: () => !!devices.runner.current || automation.isBusy(), log: (message, level = 'info') => automation.store.log(message, '系统', level) });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => { dialog.showErrorBox('脚本库初始化失败', error.message); app.quit(); });

app.on('before-quit', event => {
  if (quitting || !devices) return;
  event.preventDefault(); quitting = true;
  notifications?.close();
  void automation?.close().catch(() => {}).then(() => Promise.allSettled([devices.close(), rng?.close?.(), blink?.close(), scriptGate.drain()])).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
