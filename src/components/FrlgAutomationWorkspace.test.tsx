// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FrlgAutomationWorkspace } from './FrlgAutomationWorkspace';
import { defaultFrlgSaveProfile } from '../frlgProfile';
import type { DesktopApi } from '../desktop';
import type { FrlgPlannerResult } from '../frlgAutomation';
import golbatPlan from '../../tests/fixtures/frlg-golbat-plan.json';
import starterPlan from '../../tests/fixtures/frlg-starter-plan.json';

const profile = { ...defaultFrlgSaveProfile, sid: 38448 };
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openSettings = () => fireEvent.click(screen.getByRole('button', { name: '目标设置' }));
const searchButton = () => screen.getByRole('button', { name: '搜索并生成方案' });
function mockApi(result: FrlgPlannerResult = golbatPlan) {
  const api = { validate: vi.fn(async () => ({ valid: true, source: 'bundled' })), search: vi.fn(async () => result), cancel: vi.fn(async () => {}) };
  window.desktop = { frlgRng: api } as unknown as DesktopApi;
  return api;
}
function chooseGolbat() {
  openSettings();
  change('搜索方法', 'All Wild Methods');
  change('野生遭遇地点', 'Cerulean Cave 1F');
  change('火叶自动目标宝可梦', 'Golbat');
  fireEvent.click(screen.getByRole('button', { name: '完成设置' }));
}
afterEach(() => { cleanup(); delete window.desktop; });

describe('real FRLG planner result contract', () => {
  it('shows static target attributes without inventing an uncomputed level', async () => {
    mockApi(starterPlan);
    render(<FrlgAutomationWorkspace profile={profile} />);
    fireEvent.click(searchButton());
    const card = await screen.findByRole('region', { name: '火叶推荐方案' });
    expect(within(card).getByText('闪光妙蛙种子')).toBeTruthy();
    expect(within(card).getByText('定点目标')).toBeTruthy();
    expect(within(card).getByText('25,359')).toBeTruthy();
    expect(within(card).getByText('勤奋 · 茂盛 · 雌性')).toBeTruthy();
    expect(within(card).queryByText(/LV 0/)).toBeNull();
  });

  it('renders the original flat search result with a concrete target and all plan details', async () => {
    const api = mockApi();
    render(<FrlgAutomationWorkspace profile={profile} />);
    chooseGolbat();
    fireEvent.click(searchButton());
    const card = await screen.findByRole('region', { name: '火叶推荐方案' });
    for (const value of ['闪光大嘴蝠', '华蓝洞窟1F · LV 46', '7422', '25,296', '181', 'IV 30 / 28 / 31 / 31 / 31 / 30', '勤奋 · 精神力 · 雌性']) {
      expect(within(card).getByText(value)).toBeTruthy();
    }
    const { dunsparce_three_segment: _unused, ...request } = golbatPlan.request;
    expect(api.search).toHaveBeenCalledWith(request);
    expect((screen.getByRole('button', { name: '开始运行' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('预检通过')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: '查看方案详情' }));
    const dialog = screen.getByRole('dialog', { name: '火叶推荐方案详情' });
    const fields = Object.fromEntries([...dialog.querySelectorAll('dl > div')].map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]));
    expect(fields).toMatchObject({ 宝可梦: '大嘴蝠', 地点: '华蓝洞窟1F', 等级: '46', PID: 'EE2F781E', 闪光: '星形闪光', 性格: '勤奋', 特性: '精神力', 性别: '雌性', 隐藏力量: '超能力 · 68', '目标 Seed': '95594272', '初始 Seed': '7422', Advance: '25,296', 'Seed 模式': '0', SOUND: '单声道 (mono)', 'BUTTON MODE': '帮助 (h)', 'Seed 按键': 'A', 额外按键: '无', 总等待: '00:08:11.027' });
    expect(Object.values(fields)).not.toContain('—');
    expect(within(dialog).getByText(golbatPlan.warnings[0])).toBeTruthy();
    expect(within(dialog).getByText('尚未生成运行脚本；未执行设备与脚本预检。')).toBeTruthy();
  });

  it('does not turn direct-mode filter placeholders into a calculated Pokémon', async () => {
    const direct = { ...golbatPlan, request: { ...golbatPlan.request, direct_mode: true, direct_seed: '0000', direct_advances: 0 }, initial_seed: { ...golbatPlan.initial_seed, seed: '0000', advances: 0 }, target: { ...golbatPlan.target, pid: '', level: 0, shiny: 'Star/Square', nature: 'Any', ability: 'Any', gender: 'Any', ivs: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } }, selection: { ...golbatPlan.selection, iv_total: 0 } };
    mockApi(direct);
    render(<FrlgAutomationWorkspace profile={profile} />);
    chooseGolbat();
    fireEvent.click(screen.getByLabelText('指定 Seed / Advance'));
    change('指定 Seed', '0000'); change('指定 Advance', '0');
    fireEvent.click(searchButton());
    const card = await screen.findByRole('region', { name: '火叶推荐方案' });
    expect(within(card).getByText('大嘴蝠')).toBeTruthy();
    expect(within(card).getByText(/指定模式不计算个体与闪光结果/)).toBeTruthy();
    expect(within(card).queryByText(/LV 0|IV 0|闪光大嘴蝠/)).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: '查看方案详情' }));
    expect(within(screen.getByRole('dialog')).getAllByText('指定模式未计算').length).toBeGreaterThan(5);
  });

  it('offers real ability names and keeps the target when switching within wild methods', () => {
    mockApi(); render(<FrlgAutomationWorkspace />);
    chooseGolbat(); openSettings();
    const ability = screen.getByLabelText('特性筛选') as HTMLSelectElement;
    expect([...ability.options].map(option => [option.value, option.textContent])).toEqual([['Any', '任意'], ['Inner Focus', '精神力 · Inner Focus']]);
    change('特性筛选', 'Inner Focus'); change('搜索方法', 'Wild 4');
    expect((screen.getByLabelText('野生遭遇地点') as HTMLSelectElement).value).toBe('Cerulean Cave 1F');
    expect((screen.getByLabelText('火叶自动目标宝可梦') as HTMLSelectElement).value).toBe('Golbat');
    change('搜索方法', 'Static 1');
    expect(ability.value).toBe('Any');
    expect(within(ability).getByRole('option', { name: '茂盛 · Overgrow' })).toBeTruthy();
  });

  it('invalidates completed and in-flight results when the active save changes', async () => {
    const api = mockApi();
    const view = render(<FrlgAutomationWorkspace profile={profile} />);
    chooseGolbat(); fireEvent.click(searchButton());
    await screen.findByRole('region', { name: '火叶推荐方案' });
    view.rerender(<FrlgAutomationWorkspace profile={{ ...profile, id: 'other', sid: 5 }} />);
    expect(screen.queryByRole('region', { name: '火叶推荐方案' })).toBeNull();
    let finish!: (value: FrlgPlannerResult) => void;
    api.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { fireEvent.click(searchButton()); });
    view.rerender(<FrlgAutomationWorkspace profile={profile} />);
    await act(async () => { finish(golbatPlan); });
    expect(api.cancel).toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '火叶推荐方案' })).toBeNull();
  });
});
