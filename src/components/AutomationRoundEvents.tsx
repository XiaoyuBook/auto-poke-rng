import { useState } from 'react';
import type { AutomationRound } from '../automation';
import { describeRoundEvent } from '../automationLogs';

export function RawLogData({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  return <details className="automation-raw-log" onToggle={event => setOpen(event.currentTarget.open)}><summary>原始数据</summary>{open && <pre>{JSON.stringify(value, null, 2)}</pre>}</details>;
}

export function AutomationRoundEvents({ events }: { events: AutomationRound['events'] }) {
  const [open, setOpen] = useState(false);
  return <details className="automation-record-diagnostics" onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary>关键事件与诊断 · {events.length} 条</summary>
    {open && (events.length ? <ol className="automation-event-list">{events.map((event, index) => {
      const description = describeRoundEvent(event);
      return <li key={index}><strong className={`log-${description.level}`}>{description.title}</strong><p>{description.detail}</p><RawLogData value={event}/></li>;
    })}</ol> : <p>本轮尚未记录关键事件。</p>)}
  </details>;
}
