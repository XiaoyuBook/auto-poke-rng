// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BlinkWorkspace } from './BlinkWorkspace';
import { containedPoint, newBlinkConfig, useBlink, type BlinkState } from '../blink';
import type { DesktopApi } from '../desktop';
import type { VideoState } from '../devices';

afterEach(() => { cleanup(); delete window.desktop; localStorage.clear(); vi.restoreAllMocks(); });
const video: VideoState = { status: 'connected', session: 'one', width: 1920, height: 1080 };
function setup() {
  let listener: (state: BlinkState) => void = () => {};
  const start = vi.fn(async () => ({ revision: 1, status: 'starting', captured: 0, target: 40, message: '开始' } as BlinkState));
  const stop = vi.fn(async () => ({ revision: 2, status: 'stopped', captured: 0, target: 40, message: '停止' } as BlinkState));
  const getState = vi.fn(async () => ({ revision: 0, status: 'idle', captured: 0, target: 40, message: '待命' } as BlinkState));
  const timeline = vi.fn(async () => ({ revision: 5, status: 'countdown', captured: 40, target: 40, message: '倒计时' } as BlinkState));
  const importConfig = vi.fn(async () => null);
  window.desktop = { blink: { start, stop, getState, timeline, importConfig, onState: (callback: (state: BlinkState) => void) => { listener = callback; return () => {}; } } } as unknown as DesktopApi;
  const apply = vi.fn();
  function Harness({ enabled = true }: { enabled?: boolean }) {
    const blink = useBlink(video, enabled);
    return <><button onClick={() => blink.setConfig({ ...newBlinkConfig(), eye: 'data:image/png;base64,AAAA', roi: { x: 0, y: 0, width: 50, height: 50 }, sourceWidth: 1920, sourceHeight: 1080 })}>准备配置</button><BlinkWorkspace blink={blink} video={video} onApply={apply} /></>;
  }
  return { Harness, apply, start, stop, timeline, update: (state: BlinkState) => act(() => listener(state)) };
}

it('maps native pixels through letterboxing and resizing, rejecting selections in black bars', () => {
  const bounds = { left: 100, top: 20, width: 640, height: 360 };
  // 4:3 video centered in the 16:9 preview; 80-pixel black bars on either side.
  expect(containedPoint(150, 200, bounds, 640, 480)).toBeNull();
  expect(containedPoint(420, 200, bounds, 640, 480)).toEqual({ x: 320, y: 240 });
  expect(containedPoint(900, -20, bounds, 640, 480, true)).toEqual({ x: 640, y: 0 });
  expect(containedPoint(260, 110, { ...bounds, width: 320, height: 180 }, 1920, 1080)).toEqual({ x: 960, y: 540 });
});
it('requires real template/ROI, sends chosen mode and persists saved configuration', async () => {
  const api = setup(); render(<api.Harness />);
  expect((screen.getByRole('button', { name: '捕捉 Seed' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '准备配置' }));
  fireEvent.click(screen.getByRole('button', { name: 'TID/SID 测种' }));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'munchlax', sourceWidth: 1920, threshold: .9 })));
  fireEvent.change(screen.getByLabelText('眨眼配置名称'), { target: { value: '洞窟' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  expect(JSON.parse(localStorage.getItem('auto-poke-rng:bdsp-blink-configs')!)[0].name).toBe('洞窟');
});
it('shows the selected mode target before starting and does not mix another mode’s observations', async () => {
  const api = setup(); render(<api.Harness />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '准备配置' }));
  fireEvent.click(screen.getByRole('button', { name: 'TID/SID 测种' }));
  expect(screen.getByLabelText('眨眼捕获进度').getAttribute('max')).toBe('64');
  expect(screen.getByText('0 / 64')).toBeTruthy();
  api.update({ revision: 3, mode: 'munchlax', status: 'stopped', captured: 2, target: 64, blinks: [0,0], intervals: [1.23,4.56], message: '已停止' });
  expect(screen.getByText('2 / 64')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '校正' }));
  expect(screen.getByText('0 / 7')).toBeTruthy();
  expect(screen.queryByText('4.560')).toBeNull();
  fireEvent.click(screen.getByLabelText('1 PK NPC 校正'));
  expect(screen.getByText('0 / 20')).toBeTruthy();
});

it('persists every original timing parameter and sends them to capture and Timeline', async () => {
  const api = setup(); render(<api.Harness />); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '准备配置' }));
  for (const [label, value] of [['眨眼时间延迟', '.8'], ['眨眼帧数延迟', '13'], ['眨眼帧数延迟2', '27'], ['Timeline NPC 数', '-1'], ['宝可梦 NPC 数', '2']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByLabelText('关闭菜单 +1'));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  const timing = { timeDelay: .8, advanceDelay: 13, advanceDelay2: 27, timelineNpc: -1, pokemonNpc: 2, menuClose: false };
  expect(JSON.parse(localStorage.getItem('auto-poke-rng:bdsp-blink-configs')!)[0]).toMatchObject(timing);
  fireEvent.click(screen.getByRole('button', { name: '捕捉 Seed' }));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith(expect.objectContaining(timing)));
  api.update({ revision: 3, mode: 'recover', status: 'tracking', captured: 40, target: 40, message: '正在推进', tracking: { advances: 25, phase: 'tracking', nextIn: .5, countdown: null, words: ['1','2','3','4'], pair: [] } });
  expect(screen.getByText('25')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
  expect(api.timeline).toHaveBeenCalledOnce();
  api.update({ revision: 4, mode: 'munchlax', status: 'tracking', captured: 64, target: 64, message: '正在推进' });
  expect((screen.getByRole('button', { name: 'Timeline' }) as HTMLButtonElement).disabled).toBe(true);
});
it('reports real progress, locks settings, stops on game exit and transfers full 64-bit seeds as strings', async () => {
  const api = setup(); const app = render(<api.Harness />);
  await act(async () => {});
  api.update({ revision: 3, runId: 'one', mode: 'recover', status: 'capturing', captured: 2, target: 40, blinks: [0,1], intervals: [3,5], message: '捕获中' });
  expect(screen.getByText('双 5')).toBeTruthy();
  expect((screen.getByLabelText('眨眼匹配阈值') as HTMLInputElement).disabled).toBe(true);
  app.rerender(<api.Harness enabled={false} />);
  await waitFor(() => expect(api.stop).toHaveBeenCalled());
  const result = { words: ['FFFFFFFF', 'FFFFFFFF', '87654321', '12345678'], pair: ['FFFFFFFFFFFFFFFF', '8765432112345678'], mode: 'recover' as const, matchedAdvance: null, capturedAt: 1234, blinks: [], intervals: [] };
  api.update({ revision: 4, status: 'completed', captured: 40, target: 40, message: '已完成', result });
  expect((screen.getByLabelText('捕获 Seed 0') as HTMLInputElement).value).toBe('FFFFFFFFFFFFFFFF');
  fireEvent.click(screen.getByRole('button', { name: '填入定点数据' }));
  expect(api.apply).toHaveBeenCalledWith(result);
});

it('stops a late arriving running state after leaving BDSP', async () => {
  const api = setup(); render(<api.Harness enabled={false} />);
  await act(async () => {});
  api.update({ revision: 3, runId: 'one', status: 'capturing', captured: 0, target: 40, message: '捕获中' });
  await waitFor(() => expect(api.stop).toHaveBeenCalled());
});
