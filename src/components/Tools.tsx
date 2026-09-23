import { Bell, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Modal } from '../workspace';
import { Dialog } from './Dialog';
import { VideoSource } from './VideoSource';
import { Controller } from './Controller';
import { EasyConConnection } from './EasyConConnection';

export function ToolsDialog({ modal, close, onInput }: { modal: Modal; close: () => void; onInput: (key: string) => void }) {
  const titles: Record<Modal, string> = { video: '视频源', easycon: '伊机控连接', controller: '虚拟手柄', notification: '通知', mapping: '按键映射', help: '脚本编辑帮助', settings: '设置' };
  return (
    <Dialog title={titles[modal]} close={close}>
      <div className="dialog-body">
        {modal === 'settings' && <OverlayScaleSetting />}
        {modal === 'video' && <VideoSource />}
        {modal === 'easycon' && <EasyConConnection />}
        {modal === 'notification' && <div className="notice"><Bell size={18} /><div><strong>工作区已就绪</strong><p>可连接视频源和伊机控，执行脚本并查看实时画面。</p></div></div>}
        {modal === 'controller' && <Controller onInput={onInput} />}
        {modal === 'help' && <>
          <p className="dialog-intro">在右侧编辑 EasyCon 脚本，每行记录一个操作。桌面端连接伊机控后可执行，输入录制仍为预览。</p>
          <dl className="help-list">
            <div><dt><code># 注释</code></dt><dd>描述这段操作的用途</dd></div>
            <div><dt><code>wait 1000</code></dt><dd>等待 1000 毫秒</dd></div>
            <div><dt><code>A 100</code></dt><dd>按住 A 键 100 毫秒；也兼容 press A</dd></div>
          </dl>
          <div className="help-shortcuts"><span><kbd>Ctrl K</kbd> 快速查找</span><span><kbd>Ctrl S</kbd> 保存当前文件</span></div>
        </>}
      </div>
    </Dialog>
  );
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
