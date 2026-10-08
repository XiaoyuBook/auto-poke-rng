// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AutomationLogs } from '../src/components/AutomationLogs';
import { FloatingSidePanel } from '../src/components/FloatingSidePanel';
import { LogsPanel } from '../src/components/LogsPanel';
import { downloadText } from '../src/automation';
import { LOG_ROW_HEIGHT } from '../src/automationLogs';

vi.mock('../src/automation', async importOriginal => ({ ...await importOriginal(), downloadText: vi.fn() }));
HTMLDialogElement.prototype.showModal ||= function () { this.open = true; };
HTMLDialogElement.prototype.close ||= function () { this.open = false; };

afterEach(() => { cleanup(); delete window.desktop; localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const log = (id, message = id, values = {}) => ({ id, time: '12:00:00', source: '自动定点', level: 'info', runId: 'run-a', round: 1, message, ...values });
function fixture(logs) {
  const snapshot = { logging: true, error: '', state: { status: 'running', runId: 'run-a' }, logs,
    runs: [{ id: 'run-a', kind: 'static', startedAt: '2026-10-08T04:00:00Z', status: 'running', rounds: [1, 2].map(number => ({ number, outcome: '无候选', candidates: [], events: [] })) }] };
  const api = { getState: vi.fn(async () => snapshot), onState: vi.fn(() => () => {}), clearLogs: vi.fn(), setLogging: vi.fn(), exportDiagnostics: vi.fn(async () => ({ canceled: false, filePath: 'diagnostics.jsonl' })) };
  window.desktop = { automation: api };
  return { api, snapshot, update: async patch => act(async () => { Object.assign(snapshot, patch); api.onState.mock.calls[0][0]({ ...snapshot }); }) };
}
const scroll = (element, top) => { element.scrollTop = top; fireEvent.scroll(element); };
const openLogs = async () => fireEvent.click(await screen.findByRole('button', { name: '运行日志' }));
const action = name => { fireEvent.click(screen.getByRole('button', { name: '更多日志操作' })); fireEvent.click(screen.getByRole('menuitem', { name })); };
const clipboard = () => { const writeText = vi.fn(async () => {}); vi.stubGlobal('navigator', { clipboard: { writeText } }); return writeText; };
const expand = element => { element.open = true; fireEvent(element, new Event('toggle')); };

test('new logs preserve the reading position after scrolling away from the bottom', async () => {
  const logs = Array.from({ length: 40 }, (_, i) => log(String(i)));
  const { update } = fixture(logs);
  const { container } = render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('button', { name: '运行日志' }));
  const viewport = container.querySelector('.automation-log-lines');
  Object.defineProperties(viewport, { scrollHeight: { configurable: true, value: 4000 }, clientHeight: { configurable: true, value: 300 } });
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  await update({ logs: [...logs, log('new', '新消息')] });
  expect(viewport.scrollTop).toBe(100);
});

test('changing the displayed round also changes its related log scope', async () => {
  fixture([log('one', '第一轮内容'), log('two', '第二轮内容', { round: 2 })]);
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('button', { name: '查看本轮日志' }));
  expect(screen.getByText('第二轮内容')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '轮次记录' }));
  fireEvent.click(screen.getByRole('button', { name: '上一轮' }));
  fireEvent.click(screen.getByRole('button', { name: '运行日志' }));
  expect(screen.getByText('第一轮内容')).toBeTruthy();
  expect(screen.queryByText('第二轮内容')).toBeNull();
});

test('the filter popover stays open while tabbing between its fields', async () => {
  fixture([log('one')]);
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('button', { name: '运行日志' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选日志' }));
  const popover = screen.getByRole('dialog', { name: '筛选日志' });
  const source = within(popover).getByRole('combobox', { name: '筛选日志来源' });
  fireEvent.keyDown(source, { key: 'Tab' });
  expect(screen.getByRole('dialog', { name: '筛选日志' })).toBe(popover);
  fireEvent.keyDown(within(popover).getByRole('button', { name: '完成' }), { key: 'Tab' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a manually selected run scope survives a newly started run', async () => {
  const { snapshot, update } = fixture([log('old', '原运行内容')]);
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('button', { name: '运行日志' }));
  fireEvent.change(screen.getByRole('combobox', { name: '日志范围' }), { target: { value: 'run' } });
  const next = { ...snapshot.runs[0], id: 'run-b' };
  await update({ runs: [next, ...snapshot.runs], logs: [...snapshot.logs, log('new', '新运行内容', { runId: 'run-b' })] });
  expect(screen.getByText('原运行内容')).toBeTruthy();
  expect(screen.queryByText('新运行内容')).toBeNull();
});

test('a missing linked round never silently displays a different round', async () => {
  fixture([log('one', '第一轮内容'), log('two', '第二轮内容', { round: 2 }), log('old', '已过期轮次日志', { round: 0 })]);
  localStorage.setItem('auto-poke-rng:log-context', JSON.stringify({ runId: 'run-a', round: 0 }));
  render(<AutomationLogs />);
  expect(await screen.findByText('已过期轮次日志')).toBeTruthy();
  expect(screen.queryByText('第二轮内容')).toBeNull();
  expect(screen.getByText(/第 0 轮.*详情不可用/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '轮次记录' }));
  expect(screen.getByText('本轮记录不可用')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看本轮日志' }));
  expect(screen.getByText('已过期轮次日志')).toBeTruthy();
  expect(screen.queryByText('第二轮内容')).toBeNull();
});

test('paused reading counts matching arrivals only and resumes following on demand', async () => {
  const logs = Array.from({ length: 40 }, (_, i) => log(String(i), `匹配-${i}`));
  const { update } = fixture(logs);
  render(<AutomationLogs />); await openLogs();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索日志' }), { target: { value: '匹配-' } });
  const viewport = screen.getByRole('region', { name: '日志内容' });
  scroll(viewport, 100);
  expect(screen.getByRole('checkbox', { name: '跟随最新' }).checked).toBe(false);
  await update({ logs: [...logs, log('irrelevant', '别的内容')] });
  expect(viewport.scrollTop).toBe(100);
  expect(screen.getByRole('button', { name: '回到最新' })).toBeTruthy();
  await update({ logs: [...logs, log('irrelevant', '别的内容'), log('new1', '匹配-40'), log('new2', '匹配-41')] });
  expect(viewport.scrollTop).toBe(100);
  fireEvent.click(screen.getByRole('button', { name: '新增 2 条 · 回到最新' }));
  expect(viewport.scrollTop).toBe(42 * LOG_ROW_HEIGHT - 304);
  expect(screen.getByRole('checkbox', { name: '跟随最新' }).checked).toBe(true);
  await update({ logs: [...logs, log('new1', '匹配-40'), log('new2', '匹配-41'), log('new3', '匹配-42')] });
  expect(viewport.scrollTop).toBe(43 * LOG_ROW_HEIGHT - 304);
});

test('retention preserves the first visible log and reports when that log expires', async () => {
  const logs = Array.from({ length: 40 }, (_, i) => log(String(i)));
  const { update } = fixture(logs);
  render(<AutomationLogs />); await openLogs();
  const viewport = screen.getByRole('region', { name: '日志内容' });
  scroll(viewport, 10 * LOG_ROW_HEIGHT + 12);
  await update({ logs: [...logs.slice(5), log('new')] });
  expect(viewport.scrollTop).toBe(5 * LOG_ROW_HEIGHT + 12);
  expect(screen.getByRole('checkbox', { name: '跟随最新' }).checked).toBe(false);
  await update({ logs: logs.slice(20) });
  expect(viewport.scrollTop).toBe(0);
  expect(screen.getByText('较早记录已移出缓存，已定位到最早可用记录。')).toBeTruthy();
  await update({ logs: [] });
  expect(screen.getByRole('checkbox', { name: '跟随最新' }).checked).toBe(true);
  expect(screen.queryByText(/较早记录/)).toBeNull();
});

test('pausing round logs pins the displayed round until the latest-round action is used', async () => {
  const logs = Array.from({ length: 40 }, (_, i) => log(String(i), `第二轮-${i}`, { round: 2 }));
  const { snapshot, update } = fixture(logs);
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('button', { name: '查看本轮日志' }));
  scroll(screen.getByRole('region', { name: '日志内容' }), 100);
  await update({ runs: [{ ...snapshot.runs[0], rounds: [...snapshot.runs[0].rounds, { number: 3, outcome: '运行中', candidates: [], events: [] }] }], logs: [...logs, log('third', '第三轮内容', { round: 3 })] });
  expect(screen.getByRole('button', { name: '选择轮次' }).textContent).toContain('第 2 轮');
  expect(screen.queryByText('第三轮内容')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '最新一轮' }));
  expect(screen.getByText('第三轮内容')).toBeTruthy();
});

test('10,000 logs have bounded DOM rows while scrolling, searching, copying and exporting remain complete', async () => {
  const logs = Array.from({ length: 10000 }, (_, i) => log(String(i), `条目-${String(i).padStart(5, '0')}`));
  const writeText = clipboard();
  fixture(logs); render(<AutomationLogs />); await openLogs();
  const viewport = screen.getByRole('region', { name: '日志内容' });
  const countRows = () => within(screen.getByRole('region', { name: '日志内容' })).getAllByRole('listitem').length;
  expect(countRows()).toBeLessThanOrEqual(18);
  expect(screen.getByText('条目-09999')).toBeTruthy();
  scroll(viewport, 0);
  expect(screen.getByText('条目-00000')).toBeTruthy();
  expect(countRows()).toBeLessThanOrEqual(18);
  scroll(viewport, 5000 * LOG_ROW_HEIGHT);
  expect(screen.getByText('条目-05000')).toBeTruthy();
  expect(countRows()).toBeLessThanOrEqual(18);
  action('复制当前视图');
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const copied = writeText.mock.calls[0][0];
  expect(copied.split('\n')).toHaveLength(10000);
  expect(copied).toContain('条目-00000'); expect(copied).toContain('条目-09999');
  action('导出当前视图');
  expect(downloadText).toHaveBeenLastCalledWith(copied, '运行日志-当前视图.txt');
  for (const message of ['条目-00000', '条目-05000', '条目-09999']) {
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索日志' }), { target: { value: message } });
    expect(countRows()).toBe(1);
    expect(screen.getByRole('listitem').textContent).toContain(message);
  }
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索日志' }), { target: { value: '条目-09' } });
  expect(countRows()).toBeLessThanOrEqual(18);
  action('复制当前视图');
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  const filtered = writeText.mock.calls[1][0];
  expect(filtered.split('\n')).toHaveLength(1000);
  expect(filtered).toContain('条目-09000'); expect(filtered).toContain('条目-09999');
  expect(filtered).not.toContain('条目-08999');
  action('导出当前视图');
  expect(downloadText).toHaveBeenLastCalledWith(filtered, '运行日志-当前视图.txt');
});

test('source, phase, level and literal search combine, highlight safely and reset together', async () => {
  const match = '[a+b] <img onerror=bad>.*';
  fixture([
    log('hit', match, { level: 'error', phase: '执行', source: 'ECS' }),
    log('source', '来源不符', { level: 'error', phase: '执行' }),
    log('phase', '阶段不符', { level: 'error', phase: '准备', source: 'ECS' }),
    log('level', '级别不符', { phase: '执行', source: 'ECS' }),
  ]);
  render(<AutomationLogs />); await openLogs();
  fireEvent.click(screen.getByRole('button', { name: '筛选日志' }));
  fireEvent.change(screen.getByRole('combobox', { name: '筛选日志来源' }), { target: { value: 'ECS' } });
  fireEvent.change(screen.getByRole('combobox', { name: '筛选日志阶段' }), { target: { value: '执行' } });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  fireEvent.change(screen.getByRole('combobox', { name: '筛选日志级别' }), { target: { value: 'error' } });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索日志' }), { target: { value: '[A+B] <IMG' } });
  const row = screen.getByRole('listitem');
  expect(row.querySelector('mark').textContent).toBe('[a+b] <img');
  expect(row.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
});

test('long messages expand in full, expose raw data lazily and remain intact when copied', async () => {
  const message = '开头'.repeat(400) + 'needle <tag>' + '尾部'.repeat(400);
  const writeText = clipboard();
  fixture([log('long', message, { event: 'original.event', extra: { confidence: .96 } })]);
  render(<AutomationLogs />); await openLogs();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索日志' }), { target: { value: 'needle <tag>' } });
  const trigger = screen.getByRole('button', { name: /查看日志详情/ });
  expect(trigger.textContent.length).toBeLessThan(400);
  expect(trigger.querySelector('mark').textContent).toBe('needle <tag>');
  trigger.focus(); fireEvent.click(trigger);
  const details = screen.getByRole('region', { name: '日志详情' });
  expect(details.querySelector('pre').textContent).toBe(message);
  expect(details.textContent).not.toContain('confidence');
  expand(within(details).getByText('原始数据').closest('details'));
  expect(details.textContent).toContain('"confidence": 0.96');
  fireEvent.click(within(details).getByRole('button', { name: '复制此条日志' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).toContain(message);
  fireEvent.click(within(details).getByRole('button', { name: '关闭日志详情' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test('diagnostic export targets the selected whole run even when no summary matches', async () => {
  const { api } = fixture([log('one')]);
  api.exportDiagnostics.mockResolvedValue({ canceled: false, active: true, incomplete: true });
  render(<AutomationLogs />); await openLogs();
  fireEvent.click(screen.getByRole('button', { name: '更多日志操作' }));
  expect(screen.getByRole('menuitem', { name: '导出本次完整诊断' }).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.change(screen.getByRole('combobox', { name: '日志范围' }), { target: { value: 'round' } });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索日志' }), { target: { value: '没有匹配' } });
  action('导出本次完整诊断');
  await waitFor(() => expect(api.exportDiagnostics).toHaveBeenCalledWith('run-a'));
  expect(await screen.findByText(/已导出截至当前.*文件可能不完整/)).toBeTruthy();
});

test('cancelled and failed diagnostic exports never claim success and allow retry', async () => {
  const { api } = fixture([]);
  api.exportDiagnostics.mockResolvedValueOnce({ canceled: true }).mockRejectedValueOnce(Error('文件已过期')).mockResolvedValueOnce({ canceled: false });
  render(<AutomationLogs />); await openLogs();
  fireEvent.change(screen.getByRole('combobox', { name: '日志范围' }), { target: { value: 'run' } });
  action('导出本次完整诊断');
  await act(async () => {});
  expect(screen.queryByText(/已导出/)).toBeNull();
  action('导出本次完整诊断');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '文件已过期');
  expect(screen.queryByText(/已导出/)).toBeNull();
  action('导出本次完整诊断');
  expect(await screen.findByText('已导出完整诊断文件')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('clear display is explicit about disk preservation and clears the shared display through the API', async () => {
  const { api, update } = fixture([log('one')]);
  api.clearLogs.mockResolvedValue(undefined);
  render(<AutomationLogs />); await openLogs();
  fireEvent.click(screen.getByRole('button', { name: '更多日志操作' }));
  expect(screen.getByText('清空全部界面日志，不删除磁盘文件。')).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: '清空显示' }));
  expect(await screen.findByText('已清空全部界面日志，磁盘诊断文件保留')).toBeTruthy();
  await update({ logs: [] });
  expect(screen.queryByRole('listitem')).toBeNull();
  expect(api.clearLogs).toHaveBeenCalledOnce();
});

test('event summaries preserve unknown events and uncertain shiny results with original data', async () => {
  const { snapshot } = fixture([]);
  snapshot.runs[0].rounds[1].events = [
    { event: 'seed_captured', args: ['ABCD', 1234] },
    { event: 'cycle_result', args: [false, null, 100, 20] },
    { event: 'future_event', args: [{ raw: '原始内容' }] },
  ];
  render(<AutomationLogs />);
  const summary = await screen.findByText('关键事件与诊断 · 3 条');
  expect(screen.queryByText('测种完成')).toBeNull();
  expand(summary.closest('details'));
  expect(screen.getByText('测种完成')).toBeTruthy();
  expect(screen.getByText('Seed ABCD · 当前帧 1234')).toBeTruthy();
  expect(screen.getByText('判闪结果未知')).toBeTruthy();
  expect(screen.queryByText('判定出闪')).toBeNull();
  expect(screen.getByText('future_event')).toBeTruthy();
  const unknown = screen.getByText('future_event').closest('li');
  expand(within(unknown).getByText('原始数据').closest('details'));
  expect(unknown.textContent).toContain('原始内容');
});

test('log details stay beside the list and navigate only the current filtered results', async () => {
  fixture([log('one', '目标第一条'), log('skip', '不匹配'), log('two', '目标第二条'), log('three', '目标第三条')]);
  render(<AutomationLogs />); await openLogs();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索日志' }), { target: { value: '目标' } });
  const first = screen.getAllByRole('button', { name: /查看日志详情/ })[0];
  first.focus(); fireEvent.click(first);
  expect(screen.queryByRole('dialog', { name: '日志详情' })).toBeNull();
  const details = screen.getByRole('region', { name: '日志详情' });
  expect(details.querySelector('pre').textContent).toBe('目标第一条');
  expect(within(details).getByRole('button', { name: '上一条日志' }).disabled).toBe(true);
  fireEvent.click(within(details).getByRole('button', { name: '下一条日志' }));
  expect(details.querySelector('pre').textContent).toBe('目标第二条');
  fireEvent.click(within(details).getByRole('button', { name: '下一条日志' }));
  expect(details.querySelector('pre').textContent).toBe('目标第三条');
  expect(within(details).getByRole('button', { name: '下一条日志' }).disabled).toBe(true);
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  fireEvent.keyDown(details, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: '日志详情' })).toBeNull();
  await waitFor(() => expect(document.activeElement.textContent).toBe('目标第三条'));
});

test('automatic disk saving is available from the more menu in either view', async () => {
  const { api, update } = fixture([log('one')]);
  render(<AutomationLogs />);
  await screen.findByRole('button', { name: '轮次记录' });
  expect(screen.queryByRole('checkbox', { name: '自动保存磁盘日志' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更多日志操作' }));
  const saving = screen.getByRole('menuitemcheckbox', { name: '自动保存磁盘日志' });
  expect(saving.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(saving);
  expect(api.setLogging).toHaveBeenCalledWith(false);
  await update({ logging: false });
  await openLogs();
  fireEvent.click(screen.getByRole('button', { name: '更多日志操作' }));
  expect(screen.getByRole('menuitemcheckbox', { name: '自动保存磁盘日志' }).getAttribute('aria-checked')).toBe('false');
});

test('the panel header hosts log controls across minimize and restore without losing selection', async () => {
  fixture([log('one', '保留的详情')]);
  const close = vi.fn();
  function Panel() {
    const [headerTarget, setHeaderTarget] = useState(null);
    const [minimized, setMinimized] = useState(false);
    return <FloatingSidePanel title="日志中心" state={{ tool: 'logs', minimized, expanded: false }}
      minimize={() => setMinimized(true)} restore={() => setMinimized(false)} toggleExpanded={() => {}} close={close}
      headerContent={<div className="log-header-slot" ref={setHeaderTarget} />}>
      <LogsPanel logs={[]} source="全部来源" setSource={() => {}} clear={() => {}} headerTarget={headerTarget}/>
    </FloatingSidePanel>;
  }
  render(<Panel />);
  const panel = screen.getByRole('dialog', { name: '日志中心' });
  const header = panel.querySelector('.floating-panel-header');
  await within(header).findByRole('button', { name: '运行日志' });
  expect(panel.querySelector('.automation-log-header')).toBeNull();
  expect(panel.querySelectorAll('.automation-log-heading')).toHaveLength(1);
  fireEvent.click(within(header).getByRole('button', { name: '更多日志操作' }));
  const saving = screen.getByRole('menuitemcheckbox', { name: '自动保存磁盘日志' });
  fireEvent.keyDown(saving, { key: 'Home' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '导出本次完整诊断' }));
  fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(saving);
  fireEvent.keyDown(saving, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  await openLogs();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索日志' }), { target: { value: '保留' } });
  fireEvent.click(screen.getByRole('button', { name: /查看日志详情/ }));
  fireEvent.click(within(header).getByRole('button', { name: '收起日志中心' }));
  expect(screen.queryByRole('navigation', { name: '日志视图' })).toBeNull();
  fireEvent.click(within(header).getByRole('button', { name: '恢复日志中心' }));
  expect(within(header).getByRole('button', { name: '运行日志' }).getAttribute('aria-pressed')).toBe('true');
  expect(panel.querySelectorAll('.automation-log-heading')).toHaveLength(1);
  expect(panel.querySelector('.automation-log-header')).toBeNull();
  expect(screen.getByRole('searchbox', { name: '搜索日志' }).value).toBe('保留');
  const details = screen.getByRole('region', { name: '日志详情' });
  expect(details.querySelector('pre').textContent).toBe('保留的详情');
  fireEvent.keyDown(details, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: '日志详情' })).toBeNull();
  expect(close).not.toHaveBeenCalled();
});

test('detail navigation reveals rows beyond the virtual window and remains stable during arrivals', async () => {
  const logs = Array.from({ length: 60 }, (_, i) => log(String(i), `条目-${i}`));
  const { update } = fixture(logs);
  render(<AutomationLogs />); await openLogs();
  const viewport = screen.getByRole('region', { name: '日志内容' });
  scroll(viewport, 0);
  fireEvent.click(within(viewport).getAllByRole('button', { name: /查看日志详情/ })[0]);
  const details = screen.getByRole('region', { name: '日志详情' });
  expand(within(details).getByText('原始数据').closest('details'));
  const next = within(details).getByRole('button', { name: '下一条日志' });
  for (let i = 0; i < 25; i++) fireEvent.click(next);
  expect(details.querySelector('pre').textContent).toBe('条目-25');
  expect(within(details).getByText('原始数据').closest('details').open).toBe(false);
  expect(viewport.querySelector('[data-selected="true"]').dataset.logId).toBe('25');
  const readingTop = 26 * LOG_ROW_HEIGHT - 304;
  expect(viewport.scrollTop).toBe(readingTop);
  await update({ logs: [...logs, log('arrival', '新到消息')] });
  expect(details.querySelector('pre').textContent).toBe('条目-25');
  expect(within(details).getByLabelText('详情位置').textContent).toBe('26 / 61');
  expect(viewport.scrollTop).toBe(readingTop);
  scroll(viewport, 0);
  await update({ logs: [...logs, log('arrival', '新到消息'), log('arrival2', '又一条消息')] });
  expect(viewport.scrollTop).toBe(0);
  expect(details.querySelector('pre').textContent).toBe('条目-25');
  fireEvent.click(screen.getByRole('button', { name: '新增 2 条 · 回到最新' }));
  expect(screen.queryByRole('region', { name: '日志详情' })).toBeNull();
  expect(screen.getByRole('checkbox', { name: '跟随最新' }).checked).toBe(true);
});

test('an evicted detail remains readable and closes back to the list safely', async () => {
  const logs = Array.from({ length: 40 }, (_, i) => log(String(i), `原始条目-${i}`));
  const { update } = fixture(logs);
  render(<AutomationLogs />); await openLogs();
  const viewport = screen.getByRole('region', { name: '日志内容' });
  scroll(viewport, 0);
  fireEvent.click(within(viewport).getAllByRole('button', { name: /查看日志详情/ })[0]);
  const details = screen.getByRole('region', { name: '日志详情' });
  await update({ logs: logs.slice(20) });
  expect(details.querySelector('pre').textContent).toBe('原始条目-0');
  expect(within(details).getByLabelText('详情位置').textContent).toBe('已移出缓存');
  expect(within(details).getByRole('button', { name: '上一条日志' }).disabled).toBe(true);
  expect(within(details).getByRole('button', { name: '下一条日志' }).disabled).toBe(true);
  fireEvent.keyDown(details, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(viewport));
});

test('the selected log remains visible when opening details reduces the list height', async () => {
  let measure;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { measure = callback; }
    observe() {} disconnect() {}
  });
  fixture(Array.from({ length: 40 }, (_, i) => log(String(i))));
  render(<AutomationLogs />); await openLogs();
  const viewport = screen.getByRole('region', { name: '日志内容' });
  fireEvent.click(within(viewport).getAllByRole('button', { name: /查看日志详情/ }).at(-1));
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 96 });
  act(() => measure());
  expect(viewport.scrollTop).toBe(40 * LOG_ROW_HEIGHT - 96);
  expect(viewport.querySelector('[data-selected="true"]').dataset.logId).toBe('39');
});
