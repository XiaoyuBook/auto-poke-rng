// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KeyMappingDialog } from './KeyMappingDialog';
import { CONTROLLER_MAPPING_STORAGE_KEY } from '../controllerMapping';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

it('retains the draft and restores saved settings if applying the mapping fails', async () => {
  const close = vi.fn();
  const save = vi.fn().mockRejectedValueOnce(new Error('设备服务不可用')).mockResolvedValue(undefined);
  render(<KeyMappingDialog close={close} onSaved={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'A：L' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'p', code: 'KeyP' });
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存失败：设备服务不可用');
  expect(close).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(CONTROLLER_MAPPING_STORAGE_KEY)!).A).toBe('KeyL');
  expect(screen.getByRole('button', { name: 'A：P' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(JSON.parse(localStorage.getItem(CONTROLLER_MAPPING_STORAGE_KEY)!).A).toBe('KeyP');
});

it('keeps navigation and modifier keys from becoming unintended bindings', () => {
  render(<KeyMappingDialog close={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'A：L' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
  expect(screen.getByRole('button', { name: 'A：L' })).toBeTruthy();
  fireEvent.keyDown(dialog, { key: 'AudioVolumeUp', code: 'AudioVolumeUp' });
  expect(screen.getByRole('status').textContent).toContain('暂不支持');
  fireEvent.keyDown(dialog, { key: 'Enter', code: 'NumpadEnter' });
  expect(screen.getByRole('button', { name: 'A：Enter' })).toBeTruthy();
});
