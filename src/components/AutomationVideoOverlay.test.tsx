// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { AutomationSnapshot } from '../automation';
import type { VideoState } from '../devices';
import { AutomationVideoOverlay } from './AutomationVideoOverlay';

afterEach(cleanup);
const video: VideoState = { status: 'connected', width: 640, height: 480 };
const roi = { x: 20, y: 30, width: 100, height: 60 };
const location = { x: 40, y: 45, width: 25, height: 12 };
const seed = { seed: { words: ['12345678', '9ABCDEF0', '11111111', '22222222'], pair: ['123456789ABCDEF0', '1111111122222222'] } };
const state = (kind: 'static' | 'tid', patch: Partial<AutomationSnapshot['state']> = {}): AutomationSnapshot['state'] => ({
  revision: 1, kind, runId: 'run', status: 'running', message: '', progress: { phase: '捕获Seed', loop_index: 1, seed_text: '', log_message: '' },
  capture: { captureId: 'capture', stage: 'capturing', captured: 12, target: kind === 'tid' ? 64 : 40, roi, location, sourceWidth: 640, sourceHeight: 480 },
  seed: null, ...patch,
});

for (const kind of ['static', 'tid'] as const) it(`${kind} shows the eye boxes and right-side blink count, then switches to Seed`, () => {
  const target = document.createElement('div'); document.body.append(target);
  const app = render(<AutomationVideoOverlay state={state(kind, { seed })} video={video} target={target} />);
  expect(screen.getByRole('status', { name: '自动流程眨眼捕捉进度' }).textContent).toContain(kind === 'tid' ? '12 / 64' : '12 / 40');
  expect(target.querySelector('.automation-video-roi')?.getAttribute('x')).toBe('20');
  expect(target.querySelector('.automation-video-eye')?.getAttribute('x')).toBe('40');
  expect(screen.queryByRole('region', { name: '自动流程 Seed' })).toBeNull();
  app.rerender(<AutomationVideoOverlay state={state(kind, { capture: { captureId: 'capture', stage: 'complete', captured: 40, target: 40 }, seed })} video={video} target={target} />);
  expect(screen.queryByRole('status', { name: '自动流程眨眼捕捉进度' })).toBeNull();
  expect(target.querySelector('svg')).toBeNull();
  expect(screen.getByRole('region', { name: '自动流程 Seed' }).textContent).toContain('123456789ABCDEF0');
  app.rerender(<AutomationVideoOverlay state={state(kind)} video={video} target={target} />);
  expect(screen.queryByRole('region', { name: '自动流程 Seed' })).toBeNull();
  expect(screen.getByRole('status', { name: '自动流程眨眼捕捉进度' })).toBeTruthy();
  target.remove();
});

it('does not show a stale Seed while waiting for recapture or after video disconnects', () => {
  const target = document.createElement('div'); document.body.append(target);
  const waiting = state('static', { progress: { phase: '校正位置', loop_index: 1, seed_text: '', log_message: '' }, capture: null, seed });
  const app = render(<AutomationVideoOverlay state={waiting} video={video} target={target} />);
  expect(target.querySelector('.automation-video-overlay')).toBeNull();
  app.rerender(<AutomationVideoOverlay state={state('static', { capture: null, seed })} video={video} target={target} />);
  expect(target.querySelector('.automation-video-overlay')).toBeNull();
  app.rerender(<AutomationVideoOverlay state={state('static', { progress: { phase: '搜索目标', loop_index: 1, seed_text: '', log_message: '' }, capture: null, seed })} video={{ ...video, status: 'idle' }} target={target} />);
  expect(target.querySelector('.automation-video-overlay')).toBeNull();
  target.remove();
});
