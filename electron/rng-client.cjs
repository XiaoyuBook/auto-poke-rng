const { RuntimeClient } = require('./runtime-client.cjs');

const BATCH_SIZE = 4096;
const MAX_RESULTS = 250000;

function registerRng({ ipcMain, getMainWindow, client = new RuntimeClient({ role: 'rng' }), calculator = new RuntimeClient({ role: 'rng' }) }) {
  let active = null;
  const requireWindow = event => {
    if (!event.sender || event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown RNG sender');
  };
  const cancel = async () => {
    if (!active) return;
    const job = active;
    job.cancelled = true;
    client.terminate();
    await job.promise.catch(() => {});
  };
  ipcMain.handle('rng:static-generate', async (event, request) => {
    requireWindow(event);
    if (!request || typeof request !== 'object') throw new Error('定点搜索参数无效。');
    if (active) throw new Error('已有定点搜索正在进行，请先取消。');
    for (const [key, limit] of [['initialAdvances', 10000000], ['maxAdvances', 1000000000], ['offset', 1000000]]) {
      if (!Number.isInteger(request[key]) || request[key] < 0 || request[key] > limit) throw new Error(`${key} 必须在 0–${limit} 之间。`);
    }
    const job = { cancelled: false, promise: null };
    active = job;
    const destroyed = () => { void cancel(); };
    event.sender.once('destroyed', destroyed);
    event.sender.once('render-process-gone', destroyed);
    job.promise = (async () => {
      const rows = [];
      // PokeFinder's maximum is an inclusive distance from the initial advance.
      for (let scanned = 0; scanned <= request.maxAdvances; scanned += BATCH_SIZE) {
        if (job.cancelled) throw new Error('已取消搜索');
        const batch = await client.call('static.generate', {
          ...request, initialAdvances: request.initialAdvances + scanned,
          maxAdvances: Math.min(BATCH_SIZE - 1, request.maxAdvances - scanned),
        }, 30000);
        if (job.cancelled) throw new Error('已取消搜索');
        if (rows.length + batch.length > MAX_RESULTS) throw new Error(`匹配结果超过 ${MAX_RESULTS.toLocaleString('en-US')} 条，请缩小搜索范围或增加筛选条件。此次结果未保留。`);
        rows.push(...batch);
      }
      return rows;
    })().catch(error => {
      throw new Error(job.cancelled ? '已取消搜索' : `PokeFinder：${error.message}`);
    }).finally(async () => {
      // Child termination is asynchronous. Do not release the search slot until
      // exit has cleared RuntimeClient.child, or an immediate retry sees a killed child.
      if (job.cancelled || client.child?.killed) await client.close();
      event.sender.removeListener('destroyed', destroyed);
      event.sender.removeListener('render-process-gone', destroyed);
      if (active === job) active = null;
    });
    return job.promise;
  });
  ipcMain.handle('rng:cancel', async event => { requireWindow(event); await cancel(); });
  ipcMain.handle('rng:iv-calculate', async (event, request) => {
    requireWindow(event);
    if (!request || typeof request !== 'object') throw new Error('个体值计算参数无效。');
    return calculator.call('iv.calculate', request);
  });
  return { close: async () => { await cancel(); await Promise.all([client.close(), calculator.close()]); } };
}

module.exports = { registerRng, BATCH_SIZE, MAX_RESULTS };
