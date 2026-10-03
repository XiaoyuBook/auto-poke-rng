import { Bell, Gamepad2, LoaderCircle, PlugZap, Tv } from 'lucide-react';
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
  open: (tool: 'video' | 'easycon' | 'notification') => void;
  reconnect: () => void;
  reconnectBusy: boolean;
  reconnectAvailable: boolean;
  messages?: { video?: string; controller?: string };
}

export function GlobalTools({ connections, notificationStatus, open, reconnect, reconnectBusy, reconnectAvailable, messages }: Props) {
  const notificationLabel = 'QQ 通知：' + qqStatusLabels[notificationStatus];
  const notificationDot = notificationStatus === 'ready' ? 'connected' : notificationStatus === 'busy' ? 'connecting' : notificationStatus === 'failed' ? 'failed' : '';
  return <div className="sidebar-actions" role="group" aria-label="全局工具">
    {([
      { tool: 'video', name: '视频源', icon: <Tv size={16} /> },
      { tool: 'easycon', name: '伊机控', icon: <Gamepad2 size={16} /> },
    ] as const).map(({ tool, name, icon }) => {
      const status = tool === 'easycon' ? connections.controller : connections.video;
      const label = name + '：' + connectionLabels[status] + (messages?.[tool === 'easycon' ? 'controller' : 'video'] ? '，' + messages[tool === 'easycon' ? 'controller' : 'video'] : '');
      return <button key={tool} className="icon-button" type="button" title={label} aria-label={label}
        data-connection-status={status} onClick={() => open(tool)}>
        {icon}
        {status !== 'idle' && <span className={'tool-status-dot ' + status} aria-hidden="true" />}
      </button>;
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
