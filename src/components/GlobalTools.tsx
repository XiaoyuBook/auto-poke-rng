import { useEffect, useRef, useState } from 'react';
import { Bell, Cable, Gamepad2, Keyboard, LoaderCircle, PlugZap, Tv } from 'lucide-react';
import { qqStatusLabels, type QQStatus } from '../notifications';

export type ConnectionStatus = 'idle' | 'connecting' | 'failed' | 'connected';
export interface DeviceConnections {
  video: ConnectionStatus;
  controller: ConnectionStatus;
}

export const initialConnections: DeviceConnections = { video: 'idle', controller: 'idle' };
const connectionLabels: Record<ConnectionStatus, string> = {
  idle: '未尝试连接', connecting: '正在连接', failed: '连接失败', connected: '连接成功',
};

interface Props {
  connections: DeviceConnections;
  notificationStatus: QQStatus;
  open: (tool: 'video' | 'easycon' | 'mapping' | 'notification') => void;
  reconnect: () => void;
  reconnectBusy: boolean;
  reconnectAvailable: boolean;
  virtualControllerOpen: boolean;
  toggleVirtualController: () => void;
  messages?: { video?: string; controller?: string };
}

export function GlobalTools({ connections, notificationStatus, open, reconnect, reconnectBusy, reconnectAvailable, virtualControllerOpen, toggleVirtualController, messages }: Props) {
  const [controllerMenuOpen, setControllerMenuOpen] = useState(false);
  const controllerTools = useRef<HTMLDivElement>(null);
  const controllerButton = useRef<HTMLButtonElement>(null);
  const controllerMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!controllerMenuOpen) return;
    controllerMenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outsideClick = (event: PointerEvent) => {
      if (!controllerTools.current?.contains(event.target as Node)) setControllerMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setControllerMenuOpen(false);
      controllerButton.current?.focus();
    };
    document.addEventListener('pointerdown', outsideClick);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outsideClick);
      document.removeEventListener('keydown', escape);
    };
  }, [controllerMenuOpen]);
  const chooseControllerTool = (action: () => void) => {
    setControllerMenuOpen(false);
    controllerButton.current?.focus();
    action();
  };
  const notificationLabel = 'QQ 通知：' + qqStatusLabels[notificationStatus];
  const notificationDot = notificationStatus === 'ready' ? 'connected' : notificationStatus === 'busy' ? 'connecting' : notificationStatus === 'failed' ? 'failed' : '';
  return <div className="sidebar-actions" role="group" aria-label="全局工具">
    {([
      { tool: 'video', name: '视频源', icon: <Tv size={16} /> },
      { tool: 'easycon', name: '伊机控', icon: <Gamepad2 size={16} /> },
    ] as const).map(({ tool, name, icon }) => {
      const status = tool === 'easycon' ? connections.controller : connections.video;
      const label = name + '：' + connectionLabels[status] + (messages?.[tool === 'easycon' ? 'controller' : 'video'] ? '，' + messages[tool === 'easycon' ? 'controller' : 'video'] : '');
      const button = <button key={tool} ref={tool === 'easycon' ? controllerButton : undefined}
        className={'icon-button ' + (tool === 'easycon' && (controllerMenuOpen || virtualControllerOpen) ? 'active' : '')} type="button"
        title={tool === 'easycon' ? label + '；连接设置、虚拟手柄、按键映射' : label} aria-label={label}
        aria-haspopup={tool === 'easycon' ? 'menu' : undefined} aria-expanded={tool === 'easycon' ? controllerMenuOpen : undefined}
        data-connection-status={status} onClick={() => tool === 'easycon' ? setControllerMenuOpen(value => !value) : open(tool)}
        onKeyDown={tool === 'easycon' ? event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setControllerMenuOpen(true); }
        } : undefined}>
        {icon}
        {status !== 'idle' && <span className={'tool-status-dot ' + status} aria-hidden="true" />}
      </button>;
      if (tool !== 'easycon') return button;
      return <div key={tool} ref={controllerTools} className="controller-tools" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setControllerMenuOpen(false);
      }}>
        {button}
        {controllerMenuOpen && <div ref={controllerMenu} className="controller-tools-menu" role="menu" aria-label="手柄工具" onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => chooseControllerTool(() => open('easycon'))}><Cable size={15} />连接设置</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => chooseControllerTool(toggleVirtualController)}><Gamepad2 size={15} />{virtualControllerOpen ? '关闭虚拟手柄' : '打开虚拟手柄'}</button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => chooseControllerTool(() => open('mapping'))}><Keyboard size={15} />按键映射</button>
        </div>}
      </div>;
    })}
    <button className="icon-button" type="button" title={reconnectBusy ? '正在按上次配置重连' : '按上次重连'} aria-label={reconnectBusy ? '正在按上次配置重连' : '按上次重连'} aria-busy={reconnectBusy}
      disabled={!reconnectAvailable || reconnectBusy} onClick={reconnect}>
      {reconnectBusy ? <LoaderCircle size={16} className="connection-spinning" /> : <PlugZap size={16} />}
    </button>
    <button className="icon-button" type="button" title={notificationLabel}
      aria-label={notificationLabel} onClick={() => open('notification')}>
      <Bell size={16} />{notificationDot && <span className={'tool-status-dot ' + notificationDot} aria-hidden="true" />}
    </button>
  </div>;
}
