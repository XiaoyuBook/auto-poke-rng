const { app, BrowserWindow, ipcMain, safeStorage, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerFrlgRng } = require('../electron/frlg-rng-client.cjs');
const { registerFrlgAutomation } = require('../electron/frlg-automation.cjs');
const { unpackArchive } = require('../electron/script-repository.cjs');
const { registerDevices } = require('../electron/devices.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');
const { registerQQNotifications } = require('../electron/qq-notifications.cjs');
const expected = require('./fixtures/frlg-golbat-plan.json');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'node_modules/.tmp/frlg-review');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
let frlg, devices, notifications, frlgAutomation;
const timer = setTimeout(() => { console.error('FRLG Electron test timed out'); app.exit(1); }, 95000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: 'test', platform: 'win32' }));
  // Unrelated BDSP services stay idle; FRLG uses the real IPC/client/host.
  ipcMain.handle('automation:state', () => null);
  ipcMain.handle('blink:state', () => ({ status: 'idle', runId: null }));
  const main = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } });
  const loadWindow = (window, query = {}) => window.loadFile(path.join(root, 'dist/index.html'), { query });
  registerPanelWindows({ getMainWindow: () => main, loadWindow });
  const scriptRoot = fs.mkdtempSync(path.join(output, 'scripts-'));
  if (process.env.FRLG_SCRIPT_PACKAGE) {
    const { manifest, files } = unpackArchive(fs.readFileSync(process.env.FRLG_SCRIPT_PACKAGE));
    for (const [name, bytes] of Object.entries(files)) {
      const target = path.join(scriptRoot, manifest.installFolder, name);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    }
  }
  registerScriptFiles({ getMainWindow: () => main, rootDirectory: scriptRoot });
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), rootDirectory: scriptRoot, testMode: true });
  frlg = registerFrlgRng({ ipcMain, getMainWindow: () => main });
  notifications = registerQQNotifications({ ipcMain, getMainWindow: () => main, safeStorage, nativeImage, userData: app.getPath('userData') });
  frlgAutomation = registerFrlgAutomation({ ipcMain, getMainWindow: () => main, devices, client: frlg.client, userData: app.getPath('userData'), notifications });
  const js = async code => {
    const result = await main.webContents.executeJavaScript(`(async () => { try { return {value: await (${code})}; } catch (error) { return {error: String(error?.stack || error)}; } })()`, true);
    if (result.error) throw Error(result.error);
    return result.value;
  };
  const screenshot = async name => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    main.webContents.invalidate();
    await delay(250);
    fs.writeFileSync(path.join(output, name), (await main.webContents.capturePage()).toPNG());
  };
  const until = async (code, label, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await js(code)) return; await delay(40); }
    throw Error(label + ': ' + await js(`JSON.stringify({state: await window.desktop.frlgAutomation.getState(), errors: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent)})`));
  };
  const click = text => js(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(text)}).click()`);
  const change = (label, value, select = false) => js(`(() => {
    const input = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('${select ? 'change' : 'input'}', { bubbles: true }));
  })()`);
  await loadWindow(main);
  await until(`Boolean(document.querySelector('[title="自动流程"]'))`, 'app ready');
  await js(`document.querySelector('[title="首页"]').click()`);
  await js(`document.querySelector('.frlg-save-editor > summary').click()`);
  await change('火叶存档 SID', '38448');
  await click('保存当前存档');
  await js(`document.querySelector('[title="自动流程"]').click()`);
  await click('目标设置');
  await change('搜索方法', 'All Wild Methods', true);
  await change('野生遭遇地点', 'Cerulean Cave 1F', true);
  await change('火叶自动目标宝可梦', 'Golbat', true);
  assert.equal(await js(`document.querySelector('[aria-label="最小 Advance"]').value`), '3000');
  assert.equal(await js(`document.querySelector('[aria-label="最大 Advance"]').value`), '100000');
  const start = Date.now();
  await click('搜索并生成方案');
  await until(`Boolean(document.querySelector('.frlg-recommendation-card'))`, 'real planner result rendered');
  const seconds = (Date.now() - start) / 1000;
  const text = await js(`document.querySelector('.frlg-recommendation-card').textContent`);
  for (const value of ['闪光大嘴蝠', '华蓝洞窟1F · LV 46', '7422', '25,296', '181', 'IV 30 / 28 / 31 / 31 / 31 / 30', '勤奋 · 精神力 · 雌性']) assert.ok(text.includes(value), value);
  assert.equal(await js(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '开始运行').disabled`), false);
  await until(`Array.from(document.querySelectorAll('.frlg-sprite')).every(img => img.complete && img.naturalWidth > 0)`, 'bundled sprites loaded');
  const overviewFits = () => js(`(() => {
    const overview = document.querySelector('.frlg-overview');
    const target = overview.querySelector('.frlg-recommendation-card');
    const bingo = overview.querySelector('.frlg-bingo-card');
    if (!target || !bingo || document.querySelectorAll('.frlg-recommendation-card').length !== 1) return false;
    const a = target.getBoundingClientRect(), b = bingo.getBoundingClientRect();
    const arranged = b.top >= a.bottom && Math.abs(a.left - b.left) < 1;
    const numbersFit = Array.from(target.querySelectorAll('.frlg-plan-dock-numbers dd')).every(el => el.scrollWidth <= el.clientWidth);
    return arranged && numbersFit && b.left >= 0 && b.right <= innerWidth && bingo.scrollWidth <= bingo.clientWidth;
  })()`);
  assert.equal(await overviewFits(), true, 'target dock sits above full-width BINGO with unbroken values');
  await js(`document.querySelector('.frlg-overview').scrollIntoView({ block: 'center' })`);
  await screenshot('recommendation.png');
  await click('查看方案详情');
  const fields = await js(`Object.fromEntries(Array.from(document.querySelectorAll('dialog dl > div')).map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]))`);
  assert.equal(fields.PID, expected.target.pid);
  assert.equal(fields['目标 Seed'], expected.target.target_seed);
  assert.equal(fields['Seed 模式'], '0');
  assert.equal(fields.SOUND, '单声道 (mono)');
  assert.equal(fields['BUTTON MODE'], '帮助 (h)');
  assert.ok(Object.values(fields).every(value => value && value !== '—'));
  main.setSize(1280, 900);
  await screenshot('details-1280.png');
  assert.equal(await js(`(() => { const d = document.querySelector('dialog'); return d.scrollWidth <= d.clientWidth && d.getBoundingClientRect().bottom <= innerHeight; })()`), true, 'details fit the viewport');
  await js(`document.querySelector('dialog').querySelector('.automation-target-dialog-actions button').click()`);
  await screenshot('recommendation-1280.png');
  assert.equal(await overviewFits(), true, 'target dock and calibration canvas fit at 1280px');
  main.setSize(900, 900);
  await screenshot('recommendation-900.png');
  assert.equal(await overviewFits(), true, 'dock and canvas remain usable in a narrow window');
  if (process.env.FRLG_SCRIPT_PACKAGE) {
    await js('window.desktop.devices.controller.connect("mock")');
    await js('window.desktop.devices.video.connect({deviceId:"synthetic",backend:"dshow",width:1920,height:1080,fps:30})');
    await until(`window.desktop.devices.getState().then(state => state.video.status === 'connected')`, 'mock video ready');
    await click('开始运行');
    await until(`window.desktop.frlgAutomation.getState().then(state => { if (state.status === 'failed') throw Error(state.message); return state.status === 'running'; })`, 'real generated script starts', 30000);
    assert.equal(devices.isAutomationBusy(), true);
    await screenshot('running-900.png');
    await click('停止');
    await until(`window.desktop.frlgAutomation.getState().then(state => state.status === 'stopped')`, 'generated script stops');
    assert.equal(devices.isAutomationBusy(), false);
    const controller = await devices.controller.call('controller.status');
    assert.equal(controller.report.buttons, 0);
    assert.equal(controller.report.hat, 8);
    console.log('PASS generated FRLG ECS → shared host → native mock controller/video → stop/release');
  }
  console.log(JSON.stringify({ passed: true, seconds, screenshots: output }));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timer);
  await frlgAutomation?.close(); await frlg?.close(); notifications?.close(); await devices?.close();
  app.exit(process.exitCode || 0);
});
