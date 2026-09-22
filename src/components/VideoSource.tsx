import { useEffect, useState } from 'react';
import { RefreshCw, Tv } from 'lucide-react';
import { useDevices } from '../useDevices';
import type { VideoDevice } from '../devices';

export function VideoSource() {
  const { video } = useDevices();
  const api = window.desktop?.devices?.video;
  const [backend, setBackend] = useState(video.backend || 'msmf');
  const [devices, setDevices] = useState<VideoDevice[]>([]);
  const [selected, setSelected] = useState(video.deviceId || '');
  const [size, setSize] = useState('1920x1080');
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!api) return;
    let active = true;
    setBusy(true); setError('');
    void api.list(backend).then(items => {
      if (!active) return;
      setDevices(items); setSelected(current => items.some(item => item.id === current) ? current : items[0]?.id || '');
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, backend, refresh]);
  const connected = video.status === 'connected', connecting = video.status === 'connecting';
  const action = async () => {
    if (!api) return;
    setBusy(true); setError('');
    try {
      if (connected || connecting) await api.disconnect();
      else { const [width, height] = size.split('x').map(Number); await api.connect({ deviceId: selected, backend, width, height, fps }); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <>
    <p className="dialog-intro">预览、截图和识别共用这个视频源，关闭预览窗口不会断开连接。</p>
    {!api && <p className="device-error">请使用桌面应用连接设备。</p>}
    <div className="device-form">
      <label>采集后端<select aria-label="采集后端" value={backend} disabled={busy || connected || connecting} onChange={e => setBackend(e.target.value)}><option value="msmf">Media Foundation</option><option value="dshow">DirectShow（兼容）</option></select></label>
      <label>视频设备<div className="device-select-row"><select aria-label="视频设备" value={selected} disabled={busy || connected || connecting} onChange={e => setSelected(e.target.value)}>{!devices.length && <option value="">未发现视频设备</option>}{devices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="icon-button" aria-label="刷新视频设备" disabled={busy || connected || connecting} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14} /></button></div></label>
      <label>分辨率<select aria-label="采集分辨率" value={size} disabled={busy || connected || connecting} onChange={e => setSize(e.target.value)}><option>1920x1080</option><option>1280x720</option><option>640x480</option></select></label>
      <label>帧率<select aria-label="采集帧率" value={fps} disabled={busy || connected || connecting} onChange={e => setFps(Number(e.target.value))}><option value={30}>30 FPS</option><option value={60}>60 FPS</option></select></label>
    </div>
    <div className="device-state"><Tv size={19} /><div><strong>{connected ? '视频源已连接' : connecting ? '正在连接视频源…' : video.status === 'failed' ? '视频源连接失败' : '尚未连接视频源'}</strong>{connected && <p>{video.name} · {video.width} × {video.height}</p>}</div><span className={'status-dot ' + (connected ? 'success' : 'warning')} /></div>
    {(error || video.message) && <p className="device-error" role="alert">{error || video.message}</p>}
    <button className="button primary" disabled={!api || busy || (!connected && !connecting && !selected)} onClick={() => void action()}>{connecting ? '取消连接' : connected ? '断开视频源' : '连接视频源'}</button>
  </>;
}
