import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock3, Download, History, ListFilter, MoreHorizontal, Search, SearchX, X } from 'lucide-react';
import { downloadText, useAutomation, type AutomationApi, type AutomationSnapshot } from '../automation';
import { logLevelLabels, logText } from '../automationLogs';
import { isFrlgDiagnosticLog } from '../frlgExecution';
import { CandidateTable } from './AutomationCandidateTable';
import { AutomationLogList } from './AutomationLogList';
import { AutomationRoundEvents } from './AutomationRoundEvents';
import { AutomationPopover, AutomationRecordPicker } from './AutomationRecordPicker';
import { FrlgRoundDetails } from './FrlgRoundDetails';
export { CandidateTable } from './AutomationCandidateTable';

const runKindLabels = { static: '定点', tid: 'TID', frlg: '火叶' };
const runStatusLabels: Record<string, string> = { running: '运行中', completed: '已完成', stopped: '已停止', failed: '失败' };
const contextKey = 'auto-poke-rng:log-context';
type LogScope = 'all' | 'run' | 'round';
function runDate(value: string) {
  const date = new Date(value), day = date.toLocaleDateString('zh-CN');
  const time = date.toLocaleTimeString('zh-CN', { hour12: false });
  return { day, time, label: `${date.toDateString() === new Date().toDateString() ? '今天' : day} ${time}` };
}

export function AutomationLogs() {
  const { api, snapshot, error, setError } = useAutomation();
  return snapshot ? <AutomationLogCenter api={api} snapshot={snapshot} error={error} setError={setError}/> : <p role="status">{error || '正在加载日志中心…'}</p>;
}

function AutomationLogCenter({ api, snapshot, error, setError }: {
  api: AutomationApi | undefined; snapshot: AutomationSnapshot; error: string; setError: (value: string) => void;
}) {
  const [tab, setTab] = useState<'rounds' | 'logs'>('rounds');
  const [runId, setRunId] = useState(''), [scope, setScope] = useState<LogScope>('all');
  const [selection, setSelection] = useState<{ runId: string; number: number } | null>(null);
  const [source, setSource] = useState(''), [phase, setPhase] = useState(''), [level, setLevel] = useState(''), [query, setQuery] = useState('');
  const [notice, setNotice] = useState(''), [exporting, setExporting] = useState(false);
  const linked = useRef(false);
  const latestRun = snapshot.runs[0]?.id || snapshot.state.runId;
  const lastRun = useRef(latestRun);
  const resetFilters = () => { setSource(''); setPhase(''); setLevel(''); setQuery(''); };
  const manualSelection = () => { linked.current = false; localStorage.removeItem(contextKey); };

  useEffect(() => {
    const receive = (event?: Event) => {
      if (event instanceof StorageEvent && event.key !== contextKey) return;
      try {
        const value = JSON.parse(localStorage.getItem(contextKey) || 'null');
        if (!value || typeof value.runId !== 'string' || !value.runId) return;
        const number = Number.isInteger(value.round) && value.round >= 0 ? value.round : undefined;
        setRunId(value.runId); setSelection(number === undefined ? null : { runId: value.runId, number });
        setScope(number === undefined ? 'run' : 'round'); setTab('logs'); resetFilters(); linked.current = true;
      } catch { /* Ignore incomplete navigation data. */ }
    };
    receive(); window.addEventListener('auto-poke:related-logs', receive); window.addEventListener('storage', receive);
    return () => { window.removeEventListener('auto-poke:related-logs', receive); window.removeEventListener('storage', receive); };
  }, []);
  useEffect(() => {
    if (latestRun && lastRun.current && latestRun !== lastRun.current && linked.current) {
      setScope('all'); setRunId(''); setSelection(null); manualSelection();
    }
    lastRun.current = latestRun;
  }, [latestRun]);

  const run = runId ? snapshot.runs.find(item => item.id === runId) : snapshot.runs[0];
  const selectedRunId = run?.id || runId;
  const hasRoundSelection = selection?.runId === selectedRunId;
  const selectedIndex = run && hasRoundSelection ? run.rounds.findIndex(item => item.number === selection!.number) : -1;
  const roundIndex = hasRoundSelection ? selectedIndex : (run?.rounds.length ?? 0) - 1;
  const round = run?.rounds[roundIndex];
  const roundNumber = round?.number ?? (selection?.runId === selectedRunId ? selection.number : undefined);
  const visibleLogs = useMemo(() => snapshot.logs.filter(row => !isFrlgDiagnosticLog(row.message, row.detailOnly)), [snapshot.logs]);
  const scopedLogs = useMemo(() => visibleLogs.filter(row => scope === 'all' || row.runId === selectedRunId && (scope !== 'round' || row.round === roundNumber)), [visibleLogs, scope, selectedRunId, roundNumber]);
  const search = query.trim();
  const logs = useMemo(() => {
    const term = search.toLocaleLowerCase();
    return scopedLogs.filter(row => (!source || row.source === source) && (!phase || row.phase === phase) && (!level || row.level === level)
      && (!term || `${row.message} ${row.source} ${row.phase || ''} ${row.event || ''}`.toLocaleLowerCase().includes(term)));
  }, [scopedLogs, source, phase, level, search]);
  const sourceOptions = useMemo(() => [...new Set([...scopedLogs.map(row => row.source), ...(source ? [source] : [])])], [scopedLogs, source]);
  const phaseOptions = useMemo(() => [...new Set([...scopedLogs.map(row => row.phase).filter((value): value is string => !!value), ...(phase ? [phase] : [])])], [scopedLogs, phase]);
  const filterCount = Number(!!source) + Number(!!phase);
  const viewKey = JSON.stringify([scope, scope === 'all' ? null : selectedRunId, scope === 'round' ? roundNumber : null, source, phase, level, search]);
  const chooseRun = (id: string) => {
    manualSelection(); setRunId(id); setSelection(null);
    setScope(scope === 'round' && snapshot.runs.find(item => item.id === id)?.rounds.length ? 'round' : 'run');
  };
  const chooseRound = (index: number) => {
    if (!run?.rounds[index]) return;
    manualSelection(); setRunId(run.id); setScope('round');
    setSelection(index === run.rounds.length - 1 ? null : { runId: run.id, number: run.rounds[index].number });
  };
  const openRunLogs = (number?: number) => {
    if (!selectedRunId) return;
    manualSelection(); setRunId(selectedRunId); setSelection(number === undefined ? null : { runId: selectedRunId, number });
    setScope(number === undefined ? 'run' : 'round'); resetFilters(); setTab('logs');
  };
  const perform = async (action: () => Promise<unknown> | void, success?: string) => {
    setNotice(''); setError('');
    try { await action(); if (success) setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const exportDiagnostics = async () => {
    if (!run || exporting) return;
    setExporting(true);
    await perform(async () => {
      if (!api?.exportDiagnostics) throw Error('请重启软件以使用完整诊断导出');
      const result = await api.exportDiagnostics(run.id);
      if (!result.canceled) setNotice(`${result.active ? '已导出截至当前的诊断文件' : '已导出完整诊断文件'}${result.incomplete ? '；运行期间曾关闭日志保存，文件可能不完整' : ''}`);
    });
    setExporting(false);
  };
  const pendingCandidates = round?.outcome === '运行中' && !round.endedAt && !run?.endedAt && !['completed', 'stopped', 'failed'].includes(run?.status || '');

  return <section className="automation-log-center" aria-label="日志中心内容">
    <header className="automation-log-header"><nav className="automation-log-tabs" aria-label="日志视图">
      <button type="button" aria-pressed={tab === 'rounds'} onClick={() => setTab('rounds')}>轮次记录</button><button type="button" aria-pressed={tab === 'logs'} onClick={() => setTab('logs')}>运行日志</button>
    </nav><label className="automation-log-save"><input type="checkbox" aria-label="自动保存磁盘日志" checked={snapshot.logging} onChange={event => void perform(() => api?.setLogging(event.target.checked))}/>自动保存日志</label></header>
    {(error || snapshot.error) && <p role="alert" className="panel-error">{error || snapshot.error}</p>}
    {notice && <p className="automation-log-notice" role="status">{notice}<button type="button" aria-label="关闭日志提示" onClick={() => setNotice('')}><X size={12}/></button></p>}
    {(run || selectedRunId || tab === 'logs') && <div className="automation-run-bar">
      <AutomationRecordPicker label="切换运行记录" value={run?.id || ''} onChange={chooseRun} options={snapshot.runs.map(item => ({ value: item.id, label: `${runKindLabels[item.kind]} · ${runDate(item.startedAt).time}`, group: runDate(item.startedAt).day, description: `${item.context && 'flowName' in item.context ? `${item.context.flowName} · ` : ''}${item.rounds.length} 轮 · ${runStatusLabels[item.status] || item.status || '状态未知'}` }))}>
        <History size={15} aria-hidden="true"/>{tab === 'logs' && scope === 'all' ? <strong>全部运行</strong> : run ? <><strong>{runKindLabels[run.kind]}</strong><span className="automation-run-date" title={new Date(run.startedAt).toLocaleString('zh-CN')}>{runDate(run.startedAt).label}</span></> : <span className="automation-run-date">{selectedRunId ? `运行 ${selectedRunId}` : '暂无运行记录'}</span>}
      </AutomationRecordPicker>
      {tab === 'logs' ? <select className="automation-log-scope" aria-label="日志范围" value={scope} onChange={event => { manualSelection(); if (event.target.value !== 'all') setRunId(selectedRunId); setScope(event.target.value as LogScope); }}><option value="all">全部日志</option><option value="run" disabled={!selectedRunId}>本次运行</option><option value="round" disabled={roundNumber === undefined}>本轮日志</option></select> : run && <span className="automation-run-status" data-status={run.status}>{runStatusLabels[run.status] || run.status || '状态未知'} · {run.rounds.length} 轮</span>}
    </div>}
    {hasRoundSelection && !round && (tab === 'rounds' || scope === 'round') && <p className="automation-log-context-label">第 {roundNumber} 轮 · 轮次详情不可用{tab === 'logs' ? '，显示已收到的日志' : ''}{run && !!run.rounds.length && <button type="button" className="automation-record-action" onClick={() => { manualSelection(); setSelection(null); }}>最新一轮</button>}</p>}
    {run && round && (tab === 'rounds' || scope === 'round') && <nav className="automation-round-navigation" aria-label="轮次导航">
      <button type="button" className="automation-record-icon" aria-label="上一轮" title="上一轮" disabled={roundIndex <= 0} onClick={() => chooseRound(roundIndex - 1)}><ChevronLeft size={16}/></button>
      <AutomationRecordPicker key={run.id} label="选择轮次" value={String(round.number)} onChange={number => chooseRound(run.rounds.findIndex(item => String(item.number) === number))} options={run.rounds.map(item => ({ value: String(item.number), label: `第 ${item.number} 轮 · ${item.outcome}`, description: item.frlg?.hitSeed ? `Seed ${item.frlg.hitSeed} · 帧偏差 ${item.frlg.frameError ?? '—'}` : item.frlg && item.number === 0 ? '准备与计时校准' : undefined }))}>
        <strong>第 {round.number} 轮</strong><span className="automation-round-total">共 {run.rounds.length} 条</span>
      </AutomationRecordPicker>
      <button type="button" className="automation-record-icon" aria-label="下一轮" title="下一轮" disabled={roundIndex === run.rounds.length - 1} onClick={() => chooseRound(roundIndex + 1)}><ChevronRight size={16}/></button>
      <span className="automation-round-outcome" role="status">{round.outcome}</span>
      <div className="automation-round-actions">
        {selectedIndex >= 0 && <button type="button" className="automation-record-action" onClick={() => { manualSelection(); setSelection(null); }}>最新一轮</button>}
        {tab === 'rounds' && run.kind !== 'frlg' && !!round.candidates.length && <button type="button" className="automation-record-action" onClick={() => openRunLogs(round.number)}>查看相关日志</button>}
        {tab === 'rounds' && <button type="button" className="automation-record-icon" aria-label="导出记录" title="导出本轮记录" onClick={() => downloadText(JSON.stringify({ runId: run.id, ...round }, null, 2), '轮次记录.json', 'application/json')}><Download size={15}/></button>}
      </div>
    </nav>}
    {tab === 'rounds' ? <div className="automation-record-detail">
      {hasRoundSelection && !round ? <div className="automation-record-empty"><History size={24} aria-hidden="true"/><strong>本轮记录不可用</strong><p>可查看当前缓存中此轮次的日志。</p><button type="button" className="automation-record-action" onClick={() => openRunLogs(roundNumber)}>查看本轮日志<ArrowUpRight size={14} aria-hidden="true"/></button></div> : !run ? <div className="automation-record-empty"><History size={24} aria-hidden="true"/><strong>暂无运行记录</strong><p>运行自动流程后，轮次记录会显示在这里。</p></div> : run.kind === 'frlg' ? <FrlgRoundDetails run={run} round={round} logs={snapshot.logs} openLogs={openRunLogs}/> : round ? <>
        <dl className="automation-record-metrics"><div><dt>Seed</dt><dd>{round.seed || '—'}</dd></div><div><dt>启动帧</dt><dd>{round.trigger ?? '—'}</dd></div><div><dt>本轮 delay</dt><dd>{round.usedDelay ?? '—'}</dd></div><div><dt>实际 delay</dt><dd>{round.actualDelays?.join(' / ') || '—'}</dd></div></dl>
        {round.candidates.length ? <CandidateTable key={`${run.id}:${round.number}`} rows={round.candidates} selected={round.selected} sources={round.sources}/> : <div className="automation-record-empty" role="status">
          {pendingCandidates ? <Clock3 size={24} aria-hidden="true"/> : <SearchX size={24} aria-hidden="true"/>}<strong>{round.outcome === '无候选' ? '本轮没有符合条件的候选' : pendingCandidates ? '候选结果尚未生成' : '本轮没有候选记录'}</strong><p>{pendingCandidates ? '本轮仍在进行，结果会自动更新。' : '可查看本轮日志了解执行结果。'}</p>
          <button type="button" className="automation-record-action" onClick={() => openRunLogs(round.number)}>查看本轮日志<ArrowUpRight size={14} aria-hidden="true"/></button>
        </div>}
        {!!round.reverse?.length && <details className="automation-record-diagnostics"><summary>反查结果</summary><CandidateTable key={`${run.id}:${round.number}:reverse`} rows={round.reverse}/></details>}
        <AutomationRoundEvents key={`${run.id}:${round.number}:events`} events={round.events}/>
      </> : <div className="automation-record-empty"><Clock3 size={24} aria-hidden="true"/><strong>暂无轮次记录</strong><p>{run.status === 'running' ? '流程已开始，轮次数据会自动显示。' : '此次运行没有生成轮次记录。'}</p><button type="button" className="automation-record-action" onClick={() => openRunLogs()}>查看运行日志<ArrowUpRight size={14} aria-hidden="true"/></button></div>}
      {run?.kind !== 'frlg' && run?.message && <p>{run.message}</p>}
    </div> : <>
      <div className="automation-log-tools">
        <label className="automation-log-search"><Search size={14} aria-hidden="true"/><input type="search" aria-label="搜索日志" placeholder="搜索日志…" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <select aria-label="筛选日志级别" value={level} onChange={event => setLevel(event.target.value)}><option value="">全部级别</option>{Object.entries(logLevelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <AutomationPopover label="筛选日志" role="dialog" triggerContent={<><ListFilter size={14} aria-hidden="true"/>筛选{filterCount ? ` (${filterCount})` : ''}</>}>{close => <div className="automation-log-filter-fields">
          <label>来源<select aria-label="筛选日志来源" value={source} onChange={event => setSource(event.target.value)}><option value="">全部来源</option>{sourceOptions.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>阶段<select aria-label="筛选日志阶段" value={phase} onChange={event => setPhase(event.target.value)}><option value="">全部阶段</option>{phaseOptions.map(value => <option key={value}>{value}</option>)}</select></label>
          <div><button type="button" onClick={() => { resetFilters(); close(); }}>重置筛选</button><button type="button" onClick={close}>完成</button></div>
        </div>}</AutomationPopover>
        <AutomationPopover label="更多日志操作" triggerContent={<MoreHorizontal size={16} aria-hidden="true"/>}>{close => <>
          <button type="button" role="menuitem" disabled={!logs.length} onClick={() => { close(); void perform(() => navigator.clipboard.writeText(logText(logs)), '已复制当前视图的全部匹配日志'); }}>复制当前视图</button>
          <button type="button" role="menuitem" disabled={!logs.length} onClick={() => { close(); downloadText(logText(logs), '运行日志-当前视图.txt'); }}>导出当前视图</button>
          <button type="button" role="menuitem" disabled={!run || scope === 'all' || exporting} onClick={() => { close(); void exportDiagnostics(); }}>导出本次完整诊断</button>
          <p className="automation-log-menu-hint">{scope === 'all' ? '选择一次运行后可导出完整诊断。' : run?.diagnosticsIncomplete ? '此次运行曾关闭日志保存，诊断文件可能不完整。' : '导出已保存的完整文件；运行中导出截至当前的内容。'}</p>
          <button type="button" role="menuitem" disabled={!snapshot.logs.length} onClick={() => { close(); void perform(() => api?.clearLogs(), '已清空全部界面日志，磁盘诊断文件保留'); }}>清空显示</button>
          <p className="automation-log-menu-hint">清空全部界面日志，不删除磁盘文件。</p>
        </>}</AutomationPopover>
      </div>
      {(source || phase || level || search) && <div className="automation-log-active-filters"><span>{[source, phase, level ? logLevelLabels[level as keyof typeof logLevelLabels] : '', search ? `关键词：${search}` : ''].filter(Boolean).join(' · ')}</span><button type="button" onClick={resetFilters}>重置筛选</button></div>}
      <AutomationLogList key={viewKey} logs={logs} query={search} storageLimited={snapshot.logs.length >= 10000} onPause={() => {
        manualSelection();
        if (scope !== 'all' && run) setRunId(run.id);
        if (scope === 'round' && run && round && !selection) setSelection({ runId: run.id, number: round.number });
      }}/>
    </>}
  </section>;
}
