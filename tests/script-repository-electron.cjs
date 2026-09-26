const { app, BrowserWindow, ipcMain, safeStorage, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { zipSync } = require('fflate');
const { registerDevices } = require('../electron/devices.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');
const { registerScriptRepository } = require('../electron/script-repository.cjs');
const { createScriptGate, createScriptStorage } = require('../electron/script-storage.cjs');
const { registerAutomation } = require('../electron/automation.cjs');
const { registerBlink } = require('../electron/blink-client.cjs');
const { registerRng } = require('../electron/rng-client.cjs');
const { registerQQNotifications } = require('../electron/qq-notifications.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'node_modules/.tmp/script-repository-review');
fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, 'run-'));
let scripts = path.join(fixture, 'profile', 'scripts');
app.setPath('userData', path.join(fixture, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function pack(version, body) {
  const contents = { '测试.txt': Buffer.from(body), 'ImgLabel/示例.IL': Buffer.from('{"ImgBase64":"ABC","searchMethod":5}') };
  const manifest = { schemaVersion: 1, id: 'bdsp-demo', name: 'BDSP 官方脚本包', description: '测种、过帧和撞闪脚本与配套图像标签。', instructions: '使用前请核对游戏画面与运行起点。', game: 'BDSP', authors: ['XiaoyuBook'], version, minimumAppVersion: '0.1.0', installFolder: 'BDSP',
    files: Object.entries(contents).map(([name,bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes), category: name.endsWith('.txt') ? '测种与识别' : '图像标签' })) };
  const bytes = Buffer.from(zipSync({ 'manifest.json': Buffer.from(JSON.stringify(manifest)), ...Object.fromEntries(Object.entries(contents).map(([name,bytes]) => ['files/' + name, bytes])) }));
  return { bytes, catalog: { schemaVersion: 1, packages: [{ ...manifest, archive: `packages/bdsp-demo/${version}.zip`, sha256: hash(bytes), bytes: bytes.length }] } };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let devices, automation, blink, rng, notifications;
const timer = setTimeout(() => { console.error('Script repository Electron test timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const gate = createScriptGate(), logs = [];
  const storage = await createScriptStorage({ userData: app.getPath('userData'), gate, isBusy: () => !!devices?.runner.current || !!automation?.isBusy() });
  assert.equal(storage.getRoot(), scripts);
  assert.deepEqual(fs.readdirSync(scripts), [], 'fresh profiles have no bundled scripts');
  const main = new BrowserWindow({ show: false, width: 1440, height: 920, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const js = code => main.webContents.executeJavaScript(code, true).catch(error => { throw Error(code + '\n' + error.message); });
  const until = async (code, message) => { for (let i = 0; i < 180; i++) { if (await js(code)) return; await delay(25); } throw Error(message); };
  const click = async label => {
    const query = `Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(label)} && !b.disabled)`;
    await until(`Boolean(${query})`, 'button ready: ' + label);
    await js(`${query}.click()`);
  };
  const screenshot = async name => { await delay(100); fs.writeFileSync(path.join(output, name), (await main.webContents.capturePage()).toPNG()); };
  let remote = pack('1.0.0', 'A 1\n'), dialogs = 0, offline = false;
  const zipPath = path.join(fixture, 'import.zip');
  const loadWindow = (window, query = {}) => window.loadFile(path.join(root, 'dist/index.html'), { query });
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: '0.1.0', platform: 'win32' }));
  const panels = registerPanelWindows({ getMainWindow: () => main, loadWindow });
  registerScriptFiles({ getMainWindow: () => main, getLabelWindows: () => [panels.getVideoWindow()], rootDirectory: storage.getRoot, serialize: gate.run, isMigrating: () => storage.migrating });
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), rootDirectory: storage.getRoot, testMode: true, isScriptLibraryBusy: () => gate.busy });
  blink = registerBlink({ ipcMain, getMainWindow: () => main, getVideo: () => devices.getState().video, isAutomationBusy: () => devices.isAutomationBusy() });
  rng = registerRng({ ipcMain, getMainWindow: () => main, isAutomationBusy: () => devices.isAutomationBusy() });
  automation = registerAutomation({ ipcMain, getMainWindow: () => main, getWindows: () => [main], devices, rng, blink, userData: app.getPath('userData') });
  notifications = registerQQNotifications({ ipcMain, getMainWindow: () => main, safeStorage, nativeImage, userData: app.getPath('userData') });
  const moveTo = path.join(fixture, 'custom-scripts'); fs.mkdirSync(moveTo);
  registerScriptRepository({ ipcMain, getMainWindow: () => main, rootDirectory: storage.getRoot, storage, userData: app.getPath('userData'), appVersion: '0.1.0', gate,
    isBusy: () => !!devices.runner.current || automation.isBusy(), log: message => { logs.push(message); automation.store.log(message, '系统', 'info'); },
    fetch: async url => { if (offline) throw new TypeError('fetch failed'); return new Response(url.endsWith('catalog.json') ? JSON.stringify(remote.catalog) : remote.bytes); },
    dialog: { showOpenDialog: async (_window, options) => { dialogs++; return { canceled: false, filePaths: [options.properties.includes('openDirectory') ? moveTo : zipPath] }; } },
  });
  await loadWindow(main);
  main.showInactive();
  await until(`Boolean(document.querySelector('[aria-label^="切换游戏"]'))`, 'game picker ready');
  await js(`document.querySelector('[aria-label^="切换游戏"]').click()`);
  await until(`Boolean(document.querySelector('[role="menuitemradio"]'))`, 'game menu open');
  await js(`Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(b => b.textContent.includes('珍钻复刻')).click()`);
  await until(`Boolean(document.querySelector('[aria-label="打开脚本仓库"]'))`, 'script workspace ready');
  await until(`document.querySelector('.library-empty')?.textContent.includes('还没有安装脚本')`, 'fresh library has an installation entry');
  assert.equal(await js(`document.querySelector('.library-scope')?.textContent.includes('0 个脚本')`), true);
  await screenshot('repository-empty-library.png');
  await click('浏览脚本仓库');
  await until(`Array.from(document.querySelectorAll('button')).some(b => b.textContent === '预览安装' && !b.disabled)`, 'catalog loaded');
  assert.equal(await js(`document.querySelector('[aria-label="游戏分类：珍钻复刻"]').getAttribute('aria-current')`), 'true');
  await screenshot('repository.png');
  await click('预览安装');
  await until(`Boolean(document.querySelector('.repository-changes li'))`, 'install preview');
  assert.equal(fs.existsSync(path.join(scripts, 'BDSP')), false, 'preview does not install');
  await click('确认安装');
  await until(`document.querySelector('.repository-message[role="status"]')?.textContent.includes('安装完成')`, 'installed');
  assert.equal(fs.readFileSync(path.join(scripts, 'BDSP/测试.txt'), 'utf8'), 'A 1\n');
  assert.ok(fs.existsSync(path.join(scripts, 'BDSP/ImgLabel/示例.IL')));
  await js(`document.querySelector('[aria-label="关闭脚本仓库"]').click()`);
  await until(`Boolean(document.querySelector('[aria-label="文件夹：BDSP"]'))`, 'library refresh after install');
  await js(`(() => { const folder = document.querySelector('[aria-label="文件夹：BDSP"]'); if (folder.getAttribute('aria-expanded') !== 'true') folder.click(); })()`);
  await until(`Boolean(document.querySelector('[aria-label="选择脚本：测试"]'))`, 'txt visible in library');

  fs.writeFileSync(path.join(scripts, 'BDSP/测试.txt'), 'B 2\n');
  remote = pack('1.1.0', 'X 1\n');
  await js(`document.querySelector('[aria-label="打开脚本仓库"]').click()`);
  await until(`Array.from(document.querySelectorAll('button')).some(b => b.textContent === '检查更新' && !b.disabled)`, 'cache loaded');
  await click('检查更新');
  await until(`document.querySelector('.repository-detail')?.textContent.includes('版本 1.1.0')`, 'new version loaded');
  await click('预览更新');
  await until(`Boolean(document.querySelector('.repository-policy'))`, 'conflict choice');
  assert.equal(await js(`document.querySelector('.repository-policy input').checked`), true);
  await screenshot('repository-conflict.png');
  await click('确认安装');
  await until(`document.querySelector('.repository-message[role="status"]')?.textContent.includes('保留 1 项本地修改')`, 'kept local edit');
  assert.equal(fs.readFileSync(path.join(scripts, 'BDSP/测试.txt'), 'utf8'), 'B 2\n');
  const backups = path.join(scripts, '.rng-repository/backups');
  assert.ok(fs.readdirSync(backups).some(name => fs.readFileSync(path.join(backups, name, '测试.txt'), 'utf8') === 'B 2\n'));

  fs.writeFileSync(zipPath, pack('1.2.0', 'Y 1\n').bytes);
  await click('导入脚本包');
  await until(`document.querySelector('.repository-detail')?.textContent.includes('1.2.0')`, 'zip import preview');
  assert.equal(dialogs, 1);
  await js(`document.querySelectorAll('.repository-policy input')[1].click()`);
  await click('确认安装');
  await until(`document.querySelector('.repository-message[role="status"]')?.textContent.includes('安装完成')`, 'zip installed');
  assert.equal(fs.readFileSync(path.join(scripts, 'BDSP/测试.txt'), 'utf8'), 'Y 1\n');

  await click('仓库设置'); await click('更改脚本目录');
  await until(`Boolean(document.querySelector('[aria-label="目录迁移预览"]'))`, 'migration preview ready');
  assert.equal(storage.getRoot(), scripts);
  await screenshot('repository-directory-preview.png');
  await click('迁移并使用此目录');
  await until(`document.querySelector('.repository-message[role="status"]')?.textContent.includes('脚本目录已迁移')`, 'migration completed');
  const oldScripts = scripts; scripts = moveTo;
  assert.equal((await js('window.desktop.scripts.list()')).rootPath, scripts);
  assert.equal((await devices.runner.resolveScript('BDSP/测试.txt')).absolute, path.join(scripts, 'BDSP/测试.txt'));
  await js(`(async () => { const file = (await window.desktop.scripts.list()).files[0]; await window.desktop.scripts.save({path:file.path,name:file.name,body:'Y 2\\n',expectedRevision:file.revision}); })()`);
  assert.equal(fs.readFileSync(path.join(oldScripts, 'BDSP/测试.txt'), 'utf8'), 'Y 1\n');
  assert.equal(fs.readFileSync(path.join(scripts, 'BDSP/测试.txt'), 'utf8'), 'Y 2\n');
  const label = { folder: 'BDSP', name: '迁移后标签', searchMethod: 107, threshold: 95, imageBase64: '宝可梦', range: { x: 0, y: 0, width: 10, height: 10 }, target: { x: 0, y: 0, width: 10, height: 10 } };
  await js(`window.desktop.scripts.labelSave(${JSON.stringify(label)})`);
  assert.ok(fs.existsSync(path.join(scripts, 'BDSP/ImgLabel/迁移后标签.IL')));
  assert.equal(fs.existsSync(path.join(oldScripts, 'BDSP/ImgLabel/迁移后标签.IL')), false);
  await js(`window.desktop.panels.open('video')`);
  const detached = panels.getVideoWindow();
  const detachedLabel = await detached.webContents.executeJavaScript(`window.desktop.scripts.labelRead('BDSP', '迁移后标签')`);
  assert.equal(detachedLabel.imageBase64, '宝可梦');
  await detached.webContents.executeJavaScript(`window.desktop.scripts.labelSave(${JSON.stringify({ ...label, imageBase64: '分离窗口保存' })})`);
  assert.equal((await js(`window.desktop.scripts.labelRead('BDSP', '迁移后标签')`)).imageBase64, '分离窗口保存');
  detached.close();
  remote = pack('1.3.0', 'Y 3\n'); await click('检查更新');
  await until(`Array.from(document.querySelectorAll('.repository-package-select')).some(b => b.textContent.includes('1.3.0') && !b.disabled)`, 'new-root catalog loaded');
  await js(`document.querySelector('.repository-package-select').click()`);
  await click('预览更新'); await click('确认安装');
  await until(`document.querySelector('.repository-message[role="status"]')?.textContent.includes('安装完成')`, 'updated at new root');
  assert.equal(JSON.parse(fs.readFileSync(path.join(scripts, 'BDSP/.rng-package.json'))).manifest.version, '1.3.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(oldScripts, 'BDSP/.rng-package.json'))).manifest.version, '1.2.0');

  // Hold the same gate used by installation and verify both public launch paths.
  let release;
  const writing = gate.run(() => new Promise(resolve => { release = resolve; }));
  await new Promise(setImmediate);
  try {
    const error = await js(`window.desktop.devices.execution.start({path:'BDSP/测试.txt'}).then(() => '', e => e.message)`);
    assert.match(error, /脚本库正在更新/);
    await assert.rejects(devices.claimAutomation('fixture'), /脚本库正在更新/);
    assert.equal(devices.runner.current, null);
  } finally { release(); await writing; }
  await devices.claimAutomation('fixture');
  assert.equal(devices.isAutomationBusy(), true);
  await devices.releaseAutomation('fixture');
  assert.ok(logs.some(message => message.includes('保留 1 项本地修改')));
  assert.ok(automation.getState().logs.some(entry => entry.message.includes('已安装脚本包')));
  // Browse the real bundled publication without executing its scripts.
  fs.renameSync(path.join(scripts, 'BDSP'), path.join(fixture, 'installed-demo'));
  remote = { catalog: require('../resources/script-catalog.json') };
  await click('检查更新');
  await until(`Array.from(document.querySelectorAll('.repository-package-select strong')).some(b => b.textContent === '珍钻复刻官方脚本包')`, 'official package listed');
  await js(`Array.from(document.querySelectorAll('.repository-package-select')).find(b => b.querySelector('strong').textContent === '珍钻复刻官方脚本包').click()`);
  await until(`document.querySelector('.repository-detail h2')?.textContent === '珍钻复刻官方脚本包'`, 'official categorized catalog');
  await screenshot('repository.png');
  await js(`document.querySelector('[aria-label="用途分类：测种与识别"]').click()`);
  await until(`document.querySelectorAll('.repository-file-list tbody tr').length === 4`, 'category file list');
  await screenshot('repository-files.png');
  await click('仓库设置');
  await js(`(() => { const select = document.querySelector('[aria-label="更新渠道"]'); select.value = 'gitee'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await until(`document.querySelector('[aria-label="仓库地址"]').value.includes('gitee.com') && document.querySelector('.repository-message[role="status"]')?.textContent.includes('更新渠道已切换')`, 'Gitee channel selected');
  await screenshot('repository-settings.png');
  main.setSize(1100, 680);
  await delay(150);
  assert.equal(await js(`document.querySelector('.repository-body').scrollWidth <= document.querySelector('.repository-body').clientWidth`), true);
  await screenshot('repository-compact.png');
  main.setSize(1440, 920);
  offline = true;
  await click('检查更新');
  await until(`document.querySelector('[role="alert"]')?.textContent.includes('无法连接官方脚本仓库')`, 'Chinese network error');
  await js(`document.querySelector('.repository-package-select').click()`);
  await until(`document.querySelector('.repository-detail h2')?.textContent === '珍钻复刻官方脚本包'`, 'offline catalog still browsable');
  await screenshot('repository-offline.png');
  offline = false;
  await click('重试');
  await until(`!document.querySelector('[role="alert"]')`, 'network retry clears error');
  console.log('PASS: real preload/IPC, txt and label installation, library refresh, update conflicts, backups, ZIP import, and execution write exclusion');
  console.log('Screenshots:', output);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timer); await automation?.close(); notifications?.close();
  await Promise.allSettled([devices?.close(), blink?.close(), rng?.close()]); app.exit(process.exitCode || 0);
});
