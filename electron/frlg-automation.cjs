const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { captureTaskImage } = require('./notification-image.cjs');

const isDiagnosticStageLog = message => {
  const text = String(message).trim();
  return text.startsWith('FRLG_STAGE|BEGIN|')
    || text.startsWith('FRLG_STAGE|END|')
    || text.startsWith('FRLG_STAGE|PROGRESS|')
    || text.startsWith('FRLG_STAGE|THRESHOLD|')
    || /^阶段(?:开始|完成)：/.test(text);
};

// FRLG owns its lifecycle and calibration. Hardware, interpreter, OCR and notifications are shared.
function registerFrlgAutomation({ ipcMain, getMainWindow, devices, client, userData,
  log = () => {}, notifications, store, captureImage, encodeNotificationImage, readFile = fs.readFile, makeDirectory = fs.mkdir }) {
  let active = null, lastDone = Promise.resolve(), closed = false;
  let state = { status: 'idle', runId: null, profileId: null, message: '等待开始', progress: null, logs: [], logEntries: [], bingo: null };
  let uiLogs = [], uiEntries = [], ecsUiTimer = null;
  const update = patch => {
    state = { ...state, ...patch };
    const contents = getMainWindow()?.webContents;
    if (contents && !contents.isDestroyed?.()) contents.send('frlg-automation:state', state);
  };
  const flushUiLogs = () => {
    if (ecsUiTimer) { clearTimeout(ecsUiTimer); ecsUiTimer = null; }
    update({ logs: uiLogs, logEntries: uiEntries });
  };
  const record = (run, message, level = 'info', metadata = {}) => {
    const source = metadata.source || '火叶';
    const text = String(message);
    const detailOnly = metadata.detailOnly === true || isDiagnosticStageLog(text);
    const { source: ignored, detailOnly: ignoredDetailOnly, ...context } = metadata;
    if (detailOnly) context.detailOnly = true;
    log(text, source, level, { runId: run.id, ...(Number.isInteger(run.round) ? { round: run.round } : {}), ...context });
    const entry = {
      id: randomUUID(), time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      source, level, message: text, ...(context.phase ? { phase: context.phase } : {}),
      ...(Number.isInteger(context.line) ? { line: context.line } : {}),
      ...(detailOnly ? { detailOnly: true } : {}),
    };
    uiLogs = [...uiLogs.slice(-199), text];
    uiEntries = [...uiEntries.slice(-199), entry];
    if (source === 'ECS') {
      if (!ecsUiTimer) ecsUiTimer = setTimeout(flushUiLogs, 80);
    } else flushUiLogs();
  };
  const beginStoredRun = run => {
    if (!store?.beginRun) return;
    store.beginRun(run.id, 'frlg', { game: 'frlg', profileId: run.profileId, target: run.request.pokemon,
      request: run.request, options: run.options });
  };
  const finishStoredRun = (run, status, message) => {
    if (run.storeFinished || !store?.finishRun) return;
    run.storeFinished = true;
    store.finishRun(run.id, status, message);
  };
  const checkStopped = run => { if (closed || run.stopped || active !== run) throw Error('火叶流程已停止'); };
  const captureNotificationImage = (run, outcome, round = run.round) => captureTaskImage({
    notifications, outcome, getVideo: () => devices.getState().video, captureImage, encodeImage: encodeNotificationImage,
    onError: message => log(message, 'QQ通知', 'warning', { runId: run.id, round }),
  });
  const rememberShiny = (run, number, data) => {
    if (data?.shiny !== true) return;
    const previous = run.shiny?.round === number ? run.shiny : null;
    const result = data.result === '目标出闪' ? '目标出闪'
      : data.result === '非目标出闪' ? '非目标出闪' : previous?.result || '发现闪光';
    const captureOutcome = ['completed', 'failed', 'stopped'].find(outcome => notifications?.wantsTaskImage?.(outcome));
    run.shiny = { ...previous, round: number, result,
      ...(Number.isInteger(data.observedDex) && { observedDex: data.observedDex }),
      // Start on the confirmed observation, before recording/capture scripts move the game on.
      image: previous?.image || (captureOutcome ? captureNotificationImage(run, captureOutcome, number) : undefined),
    };
  };
  const shinyDetail = run => run.shiny ? `第 ${run.shiny.round} 轮${run.shiny.result}`
    + (run.shiny.observedDex ? `（图鉴编号 ${run.shiny.observedDex}）` : '') + '；请在游戏中确认捕获情况。' : '';
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
      run.targetSpeciesId = generated.targetSpeciesId;
      try {
        const manifest = JSON.parse(await readFile(generated.manifest, 'utf8'));
        store?.diagnostic?.(run.id, { event: 'frlg.plan', main: generated.main, manifestPath: generated.manifest, manifest });
      } catch (error) {
        store?.diagnostic?.(run.id, { event: 'frlg.plan-unavailable', manifestPath: generated.manifest, message: error.message });
      }
      const relative = path.relative(root, generated.main).split(path.sep).join('/');
      const text = await readFile(generated.main, 'utf8'); checkStopped(run);
      const validation = await devices.runner.validate({ text, path: relative }); checkStopped(run);
      if (!validation.valid) throw Error(validation.diagnostic?.message || '火叶脚本预检失败');
      const device = devices.getState();
      if (device.controller?.status !== 'connected') throw Error('请先连接伊机控');
      if (device.video?.status !== 'connected') throw Error('请先连接视频源');
      record(run, '脚本已生成并通过语法检查；启动 ECS 执行器进行标签、OCR 与视频帧预检。', 'info', { phase: '脚本预检' });
      let scriptId, resolveScript;
      const early = [], logLines = [];
      const completion = new Promise(resolve => { resolveScript = resolve; });
      const dispatch = message => {
        if (message.runId !== scriptId) return;
        if (message.event === 'script.diagnostic' || message.event === 'script.image-result') {
          const { runId: ignored, ...data } = message;
          if (message.event === 'script.image-result') {
            const key = JSON.stringify([message.labelName, message.scriptValue, message.location, message.rangeRect]);
            const previous = run.imageLog?.get(message.labelName);
            const now = Date.now();
            if (previous?.key === key && now - previous.time < 1000) return;
            (run.imageLog ||= new Map()).set(message.labelName, { key, time: now });
          }
          store?.diagnostic?.(run.id, { ...data, scriptId, round: run.round });
        }
        if (message.event === 'script.round' && Number.isInteger(message.number) && message.number >= 0) {
          run.round = message.number;
          const data = message.data;
          if (data?.targetHit === true) run.targetEvidence = 'full_target_hit';
          else if (data?.shiny === true && data.result === '目标出闪' && data.observedDex === run.targetSpeciesId
              && !run.targetEvidence) run.targetEvidence = 'target_shiny';
          rememberShiny(run, message.number, message.data);
          store?.history?.(run.id, 'frlg_round', [{ number: message.number, data: message.data }]);
          log(`第 ${message.number} 轮结构化记录`, '火叶', 'info', {
            runId: run.id, round: message.number, event: 'frlg.round', detailOnly: true,
            ...(message.data ? { data: message.data } : {}),
          });
        }
        if (message.event === 'script.log') {
          record(run, message.message, 'info', {
            source: 'ECS', phase: run.phase || 'ECS 输出', line: state.progress?.line,
            event: 'script.log', scriptId, detailOnly: isDiagnosticStageLog(message.message),
          });
          if (String(message.message).includes('PRECALIBRATION_UPDATE|')) logLines.push(String(message.message));
        }
        if (message.event === 'script.bingo') {
          store?.diagnostic?.(run.id, { event: 'script.bingo', round: run.round, state: message.state });
          update({ bingo: message.state || null });
        }
        if (message.event === 'script.progress') {
          run.phase = message.action || message.source || 'ECS 执行';
          update({ progress: message });
        }
        if (message.event === 'script.started') {
          run.round = 0;
          store?.history?.(run.id, 'frlg_round', [{ number: 0 }]);
          run.phase = 'ECS 执行';
          update({ status: 'running', message: '正在执行火叶自动流程' });
          record(run, '火叶自动流程已开始执行。', 'info', { phase: '执行', event: 'script.started' });
        }
        if (message.event === 'script.done') {
          if (message.status === 'failed') record(run, `火叶自动流程执行失败：${message.message || '请查看详细日志。'}`, 'error', { phase: '执行', event: 'script.done' });
          else if (message.status === 'completed') record(run, '火叶自动流程执行完成。', 'success', { phase: '执行', event: 'script.done' });
          resolveScript(message);
        }
      };
      listener = message => { if (!scriptId) early.push(message); else dispatch(message); };
      devices.events.on('script', listener);
      ({ runId: scriptId } = await devices.runner.start({ text, path: relative, shouldStop: () => run.stopped || closed,
        audioDiagnostic: true, diagnostics: true }));
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
        const calibration = await client.call('finalize', { calibrationStore, manifest: generated.manifest, log: logLines.join('\n') });
        calibrationUpdated = calibration.calibrationUpdated;
        const message = calibrationUpdated
          ? calibration.record?.evidence?.kind === 'target_shiny'
            ? '当前存档的预校准已更新（来自目标出闪时的执行修正）。' : '当前存档的预校准已更新。'
          : '没有目标出闪或完整命中记录，预校准未更新。';
        record(run, message, calibrationUpdated ? 'success' : 'warning', { phase: '预校准' });
      }
      const message = shinyDetail(run) || '流程已结束；请核对日志中的实际捕获结果。';
      run.finalStatus = 'completed'; run.finalMessage = message;
      checkStopped(run);
      const dexCompletion = run.options.auto_complete_pokedex === true && run.targetEvidence
        && Number.isInteger(run.targetSpeciesId) && run.targetSpeciesId >= 1 && run.targetSpeciesId <= 386
        ? { speciesId: run.targetSpeciesId, evidence: run.targetEvidence } : null;
      finishStoredRun(run, 'completed', message);
      record(run, message, 'success', { phase: '完成' });
      if (dexCompletion) record(run, `已确认目标，自动标记本次存档的图鉴 #${dexCompletion.speciesId} 为已完成。`, 'success', { phase: '图鉴' });
      update({ status: 'completed', message, calibrationUpdated, dexCompletion });
    } catch (error) {
      const stopped = run.stopped || closed;
      const message = stopped ? '火叶流程已停止' : String(error.message || error);
      run.finalStatus = stopped ? 'stopped' : 'failed'; run.finalMessage = message;
      update({ status: stopped ? 'stopped' : 'failed', message });
      finishStoredRun(run, stopped ? 'stopped' : 'failed', message);
      record(run, message, stopped ? 'info' : 'error', { phase: stopped ? '停止' : '失败' });
      run.reject(error);
    } finally {
      if (listener) devices.events.off('script', listener);
      if (claimed) devices.releaseAutomation(run.id);
      if (active === run) active = null;
      // Delivery must not delay stop/close after controller release.
      const outcome = run.finalStatus;
      const detail = run.finalMessage + (outcome !== 'completed' && run.shiny ? '；' + shinyDetail(run) : '');
      // Retain this run's bytes while the queue waits; never capture a later task's screen.
      const image = notifications?.wantsTaskImage?.(outcome)
        ? run.shiny?.image || captureNotificationImage(run, outcome) : Promise.resolve(undefined);
      Promise.resolve(image).then(image => notifications?.notifyTask(run.id, '火叶自动乱数', outcome, {
        target: run.request.pokemon, detail, ...(image && { image }),
        ...(outcome === 'completed' && run.shiny && { result: run.shiny.result }),
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
    beginStoredRun(run);
    uiLogs = []; uiEntries = [];
    update({ status: 'preparing', runId: run.id, profileId: run.profileId, message: '正在生成并预检火叶脚本', logs: [], logEntries: [], progress: null, bingo: null, calibrationUpdated: false, dexCompletion: null });
    record(run, '正在生成并预检火叶脚本。', 'info', { phase: '准备' });
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
