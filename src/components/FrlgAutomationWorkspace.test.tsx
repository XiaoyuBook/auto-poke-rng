// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FrlgAutomationWorkspace } from './FrlgAutomationWorkspace';
import { defaultFrlgSaveProfile } from '../frlgProfile';
import type { DesktopApi } from '../desktop';
import type { FrlgPlannerResult } from '../frlgAutomation';
import type { FrlgRunState } from '../frlgExecution';
import golbatPlan from '../../tests/fixtures/frlg-golbat-plan.json';
import starterPlan from '../../tests/fixtures/frlg-starter-plan.json';

const profile = { ...defaultFrlgSaveProfile, sid: 38448 };
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openSettings = () => fireEvent.click(screen.getByRole('button', { name: '目标设置' }));
const searchButton = () => {
  if (!screen.queryByRole('dialog', { name: '火叶目标与筛选条件' })) openSettings();
  return screen.getByRole('button', { name: '搜索并生成方案' });
};
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
}
afterEach(() => { cleanup(); delete window.desktop; localStorage.clear(); });

describe('real FRLG planner result contract', () => {
  it('keeps run status in the toolbar and opens the centralized logs without a duplicate log card', async () => {
    mockApi();
    const onOpenLogs = vi.fn();
    window.desktop!.frlgAutomation = { getState: vi.fn(async () => ({ status: 'running' as const, runId: 'frlg-1', profileId: profile.id, message: '正在执行火叶自动流程', logs: ['已开始'], progress: { source: 'main.ecs', line: 10, action: 'settings.check', text: '' } })), onState: vi.fn(() => () => {}), start: vi.fn(), stop: vi.fn() };
    render(<FrlgAutomationWorkspace profile={profile} onOpenLogs={onOpenLogs}/>);
    await screen.findByText('正在检查游戏设置');
    expect(screen.queryByRole('region', { name: '火叶运行状态' })).toBeNull();
    expect(screen.queryByLabelText('火叶运行日志')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开日志中心' }));
    expect(onOpenLogs).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('auto-poke-rng:log-context')!)).toEqual({ runId: 'frlg-1' });
  });
  it('handles damaged saved options and restores expansion settings when switching saves', () => {
    mockApi();
    localStorage.setItem('auto-poke-frlg-run:' + profile.id, 'null');
    localStorage.setItem('auto-poke-frlg-run:save-b', JSON.stringify({ entry: 'timeline', reverse_expansion_seed_tolerances: [2, 4, 8] }));
    const view = render(<FrlgAutomationWorkspace profile={profile} />);
    expect((screen.getByLabelText('脚本入口') as HTMLSelectElement).value).toBe('formal');
    view.rerender(<FrlgAutomationWorkspace profile={{ ...profile, id: 'save-b' }} />);
    expect((screen.getByLabelText('脚本入口') as HTMLSelectElement).value).toBe('timeline');
    expect((screen.getByLabelText('三层 Seed 容差') as HTMLInputElement).value).toBe('2,4,8');
    view.rerender(<FrlgAutomationWorkspace profile={profile} />);
    expect((screen.getByLabelText('三层 Seed 容差') as HTMLInputElement).value).toBe('');
  });

  it('shows static target attributes without inventing an uncomputed level', async () => {
    mockApi(starterPlan);
    render(<FrlgAutomationWorkspace profile={profile} />);
    fireEvent.click(searchButton());
    const card = await screen.findByRole('region', { name: '火叶推荐方案' });
    expect(screen.queryByRole('dialog', { name: '火叶目标与筛选条件' })).toBeNull();
    expect(screen.queryByRole('region', { name: '当前火叶目标与筛选条件' })).toBeNull();
    expect(screen.getByRole('region', { name: 'BINGO 状态' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '搜索并生成方案' })).toBeNull();
    expect(within(card).getByText('闪光妙蛙种子')).toBeTruthy();
    expect(within(card).getByText('定点目标')).toBeTruthy();
    expect(within(card).getByText('25,359')).toBeTruthy();
    expect(within(card).getByText('勤奋 · 茂盛 · 雌性')).toBeTruthy();
    expect(within(card).queryByText(/LV 0/)).toBeNull();
  });

  it('renders the original flat search result with a concrete target and all plan details', async () => {
    const api = mockApi();
    const start = vi.fn(async () => ({status:'running' as const,runId:'frlg-1',profileId:profile.id,message:'执行中',logs:[]}));
    window.desktop!.frlgAutomation = {getState:vi.fn(async()=>({status:'idle' as const,runId:null,profileId:null,message:'待命',logs:[]})),onState:vi.fn(()=>()=>{}),start,stop:vi.fn()};
    render(<FrlgAutomationWorkspace profile={profile} />);
    chooseGolbat();
    for (const label of ['游戏版本','TID','SID']) expect(screen.queryByLabelText(label)).toBeNull();
    fireEvent.click(searchButton());
    const card = await screen.findByRole('region', { name: '火叶推荐方案' });
    for (const value of ['闪光大嘴蝠', '华蓝洞窟1F · LV 46', '7422', '25,296', '181', 'IV 30 / 28 / 31 / 31 / 31 / 30', '勤奋 · 精神力 · 雌性']) {
      expect(within(card).getByText(value)).toBeTruthy();
    }
    const { dunsparce_three_segment: _unused, ...request } = golbatPlan.request;
    expect(api.search).toHaveBeenCalledWith(request);
    expect((screen.getByRole('button', { name: '开始运行' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('预检通过')).toBeNull();
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'开始运行'})));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({profileId:profile.id,request:expect.objectContaining({game:profile.game,tid:profile.tid,sid:profile.sid})}));
    fireEvent.click(within(card).getByRole('button', { name: '查看方案详情' }));
    const dialog = screen.getByRole('dialog', { name: '火叶推荐方案详情' });
    const fields = Object.fromEntries([...dialog.querySelectorAll('dl > div')].map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]));
    expect(fields).toMatchObject({ 宝可梦: '大嘴蝠', 地点: '华蓝洞窟1F', 等级: '46', PID: 'EE2F781E', 闪光: '星形闪光', 性格: '勤奋', 特性: '精神力', 性别: '雌性', 隐藏力量: '超能力 · 68', '目标 Seed': '95594272', '初始 Seed': '7422', Advance: '25,296', 'Seed 模式': '0', SOUND: '单声道 (mono)', 'BUTTON MODE': '帮助 (h)', 'Seed 按键': 'A', 额外按键: '无', 总等待: '00:08:11.027' });
    expect(Object.values(fields)).not.toContain('—');
    expect(within(dialog).getByText(golbatPlan.warnings[0])).toBeTruthy();
    expect(within(dialog).getByText('开始运行时生成独立脚本，并检查标签、OCR、视频源和伊机控。')).toBeTruthy();
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
    view.rerender(<FrlgAutomationWorkspace profile={{ ...profile, id: 'other', game:'lg_nx2', tid:22222, sid: 5 }} />);
    expect(screen.queryByRole('region', { name: '火叶推荐方案' })).toBeNull();
    let finish!: (value: FrlgPlannerResult) => void;
    api.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    openSettings();
    await act(async () => { fireEvent.click(searchButton()); });
    expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({game:'lg_nx2',tid:22222,sid:5}));
    view.rerender(<FrlgAutomationWorkspace profile={profile} />);
    await act(async () => { finish(golbatPlan); });
    expect(api.cancel).toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '火叶推荐方案' })).toBeNull();
  });

  it('keeps search failures in the settings dialog and allows retrying with the same parameters', async () => {
    const api = mockApi();
    api.search.mockRejectedValueOnce(Error('没有符合条件的可达方案'));
    render(<FrlgAutomationWorkspace profile={profile}/>);
    chooseGolbat();
    expect(screen.getByRole('dialog').contains(screen.getByLabelText('最大 Advance'))).toBe(true);
    fireEvent.click(searchButton());
    await screen.findByText('没有符合条件的可达方案');
    expect(screen.getByRole('dialog', { name: '火叶目标与筛选条件' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '开始运行' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(searchButton());
    await screen.findByRole('region', { name: '火叶推荐方案' });
    expect(api.search).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels an in-flight dialog search without accepting its late result', async () => {
    const api = mockApi();
    let finish!: (value: FrlgPlannerResult) => void;
    api.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<FrlgAutomationWorkspace profile={profile}/>);
    chooseGolbat();
    await act(async () => { fireEvent.click(searchButton()); });
    expect(!!screen.getByLabelText('最大 Advance').closest('fieldset:disabled')).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '取消搜索' })); });
    await act(async () => { finish(golbatPlan); });
    expect(api.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: '火叶推荐方案' })).toBeNull();
    expect(screen.getByRole('button', { name: '搜索并生成方案' })).toBeTruthy();
  });

  it('updates the workspace BINGO from run events and isolates it by save', async () => {
    mockApi();
    const axis = [-4,-3,-2,-1,0,1,2,3,4];
    const bingo = {version:1,observed:true,axis,seedText:[],grid:axis.map(seed=>axis.map(frame=>({seed,frame,count:seed===1&&frame===0?1:0,marker:''}))),tv:{enabled:true,current:1,prediction:0,radius:1,counts:[],cells:axis.map(frame=>({seed:0,frame,count:frame===1?1:0,marker:''}))},current:{seed:1,frame:0,hitSeed:1,hitFrame:314,inRange:true,inDeadZone:false},context:{seedTolerance:1,targetIndex:0,seedMaxIndex:1,game:0,seedMode:0,enterTv:true,tvFrameCost:314},stable:{type:0,count:0,threshold:5,seed:0,frame:0,result:false},count:1};
    const state = {status:'running' as const,runId:'frlg-1',profileId:profile.id,message:'执行中',logs:[],bingo};
    const onState = vi.fn((_listener: (value: FrlgRunState) => void) => () => {});
    window.desktop!.frlgAutomation = {getState:vi.fn(async()=>state),onState,start:vi.fn(),stop:vi.fn()};
    const view = render(<FrlgAutomationWorkspace profile={profile}/>);
    await screen.findByRole('button', { name:'Seed 偏差 +1，剩余帧偏差 0，累计命中 1 次，本轮落点' });
    await act(async()=>onState.mock.calls[0][0]({...state,bingo:{...bingo,grid:bingo.grid.map(row=>row.map(cell=>({...cell,count:cell.count*2})))}}));
    expect(screen.getByRole('button', {name:'Seed 偏差 +1，剩余帧偏差 0，累计命中 2 次，本轮落点'})).toBeTruthy();
    expect(screen.queryByText(/本轮帧偏差拆分/)).toBeNull();
    view.rerender(<FrlgAutomationWorkspace profile={{...profile,id:'save-b'}}/>);
    expect(screen.getByText('等待首次命中数据')).toBeTruthy();
    expect(screen.queryByRole('button', {name:/累计命中 2 次/})).toBeNull();
  });
});
