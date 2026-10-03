// One file per start-to-stop automation run, irrespective of its round count.
const fs = require('node:fs');
const path = require('node:path');
const RUN_FILE = /^run_(\d{13})_([a-zA-Z0-9_-]{1,100})\.jsonl$/;
const RETAIN_RUNS = 30;

class AutomationRunLogs {
  constructor(directory) {
    this.directory = path.resolve(directory, 'logs', 'runs');
    this.files = new Map();
    this.active = new Set();
    this.buffers = new Map();
    this.lastStart = 0;
  }
  begin(run, config) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(run.id)) throw Error('流程日志标识无效');
    fs.mkdirSync(this.directory, { recursive: true });
    const existing = fs.readdirSync(this.directory).filter(name => RUN_FILE.test(name)).sort();
    this.lastStart = Math.max(Date.parse(run.startedAt), this.lastStart + 1,
      Number(existing.at(-1)?.match(RUN_FILE)?.[1] || 0) + 1);
    const file = path.join(this.directory, `run_${this.lastStart}_${run.id}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({ event: 'run.started', version: 1, runId: run.id,
      timestamp: run.startedAt, kind: run.kind, context: run.context, config }) + '\n', { flag: 'wx' });
    this.files.set(run.id, file);
    this.active.add(run.id);
    this.prune();
  }
  append(runId, row) {
    const file = this.files.get(runId);
    if (!file) return;
    const buffer = (this.buffers.get(runId) || '') + JSON.stringify(row) + '\n';
    this.buffers.set(runId, buffer);
    if (buffer.length >= 65536) this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        try { this.flush(); } catch (error) { this.onError?.(error); }
      }, 100);
      this.timer.unref();
    }
  }
  flush() {
    for (const [id, buffer] of this.buffers) {
      const file = this.files.get(id);
      if (file && buffer) fs.appendFileSync(file, buffer, 'utf8');
      this.buffers.delete(id);
    }
  }
  prune() {
    const files = fs.readdirSync(this.directory).filter(name => RUN_FILE.test(name)).sort().reverse();
    const active = new Set([...this.active].map(id => this.files.get(id)));
    for (const name of files.slice(RETAIN_RUNS)) {
      const file = path.resolve(this.directory, name);
      // Delete only our own flat files; never traverse a user-supplied path.
      if (path.dirname(file) === this.directory && !active.has(file)) {
        fs.unlinkSync(file);
        const id = name.match(RUN_FILE)[2];
        this.files.delete(id); this.buffers.delete(id);
      }
    }
  }
  finish(runId, row) {
    this.append(runId, row);
    this.flush();
    this.active.delete(runId);
    if (fs.existsSync(this.directory)) this.prune();
  }
}

module.exports = { AutomationRunLogs, RETAIN_RUNS };
