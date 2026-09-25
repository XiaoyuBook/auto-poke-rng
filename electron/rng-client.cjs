const { RuntimeClient } = require('./runtime-client.cjs');

const BATCH_SIZE = 4096;
const MAX_RESULTS = 250000;
const MAX_INITIAL_ADVANCES = 10000000;
const MAX_SEARCH_ADVANCES = 1000000000;
const MAX_REVERSE_WINDOW = 10000;
const MAX_ABSOLUTE_ADVANCES = MAX_INITIAL_ADVANCES + MAX_SEARCH_ADVANCES + MAX_REVERSE_WINDOW;

function registerRng({ ipcMain, getMainWindow, client = new RuntimeClient({ role: 'rng' }), calculator = new RuntimeClient({ role: 'rng' }), isAutomationBusy = () => false }) {
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
  const generateSearch = async (request, sender, reverse) => {
    if (!request || typeof request !== 'object') throw new Error('定点搜索参数无效。');
    if (active) throw new Error('已有定点搜索正在进行，请先取消。');
    for (const [key, limit] of [['initialAdvances', reverse ? MAX_ABSOLUTE_ADVANCES : MAX_INITIAL_ADVANCES], ['maxAdvances', reverse ? MAX_REVERSE_WINDOW * 2 : MAX_SEARCH_ADVANCES], ['offset', 1000000]]) {
      if (!Number.isInteger(request[key]) || request[key] < 0 || request[key] > limit) throw new Error(`${key} 必须在 0–${limit} 之间。`);
    }
    if (reverse && request.initialAdvances + request.maxAdvances > MAX_ABSOLUTE_ADVANCES) throw new Error('反查绝对推进超出可搜索范围。');
    const job = { cancelled: false, promise: null };
    active = job;
    const destroyed = () => { void cancel(); };
    sender?.once('destroyed', destroyed);
    sender?.once('render-process-gone', destroyed);
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
      sender?.removeListener('destroyed', destroyed);
      sender?.removeListener('render-process-gone', destroyed);
      if (active === job) active = null;
    });
    return job.promise;
  };
  const generate = (request, sender = getMainWindow()?.webContents) => generateSearch(request, sender, false);
  // Only the main-process automation adapter can request a bounded absolute window.
  // Renderer payloads cannot opt out of the manual search limits.
  const generateReverse = request => generateSearch(request, getMainWindow()?.webContents, true);
  ipcMain.handle('rng:static-generate', async (event, request) => {
    requireWindow(event); if (isAutomationBusy()) throw Error('请先停止自动流程再进行手动搜索。');
    return generate(request, event.sender);
  });
  ipcMain.handle('rng:cancel', async event => { requireWindow(event); if (isAutomationBusy()) throw Error('请使用自动流程的停止按钮。'); await cancel(); });
  ipcMain.handle('rng:iv-calculate', async (event, request) => {
    requireWindow(event);
    if (!request || typeof request !== 'object') throw new Error('个体值计算参数无效。');
    return calculator.call('iv.calculate', request);
  });
  return { generate, generateReverse, cancel, isBusy: () => !!active, close: async () => { await cancel(); await Promise.all([client.close(), calculator.close()]); } };
}

module.exports = { registerRng, BATCH_SIZE, MAX_RESULTS };
