const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');

// The main renderer owns the working session; tool windows receive snapshots and
// send explicit actions back, so detaching never creates a second script session.
function registerPanelWindows({ getMainWindow, loadWindow }) {
  const windows = new Map();
  const bounds = new Map();
  let logs = [];
  let logSource = '全部来源';
  const validTools = new Set(['video', 'logs']);
  const sources = new Set(['全部来源', '系统', '脚本', '手柄']);

  const stateFor = window => ({ detached: [...windows.keys()], logs, logSource, alwaysOnTop: window.isAlwaysOnTop() });
  const broadcast = () => {
    for (const window of [getMainWindow(), ...[...windows.values()].map(item => item.window)]) {
      if (window && !window.isDestroyed()) window.webContents.send('panels:state', stateFor(window));
    }
  };
  const requireWindow = event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const known = window === getMainWindow() || [...windows.values()].some(item => item.window === window);
    if (!window || !known || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown panel sender');
    return window;
  };
  const requireMain = event => {
    if (requireWindow(event) !== getMainWindow()) throw new Error('Main window required');
  };
  const requireTool = event => {
    const window = requireWindow(event);
    const entry = [...windows].find(([, item]) => item.window === window);
    if (!entry) throw new Error('Tool window required');
    return { tool: entry[0], window };
  };

  const open = async tool => {
    if (!validTools.has(tool)) throw new Error('Unknown tool');
    const existing = windows.get(tool);
    if (existing) {
      await existing.ready;
      if (!existing.window.isDestroyed()) {
        if (existing.window.isMinimized()) existing.window.restore();
        existing.window.show();
        existing.window.focus();
      }
      return;
    }
    const mainBounds = getMainWindow().getBounds();
    const preferred = bounds.get(tool) || { x: mainBounds.x + mainBounds.width - 500, y: mainBounds.y + 80, width: 440, height: 640 };
    const area = screen.getDisplayMatching(preferred).workArea;
    const width = Math.min(Math.max(360, preferred.width), area.width);
    const height = Math.min(Math.max(280, preferred.height), area.height);
    const window = new BrowserWindow({
      width, height, useContentSize: true,
      x: Math.max(area.x, Math.min(preferred.x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(preferred.y, area.y + area.height - height)),
      minWidth: 360, minHeight: 280, show: false, resizable: true,
      title: (tool === 'video' ? '视频预览' : '日志中心') + ' · Auto Poke RNG',
      backgroundColor: '#1d2020', titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1d2020', symbolColor: '#acafaf', height: 44 },
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    // Windows applies frame insets during construction; set the content size once
    // the native window exists so detach/dock cycles retain the requested size.
    window.setContentSize(width, height);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const rememberBounds = () => {
      if (window.isDestroyed() || window.isMaximized() || window.isMinimized()) return;
      const { x, y } = window.getBounds();
      const [width, height] = window.getContentSize();
      // Content dimensions avoid accumulating native-frame rounding at non-100% DPI.
      bounds.set(tool, { x, y, width, height });
    };
    window.on('move', rememberBounds);
    window.on('resize', rememberBounds);
    window.on('closed', () => { windows.delete(tool); broadcast(); });
    const entry = { window, ready: null };
    windows.set(tool, entry);
    entry.ready = loadWindow(window, { panel: tool }).then(() => {
      if (!window.isDestroyed()) { window.show(); broadcast(); }
    }).catch(error => {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    });
    await entry.ready;
  };

  ipcMain.handle('panels:open', (event, tool) => { requireMain(event); return open(tool); });
  ipcMain.handle('panels:get-state', event => stateFor(requireWindow(event)));
  ipcMain.handle('panels:publish-logs', (event, entries) => {
    requireMain(event);
    if (!Array.isArray(entries) || entries.length > 500 || !entries.every(entry =>
      entry && typeof entry.id === 'string' && typeof entry.time === 'string' && typeof entry.message === 'string'
      && ['系统', '脚本', '手柄'].includes(entry.source) && ['info', 'success', 'warning'].includes(entry.level))) {
      throw new Error('Invalid log snapshot');
    }
    logs = entries;
    broadcast();
  });
  ipcMain.handle('panels:log-source', (event, source) => {
    requireWindow(event);
    if (!sources.has(source)) throw new Error('Invalid log source');
    logSource = source;
    broadcast();
  });
  ipcMain.handle('panels:clear-logs', event => {
    requireTool(event);
    getMainWindow()?.webContents.send('panels:action', { type: 'clear-logs' });
  });
  ipcMain.handle('panels:dock', event => {
    const { tool, window } = requireTool(event);
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
      window.close();
      main.webContents.send('panels:action', { type: 'dock', tool });
    }
  });
  ipcMain.handle('panels:always-on-top', (event, enabled) => {
    const { window } = requireTool(event);
    if (typeof enabled !== 'boolean') throw new Error('Invalid window state');
    window.setAlwaysOnTop(enabled);
    broadcast();
  });

  return {
    closeAll: () => {
      for (const { window } of [...windows.values()]) if (!window.isDestroyed()) window.destroy();
    },
  };
}

module.exports = { registerPanelWindows };
