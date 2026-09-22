import { Bell, Settings } from 'lucide-react';
import type { Modal } from '../workspace';
import { Dialog } from './Dialog';
import { VideoSource } from './VideoSource';
import { Controller } from './Controller';

export function ToolsDialog({ modal, close, onInput }: { modal: Modal; close: () => void; onInput: (key: string) => void }) {
  const titles: Record<Modal, string> = { video: '视频源', controller: '虚拟手柄', notification: '通知', mapping: '按键映射', help: '脚本编辑帮助', settings: '设置' };
  return (
    <Dialog title={titles[modal]} close={close}>
      <div className="dialog-body">
        {modal === 'settings' && <div className="settings-placeholder"><Settings size={26} /><p>暂无可调整的设置</p><small>设置项将在后续版本中加入。</small></div>}
        {modal === 'video' && <VideoSource />}
        {modal === 'notification' && <div className="notice"><Bell size={18} /><div><strong>工作区已就绪</strong><p>可连接视频源和伊机控，执行脚本并查看实时画面。</p></div></div>}
        {modal === 'controller' && <Controller onInput={onInput} />}
        {modal === 'mapping' && <>
          <p className="dialog-intro">当前输入面板的按键对应关系。</p>
          <div className="mapping-list">{[['确认', 'A'], ['取消', 'B'], ['菜单', '+'], ['方向', '↑ ↓ ← →']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div>
        </>}
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
