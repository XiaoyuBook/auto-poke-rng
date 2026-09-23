const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerDevices } = require('../electron/devices.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'node_modules/.tmp/key-mapping-review');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
let devices;
const timeout = setTimeout(() => { console.error('Mapping test timeout'); app.exit(1); }, 45000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, label) { for (let i = 0; i < 100; i++) { if (await action()) return; await delay(30); } throw new Error(label); }

app.whenReady().then(async () => {
  const main = new BrowserWindow({ width: 1440, height: 920, show: false, webPreferences: {
    preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
  } });
  const loadWindow = (window, query = {}) => window.loadFile(path.join(root, 'dist/index.html'), { query });
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: 'test', platform: 'win32' }));
  const scriptRoot = fs.mkdtempSync(path.join(output, 'scripts-'));
  registerPanelWindows({ getMainWindow: () => main, loadWindow });
  registerScriptFiles({ getMainWindow: () => main, rootDirectory: scriptRoot });
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), loadWindow, rootDirectory: scriptRoot, testMode: true });
  // Verify the real control manager and IPC without intercepting the developer's keyboard.
  devices.controllerOverlay.input.ensureChild = async () => {};
  await loadWindow(main);
  const js = code => main.webContents.executeJavaScript(code, true);
  await js('localStorage.clear()');
  main.showInactive();
  const click = selector => js(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.focus(); node.click(); })()`);
  const binding = id => js(`document.querySelector('[data-mapping-id="${id}"]').getAttribute('aria-label')`);
  const key = async (keyCode, modifiers = []) => {
    main.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    main.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await delay(30);
  };
  const open = async () => {
    await js("[...document.querySelectorAll('button')].find(node => node.textContent === '按键映射').click()");
    await until(() => js('Boolean(document.querySelector("dialog.key-mapping-dialog[open]"))'), 'native mapping modal');
  };
  const save = async () => {
    await click('.key-mapping-actions .primary');
    await until(() => js('!document.querySelector(".key-mapping-dialog")'), 'mapping saved and closed');
  };
  const snapshot = async name => {
    await delay(200); // Let theme/focus color transitions finish before capturing.
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const bounds = await js(`(() => { const r = document.querySelector('.key-mapping-dialog').getBoundingClientRect(); return {x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height)}; })()`);
    fs.writeFileSync(path.join(output, name + '.png'), (await main.webContents.capturePage(bounds)).toPNG());
  };
  await open();
  assert.equal(await js('document.querySelectorAll("[data-mapping-id]").length'), 30);
  assert.equal(await js('document.querySelector(".mapping-controller image") === null'), true, 'diagram has no raster background');
  assert.ok(await js(`(() => { const c=document.querySelector('.key-mapping-content'); return c.scrollHeight <= c.clientHeight + 1; })()`), 'complete controller fits without vertical clipping');
  await snapshot('default');
  await click('[data-mapping-id="B"]');
  await snapshot('listening');
  await key('L');
  assert.equal(await binding('B'), 'B：L');
  assert.equal(await binding('A'), 'A：未绑定');
  assert.ok(await js('document.querySelector(".mapping-notice").textContent.includes("A 已解除绑定")'));
  await snapshot('conflict');
  await click('.key-mapping-actions .button:not(.primary)');
  await open();
  assert.equal(await binding('A'), 'A：L', 'cancel discards changes');
  assert.equal(await binding('B'), 'B：K');
  await click('[data-mapping-id="A"]');
  await key('P', ['control']);
  assert.equal(await binding('A'), 'A：L', 'combination does not silently bind');
  await key('Escape');
  assert.equal(await binding('A'), 'A：未绑定', 'Escape clears only the selected binding');
  assert.ok(await js('Boolean(document.querySelector(".key-mapping-dialog[open]"))'));
  await click('[data-mapping-id="A"]');
  await key('Enter');
  assert.equal(await binding('A'), 'A：Enter');
  assert.equal(await js('Boolean(document.querySelector(".mapping-key-button.listening"))'), false, 'Enter does not re-arm the clicked button');
  await save();
  await open();
  assert.equal(await binding('A'), 'A：Enter', 'saved mapping survives reopen');
  await click('.mapping-reset');
  assert.equal(await binding('A'), 'A：L');
  await save();

  // Active and standby both stop their hooks until the mapping window closes.
  await js('window.desktop.devices.controller.connect("mock")');
  await js('window.desktop.overlay.toggle()');
  await until(() => js('window.desktop.overlay.getState().then(s => s.active)'), 'active virtual controller');
  await open();
  assert.equal((await js('window.desktop.overlay.getState()')).active, false);
  await js('window.desktop.overlay.toggleActive()');
  assert.equal((await js('window.desktop.overlay.getState()')).active, false, 'overlay cannot recapture keys during editing');
  await save();
  await until(() => js('window.desktop.overlay.getState().then(s => s.active)'), 'restore active after save');
  await js('window.desktop.overlay.toggleActive()');
  await open();
  await save();
  assert.equal((await js('window.desktop.overlay.getState()')).mode, 'standby', 'restore standby without activation');
  await js('window.desktop.overlay.hide()');

  await open();
  // Token overrides exercise the same diagram in a future light theme.
  await js(`document.documentElement.style.cssText = '--canvas:#f4f5f7;--surface:#ffffff;--raised:#e9edf2;--line:#cbd2db;--muted:#626d7b;--secondary:#4d5967;--text:#202933;--accent:#586dc9;--hover:#e0e6f0'`);
  await snapshot('light-theme');
  await js('document.documentElement.style.cssText = ""');
  main.setSize(900, 680);
  await until(() => js('innerWidth <= 900'), 'compact window');
  await snapshot('compact');
  assert.ok(await js(`(() => { const d=document.querySelector('.key-mapping-dialog'); return d.scrollWidth <= d.clientWidth; })()`), 'no horizontal clipping');
  await key('Escape');
  await devices.close();
  clearTimeout(timeout);
  console.log('PASS: 30 graphic controls; conflict replacement, cancellation, save, defaults, single-key capture, modal input isolation, active/standby restore, dark/light/compact screenshots.');
  app.exit(0);
}).catch(async error => { console.error(error); if (devices) await devices.close(); clearTimeout(timeout); app.exit(1); });
