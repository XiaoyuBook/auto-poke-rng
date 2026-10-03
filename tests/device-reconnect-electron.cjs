const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerDevices } = require('../electron/devices.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');

const root = path.resolve(__dirname, '..');
const output = process.env.AUTO_POKE_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'poke-reconnect-ui-'));
const profile = path.join(output, 'profile');
const phase = process.env.AUTO_POKE_QA_PHASE || 'failure';
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
let devices, testWindow;
const errors = [];
const deadline = setTimeout(() => { console.error('Reconnect UI test timeout'); app.exit(1); }, 45000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, label) {
  for (let i = 0; i < 250; ++i) { if (await action()) return; await delay(40); }
  throw Error(label);
}
app.whenReady().then(async () => {
  if (phase === 'failure') fs.writeFileSync(path.join(profile, 'device-connections.json'), JSON.stringify({
    version: 1, autoReconnect: false, controller: { port: 'COM9999', name: 'COM9999' },
  }));
  if (phase === 'video') fs.writeFileSync(path.join(profile, 'device-connections.json'), JSON.stringify({
    version: 1, autoReconnect: false, controller: { port: 'mock', name: 'mock' },
    video: { deviceId: 'synthetic', backend: 'msmf', width: 320, height: 240, fps: 30, name: '测试视频源' },
  }));
  const main = new BrowserWindow({ width: 1440, height: 920, show: false, webPreferences: {
    preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true,
  } });
  testWindow = main;
  main.webContents.on('console-message', event => { if (['error', 'warning'].includes(event.level)) errors.push(event.message); });
  ipcMain.handle('app:metadata', () => ({ version: 'test', platform: 'win32' }));
  ipcMain.handle('qq:state', () => ({ status: 'unconfigured' }));
  ipcMain.handle('automation:state', () => ({ state: { status: 'idle' }, logs: [], runs: [], config: {}, profiles: {}, staticGroups: { activeId: 'default', items: [] }, logging: true }));
  ipcMain.handle('automation:log', () => {});
  ipcMain.handle('blink:state', () => ({ status: 'idle' }));
  const loadWindow = (window, query = {}) => window.loadFile(path.join(root, 'dist/index.html'), { query });
  registerPanelWindows({ getMainWindow: () => main, loadWindow });
  const scripts = path.join(output, 'scripts'); fs.mkdirSync(scripts, { recursive: true });
  registerScriptFiles({ getMainWindow: () => main, rootDirectory: scripts });
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), loadWindow, userData: profile, rootDirectory: scripts, testMode: true });
  await loadWindow(main);
  const js = code => main.webContents.executeJavaScript(code, true);
  await until(() => js("Boolean(document.querySelector('[aria-label=\"按上次重连\"]'))"), 'quick reconnect icon did not render');
  assert.equal(await js("location.pathname.endsWith('/dist/index.html') && document.body.innerText.includes('脚本编辑')"), true);
  if (phase === 'failure') {
    await js("document.querySelector('[aria-label=\"按上次重连\"]').click()");
    assert.equal(await js("document.querySelectorAll('dialog[open]').length"), 0);
    await until(() => js("Boolean(document.querySelector('.connection-notice'))"), 'failure notification did not render');
    assert.match(await js("document.querySelector('.connection-notice').textContent"), /伊机控.*COM9999/);
    await until(() => js("!document.querySelector('.connection-notice-actions button').disabled"), 'retry becomes available after the failed batch');
    assert.equal(devices.getState().controller.status, 'failed');
    const bounds = await js("Array.from(document.querySelectorAll('.sidebar-actions button')).map(x=>({label:x.getAttribute('aria-label'),left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right}))");
    assert.equal(bounds.length, 4); assert(bounds.every(item => item.right <= 248), 'sidebar tools overflow the existing sidebar');
    assert.equal(await js("document.querySelectorAll('vite-error-overlay').length"), 0);
    await delay(200); // Let Chromium paint the state that was just asserted.
    fs.writeFileSync(path.join(output, 'reconnect-failure.png'), (await main.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'reconnect-notice.png'), (await main.webContents.capturePage({ x: 1000, y: 730, width: 440, height: 190 })).toPNG());
    fs.writeFileSync(path.join(output, 'reconnect-toolbar.png'), (await main.webContents.capturePage({ x: 0, y: 0, width: 248, height: 65 })).toPNG());
    await js("document.querySelector('[aria-label=\"关闭设备连接提示\"]').click()");
    assert.equal(await js("document.querySelector('.connection-notice')"), null);
    assert.equal(await js("document.querySelector('[data-connection-status=\"failed\"] .tool-status-dot').classList.contains('failed')"), true);
    await js("document.querySelector('[data-connection-status=\"failed\"]').click()");
    await until(() => js("Boolean(document.querySelector('[aria-label=\"伊机控串口\"] option[value=\"COM9999\"]'))"), 'saved missing port was silently replaced');
    assert.equal(await js("document.querySelector('[aria-label=\"伊机控串口\"]').value"), 'COM9999');
    await js("document.querySelector('[aria-label=\"关闭伊机控连接\"]').click()");
    await js("window.desktop.devices.controller.connect('mock')");
    await until(() => devices.getState().controller.status === 'connected', 'mock controller handshake');
    const disk = JSON.parse(fs.readFileSync(path.join(profile, 'device-connections.json'), 'utf8'));
    assert.equal(disk.controller.port, 'mock');
    assert.equal(disk.autoReconnect, false);
    await js("window.desktop.devices.controller.disconnect()");
    await js("document.querySelector('[aria-label=\"按上次重连\"]').click()");
    await until(() => devices.getState().controller.status === 'connected', 'saved controller reconnect');
    assert.equal(await js("document.querySelector('.connection-notice')"), null);
    const before = await devices.controller.call('controller.status');
    await js("document.querySelector('[aria-label=\"按上次重连\"]').click()");
    await delay(120);
    const after = await devices.controller.call('controller.status');
    assert.equal(after.name, before.name); assert.deepEqual(after.report, before.report);
    await delay(200);
    fs.writeFileSync(path.join(output, 'reconnect-success-toolbar.png'), (await main.webContents.capturePage({ x: 0, y: 0, width: 248, height: 65 })).toPNG());
    await js("document.querySelector('[aria-label=\"收起侧栏\"]').click()");
    await until(() => js("Array.from(document.querySelectorAll('.sidebar-actions button')).every(x=>x.getBoundingClientRect().right<=60)"), 'collapsed toolbar overflow');
    await js("document.querySelector('[aria-label=\"展开侧栏\"]').click()");
    await js("window.desktop.devices.audio.connect({deviceId:'synthetic'})");
    await until(() => devices.getState().audio.status === 'connected', 'native audio connected');
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'device-connections.json'), 'utf8')).audio.deviceId, 'synthetic');
    await js("window.desktop.devices.audio.disconnect()");
    await js("document.querySelector('[aria-label=\"按上次重连\"]').click()");
    await until(() => devices.getState().audio.status === 'connected', 'saved audio reconnect');
    assert.equal(await js("document.querySelector('.connection-notice')"), null);
    await js("document.querySelector('[aria-label=\"设置\"]').click()");
    await until(() => js("Boolean(document.querySelector('.connection-setting input:not(:disabled)'))"), 'startup preference UI ready');
    assert.equal(await js("document.querySelector('.connection-setting input').checked"), false);
    await js("document.querySelector('.connection-setting input').click()");
    await until(() => JSON.parse(fs.readFileSync(path.join(profile, 'device-connections.json'), 'utf8')).autoReconnect, 'startup preference saved by checkbox');
    await js("document.querySelector('[aria-label=\"关闭设置\"]').click()");
  } else if (phase === 'restart') {
    assert.equal((await js('window.desktop.devices.connections.getState()')).preferences.controller.port, 'mock');
    devices.startReconnect(); devices.startReconnect();
    await until(() => devices.getState().controller.status === 'connected', 'startup reconnect after process restart');
    await until(() => devices.getState().audio.status === 'connected', 'startup audio reconnect after process restart');
    assert.equal(await js("document.querySelector('.connection-notice')"), null);
    console.log('PASS: real Electron process restart retained the configuration and restored the controller once.');
  } else {
    await js("document.querySelector('[aria-label=\"按上次重连\"]').click()");
    await until(async () => !(await js('window.desktop.devices.connections.getState()')).busy, 'native video reconnect completed');
    assert.equal(devices.getState().controller.status, 'connected');
    const video = devices.getState().video;
    if (video.status === 'failed') {
      assert.equal(video.code, 'DEVICE_BUSY');
      await until(() => js("document.querySelector('.connection-notice')?.textContent.includes('视频源')"), 'native device busy failure notice');
      assert.equal(await js("document.querySelector('[data-connection-status=\"failed\"] .tool-status-dot').classList.contains('failed')"), true);
      await delay(200);
      fs.writeFileSync(path.join(output, 'reconnect-video-busy.png'), (await main.webContents.capturePage()).toPNG());
    } else {
      assert.equal(video.status, 'connected');
      assert.equal(video.deviceId, 'synthetic');
      assert.equal(await js("document.querySelector('.connection-notice')"), null);
    }
    const before = await devices.controller.call('controller.status');
    await js("document.querySelector('[aria-label=\"按上次重连\"]').click()");
    await until(async () => !(await js('window.desktop.devices.connections.getState()')).busy, 'native retry completed');
    const after = await devices.controller.call('controller.status');
    assert.equal(after.name, before.name); assert.deepEqual(after.report, before.report);
    console.log('PASS: native video ' + video.status + '; independent controller and its report retained after retry.');
  }
  assert.equal(errors.filter(message => !message.includes('Electron Security Warning')).length, 0, errors.join('\n'));
  await devices.close(); main.destroy(); clearTimeout(deadline);
  console.log('PASS: Electron reconnect phase ' + phase + ', renderer console healthy.');
  console.log('Screenshots: ' + output);
  app.exit(0);
}).catch(async error => { console.error(error); console.error(errors.join('\n')); if (testWindow && !testWindow.isDestroyed()) console.error(await testWindow.webContents.executeJavaScript('JSON.stringify({url:location.href,text:document.body.innerText,root:document.getElementById("root")?.innerHTML.slice(0,1000),desktop:!!window.desktop})')); if (devices) await devices.close().catch(() => {}); clearTimeout(deadline); app.exit(1); });
