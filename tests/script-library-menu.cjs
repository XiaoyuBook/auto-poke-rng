const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerDevices } = require('../electron/devices.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'node_modules/.tmp/script-library-menu-review');
fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, 'run-'));
app.setPath('userData', path.join(fixture, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
let devices;
const timeout = setTimeout(() => { console.error('Script library menu timeout'); app.exit(1); }, 30000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const main = new BrowserWindow({ width: 1440, height: 920, show: false, webPreferences: {
    preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false,
    sandbox: true, backgroundThrottling: false, offscreen: true,
  } });
  const errors = [];
  main.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = code => main.webContents.executeJavaScript(code, true);
  const until = async (code, label) => {
    for (let index = 0; index < 160; index++) { if (await js(code)) return; await delay(25); }
    throw new Error('Timed out: ' + label);
  };
  const click = label => js(`document.querySelector(${JSON.stringify('[aria-label="' + label + '"]')}).click()`);
  const paint = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const screenshot = async name => fs.writeFileSync(path.join(output, name + '.png'), (await main.webContents.capturePage()).toPNG());

  // The layout regression does not start background game or notification services.
  ipcMain.handle('app:metadata', () => ({ name: 'test', version: 'test', platform: 'win32' }));
  ipcMain.handle('automation:state', () => null);
  ipcMain.handle('automation:log', () => undefined);
  ipcMain.handle('frlg-automation:state', () => ({ status: 'idle', logs: [] }));
  ipcMain.handle('qq:state', () => null);
  ipcMain.handle('blink:state', () => ({ revision: 0, status: 'idle', captured: 0, target: 40, message: '等待捕获' }));
  const scriptRoot = path.join(fixture, 'scripts');
  const longFolder = '火红叶绿/自动流程/ImgLabel/长目录名称_abcdefghijklmnopqrstuvwxyz0123456789';
  fs.mkdirSync(path.join(scriptRoot, longFolder), { recursive: true });
  for (let index = 1; index <= 12; index++) fs.mkdirSync(path.join(scriptRoot, `目录 ${index}`));
  fs.writeFileSync(path.join(scriptRoot, '测试.txt'), 'A 50');
  registerScriptFiles({ getMainWindow: () => main, rootDirectory: scriptRoot });
  registerPanelWindows({ getMainWindow: () => main, loadWindow: (window, query = {}) => window.loadFile(path.join(root, 'dist/index.html'), { query }) });
  devices = registerDevices({ ipcMain, getWindows: () => [main], rootDirectory: scriptRoot, testMode: true });
  await main.loadFile(path.join(root, 'dist/index.html'));
  await until(`Boolean(document.querySelector('.cm-content')) && !document.querySelector('[aria-label="新建脚本"]').disabled`, 'library loaded');

  for (const width of [3410, 1440, 1100]) {
    main.setContentSize(width, width === 1100 ? 680 : 920);
    const actualWidth = main.getContentSize()[0];
    await until(`Math.abs(window.innerWidth - ${actualWidth}) <= 1`, `window resized to ${actualWidth}px`);
    for (const collapsed of [true, false]) {
      await click(collapsed ? '收起侧栏' : '展开侧栏');
      await paint();
      await js('Promise.all(document.querySelector(".app-shell").getAnimations().map(animation => animation.finished))');
      await click('新建脚本');
      await paint();
      const layout = await js(`(() => {
        const menu = document.querySelector('.library-create-menu');
        const rect = menu.getBoundingClientRect();
        const workspace = document.querySelector('.workspace-primary').getBoundingClientRect();
        const title = menu.querySelector('p').getBoundingClientRect();
        const y = title.top + title.height / 2;
        return {
          fits: rect.left >= workspace.left && rect.right <= workspace.right
            && rect.top >= 0 && rect.bottom <= window.innerHeight,
          edgesVisible: [rect.left + 2, rect.right - 12].every(x => menu.contains(document.elementFromPoint(x, y))),
          noHorizontalOverflow: menu.scrollWidth <= menu.clientWidth + 1,
          scrollable: menu.scrollHeight > menu.clientHeight,
        };
      })()`);
      const scenario = `${actualWidth}px, sidebar ${collapsed ? 'collapsed' : 'expanded'}`;
      await screenshot(`directory-menu-${width}-${collapsed ? 'collapsed' : 'expanded'}`);
      assert.ok(layout.fits, 'directory menu stays inside workspace: ' + scenario);
      assert.ok(layout.edgesVisible, 'directory menu is not clipped or covered: ' + scenario);
      assert.ok(layout.noHorizontalOverflow, 'folder paths wrap without horizontal scrolling: ' + scenario);
      assert.ok(layout.scrollable, 'long directory list remains scrollable: ' + scenario);
      await click('新建脚本');
    }
  }
  await click('新建脚本');
  const folderButton = `[...document.querySelectorAll('.library-create-menu button')].find(button => button.textContent === ${JSON.stringify(longFolder)})`;
  await js(`${folderButton}.scrollIntoView({ block: 'center' })`);
  await paint();
  assert.ok(await js(`(() => {
    const text = ${folderButton}.querySelector('span');
    const rect = text.getBoundingClientRect();
    return [[rect.left + 2, rect.top + 2], [rect.right - 2, rect.bottom - 2]]
      .every(([x, y]) => text.contains(document.elementFromPoint(x, y)));
  })()`), 'long folder path is fully visible after scrolling');
  await screenshot('directory-menu-long-path');
  await js(`${folderButton}.click()`);
  await until(`document.querySelector('.script-title-input').value === '未命名脚本'`, 'create in long folder');
  assert.ok(fs.existsSync(path.join(scriptRoot, longFolder, '未命名脚本.txt')), 'creates script in the selected directory');
  assert.equal(await js('Boolean(document.querySelector(".library-create-menu"))'), false, 'selection closes menu');
  assert.deepEqual(errors, []);
  await devices.close();
  clearTimeout(timeout);
  console.log('PASS: directory menu visibility at 3410/1440/1100px and both sidebar states, long path wrapping, scrolling and directory selection.');
  app.exit(0);
}).catch(async error => { console.error(error); await devices?.close(); app.exit(1); });
