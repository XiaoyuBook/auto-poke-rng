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
  await until(`document.querySelector('.live-video')?.naturalWidth===640`, 'real shared frame preview').catch(async error => {
    const { status, code, message, width, height } = devices.getState().video;
    throw Error(`${error.message}: ${JSON.stringify({ video: { status, code, message, width, height }, preview: await js(`document.querySelector('.preview-frame')?.textContent`) })}`);
  });
  await js(`document.querySelector('[aria-label^="切换游戏"]').click()`);
  await js(`Array.from(document.querySelectorAll('[role=menuitemradio]')).find(x=>x.textContent.includes('珍钻复刻')).click()`);
  const source = devices.getState().video.session;
  await js(`window.originalPreview=document.querySelector('.live-video'); window.originalLogs=document.querySelector('.persistent-logs');`);
  await click('眨眼捕获');
  const select = async text => {
    await click(text);
    await until(`Boolean(document.querySelector('.blink-frozen'))`, 'frozen selection');
  };
  const drag = async (x, y, width, height) => {
    const points = await js(`(() => { const r=document.querySelector('.blink-video-overlay svg').getBoundingClientRect();const s=Math.min(r.width/640,r.height/480);const ox=r.x+(r.width-640*s)/2,oy=r.y+(r.height-480*s)/2;return [{x:Math.round(ox+${x}*s),y:Math.round(oy+${y}*s)},{x:Math.round(ox+${x+width}*s),y:Math.round(oy+${y+height}*s)}]; })()`);
    main.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...points[0] });
    main.webContents.sendInputEvent({ type: 'mouseMove', ...points[1] });
    main.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...points[1] });
    await delay(60);
  };
  await select('截取眼睛');
  fs.writeFileSync(path.join(output, 'eye-selection.png'), (await main.webContents.capturePage()).toPNG());
  await drag(25, 334, 84, 28);
  await until(`document.querySelector('.blink-footer')?.textContent.includes('已截取睁眼模板') && !document.querySelector('.blink-frozen')`, 'cropped template applied');
  await select('框选眼睛区域');
  await drag(18, 320, 128, 60);
  await until(`!document.querySelector('.blink-frozen')`, 'roi selected');
  await until(`Boolean(document.querySelector('.blink-roi') && document.querySelector('.blink-match'))`, 'live ROI and matched eye boxes');
  assert.equal(await js(`Boolean(document.querySelector('.blink-video-status [aria-label="眨眼匹配阈值"]')) && !document.querySelector('.blink-eye-strip')`), true, 'threshold and score stay in the video corner');
  assert.equal(blink.getState().status, 'idle', 'live overlay does not occupy the capture job');
  await click('保存');
  const saved = await js(`JSON.parse(localStorage.getItem('auto-poke-rng:bdsp-blink-configs'))[0]`);
  assert.equal(saved.sourceWidth, 640); assert.equal(saved.sourceHeight, 480);
  assert.ok(Math.abs(saved.roi.x - 18) <= 2 && Math.abs(saved.roi.width - 128) <= 3, 'letterboxed display uses native pixel coordinates');
  assert.equal(await js(`window.originalPreview===document.querySelector('.live-video') && window.originalLogs===document.querySelector('.persistent-logs')`), true);
  await click('识别预览');
  await until(`window.desktop.blink.getState().then(x=>x.status==='error'||(x.status==='preview'&&x.score!=null))`, 'worker real image matching');
  const preview = blink.getState(); assert.equal(preview.status, 'preview', preview.message); assert.ok(preview.score > .99, String(preview.score));
  assert.equal(devices.getState().video.session, source, 'worker does not reopen hardware');
  const compactLayout = async () => js(`(() => {
    const video=document.querySelector('.persistent-video').getBoundingClientRect();
    const seed=document.querySelector('.blink-video-seeds').getBoundingClientRect();
    const threshold=document.querySelector('.blink-video-status')?.getBoundingClientRect();
    const logs=document.querySelector('.persistent-logs');
    const logArea=logs.getBoundingClientRect();
    const config=document.querySelector('.blink-config-row');
    const configArea=config.getBoundingClientRect();
    const picker=config.querySelector('.blink-config-picker').getBoundingClientRect();
    const controls=[...config.querySelectorAll('select,input,button')].map(x=>x.getBoundingClientRect());
    const configButtons=[...config.querySelectorAll(':scope > button')].map(x=>x.getBoundingClientRect());
    const buttons=[...document.querySelectorAll('.blink-capture-actions button')].map(x=>x.getBoundingClientRect());
    return {logsBelowVideo:!logs.hidden && logArea.top>=video.bottom,
      seedInVideo:seed.left>=video.left && seed.right<=video.right && seed.bottom<=video.bottom,
      badgesSeparate:!threshold || seed.right<=threshold.left || seed.top>=threshold.bottom,
      actionsOnTwoRows:buttons.length===4 && Math.abs(buttons[0].top-buttons[1].top)<2 && Math.abs(buttons[2].top-buttons[3].top)<2,
      configOnOneRow:controls.every(r=>Math.abs(r.bottom-controls[0].bottom)<2),
      configFits:controls.every(r=>r.left>=configArea.left-1 && r.right<=configArea.right+1 && r.top>=configArea.top-1 && r.bottom<=configArea.bottom+1),
      configWrapped:configButtons.length===3 && configButtons.every(r=>r.top>=picker.bottom && Math.abs(r.top-configButtons[0].top)<2)};
  })()`);
  assert.deepEqual(await compactLayout(), { logsBelowVideo: true, seedInVideo: true, badgesSeparate: true, actionsOnTwoRows: true, configOnOneRow: true, configFits: true, configWrapped: false }, 'logs stay below the video while frame and Seed fit in its top-left corner');
  fs.writeFileSync(path.join(output, 'blink-preview-1500.png'), (await main.webContents.capturePage()).toPNG());
  await click('停止'); await until(`window.desktop.blink.getState().then(x=>x.status==='stopped')`, 'stop preview');
  await js(`document.querySelector('.blink-scroll').scrollTop=240`);
  await delay(100);
  fs.writeFileSync(path.join(output, 'blink-advanced-1500.png'), (await main.webContents.capturePage()).toPNG());
  assert.equal((await compactLayout()).logsBelowVideo, true, 'parameter scrolling keeps the log panel visible');
  await js(`document.querySelector('.blink-scroll').scrollTop=0`);
  main.setSize(1280, 820); await delay(100);
  assert.equal((await compactLayout()).configOnOneRow, true, 'configuration selector stays inline at medium widths');
  assert.equal(await js(`(() => {const s=document.querySelector('.blink-scroll');return s.scrollWidth<=s.clientWidth+1;})()`), true, 'advanced fields do not clip horizontally');
  fs.writeFileSync(path.join(output, 'blink-advanced-1280.png'), (await main.webContents.capturePage()).toPNG());
  await click('TID/SID 测种');
  await until(`window.desktop.blink.getState().then(x=>x.status==='capturing')`, 'TID/SID capture starts');
  assert.equal(await js(`document.querySelector('.blink-footer').textContent.includes('0 / 64')`), true, 'active capture count remains visible below the form');
  await click('停止'); await until(`window.desktop.blink.getState().then(x=>x.status==='stopped')`, 'stop TID/SID capture');
  await click('捕捉 Seed');
  await until(`window.desktop.blink.getState().then(x=>x.status==='capturing')`, 'capture starts');
  await click('首页');
  assert.equal(blink.getState().status, 'capturing', 'BDSP page changes preserve the job');
  await click('眨眼捕获');
  main.setSize(1100, 720); await delay(100);
  assert.equal(await js(`(() => {const s=document.querySelector('.blink-scroll');return s.scrollWidth<=s.clientWidth+1;})()`), true, 'narrow workspace must not clip controls horizontally');
  assert.equal((await compactLayout()).configFits, true, 'configuration input and buttons fit in a small window');
  assert.equal((await compactLayout()).configWrapped, true, 'configuration actions wrap beneath the name in a small window');
  assert.equal(await js(`(() => {const r=document.querySelector('.blink-footer').getBoundingClientRect();return r.bottom<innerHeight && r.top>50;})()`), true, 'stop and status remain reachable in a small window');
  fs.writeFileSync(path.join(output, 'blink-compact-1100.png'), (await main.webContents.capturePage()).toPNG());
  await js(`window.desktop.devices.video.disconnect()`);
  await until(`window.desktop.blink.getState().then(x=>x.status==='error')`, 'disconnect stops worker');
  assert.match(blink.getState().message, /视频|Video/);
  assert.equal(devices.getState().controller.status, 'idle');
  // Invalid source errors must be visible, with no fabricated seed result.
  assert.equal(blink.getState().result, null);
  // Isolated renderer fixture: verify long Seed values in the video at the narrow width.
  // This does not represent recovery from the synthetic video used above.
  main.webContents.send('blink:state', { revision: blink.getState().revision + 1000, mode: 'recover', status: 'completed', captured: 40, target: 40, message: '布局测试结果', result: {
    words: ['FFFFFFFF', 'FFFFFFFF', '87654321', '12345678'], pair: ['FFFFFFFFFFFFFFFF', '8765432112345678'], mode: 'recover', matchedAdvance: null, capturedAt: 1234, blinks: [], intervals: [],
  } });
  await until(`document.querySelector('[aria-label="捕获 Seed 0"]').textContent==='FFFFFFFFFFFFFFFF'`, 'result layout fixture');
  await delay(100);
  assert.equal(await js(`(() => {
    const badge=document.querySelector('.blink-video-seeds'), area=badge.getBoundingClientRect();
    return badge.scrollWidth<=badge.clientWidth+1 &&
      [...badge.querySelectorAll('code')].every(x=>x.getBoundingClientRect().right<=area.right+1);
  })()`), true, 'full hexadecimal seeds remain readable in the video at a small window width');
  fs.writeFileSync(path.join(output, 'blink-result-1100.png'), (await main.webContents.capturePage()).toPNG());
  await Promise.all([blink.close(), devices.close(), rng.close()]); notifications.close();
  clearTimeout(timer); console.log('Blink Electron shared-frame, selection, lifecycle and layout checks passed'); app.exit(0);
}).catch(async error => {
  console.error(error);
  await Promise.allSettled([blink?.close(), devices?.close(), rng?.close()]); notifications?.close();
  clearTimeout(timer); app.exit(1);
});
