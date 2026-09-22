const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');

// Fail automation immediately instead of showing Electron's uncaught-error dialog.
const fail = error => { console.error(error); app.exit(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'node_modules/.tmp/panel-window-review');
fs.mkdirSync(output, { recursive: true });
const profile = path.join(output, 'profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
// Test windows use a separate profile and only appear briefly for capture.
let hideTestWindows = true;
app.on('browser-window-created', (_event, window) => window.on('show', () => { if (hideTestWindows) window.hide(); }));
const timeout = setTimeout(() => { console.error('Electron panel checks timed out'); app.exit(1); }, 40000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (window, code) => window.webContents.executeJavaScript(code);
const click = (window, label) => evaluate(window, `document.querySelector('[aria-label="${label}"]').click()`);
const panelBounds = window => evaluate(window, `(() => {
  const r = document.querySelector('.floating-side-panel').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
})()`);
async function until(condition, description) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(40);
  }
  throw new Error('Timed out: ' + description);
}
async function capture(window, name) {
  await evaluate(window, 'document.fonts.ready.then(() => true)');
  hideTestWindows = false;
  window.showInactive();
  await delay(400);
  const image = await window.webContents.capturePage(undefined, { stayHidden: true });
  fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
  window.hide();
  hideTestWindows = true;
}
const findTool = tool => BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL() || 'about:blank').searchParams.get('panel') === tool);

async function assertAboveMain(main, tool) {
  assert.equal(tool.isVisible(), true, 'tool remains visible while using main window');
  assert.equal(tool.isMinimized(), false, 'tool is not minimized by main window focus');
  assert.equal(tool.isAlwaysOnTop(), false, 'tool does not need global always-on-top');
  if (process.platform !== 'win32') return;
  const nativeHandle = window => {
    const bytes = window.getNativeWindowHandle();
    return (bytes.length === 8 ? bytes.readBigUInt64LE() : bytes.readUInt32LE()).toString();
  };
  const { stdout } = await promisify(execFile)('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'window-order.ps1'),
    '-MainHandle', nativeHandle(main), '-ToolHandle', nativeHandle(tool),
  ], { windowsHide: true, timeout: 10000 });
  assert.deepEqual(JSON.parse(stdout.trim()), { aboveMain: true, minimized: false, visible: true },
    'detached tool stays above the main window in native Windows stacking order');
}

app.whenReady().then(async () => {
  const errors = [];
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  });
  ipcMain.handle('app:metadata', () => ({ name: 'Auto Poke RNG', version: '0.1.0', platform: process.platform }));
  let main = new BrowserWindow({
    width: 1440, height: 920, show: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'electron/preload.cjs'), backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const loadWindow = (window, query = {}) => window.loadFile(path.join(root, 'dist/index.html'), { query });
  const manager = registerPanelWindows({ getMainWindow: () => main, loadWindow });
  main.on('closed', () => { main = null; manager.closeAll(); });
  await loadWindow(main);
  await evaluate(main, 'localStorage.clear()');
  await loadWindow(main);
  await until(() => evaluate(main, 'Boolean(document.querySelector("textarea"))'), 'workspace ready');
  console.log('Workspace ready');
  await evaluate(main, `(() => {
    const field = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '# unsaved detached test');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(main, '日志中心');
  const original = await panelBounds(main);
  const handle = await evaluate(main, `(() => {
    const r = document.querySelector('.resize-corner').getBoundingClientRect();
    return { x: Math.round(r.x + 8), y: Math.round(r.y + 8) };
  })()`);
  main.webContents.sendInputEvent({ type: 'mouseMove', ...handle });
  main.webContents.sendInputEvent({ type: 'mouseDown', ...handle, button: 'left', clickCount: 1 });
  main.webContents.sendInputEvent({ type: 'mouseMove', x: handle.x - 90, y: handle.y + 30, modifiers: ['leftButtonDown'] });
  main.webContents.sendInputEvent({ type: 'mouseUp', x: handle.x - 90, y: handle.y + 30, button: 'left', clickCount: 1 });
  await until(async () => (await panelBounds(main)).width > original.width, 'pointer resizing');
  const resized = await panelBounds(main);
  assert.equal(resized.width, original.width + 90);
  assert.equal(resized.height, original.height - 30);
  assert.ok(Math.abs(resized.right - original.right) < 1);
  assert.ok(Math.abs(resized.bottom - original.bottom) < 1);
  await click(main, '展开面板');
  await click(main, '还原面板大小');
  assert.deepEqual(await panelBounds(main), resized);
  console.log('Pointer resize and expand/restore passed');
  await click(main, '关闭日志中心');
  await click(main, '日志中心');
  assert.deepEqual(await panelBounds(main), resized);
  await evaluate(main, `(() => {
    const select = document.querySelector('[aria-label="筛选日志来源"]');
    select.value = '脚本'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until(() => evaluate(main, `document.querySelector('select').value === '脚本'`), 'filter selected');
  await capture(main, 'resizable-panel');
  console.log('Inline snapshot captured');
  await click(main, '弹出为独立窗口');
  await until(() => findTool('logs')?.webContents.getURL().includes('panel=logs'), 'log window created');
  let logs = findTool('logs');
  await until(() => evaluate(logs, `document.querySelector('select')?.value === '脚本'`), 'detached filter retained');
  await until(() => evaluate(main, '!document.querySelector(".floating-side-panel")'), 'inline panel removed');
  assert.equal(logs.isResizable(), true);
  assert.equal(logs.isMovable(), true);
  assert.equal(logs.getParentWindow(), main);
  assert.equal(logs.isModal(), false, 'detached tools do not block the main window');
  console.log('Detached window ready');
  await click(main, '日志中心');
  assert.equal(BrowserWindow.getAllWindows().length, 2, 'existing window is reused');
  await evaluate(main, `Array.from(document.querySelectorAll('button')).find(b => b.textContent === '开始运行').click()`);
  await until(() => evaluate(logs, `document.querySelector('.logs-table')?.textContent.includes('开始运行演示')`), 'live logs reach detached window');
  await evaluate(logs, `Array.from(document.querySelectorAll('button')).find(b => b.textContent === '清空日志').click()`);
  await until(() => evaluate(main, 'window.desktop.panels.getState().then(s => s.logs.length === 0)'), 'clear logs reaches main window');
  assert.equal(await evaluate(main, 'document.querySelector("textarea").value'), '# unsaved detached test');
  await click(logs, '窗口置顶');
  await until(() => logs.isAlwaysOnTop(), 'always on top');
  await click(logs, '取消置顶');
  await until(() => !logs.isAlwaysOnTop(), 'unpin');
  const initialNative = logs.getBounds();
  logs.setBounds({ x: initialNative.x - 70, y: initialNative.y + 20, width: 520, height: 700 });
  await delay(100);
  const movedNative = logs.getBounds();
  const movedContentSize = logs.getContentSize();
  assert.notEqual(movedNative.x, initialNative.x);
  assert.ok(movedNative.width > initialNative.width);
  await capture(logs, 'detached-logs');
  hideTestWindows = false;
  main.show();
  logs.show();
  main.focus();
  await until(() => main.isFocused(), 'main window can take focus while tool stays open');
  await click(main, '视频预览');
  await assertAboveMain(main, logs);
  await click(main, '弹出为独立窗口');
  await until(() => Boolean(findTool('video')), 'video window created');
  const video = findTool('video');
  await until(() => evaluate(video, 'Boolean(document.querySelector(".video-preview-content"))'), 'video ready');
  assert.equal(BrowserWindow.getAllWindows().length, 3);
  main.focus();
  await until(() => main.isFocused(), 'main stays interactive with both tools open');
  await assertAboveMain(main, logs);
  await assertAboveMain(main, video);
  main.hide();
  logs.hide();
  video.hide();
  hideTestWindows = true;
  await capture(video, 'detached-video');
  video.setContentSize(760, 280);
  await delay(150);
  const compactVideo = await evaluate(video, `(() => {
    const r = document.querySelector('.preview-frame').getBoundingClientRect();
    const stage = document.querySelector('.preview-stage');
    return { ratio: r.width / r.height, overflow: stage.scrollHeight > stage.clientHeight };
  })()`);
  assert.ok(Math.abs(compactVideo.ratio - 16 / 9) < 0.02, 'short, wide video window preserves aspect ratio');
  assert.equal(compactVideo.overflow, false);
  await capture(video, 'detached-video-compact');
  console.log('The following rejected IPC call is an expected sender-permission check.');
  assert.equal(await evaluate(video, `window.desktop.panels.open('logs').then(() => false, () => true)`), true, 'tool windows cannot create other windows');
  await click(logs, '收回主窗口');
  await until(() => logs.isDestroyed(), 'log window docked');
  await until(() => evaluate(main, `document.querySelector('.floating-side-panel select')?.value === '脚本'`), 'docked filter retained');
  assert.deepEqual(await panelBounds(main), resized);
  await click(main, '弹出为独立窗口');
  await until(() => Boolean(findTool('logs')), 'log window reopened');
  logs = findTool('logs');
  await until(() => evaluate(logs, 'Boolean(document.querySelector("select"))'), 'reopened logs ready');
  const reopenedBounds = logs.getBounds();
  assert.ok(logs.getContentSize().every((dimension, index) => Math.abs(dimension - movedContentSize[index]) <= 1), 'native content size remembered within one DIP of display rounding');
  assert.equal(reopenedBounds.x, movedNative.x, 'native horizontal position remembered');
  assert.equal(reopenedBounds.y, movedNative.y, 'native vertical position remembered');
  await until(() => evaluate(main, '!document.querySelector(".floating-side-panel")'), 'reopened inline panel removed');
  logs.close();
  await until(() => evaluate(main, `document.querySelector('[aria-label="日志中心"]').dataset.state === 'closed'`), 'closing window clears dock state');
  await click(main, '日志中心');
  await until(() => evaluate(main, 'Boolean(document.querySelector(".floating-side-panel"))'), 'closed tool opens inline again');
  assert.equal(await evaluate(main, 'document.querySelector("textarea").value'), '# unsaved detached test');
  main.setContentSize(1100, 680);
  await delay(100);
  const smallerViewport = await evaluate(main, '({ width: innerWidth, height: innerHeight })');
  const smallerPanel = await panelBounds(main);
  assert.ok(smallerPanel.x >= 22 && smallerPanel.y >= 63, 'resized panel remains within smaller workspace');
  assert.ok(smallerPanel.right <= smallerViewport.width && smallerPanel.bottom <= smallerViewport.height);
  assert.deepEqual(errors, [], 'no renderer errors');
  main.close();
  await until(() => BrowserWindow.getAllWindows().length === 0, 'main close cleans up all windows');
  assert.equal(video.isDestroyed(), true, 'main close cleans up detached tools');
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  clearTimeout(timeout);
  console.log('PASS Electron panels: pointer resize, size persistence, independent move/resize, detach/dock, native stacking order, duplicate prevention, live logs, filters, clear, pin, edits, cleanup.');
  console.log('Screenshots: ' + output);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
