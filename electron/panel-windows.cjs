const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');

// The main renderer owns the working session; tool windows receive snapshots and
// send explicit actions back, so detaching never creates a second script session.
function registerPanelWindows({ getMainWindow, loadWindow }) {
  const windows = new Map();
  const bounds = new Map();
  let logs = [];
  let logSource = '全部来源';
  let videoLabelsOpen = false;
  const boundsKey = tool => tool === 'video' && videoLabelsOpen ? 'video-labels' : tool;
  const contentBounds = window => {
    const frame = window.getBounds();
    const { x, y } = frame;
    const [width, height] = window.getContentSize();
    return { x, y, width, height, frame };
  };
  const validTools = new Set(['video', 'logs']);
  const sources = new Set(['全部来源', '系统', '脚本', '手柄']);
  const canSend = window => window && !window.isDestroyed() && !window.webContents.isDestroyed();
  const notifyMain = action => {
    const main = getMainWindow();
    if (canSend(main)) main.webContents.send('panels:action', action);
  };

  const stateFor = window => ({ detached: [...windows.keys()], logs, logSource, videoLabelsOpen, alwaysOnTop: window.isAlwaysOnTop() });
  const broadcast = () => {
    for (const window of [getMainWindow(), ...[...windows.values()].map(item => item.window)]) {
      // An owned window may close after the owner's renderer is destroyed but
      // before its BrowserWindow emits 'closed'. Check both lifetimes.
      if (canSend(window)) window.webContents.send('panels:state', stateFor(window));
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
    const labels = tool === 'video' && videoLabelsOpen;
    const preferred = bounds.get(boundsKey(tool)) || { x: mainBounds.x + mainBounds.width - (labels ? 1180 : 500), y: mainBounds.y + 80, width: labels ? 1120 : 440, height: labels ? 780 : 640 };
    const area = screen.getDisplayMatching(preferred).workArea;
    const width = Math.min(Math.max(labels ? 960 : 360, preferred.width), area.width);
    const height = Math.min(Math.max(labels ? 620 : 280, preferred.height), area.height);
    const window = new BrowserWindow({
      width, height, useContentSize: true,
      // Owned, non-modal windows stay above the workspace while it has focus.
      // Global always-on-top remains an explicit choice via the pin button.
      parent: getMainWindow(), modal: false,
      x: Math.max(area.x, Math.min(preferred.x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(preferred.y, area.y + area.height - height)),
      minWidth: labels ? 960 : 360, minHeight: labels ? 620 : 280, show: false, resizable: true,
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
      // Content dimensions avoid accumulating native-frame rounding at non-100% DPI.
      bounds.set(boundsKey(tool), contentBounds(window));
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
    notifyMain({ type: 'clear-logs' });
  });
  ipcMain.handle('panels:dock', event => {
    const { tool, window } = requireTool(event);
    const main = getMainWindow();
    if (canSend(main)) {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
      window.close();
      notifyMain({ type: 'dock', tool });
    }
  });
  ipcMain.handle('panels:always-on-top', (event, enabled) => {
    const { window } = requireTool(event);
    if (typeof enabled !== 'boolean') throw new Error('Invalid window state');
    window.setAlwaysOnTop(enabled);
    broadcast();
  });
  ipcMain.handle('panels:video-labels', (event, enabled) => {
    const sender = requireWindow(event);
    const video = windows.get('video')?.window;
    if (sender !== getMainWindow() && sender !== video) throw new Error('Video or main window required');
    if (typeof enabled !== 'boolean') throw new Error('Invalid video layout');
    if (videoLabelsOpen === enabled) return;
    const canResize = canSend(video) && !video.isMaximized() && !video.isMinimized();
    const previous = canResize ? contentBounds(video) : null;
    if (previous) bounds.set(boundsKey('video'), previous);
    videoLabelsOpen = enabled;
    if (previous) {
      // Keep normal preview and label editing sizes separate, including after docking.
      const preferred = bounds.get(boundsKey('video')) || {
        x: previous.x + previous.width - (enabled ? 1120 : 440), y: previous.y,
        width: enabled ? 1120 : 440, height: enabled ? 780 : 640,
      };
      video.setMinimumSize(enabled ? 960 : 360, enabled ? 620 : 280);
      const area = screen.getDisplayMatching(video.getBounds()).workArea;
      // Restore saved native bounds directly to avoid accumulating Windows DPI
      // rounding when converting content sizes to frame sizes on every toggle.
      const width = Math.min(preferred.frame?.width || preferred.width + previous.frame.width - previous.width, area.width);
      const height = Math.min(preferred.frame?.height || preferred.height + previous.frame.height - previous.height, area.height);
      video.setBounds({ width, height,
        x: Math.max(area.x, Math.min(preferred.x, area.x + area.width - width)),
        y: Math.max(area.y, Math.min(preferred.y, area.y + area.height - height)),
      });
      // Moving/resizing the native frame can round its insets on scaled displays.
      // Apply content size last, as when a tool window is first constructed.
      const actual = contentBounds(video);
      video.setContentSize(Math.min(preferred.width, area.width - (actual.frame.width - actual.width)),
        Math.min(preferred.height, area.height - (actual.frame.height - actual.height)));
    } else if (canSend(video)) {
      video.setMinimumSize(enabled ? 960 : 360, enabled ? 620 : 280);
    }
    broadcast();
  });

  return {
    closeAll: () => {
      for (const { window } of [...windows.values()]) if (!window.isDestroyed()) window.destroy();
    },
  };
}

module.exports = { registerPanelWindows };
