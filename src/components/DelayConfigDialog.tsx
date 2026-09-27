import { useEffect, useRef, useState } from 'react';
import type { AutomationApi, DelayConfig, DelayPreview, DelayProfile } from '../automation';
import { Dialog } from './Dialog';

export const delayStrategyLabels: Record<string, string> = {
  fixed: '固定 delay', last: '上次实际 delay', mode: '众数', median: '中位数',
  mean: '滚动平均', ema: '指数平滑', trimmed_mean: '截尾平均', dense_interval: '密集区间',
};

const strategyHelp: Record<string, string> = {
  last: '使用最近一次单候选反查结果；多候选轮次会跳过。',
  mode: '从有效样本中选择权重最高的 delay。',
  median: '根据有效样本的中位数估计下轮 delay。',
  mean: '对窗口内的有效样本计算平均值。',
  ema: '以基准值为起点，新样本按权重逐轮更新估计。',
  trimmed_mean: '对样本两端作截尾处理；不足五轮时按平均值计算。',
  dense_interval: '在样本最密集的 delay 区间内取中位数。',
};

const sampleStatusLabels: Record<string, string> = {
  used: '参与计算', excluded: '已排除', empty: '无有效候选', fixed_strategy: '当前策略不使用样本',
  ambiguous: '多候选已忽略', outside_window: '窗口外',
};

export function delayConfigError(config: DelayConfig): string | null {
  if (!Object.hasOwn(delayStrategyLabels, config.strategy)) return '请选择计算策略';
  if (!Number.isInteger(config.baseline_delay) || config.baseline_delay < 0 || config.baseline_delay > 1_000_000_000) return '请输入 0–1,000,000,000 帧的整数';
  if (!['ignore', 'weighted'].includes(config.multi_candidate_policy)) return '请选择多候选处理方式';
  if (!Number.isInteger(config.window_size) || config.window_size < 1 || config.window_size > 10_000) return '有效样本窗口需要 1–10000 轮';
  if (!(config.ewma_alpha > 0 && config.ewma_alpha <= 1)) return '新样本权重需要大于 0 且不超过 1';
  if (!Number.isInteger(config.dense_interval_width) || config.dense_interval_width < 0) return '密集区间跨度需要非负整数';
  return null;
}

type PreviewState = { key: string; status: 'loading' | 'ready' | 'invalid' | 'error'; result?: DelayPreview; error?: string };
export function useDelayPreview(config: DelayConfig | null, samples: DelayProfile['samples'], scopeKey: string, api?: Pick<AutomationApi, 'delayEstimate'>): PreviewState {
  const key = JSON.stringify([scopeKey, config, samples]);
  const [state, setState] = useState<PreviewState>({ key: '', status: 'loading' });
  useEffect(() => {
    if (!config || delayConfigError(config)) { setState({ key, status: 'invalid' }); return; }
    if (!api || typeof api.delayEstimate !== 'function') { setState({ key, status: 'error', error: '估计服务不可用' }); return; }
    let active = true;
    setState({ key, status: 'loading' });
    const timer = setTimeout(() => {
      void api.delayEstimate({ config, samples, next_round_number: 1 }).then(result => {
        if (active) setState({ key, status: 'ready', result });
      }).catch(error => {
        if (active) setState({ key, status: 'error', error: error instanceof Error ? error.message : String(error) });
      });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [key, api]);
  return state.key === key ? state : { key, status: 'loading' };
}

export function delayPreviewReason(preview: DelayPreview, strategy: string): string {
  if (strategy === 'fixed') return '固定值 · 每轮使用';
  if (preview.used_fallback && preview.valid_round_count === 0) return '暂无有效样本，暂用基准值';
  if (strategy === 'last') return `取自第 ${preview.used_round_numbers.at(-1)} 轮有效样本`;
  if (preview.effective_strategy !== strategy) return `${preview.valid_round_count} 轮有效样本参与；按${delayStrategyLabels[preview.effective_strategy] || preview.effective_strategy}计算`;
  return `${preview.valid_round_count} 轮有效样本参与计算`;
}

type Props = {
  config: DelayConfig;
  samples: DelayProfile['samples'];
  species: string;
  flowName: string;
  scopeKey: string;
  api: Pick<AutomationApi, 'delayEstimate'>;
  runningDelay?: number | null;
  locked: boolean;
  onApply: (config: DelayConfig) => void;
  onClose: () => void;
  onExclude: (roundNumber: number, excluded: boolean) => Promise<void>;
  onClear: () => Promise<void>;
};

export function DelayConfigDialog({ config, samples, species, flowName, scopeKey, api, runningDelay, locked, onApply, onClose, onExclude, onClear }: Props) {
  const [draft, setDraft] = useState<DelayConfig>(() => structuredClone(config));
  const [tab, setTab] = useState<'settings' | 'samples'>('settings');
  const [page, setPage] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const preview = useDelayPreview(draft, samples, scopeKey, api);
  const invalid = delayConfigError(draft);
  const statistical = !['fixed', 'last'].includes(draft.strategy);
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(samples.length / 10) - 1));
  const visibleSamples = [...samples].map((sample, index) => ({ sample, index })).reverse().slice(pageIndex * 10, pageIndex * 10 + 10);
  const change = (values: Partial<DelayConfig>) => setDraft(current => ({ ...current, ...values }));
  const number = (key: 'baseline_delay' | 'window_size' | 'ewma_alpha' | 'dense_interval_width', label: string, min: number, max?: number, step = 1) => (
    <label>{label}<input aria-label={label} type="number" min={min} max={max} step={step} disabled={locked}
      value={Number.isFinite(draft[key]) ? draft[key] : ''} aria-invalid={!Number.isFinite(draft[key])}
      onChange={event => change({ [key]: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
  );
  const runSampleAction = async (action: () => Promise<void>) => {
    if (locked || sampleBusy) return;
    setSampleBusy(true); setSampleError('');
    try { await action(); } catch (error) { setSampleError(error instanceof Error ? error.message : String(error)); }
    finally { setSampleBusy(false); }
  };
  const chooseTab = (next: 'settings' | 'samples') => { setTab(next); tabs.current[next]?.focus(); };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'ArrowRight' || event.key === 'End' ? 'samples' : event.key === 'ArrowLeft' || event.key === 'Home' ? 'settings' : null;
    if (next) { event.preventDefault(); chooseTab(next); }
  };
  return <Dialog title="delay 策略" close={onClose} className="automation-delay-dialog">
    <p className="automation-delay-context">{species} · {flowName}</p>
    <div className="automation-delay-tabs" role="tablist" aria-label="delay 配置内容">
      <button id="delay-tab-settings" ref={element => { tabs.current.settings = element; }} type="button" role="tab" aria-selected={tab === 'settings'} aria-controls="delay-panel-settings" tabIndex={tab === 'settings' ? 0 : -1} onKeyDown={onTabKeyDown} onClick={() => chooseTab('settings')}>策略设置</button>
      <button id="delay-tab-samples" ref={element => { tabs.current.samples = element; }} type="button" role="tab" aria-selected={tab === 'samples'} aria-controls="delay-panel-samples" tabIndex={tab === 'samples' ? 0 : -1} onKeyDown={onTabKeyDown} onClick={() => chooseTab('samples')}>历史样本（{samples.length}）</button>
    </div>
    <div className="automation-delay-dialog-body">
      <div id="delay-panel-settings" role="tabpanel" aria-labelledby="delay-tab-settings" hidden={tab !== 'settings'}>
        <div className="automation-delay-dialog-fields">
          <label>计算策略<select aria-label="计算策略" autoFocus disabled={locked} value={draft.strategy} onChange={event => change({ strategy: event.target.value })}>{Object.entries(delayStrategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {number('baseline_delay', draft.strategy === 'fixed' ? '固定 delay' : '基准 delay', 0, 1_000_000_000)}
          {statistical && <>{number('window_size', '有效样本窗口', 1, 10_000)}<label>多候选处理<select aria-label="多候选处理" disabled={locked} value={draft.multi_candidate_policy} onChange={event => change({ multi_candidate_policy: event.target.value })}><option value="ignore">忽略多候选轮次</option><option value="weighted">按权重计入（每轮总权重为 1）</option></select></label></>}
          {draft.strategy === 'ema' && number('ewma_alpha', '新样本权重', 0.001, 1, 0.01)}
          {draft.strategy === 'dense_interval' && number('dense_interval_width', '密集区间跨度', 0)}
        </div>
        {strategyHelp[draft.strategy] && <p className="muted automation-delay-help">{strategyHelp[draft.strategy]}</p>}
        <div className="automation-delay-preview" aria-live="polite"><span>{draft.strategy === 'fixed' ? '每轮使用' : '下轮预计'}</span>
          <strong>{invalid || preview.status !== 'ready' ? '—' : preview.result!.value} <small>帧</small></strong>
          <p>{invalid ? invalid : preview.status === 'ready' ? delayPreviewReason(preview.result!, draft.strategy) : preview.status === 'error' ? preview.error : '正在计算…'}</p>
        </div>
        {runningDelay != null && <p className="automation-delay-running">本轮 {runningDelay} 帧已锁定，设置变动从下一轮生效。</p>}
      </div>
      <div id="delay-panel-samples" role="tabpanel" aria-labelledby="delay-tab-samples" hidden={tab !== 'samples'}>
        <div className="automation-delay-sample-heading"><strong>{species}的共享样本</strong><span>共 {samples.length} 轮</span></div>
        {samples.length ? <><div className="automation-delay-sample-list">{visibleSamples.map(({ sample, index }) => <div className="automation-delay-sample" key={sample.round_number}><div><strong>第 {sample.round_number} 轮 · {sample.candidates.join(' / ')} 帧</strong><small>{sample.observed_at ? new Date(sample.observed_at).toLocaleString() : '时间未知'} · {preview.status === 'ready' ? sampleStatusLabels[preview.result!.sample_statuses[index]] || '待计算' : sample.excluded ? '已排除' : '待计算'}</small></div><button type="button" disabled={locked || sampleBusy} onClick={() => void runSampleAction(() => onExclude(sample.round_number, !sample.excluded))}>{sample.excluded ? '恢复' : '排除'}</button></div>)}</div>
          {samples.length > 10 && <div className="automation-delay-sample-pager"><button type="button" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>上一页</button><span>{pageIndex + 1} / {Math.ceil(samples.length / 10)}</span><button type="button" disabled={(pageIndex + 1) * 10 >= samples.length} onClick={() => setPage(pageIndex + 1)}>下一页</button></div>}
          {confirmClear ? <div className="automation-delay-clear-confirm"><p>清空{species}的全部样本？这会影响使用该宝可梦的所有流程。</p><button type="button" disabled={locked || sampleBusy} onClick={() => void runSampleAction(async () => { await onClear(); setConfirmClear(false); })}>确认清空</button><button type="button" onClick={() => setConfirmClear(false)}>保留样本</button></div> : <button type="button" className="automation-delay-clear" disabled={locked || sampleBusy} onClick={() => setConfirmClear(true)}>清空共享样本</button>}
        </> : <p className="automation-delay-empty">暂无历史样本。获得有效反查结果后会显示在这里。</p>}
        <p className="muted automation-delay-sample-note">样本由该宝可梦的所有流程共享；策略只属于当前流程。样本操作会立即生效。</p>
        {sampleError && <p role="alert" className="panel-error">{sampleError}</p>}
      </div>
    </div>
    <div className="automation-delay-dialog-actions"><span>应用后更新当前流程草稿；可点击“保存配置”立即保存。</span><div><button type="button" onClick={onClose}>取消</button><button type="button" className="button primary" disabled={locked || !!invalid} onClick={() => onApply(structuredClone(draft))}>应用</button></div></div>
  </Dialog>;
}
