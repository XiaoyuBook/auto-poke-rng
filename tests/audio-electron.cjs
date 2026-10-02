const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerDevices } = require('../electron/devices.cjs');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'node_modules/.tmp/audio-review');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
let devices;
const timer = setTimeout(() => { console.error('Audio UI test timeout'); app.exit(1); }, 30000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) { for (let i=0; i<120; ++i) { if (await fn()) return; await delay(40); } throw Error(message); }
app.whenReady().then(async () => {
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: 'test', platform: 'win32' }));
  const window = new BrowserWindow({ width: 1100, height: 740, show: false,
    webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } });
  const scriptRoot = path.join(output, 'scripts');
  fs.mkdirSync(scriptRoot, { recursive: true });
  registerPanelWindows({ getMainWindow: () => window, loadWindow: w => w.loadFile(path.join(root, 'dist/index.html')) });
  registerScriptFiles({ getMainWindow: () => window, rootDirectory: scriptRoot });
  // Unrelated services remain idle in this focused device test.
  ipcMain.handle('automation:state', () => null);
  ipcMain.handle('qq:state', () => null);
  ipcMain.handle('blink:state', () => ({ status: 'idle' }));
  devices = registerDevices({ ipcMain, getWindows: () => [window], rootDirectory: scriptRoot, testMode: true });
  const js = code => window.webContents.executeJavaScript(code, true);
  await window.loadFile(path.join(root, 'dist/index.html'));
  await js(`document.querySelector('[aria-label="视频源：未尝试连接"]').click()`);
  await until(() => js(`Array.from(document.querySelectorAll('[aria-label="音频输入"] option')).some(x=>x.value==='synthetic')`), 'audio list');
  assert.equal(await js(`document.querySelector('[aria-label="音频输入"]').value`), '', 'must not auto-select a microphone');
  await js(`(()=>{const s=document.querySelector('[aria-label="音频输入"]');s.value='synthetic';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='连接音频源').click()`);
  await until(() => js(`document.querySelector('[aria-label="游戏音频输入音量"]')?.value > -20`), 'live audio meter');
  assert.equal(devices.getState().video.status, 'idle', 'audio connects independently of video');
  assert.equal(devices.getState().audio.sampleRate, 48000);
  const session = devices.getState().audio.session;
  const layout = await js(`(()=>{const d=document.querySelector('dialog').getBoundingClientRect(); const b=document.querySelector('.dialog-body'); b.scrollTop=b.scrollHeight;return {top:d.top,bottom:d.bottom,height:innerHeight,overflow:b.scrollHeight>b.clientHeight};})()`);
  assert.ok(layout.top >= 0 && layout.bottom <= layout.height, 'dialog stays in the viewport');
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await delay(180); // Finish the native dialog entrance animation before capturing.
  fs.writeFileSync(path.join(output, 'audio-connected.png'), (await window.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[aria-label="关闭视频源"]').click()`);
  assert.equal(devices.getState().audio.session, session, 'closing settings must keep capturing');
  await js(`document.querySelector('[aria-label="视频源：未尝试连接"]').click()`);
  await until(() => js(`document.querySelector('[aria-label="游戏音频输入音量"]')?.value > -20`), 'meter resumes in reopened dialog');
  await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='断开音频源').click()`);
  await until(() => devices.getState().audio.status === 'idle', 'audio disconnect');
  assert.equal(await js(`Boolean(document.querySelector('[aria-label="游戏音频输入音量"]'))`), false);
  await devices.close(); window.destroy(); clearTimeout(timer);
  console.log('Audio UI: explicit input, live meter, independent capture, dialog lifecycle, layout and disconnect passed');
  app.exit(0);
}).catch(async error => { console.error(error); await devices?.close(); clearTimeout(timer); app.exit(1); });
