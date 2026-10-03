import { CircleAlert, PlugZap, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReconnectResult } from '../devices';

export function ConnectionNotice({ notice, close, retry, busy }: { notice: ReconnectResult; close: () => void; retry: () => void; busy: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(8000);
  const paused = hovered || focused;
  useEffect(() => { remaining.current = 8000; }, [notice.id]);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(close, remaining.current);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [notice.id, paused, close]);
  return <div className="connection-notice" role="alert" aria-label="设备连接提示"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="connection-notice-heading"><CircleAlert size={16} /><strong>{notice.failures.length ? '部分设备连接失败' : '设备连接'}</strong><button type="button" className="icon-button" aria-label="关闭设备连接提示" onClick={close}><X size={14} /></button></div>
    {notice.message && <p>{notice.message}</p>}
    {notice.failures.map(item => <p key={item.device}><strong>{item.name}</strong>：{item.message}</p>)}
    {notice.failures.length > 0 && <div className="connection-notice-actions"><span>已连接的设备继续保留</span><button type="button" className="text-button" disabled={busy} onClick={retry}><PlugZap size={13} />重试失败项</button></div>}
  </div>;
}
