const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

class ScriptRunner {
  constructor({ controller, rootDirectory, getVideo, emit }) {
    Object.assign(this, { controller, rootDirectory, getVideo, emit });
    this.current = null;
  }
  async start({ text, path: relative }) {
    if (this.current) throw new Error('已有脚本正在运行。');
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024 || !text.trim()) throw new Error('脚本内容无效。');
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.split('/').some(part => !part || part === '..' || part === '.') || !/\.rng$/i.test(relative)) throw new Error('脚本路径无效。');
    const root = path.resolve(this.rootDirectory), absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep)) throw new Error('脚本必须位于脚本目录内。');
    const fs = require('node:fs/promises');
    let currentPath = root;
    for (const part of ['', ...relative.split('/')]) {
      currentPath = part ? path.join(currentPath, part) : currentPath;
      if ((await fs.lstat(currentPath)).isSymbolicLink()) throw new Error('脚本目录不允许链接。');
    }
    const state = await this.controller.call('controller.status');
    if (state.status !== 'connected') throw new Error('请先连接伊机控。');
    // Recheck after asynchronous preflight to reject simultaneous run requests.
    if (this.current) throw new Error('已有脚本正在运行。');
    const run = { id: crypto.randomUUID(), owner: '', stopped: false, child: null, done: null, finished: false };
    this.current = run;
    const localPython = path.join(__dirname, '..', '.deps', 'script-python', 'Scripts', 'python.exe');
    const child = spawn(process.env.AUTO_POKE_PYTHON || (require('node:fs').existsSync(localPython) ? localPython : 'python'), ['-u', path.join(__dirname, '..', 'runtime', 'python', 'script_host.py')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
    run.child = child;
    let buffer = '', diagnostic = '';
    const finish = async (status, message = '') => {
      if (run.finished) return;
      run.finished = true;
      this.controller.off('offline', onOffline);
      this.controller.off('event', onControllerEvent);
      try {
        if (run.owner) {
          if (!this.controller.child || this.controller.child.killed) throw new Error('伊机控进程已退出，无法确认按键释放。');
          if (run.stopped) await this.controller.call('controller.stop');
          else await this.controller.call('controller.release', { owner: run.owner });
        }
      } catch (error) { status = 'failed'; message = message || error.message; }
      if (run.failureReason) { status = 'failed'; message = run.failureReason; }
      child.stdin.end();
      const cleanup = setTimeout(() => child.kill(), 2000);
      child.once('exit', () => clearTimeout(cleanup));
      if (this.current === run) this.current = null;
      this.emit({ event: 'script.done', runId: run.id, status, message });
      run.resolveDone?.();
    };
    run.done = new Promise(resolve => { run.resolveDone = resolve; });
    const onOffline = error => { void this.stop(`伊机控进程已退出，无法确认按键释放：${error.message}`); };
    const onControllerEvent = event => {
      if (event.event === 'controller.state' && ['failed', 'idle'].includes(event.state.status)) {
        void this.stop(event.state.message || '伊机控已断开，脚本已终止。');
      }
    };
    this.controller.on('offline', onOffline);
    this.controller.on('event', onControllerEvent);
    const startupTimer = setTimeout(() => void finish('failed', '脚本引擎启动或预检超时。'), 15000);
    run.done.then(() => clearTimeout(startupTimer));
    child.once('error', error => void finish('failed', `无法启动脚本引擎，请安装 Python 3.12 或设置 AUTO_POKE_PYTHON：${error.message}`));
    child.once('exit', code => { if (!run.finished) void finish(run.stopped ? 'cancelled' : 'failed', diagnostic || `脚本进程意外退出 (${code})`); });
    child.stdin.on('error', error => { if (!run.finished) void finish('failed', error.message); });
    child.stderr.on('data', data => { diagnostic = (diagnostic + data.toString('utf8')).slice(-3000); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 2 * 1024 * 1024) { child.kill(); void finish('failed', '脚本输出超过限制。'); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { child.kill(); void finish('failed', '脚本进程协议错误。'); return; }
        if (message.event === 'request') {
          void (async () => {
            try {
              if (run.stopped || run.finished) throw new Error('脚本已停止。');
              let result;
              if (message.method === 'script.acquire') {
                const lease = await this.controller.call('controller.acquire'); run.owner = lease.owner;
                if (run.stopped || run.finished) { await this.controller.call('controller.release', { owner: lease.owner }); throw new Error('脚本已停止。'); }
              } else {
                if (!run.owner || !['controller.key', 'controller.stick', 'controller.sequence'].includes(message.method)) throw new Error('不允许的脚本设备调用。');
                const args = { ...message.params, owner: run.owner };
                result = message.method === 'controller.sequence' ? await this.controller.sequence(args) : await this.controller.call(message.method, args);
              }
              if (!run.finished && !child.stdin.destroyed) child.stdin.write(JSON.stringify({ id: message.id, result }) + '\n');
            } catch (error) { if (!run.finished && !child.stdin.destroyed) child.stdin.write(JSON.stringify({ id: message.id, error: error.message }) + '\n'); }
          })();
        } else if (message.event === 'script.started') { clearTimeout(startupTimer); this.emit({ ...message, runId: run.id }); }
        else if (message.event === 'script.done') void finish(run.stopped ? 'cancelled' : message.status, message.message);
        else if (message.event === 'script.log') this.emit({ ...message, runId: run.id });
      }
    });
    child.stdin.write(JSON.stringify({ text, name: relative, scriptDir: path.dirname(absolute), video: this.getVideo() }) + '\n');
    return { runId: run.id };
  }
  async stop(failureReason = '') {
    const run = this.current;
    if (!run) return;
    if (failureReason) run.failureReason = failureReason;
    if (run.stopped || run.finished) return run.done;
    run.stopped = true;
    if (!run.child.stdin.destroyed) run.child.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
    const timeout = setTimeout(() => run.child.kill(), 2000);
    try {
      if (run.owner && this.controller.child && !this.controller.child.killed) {
        try { await this.controller.call('controller.stop'); }
        catch (error) { run.failureReason ||= error.message; }
      }
      await run.done;
    } finally { clearTimeout(timeout); }
  }
}

// Subscribe before sending: a short sequence can finish before its accepted response.
function addSequenceApi(controller) {
  controller.sequence = async args => {
    const completions = new Map(); let resolveCompletion;
    const wake = new Promise(resolve => { resolveCompletion = resolve; });
    let operation;
    const listener = event => { if (event.event === 'controller.action.done') { completions.set(event.operation, event); if (event.operation === operation) resolveCompletion(event); } };
    const offline = error => resolveCompletion({ status: 'failed', message: error.message });
    controller.on('event', listener); controller.on('offline', offline);
    let timer;
    try {
      ({ operation } = await controller.call('controller.sequence', args));
      const maxMs = args.actions.reduce((sum, action) => sum + (action.kind === 'wait' ? action.duration_ms : 60), 0) + 5000;
      timer = setTimeout(() => { resolveCompletion({ status: 'failed', message: '控制动作完成超时。' }); controller.terminate(); }, Math.min(maxMs, 2147483647));
      const result = completions.get(operation) || await wake;
      if (result.status !== 'completed') throw new Error(result.message || '控制动作已取消。');
      return result;
    } finally { clearTimeout(timer); controller.off('event', listener); controller.off('offline', offline); }
  };
  return controller;
}
module.exports = { ScriptRunner, addSequenceApi };
