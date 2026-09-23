import { Gamepad2, X } from 'lucide-react';
import { Controller } from './Controller';
import { useDevices } from '../useDevices';
import { useEffect } from 'react';

interface Props {
  close: () => void;
  onInput: (key: string) => void;
}

export function VirtualControllerWindow({ close, onInput }: Props) {
  const { controller } = useDevices();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);
  const connected = controller.status === 'connected';
  const locked = Boolean(controller.owned || controller.running);
  const state = controller.status === 'connecting' ? '正在连接' : connected ? locked ? '脚本占用' : '已连接' : controller.status === 'failed' ? '连接失败' : '未连接';
  const stateClass = controller.status === 'failed' ? 'failed' : controller.status === 'connecting' ? 'connecting' : connected ? locked ? 'locked' : 'connected' : 'idle';
  return <section className="virtual-controller-window" role="dialog" aria-label="虚拟手柄" aria-modal="false">
    <header className="virtual-controller-header">
      <Gamepad2 size={16} />
      <div className="virtual-controller-heading"><h2>虚拟手柄</h2><span className={'virtual-controller-state ' + stateClass}><span className="status-dot" />{state}</span></div>
      <button className="icon-button" type="button" aria-label="关闭虚拟手柄" title="关闭虚拟手柄" onClick={close}><X size={15} /></button>
    </header>
    <div className="virtual-controller-body"><Controller onInput={onInput} /></div>
  </section>;
}
