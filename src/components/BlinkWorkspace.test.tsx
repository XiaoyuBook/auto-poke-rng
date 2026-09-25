// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BlinkWorkspace } from './BlinkWorkspace';
import { containedPoint, newBlinkConfig, useBlink, type BlinkObservation, type BlinkState } from '../blink';
import type { DesktopApi } from '../desktop';
import type { VideoState } from '../devices';

afterEach(() => { cleanup(); delete window.desktop; localStorage.clear(); vi.restoreAllMocks(); });
const video: VideoState = { status: 'connected', session: 'one', width: 1920, height: 1080 };
function setup() {
  let listener: (state: BlinkState) => void = () => {};
  let observationListener: (value: BlinkObservation) => void = () => {};
  const start = vi.fn(async () => ({ revision: 1, status: 'starting', captured: 0, target: 40, message: '开始' } as BlinkState));
  const stop = vi.fn(async () => ({ revision: 2, status: 'stopped', captured: 0, target: 40, message: '停止' } as BlinkState));
  const getState = vi.fn(async () => ({ revision: 0, status: 'idle', captured: 0, target: 40, message: '待命' } as BlinkState));
  const timeline = vi.fn(async () => ({ revision: 5, status: 'countdown', captured: 40, target: 40, message: '倒计时' } as BlinkState));
  const importConfig = vi.fn(async () => null);
  const observe = vi.fn(async () => {});
  window.desktop = { blink: { start, stop, getState, timeline, importConfig, observe, onObservation: (callback: (value: BlinkObservation) => void) => { observationListener = callback; return () => {}; }, onState: (callback: (state: BlinkState) => void) => { listener = callback; return () => {}; } } } as unknown as DesktopApi;
  function Harness({ enabled = true, active = false }: { enabled?: boolean; active?: boolean }) {
    const blink = useBlink(video, enabled, active);
    return <><button onClick={() => blink.setConfig({ ...newBlinkConfig(), eye: 'data:image/png;base64,AAAA', roi: { x: 0, y: 0, width: 50, height: 50 }, sourceWidth: 1920, sourceHeight: 1080 })}>准备配置</button><BlinkWorkspace blink={blink} video={video} /></>;
  }
  return { Harness, start, stop, timeline, observe, update: (state: BlinkState) => act(() => listener(state)), observeFrame: (value: BlinkObservation) => act(() => observationListener(value)) };
}

it('maps native pixels through letterboxing and resizing, rejecting selections in black bars', () => {
  const bounds = { left: 100, top: 20, width: 640, height: 360 };
  // 4:3 video centered in the 16:9 preview; 80-pixel black bars on either side.
  expect(containedPoint(150, 200, bounds, 640, 480)).toBeNull();
  expect(containedPoint(420, 200, bounds, 640, 480)).toEqual({ x: 320, y: 240 });
  expect(containedPoint(900, -20, bounds, 640, 480, true)).toEqual({ x: 640, y: 0 });
  expect(containedPoint(260, 110, { ...bounds, width: 320, height: 180 }, 1920, 1080)).toEqual({ x: 960, y: 540 });
});
it('starts live matching on the blink page without occupying capture', async () => {
  const api = setup(); render(<api.Harness active />);
  fireEvent.click(screen.getByRole('button', { name: '准备配置' }));
  await waitFor(() => expect(api.observe).toHaveBeenCalledWith(expect.objectContaining({ mode: 'preview', sourceWidth: 1920 })));
  expect(screen.queryByText(/睁眼模板/)).toBeNull();
  expect(screen.queryByRole('button', { name: '识别预览' })).toBeNull();
  expect(screen.queryByText('1920 × 1080')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('实时眼睛识别中');
  expect((screen.getByRole('button', { name: '捕捉 Seed' }) as HTMLButtonElement).disabled).toBe(false);
});
it('requires real template/ROI, sends chosen mode and persists saved configuration', async () => {
  const api = setup(); render(<api.Harness />);
  expect((screen.getByRole('button', { name: '捕捉 Seed' }) as HTMLButtonElement).disabled).toBe(true);
  const actions = screen.getByRole('button', { name: '捕捉 Seed' }).closest('.blink-capture-actions')!;
  expect([...actions.querySelectorAll('button')].map(button => button.textContent)).toEqual(['捕捉 Seed', 'TID/SID 测种', '校正', 'Timeline']);
  expect([...actions.querySelectorAll('button')].slice(0, 2).every(button => button.classList.contains('primary'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '准备配置' }));
  fireEvent.click(screen.getByRole('button', { name: 'TID/SID 测种' }));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'munchlax', sourceWidth: 1920, threshold: .9 })));
  fireEvent.change(screen.getByLabelText('眨眼配置名称'), { target: { value: '洞窟' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  expect(JSON.parse(localStorage.getItem('auto-poke-rng:bdsp-blink-configs')!)[0].name).toBe('洞窟');
});
it('edits Chinese config names and creates, saves, and selects configurations in the header', async () => {
  const api = setup(); render(<api.Harness />);
  await act(async () => {});
  expect(screen.queryByText('校正范围与初始 Seed')).toBeNull();
  expect(screen.queryByLabelText('眨眼搜索起点')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '准备配置' }));
  fireEvent.change(screen.getByLabelText('眨眼配置名称'), { target: { value: '洞窟眨眼' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  fireEvent.click(screen.getByRole('button', { name: '新增配置' }));
  expect((screen.getByLabelText('眨眼配置名称') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('眨眼配置名称'), { target: { value: '新配置' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  fireEvent.click(screen.getByRole('button', { name: '展开眨眼配置' }));
  expect(screen.getByRole('combobox', { name: '眨眼配置名称' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('option', { name: '洞窟眨眼' }));
  expect((screen.getByLabelText('眨眼配置名称') as HTMLInputElement).value).toBe('洞窟眨眼');
  expect((screen.getByRole('button', { name: '捕捉 Seed' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('listbox', { name: '已保存的眨眼配置' })).toBeNull();
});
it('uses the fixed million-step calibration range for legacy configurations', async () => {
  const legacy = { ...newBlinkConfig(), name: '旧配置', eye: 'data:image/png;base64,AAAA', roi: { x: 0, y: 0, width: 50, height: 50 }, sourceWidth: 1920, sourceHeight: 1080, seed: ['12345678', '87654321', '87654321', '12345678'], searchMin: 25, searchMax: 500 };
  localStorage.setItem('auto-poke-rng:bdsp-blink-configs', JSON.stringify([legacy]));
  const api = setup(); render(<api.Harness />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '校正' }));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'reidentify', searchMin: 0, searchMax: 1_000_000 })));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  expect(JSON.parse(localStorage.getItem('auto-poke-rng:bdsp-blink-configs')!)[0]).toMatchObject({ searchMin: 0, searchMax: 1_000_000 });
});
it('shows capture progress in the footer for the selected mode', async () => {
  const api = setup(); render(<api.Harness />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '准备配置' }));
  fireEvent.click(screen.getByRole('button', { name: 'TID/SID 测种' }));
  api.update({ revision: 3, mode: 'munchlax', status: 'capturing', captured: 2, target: 64, blinks: [0,0], intervals: [1.23,4.56], message: '捕获中' });
  expect(screen.getByText('2 / 64')).toBeTruthy();
  expect((screen.getByRole('button', { name: '停止TID/SID 测种' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: '捕捉 Seed' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '校正' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '停止TID/SID 测种' }));
  expect(api.stop).toHaveBeenCalledOnce();
  api.update({ revision: 4, mode: 'munchlax', status: 'stopped', captured: 2, target: 64, message: '已停止', result: { words: ['12345678', '87654321', '87654321', '12345678'], pair: ['1234567887654321', '8765432112345678'], mode: 'munchlax', matchedAdvance: null, capturedAt: 1, blinks: [], intervals: [] } });
  expect(screen.getByRole('status').textContent).toContain('实时眼睛识别继续');
  fireEvent.click(screen.getByRole('button', { name: '校正' }));
  api.update({ revision: 5, mode: 'reidentify', status: 'capturing', captured: 0, target: 7, message: '捕获中' });
  expect(screen.getByText('0 / 7')).toBeTruthy();
  expect(screen.getByRole('button', { name: '停止校正' }).textContent).toContain('停止');
  api.update({ revision: 6, mode: 'reidentify', status: 'stopped', captured: 0, target: 7, message: '已停止' });
  fireEvent.click(screen.getByLabelText('1 PK NPC 校正'));
  fireEvent.click(screen.getByRole('button', { name: '校正' }));
  api.update({ revision: 7, mode: 'reidentify', status: 'capturing', captured: 0, target: 20, message: '捕获中' });
  expect(screen.getByText('0 / 20')).toBeTruthy();
});

it('persists every original timing parameter and sends them to capture and Timeline', async () => {
  const api = setup(); render(<api.Harness />); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '准备配置' }));
  expect(screen.getByRole('region', { name: '高级时序' }).querySelector('h3')?.textContent).toContain('高级时序8 项参数');
  expect(screen.getByLabelText('眨眼NPC数').closest('details')).toBeNull();
  for (const [label, value] of [['眨眼NPC数', '3'], ['眨眼时间延迟', '.8'], ['眨眼帧数延迟', '13'], ['眨眼帧数延迟2', '27'], ['Timeline NPC 数', '-1'], ['宝可梦 NPC 数', '2']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByLabelText('关闭菜单 +1'));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  const timing = { npc: 3, timeDelay: .8, advanceDelay: 13, advanceDelay2: 27, timelineNpc: -1, pokemonNpc: 2, menuClose: false };
  expect(JSON.parse(localStorage.getItem('auto-poke-rng:bdsp-blink-configs')!)[0]).toMatchObject(timing);
  fireEvent.click(screen.getByRole('button', { name: '捕捉 Seed' }));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith(expect.objectContaining(timing)));
  api.update({ revision: 3, mode: 'recover', status: 'tracking', captured: 40, target: 40, message: '正在推进', tracking: { advances: 25, phase: 'tracking', nextIn: .5, countdown: null, words: ['1','2','3','4'], pair: [] } });
  expect(screen.getByText('当前 25 帧')).toBeTruthy();
  expect(screen.getByRole('button', { name: '停止捕捉 Seed' }).textContent).toContain('停止');
  expect((screen.getByRole('button', { name: 'TID/SID 测种' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
  expect(api.timeline).toHaveBeenCalledOnce();
  api.update({ revision: 4, mode: 'munchlax', status: 'tracking', captured: 64, target: 64, message: '正在推进' });
  expect((screen.getByRole('button', { name: 'Timeline' }) as HTMLButtonElement).disabled).toBe(true);
});
it('reports real progress, locks settings, and stops on game exit', async () => {
  const api = setup(); const app = render(<api.Harness />);
  await act(async () => {});
  api.update({ revision: 3, runId: 'one', mode: 'recover', status: 'capturing', captured: 2, target: 40, blinks: [0,1], intervals: [3,5], message: '捕获中' });
  expect(screen.getByText('2 / 40')).toBeTruthy();
  expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true);
  app.rerender(<api.Harness enabled={false} />);
  await waitFor(() => expect(api.stop).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: '填入定点数据' })).toBeNull();
});

it('stops a late arriving running state after leaving BDSP', async () => {
  const api = setup(); render(<api.Harness enabled={false} />);
  await act(async () => {});
  api.update({ revision: 3, runId: 'one', status: 'capturing', captured: 0, target: 40, message: '捕获中' });
  await waitFor(() => expect(api.stop).toHaveBeenCalled());
});
