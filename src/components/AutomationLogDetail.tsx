import { Fragment, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, X } from 'lucide-react';
import { logLevelLabels, logText } from '../automationLogs';
import type { LogEntry } from '../workspace';
import { RawLogData } from './AutomationRoundEvents';

export function LogHighlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLocaleLowerCase(), term = query.toLocaleLowerCase();
  const parts = [];
  let start = 0, match = lower.indexOf(term);
  while (match !== -1) {
    parts.push(<Fragment key={start}>{text.slice(start, match)}<mark>{text.slice(match, match + query.length)}</mark></Fragment>);
    start = match + query.length;
    match = lower.indexOf(term, start);
  }
  return <>{parts}{text.slice(start)}</>;
}

function DetailContent({ log, query }: { log: LogEntry; query: string }) {
  const [notice, setNotice] = useState('');
  return <>
    <div className="automation-log-detail-body">
      <div className="automation-log-detail-meta">{log.timestamp || log.time} · {log.source} · {logLevelLabels[log.level]}{log.phase ? ` · ${log.phase}` : ''}{log.round !== undefined ? ` · 第 ${log.round} 轮` : ''}</div>
      <pre><LogHighlight text={log.message} query={query}/></pre>
      <RawLogData value={log}/>
    </div>
    <footer className="automation-log-detail-actions">
      <button type="button" onClick={() => void Promise.resolve().then(() => navigator.clipboard.writeText(logText([log]))).then(() => setNotice('已复制此条日志'), () => setNotice('复制失败'))}><Copy size={13} aria-hidden="true"/>复制此条日志</button>
      <span role="status">{notice}</span>
    </footer>
  </>;
}

export function AutomationLogDetail({ id, log, query, index, total, previous, next, close }: {
  id: string; log: LogEntry; query: string; index: number; total: number;
  previous: () => void; next: () => void; close: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  return <section ref={panel} id={id} className="automation-log-inspector" aria-label="日志详情" tabIndex={-1}>
    <header className="automation-log-detail-heading">
      <h3>日志详情</h3>
      <span aria-label="详情位置">{index >= 0 ? `${index + 1} / ${total}` : '已移出缓存'}</span>
      <nav aria-label="浏览日志详情">
        <button type="button" aria-label="上一条日志" title="上一条日志" disabled={index <= 0} onClick={previous}><ChevronLeft size={16}/></button>
        <button type="button" aria-label="下一条日志" title="下一条日志" disabled={index < 0 || index >= total - 1} onClick={next}><ChevronRight size={16}/></button>
        <button type="button" aria-label="关闭日志详情" title="关闭日志详情 (Esc)" onClick={close}><X size={15}/></button>
      </nav>
    </header>
    <DetailContent key={log.id} log={log} query={query}/>
  </section>;
}
