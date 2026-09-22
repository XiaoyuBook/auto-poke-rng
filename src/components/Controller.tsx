import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Gamepad2, RefreshCw } from 'lucide-react';
import { useDevices } from '../useDevices';

export function Controller({ onInput }: { onInput: (key: string) => void }) {
  const { controller } = useDevices();
  const api = window.desktop?.devices?.controller;
  const [ports, setPorts] = useState<{ id: string; name: string }[]>([]);
  const [port, setPort] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [lastInput, setLastInput] = useState('等待输入');
  const held = useRef(new Set<string>());
  const clicking = useRef<Promise<void> | null>(null);
  const connected = controller.status === 'connected';
  const enabled = connected && !controller.owned && !controller.running && !busy;
  const ready = useRef(enabled); ready.current = enabled;
  const reportError = (value: unknown) => setError(value instanceof Error ? value.message : String(value));
  // Preserve key-up after a mouse click sequence; sending it during that sequence
  // would be rejected as busy and could leave a previously held button down.
  const releaseAfterClick = (action: () => Promise<unknown>) => { void Promise.resolve(clicking.current).then(action).catch(reportError); };
  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.list().then(items => { if (active) { setPorts(items); setPort(current => items.some(item => item.id === current) ? current : items[0]?.id || ''); } }).catch(value => { if (active) reportError(value); });
    return () => { active = false; };
  }, [api, refresh]);
  useEffect(() => {
    if (!api) return;
    const release = () => {
      if (!held.current.size) return;
      held.current.clear(); releaseAfterClick(() => api.reset());
    };
    const keys: Record<string, string> = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', a: 'A', b: 'B', x: 'X', y: 'Y', Enter: 'PLUS' };
    const keydown = (event: KeyboardEvent) => {
      if (!ready.current || clicking.current || event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) return;
      const key = keys[event.key]; if (!key || held.current.has(key)) return;
      event.preventDefault(); held.current.add(key); setLastInput(key);
      void api.key(key, true).catch(reportError);
    };
    const keyup = (event: KeyboardEvent) => {
      const key = keys[event.key]; if (!key || !held.current.delete(key)) return;
      event.preventDefault(); releaseAfterClick(() => api.key(key, false));
    };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', release); release(); };
  }, [api]);
  const press = (key: string) => {
    setLastInput(key); onInput(key);
    if (!api) return;
    if (clicking.current) return;
    const pending = api.press(key).then(() => undefined).catch(reportError);
    clicking.current = pending;
    void pending.finally(() => { if (clicking.current === pending) clicking.current = null; });
  };
  const connect = async () => {
    if (!api) return;
    setBusy(true); setError('');
    try { if (connected) await api.disconnect(); else await api.connect(port); } catch (value) { reportError(value); }
    finally { setBusy(false); }
  };
  return <>
    <p className="dialog-intro">{api ? '连接伊机控后可点击按键。此面板内支持方向键、A / B / X / Y 和 Enter。' : '点击按键查看输入反馈。'}</p>
    {api && <div className="device-form"><label>串口<div className="device-select-row"><select aria-label="伊机控串口" value={port} disabled={busy || connected} onChange={e => setPort(e.target.value)}>{!ports.length && <option value="">未发现串口</option>}{ports.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="icon-button" aria-label="刷新串口" disabled={busy || connected} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} /></button><button className="button" disabled={busy || (!connected && !port)} onClick={() => void connect()}>{busy ? '连接中…' : connected ? '断开' : '连接'}</button></div></label></div>}
    <div className="controller-preview">
      <div className="dpad">
        <button disabled={Boolean(api) && !enabled} className="up" aria-label="向上" onClick={() => press('UP')}><ArrowUp size={16} /></button>
        <button disabled={Boolean(api) && !enabled} className="left" aria-label="向左" onClick={() => press('LEFT')}><ArrowLeft size={16} /></button>
        <span className="dpad-center" />
        <button disabled={Boolean(api) && !enabled} className="right" aria-label="向右" onClick={() => press('RIGHT')}><ArrowRight size={16} /></button>
        <button disabled={Boolean(api) && !enabled} className="down" aria-label="向下" onClick={() => press('DOWN')}><ArrowDown size={16} /></button>
      </div>
      <div className="controller-center"><Gamepad2 size={22} /><output aria-live="polite">{lastInput}</output><button disabled={Boolean(api) && !enabled} aria-label="菜单加号" onClick={() => press('PLUS')}>+</button></div>
      <div className="face-buttons">{['X', 'Y', 'A', 'B'].map(key => <button disabled={Boolean(api) && !enabled} key={key} className={'key-' + key} onClick={() => press(key)}>{key}</button>)}</div>
    </div>
    {(error || controller.message) && <p className="device-error" role="alert">{error || controller.message}</p>}
    <p className="dialog-footnote">{!api ? '输入仅在此窗口预览，不会发送到设备。' : controller.owned ? '脚本正在使用手柄，手动输入已锁定。' : connected ? `已连接 ${controller.name}，输入将发送到设备。` : '尚未连接伊机控。'}</p>
    {api && connected && <button className="button" onClick={() => void api.stop().catch(reportError)}>停止并释放全部按键</button>}
  </>;
}
