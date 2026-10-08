import type { AutomationRound } from './automation';
import type { LogEntry } from './workspace';

export const logLevelLabels = { info: '信息', success: '成功', warning: '警告', error: '错误' };
export const LOG_ROW_HEIGHT = 48;
export function logText(logs: LogEntry[]) {
  return logs.map(row => `${row.timestamp || row.time}\t${row.source}\t${logLevelLabels[row.level]}\t${row.runId || '—'}\t${row.round ?? '—'}\t${row.phase || '—'}\t${row.message}`).join('\n');
}
export function logPreview(message: string, query: string) {
  if (message.length <= 280) return message;
  const match = query ? message.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  const start = Math.max(0, match - 65);
  const end = start + Math.max(280, query.length + 65);
  return `${start ? '…' : ''}${message.slice(start, end)}${end < message.length ? '…' : ''}`;
}
const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
export function describeRoundEvent({ event, args }: AutomationRound['events'][number]) {
  switch (event) {
    case 'cycle_start': return { title: '开始本轮', detail: `第 ${scalar(args[0])} 轮`, level: 'info' };
    case 'seed_captured': return { title: '测种完成', detail: `Seed ${scalar(args[0])} · 当前帧 ${scalar(args[1])}`, level: 'info' };
    case 'candidates_found':
    case 'candidates_refiltered': return { title: event === 'candidates_found' ? '候选搜索完成' : '候选重新筛选', detail: `${Array.isArray(args[0]) ? args[0].length : '—'} 个候选`, level: 'info' };
    case 'cycle_no_candidate': return { title: '本轮无候选', detail: '搜索范围内没有符合条件的候选', level: 'info' };
    case 'target_missed': return { title: '错过目标帧', detail: `目标 ${scalar(args[0])} · 当前 ${scalar(args[1])}`, level: 'warning' };
    case 'starter_missed': return { title: '御三家时机未命中', detail: scalar(args[0]), level: 'warning' };
    case 'cycle_restart': return { title: '本轮重试', detail: scalar(args[0]), level: 'warning' };
    case 'cycle_result': return { title: args[0] === true ? '判定出闪' : args[1] == null ? '判闪结果未知' : '未出闪', detail: `启动帧 ${scalar(args[2])} · 本轮 delay ${scalar(args[3])}`, level: args[0] === true ? 'success' : args[1] == null ? 'warning' : 'info' };
    case 'reverse_result': return { title: '反查完成', detail: `${Array.isArray(args[0]) ? args[0].length : '—'} 个结果 · 实际 delay ${Array.isArray(args[1]) ? args[1].map(scalar).join(' / ') : '—'}`, level: 'info' };
    default: return { title: '流程事件', detail: event, level: 'info' };
  }
}
