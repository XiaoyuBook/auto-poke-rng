import { useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, Gamepad2, MonitorPlay, Tv } from 'lucide-react';
import type { Modal } from '../workspace';
import { Dialog } from './Dialog';

export function ToolsDialog({ modal, close, onInput }: { modal: Modal; close: () => void; onInput: (key: string) => void }) {
  const titles: Record<Modal, string> = { video: '视频源', controller: '虚拟手柄', notification: '通知', mapping: '按键映射', help: '脚本编辑帮助' };
  return (
    <Dialog title={titles[modal]} close={close}>
      <div className="dialog-body">
        {modal === 'video' && <>
          <p className="dialog-intro">选择脚本与视频预览使用的画面来源。</p>
          <div className="device-state"><Tv size={19} /><div><strong>尚未连接视频源</strong><p>设备采集将在后续版本接入。</p></div><span className="status-dot warning" /></div>
        </>}
        {modal === 'notification' && <div className="notice"><Bell size={18} /><div><strong>工作区已就绪</strong><p>当前为界面预览版本，可以编辑脚本、预览运行状态和手柄输入。</p></div></div>}
        {modal === 'controller' && <Controller onInput={onInput} />}
        {modal === 'mapping' && <>
          <p className="dialog-intro">当前输入面板的按键对应关系。</p>
          <div className="mapping-list">{[['确认', 'A'], ['取消', 'B'], ['菜单', '+'], ['方向', '↑ ↓ ← →']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div>
        </>}
        {modal === 'help' && <>
          <p className="dialog-intro">在右侧编辑脚本，每行记录一个操作。当前运行和录制仅用于预览界面反馈。</p>
          <dl className="help-list">
            <div><dt><code># 注释</code></dt><dd>描述这段操作的用途</dd></div>
            <div><dt><code>wait 1000</code></dt><dd>等待 1000 毫秒</dd></div>
            <div><dt><code>press A</code></dt><dd>按下 A 键</dd></div>
          </dl>
          <div className="help-shortcuts"><span><kbd>Ctrl K</kbd> 快速查找</span><span><kbd>Ctrl S</kbd> 保存当前文件</span></div>
        </>}
      </div>
    </Dialog>
  );
}

function Controller({ onInput }: { onInput: (key: string) => void }) {
  const [lastInput, setLastInput] = useState('等待输入');
  const press = (key: string) => { setLastInput(key); onInput(key); };
  return <>
    <p className="dialog-intro">点击按键查看输入反馈。</p>
    <div className="controller-preview">
      <div className="dpad">
        <button className="up" aria-label="向上" onClick={() => press('↑')}><ArrowUp size={16} /></button>
        <button className="left" aria-label="向左" onClick={() => press('←')}><ArrowLeft size={16} /></button>
        <span className="dpad-center" />
        <button className="right" aria-label="向右" onClick={() => press('→')}><ArrowRight size={16} /></button>
        <button className="down" aria-label="向下" onClick={() => press('↓')}><ArrowDown size={16} /></button>
      </div>
      <div className="controller-center"><Gamepad2 size={22} /><output aria-live="polite">{lastInput}</output><button aria-label="菜单加号" onClick={() => press('+')}>+</button></div>
      <div className="face-buttons">{['X', 'Y', 'A', 'B'].map(key => <button key={key} className={'key-' + key} onClick={() => press(key)}>{key}</button>)}</div>
    </div>
    <p className="dialog-footnote">输入仅在此窗口预览，不会发送到设备。</p>
  </>;
}

export function VideoPreview({ openSource }: { openSource: () => void }) {
  return (
    <section className="video-preview-content" aria-label="视频画面">
      <div className="preview-stage">
        <div className="preview-frame"><MonitorPlay size={28} /><strong>等待视频源连接</strong></div>
      </div>
      <footer className="video-preview-footer"><span><span className="status-dot warning" />未连接视频源</span><button className="button" onClick={openSource}>选择视频源</button></footer>
    </section>
  );
}
