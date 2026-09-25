// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StaticDataWorkspace } from './StaticDataWorkspace';
import { defaultBdspProfile } from '../bdspProfile';
import type { DesktopApi, NativeStaticResult } from '../desktop';

const row: NativeStaticResult = { advances: 0, ec: '220345D0', pid: '2203506A', ivs: [4,23,15,30,19,26], stats: [20,12,12,11,12,8], ability: 0, abilityIndex: 65, gender: 0, level: 5, nature: 22, shiny: 0, height: 124, weight: 99, characteristic: 20 };
const generate = vi.fn();
const cancel = vi.fn(async () => {});
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  generate.mockReset().mockResolvedValue([row]); cancel.mockClear();
  window.desktop = { rng: { staticGenerate: generate, cancel } } as unknown as DesktopApi;
});
afterEach(() => { cleanup(); delete window.desktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function open() {
  const app = render(<StaticDataWorkspace profile={{ ...defaultBdspProfile, version: 'SP', tid: 42, sid: 31 }} />);
  fireEvent.change(screen.getByLabelText('Seed 0'), { target: { value: 'FFFFFFFFFFFFFFFF' } });
  fireEvent.change(screen.getByLabelText('Seed 1'), { target: { value: '0123456789ABCDEF' } });
  return app;
}
const start = () => fireEvent.click(screen.getByRole('button', { name: '生成' }));
it('preserves 64-bit seeds, zero bounds and real profile; renders native stats and characteristic', async () => {
  open();
  fireEvent.change(screen.getByLabelText('最大帧数'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('身高上限'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('体重上限'), { target: { value: '0' } });
  start(); await screen.findByText('已生成结果');
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ seed0: 'FFFFFFFFFFFFFFFF', seed1: '0123456789ABCDEF', maxAdvances: 0, profile: expect.objectContaining({ version: 'SP', tid: 42, sid: 31 }), filter: expect.objectContaining({ heightMax: 0, weightMax: 0 }) }));
  const result = screen.getAllByRole('row')[1];
  expect(within(result).getByText('好奇心强')).toBeTruthy();
  expect(within(result).getAllByRole('gridcell').slice(7, 13).map(cell => Number(cell.textContent))).toEqual(row.ivs);
  fireEvent.click(screen.getByLabelText('显示能力值'));
  expect(within(result).getAllByRole('gridcell').slice(7, 13).map(cell => Number(cell.textContent))).toEqual(row.stats);
});
it('uses the original lead menu hierarchy with all 25 natures and both Cute Charm genders', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: '队首' }));
  expect(screen.getByRole('menuitemradio', { name: '迷人之躯 ♀' })).toBeTruthy();
  expect(screen.getByRole('menuitemradio', { name: '迷人之躯 ♂' })).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: '同步' }));
  expect(within(screen.getByRole('menu', { name: '同步性格' })).getAllByRole('menuitemradio')).toHaveLength(25);
  fireEvent.click(screen.getByRole('menuitemradio', { name: '固执' }));
  expect(screen.getByRole('button', { name: '队首' }).textContent).toBe('同步：固执');
  start(); await screen.findByText('已生成结果');
  expect(generate.mock.calls[0][0].lead).toBe(3);
  fireEvent.click(screen.getByRole('button', { name: '队首' }));
  fireEvent.keyDown(screen.getByRole('menuitemradio', { name: '无' }), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
});
it('filters version-exclusive targets and displays the upstream readonly template values', () => {
  open();
  fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'legends' } });
  expect(within(screen.getByLabelText('宝可梦')).queryByRole('option', { name: /帝牙卢卡/ })).toBeNull();
  expect(within(screen.getByLabelText('宝可梦')).getByRole('option', { name: /帕路奇亚/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'ramanasParkPureSpace' } });
  expect(screen.getByLabelText('目标特性').textContent).toBe('隐藏');
  fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'mythics' } });
  expect(screen.getByLabelText('等级').textContent).toBe('1');
});
it('reports unavailable or failed native calls and never fabricates results', async () => {
  open(); delete window.desktop; start();
  expect(screen.getByRole('alert').textContent).toMatch(/桌面应用/);
  expect(generate).not.toHaveBeenCalled();
  window.desktop = { rng: { staticGenerate: generate, cancel } } as unknown as DesktopApi;
  generate.mockRejectedValueOnce(new Error('原生引擎不可用'));
  start(); await screen.findByText('原生引擎不可用');
  expect(screen.getByText('0 条结果')).toBeTruthy();
});
it('rejects invalid inputs before invoking the engine', () => {
  open();
  fireEvent.change(screen.getByLabelText('Seed 1'), { target: { value: '' } }); start();
  expect(screen.getByRole('alert').textContent).toMatch(/Seed/);
  fireEvent.change(screen.getByLabelText('Seed 1'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('身高下限'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('身高上限'), { target: { value: '0' } }); start();
  expect(screen.getByRole('alert').textContent).toMatch(/下限/);
  expect(generate).not.toHaveBeenCalled();
});
it('scrolls continuously with bounded rendered rows while copying the complete result set', async () => {
  const clipboard = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  generate.mockResolvedValue(Array.from({ length: 402 }, (_, advances) => ({ ...row, advances })));
  open(); start(); await screen.findByText('402 条结果');
  expect(screen.getAllByRole('row').length).toBeLessThan(40);
  expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
  const viewport = document.querySelector('.static-table-wrap')!;
  fireEvent.scroll(viewport, { target: { scrollTop: 200 * 36 } });
  expect(document.querySelector('[data-row-index="200"]')).toBeTruthy();
  expect(screen.getByRole('grid').getAttribute('aria-rowcount')).toBe('403');
  fireEvent.click(screen.getByRole('button', { name: '复制' }));
  await screen.findByText('已复制 402 条结果');
  expect(clipboard.mock.calls[0][0].split('\n')).toHaveLength(403);
  expect(clipboard.mock.calls[0][0]).toContain('401\t');
});
it('cancels an active search on explicit cancellation and when leaving the workspace', async () => {
  let reject!: (error: Error) => void;
  generate.mockImplementation(() => new Promise((_, failure) => { reject = failure; }));
  cancel.mockImplementation(async () => { reject(new Error('已取消搜索')); });
  const app = open(); start();
  fireEvent.click(screen.getByRole('button', { name: '取消搜索' }));
  await screen.findByText('已取消搜索');
  start(); app.unmount();
  await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
});
it('has no filter presets; hidden columns keep their cell alignment and full clipboard data', async () => {
  const clipboard = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  const app = open(); start(); await screen.findByText('已生成结果');
  expect(screen.queryByLabelText('筛选方案')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '表格设置' }));
  const dialog = within(screen.getByRole('dialog', { name: '表格设置' }));
  expect((dialog.getByLabelText('帧数') as HTMLInputElement).disabled).toBe(true);
  for (const label of ['EC', '性格', 'HP']) fireEvent.click(dialog.getByLabelText(label));
  fireEvent.click(dialog.getByRole('button', { name: '完成' }));
  expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['帧数','PID','异色','特性','性别','攻击','防御','特攻','特防','速度','身高','体重','个性']);
  expect(within(screen.getAllByRole('row')[1]).getAllByRole('gridcell').map(cell => cell.textContent)).toEqual(['0','2203506A','否','0','雄','23','15','30','19','26','124','99','好奇心强']);
  fireEvent.click(screen.getByRole('button', { name: '复制' }));
  await screen.findByText('已复制 1 条结果');
  expect(clipboard.mock.calls[0][0].split('\n').map(line => line.split('\t').length)).toEqual([16,16]);
  expect(clipboard.mock.calls[0][0]).toContain('220345D0');
  app.unmount(); open();
  expect(screen.queryByRole('columnheader', { name: 'EC' })).toBeNull();
  expect(screen.getByRole('gridcell').getAttribute('colspan')).toBe('13');
  fireEvent.click(screen.getByRole('button', { name: '表格设置' }));
  fireEvent.click(screen.getByRole('button', { name: '显示全部列' }));
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(screen.getAllByRole('columnheader')).toHaveLength(16);
});
it('starts the IV calculator from the selected encounter species, form and level', () => {
  open();
  fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'mythics' } });
  fireEvent.click(screen.getByRole('button', { name: '个体值计算器' }));
  const dialog = within(screen.getByRole('dialog', { name: '个体值计算器' }));
  expect((dialog.getByLabelText('计算器宝可梦') as HTMLSelectElement).value).toBe('151');
  expect((dialog.getByLabelText('第 1 行等级') as HTMLInputElement).value).toBe('1');
});
