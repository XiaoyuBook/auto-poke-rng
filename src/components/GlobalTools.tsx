import { Bell, Gamepad2, Tv } from 'lucide-react';

export type ConnectionStatus = 'idle' | 'failed' | 'connected';
export interface DeviceConnections {
  video: ConnectionStatus;
  controller: ConnectionStatus;
}

export const initialConnections: DeviceConnections = { video: 'idle', controller: 'idle' };
const connectionLabels: Record<ConnectionStatus, string> = {
  idle: '未尝试连接', failed: '连接失败', connected: '连接成功',
};

interface Props {
  connections: DeviceConnections;
  unread: boolean;
  open: (tool: 'video' | 'controller' | 'notification') => void;
}

export function GlobalTools({ connections, unread, open }: Props) {
  return <div className="sidebar-actions" role="group" aria-label="全局工具">
    {([
      { tool: 'video', name: '视频源', icon: <Tv size={16} /> },
      { tool: 'controller', name: '虚拟手柄', icon: <Gamepad2 size={16} /> },
    ] as const).map(({ tool, name, icon }) => {
      const status = connections[tool];
      const label = name + '：' + connectionLabels[status];
      return <button key={tool} className="icon-button" type="button" title={label} aria-label={label}
        data-connection-status={status} onClick={() => open(tool)}>
        {icon}
        {status !== 'idle' && <span className={'tool-status-dot ' + status} aria-hidden="true" />}
      </button>;
    })}
    <button className="icon-button" type="button" title={unread ? '通知：有未读通知' : '通知：无未读通知'}
      aria-label={unread ? '通知：有未读通知' : '通知：无未读通知'} onClick={() => open('notification')}>
      <Bell size={16} />{unread && <span className="tool-status-dot unread" aria-hidden="true" />}
    </button>
  </div>;
}
