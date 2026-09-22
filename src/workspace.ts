export type Page = '首页' | '脚本编辑' | '日志中心';
export type GameId = 'frlg' | 'bdsp' | 'swsh';
export type Modal = 'controller' | 'video' | 'notification' | 'mapping' | 'help';
export type LogEntry = {
  id: string;
  time: string;
  source: '系统' | '脚本' | '手柄';
  message: string;
  level: 'info' | 'success' | 'warning';
};

export const games = [
  { id: 'frlg', label: '火叶', generation: '第三世代', detail: 'FRLG · Switch', color: '#d8817c' },
  { id: 'bdsp', label: '珍钻复刻', generation: '第八世代', detail: 'BDSP · Switch', color: '#84a0c6' },
  { id: 'swsh', label: '剑盾', generation: '第八世代', detail: 'SWSH · Switch', color: '#b09bca' },
] as const;

export const initialScript = '# 输入预览示例\n# 等待 1 秒，然后按下 A 键\n\nwait 1000\npress A\n';
export const createLog = (message: string, source: LogEntry['source'] = '系统', level: LogEntry['level'] = 'info'): LogEntry => ({
  id: crypto.randomUUID(),
  time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
  source,
  message,
  level,
});

export function readDrafts(): { drafts: Record<GameId, string>; saved: Set<GameId> } {
  const defaults = { frlg: initialScript, bdsp: initialScript, swsh: initialScript };
  const savedIds = new Set<GameId>();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('auto-poke-rng:drafts') || '{}');
    if (saved && typeof saved === 'object') {
      for (const id of Object.keys(defaults) as GameId[]) {
        const value = (saved as Record<string, unknown>)[id];
        if (typeof value === 'string') { defaults[id] = value; savedIds.add(id); }
      }
    }
  } catch { /* An unavailable or outdated local draft must not block the workspace. */ }
  return { drafts: defaults, saved: savedIds };
}

export function formatElapsed(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
