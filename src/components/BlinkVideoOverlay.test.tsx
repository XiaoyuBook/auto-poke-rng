// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BlinkVideoOverlay } from './BlinkVideoOverlay';
import { newBlinkConfig, type BlinkConfig, type BlinkController } from '../blink';
import type { VideoState } from '../devices';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const video: VideoState = { status: 'connected', session: 'one', width: 640, height: 480 };
const roi = { x: 20, y: 30, width: 100, height: 60 };
const location = { x: 40, y: 45, width: 25, height: 12 };
function controller(patch: Record<string, unknown> = {}) {
  return {
    config: { ...newBlinkConfig(), eye: 'data:image/png;base64,AAAA', roi, sourceWidth: 640, sourceHeight: 480 },
    state: { status: 'idle' }, observation: { score: .5, location }, busy: false,
    selection: null, setConfig: vi.fn(), finishSelection: vi.fn(async () => {}), cancelSelection: vi.fn(), ...patch,
  } as unknown as BlinkController;
}

it('shows both live boxes and highlights the blink threshold interval', () => {
  const target = document.createElement('div'); document.body.append(target);
  const blink = controller();
  const app = render(<BlinkVideoOverlay blink={blink} target={target} video={video} />);
  expect(target.querySelector('.blink-roi.is-blinking')).toBeTruthy();
  expect(target.querySelector('.blink-match.is-blinking')?.getAttribute('x')).toBe('40');
  expect(screen.getByLabelText('实时匹配分数').textContent).toBe('0.5000');
  expect((screen.getByLabelText('眨眼匹配阈值') as HTMLInputElement).value).toBe('0.9');
  fireEvent.change(screen.getByLabelText('眨眼匹配阈值'), { target: { value: '0.8' } });
  expect(blink.setConfig).toHaveBeenCalledOnce();
  const update = vi.mocked(blink.setConfig).mock.calls[0][0] as (config: BlinkConfig) => BlinkConfig;
  expect(update(blink.config).threshold).toBe(.8);
  app.rerender(<BlinkVideoOverlay blink={controller({ observation: { score: .99, location } })} target={target} video={video} />);
  expect(target.querySelector('.blink-roi.is-blinking')).toBeNull();
  expect(target.querySelector('.blink-match:not(.is-blinking)')).toBeTruthy();
  expect(screen.getByLabelText('实时匹配分数').textContent).toBe('0.9900');
  app.rerender(<BlinkVideoOverlay blink={controller({ busy: true, state: { status: 'capturing', score: .95, location } })} target={target} video={video} />);
  expect((screen.getByLabelText('眨眼匹配阈值') as HTMLInputElement).disabled).toBe(true);
  app.rerender(<BlinkVideoOverlay blink={controller({ config: { ...newBlinkConfig(), eye: 'data:image/png;base64,AAAA', roi: null, sourceWidth: 640, sourceHeight: 480 } })} target={target} video={video} />);
  expect(screen.queryByLabelText('眨眼匹配阈值')).toBeNull();
  target.remove();
});

it('shows current frame and complete seeds only on the blink video overlay', () => {
  const target = document.createElement('div'); document.body.append(target);
  const result = { pair: ['FFFFFFFFFFFFFFFF', '8765432112345678'], baselineAdvances: 120 };
  const blink = controller({ state: { status: 'tracking', result, tracking: { advances: 125 } } });
  const app = render(<BlinkVideoOverlay blink={blink} target={target} video={video} />);
  const badge = screen.getByRole('region', { name: '眨眼帧数与 Seed' });
  expect(badge.parentElement).toBe(target.querySelector('.blink-video-overlay'));
  expect(screen.getByLabelText('当前帧数').textContent).toBe('125');
  expect(screen.getByLabelText('捕获 Seed 0').textContent).toBe('FFFFFFFFFFFFFFFF');
  expect(screen.getByLabelText('捕获 Seed 1').textContent).toBe('8765432112345678');
  expect(badge.querySelector('button')).toBeNull();
  app.rerender(<BlinkVideoOverlay blink={blink} target={target} video={{ ...video, status: 'idle' }} />);
  expect(screen.getByRole('region', { name: '眨眼帧数与 Seed' })).toBeTruthy();
  app.rerender(<BlinkVideoOverlay blink={controller({ state: { status: 'idle', result }, selection: { kind: 'roi', frame: { url: 'data:image/png;base64,AAAA', session: 'one', sequence: '1', width: 640, height: 480 } } })} target={target} video={video} />);
  expect(screen.queryByRole('region', { name: '眨眼帧数与 Seed' })).toBeNull();
  target.remove();
});

it('commits a right-button drag on the frozen video without a confirmation click', async () => {
  const target = document.createElement('div'); document.body.append(target);
  const finishSelection = vi.fn(async () => {});
  const blink = controller({ selection: { kind: 'roi', frame: { url: 'data:image/png;base64,AAAA', session: 'one', sequence: '1', width: 640, height: 480 } }, finishSelection });
  render(<BlinkVideoOverlay blink={blink} target={target} video={video} />);
  const svg = screen.getByLabelText('框选眨眼ROI');
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => {} });
  Object.assign(svg, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
  fireEvent.pointerDown(svg, { button: 0, clientX: 20, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(svg, { button: 0, clientX: 120, clientY: 90, pointerId: 1 });
  expect(finishSelection).not.toHaveBeenCalled();
  fireEvent.pointerDown(svg, { button: 2, clientX: 20, clientY: 30, pointerId: 2 });
  fireEvent.pointerMove(svg, { button: 2, clientX: 120, clientY: 90, pointerId: 2 });
  fireEvent.pointerUp(svg, { button: 2, clientX: 120, clientY: 90, pointerId: 2 });
  await waitFor(() => expect(finishSelection).toHaveBeenCalledWith({ x: 20, y: 30, width: 100, height: 60 }));
  expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  target.remove();
});
