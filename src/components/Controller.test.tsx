// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Controller } from './Controller';
import type { DesktopApi } from '../desktop';

afterEach(() => { cleanup(); delete window.desktop; });

it.each(['keyup', 'blur', 'unmount'])('releases held input after an in-flight click on %s', async kind => {
  let finishClick!: () => void;
  const click = new Promise<void>(resolve => { finishClick = resolve; });
  const key = vi.fn(async () => {}), reset = vi.fn(async () => {}), press = vi.fn(() => click);
  window.desktop = { devices: {
    getState: async () => ({ video: { status: 'idle' }, controller: { status: 'connected', name: 'mock' } }),
    onState: () => () => {},
    controller: { list: async () => [{ id: 'mock', name: 'mock' }], key, reset, press },
  } } as unknown as DesktopApi;
  const view = render(<Controller onInput={() => {}} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'B' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(window, { key: 'l' });
  expect(key).toHaveBeenCalledWith('A', true);
  fireEvent.click(screen.getByRole('button', { name: 'B' }));
  // Extra clicks must not queue delayed presses that survive a later stop.
  fireEvent.click(screen.getByRole('button', { name: 'X' }));
  expect(press).toHaveBeenCalledTimes(1);
  if (kind === 'keyup') fireEvent.keyUp(window, { key: 'l' });
  else if (kind === 'blur') fireEvent.blur(window);
  else view.unmount();
  expect(key).toHaveBeenCalledTimes(1);
  expect(reset).not.toHaveBeenCalled();
  await act(async () => { finishClick(); await click; });
  if (kind === 'keyup') expect(key).toHaveBeenLastCalledWith('A', false);
  else expect(reset).toHaveBeenCalledOnce();
});
