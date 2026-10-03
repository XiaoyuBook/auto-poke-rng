import type { AutomationRound, AutomationRun, FrlgRoundRequest } from '../automation';
import type { LogEntry } from '../workspace';
import { isFrlgDiagnosticLog } from '../frlgExecution';

const signed = (value?: number) => value === undefined ? '—' : value > 0 ? `+${value}` : String(value);
const statusText: Record<string, string> = { running: '运行中', completed: '已完成', stopped: '已停止', failed: '失败' };
function RequestMetrics({ request }: { request: Partial<FrlgRoundRequest> }) {
  const labels = { seedMs: 'Seed 等待', f1: 'F1', tv: 'TV', f2: 'F2', menu: '菜单奇偶', held: 'Held', pickup: 'Pickup' };
  return <dl className="frlg-round-request">{Object.entries(labels).map(([key, label]) => {
    const value = request[key as keyof FrlgRoundRequest];
    return value === undefined ? null : <div key={key}><dt>{label}</dt><dd>{value}{key === 'seedMs' ? ' ms' : key === 'menu' ? '' : ' 帧'}</dd></div>;
  })}</dl>;
}

export function FrlgRoundDetails({ run, round, logs, openLogs }: { run: AutomationRun; round?: AutomationRound; logs: LogEntry[]; openLogs: (round?: number) => void }) {
  const data = round?.frlg;
  const rows = logs.filter(row => row.runId === run.id && (!round || row.round === round.number) && !isFrlgDiagnosticLog(row.message, row.detailOnly)).slice(-8);
  const target = run.context && 'target' in run.context ? run.context.target : '';
  const clock = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
  const request = data?.request || (data && { f1: data.f1, tv: data.tv, f2: data.f2 });
  return <section className="frlg-round-detail" aria-label="火叶轮次详情">
    <header><div><strong>{round ? round.number === 0 ? '第 0 轮 · 准备与计时校准' : `第 ${round.number} 轮 · ${round.outcome}` : '本次运行概览'}</strong><span>{target || '火叶自动流程'} · {statusText[run.status] || run.status}</span></div><button onClick={() => openLogs(round?.number)}>查看火叶运行日志</button></header>
    {round?.startedAt && <p className="muted">{clock(round.startedAt)} 开始{round.endedAt ? ` · ${clock(round.endedAt)} 结束` : ' · 持续更新'}</p>}
    <dl className="frlg-round-results"><div><dt>实际 Seed</dt><dd>{data?.hitSeed || '—'}</dd></div><div><dt>Seed 偏差</dt><dd>{signed(data?.seedOffset)}<small> 个</small></dd></div><div><dt>实际消耗帧</dt><dd>{data?.hitFrame ?? '—'}</dd></div><div><dt>帧偏差</dt><dd>{signed(data?.frameError)}<small> 帧</small></dd></div></dl>
    {data?.seedMsError !== undefined && <p className="muted">Seed 计时误差 {signed(data.seedMsError)} ms</p>}
    {data?.candidateCount !== undefined && <p className="muted">反查匹配 {data.candidateCount} 个候选</p>}
    {request && Object.values(request).some(value => value !== undefined) && <section className="frlg-round-section"><h3>本轮执行参数</h3><RequestMetrics request={request}/></section>}
    {(data?.nextRequest || data?.nextSeedMs !== undefined) && <section className="frlg-round-section"><h3>下轮请求</h3><RequestMetrics request={data.nextRequest || { seedMs: data.nextSeedMs }}/></section>}
    {!!data?.notes?.length && <section className="frlg-round-section"><h3>校准判断</h3><ul>{data.notes.map(note => <li key={note}>{note}</li>)}</ul></section>}
    {!data?.hitSeed && <p className="frlg-round-pending">{!round ? '此运行尚无结构化轮次数据，下方显示已收到的运行事件。' : data?.result === '校准跳过' ? '本轮反查后跳过校准，未输出完整落点；具体原因见校准判断。' : round.endedAt || run.endedAt ? '本轮已结束，没有收到完整反查落点。' : round.number === 0 ? '正在检查游戏环境与固定延迟，完成后进入目标轮次。' : '等待本轮捕获与反查结果，参数和偏差将随运行更新。'}</p>}
    {!!rows.length && <ol className="frlg-round-timeline" aria-label="轮次关键事件">{rows.map(row => <li key={row.id}><time>{row.time}</time><span className={`log-${row.level}`}>{row.message}</span></li>)}</ol>}
    {run.message && <p className="muted">{run.message}</p>}
  </section>;
}
