// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FrlgHomeWorkspace } from './FrlgHomeWorkspace';
import { useFrlgSaves } from '../frlgProfile';
import { getFrlgDex } from '../frlgDex';
import type { FrlgRunState } from '../frlgExecution';
import type { DesktopApi } from '../desktop';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.desktop; });

function Home() {
  const saves = useFrlgSaves();
  return <FrlgHomeWorkspace saves={saves} onOpenAutomation={vi.fn()} />;
}

it('applies automatic completion to the originating save and preserves manual undo across replays and reloads', async () => {
  const idle: FrlgRunState = { status: 'idle', runId: null, profileId: null, message: '', logs: [] };
  let latest = idle;
  const onState = vi.fn((_listener: (state: FrlgRunState) => void) => vi.fn());
  window.desktop = { frlgAutomation: { getState: vi.fn(async () => latest), onState } } as unknown as DesktopApi;
  const view = render(<Home />);
  fireEvent.click(screen.getByRole('button', { name: '新建存档' }));
  const selector = screen.getByLabelText('当前火叶存档');
  latest = { ...idle, status: 'completed', runId: 'run-a', profileId: 'frlg-save-1', dexCompletion: { speciesId: 1, evidence: 'target_shiny' } };
  await act(async () => onState.mock.calls[0][0](latest));
  expect((screen.getByLabelText('标记妙蛙种子已完成') as HTMLInputElement).checked).toBe(false);
  fireEvent.change(selector, { target: { value: 'frlg-save-1' } });
  expect((screen.getByLabelText('标记妙蛙种子已完成') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByLabelText('标记妙蛙种子已完成'));
  await act(async () => onState.mock.calls[0][0](latest));
  expect((screen.getByLabelText('标记妙蛙种子已完成') as HTMLInputElement).checked).toBe(false);
  view.unmount();
  render(<Home />);
  await act(async () => {});
  expect((screen.getByLabelText('标记妙蛙种子已完成') as HTMLInputElement).checked).toBe(false);
  const notify = onState.mock.calls[1][0];
  await act(async () => notify({ ...latest, runId: 'run-b', dexCompletion: { speciesId: 4, evidence: 'full_target_hit' } }));
  expect((screen.getByLabelText('标记小火龙已完成') as HTMLInputElement).checked).toBe(true);
  for (const state of [
    { ...latest, status: 'failed' as const, runId: 'failed', dexCompletion: { speciesId: 7, evidence: 'target_shiny' as const } },
    { ...latest, runId: 'invalid', dexCompletion: { speciesId: 387, evidence: 'target_shiny' as const } },
    { ...latest, runId: 'missing', profileId: 'missing', dexCompletion: { speciesId: 7, evidence: 'target_shiny' as const } },
  ]) await act(async () => notify(state));
  expect((screen.getByLabelText('标记杰尼龟已完成') as HTMLInputElement).checked).toBe(false);
  expect(JSON.parse(localStorage.getItem('auto-poke-rng:frlg-saves-v1')!).profiles[0].completedSpecies).toEqual([4]);
});

it('keeps fireleaf save slots independent when saving and switching profiles', () => {
  render(<Home />);
  fireEvent.click(screen.getByText('存档资料', { exact: true }));
  fireEvent.change(screen.getByLabelText('火叶存档名称'), { target: { value: '火红主线' } });
  fireEvent.change(screen.getByLabelText('火叶存档 TID'), { target: { value: '12345' } });
  fireEvent.change(screen.getByLabelText('火叶存档 SID'), { target: { value: '54321' } });
  fireEvent.click(screen.getByLabelText('标记妙蛙种子已完成'));
  fireEvent.click(screen.getByRole('button', { name: '保存当前存档' }));
  expect(document.querySelector('.frlg-save-feedback')?.textContent).toContain('当前存档已保存');

  fireEvent.click(screen.getByRole('button', { name: '新建存档' }));
  const selector = screen.getByLabelText('当前火叶存档') as HTMLSelectElement;
  expect(selector.options).toHaveLength(2);
  expect((screen.getByLabelText('火叶存档名称') as HTMLInputElement).value).toBe('火叶存档 2');
  expect((screen.getByLabelText('火叶存档 TID') as HTMLInputElement).value).toBe('0');
  fireEvent.change(screen.getByLabelText('火叶存档名称'), { target: { value: '叶绿支线' } });
  fireEvent.click(screen.getByRole('button', { name: '保存当前存档' }));

  fireEvent.change(selector, { target: { value: 'frlg-save-1' } });
  expect((screen.getByLabelText('火叶存档名称') as HTMLInputElement).value).toBe('火红主线');
  expect((screen.getByLabelText('火叶存档 TID') as HTMLInputElement).value).toBe('12345');
  expect((screen.getByLabelText('标记妙蛙种子已完成') as HTMLInputElement).checked).toBe(true);
});

it('persists individual progress across reloads and never guesses species from the old global flag', () => {
  localStorage.setItem('auto-poke-rng:frlg-saves-v1', JSON.stringify({activeId:'legacy',profiles:[{id:'legacy',name:'旧存档',game:'fr_nx',tid:0,sid:0,dexCompleted:true,completedSpecies:[1,1,25,0,387,'4']}]}));
  const view = render(<Home/>);
  expect((screen.getByRole('progressbar', {name:'火叶乱数图鉴进度'}) as HTMLProgressElement).value).toBe(2);
  fireEvent.click(screen.getByLabelText('标记小火龙已完成'));
  view.unmount();
  render(<Home/>);
  expect((screen.getByLabelText('标记小火龙已完成') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('progressbar', {name:'火叶乱数图鉴进度'}) as HTMLProgressElement).value).toBe(3);
});

it('copies the checklist independently and does not erase progress when trainer edits are saved', () => {
  render(<Home/>);
  fireEvent.click(screen.getByText('存档资料', {exact:true}));
  fireEvent.change(screen.getByLabelText('训练家名称'), {target:{value:'小智'}});
  fireEvent.click(screen.getByLabelText('标记妙蛙种子已完成'));
  fireEvent.click(screen.getByLabelText('标记小火龙已完成'));
  fireEvent.click(screen.getByRole('button', {name:'保存当前存档'}));
  fireEvent.click(screen.getByRole('button', {name:'复制当前存档'}));
  expect((screen.getByLabelText('标记妙蛙种子已完成') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByLabelText('标记妙蛙种子已完成'));
  fireEvent.change(screen.getByLabelText('当前火叶存档'), {target:{value:'frlg-save-1'}});
  expect((screen.getByLabelText('标记妙蛙种子已完成') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('标记小火龙已完成') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('训练家名称') as HTMLInputElement).value).toBe('小智');
});

it('filters supported targets and excludes unavailable species even when searched by number', () => {
  render(<Home/>);
  fireEvent.click(screen.getByLabelText('标记妙蛙种子已完成'));
  fireEvent.change(screen.getByLabelText('图鉴完成状态'), {target:{value:'complete'}});
  expect(screen.getByRole('button', {name:'选择 妙蛙种子 #001'})).toBeTruthy();
  expect(screen.queryByRole('button', {name:'选择 小火龙 #004'})).toBeNull();
  fireEvent.change(screen.getByLabelText('图鉴完成状态'), {target:{value:'all'}});
  fireEvent.click(screen.getByRole('button', {name:'城都'}));
  fireEvent.change(screen.getByLabelText('搜索图鉴'), {target:{value:'#152'}});
  expect(screen.queryByRole('button', {name:'选择 菊草叶 #152'})).toBeNull();
  expect(screen.getByText(/没有符合条件/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索图鉴'), {target:{value:'#246'}});
  fireEvent.click(screen.getByRole('button', {name:'选择 幼基拉斯 #246'}));
  expect((screen.getByRole('button', {name:'设为乱数目标'}) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByLabelText('标记幼基拉斯已完成'));
  expect((screen.getByRole('progressbar', {name:'火叶乱数图鉴进度'}) as HTMLProgressElement).value).toBe(2);
  expect(screen.queryByLabelText('可搜索目标')).toBeNull();
});

it('counts only supported completion records and follows version changes without erasing saved progress', () => {
  localStorage.setItem('auto-poke-rng:frlg-saves-v1', JSON.stringify({activeId:'legacy',profiles:[{id:'legacy',name:'旧存档',game:'fr_nx',tid:0,sid:0,dexCompleted:false,completedSpecies:[1,25,123,152]}]}));
  render(<Home/>);
  const progress = () => screen.getByRole('progressbar', {name:'火叶乱数图鉴进度'}) as HTMLProgressElement;
  expect(progress().value).toBe(3);
  expect(progress().max).toBe(getFrlgDex('fr_nx').entries.length);
  fireEvent.change(screen.getByLabelText('搜索图鉴'), {target:{value:'Scyther'}});
  fireEvent.click(screen.getByRole('button', {name:'选择 飞天螳螂 #123'}));
  fireEvent.click(screen.getByText('存档资料', {exact:true}));
  fireEvent.change(screen.getByLabelText('火叶存档游戏版本'), {target:{value:'lg_nx'}});
  fireEvent.click(screen.getByRole('button', {name:'保存当前存档'}));
  expect(progress().value).toBe(2);
  expect(progress().max).toBe(getFrlgDex('lg_nx').entries.length);
  expect(screen.queryByRole('button', {name:'选择 飞天螳螂 #123'})).toBeNull();
  expect(document.querySelector('.frlg-dex-target-name')?.textContent).toContain('妙蛙种子');
  fireEvent.change(screen.getByLabelText('火叶存档游戏版本'), {target:{value:'fr_jpn_nx'}});
  fireEvent.click(screen.getByRole('button', {name:'保存当前存档'}));
  expect(progress().value).toBe(1);
  expect(progress().max).toBe(3);
  expect(screen.queryByRole('button', {name:'城都'})).toBeNull();
  expect(screen.queryByRole('button', {name:'丰缘'})).toBeNull();
  fireEvent.change(screen.getByLabelText('火叶存档游戏版本'), {target:{value:'fr_nx'}});
  fireEvent.click(screen.getByRole('button', {name:'保存当前存档'}));
  expect(progress().value).toBe(3);
  expect((screen.getByLabelText('标记飞天螳螂已完成') as HTMLInputElement).checked).toBe(true);
  expect(JSON.parse(localStorage.getItem('auto-poke-rng:frlg-saves-v1')!).profiles[0].completedSpecies).toEqual([1,25,123,152]);
});
