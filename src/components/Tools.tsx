import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Modal } from '../workspace';
import { Dialog } from './Dialog';
import { VideoSource } from './VideoSource';
import { Controller } from './Controller';
import { EasyConConnection } from './EasyConConnection';
import { ScriptHelp } from './ScriptHelp';
import { QQNotifications } from './QQNotifications';
import { useDeviceConnections } from '../useDeviceConnections';

export function ToolsDialog({ modal, close, onInput }: { modal: Modal; close: () => void; onInput: (key: string) => void }) {
  if (modal === 'notification') return <QQNotifications close={close} />;
  const titles: Record<Modal, string> = { video: '视频源', easycon: '伊机控连接', controller: '虚拟手柄', notification: '通知', mapping: '按键映射', help: '脚本编辑帮助', settings: '设置' };
  return (
    <Dialog title={titles[modal]} close={close} className={modal === 'help' ? 'script-help-dialog' : modal === 'video' ? 'video-source-dialog' : ''}>
      <div className="dialog-body">
        {modal === 'settings' && <><ConnectionSetting /><OverlayScaleSetting /></>}
        {modal === 'video' && <VideoSource />}
        {modal === 'easycon' && <EasyConConnection />}
        {modal === 'controller' && <Controller onInput={onInput} />}
        {modal === 'help' && <ScriptHelp />}
      </div>
    </Dialog>
  );
}

function ConnectionSetting() {
  const { state, api, ready } = useDeviceConnections();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (autoReconnect: boolean) => {
    if (!api) return;
    setSaving(true); setError('');
    try { await api.save({ autoReconnect }); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  return <section className="connection-setting" aria-label="设备重连设置"><h3>设备连接</h3><p>成功连接后记住设备与参数，左上角插头图标可一键重连。</p>
    <label><input type="checkbox" checked={state.preferences.autoReconnect} disabled={!api || !ready || saving} onChange={event => void save(event.target.checked)} />启动时自动重连</label>
    <small>恢复上次的设备连接，脚本由你手动开始。</small>
    {error && <p className="device-error" role="alert">{error}</p>}
  </section>;
}

function OverlayScaleSetting() {
  const api = window.desktop?.overlay;
  const [scale, setScale] = useState(() => Number(localStorage.getItem('auto-poke-rng:controller-overlay-scale')) || 1);
  useEffect(() => { void api?.getState().then(state => setScale(state.scale)).catch(() => {}); }, [api]);
  return <div className="settings-panel">
    <Settings size={26} />
    <h3>虚拟手柄</h3>
    <p>调整 Joy-Con 状态浮窗的显示大小。</p>
    <label className="settings-field">浮窗大小
      <select aria-label="虚拟手柄浮窗大小" value={scale} disabled={!api} onChange={event => { const value = Number(event.target.value); setScale(value); localStorage.setItem('auto-poke-rng:controller-overlay-scale', String(value)); void api?.setScale(value); }}>
        <option value={0.8}>80 × 80</option><option value={1}>100 × 100（默认）</option><option value={1.2}>120 × 120</option><option value={1.6}>160 × 160</option>
      </select>
    </label>
    {!api && <small>请在桌面应用中使用此设置。</small>}
  </div>;
}
