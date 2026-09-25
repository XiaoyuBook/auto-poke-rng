const { app, BrowserWindow, ipcMain, nativeImage, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerBlink } = require('../electron/blink-client.cjs');
const { registerRng } = require('../electron/rng-client.cjs');
const { registerDevices } = require('../electron/devices.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerQQNotifications } = require('../electron/qq-notifications.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'node_modules/.tmp/blink-review');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')));
app.commandLine.appendSwitch('disable-gpu');
let devices, blink, rng, notifications;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timer = setTimeout(() => { console.error('Blink Electron test timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const main = new BrowserWindow({ width: 1500, height: 940, show: false, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const js = code => main.webContents.executeJavaScript(code, true);
  const until = async (code, name) => { for (let i = 0; i < 300; i++) { if (await js(code)) return; await delay(30); } throw Error(name); };
  const click = async text => js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent===${JSON.stringify(text)}).click()`);
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: 'test', platform: 'win32' }));
  const loadWindow = (window, query = {}) => window.loadFile(path.join(root, 'dist/index.html'), { query });
  registerPanelWindows({ getMainWindow: () => main, loadWindow });
  const scriptRoot = fs.mkdtempSync(path.join(output, 'scripts-'));
  registerScriptFiles({ getMainWindow: () => main, rootDirectory: scriptRoot });
  devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), rootDirectory: scriptRoot, testMode: true });
  rng = registerRng({ ipcMain, getMainWindow: () => main });
  blink = registerBlink({ ipcMain, getMainWindow: () => main, getVideo: () => devices.getState().video });
  notifications = registerQQNotifications({ ipcMain, getMainWindow: () => main, safeStorage, nativeImage, userData: app.getPath('userData') });
  await loadWindow(main); main.showInactive();
  await until(`Boolean(document.querySelector('[aria-label^="切换游戏"]'))`, 'app ready');
  await js(`window.desktop.devices.video.connect({deviceId:'synthetic',backend:'msmf',width:640,height:480,fps:60})`);
  await until(`document.querySelector('.live-video')?.naturalWidth===640`, 'real shared frame preview');
  await js(`document.querySelector('[aria-label^="切换游戏"]').click()`);
  await js(`Array.from(document.querySelectorAll('[role=menuitemradio]')).find(x=>x.textContent.includes('珍钻复刻')).click()`);
  const source = devices.getState().video.session;
  await js(`window.originalPreview=document.querySelector('.live-video'); window.originalLogs=document.querySelector('.persistent-logs');`);
  // Enter selection from the video's menu while still on another page.
  const context = async text => {
    await js(`document.querySelector('.persistent-video').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:1200,clientY:140}))`);
    await click(text);
    await until(`Boolean(document.querySelector('.blink-frozen'))`, 'frozen selection');
  };
  const drag = async (x, y, width, height) => {
    const points = await js(`(() => { const r=document.querySelector('.blink-video-overlay svg').getBoundingClientRect();const s=Math.min(r.width/640,r.height/480);const ox=r.x+(r.width-640*s)/2,oy=r.y+(r.height-480*s)/2;return [{x:Math.round(ox+${x}*s),y:Math.round(oy+${y}*s)},{x:Math.round(ox+${x+width}*s),y:Math.round(oy+${y+height}*s)}]; })()`);
    main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...points[0] });
    main.webContents.sendInputEvent({ type: 'mouseMove', ...points[1] });
    main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...points[1] });
    await delay(60);
  };
  await context('框选眨眼眼睛模板');
  await drag(25, 334, 84, 28);
  fs.writeFileSync(path.join(output, 'eye-selection.png'), (await main.webContents.capturePage()).toPNG());
  await click('确认');
  await until(`Boolean(document.querySelector('img[alt="睁眼模板"]')) && !document.querySelector('.blink-frozen')`, 'cropped template applied');
  await context('框选眨眼 ROI');
  await drag(18, 320, 128, 60); await click('确认');
  await until(`!document.querySelector('.blink-frozen')`, 'roi selected');
  await click('保存配置');
  const saved = await js(`JSON.parse(localStorage.getItem('auto-poke-rng:bdsp-blink-configs'))[0]`);
  assert.equal(saved.sourceWidth, 640); assert.equal(saved.sourceHeight, 480);
  assert.ok(Math.abs(saved.roi.x - 18) <= 2 && Math.abs(saved.roi.width - 128) <= 3, 'letterboxed display uses native pixel coordinates');
  assert.equal(await js(`window.originalPreview===document.querySelector('.live-video') && window.originalLogs===document.querySelector('.persistent-logs')`), true);
  await click('识别预览');
  await until(`window.desktop.blink.getState().then(x=>x.status==='error'||(x.status==='preview'&&x.score!=null))`, 'worker real image matching');
  const preview = blink.getState(); assert.equal(preview.status, 'preview', preview.message); assert.ok(preview.score > .99, String(preview.score));
  assert.equal(devices.getState().video.session, source, 'worker does not reopen hardware');
  const compactLayout = async () => js(`(() => {
    const area=document.querySelector('.blink-scroll').getBoundingClientRect();
    const result=document.querySelector('.blink-result').getBoundingClientRect();
    const config=document.querySelector('.blink-config-row');
    const controls=[...config.querySelectorAll('select,input,button')].map(x=>x.getBoundingClientRect());
    return {resultVisible:result.top>=area.top && result.bottom<=area.bottom+1,
      configOnOneRow:controls.every(r=>Math.abs(r.bottom-controls[0].bottom)<2)};
  })()`);
  assert.deepEqual(await compactLayout(), { resultVisible: true, configOnOneRow: true }, 'configuration and results fit on the first screen');
  fs.writeFileSync(path.join(output, 'blink-preview-1500.png'), (await main.webContents.capturePage()).toPNG());
  await click('停止'); await until(`window.desktop.blink.getState().then(x=>x.status==='stopped')`, 'stop preview');
  await js(`document.querySelector('.blink-advanced').open=true`);
  await js(`document.querySelector('.blink-form').scrollTop=240`);
  await delay(100);
  fs.writeFileSync(path.join(output, 'blink-advanced-1500.png'), (await main.webContents.capturePage()).toPNG());
  assert.equal(await js(`(() => {const r=document.querySelector('.blink-result').getBoundingClientRect(),s=document.querySelector('.blink-scroll').getBoundingClientRect();return r.top>=s.top && r.bottom<=s.bottom;})()`), true, 'wide parameter scrolling keeps the Seed panel visible');
  await js(`document.querySelector('.blink-form').scrollTop=0`);
  main.setSize(1280, 820); await delay(100);
  assert.equal((await compactLayout()).configOnOneRow, true, 'configuration selector stays inline at medium widths');
  assert.equal(await js(`(() => {const s=document.querySelector('.blink-scroll');return s.scrollWidth<=s.clientWidth+1;})()`), true, 'advanced fields do not clip horizontally');
  fs.writeFileSync(path.join(output, 'blink-advanced-1280.png'), (await main.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.blink-advanced').open=false`);
  await click('TID/SID 测种');
  await until(`window.desktop.blink.getState().then(x=>x.status==='capturing')`, 'TID/SID capture starts');
  assert.equal(await js(`document.querySelector('[aria-label="眨眼捕获进度"]').max`), 64);
  assert.equal(await js(`document.querySelector('.blink-footer').textContent.includes('0 / 64')`), true, 'active capture count remains visible below the form');
  await click('停止'); await until(`window.desktop.blink.getState().then(x=>x.status==='stopped')`, 'stop TID/SID capture');
  await click('捕捉 Seed');
  await until(`window.desktop.blink.getState().then(x=>x.status==='capturing')`, 'capture starts');
  await click('首页');
  assert.equal(blink.getState().status, 'capturing', 'BDSP page changes preserve the job');
  await click('眨眼捕获');
  main.setSize(1100, 720); await delay(100);
  assert.equal(await js(`(() => {const s=document.querySelector('.blink-scroll');return s.scrollWidth<=s.clientWidth+1;})()`), true, 'narrow workspace must not clip controls horizontally');
  assert.equal((await compactLayout()).configOnOneRow, true, 'compact save button keeps configuration on one row in small windows');
  assert.equal(await js(`(() => {const r=document.querySelector('.blink-footer').getBoundingClientRect();return r.bottom<innerHeight && r.top>50;})()`), true, 'stop and status remain reachable in a small window');
  fs.writeFileSync(path.join(output, 'blink-compact-1100.png'), (await main.webContents.capturePage()).toPNG());
  await js(`window.desktop.devices.video.disconnect()`);
  await until(`window.desktop.blink.getState().then(x=>x.status==='error')`, 'disconnect stops worker');
  assert.match(blink.getState().message, /视频|Video/);
  assert.equal(devices.getState().controller.status, 'idle');
  // Invalid source errors must be visible, with no fabricated seed result.
  assert.equal(blink.getState().result, null);
  // Isolated renderer fixture: verify long result fields/actions at the narrow width.
  // This does not represent recovery from the synthetic video used above.
  main.webContents.send('blink:state', { revision: blink.getState().revision + 1000, mode: 'recover', status: 'completed', captured: 40, target: 40, message: '布局测试结果', result: {
    words: ['FFFFFFFF', 'FFFFFFFF', '87654321', '12345678'], pair: ['FFFFFFFFFFFFFFFF', '8765432112345678'], mode: 'recover', matchedAdvance: null, capturedAt: 1234, blinks: [], intervals: [],
  } });
  await until(`document.querySelector('[aria-label="捕获 Seed 0"]').value==='FFFFFFFFFFFFFFFF'`, 'result layout fixture');
  await js(`document.querySelector('.blink-result').scrollIntoView({block:'start'})`);
  await delay(100);
  assert.equal(await js(`(() => {
    const s=document.querySelector('.blink-scroll'), area=s.getBoundingClientRect();
    const actions=document.querySelector('.blink-result-actions').getBoundingClientRect();
    return s.scrollWidth<=s.clientWidth+1 && actions.bottom<=area.bottom+1 &&
      [...document.querySelectorAll('.blink-result input')].every(x=>x.scrollWidth<=x.clientWidth+1);
  })()`), true, 'full hexadecimal seeds and result actions remain readable in a small window');
  fs.writeFileSync(path.join(output, 'blink-result-1100.png'), (await main.webContents.capturePage()).toPNG());
  await Promise.all([blink.close(), devices.close(), rng.close()]); notifications.close();
  clearTimeout(timer); console.log('Blink Electron shared-frame, selection, lifecycle and layout checks passed'); app.exit(0);
}).catch(async error => {
  console.error(error);
  await Promise.allSettled([blink?.close(), devices?.close(), rng?.close()]); notifications?.close();
  clearTimeout(timer); app.exit(1);
});
