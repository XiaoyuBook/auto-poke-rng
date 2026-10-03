const fs = require('node:fs');
const path = require('node:path');

const kinds = ['video', 'controller', 'audio'];
const labels = { video: '视频源', controller: '伊机控', audio: '游戏音频' };
const copy = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' && value.trim() && value.length <= 4096 ? value : undefined;
function cleanConfig(kind, value) {
  if (!value || typeof value !== 'object') return null;
  const name = text(value.name);
  if (kind === 'controller') {
    const port = text(value.port);
    return port && /^(COM[1-9]\d{0,3}|mock)$/i.test(port) ? { port, ...(name && { name }) } : null;
  }
  const deviceId = text(value.deviceId);
  if (!deviceId) return null;
  if (kind === 'audio') return { deviceId, ...(name && { name }) };
  if (!['msmf', 'dshow'].includes(value.backend) || !Number.isInteger(value.width) || value.width < 160 || value.width > 3840
    || !Number.isInteger(value.height) || value.height < 120 || value.height > 2160
    || !Number.isInteger(value.fps) || value.fps < 1 || value.fps > 60) return null;
  return { deviceId, backend: value.backend, width: value.width, height: value.height, fps: value.fps, ...(name && { name }) };
}
function readPreferences(filename) {
  const defaults = { version: 1, autoReconnect: false };
  if (!filename) return defaults;
  try {
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (value?.version !== 1) return defaults;
    defaults.autoReconnect = value.autoReconnect === true;
    for (const kind of kinds) { const config = cleanConfig(kind, value[kind]); if (config) defaults[kind] = config; }
  } catch { /* Missing or damaged preferences never prevent the app opening. */ }
  return defaults;
}

function createDeviceReconnect({ userData, getState, list, connect, failDevice, isBusy = () => false, publish = () => {}, timeout = 25000 }) {
  const filename = userData ? path.join(userData, 'device-connections.json') : null;
  let preferences = readPreferences(filename), busy = false, result = null, serial = 0, inFlight = null, closing = false, startupStarted = false;
  const pending = new Map(), waiters = new Map(), generations = new Map(kinds.map(kind => [kind, 0]));
  const snapshot = () => copy({ preferences, busy, result });
  const broadcast = () => { if (!closing) publish(snapshot()); };
  function save(next) {
    if (filename) {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const temp = filename + '.tmp';
      try { fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8'); fs.renameSync(temp, filename); }
      finally { try { fs.unlinkSync(temp); } catch { /* rename already removed the temporary file. */ } }
    }
    preferences = next;
    broadcast();
  }
  function observe(kind, state) {
    if (closing) return;
    const candidate = pending.get(kind);
    if (candidate && state.status === 'connected') {
      const matches = kind === 'controller' ? state.name?.toLowerCase() === candidate.port.toLowerCase() : state.deviceId === candidate.deviceId;
      if (matches) {
        pending.delete(kind);
        try { save({ ...preferences, [kind]: { ...candidate, ...(text(state.name) && { name: state.name }) } }); }
        catch (error) { console.warn('保存设备连接配置失败：', error.message); }
      }
    } else if (state.status === 'failed') pending.delete(kind);
    if (state.status === 'connected' || state.status === 'failed') {
      for (const notify of waiters.get(kind) || []) notify(state);
    }
  }
  function cancel(kind) {
    generations.set(kind, generations.get(kind) + 1);
    pending.delete(kind);
    for (const notify of waiters.get(kind) || []) notify({ status: 'failed', code: 'CANCELLED', message: '连接已取消' });
  }
  async function trackConnect(kind, args, action) {
    const state = getState()[kind];
    // An existing session remains owned by the original service.
    if (state.status === 'connected') return action();
    if (pending.has(kind) || state.status === 'connecting') throw Object.assign(Error(labels[kind] + '正在连接，请稍候。'), { code: 'BUSY' });
    const config = cleanConfig(kind, args);
    if (!config) throw Error(labels[kind] + '连接配置无效。');
    const generation = generations.get(kind);
    pending.set(kind, config);
    try {
      const response = await action();
      observe(kind, getState()[kind]);
      return response;
    } catch (error) {
      if (pending.get(kind) === config) pending.delete(kind);
      if (!closing && generations.get(kind) === generation && getState()[kind].status !== 'connected') failDevice(kind, error);
      throw error;
    }
  }
  function waitForConnected(kind) {
    let notify, timer;
    const promise = new Promise((resolve, reject) => {
      notify = state => {
        if (state.status === 'connected') resolve();
        else reject(Object.assign(Error(state.message || labels[kind] + '连接失败'), { code: state.code }));
      };
      if (!waiters.has(kind)) waiters.set(kind, new Set());
      waiters.get(kind).add(notify);
      timer = setTimeout(() => notify({ status: 'failed', message: labels[kind] + '连接超时，请检查设备后重试。' }), timeout);
    });
    return { promise, dispose: () => { clearTimeout(timer); waiters.get(kind)?.delete(notify); } };
  }
  async function restore(kind, config) {
    const generation = generations.get(kind);
    if (closing) return null;
    // A manual connection may have completed while another device was enumerated.
    if (getState()[kind].status === 'connected') return null;
    try {
      if (isBusy()) throw Object.assign(Error('设备正在用于脚本或自动流程，请结束当前操作后重连。'), { code: 'BUSY' });
      if (getState()[kind].status !== 'connecting') {
        const items = await list(kind, config);
        if (getState()[kind].status === 'connected' || closing || generations.get(kind) !== generation) return null;
        const wanted = kind === 'controller' ? config.port : config.deviceId;
        if (!items.some(item => kind === 'controller' ? item.id.toLowerCase() === wanted.toLowerCase() : item.id === wanted)) {
          throw Error('未找到上次的' + labels[kind] + '（' + (config.name || wanted) + '），请检查设备连接或重新选择。');
        }
      }
      if (closing || generations.get(kind) !== generation || getState()[kind].status === 'connected') return null;
      if (isBusy()) throw Object.assign(Error('设备正在使用，请结束当前操作后重连。'), { code: 'BUSY' });
      const waiting = waitForConnected(kind);
      try {
        if (getState()[kind].status === 'connecting') await waiting.promise;
        else await Promise.all([Promise.resolve().then(() => connect(kind, config)), waiting.promise]);
      } finally { waiting.dispose(); }
      return null;
    } catch (error) {
      if (closing || generations.get(kind) !== generation || error.code === 'CANCELLED' || getState()[kind].status === 'connected') return null;
      if (error.code !== 'BUSY') failDevice(kind, error);
      return { device: kind, name: labels[kind], message: error.message || String(error) };
    }
  }
  function reconnect() {
    if (inFlight) return inFlight;
    if (closing) return Promise.resolve(null);
    busy = true; broadcast();
    const saved = copy(preferences);
    inFlight = Promise.resolve().then(async () => {
      const configured = kinds.filter(kind => saved[kind]);
      const failures = (await Promise.all(configured.map(kind => restore(kind, saved[kind])))).filter(Boolean);
      result = { id: ++serial, failures, ...(!configured.length && { message: '尚无上次连接，请先在视频源和伊机控中连接设备。' }) };
      return copy(result);
    }).finally(() => { busy = false; inFlight = null; broadcast(); });
    return inFlight;
  }
  return {
    getState: snapshot, observe, cancel, trackConnect, reconnect,
    savePreferences: args => {
      if (!args || typeof args.autoReconnect !== 'boolean') throw Error('自动重连设置无效。');
      save({ ...preferences, autoReconnect: args.autoReconnect });
      return snapshot();
    },
    start: () => { if (startupStarted) return; startupStarted = true; if (preferences.autoReconnect) void reconnect().catch(error => console.warn('启动重连失败：', error.message)); },
    close: () => { closing = true; kinds.forEach(cancel); },
  };
}
module.exports = { createDeviceReconnect, cleanConfig, readPreferences };
