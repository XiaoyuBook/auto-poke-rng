const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');

const defaultFilter = () => ({ skip: false, shiny: 3, ability: 255, gender: 255, ivMin: [0,0,0,0,0,0], ivMax: [31,31,31,31,31,31], natures: Array(25).fill(true), heightMin: 0, heightMax: 255, weightMin: 0, weightMax: 255 });
const regions = [
  ['nature','性格',112,203,230,64], ['characteristic','个性',103,569,432,64],
  ['hp','HP',517,197,54,42], ['attack','攻击',735,315,85,64], ['defense','防御',717,478,115,54],
  ['sp_attack','特攻',224,306,63,67], ['sp_defense','特防',218,487,85,42], ['speed','速度',475,596,85,39],
  ['shiny_dialog','判闪对话区域',6,895,1914,175], ['starter_battle','御三家战斗区域',1540,620,170,95],
];
const defaults = () => ({
  static: { parameters: { target: 'Turtwig', filters: [defaultFilter()], lead: 255, initial_advances: 0, max_advances: 100000, offset: 0,
    fixed_delay: 100, max_wait_frames: 300, reseed_threshold_frames: 900000, reidentify_max_attempts: 2,
    reidentify_failure_policy: 'next_round', reidentify_seed_max_attempts: 1, reseeding_threshold: 500000,
    auto_reverse: false, escape_continue: false, reverse_lookup_window: 500, shiny_threshold_seconds: 4,
    sync_mode: 0, sync_nature: '', loop_mode: 'single', loop_count: 1, start: 'script' },
    scripts: { seed: '', advance: '', hit: '', exit: '', reverse: '', escape: '', record: '' } },
  tid: { parameters: { frame_threshold: 300, delay: 0, target_display_tids: [], loop_mode: 'single', loop_count: 1, start: 'script' }, scripts: { seed: '', name: '' } },
  ocr: regions.map(([id,label,x,y,width,height]) => ({ id, label, rect: { x,y,width,height } })),
});
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const clone = value => structuredClone(value);
class AutomationStore extends EventEmitter {
  constructor(directory, { now = () => new Date() } = {}) {
    super(); this.directory = directory; this.now = now; this.logs = []; this.runs = []; this.error = '';
    this.data = { version: 1, config: defaults(), profiles: {}, logging: true };
    const file = path.join(directory, 'automation.json');
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.version !== 1) throw Error('自动流程配置版本不支持');
      for (const kind of ['static','tid']) for (const scope of ['parameters','scripts']) Object.assign(this.data.config[kind][scope], saved.config?.[kind]?.[scope]);
      if (Array.isArray(saved.config?.ocr) && saved.config.ocr.length === 10) this.data.config.ocr = saved.config.ocr;
      this.data.profiles = saved.profiles || {}; this.data.logging = saved.logging !== false;
    } catch (error) { if (error.code !== 'ENOENT') this.error = `无法加载自动流程配置，原文件保留：${error.message}`; }
  }
  persist(data) {
    fs.mkdirSync(this.directory, { recursive: true });
    const target = path.join(this.directory, 'automation.json'), temp = target + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8'); fs.renameSync(temp, target);
  }
  change(update) {
    const next = clone(this.data); update(next); this.persist(next); this.data = next; this.emit('change');
    return this.snapshot();
  }
  save(kind, scope, values) {
    if (!['static','tid'].includes(kind) || !['parameters','scripts'].includes(scope) || !values || typeof values !== 'object' || Array.isArray(values)) throw Error('配置保存范围无效');
    if (JSON.stringify(values).length > 100000) throw Error('自动流程配置过大');
    return this.change(next => { for (const [key,value] of Object.entries(values)) {
      if (!Object.hasOwn(next.config[kind][scope], key)) throw Error(`未知配置：${key}`);
      next.config[kind][scope][key] = clone(value);
    } });
  }
  saveOcr(rows) {
    if (!Array.isArray(rows) || rows.length !== 10) throw Error('需要十项 OCR 区域');
    const seen = new Set();
    for (const row of rows) {
      if (!regions.some(item => item[0] === row.id) || seen.has(row.id)) throw Error('OCR 项目无效');
      seen.add(row.id);
      if (!['x','y','width','height'].every(key => Number.isInteger(row.rect?.[key]) && row.rect[key] >= 0 && row.rect[key] <= 16384) || !row.rect.width || !row.rect.height) throw Error('OCR 区域需要有效的整数坐标和尺寸');
    }
    return this.change(next => { next.config.ocr = clone(rows); });
  }
  profile(data, species) {
    if (!Number.isInteger(Number(species)) || Number(species) < 1 || Number(species) > 1025) throw Error('物种无效');
    return data.profiles[species] ||= { config: { strategy: 'fixed', baseline_delay: 100, multi_candidate_policy: 'ignore', window_size: 5, ewma_alpha: 0.5, dense_interval_width: 2 }, samples: [], next_round_number: 1 };
  }
  saveDelay(species, config) {
    if (!['fixed','last','mode','median','mean','ema','trimmed_mean','dense_interval'].includes(config.strategy)
      || !['ignore','weighted'].includes(config.multi_candidate_policy)
      || !Number.isInteger(config.baseline_delay) || config.baseline_delay < 0 || config.baseline_delay > 1000000000
      || !Number.isInteger(config.window_size) || config.window_size < 1 || config.window_size > 10000
      || !(config.ewma_alpha > 0 && config.ewma_alpha <= 1) || !Number.isInteger(config.dense_interval_width) || config.dense_interval_width < 0) throw Error('delay 策略参数无效');
    return this.change(next => { this.profile(next, species).config = clone(config); });
  }
  recordDelay(species, candidates) {
    const normalized = [...new Set(candidates.filter(value => Number.isInteger(value) && value >= 0))].sort((a,b) => a-b);
    if (!normalized.length) return;
    this.change(next => { const profile = this.profile(next, species); profile.samples.push({ candidates: normalized, round_number: profile.next_round_number++, observed_at: this.now().toISOString(), excluded: false }); });
  }
  excludeDelay(species, number, excluded) {
    return this.change(next => { const sample = this.profile(next, species).samples.find(item => item.round_number === number); if (!sample) throw Error('样本不存在'); sample.excluded = !!excluded; });
  }
  clearDelay(species) { return this.change(next => { this.profile(next, species).samples = []; }); }
  setLogging(value) { return this.change(next => { next.logging = !!value; }); }
  log(message, source = '系统', level = 'info', context = {}) {
    const now = this.now();
    const row = { ...context, id: randomUUID(), time: now.toLocaleTimeString('zh-CN', { hour12: false }), timestamp: now.toISOString(), message: String(message), source, level };
    this.logs.push(row); if (this.logs.length > 10000) this.logs.splice(0, this.logs.length - 10000);
    if (this.data.logging) try {
      const directory = path.join(this.directory, 'logs'); fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(path.join(directory, `run_${dateKey(now)}.log`), JSON.stringify(row) + '\n', 'utf8');
      const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 6);
      if (this.lastCleanup !== dateKey(now)) {
        for (const file of fs.readdirSync(directory)) if (/^run_\d{4}-\d{2}-\d{2}\.log$/.test(file) && file.slice(4,14) < dateKey(cutoff)) fs.unlinkSync(path.join(directory, file));
        this.lastCleanup = dateKey(now);
      }
    } catch (error) { this.error = '日志写入失败：' + error.message; }
    this.emit('log', row); return row;
  }
  clearLogs() { this.logs = []; this.emit('change'); }
  beginRun(id, kind) { this.runs.unshift({ id, kind, startedAt: this.now().toISOString(), status: 'running', rounds: [] }); this.emit('change'); }
  history(id, event, args) {
    const run = this.runs.find(item => item.id === id); if (!run) return;
    if (event === 'cycle_start') run.rounds.push({ number: args[0], outcome: '运行中', candidates: [], events: [] });
    const round = run.rounds.at(-1); if (!round) return;
    round.events.push({ event, args: clone(args) });
    if (event === 'seed_captured') { round.seed = args[0]; round.currentAdvances = args[1]; }
    if (event === 'candidates_found' || event === 'candidates_refiltered') { round.candidates = clone(args[0]); round.selected = args[1]; round.sources = args[2]; }
    if (event === 'cycle_no_candidate') round.outcome = '无候选';
    if (event === 'cycle_result') { round.outcome = args[0] ? '出闪' : '未出闪'; round.interval = args[1]; round.trigger = args[2]; round.usedDelay = args[3]; }
    if (event === 'reverse_result') { round.reverse = clone(args[0]); round.actualDelays = clone(args[1]); }
    this.emit('change');
  }
  finishRun(id, status, message) {
    const run = this.runs.find(item => item.id === id); if (!run) return;
    Object.assign(run, { status, message, endedAt: this.now().toISOString() });
    const round = run.rounds.at(-1); if (round?.outcome === '运行中') round.outcome = status === 'stopped' ? '已停止' : status === 'failed' ? '失败' : '已完成';
    this.emit('change');
  }
  snapshot() { return clone({ ...this.data, logs: this.logs, runs: this.runs, error: this.error }); }
}
module.exports = { AutomationStore, defaults, defaultFilter };
