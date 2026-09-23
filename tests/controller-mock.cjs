const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { registerDevices } = require('../electron/devices.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Controller mock test timeout'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  const main = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const loadWindow = (window, query = {}) => window.loadFile(path.join(root, 'dist/index.html'), { query });
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: 'test', platform: 'win32' }));
  registerPanelWindows({ getMainWindow: () => main, loadWindow });
  registerScriptFiles({ getMainWindow: () => main, rootDirectory: path.join(root, 'scripts') });
  const devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), loadWindow, testMode: true });
  await main.loadFile(path.join(root, 'dist/index.html'));
  const js = code => main.webContents.executeJavaScript(code, true);
  const state = () => js('window.desktop.devices.getState()');
  const until = async (action, label) => { for (let i = 0; i < 150; i++) { if (await action()) return; await delay(40); } throw new Error(label); };

  const ports = await js('window.desktop.devices.controller.list()');
  assert.equal(ports.some(item => item.id === 'mock'), true, 'mock serial port is enumerated');
  await js('window.desktop.devices.controller.connect("mock")');
  await until(async () => (await state()).controller.status === 'connected', 'mock controller connected');
  const neutral = (await state()).controller.report;
  assert.deepEqual(neutral, { buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 }, 'mock connection starts with a neutral report');

  await js('window.desktop.overlay.setMapping({A:"KeyL",LSUp:"KeyW"})');
  await js('window.desktop.overlay.toggle()');
  await until(async () => (await js('window.desktop.overlay.getState()')).active === true, 'virtual controller active');
  await js('window.desktop.overlay.toggleActive()');
  await until(async () => (await js('window.desktop.overlay.getState()')).mode === 'standby', 'virtual controller standby');
  await js('window.desktop.overlay.toggleActive()');
  await until(async () => (await js('window.desktop.overlay.getState()')).active === true, 'virtual controller reactivated');

  await js('window.desktop.overlay.hide()');
  await until(async () => (await js('window.desktop.overlay.getState()')).visible === false, 'virtual controller hidden');
  await js('window.desktop.devices.controller.disconnect()');
  await until(async () => (await state()).controller.status === 'idle', 'mock controller disconnected');
  assert.equal((await js('window.desktop.overlay.getState()')).visible, false, 'disconnect keeps virtual controller hidden');
  await devices.close();
  clearTimeout(timeout);
  console.log('PASS: mock serial enumeration, virtual controller state transitions and disconnect cleanup.');
  app.exit(0);
}).catch(async error => { console.error(error); clearTimeout(timeout); app.exit(1); });
