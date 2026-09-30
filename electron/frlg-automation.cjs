const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

// FRLG owns its lifecycle and calibration. Hardware, interpreter, OCR and notifications are shared.
function registerFrlgAutomation({ ipcMain, getMainWindow, devices, client, userData,
  log = () => {}, notifications, readFile = fs.readFile, makeDirectory = fs.mkdir }) {
  let active = null, lastDone = Promise.resolve(), closed = false;
  let state = { status: 'idle', runId: null, profileId: null, message: '等待开始', progress: null, logs: [] };
  const update = patch => {
    state = { ...state, ...patch };
    const contents = getMainWindow()?.webContents;
    if (contents && !contents.isDestroyed?.()) contents.send('frlg-automation:state', state);
  };
  const record = (run, message, level = 'info') => {
    log(message, '火叶', level, { runId: run.id });
    update({ logs: [...state.logs.slice(-199), String(message)] });
  };
  const checkStopped = run => { if (closed || run.stopped || active !== run) throw Error('火叶流程已停止'); };
  const execute = async run => {
    let claimed = false, listener;
    try {
      await devices.claimAutomation(run.id); claimed = true; checkStopped(run);
      const configuredRoot = devices.runner.rootDirectory;
      const root = path.resolve(typeof configuredRoot === 'function' ? configuredRoot() : configuredRoot);
      const output = path.join(root, '.frlg-runs', run.id);
      const calibrationStore = path.join(userData, 'frlg', 'profiles', run.profileId, 'precalibration.json');
      await makeDirectory(path.dirname(output), { recursive: true }); checkStopped(run);
      const generated = await client.call('prepare', {
        request: run.request, options: run.options, source: path.join(root, '火红叶绿', '自动流程'), output, calibrationStore,
      });
      checkStopped(run);
      const relative = path.relative(root, generated.main).split(path.sep).join('/');
      const text = await readFile(generated.main, 'utf8'); checkStopped(run);
      const validation = await devices.runner.validate({ text, path: relative }); checkStopped(run);
      if (!validation.valid) throw Error(validation.diagnostic?.message || '火叶脚本预检失败');
      const device = devices.getState();
      if (device.controller?.status !== 'connected') throw Error('请先连接伊机控');
      if (device.video?.status !== 'connected') throw Error('请先连接视频源');
      record(run, '脚本已生成并通过语法检查；启动公共执行器进行标签、OCR 与视频帧预检。');
      let scriptId, resolveScript;
      const early = [], logLines = [];
      const completion = new Promise(resolve => { resolveScript = resolve; });
      const dispatch = message => {
        if (message.runId !== scriptId) return;
        if (message.event === 'script.log') {
          record(run, message.message);
          // Only success markers are needed for persistence; full logs use the shared log store.
          if (String(message.message).includes('PRECALIBRATION_UPDATE|')) logLines.push(String(message.message));
        }
        if (message.event === 'script.progress') update({ progress: message });
        if (message.event === 'script.started') update({ status: 'running', message: '正在执行火叶自动流程' });
        if (message.event === 'script.done') resolveScript(message);
      };
      listener = message => { if (!scriptId) early.push(message); else dispatch(message); };
      devices.events.on('script', listener);
      ({ runId: scriptId } = await devices.runner.start({ text, path: relative, shouldStop: () => run.stopped || closed }));
      run.scriptId = scriptId;
      for (const message of early) dispatch(message);
      if (run.stopped || closed) await devices.runner.stop();
      run.accept();
      const result = await completion;
      if (result.status === 'failed') throw Error(result.message || '火叶脚本执行失败，请查看日志');
      checkStopped(run);
      if (result.status !== 'completed') throw Error('火叶脚本意外停止');
      let calibrationUpdated = false;
      if (run.options.update_precalibration) {
        ({ calibrationUpdated } = await client.call('finalize', { calibrationStore, manifest: generated.manifest, log: logLines.join('\n') }));
        record(run, calibrationUpdated ? '当前存档的预校准已更新。' : '没有完整命中记录，预校准未更新。');
      }
      update({ status: 'completed', message: '流程已结束；请核对日志中的实际捕获结果。', calibrationUpdated });
    } catch (error) {
      const stopped = run.stopped || closed;
      update({ status: stopped ? 'stopped' : 'failed', message: stopped ? '火叶流程已停止' : String(error.message || error) });
      record(run, state.message, stopped ? 'info' : 'error');
      run.reject(error);
    } finally {
      if (listener) devices.events.off('script', listener);
      if (claimed) devices.releaseAutomation(run.id);
      if (active === run) active = null;
      // Delivery must not delay stop/close after controller release.
      const outcome = state.status, detail = state.message;
      Promise.resolve().then(() => notifications?.notifyTask(run.id, '火叶自动乱数', outcome, {
        target: run.request.pokemon, detail,
      })).catch(error => log('QQ 通知失败：' + error.message, 'QQ通知', 'warning', { runId: run.id }));
    }
  };
  const start = args => {
    if (closed) throw Error('程序正在关闭');
    if (active) throw Error('火叶流程正在运行');
    if (!args?.request || typeof args.request !== 'object') throw Error('请先搜索火叶方案');
    if (typeof args.profileId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(args.profileId)) throw Error('请先选择火叶存档');
    const run = { id: randomUUID(), request: args.request, profileId: args.profileId, options: args.options || {}, stopped: false };
    active = run;
    const accepted = new Promise((resolve, reject) => { run.accept = resolve; run.reject = reject; });
    update({ status: 'preparing', runId: run.id, profileId: run.profileId, message: '正在生成并预检火叶脚本', logs: [], progress: null, calibrationUpdated: false });
    lastDone = run.done = execute(run);
    return accepted.then(() => state);
  };
  const stop = async (reason = '') => {
    const run = active;
    if (!run) return state;
    run.stopped = true;
    update({ status: 'stopping', message: reason || '正在停止火叶流程' });
    if (run.scriptId) await devices.runner.stop();
    else client.close();
    await run.done;
    return state;
  };
  for (const [name, action] of Object.entries({ state: () => state, start, stop: () => stop() })) {
    ipcMain.handle('frlg-automation:' + name, (event, args) => {
      if (!event.sender || event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw Error('Unknown FRLG automation sender');
      return action(args);
    });
  }
  const emergencyStop = () => { void stop('已请求停止手柄输入'); };
  devices.events.on('stop-automation', emergencyStop);
  return { start, stop, isBusy: () => !!active, settled: () => lastDone, close: async () => { closed = true; await stop(); devices.events.off('stop-automation', emergencyStop); } };
}
module.exports = { registerFrlgAutomation };
