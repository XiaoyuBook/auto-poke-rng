// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopApi } from './desktop';
import { useScriptValidation } from './useScriptValidation';

afterEach(() => { cleanup(); delete window.desktop; vi.useRealTimers(); });
it('clears obsolete line markers immediately and ignores late results across edits and files', async () => {
  vi.useFakeTimers();
  const pending: ((value: unknown) => void)[] = [];
  const validate = vi.fn(() => new Promise(resolve => pending.push(resolve)));
  window.desktop = { devices: { execution: { validate } } } as unknown as DesktopApi;
  const { result, rerender } = renderHook(({ path, text }) => useScriptValidation(path, text), { initialProps: { path: 'first.rng', text: 'BAD' } });
  await act(async () => { vi.advanceTimersByTime(400); });
  rerender({ path: 'second.rng', text: 'WAIT 50' });
  await act(async () => pending[0]({ valid: false, diagnostic: { source: 'first.rng', line: 1, message: 'old error' } }));
  expect(result.current.state).toBe('checking');
  expect(result.current.diagnostic).toBeUndefined();
  await act(async () => { vi.advanceTimersByTime(400); });
  await act(async () => pending[1]({ valid: false, diagnostic: { source: 'second.rng', line: 1, message: 'error' } }));
  expect(result.current.state).toBe('invalid');
  rerender({ path: 'second.rng', text: 'WAIT 100' });
  expect(result.current.diagnostic).toBeUndefined();
  await act(async () => { vi.advanceTimersByTime(400); });
  await act(async () => pending[2]({ valid: true }));
  expect(result.current.state).toBe('valid');
});

it('distinguishes a checker failure from clean syntax and supports retry', async () => {
  vi.useFakeTimers();
  const validate = vi.fn().mockRejectedValueOnce(new Error('Python unavailable')).mockResolvedValue({ valid: true });
  window.desktop = { devices: { execution: { validate } } } as unknown as DesktopApi;
  const { result } = renderHook(() => useScriptValidation('test.rng', 'A'));
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(result.current).toMatchObject({ state: 'unavailable', message: 'Python unavailable' });
  act(() => result.current.retry());
  expect(result.current.state).toBe('checking');
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(result.current.state).toBe('valid');
});
