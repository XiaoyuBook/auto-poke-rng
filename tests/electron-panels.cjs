const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { registerPanelWindows } = require('../electron/panel-windows.cjs');
const { registerDevices } = require('../electron/devices.cjs');
const { registerScriptFiles } = require('../electron/script-files.cjs');
const { editorHelpers } = require('./editor-helpers.cjs');

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
const evaluate = (window, code) => window.webContents.executeJavaScript(code).catch(error => { throw new Error(code + '\n' + error.message); });
const click = (window, label) => evaluate(window, `document.querySelector('[aria-label="${label}"]').click()`);
const panelBounds = window => evaluate(window, `(() => {
  const r = document.querySelector('.floating-side-panel').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
})()`);
const videoBounds = window => evaluate(window, `(() => {
  const r = document.querySelector('.persistent-video').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
})()`);
async function assertInlineLabelsFit(window) {
  assert.equal(await evaluate(window, `(() => {
    const labels = document.querySelector('.workspace-labels');
    const content = labels.querySelector('.label-details');
    const canvas = labels.querySelector('.label-snapshot-section').getBoundingClientRect();
    const video = document.querySelector('.persistent-video').getBoundingClientRect();
    return !labels.hidden && canvas.right <= video.left
      && content.getBoundingClientRect().top >= canvas.bottom
      && content.getBoundingClientRect().right <= video.left
      && content.scrollWidth <= content.clientWidth + 1
      && getComputedStyle(content).overflowY === 'auto';
  })()`), true, 'inline label controls stay below the snapshot inside the left workspace');
}
async function assertLabelWorkspaceFits(window) {
  const layout = await evaluate(window, `(() => {
    const content = document.querySelector('.image-label-content');
    const bounds = content.getBoundingClientRect();
    const coordinates = document.querySelector('.label-coordinates').getBoundingClientRect();
    const note = document.querySelector('.label-workspace-note').getBoundingClientRect();
    const inputs = [...document.querySelectorAll('.label-coordinates input')].map(input => input.getBoundingClientRect());
    const controls = [...content.querySelectorAll('button, input, select, .label-workspace-note')];
    return {
      fitsHeight: content.scrollHeight <= content.clientHeight + 1,
      fitsWidth: content.scrollWidth <= content.clientWidth + 1,
      controlsVisible: controls.every(control => {
        const rect = control.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1 && rect.left >= bounds.left && rect.right <= bounds.right + 1;
      }),
      coordinatesOnOneRow: inputs.every(rect => Math.abs(rect.top - inputs[0].top) < 1),
      footerBelowFields: note.top >= coordinates.bottom,
    };
  })()`);
  assert.deepEqual(layout, { fitsHeight: true, fitsWidth: true, controlsVisible: true, coordinatesOnOneRow: true, footerBelowFields: true }, 'label workspace fits without scrolling, clipped controls, or wrapped coordinates');
}
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
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'window-order.ps1'),
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
  const scriptRoot = fs.mkdtempSync(path.join(output, 'scripts-'));
  fs.mkdirSync(path.join(scriptRoot, '火红'));
  fs.mkdirSync(path.join(scriptRoot, '珍钻复刻'));
  fs.writeFileSync(path.join(scriptRoot, '火红', '确认.rng'), '# 火红测试\npress A');
  fs.writeFileSync(path.join(scriptRoot, '珍钻复刻', '菜单.rng'), '# 珍钻测试\npress X');
  registerScriptFiles({ getMainWindow: () => main, getLabelWindows: () => [manager.getVideoWindow()], rootDirectory: scriptRoot });
  const devices = registerDevices({ ipcMain, getWindows: () => BrowserWindow.getAllWindows(), rootDirectory: scriptRoot, testMode: true });
  main.on('closed', () => { main = null; manager.closeAll(); });
  await loadWindow(main);
  await evaluate(main, 'localStorage.clear()');
  await loadWindow(main);
  const editor = editorHelpers(main);
  await until(() => evaluate(main, 'Boolean(document.querySelector(".cm-content"))'), 'workspace ready');
  console.log('Workspace ready');
  const scriptColumns = await evaluate(main, `(() => {
    const library = document.querySelector('.script-library').getBoundingClientRect();
    const editorColumn = document.querySelector('.editor-column').getBoundingClientRect();
    return { sameRow: Math.abs(library.top - editorColumn.top) < 1, libraryRight: library.right, editorLeft: editorColumn.left };
  })()`);
  assert.equal(scriptColumns.sameRow, true, 'script library stays in the left column of the editor');
  assert.ok(scriptColumns.libraryRight <= scriptColumns.editorLeft, 'script library does not move above the editor');
  await evaluate(main, `document.querySelector('.nav-item[title="OCR 设置"]').click()`);
  await until(() => evaluate(main, 'Boolean(document.querySelector(".ocr-workspace"))'), 'OCR workspace ready');
  assert.equal(await evaluate(main, 'Boolean(document.querySelector(".video-roi-overlay"))'), true, 'OCR mode overlays an ROI selector on the persistent video');
  assert.equal(await evaluate(main, 'Boolean(document.querySelector(".persistent-ocr-preview")) && !document.querySelector(".persistent-ocr-preview").hidden'), true, 'OCR mode shows the recognition preview below video');
  await capture(main, 'ocr-workspace');
  await evaluate(main, `document.querySelector('.nav-item[title="脚本编辑"]').click()`);
  await until(() => evaluate(main, 'Boolean(document.querySelector(".cm-content"))'), 'script workspace restored after OCR');
  const pinnedBounds = await videoBounds(main);
  await evaluate(main, `document.querySelector('.video-resize-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
  await until(async () => (await videoBounds(main)).width > pinnedBounds.width, 'video resize handle');
  const enlargedVideo = await videoBounds(main);
  assert.equal(enlargedVideo.top, pinnedBounds.top, 'resizing keeps the video anchored at the top');
  assert.ok(Math.abs(enlargedVideo.right - pinnedBounds.right) < 1, 'resizing keeps the video anchored at the right');
  assert.ok(Math.abs(enlargedVideo.width / enlargedVideo.height - 16 / 9) < 0.02, 'resizing preserves the 16:9 video ratio');
  await evaluate(main, `document.querySelector('.video-resize-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await until(async () => Math.abs((await videoBounds(main)).width - pinnedBounds.width) < 1, 'video resize restore');
  for (let index = 0; index < 9; index++) {
    await evaluate(main, `document.querySelector('.video-resize-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
    await delay(15);
  }
  const narrowToolbar = await evaluate(main, `(() => {
    const help = [...document.querySelectorAll('.editor-tool-button')].find(button => button.textContent.includes('帮助'));
    const toolbar = document.querySelector('.script-tools').getBoundingClientRect();
    const rect = help.getBoundingClientRect();
    return { visible: rect.width > 0 && rect.height > 0, inside: rect.right <= toolbar.right + 1, beforeVideo: rect.right <= document.querySelector('.persistent-video').getBoundingClientRect().left + 1 };
  })()`);
  assert.deepEqual(narrowToolbar, { visible: true, inside: true, beforeVideo: true }, 'script help remains visible when the video is enlarged');
  for (let index = 0; index < 9; index++) {
    await evaluate(main, `document.querySelector('.video-resize-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
    await delay(15);
  }
  await until(async () => Math.abs((await videoBounds(main)).width - pinnedBounds.width) < 1, 'video resize second restore');
  const workspaceVideoLayout = await evaluate(main, `(() => {
    const primary = document.querySelector('.workspace-primary').getBoundingClientRect();
    const rail = document.querySelector('.workspace-right-rail').getBoundingClientRect();
    const logs = document.querySelector('.persistent-logs').getBoundingClientRect();
    const video = document.querySelector('.persistent-video').getBoundingClientRect();
    return {
      primary: { right: primary.right },
      rail: { left: rail.left, right: rail.right },
      logs: { top: logs.top, left: logs.left, right: logs.right },
      video: { bottom: video.bottom, left: video.left, right: video.right },
    };
  })()`);
  assert.ok(workspaceVideoLayout.primary.right < workspaceVideoLayout.video.left, 'left workspace remains separate from the fixed right rail');
  assert.ok(workspaceVideoLayout.logs.top >= workspaceVideoLayout.video.bottom, 'logs stay below the persistent video');
  assert.ok(Math.abs(workspaceVideoLayout.logs.left - workspaceVideoLayout.video.left) < 1 && Math.abs(workspaceVideoLayout.logs.right - workspaceVideoLayout.video.right) < 1, 'logs align to the video width in the fixed right rail');
  assert.ok(Math.abs(workspaceVideoLayout.rail.left - workspaceVideoLayout.video.left) < 1 && Math.abs(workspaceVideoLayout.rail.right - workspaceVideoLayout.video.right) < 1, 'the right rail stays fixed to the video column');
  assert.equal(await evaluate(main, `Boolean(document.querySelector('.quick-dock [aria-label="视频预览"]'))`), false, 'video no longer uses the footer dock');
  await evaluate(main, `document.querySelector('.nav-item[title="首页"]').click()`);
  assert.deepEqual(await videoBounds(main), pinnedBounds, 'video stays in place on home page');
  await evaluate(main, `document.querySelector('.nav-item[title="脚本编辑"]').click()`);
  assert.deepEqual(await videoBounds(main), pinnedBounds, 'video stays in place in script workspace');
  await capture(main, 'persistent-video-workspace');
  assert.equal(await evaluate(main, 'document.querySelectorAll(".library-folder-button").length'), 2);
  await click(main, '文件夹：珍钻复刻');
  await click(main, '选择脚本：菜单');
  assert.equal(await editor.read(), '# 珍钻测试\npress X');
  await editor.edit('# 保存到磁盘');
  await click(main, '保存脚本');
  await until(() => fs.readFileSync(path.join(scriptRoot, '珍钻复刻', '菜单.rng'), 'utf8') === '# 保存到磁盘', 'script saved through preload IPC');
  await click(main, '选择脚本：确认');
  assert.equal(await editor.read(), '# 火红测试\npress A');
  await click(main, '选择脚本：菜单');
  console.log('Project folder discovery, selection, and disk save passed');
  await editor.edit('# unsaved detached test');
  await evaluate(main, `document.querySelector('.quick-dock [aria-label="日志中心"]').click()`);
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
  assert.ok((await panelBounds(main)).y >= pinnedBounds.bottom, 'expanded logs use the area below video');
  assert.ok((await panelBounds(main)).right <= pinnedBounds.x, 'expanded logs stay inside the left workspace');
  assert.deepEqual(await videoBounds(main), pinnedBounds, 'logs do not move video');
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
  await until(() => evaluate(main, `document.querySelector('[aria-label="筛选日志来源"]').value === '脚本'`), 'filter selected');
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
  await evaluate(main, `window.desktop.devices.controller.connect('mock')`);
  await evaluate(main, `Array.from(document.querySelectorAll('button')).find(b => b.textContent === '开始运行').click()`);
  await until(() => evaluate(logs, `document.querySelector('.logs-table')?.textContent.includes('脚本执行完成')`), 'real script host logs reach detached window');
  await evaluate(logs, `Array.from(document.querySelectorAll('button')).find(b => b.textContent === '清空日志').click()`);
  await until(() => evaluate(main, 'window.desktop.panels.getState().then(s => s.logs.length === 0)'), 'clear logs reaches main window');
  assert.equal(await editor.read(), '# unsaved detached test');
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
  await assertAboveMain(main, logs);
  await evaluate(main, `document.querySelector('.persistent-video').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1200, clientY: 120 }))`);
  await click(main, '弹出视频窗口');
  await until(() => Boolean(findTool('video')), 'video window created');
  let video = findTool('video');
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
  video.setPosition(main.getBounds().x + 40, main.getBounds().y + 40);
  await delay(150);
  const compactVideo = await evaluate(video, `(() => {
    const r = document.querySelector('.preview-frame').getBoundingClientRect();
    const stage = document.querySelector('.preview-stage');
    return { ratio: r.width / r.height, overflow: stage.scrollHeight > stage.clientHeight };
  })()`);
  assert.ok(Math.abs(compactVideo.ratio - 16 / 9) < 0.02, 'short, wide video window preserves aspect ratio');
  assert.equal(compactVideo.overflow, false);
  await capture(video, 'detached-video-compact');
  const previewSize = video.getContentSize();
  const previewPosition = video.getPosition();
  await click(video, '标签');
  await until(() => evaluate(video, 'document.querySelector(".video-preview-content").dataset.labelsOpen === "true"'), 'native label layout opened');
  assert.ok(video.getContentSize()[0] > previewSize[0], 'native label layout widens the video window');
  const labelLayout = await evaluate(video, `(() => {
    const still = document.querySelector('.label-snapshot-stage').getBoundingClientRect();
    const live = document.querySelector('.label-monitor-frame').getBoundingClientRect();
    return {
      stillLeft: still.right < live.x,
      equalWidth: Math.abs(still.width - live.width) < 1,
      alignedTop: Math.abs(still.top - live.top) < 1,
      alignedBottom: Math.abs(still.bottom - live.bottom) < 1,
    };
  })()`);
  assert.deepEqual(labelLayout, { stillLeft: true, equalWidth: true, alignedTop: true, alignedBottom: true }, 'static canvas and live video split equally with aligned top and bottom edges');
  await assertLabelWorkspaceFits(video);
  await capture(video, 'detached-video-labels');
  const listScroll = await evaluate(video, `(() => {
    const list = document.querySelector('.label-library-items');
    const search = document.querySelector('.label-list-search');
    const canvas = document.querySelector('.label-snapshot-stage');
    const original = list.innerHTML;
    const searchTop = search.getBoundingClientRect().top;
    const canvasHeight = canvas.getBoundingClientRect().height;
    const emptyFits = list.scrollHeight <= list.clientHeight;
    list.replaceChildren(...Array.from({ length: 30 }, (_, index) => {
      const row = document.createElement('div');
      row.textContent = '标签 ' + (index + 1);
      row.style.height = '32px';
      return row;
    }));
    list.scrollTop = 64;
    const result = {
      emptyFits,
      populatedScrolls: list.scrollHeight > list.clientHeight && list.scrollTop > 0,
      searchFixed: search.getBoundingClientRect().top === searchTop,
      canvasUnchanged: canvas.getBoundingClientRect().height === canvasHeight,
    };
    list.innerHTML = original;
    list.scrollTop = 0;
    return result;
  })()`);
  assert.deepEqual(listScroll, { emptyFits: true, populatedScrolls: true, searchFixed: true, canvasUnchanged: true }, 'only overflowing label items scroll; empty list, search, and canvas stay fixed');
  video.setContentSize(360, 500);
  await delay(150);
  assert.deepEqual(video.getMinimumSize(), [960, 620], 'label editing has a usable minimum window size');
  await assertLabelWorkspaceFits(video);
  await capture(video, 'detached-video-labels-minimum');
  await click(video, '标签');
  await until(() => evaluate(video, 'Boolean(document.querySelector(".preview-frame"))'), 'native normal preview restored');
  assert.ok(video.getContentSize().every((size, index) => Math.abs(size - previewSize[index]) <= 1), 'closing labels restores normal content size: ' + JSON.stringify({ before: previewSize, after: video.getContentSize() }));
  assert.deepEqual(video.getPosition(), previewPosition, 'closing labels restores normal position');
  assert.deepEqual(video.getMinimumSize(), [360, 280], 'closing labels restores compact preview resize limits');
  await click(video, '标签');
  await until(() => evaluate(video, 'document.querySelector(".video-preview-content").dataset.labelsOpen === "true"'), 'labels reopened');
  await click(video, '收回主窗口');
  await until(() => video.isDestroyed(), 'video labels docked');
  await until(() => evaluate(main, 'document.querySelector(".workspace-labels")?.hidden === false'), 'inline labels retain expanded mode');
  assert.deepEqual(await videoBounds(main), pinnedBounds, 'labels do not move or resize video');
  assert.equal(await evaluate(main, 'getComputedStyle(document.querySelector(".persistent-logs")).display'), 'none', 'inline labels hide the persistent log area');
  await assertInlineLabelsFit(main);
  await capture(main, 'inline-video-labels');
  const labelMainSize = main.getContentSize();
  main.setContentSize(1100, 680);
  await delay(150);
  await assertInlineLabelsFit(main);
  await capture(main, 'inline-video-labels-compact');
  main.setContentSize(...labelMainSize);
  await delay(150);
  await click(main, '标签');
  await until(() => evaluate(main, 'document.querySelector(".workspace-labels")?.hidden === true'), 'script workspace restored');
  assert.notEqual(await evaluate(main, 'getComputedStyle(document.querySelector(".persistent-logs")).display'), 'none', 'closing labels restores the persistent log area');
  assert.deepEqual(await videoBounds(main), pinnedBounds, 'closing labels preserves video bounds');
  await click(main, '标签');
  await until(() => evaluate(main, 'document.querySelector(".workspace-labels")?.hidden === false'), 'inline labels reopened');
  await evaluate(main, `document.querySelector('.persistent-video').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1200, clientY: 120 }))`);
  await click(main, '弹出视频窗口');
  await until(() => Boolean(findTool('video')), 'label window detached again');
  video = findTool('video');
  await until(() => evaluate(video, 'document.querySelector(".video-preview-content")?.dataset.labelsOpen === "true"'), 'detaching retains label mode');
  await click(video, '标签');
  await until(() => evaluate(video, 'Boolean(document.querySelector(".preview-frame"))'), 'reopened video returns to normal preview');
  console.log('Video labels: aligned frames, no workspace scrolling, list overflow, single-row coordinates, compact layout, native/inline restoration, detach/dock passed');
  console.log('The following rejected IPC call is an expected sender-permission check.');
  assert.equal(await evaluate(video, `window.desktop.panels.open('logs').then(() => false, () => true)`), true, 'tool windows cannot create other windows');
  assert.equal(await evaluate(video, `window.desktop.scripts.list().then(() => false, () => true)`), true, 'tool windows cannot access project script files');
  assert.equal(await evaluate(video, `window.desktop.scripts.labelsList('').then(value => Array.isArray(value.labels), () => false)`), true, 'video tool can access image labels');
  assert.equal(await evaluate(logs, `window.desktop.scripts.labelsList('').then(() => false, () => true)`), true, 'log tool cannot access image labels');
  assert.equal(await evaluate(logs, `window.desktop.panels.setVideoLabelsOpen(true).then(() => false, () => true)`), true, 'log windows cannot change video layout');
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
  assert.equal(await editor.read(), '# unsaved detached test');
  main.setContentSize(1100, 680);
  await delay(100);
  const smallerViewport = await evaluate(main, '({ width: innerWidth, height: innerHeight })');
  const smallerPanel = await panelBounds(main);
  assert.ok(smallerPanel.x >= 22 && smallerPanel.y >= 63, 'resized panel remains within smaller workspace');
  assert.ok(smallerPanel.right <= smallerViewport.width && smallerPanel.bottom <= smallerViewport.height);
  assert.ok(smallerPanel.y >= (await videoBounds(main)).bottom, 'compact log panel stays below video');
  await click(main, '关闭日志中心');
  await capture(main, 'corner-video-workspace-compact');
  assert.deepEqual(errors, [], 'no renderer errors');
  await devices.close();
  main.close();
  await until(() => BrowserWindow.getAllWindows().length === 0, 'main close cleans up all windows');
  assert.equal(video.isDestroyed(), true, 'main close cleans up detached tools');
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  clearTimeout(timeout);
  console.log('PASS Electron panels: pointer resize, size persistence, independent move/resize, detach/dock, native stacking order, duplicate prevention, live logs, filters, clear, pin, edits, cleanup.');
  console.log('Screenshots: ' + output);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
