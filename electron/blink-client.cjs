const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const busy = state => ['starting', 'preview', 'capturing', 'solving', 'tracking', 'countdown', 'timeline', 'stopping'].includes(state.status);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
function timingConfig(input) {
  const timing = { timeDelay: input.timeDelay ?? 0, advanceDelay: input.advanceDelay ?? 0, advanceDelay2: input.advanceDelay2 ?? 0,
    timelineNpc: input.timelineNpc ?? 0, pokemonNpc: input.pokemonNpc ?? 0, menuClose: input.menuClose !== false };
  if (!Number.isFinite(timing.timeDelay) || timing.timeDelay < 0 || timing.timeDelay > 999) throw Error('时间延迟必须在 0–999 秒之间。');
  if (!integer(timing.advanceDelay, 0, 9999) || !integer(timing.advanceDelay2, 0, 9999)) throw Error('两段帧数延迟必须为 0–9999 的整数。');
  if (!integer(timing.timelineNpc, -1, 999) || !integer(timing.pokemonNpc, 0, 999)) throw Error('Timeline NPC 范围为 -1–999，宝可梦 NPC 范围为 0–999。');
  return timing;
}
async function readBlinkConfig(filename, video) {
  if ((await fs.promises.stat(filename)).size > 2000000) throw Error('配置文件过大。');
  const raw = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
  const original = Array.isArray(raw.view);
  const timing = timingConfig(original ? { timeDelay: raw.white_delay, advanceDelay: raw.advance_delay, advanceDelay2: raw.advance_delay_2, timelineNpc: raw.timeline_npc, pokemonNpc: raw.pokemon_npc } : raw);
  let eye = typeof raw.eye === 'string' ? raw.eye : '';
  if (original && typeof raw.image === 'string') {
    const candidates = path.isAbsolute(raw.image) ? [raw.image] : [path.resolve(path.dirname(filename), raw.image), path.resolve(path.dirname(filename), '..', raw.image)];
    const imageFile = candidates.find(candidate => fs.existsSync(candidate));
    if (imageFile && (await fs.promises.stat(imageFile)).size <= 1000000) {
      const bytes = await fs.promises.readFile(imageFile);
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('眼睛模板需要 PNG 格式，请在视频中重新截取。');
      if (bytes.readUInt32BE(16) > 512 || bytes.readUInt32BE(20) > 512) throw Error('眼睛模板不能超过 512 × 512。');
      eye = 'data:image/png;base64,' + bytes.toString('base64');
    }
  }
  if (eye.length > 1500000 || (eye && !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(eye))) throw Error('眼睛模板格式无效。');
  const npc = raw.npc ?? 0, threshold = original ? raw.thresh ?? .9 : raw.threshold ?? .9;
  if (!integer(npc, 0, 999) || !Number.isFinite(threshold) || threshold <= .01 || threshold >= 1) throw Error('配置的 NPC 数或识别阈值无效。');
  const roi = original ? { x: raw.view[0], y: raw.view[1], width: raw.view[2], height: raw.view[3] } : raw.roi;
  const cropped = original && Array.isArray(raw.crop) && raw.crop.some(value => value !== 0);
  const sourceWidth = original ? video?.width ?? 0 : raw.sourceWidth ?? 0;
  const sourceHeight = original ? video?.height ?? 0 : raw.sourceHeight ?? 0;
  const validRoi = !cropped && roi && integer(roi.x, 0, sourceWidth - 2) && integer(roi.y, 0, sourceHeight - 2) && integer(roi.width, 2, sourceWidth - roi.x) && integer(roi.height, 2, sourceHeight - roi.y);
  return { name: path.basename(filename, path.extname(filename)).slice(0, 40), threshold, npc, ...timing,
    noisy: original ? raw.reident_1_pk_npc === true : raw.noisy === true, eye, eyeRect: null,
    roi: validRoi ? roi : null, sourceWidth, sourceHeight };
}
function validateConfig(input, video) {
  if (!video || video.status !== 'connected' || !video.sharedMemory) throw Error('请先连接视频源。');
  if (!input || !['preview', 'recover', 'reidentify', 'munchlax'].includes(input.mode)) throw Error('捕获模式无效。');
  if (input.sourceWidth !== video.width || input.sourceHeight !== video.height) throw Error('视频分辨率与配置不一致，请重新框选。');
  if (typeof input.eye !== 'string' || input.eye.length > 1500000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.eye)) throw Error('请先在视频画面框选眼睛模板。');
  const roi = input.roi;
  if (!roi || !integer(roi.x, 0, video.width - 2) || !integer(roi.y, 0, video.height - 2)
      || !integer(roi.width, 2, video.width - roi.x) || !integer(roi.height, 2, video.height - roi.y)) throw Error('ROI 无效或超出视频画面。');
  if (!Number.isFinite(input.threshold) || input.threshold <= (input.mode === 'munchlax' ? 0.4 : 0.01) || input.threshold >= 1) throw Error('匹配阈值无效（玩家大于 0.01，小卡比兽大于 0.4，且小于 1）。');
  if (!integer(input.npc, 0, 999)) throw Error('NPC 数必须为 0–999 的整数。');
  if (input.mode === 'reidentify') {
    if (!Array.isArray(input.seed) || input.seed.length !== 4 || input.seed.some(word => typeof word !== 'string' || !/^[\da-f]{1,8}$/i.test(word)) || input.seed.every(word => /^0+$/.test(word))) throw Error('S[0–3] 需要四个非全零的十六进制状态值，每项最多 8 位。');
    if (!integer(input.searchMin, 0, 999999) || !integer(input.searchMax, input.searchMin + 1, 1000000)) throw Error('搜索范围需满足 0 ≤ 起点 < 终点 ≤ 1,000,000。');
  }
  // Only trusted device state supplies the mapping. No renderer-selected path,
  // Python source, camera index or shared-memory descriptor reaches the worker.
  return { mode: input.mode, eye: input.eye, roi: { x: roi.x, y: roi.y, width: roi.width, height: roi.height },
    sourceWidth: video.width, sourceHeight: video.height, threshold: input.threshold, npc: input.npc,
    noisy: input.noisy === true, seed: input.seed, searchMin: input.searchMin, searchMax: input.searchMax, ...timingConfig(input),
    video: { sharedMemory: video.sharedMemory } };
}

function registerBlink({ ipcMain, getMainWindow, getVideo, spawnProcess = spawn, chooseConfig, isAutomationBusy = () => false }) {
  let state = { revision: 0, status: 'idle', captured: 0, target: 40, message: '在右侧视频中框选睁眼模板与 ROI。' };
  let job = null;
  let observer = null;
  const publish = update => {
    state = { ...state, ...update, revision: state.revision + 1 };
    const window = getMainWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('blink:state', state);
    return state;
  };
  const stop = async (message = '已停止', failed = false) => {
    const active = job;
    if (!active) return state;
    if (!active.stopping) {
      active.stopping = true;
      publish({ status: failed ? 'error' : 'stopping', message });
      active.child.kill();
    }
    await active.done;
    if (!failed && state.status === 'stopping') publish({ status: 'stopped', message });
    return state;
  };
  const stopObserver = () => {
    const active = observer;
    if (!active) return Promise.resolve();
    observer = null;
    active.child.kill();
    return active.done;
  };
  const requireWindow = event => {
    if (event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw Error('Unknown blink sender');
  };
  ipcMain.handle('blink:state', event => { requireWindow(event); return state; });
  ipcMain.handle('blink:stop', event => { requireWindow(event); return stop(); });
  ipcMain.handle('blink:observe', (event, input) => {
    requireWindow(event);
    void stopObserver();
    if (isAutomationBusy()) return;
    if (!input || (job && !['tracking', 'countdown', 'timeline'].includes(state.status))) return;
    const video = getVideo();
    const config = validateConfig({ ...input, mode: 'preview' }, video);
    const root = path.join(__dirname, '..');
    const bundled = path.join(root, '.deps/script-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = process.env.AUTO_POKE_PYTHON || (fs.existsSync(bundled) ? bundled : 'python');
    const child = spawnProcess(python, ['-u', path.join(root, 'runtime/python/blink_host.py')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
    let finish;
    const active = { child, done: new Promise(resolve => { finish = resolve; }) };
    observer = active;
    let buffer = '', diagnostic = '', closed = false;
    const destroyed = () => { if (observer === active) void stopObserver(); };
    event.sender.once('destroyed', destroyed);
    event.sender.once('render-process-gone', destroyed);
    const send = payload => {
      if (observer === active && !event.sender.isDestroyed()) event.sender.send('blink:observation', payload);
    };
    const health = setInterval(() => {
      const current = getVideo();
      if (current.status !== 'connected' || current.session !== video.session) void stopObserver();
    }, 200);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(health);
      event.sender.removeListener('destroyed', destroyed);
      event.sender.removeListener('render-process-gone', destroyed);
      if (observer === active) observer = null;
      finish();
    };
    child.once('error', error => { send({ error: `无法启动实时眼睛识别：${error.message}` }); cleanup(); });
    child.once('close', () => { if (observer === active) send({ error: `实时眼睛识别已停止。${diagnostic.slice(-300)}` }); cleanup(); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-1000); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      if (observer !== active) return;
      buffer += data;
      if (buffer.length > 128 * 1024) { send({ error: '实时眼睛识别响应过大。' }); void stopObserver(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let value;
        try { value = JSON.parse(line); } catch { send({ error: '实时眼睛识别响应无效。' }); void stopObserver(); return; }
        if (value.event === 'progress') send({ score: value.score, location: value.location });
        else if (value.event === 'error') { send({ error: value.message || '实时眼睛识别失败。' }); void stopObserver(); return; }
      }
    });
    child.stdin.on('error', error => { send({ error: `实时眼睛识别通信失败：${error.message}` }); void stopObserver(); });
    child.stdin.write(JSON.stringify(config) + '\n');
  });
  ipcMain.handle('blink:import-config', async event => {
    requireWindow(event);
    if (busy(state)) throw Error('请先停止当前眨眼任务。');
    const selected = chooseConfig ? await chooseConfig() : await require('electron').dialog.showOpenDialog(getMainWindow(), { title: '打开 Project_Xs 配置', filters: [{ name: 'Project_Xs 配置', extensions: ['json'] }], properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return readBlinkConfig(selected.filePaths[0], getVideo());
  });
  ipcMain.handle('blink:timeline', event => {
    requireWindow(event);
    if (!job || job.stopping || state.status !== 'tracking' || state.mode === 'munchlax') throw Error('请先完成玩家捕获或校正，保持推进后再启动 Timeline。');
    job.child.stdin.write(JSON.stringify({ command: 'timeline' }) + '\n');
    return publish({ status: 'countdown', message: 'Timeline 倒计时已启动' });
  });
  ipcMain.handle('blink:start', async (event, input) => {
    requireWindow(event);
    if (isAutomationBusy()) throw Error('请先停止自动流程再手动捕获。');
    if (job || busy(state)) throw Error('已有眨眼任务在运行，请先停止。');
    const video = getVideo();
    const config = validateConfig(input, video);
    void stopObserver();
    const root = path.join(__dirname, '..');
    const bundled = path.join(root, '.deps/script-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = process.env.AUTO_POKE_PYTHON || (fs.existsSync(bundled) ? bundled : 'python');
    const child = spawnProcess(python, ['-u', path.join(root, 'runtime/python/blink_host.py')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
    let finish;
    const active = { child, stopping: false, done: new Promise(resolve => { finish = resolve; }) };
    job = active;
    state = { revision: state.revision, status: 'starting', runId: randomUUID(), mode: config.mode,
      captured: 0, target: config.mode === 'munchlax' ? 64 : config.mode === 'reidentify' ? config.noisy ? 20 : 7 : 40,
      message: '正在启动眨眼识别…', blinks: [], intervals: [], result: state.result ?? null, score: null, tracking: null };
    publish({});
    let buffer = '', diagnostic = '', closed = false;
    const destroyed = () => { void stop(); };
    event.sender.once('destroyed', destroyed);
    event.sender.once('render-process-gone', destroyed);
    const startup = setTimeout(() => { void stop('眨眼引擎启动超时，请检查 Python 运行环境。', true); }, 20000);
    const health = setInterval(() => {
      const current = getVideo();
      if (current.status !== 'connected' || current.session !== video.session) void stop('视频源已断开或切换，本次眨眼任务已停止。', true);
    }, 200);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearTimeout(startup); clearInterval(health);
      event.sender.removeListener('destroyed', destroyed);
      event.sender.removeListener('render-process-gone', destroyed);
      if (job === active) job = null;
      finish();
    };
    const fail = message => { if (job === active && !active.stopping) void stop(message, true); };
    child.once('error', error => { if (job === active) publish({ status: 'error', message: `无法启动眨眼引擎：${error.message}` }); cleanup(); });
    child.once('close', () => {
      if (job === active && !active.stopping && !['completed', 'error'].includes(state.status)) publish({ status: 'error', message: `眨眼引擎意外退出。${diagnostic.slice(-500)}` });
      cleanup();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-2000); });
    child.stdin.on('error', error => fail(`眨眼引擎通信失败：${error.message}`));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      if (active.stopping || job !== active) return;
      buffer += data;
      if (buffer.length > 128 * 1024) { fail('眨眼引擎响应超过限制。'); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let value;
        try { value = JSON.parse(line); } catch { fail('眨眼引擎响应无效。'); return; }
        if (value.event === 'ready') {
          clearTimeout(startup);
          publish({ status: config.mode === 'preview' ? 'preview' : 'capturing', message: config.mode === 'preview' ? '预览中 · 睁眼时分数应高于阈值' : '正在捕获眨眼…' });
        } else if (value.event === 'progress') {
          const { score, location, captured, blinks, intervals, skipped } = value;
          publish({ score, location, captured, blinks, intervals, skipped });
        } else if (value.event === 'solving') publish({ status: 'solving', message: '正在计算 RNG 状态…' });
        else if (value.event === 'result') publish({ status: 'tracking', result: value.result, message: 'Seed 已恢复，正在持续推进' });
        else if (value.event === 'tracking') {
          const phase = value.tracking.phase;
          const status = phase === 'countdown' ? 'countdown' : ['timeline', 'delay'].includes(phase) ? 'timeline' : state.status === 'countdown' ? 'countdown' : 'tracking';
          const message = phase === 'delay' ? 'Timeline 时间延迟中' : phase === 'timeline' ? 'Timeline 推进中' : status === 'countdown' ? 'Timeline 倒计时中' : '正在持续推进';
          publish({ status, tracking: value.tracking, message });
        }
        else if (value.event === 'error') { fail(value.message || '眨眼识别失败。'); return; }
      }
    });
    child.stdin.write(JSON.stringify(config) + '\n');
    return state;
  });
  return { close: () => Promise.all([stop(), stopObserver()]), getState: () => state };
}
module.exports = { registerBlink, validateConfig, timingConfig, readBlinkConfig };
