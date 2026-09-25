// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BdspProfileCard } from './BdspProfileCard';
import { IvCalculatorDialog, formatIvRange } from './IvCalculatorDialog';
import { useBdspProfile } from '../bdspProfile';
import type { DesktopApi, IvCalculationResult } from '../desktop';

const calculate = vi.fn();
const result: IvCalculationResult = { ivs: [[14,15,16,17,18,19],[20,21,22,23,24,25,26],[14,15,16,17,18,19],[20,22,24,26],[1,3,5],[31]], baseStats: [100,100,100,100,100,100], nextLevels: [16,16,16,16,16,null], possible: true };
beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  calculate.mockReset().mockResolvedValue(result);
  window.desktop = { rng: { calculateIvs: calculate } } as unknown as DesktopApi;
});
afterEach(() => { cleanup(); delete window.desktop; vi.restoreAllMocks(); });
const change = (label: string, value: string | number) => fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
function fillRow(row = 1, stats = [25,14,15,16,15,17], level = 5) {
  change(`第 ${row} 行等级`, level);
  ['HP','攻击','防御','特攻','特防','速度'].forEach((label, index) => change(`第 ${row} 行${label}`, stats[index]));
}
function Profile() {
  const [profile, setProfile] = useBdspProfile();
  return <BdspProfileCard profile={profile} onChange={setProfile} />;
}
it('profile management cancels atomically, rejects invalid IDs, applies and persists the edited profile', () => {
  let app = render(<Profile />);
  const originalName = (screen.getByLabelText('存档名称') as HTMLInputElement).value;
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  let dialog = within(screen.getByRole('dialog', { name: '存档信息管理' }));
  fireEvent.change(dialog.getByLabelText('存档名称'), { target: { value: '取消的编辑' } });
  fireEvent.click(dialog.getByRole('button', { name: '取消' }));
  expect((screen.getByLabelText('存档名称') as HTMLInputElement).value).toBe(originalName);
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  dialog = within(screen.getByRole('dialog', { name: '存档信息管理' }));
  fireEvent.change(dialog.getByLabelText('TID'), { target: { value: '65536' } });
  fireEvent.click(dialog.getByRole('button', { name: '保存并应用' }));
  expect(dialog.getByRole('alert').textContent).toContain('65535');
  fireEvent.change(dialog.getByLabelText('TID'), { target: { value: '42' } });
  fireEvent.change(dialog.getByLabelText('SID'), { target: { value: '31' } });
  fireEvent.change(dialog.getByLabelText('存档名称'), { target: { value: '珍珠存档' } });
  fireEvent.change(dialog.getByLabelText('存档游戏版本'), { target: { value: 'SP' } });
  expect(dialog.getByLabelText('TSV').textContent).toBe('53');
  fireEvent.click(dialog.getByLabelText('闪耀护符'));
  fireEvent.click(dialog.getByRole('button', { name: '保存并应用' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  app.unmount(); app = render(<Profile />);
  expect((screen.getByLabelText('存档名称') as HTMLInputElement).value).toBe('珍珠存档');
  expect((screen.getByLabelText('存档游戏版本') as HTMLSelectElement).value).toBe('SP');
  expect((screen.getByLabelText('TID') as HTMLInputElement).value).toBe('42');
  expect((screen.getByLabelText('闪耀护符') as HTMLInputElement).checked).toBe(true);
});
it('calculator forwards multiple observations and optional upstream indexes without filling gaps in the result', async () => {
  render(<IvCalculatorDialog initialSpecies={492} close={vi.fn()} />);
  change('计算器性格', 10); change('计算器个性', 16); change('计算器觉醒力量', 10);
  fillRow();
  fireEvent.click(screen.getByRole('button', { name: '新增行' })); fillRow(2, [41,24,26,27,25,30], 10);
  fireEvent.click(screen.getByRole('button', { name: '新增行' })); fillRow(3, [57,34,37,38,35,42], 15);
  fireEvent.click(screen.getByRole('button', { name: '计算' }));
  await screen.findByText('计算完成');
  expect(calculate).toHaveBeenCalledWith({ species: 492, form: 0, nature: 10, characteristic: 16, hiddenPower: 10, entries: [{ level: 5, stats: [25,14,15,16,15,17] }, { level: 10, stats: [41,24,26,27,25,30] }, { level: 15, stats: [57,34,37,38,35,42] }] });
  expect(screen.getByText('20、22、24、26')).toBeTruthy();
  expect(formatIvRange([0,1,2,4,6,7,8])).toBe('0–2、4、6–8');
  change('计算器形态', 1);
  expect(screen.queryByText('计算完成')).toBeNull();
  expect(screen.getByText('127')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '删除行' }));
  expect(screen.queryByLabelText('第 3 行等级')).toBeNull();
});
it('calculator validates before calling native and discards a stale response after input changes', async () => {
  render(<IvCalculatorDialog initialSpecies={492} close={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '计算' }));
  expect(screen.getByRole('alert').textContent).toContain('第 1 行HP');
  expect(calculate).not.toHaveBeenCalled();
  fillRow(); change('第 1 行等级', 101);
  fireEvent.click(screen.getByRole('button', { name: '计算' }));
  expect(screen.getByRole('alert').textContent).toContain('1–100');
  change('第 1 行等级', 5);
  let finish!: (result: IvCalculationResult) => void;
  calculate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '计算' }));
  change('第 1 行HP', 26);
  await act(async () => finish(result));
  expect(screen.queryByText('计算完成')).toBeNull();
  expect(screen.queryByText('20、22、24、26')).toBeNull();
  delete window.desktop;
  fireEvent.click(screen.getByRole('button', { name: '计算' }));
  expect(screen.getByRole('alert').textContent).toContain('桌面应用');
});
