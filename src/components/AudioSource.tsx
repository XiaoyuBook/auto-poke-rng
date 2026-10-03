import { useEffect, useRef, useState } from 'react';
import { AudioLines, RefreshCw } from 'lucide-react';
import { useDevices } from '../useDevices';
import type { AudioDevice, AudioLevel } from '../devices';
import { useDeviceConnections } from '../useDeviceConnections';

export function AudioSource() {
  const { audio = { status: 'idle' } } = useDevices();
  const api = window.desktop?.devices?.audio;
  const { state: connections, ready } = useDeviceConnections();
  const initialized = useRef(false);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selected, setSelected] = useState(audio.deviceId || '');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [level, setLevel] = useState<AudioLevel | null>(null);
  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    if (connections.preferences.audio) setSelected(audio.deviceId || connections.preferences.audio.deviceId);
  }, [ready, connections.preferences.audio, audio.deviceId]);
  useEffect(() => {
    if (!api) return;
    let active = true;
    setLoading(true); setError('');
    void api.list().then(items => {
      if (!active) return;
      setDevices(items);
      // Preserve the explicit or saved choice, even when the device is unplugged.
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refresh]);
  useEffect(() => {
    setLevel(null);
    if (audio.status !== 'connected' || !api) return;
    return api.onLevel(value => { if (value.session === audio.session) setLevel(value); });
  }, [api, audio.session, audio.status]);
  const connected = audio.status === 'connected', connecting = audio.status === 'connecting';
  const action = async () => {
    if (!api) return;
    setActing(true); setError('');
    try { if (connected || connecting) await api.disconnect(); else await api.connect({ deviceId: selected }); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setActing(false); }
  };
  const peakDb = level && level.peak > 0 ? Math.max(-60, 20 * Math.log10(level.peak)) : -60;
  return <section className="audio-source" aria-label="游戏音频采集">
    <h3><AudioLines size={17} />游戏音频</h3>
    <p className="dialog-intro">选择采集卡对应的音频输入。音频独立连接，关闭窗口后继续采集。</p>
    <div className="device-form">
      <label>音频输入<div className="device-select-row">
        <select aria-label="音频输入" value={connected || connecting ? audio.deviceId || selected : selected} disabled={!api || loading || acting || connected || connecting} onChange={event => setSelected(event.target.value)}>
          <option value="">{loading ? '正在查找音频设备…' : devices.length ? '请选择采集卡音频输入' : '未发现音频输入'}</option>
          {selected && !devices.some(item => item.id === selected) && <option value={selected}>{audio.name || connections.preferences.audio?.name || '上次的音频输入'}（未找到）</option>}
          {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select>
        <button className="icon-button" aria-label="刷新音频设备" disabled={!api || loading || acting || connected || connecting} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} /></button>
      </div></label>
    </div>
    <div className="device-state"><AudioLines size={19} /><div>
      <strong>{connected ? '音频源已连接' : connecting ? '正在连接音频源…' : audio.status === 'failed' ? '音频源连接失败' : '尚未连接音频源'}</strong>
      {connected && <p>{audio.name} · {audio.sampleRate?.toLocaleString()} Hz · {audio.channels} 声道</p>}
    </div><span className={'status-dot ' + (connected ? 'success' : 'warning')} /></div>
    {connected && <div className="audio-input-level">
      <label htmlFor="game-audio-level">输入音量</label>
      <meter id="game-audio-level" aria-label="游戏音频输入音量" min={-60} max={0} value={peakDb} />
      <span>{!level ? '等待音频数据…' : level.silent ? '已收到音频，当前静音' : `${peakDb.toFixed(1)} dBFS`}</span>
      {level?.discontinuity && <p role="status">音频出现不连续，请检查设备连接。</p>}
    </div>}
    {(error || audio.message) && <p className="device-error" role="alert">{error || audio.message}</p>}
    <button className="button primary" disabled={!api || acting || (!connected && !connecting && (loading || !devices.some(item => item.id === selected)))} onClick={() => void action()}>
      {connecting ? '取消音频连接' : connected ? '断开音频源' : '连接音频源'}
    </button>
  </section>;
}
