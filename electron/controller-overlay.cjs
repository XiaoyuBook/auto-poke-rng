const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { ControllerInputManager } = require('./controller-input.cjs');

function registerControllerOverlay({ getMainWindow, getWindows, loadWindow, controller }) {
  let overlay = null;
  let state = { visible: false, active: false, mode: 'off', scale: 1 };
  const input = new ControllerInputManager({ controller, broadcast: value => { state = { ...state, ...value }; broadcast(); } });
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

  const ensureWindow = () => {
    if (overlay && !overlay.isDestroyed()) return overlay;
    overlay = new BrowserWindow({
      width: 100, height: 100, show: false, frame: false, transparent: true, resizable: false,
      movable: true, focusable: false, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
      alwaysOnTop: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    overlay.setAlwaysOnTop(true, 'floating');
    overlay.on('closed', () => { overlay = null; state = { ...state, visible: false, active: false, mode: 'off' }; void input.hide(); broadcast(); });
    void loadWindow(overlay, { window: 'controller-overlay' });
    return overlay;
  };
  const show = async () => {
    const window = ensureWindow();
    state = { ...state, visible: true, mode: state.active ? 'active' : 'standby' };
    window.showInactive();
    window.setAlwaysOnTop(true, 'floating');
    await input.show();
    broadcast();
    return state;
  };
  const hide = async () => {
    await input.hide();
    if (overlay && !overlay.isDestroyed()) overlay.hide();
    state = { ...state, visible: false, active: false, mode: 'off' };
    broadcast();
    return state;
  };
  const toggle = async () => {
    if (state.visible) return hide();
    const window = ensureWindow();
    window.showInactive();
    window.setAlwaysOnTop(true, 'floating');
    await input.toggle();
    state = input.getState();
    broadcast();
    return state;
  };
  const toggleActive = async () => {
    if (!state.visible) return show();
    await input.toggleActive();
    state = input.getState();
    broadcast();
    return state;
  };
  const setActive = async active => { await input.setActive(Boolean(active), !active && state.visible === false); state = input.getState(); broadcast(); return state; };
  const resetPosition = () => {
    if (!overlay || overlay.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    overlay.setPosition(Math.round(area.x + area.width / 2 - overlay.getBounds().width / 2), Math.round(area.y + area.height / 2 - overlay.getBounds().height / 2));
  };
  const setScale = value => {
    const scale = Math.min(2, Math.max(0.8, Number(value) || 1));
    state = { ...state, scale };
    if (overlay && !overlay.isDestroyed()) overlay.setSize(Math.round(100 * scale), Math.round(100 * scale));
    broadcast();
    return state;
  };
  const moveBy = (dx, dy) => { if (overlay && !overlay.isDestroyed()) { const position = overlay.getPosition(); overlay.setPosition(position[0] + Number(dx || 0), position[1] + Number(dy || 0)); } };
  const validSender = event => getWindows().some(window => window && !window.isDestroyed() && window.webContents === event.sender);
  const handle = (name, action) => ipcMain.handle(name, (event, args) => { if (!validSender(event)) throw new Error('Unknown controller overlay sender'); return action(args); });
  handle('controller-overlay:state', () => input.getState());
  handle('controller-overlay:show', show);
  handle('controller-overlay:hide', hide);
  handle('controller-overlay:toggle', toggle);
  handle('controller-overlay:toggle-active', toggleActive);
  handle('controller-overlay:set-active', args => setActive(Boolean(args?.active)));
  handle('controller-overlay:suspend', async () => { await input.suspend(); state = input.getState(); broadcast(); return state; });
  handle('controller-overlay:set-mapping', args => { input.setMapping(args?.mapping || {}); return input.getState(); });
  handle('controller-overlay:reset-position', resetPosition);
  handle('controller-overlay:move-by', args => moveBy(args?.dx, args?.dy));
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
    close: async () => { await input.close(); if (overlay && !overlay.isDestroyed()) overlay.close(); overlay = null; state = { visible: false, active: false, mode: 'off', scale: state.scale }; broadcast(); },
    handleScriptState: stateValue => {
      if (stateValue?.running || stateValue?.owned) void input.setActive(false);
    },
  };
}

module.exports = { registerControllerOverlay };
