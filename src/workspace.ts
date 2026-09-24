export type Page = '首页' | '脚本编辑' | 'OCR 设置';
export type GameId = 'frlg' | 'bdsp' | 'swsh';
export type Modal = 'controller' | 'easycon' | 'video' | 'notification' | 'mapping' | 'help' | 'settings';
export type LogEntry = {
  id: string;
  time: string;
  source: '系统' | '脚本' | '手柄';
  message: string;
  level: 'info' | 'success' | 'warning';
};

export const isEasyConLog = (log: LogEntry) => log.source === '脚本' || log.source === '手柄';

export const games = [
  { id: 'frlg', label: '火叶', generation: '第三世代', detail: 'FRLG · Switch', color: '#d8817c' },
  { id: 'bdsp', label: '珍钻复刻', generation: '第八世代', detail: 'BDSP · Switch', color: '#84a0c6' },
  { id: 'swsh', label: '剑盾', generation: '第八世代', detail: 'SWSH · Switch', color: '#b09bca' },
] as const;

export const createLog = (message: string, source: LogEntry['source'] = '系统', level: LogEntry['level'] = 'info'): LogEntry => ({
  id: crypto.randomUUID(),
  time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
  source,
  message,
  level,
});

export function formatElapsed(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
