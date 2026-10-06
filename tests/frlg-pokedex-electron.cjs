// Renderer integration with the real FRLG lifecycle and simulated target evidence.
const { app, BrowserWindow, ipcMain, safeStorage, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerFrlgAutomation } = require('../electron/frlg-automation.cjs');
const { registerDevices } = require('../electron/devices.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');
const { registerQQNotifications } = require('../electron/qq-notifications.cjs');
const plan = require('./fixtures/frlg-starter-plan.json');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'frlg-pokedex-review-'));
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
let devices, workflow, notifications;
const timer = setTimeout(() => { console.error('FRLG pokedex test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: 'test', platform: 'win32' }));
  ipcMain.handle('automation:state', () => null);
  ipcMain.handle('blink:state', () => ({ status: 'idle', runId: null }));
  ipcMain.handle('frlg-rng:validate', () => ({ valid: true }));
  ipcMain.handle('frlg-rng:search', () => plan);
  ipcMain.handle('frlg-rng:cancel', () => {});
  const main = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: {
    preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false,
    sandbox: true, backgroundThrottling: false, offscreen: true,
  } });
  const errors = [];
  main.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const loadWindow = window => window.loadFile(path.join(root, 'dist/index.html'));
  registerPanelWindows({ getMainWindow: () => main, loadWindow });
  const scriptRoot = path.join(output, 'scripts'); fs.mkdirSync(scriptRoot);
  registerScriptFiles({ getMainWindow: () => main, rootDirectory: scriptRoot });
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), rootDirectory: scriptRoot, testMode: true });
  notifications = registerQQNotifications({ ipcMain, getMainWindow: () => main, safeStorage, nativeImage, userData: app.getPath('userData') });
  const events = new EventEmitter(); let scriptId, serial = 0;
  workflow = registerFrlgAutomation({ ipcMain, getMainWindow: () => main, userData: app.getPath('userData'),
    devices: { events, getState: () => ({ controller: { status: 'connected' }, video: { status: 'connected' } }),
      claimAutomation: async () => {}, releaseAutomation: () => {},
      runner: { rootDirectory: scriptRoot, validate: async () => ({ valid: true }),
        start: async () => { scriptId = `script-${++serial}`; events.emit('script', { event: 'script.started', runId: scriptId }); return { runId: scriptId }; },
        stop: async () => events.emit('script', { event: 'script.done', runId: scriptId, status: 'cancelled' }),
      } },
    client: { call: async () => ({ main: path.join(scriptRoot, 'main.ecs'), manifest: 'plan.json', targetSpeciesId: 1 }), close() {} },
    readFile: async file => file === 'plan.json' ? JSON.stringify({ plan }) : 'PRINT test', makeDirectory: async () => {},
  });
  const js = async code => {
    const result = await main.webContents.executeJavaScript(`(async () => { try { return { value: await (${code}) }; } catch (error) { return { error: String(error?.stack || error) }; } })()`, true);
    if (result.error) throw Error(result.error);
    return result.value;
  };
  const until = async (code, label) => {
    for (let n = 0; n < 150; n++) { if (await js(code)) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw Error(label + ': ' + await js(`JSON.stringify({ state: await window.desktop.frlgAutomation.getState(), alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(n => n.textContent), start: Array.from(document.querySelectorAll('button')).find(b => b.textContent==='开始运行')?.disabled })`));
  };
  const click = text => js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
  const screenshot = async name => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    main.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(output, name), (await main.webContents.capturePage()).toPNG());
  };
  await loadWindow(main);
  await until(`Boolean(document.querySelector('[title="自动流程"]'))`, 'app ready');
  assert.equal(await js('document.title'), 'Auto Poke RNG');
  assert.ok(main.webContents.getURL().endsWith('/dist/index.html'));
  await js(`document.querySelector('[title="自动流程"]').click()`);
  await js(`document.querySelector('.frlg-run-settings-fold > summary').click()`);
  const toggle = 'document.querySelector(\'[aria-label="成功后自动完成图鉴"]\')';
  assert.equal(await js(`${toggle}.checked`), false);
  await js(`${toggle}.click()`);
  assert.equal(await js(`JSON.parse(localStorage.getItem('auto-poke-frlg-run:frlg-save-1')).auto_complete_pokedex`), true);
  await js(`${toggle}.closest('label').scrollIntoView({block:'center'})`);
  assert.equal(await js(`(() => { const r=${toggle}.closest('label').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()`), true);
  await screenshot('settings-1440.png');
  main.setSize(1000, 900);
  await js(`${toggle}.closest('label').scrollIntoView({block:'center'})`);
  await screenshot('settings-1000.png');
  assert.equal(await js(`(() => { const r=${toggle}.closest('label').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()`), true);
  await click('目标设置'); await click('搜索并生成方案');
  await until(`Boolean(document.querySelector('.frlg-recommendation-card'))`, 'searched plan');
  await click('开始运行');
  await until(`window.desktop.frlgAutomation.getState().then(s => s.status === 'running')`, 'run started');
  assert.equal(await js(`${toggle}.matches(':disabled')`), true);
  await js(`document.querySelector('[title="首页"]').click()`);
  await click('新建存档');
  events.emit('script', { event: 'script.round', runId: scriptId, number: 1, data: { result: '目标出闪', shiny: true, observedDex: 1 } });
  events.emit('script', { event: 'script.done', runId: scriptId, status: 'completed' });
  await workflow.settled();
  await until(`JSON.parse(localStorage.getItem('auto-poke-rng:frlg-saves-v1')).profiles[0].completedSpecies.includes(1)`, 'originating save persisted');
  const check = 'document.querySelector(\'[aria-label="标记妙蛙种子已完成"]\')';
  assert.equal(await js(`${check}.checked`), false, 'active second save stays incomplete');
  await js(`(() => { const s=document.querySelector('[aria-label="当前火叶存档"]'); s.value='frlg-save-1'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`${check}.checked`, 'first save shows successful target');
  await screenshot('completed-1000.png');
  await js(`${check}.click()`);
  await main.reload();
  await until(`Boolean(document.querySelector('[title="首页"]'))`, 'reload ready');
  await js(`document.querySelector('[title="首页"]').click()`);
  await until(`Boolean(${check})`, 'home restored');
  assert.equal(await js(`${check}.checked`), false, 'snapshot replay respects manual undo');
  assert.deepEqual(errors, [], 'no renderer errors');
  console.log(JSON.stringify({ passed: true, screenshots: output, viewport: ['1440x1000', '1000x900'] }));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timer); await workflow?.close(); notifications?.close(); await devices?.close();
  app.exit(process.exitCode || 0);
});
