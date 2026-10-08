// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AutomationLogs } from '../src/components/AutomationLogs';

afterEach(() => { cleanup(); delete window.desktop; localStorage.clear(); });
const round = (number, values = {}) => ({ number, outcome: '无候选', candidates: [], events: [], ...values });
const run = (id, rounds, values = {}) => ({ id, kind: 'static', startedAt: '2026-10-08T04:54:04Z', status: 'completed', rounds, ...values });
const candidate = advances => ({ advances, ec: '12345678', pid: '87654321', shiny: 0, nature: 3, ability: 0, gender: 0, ivs: [31, 0, 31, 31, 31, 31], height: 128, weight: 64, characteristic: 0 });
function fixture(runs, logs = []) {
  const snapshot = { runs, logs, logging: true, error: '', state: { status: 'idle', runId: null } };
  const api = { getState: vi.fn(async () => snapshot), onState: vi.fn(() => () => {}), setLogging: vi.fn(async () => snapshot) };
  window.desktop = { automation: api };
  return { snapshot, api, update: async patch => act(async () => api.onState.mock.calls[0][0]({ ...snapshot, ...patch })) };
}

test('a no-candidate round does not show empty table columns or candidate actions', async () => {
  fixture([run('r1', [round(1)])]);
  render(<AutomationLogs />);
  await screen.findByRole('button', { name: '轮次记录' });
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: '复制选中' })).toBeNull();
  expect(screen.queryByRole('button', { name: '导出全部' })).toBeNull();
  expect(screen.getByText('本轮没有符合条件的候选')).toBeTruthy();
});

test('switching runs clears the selected candidate instead of silently selecting another row', async () => {
  fixture([run('r1', [round(1, { candidates: [candidate(100)] })]), run('r2', [round(1, { candidates: [candidate(200)] })], { kind: 'tid' })]);
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('cell', { name: '100' }));
  expect(screen.getByRole('button', { name: '复制选中' }).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '切换运行记录' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /TID/ }));
  expect(screen.getByRole('cell', { name: '200' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '复制选中' }).disabled).toBe(true);
});

test('compact navigation keeps a historical round during updates and can resume following the latest round', async () => {
  const rounds = Array.from({ length: 120 }, (_, i) => round(i + 1));
  const { update } = fixture([run('r1', rounds)]);
  render(<AutomationLogs />);
  const picker = await screen.findByRole('button', { name: '选择轮次' });
  expect(picker.textContent).toContain('第 120 轮');
  expect(screen.getByRole('button', { name: '下一轮' }).disabled).toBe(true);
  expect(screen.queryByRole('menuitemradio')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '上一轮' }));
  expect(picker.textContent).toContain('第 119 轮');
  await update({ runs: [run('r1', [...rounds, round(121)])] });
  expect(picker.textContent).toContain('第 119 轮');
  fireEvent.click(screen.getByRole('button', { name: '最新一轮' }));
  expect(picker.textContent).toContain('第 121 轮');
  await update({ runs: [run('r1', [...rounds, round(121), round(122)])] });
  expect(picker.textContent).toContain('第 122 轮');
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole('menuitemradio', { name: '第 1 轮 · 无候选' }));
  expect(screen.getByRole('button', { name: '上一轮' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '下一轮' }));
  expect(picker.textContent).toContain('第 2 轮');
});

test('round selection uses its run and number across retention and new runs', async () => {
  const rounds = [round(1, { seed: 'seed-one' }), round(2, { seed: 'seed-two' }), round(3, { seed: 'seed-three' })];
  const { update } = fixture([run('r1', rounds)]);
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('button', { name: '上一轮' }));
  await update({ runs: [run('r1', rounds.slice(1))] });
  expect(screen.getByText('seed-two')).toBeTruthy();
  await update({ runs: [run('r2', [round(1), round(2), round(3, { seed: 'new-run-seed' })]), run('r1', rounds)] });
  expect(screen.getByText('new-run-seed')).toBeTruthy();
  expect(screen.queryByText('seed-two')).toBeNull();
});

test('round menu supports keyboard navigation, Escape, and restoring focus', async () => {
  fixture([run('r1', [round(0), round(1), round(2)])]);
  render(<AutomationLogs />);
  const trigger = await screen.findByRole('button', { name: '选择轮次' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const menu = screen.getByRole('menu', { name: '选择轮次' });
  const options = within(menu).getAllByRole('menuitemradio');
  expect(document.activeElement).toBe(options[2]);
  fireEvent.keyDown(options[2], { key: 'Home' });
  expect(document.activeElement).toBe(options[0]);
  fireEvent.keyDown(options[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(options[1]);
  fireEvent.keyDown(options[1], { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitemradio', { name: '第 0 轮 · 无候选' }));
  expect(trigger.textContent).toContain('第 0 轮');
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('an unfinished empty round is not labeled as a completed no-candidate search', async () => {
  const { update } = fixture([run('r1', [round(1, { outcome: '运行中' })], { status: 'running' })]);
  render(<AutomationLogs />);
  expect(await screen.findByText('候选结果尚未生成')).toBeTruthy();
  expect(screen.queryByText('本轮没有符合条件的候选')).toBeNull();
  await update({ runs: [run('r1', [round(1, { outcome: '已停止' })], { status: 'stopped' })] });
  expect(screen.getByText('本轮没有候选记录')).toBeTruthy();
  expect(screen.queryByText('本轮仍在进行，结果会自动更新。')).toBeNull();
});

test('changing rounds resets candidate selection and scopes the log action to the displayed round', async () => {
  const rounds = [round(1, { candidates: [candidate(100)] }), round(2, { candidates: [candidate(200)] })];
  fixture([run('r1', rounds)], [
    { id: 'one', time: '10:00', source: '自动定点', level: 'info', message: '第一轮日志', runId: 'r1', round: 1 },
    { id: 'two', time: '10:01', source: '自动定点', level: 'info', message: '第二轮日志', runId: 'r1', round: 2 },
  ]);
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('cell', { name: '200' }));
  expect(screen.getByRole('button', { name: '复制选中' }).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '上一轮' }));
  expect(screen.getByRole('cell', { name: '100' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '复制选中' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '查看相关日志' }));
  expect(screen.getByText('第一轮日志')).toBeTruthy();
  expect(screen.queryByText('第二轮日志')).toBeNull();
});

test('runs without rounds retain access to run logs and selecting another run opens its latest round', async () => {
  fixture([run('empty', []), run('tid', [round(1), round(2)], { kind: 'tid' })], [
    { id: 'error', time: '10:00', source: '系统', level: 'error', message: '启动前失败', runId: 'empty' },
  ]);
  render(<AutomationLogs />);
  expect(await screen.findByText('暂无轮次记录')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '上一轮' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看运行日志' }));
  expect(screen.getByText('启动前失败')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '轮次记录' }));
  fireEvent.click(screen.getByRole('button', { name: '切换运行记录' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /TID/ }));
  expect(screen.getByRole('button', { name: '选择轮次' }).textContent).toContain('第 2 轮');
});
