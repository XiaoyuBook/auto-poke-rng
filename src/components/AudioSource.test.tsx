// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioSource } from './AudioSource';
import type { DesktopApi } from '../desktop';
import type { AudioLevel, DevicesApi, DevicesState } from '../devices';

let state: DevicesState, api: DevicesApi['audio'];
let changed: (state: DevicesState) => void, level: (value: AudioLevel) => void;
beforeEach(() => {
  state = { video: { status: 'idle' }, audio: { status: 'idle' }, controller: { status: 'idle' } };
  api = {
    list: vi.fn<DevicesApi['audio']['list']>(async () => [{ id: 'mic', name: '笔记本麦克风', backend: 'wasapi' }, { id: 'card', name: '采集卡声音', backend: 'wasapi' }]),
    connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
    onLevel: callback => { level = callback; return vi.fn(); },
  };
  window.desktop = { devices: { audio: api, getState: async () => state,
    onState: callback => { changed = callback; return () => {}; } } } as DesktopApi;
});
afterEach(() => { cleanup(); delete window.desktop; });

it('requires an explicit audio input and only connects the selected device', async () => {
  render(<AudioSource />);
  await screen.findByRole('option', { name: '采集卡声音' });
  expect(screen.getByLabelText('音频输入')).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: '连接音频源' })).toHaveProperty('disabled', true);
  expect(api.connect).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('音频输入'), { target: { value: 'card' } });
  fireEvent.click(screen.getByRole('button', { name: '连接音频源' }));
  await waitFor(() => expect(api.connect).toHaveBeenCalledWith({ deviceId: 'card' }));
});

it('shows valid silence, ignores previous sessions, and clears the meter on failure', async () => {
  render(<AudioSource />);
  await screen.findByRole('option', { name: '采集卡声音' });
  act(() => {
    state = { ...state, audio: { status: 'connected', deviceId: 'card', session: 'one', sampleRate: 48000, channels: 2, name: '采集卡声音' } };
    changed(state);
  });
  act(() => level({ session: 'old', sequence: 1, peak: 1, rms: 1, silent: false, discontinuity: false }));
  expect(screen.getByText('等待音频数据…')).toBeTruthy();
  act(() => level({ session: 'one', sequence: 1, peak: 0, rms: 0, silent: true, discontinuity: false }));
  expect(screen.getByText('已收到音频，当前静音')).toBeTruthy();
  expect(screen.getByText('音频源已连接')).toBeTruthy();
  act(() => level({ session: 'one', sequence: 2, peak: .5, rms: .2, silent: false, discontinuity: false }));
  expect(screen.getByLabelText('游戏音频输入音量')).toHaveProperty('value', 20 * Math.log10(.5));
  act(() => changed({ ...state, audio: { status: 'failed', message: '音频输入已断开' } }));
  expect(screen.queryByLabelText('游戏音频输入音量')).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe('音频输入已断开');
});

it('reports enumeration errors and supports refresh without auto connecting', async () => {
  vi.mocked(api.list).mockRejectedValueOnce(new Error('无法读取设备列表'));
  render(<AudioSource />);
  expect((await screen.findByRole('alert')).textContent).toBe('无法读取设备列表');
  fireEvent.click(screen.getByRole('button', { name: '刷新音频设备' }));
  await screen.findByRole('option', { name: '采集卡声音' });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(api.connect).not.toHaveBeenCalled();
});
