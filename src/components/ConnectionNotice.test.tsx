// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionNotice } from './ConnectionNotice';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const notice = { id: 1, failures: [{ device: 'controller' as const, name: '伊机控', message: '未找到 COM3' }] };
it('lists failed devices without a confirmation step and closes after eight seconds', () => {
  vi.useFakeTimers();
  const close = vi.fn(), retry = vi.fn();
  render(<ConnectionNotice notice={notice} close={close} retry={retry} busy={false} />);
  expect(screen.getByRole('alert').textContent).toContain('伊机控：未找到 COM3');
  expect(screen.queryByRole('button', { name: '确定' })).toBeNull();
  expect(document.activeElement).toBe(document.body);
  fireEvent.click(screen.getByRole('button', { name: '重试失败项' })); expect(retry).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(8000)); expect(close).toHaveBeenCalledOnce();
});
it('pauses dismissal while the pointer or keyboard is in the notification', () => {
  vi.useFakeTimers(); const close = vi.fn();
  render(<ConnectionNotice notice={notice} close={close} retry={vi.fn()} busy={false} />);
  act(() => vi.advanceTimersByTime(3000));
  fireEvent.mouseEnter(screen.getByRole('alert'));
  act(() => vi.advanceTimersByTime(10000)); expect(close).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole('alert'));
  act(() => vi.advanceTimersByTime(4999)); expect(close).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(close).toHaveBeenCalledOnce();
});
