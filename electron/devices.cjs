const { RuntimeClient } = require('./runtime-client.cjs');
const { OcrClient } = require('./ocr-client.cjs');
const { ScriptRunner, addSequenceApi } = require('./script-runner.cjs');
const { registerControllerOverlay } = require('./controller-overlay.cjs');
const path = require('node:path');

function registerDevices({ ipcMain, getWindows, loadWindow, rootDirectory = path.join(__dirname, '..', 'scripts'), testMode = false }) {
  const video = new RuntimeClient({ role: 'video', testMode });
  const ocr = new OcrClient();
  const controller = addSequenceApi(new RuntimeClient({ role: 'controller', testMode }));
  const openWindow = loadWindow || ((window, query) => window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query }));
  const controllerOverlay = registerControllerOverlay({ controller, getMainWindow: () => getWindows().find(window => !window.isDestroyed()), getWindows, loadWindow: openWindow });
  let state = { video: { status: 'idle' }, controller: { status: 'idle' } };
  let snapshot = null;
  let connectTimer, frameTimer, healthBusy = false, closing = false, videoConnectInFlight = null;
  const broadcast = () => {
    for (const window of getWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('devices:state', state);
  };
  const scriptEvent = message => {
    for (const window of getWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('devices:event', message);
  };
  const runner = new ScriptRunner({ controller, rootDirectory, getVideo: () => state.video, emit: scriptEvent });
  let controllerTimer;
  controller.on('offline', error => {
    clearInterval(controllerTimer);
    if (!closing) { state = { ...state, controller: { status: 'failed', message: error.message } }; broadcast(); }
  });
  controller.on('event', message => {
    if (message.event === 'controller.state') {
      state = { ...state, controller: message.state }; broadcast();
      controllerOverlay.handleScriptState(message.state);
      if (message.state.status !== 'connected') clearInterval(controllerTimer);
    }
  });
  const updateVideo = value => { state = { ...state, video: value }; broadcast(); runner.handleVideoState(value); };
  const requireWindow = event => {
    if (!getWindows().some(window => !window.isDestroyed() && window.webContents === event.sender)
      || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown device sender');
  };
  const clearVideoTimers = () => { clearTimeout(connectTimer); clearInterval(frameTimer); frameTimer = null; };
  video.on('offline', error => { clearVideoTimers(); if (!closing) updateVideo({ status: 'failed', message: error.message }); });
  video.on('event', message => {
    if (message.event !== 'video.state') return;
    updateVideo(message.state);
    if (message.state.status !== 'connecting') clearVideoTimers();
    if (message.state.status === 'connected') {
      let sequence = '', lastChanged = Date.now();
      const session = message.state.session;
      frameTimer = setInterval(async () => {
        if (healthBusy || state.video.session !== session) return;
        healthBusy = true;
        try {
          const response = await fetch(`${state.video.baseUrl}/frame?session=${encodeURIComponent(session)}`, { method: 'HEAD', headers: { Authorization: 'Bearer ' + state.video.token }, signal: AbortSignal.timeout(2000) });
          if (state.video.session !== session) return;
          const current = response.headers.get('x-frame-sequence');
          if (response.ok && current && current !== sequence) { sequence = current; lastChanged = Date.now(); }
          if (Date.now() - lastChanged > 3500) throw new Error('采集卡不再提供新画面，请检查连接后重新连接。');
        } catch (error) {
          if (state.video.session === session) { updateVideo({ status: 'failed', message: error.message }); video.terminate(); }
        } finally { healthBusy = false; }
      }, 1000);
    }
  });
  const handle = (name, action) => ipcMain.handle(name, (event, args) => { requireWindow(event); return action(args); });
  handle('devices:state', () => state);
  handle('controller:list', () => controller.call('controller.list'));
  handle('controller:connect', async args => {
    await controller.call('controller.connect', args, 6000);
    clearInterval(controllerTimer);
    controllerTimer = setInterval(() => { void controller.call('controller.status').catch(() => {}); }, 1500);
  });
  handle('controller:disconnect', async () => {
    await runner.stop(); clearInterval(controllerTimer);
    if (controller.child) await controller.call('controller.disconnect');
  });
  handle('controller:key', args => controller.call('controller.key', args));
  handle('controller:stick', args => controller.call('controller.stick', args));
  handle('controller:press', args => {
    if (!args || typeof args.key !== 'string') throw new Error('按键无效。');
    return controller.sequence({ actions: [{ kind: 'button', key: args.key, down: true }, { kind: 'wait', duration_ms: 80 }, { kind: 'button', key: args.key, down: false }] });
  });
  handle('controller:reset', () => controller.call('controller.reset'));
  handle('controller:stop', async () => { await runner.stop(); if (controller.child) await controller.call('controller.stop'); });
  handle('execution:start', args => runner.start(args));
  handle('execution:validate', args => runner.validate(args));
  handle('execution:stop', () => runner.stop());
  handle('video:list', args => video.call('video.list', args, 15000));
  handle('video:connect', async args => {
    if (videoConnectInFlight) {
      const error = Object.assign(new Error('视频源正在连接，请稍候。'), { code: 'BUSY' });
      throw error;
    }
    if (state.video.status === 'connected') {
      const error = Object.assign(new Error('视频源已经连接，请先断开当前视频源。'), { code: 'BUSY' });
      throw error;
    }
    if (state.video.status === 'connecting') {
      const error = Object.assign(new Error('视频源正在连接，请稍候。'), { code: 'BUSY' });
      throw error;
    }
    clearVideoTimers();
    videoConnectInFlight = (async () => {
      try {
        await video.call('video.start', args, 5000);
        if (state.video.status === 'connecting') connectTimer = setTimeout(() => {
          updateVideo({ status: 'failed', message: '打开采集卡超时，请尝试另一个采集后端。' }); video.terminate();
        }, 20000);
      } catch (error) {
        // A late start failure must never overwrite a healthy session that
        // became active while the request was completing.
        if (state.video.status !== 'connected') updateVideo({ status: 'failed', message: error.message });
        throw error;
      } finally {
        videoConnectInFlight = null;
      }
    })();
    return videoConnectInFlight;
  });
  handle('video:disconnect', async () => {
    clearVideoTimers();
    if (video.child) await video.call('video.stop', {}, 3000);
    updateVideo({ status: 'idle' });
  });
  handle('video:get-snapshot', () => snapshot);
  handle('video:ocr', args => ocr.read(args?.imageBase64, args?.language || ''));
  handle('video:snapshot', async () => {
    const source = state.video;
    if (source.status !== 'connected') throw new Error('请先连接视频源。');
    const response = await fetch(`${source.baseUrl}/snapshot.png?session=${encodeURIComponent(source.session)}`, {
      headers: { Authorization: 'Bearer ' + source.token }, signal: AbortSignal.timeout(4000),
    });
    if (response.status !== 200) throw new Error('截图失败，视频源可能已断开。');
    const bytes = Buffer.from(await response.arrayBuffer());
    snapshot = { url: 'data:image/png;base64,' + bytes.toString('base64'), session: response.headers.get('x-frame-session'),
      sequence: response.headers.get('x-frame-sequence'), width: Number(response.headers.get('x-frame-width')), height: Number(response.headers.get('x-frame-height')) };
    for (const window of getWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('video:snapshot-updated', snapshot);
    return snapshot;
  });
  return {
    stopInputs: async () => { await runner.stop(); await controllerOverlay.suspend(); if (controller.child) await controller.call('controller.stop'); },
    controllerOverlay,
    close: async () => { closing = true; clearVideoTimers(); clearInterval(controllerTimer); ++runner.validationVersion; runner.cancelValidation?.(); await runner.stop().catch(() => {}); await controllerOverlay.close(); await Promise.allSettled([video.close(), controller.close(), ocr.close()]); },
    getState: () => state,
  };
}
module.exports = { registerDevices };
