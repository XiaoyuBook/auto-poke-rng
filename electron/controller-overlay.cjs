const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { ControllerInputManager } = require('./controller-input.cjs');

function registerControllerOverlay({ getMainWindow, getWindows, loadWindow, controller }) {
  let overlay = null;
  let state = { visible: false, active: false, mode: 'off', scale: 1 };
  let mappingRestore = null;
  let moveOrigin = null;
  let lastPosition = null;
  const resizeWindow = (window, size) => {
    // Windows pins a non-resizable window to its current native size. Unlock
    // only for this synchronous resize, then constrain and lock the new size.
    window.setResizable(true);
    window.setMinimumSize(0, 0);
    window.setMaximumSize(0, 0);
    window.setContentSize(size, size);
    window.setMinimumSize(size, size);
    window.setMaximumSize(size, size);
    window.setResizable(false);
  };
  const disposeWindow = () => {
    const window = overlay;
    if (!window || window.isDestroyed()) return;
    lastPosition = window.getPosition();
    // Retire the native widget and its mouse capture state, instead of
    // reusing a hidden transparent Windows surface on the next open.
    overlay = null;
    moveOrigin = null;
    window.destroy();
  };
  const input = new ControllerInputManager({ controller, broadcast: value => {
    state = { ...state, ...value };
    // Escape and disconnect also change visibility directly in the input
    // manager. Retire the widget before waiting for serial cleanup.
    if (!state.visible && overlay && !overlay.isDestroyed()) {
      disposeWindow();
    }
    broadcast();
  } });
  const broadcast = () => {
    for (const window of getWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('controller-overlay:state', state);
  };
  input.on('error', error => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('controller-overlay:error', { message: error.message });
  });
  input.on('input', event => {
    for (const window of getWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('controller-overlay:input', event);
  });
  input.on('disconnected', () => {
    disposeWindow();
    state = { ...state, visible: false, active: false, mode: 'off' };
    broadcast();
  });

  const ensureWindow = () => {
    if (overlay && !overlay.isDestroyed()) return overlay;
    const size = Math.round(100 * state.scale);
    const window = new BrowserWindow({
      width: size, height: size,
      show: false, frame: false, transparent: true, resizable: false,
      movable: true, focusable: false, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
      alwaysOnTop: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    overlay = window;
    resizeWindow(window, size);
    window.setAlwaysOnTop(true, 'floating');
    window.on('unresponsive', () => { if (overlay === window) void input.hide(); });
    window.webContents.on('render-process-gone', () => {
      // Destroy first: the closed handler stops input and broadcasts only to
      // surviving windows, never to the crashed renderer's disposed frame.
      if (overlay === window && !window.isDestroyed()) window.destroy();
    });
    window.on('closed', () => {
      if (overlay !== window) return;
      overlay = null;
      state = { ...state, visible: false, active: false, mode: 'off' };
      void input.hide(); broadcast();
    });
    void loadWindow(window, { window: 'controller-overlay' }).catch(error => {
      // Closing while navigation is still loading is expected. Only report
      // failures of the window that is still current.
      if (overlay !== window || window.isDestroyed()) return;
      input.emit('error', error);
      void input.hide();
    });
    return window;
  };
  const show = async () => {
    if (mappingRestore) return state;
    const window = ensureWindow();
    await input.show();
    state = input.getState();
    if (overlay !== window || window.isDestroyed()) return state;
    if (!state.visible) {
      disposeWindow();
      broadcast();
      return state;
    }
    window.showInactive();
    resizeWindow(window, Math.round(100 * state.scale));
    const position = lastPosition || window.getPosition();
    positionWindow(position[0], position[1]);
    window.setAlwaysOnTop(true, 'floating');
    broadcast();
    return state;
  };
  const hide = async () => {
    await input.hide();
    // A new show may have completed while the old reset was pending. The
    // input manager publishes the authoritative state synchronously above.
    return state;
  };
  const toggle = async () => {
    if (mappingRestore) return state;
    if (state.visible) return hide();
    const window = ensureWindow();
    await input.toggle();
    state = input.getState();
    if (overlay !== window || window.isDestroyed()) return state;
    if (!state.visible) { disposeWindow(); broadcast(); return state; }
    window.showInactive();
    resizeWindow(window, Math.round(100 * state.scale));
    const position = lastPosition || window.getPosition();
    positionWindow(position[0], position[1]);
    window.setAlwaysOnTop(true, 'floating');
    broadcast();
    return state;
  };
  const toggleActive = async () => {
    if (mappingRestore) return state;
    if (!state.visible) return show();
    await input.toggleActive();
    state = input.getState();
    broadcast();
    return state;
  };
  const setActive = async active => {
    if (mappingRestore) return state;
    await input.setActive(Boolean(active), !active && state.visible === false); state = input.getState(); broadcast(); return state;
  };
  const suspendForMapping = async () => {
    if (mappingRestore) return state;
    mappingRestore = input.getState();
    try { await input.suspend(); return input.getState(); }
    catch (error) { mappingRestore = null; throw error; }
  };
  const resumeAfterMapping = async () => {
    const previous = mappingRestore;
    mappingRestore = null;
    if (!previous) return state;
    if (!previous.visible || !input.connected || !state.visible) {
      if (!previous.visible) await input.hide();
      return input.getState();
    }
    if (previous.active && !input.locked) await input.setActive(true);
    else {
      // Restore the standby hook (Escape only), never enable mapped keys.
      await input.ensureChild();
      input.sendChild({ command: 'enabled', value: false });
      input.setState({ active: false, mode: 'standby' });
    }
    return input.getState();
  };
  const resetPosition = () => {
    if (!overlay || overlay.isDestroyed()) return;
    moveOrigin = null;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const size = Math.round(100 * state.scale);
    positionWindow(Math.round(area.x + area.width / 2 - size / 2), Math.round(area.y + area.height / 2 - size / 2));
  };
  const setScale = value => {
    const scale = Math.min(2, Math.max(0.8, Number(value) || 1));
    input.setState({ scale });
    if (overlay && !overlay.isDestroyed()) {
      resizeWindow(overlay, Math.round(100 * scale));
      const position = overlay.getPosition();
      positionWindow(position[0], position[1]);
    }
    broadcast();
    return state;
  };
  const positionWindow = (x, y) => {
    if (!overlay || overlay.isDestroyed()) return;
    const size = Math.round(100 * state.scale);
    // setPosition round-trips the existing native bounds. On Windows with
    // fractional DPI that can grow the window by a pixel on every move.
    // Always supply the configured size, constrained in both directions.
    overlay.setBounds({ x, y, width: size, height: size });
  };
  const moveBy = (dx, dy, dragId) => {
    if (!overlay || overlay.isDestroyed() || !state.visible) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const position = overlay.getPosition();
    if (dragId && moveOrigin?.id !== dragId) moveOrigin = { id: dragId, position };
    const origin = dragId ? moveOrigin.position : position;
    // Each drag sends total displacement from its start, avoiding accumulated
    // rounding and backlogs of relative moves at fractional Windows scaling.
    positionWindow(Math.round(origin[0] + dx), Math.round(origin[1] + dy));
  };
  const validSender = event => getWindows().some(window => window && !window.isDestroyed() && window.webContents === event.sender);
  const handle = (name, action) => ipcMain.handle(name, (event, args) => { if (!validSender(event)) throw new Error('Unknown controller overlay sender'); return action(args); });
  handle('controller-overlay:state', () => input.getState());
  handle('controller-overlay:show', show);
  handle('controller-overlay:hide', hide);
  handle('controller-overlay:toggle', toggle);
  handle('controller-overlay:toggle-active', toggleActive);
  handle('controller-overlay:set-active', args => setActive(Boolean(args?.active)));
  handle('controller-overlay:suspend', suspendForMapping);
  handle('controller-overlay:resume', resumeAfterMapping);
  handle('controller-overlay:set-mapping', args => { input.setMapping(args?.mapping || {}); return input.getState(); });
  handle('controller-overlay:reset-position', resetPosition);
  handle('controller-overlay:move-by', args => moveBy(args?.dx, args?.dy, args?.dragId));
  handle('controller-overlay:set-scale', args => setScale(args?.scale));
  handle('controller-overlay:input-state', () => input.getState());

  return {
    input,
    getState: () => state,
    show,
    hide,
    toggle,
    toggleActive,
    setMapping: mapping => input.setMapping(mapping),
    suspend: () => input.suspend(),
    close: async () => { await input.close(); disposeWindow(); state = { visible: false, active: false, mode: 'off', scale: state.scale }; broadcast(); },
    handleScriptState: stateValue => {
      if (stateValue?.running || stateValue?.owned) void input.setActive(false);
    },
  };
}

module.exports = { registerControllerOverlay };
