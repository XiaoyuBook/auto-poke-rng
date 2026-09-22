import { FileClock, ListFilter } from 'lucide-react';
import type { LogEntry } from '../workspace';
import type { LogSource } from '../desktop';

export function LogsPanel({ logs, clear, source, setSource }: {
  logs: LogEntry[]; clear: () => void; source: LogSource; setSource: (source: LogSource) => void;
}) {
  const filtered = logs.filter(log => source === '全部来源' || log.source === source);
  return (
    <section className="logs-panel" aria-label="日志记录">
      <div className="logs-toolbar">
        <label className="log-filter"><ListFilter size={14} />
          <select aria-label="筛选日志来源" value={source} onChange={event => setSource(event.target.value as LogSource)}>
            {['全部来源', '系统', '脚本', '手柄'].map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <span className="muted">{filtered.length} 条记录</span>
        <button className="text-button" disabled={!logs.length} onClick={clear}>清空日志</button>
      </div>
      {filtered.length ? (
        <div className="logs-table-scroll">
          <table className="logs-table">
            <thead><tr><th>时间</th><th>来源</th><th>内容</th></tr></thead>
            <tbody>{filtered.map(log => <tr key={log.id}><td className="mono">{log.time}</td><td className="muted">{log.source}</td><td><span className={'status-dot ' + log.level} />{log.message}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <div className="empty-state"><FileClock size={26} /><h2>暂无日志</h2><p>{source === '全部来源' ? '运行和操作记录会显示在这里。' : '当前来源还没有记录。'}</p></div>}
    </section>
  );
}
