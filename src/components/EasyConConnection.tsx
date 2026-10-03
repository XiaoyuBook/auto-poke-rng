import { RefreshCw, Usb } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDevices } from '../useDevices';
import { useDeviceConnections } from '../useDeviceConnections';

export function EasyConConnection() {
  const { controller } = useDevices();
  const api = window.desktop?.devices?.controller;
  const { state: connections, ready } = useDeviceConnections();
  const initialized = useRef(false);
  const [ports, setPorts] = useState<{ id: string; name: string }[]>([]);
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const connected = controller.status === 'connected';
  const connecting = controller.status === 'connecting';
  const statusClass = connected ? 'success' : controller.status === 'failed' ? 'failed' : 'warning';

  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    const saved = connections.preferences.controller;
    if (saved) setPort(connected ? controller.name || saved.port : saved.port);
  }, [ready, connections.preferences.controller, connected, controller.name]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    setBusy(true);
    setError('');
    void api.list().then(items => {
      if (!active) return;
      setPorts(items);
      setPort(current => current || items[0]?.id || '');
    }).catch(value => {
      if (active) setError(value instanceof Error ? value.message : String(value));
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [api, refresh]);

  const action = async () => {
    if (!api) return;
    setBusy(true);
    setError('');
    try {
      if (connected || connecting) await api.disconnect();
      else await api.connect(port);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <p className="dialog-intro">选择串口并连接伊机控单片机。连接成功后，虚拟手柄和脚本会共用这个设备。</p>
    {!api && <p className="device-error">请使用桌面应用连接伊机控。</p>}
    {api && <div className="device-form">
      <label>串口
        <div className="device-select-row">
          <select aria-label="伊机控串口" value={port} disabled={busy || connected || connecting} onChange={event => setPort(event.target.value)}>
            {port && !ports.some(item => item.id === port) && <option value={port}>{port}（未找到）</option>}
            {!ports.length && !port && <option value="">未发现串口</option>}
            {ports.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button className="icon-button" aria-label="刷新串口" disabled={busy || connected || connecting} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} /></button>
        </div>
      </label>
    </div>}
    <div className="device-state">
      <Usb size={19} />
      <div>
        <strong>{connected ? '单片机已连接' : connecting ? '正在连接伊机控…' : controller.status === 'failed' ? '伊机控连接失败' : '单片机未连接'}</strong>
        {connected && <p>{controller.name || port}</p>}
      </div>
      <span className={'status-dot ' + statusClass} />
    </div>
    {(error || controller.message) && <p className="device-error" role="alert">{error || controller.message}</p>}
    <button className="button primary" disabled={!api || busy || (!connected && !connecting && !ports.some(item => item.id === port))} onClick={() => void action()}>
      {connecting ? '取消连接' : connected ? '断开伊机控' : '连接伊机控'}
    </button>
  </>;
}
