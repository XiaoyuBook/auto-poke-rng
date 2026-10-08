import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { LogEntry } from '../workspace';
import { LOG_ROW_HEIGHT, logLevelLabels, logPreview } from '../automationLogs';
import { AutomationLogDetail, LogHighlight } from './AutomationLogDetail';

const LevelIcon = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };
const LogRow = memo(function LogRow({ row, index, count, query, open, selected, detailId }: { row: LogEntry; index: number; count: number; query: string; open: (row: LogEntry) => void; selected: boolean; detailId: string }) {
  const Icon = LevelIcon[row.level];
  return <div className="automation-log-row" role="listitem" aria-posinset={index + 1} aria-setsize={count} data-log-id={row.id} data-selected={selected} style={{ height: LOG_ROW_HEIGHT }}>
    <time title={row.timestamp}>{row.time}</time>
    <div className="automation-log-entry">
      <button type="button" className="automation-log-message" aria-label={`查看日志详情：${row.time}，${logLevelLabels[row.level]}，第 ${index + 1} 条`} aria-expanded={selected} aria-controls={selected ? detailId : undefined} onClick={() => open(row)}><LogHighlight text={logPreview(row.message, query)} query={query}/></button>
      <div className="automation-log-meta"><span className={`log-${row.level}`}><Icon size={12} aria-hidden="true"/>{logLevelLabels[row.level]}</span><span><LogHighlight text={row.source} query={query}/></span>{row.phase && <span><LogHighlight text={row.phase} query={query}/></span>}{row.round !== undefined && <span>第 {row.round} 轮</span>}</div>
    </div>
  </div>;
});

export function AutomationLogList({ logs, query, storageLimited = false, onPause }: { logs: LogEntry[]; query: string; storageLimited?: boolean; onPause?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(304), [top, setTop] = useState(0);
  const [follow, setFollow] = useState(true), [unread, setUnread] = useState(0), [expired, setExpired] = useState(false);
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const detailId = useId();
  const detailIndex = detail ? logs.findIndex(row => row.id === detail.id) : -1;
  const following = useRef(true), previousLast = useRef<string | undefined>(undefined);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const totalHeight = logs.length * LOG_ROW_HEIGHT;
  const jumpToLatest = () => {
    setDetail(null);
    following.current = true; setFollow(true); setUnread(0); setExpired(false);
    const next = Math.max(0, totalHeight - (viewport.current?.clientHeight || height));
    if (viewport.current) viewport.current.scrollTop = next;
    setTop(next);
  };
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => { if (element.clientHeight) setHeight(element.clientHeight); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const last = logs.at(-1)?.id;
    if (following.current) {
      const next = Math.max(0, totalHeight - (element.clientHeight || height));
      element.scrollTop = next; setTop(next);
    } else {
      if (last !== previousLast.current && last) {
        const seen = logs.findIndex(row => row.id === previousLast.current);
        setUnread(value => value + (seen < 0 ? logs.length : logs.length - seen - 1));
      }
      if (anchor.current) {
        const index = logs.findIndex(row => row.id === anchor.current?.id);
        if (index >= 0) {
          const next = index * LOG_ROW_HEIGHT + anchor.current.offset;
          element.scrollTop = next; setTop(next);
        } else if (logs.length) {
          element.scrollTop = 0; setTop(0); setExpired(true);
          anchor.current = { id: logs[0].id, offset: 0 };
        }
      }
    }
    if (!logs.length) {
      following.current = true; setFollow(true); setUnread(0); setExpired(false); anchor.current = null;
      setDetail(null);
      element.scrollTop = 0; setTop(0);
    }
    previousLast.current = last;
  }, [logs, totalHeight, height]);
  const rememberPosition = (scrollTop: number) => {
    const index = Math.min(logs.length - 1, Math.floor(scrollTop / LOG_ROW_HEIGHT));
    anchor.current = logs[index] ? { id: logs[index].id, offset: scrollTop - index * LOG_ROW_HEIGHT } : null;
  };
  const pause = () => {
    onPause?.(); following.current = false; setFollow(false);
    rememberPosition(viewport.current?.scrollTop || 0);
  };
  const openDetail = (row: LogEntry) => {
    pause(); setDetail(row);
  };
  const closeDetail = () => {
    setDetail(null);
    queueMicrotask(() => {
      const row = Array.from(viewport.current?.querySelectorAll<HTMLElement>('[data-log-id]') || []).find(row => row.dataset.logId === detail?.id);
      (row?.querySelector<HTMLButtonElement>('button') || viewport.current)?.focus({ preventScroll: true });
    });
  };
  const browseDetail = (index: number) => {
    if (!logs[index] || !viewport.current) return;
    pause(); setDetail(logs[index]);
  };
  useLayoutEffect(() => {
    const element = viewport.current;
    if (detailIndex < 0 || !element) return;
    const viewHeight = element.clientHeight || height;
    const rowTop = detailIndex * LOG_ROW_HEIGHT;
    const next = rowTop < element.scrollTop ? rowTop : rowTop + LOG_ROW_HEIGHT > element.scrollTop + viewHeight ? Math.max(0, rowTop + LOG_ROW_HEIGHT - viewHeight) : element.scrollTop;
    element.scrollTop = next; setTop(next); rememberPosition(next);
    // Reposition for selection or size changes, preserving manual scrolling when logs arrive.
  }, [detailIndex, height]);
  const start = Math.max(0, Math.min(logs.length - 1, Math.floor(top / LOG_ROW_HEIGHT) - 5));
  const end = Math.min(logs.length, start + Math.ceil(height / LOG_ROW_HEIGHT) + 11);
  return <div className="automation-log-body" data-detail-open={!!detail} onKeyDown={event => {
    if (detail && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDetail(); }
  }}>
    <div className="automation-log-stream">
    <div ref={viewport} className="automation-log-lines" role="region" aria-label="日志内容" tabIndex={0} onScroll={event => {
      const element = event.currentTarget, scrollTop = element.scrollTop;
      setTop(scrollTop);
      const atBottom = !detail && totalHeight - (element.clientHeight || height) - scrollTop <= 12;
      if (following.current && !atBottom) onPause?.();
      following.current = atBottom; setFollow(atBottom);
      if (atBottom) { setUnread(0); setExpired(false); }
      rememberPosition(scrollTop);
    }}>
      {logs.length ? <div role="list" aria-label="运行日志列表" className="automation-log-virtual-space" style={{ height: totalHeight }}><div className="automation-log-visible-rows" style={{ top: start * LOG_ROW_HEIGHT }}>{logs.slice(start, end).map((row, index) => <LogRow key={row.id} row={row} index={start + index} count={logs.length} query={query} open={openDetail} selected={detail?.id === row.id} detailId={detailId}/>)}</div></div> : <p className="automation-log-empty">当前范围和筛选条件下没有日志。</p>}
    </div>
    <footer className="automation-log-footer">
      <span>{logs.length} 条摘要{storageLimited ? ' · 缓存上限 10,000 条' : ''}</span>
      <label><input type="checkbox" checked={follow} onChange={event => { if (event.target.checked) jumpToLatest(); else pause(); }}/>跟随最新</label>
      {!follow && <button type="button" onClick={jumpToLatest}><ArrowDown size={13} aria-hidden="true"/>{unread ? `新增 ${unread} 条 · 回到最新` : '回到最新'}</button>}
      {expired && <span role="status">较早记录已移出缓存，已定位到最早可用记录。</span>}
    </footer>
    </div>
    {detail && <AutomationLogDetail id={detailId} log={detail} query={query} index={detailIndex} total={logs.length} previous={() => browseDetail(detailIndex - 1)} next={() => browseDetail(detailIndex + 1)} close={closeDetail}/>}
  </div>;
}
