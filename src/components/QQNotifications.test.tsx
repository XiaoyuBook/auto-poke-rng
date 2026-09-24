// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QQNotifications } from './QQNotifications';
import type { DesktopApi } from '../desktop';
import type { QQApi, QQState } from '../notifications';

let state: QQState, api: QQApi, listener: (value: QQState) => void;
beforeEach(() => {
  state = { settings: { appId: 'APP', rememberSecret: false, userOpenId: 'USER', groupOpenId: '', userEnabled: true, groupEnabled: false },
    hasSecret: true, ready: true, verified: true, operation: '', binding: null, feedback: '配置已保存', error: '', status: 'ready', testSent: false, testConfirmed: false, records: [] };
  const current = async () => state;
  api = { getState: vi.fn(current), save: vi.fn(current), verify: vi.fn(current), bind: vi.fn(current), unbind: vi.fn(current),
    sendTest: vi.fn(current), confirmTest: vi.fn(current), cancel: vi.fn(current), onState: callback => { listener = callback; return () => {}; } };
  window.desktop = { notifications: api } as DesktopApi;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); delete window.desktop; });

it('preserves unsaved credentials on a write failure and blocks network actions until saved', async () => {
  render(<QQNotifications close={() => {}} />);
  await screen.findByLabelText('AppID');
  fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'NEW_SECRET' } });
  expect((screen.getByRole('button', { name: '验证凭据' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '发送图文测试' }) as HTMLButtonElement).disabled).toBe(true);
  vi.mocked(api.save).mockRejectedValueOnce(new Error('磁盘不可写'));
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '磁盘不可写');
  expect(screen.getByLabelText('AppSecret')).toHaveProperty('value', 'NEW_SECRET');
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() => expect(screen.getByLabelText('AppSecret')).toHaveProperty('value', ''));
  expect(api.save).toHaveBeenLastCalledWith({ appId: 'APP', secret: 'NEW_SECRET', rememberSecret: false });
});

it('only submits tests on an explicit click and requires checking QQ before confirmation', async () => {
  render(<QQNotifications close={() => {}} />);
  const send = await screen.findByRole('button', { name: '发送图文测试' });
  expect(api.sendTest).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '我已收到文字和图片' })).toBeNull();
  api.sendTest = vi.fn(async () => { state = { ...state, testSent: true }; listener(state); return state; });
  fireEvent.click(send);
  const confirm = await screen.findByRole('button', { name: '我已收到文字和图片' });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  expect(api.confirmTest).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() => expect(api.confirmTest).toHaveBeenCalledOnce());
});

it('cancels binding on tab changes and closing, while preserving literal remote error text', async () => {
  state = { ...state, operation: 'bind', binding: { kind: 'user', code: '123456', seconds: 60, generation: 1 },
    records: [{ id: 'one', time: new Date().toISOString(), event: '图文测试', kind: 'user', text: 'submitted', image: 'failed', success: false, detail: '<img src=x onerror=alert(1)>' }] };
  const view = render(<QQNotifications close={() => {}} />);
  await screen.findByText('123456');
  fireEvent.click(screen.getByRole('tab', { name: /发送记录/ }));
  expect(api.cancel).toHaveBeenCalledWith(true);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(document.querySelector('.qq-record img')).toBeNull();
  view.unmount();
  expect(api.cancel).toHaveBeenCalledTimes(2);
});

it('asks before discarding dirty settings and leaves the draft intact when editing continues', async () => {
  const close = vi.fn();
  render(<QQNotifications close={close} />);
  await screen.findByLabelText('AppID');
  fireEvent.change(screen.getByLabelText('AppID'), { target: { value: 'DIFFERENT' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭QQ 通知' }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('AppID')).toHaveProperty('value', 'DIFFERENT');
  fireEvent.click(screen.getByRole('button', { name: '关闭QQ 通知' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃更改并关闭' }));
  expect(close).toHaveBeenCalledOnce();
});

it('provides all twelve illustrated guide steps and closes only the image viewer on Escape', async () => {
  const close = vi.fn();
  render(<QQNotifications close={close} />);
  await screen.findByLabelText('AppID');
  fireEvent.change(screen.getByLabelText('AppID'), { target: { value: 'UNSAVED' } });
  fireEvent.click(screen.getByRole('tab', { name: '注册与绑定说明' }));
  const steps = screen.getAllByRole('button', { name: /^第\d+步：/ });
  expect(steps).toHaveLength(12);
  for (const [index, step] of steps.entries()) {
    fireEvent.click(step);
    const screenshot = screen.getByRole('img', { name: new RegExp('^第' + (index + 1) + '步：') });
    expect(screenshot.getAttribute('src')).toMatch(/step-\d\d\.(png|jpg)/);
  }
  fireEvent.click(screen.getByRole('button', { name: '查看第12步原图' }));
  const viewer = screen.getByRole('dialog', { name: '教程原图' });
  expect(within(viewer).getByRole('img').getAttribute('src')).toContain('step-11.png');
  fireEvent.click(within(viewer).getByRole('button', { name: '原始尺寸' }));
  expect(within(viewer).getByRole('img').style.width).toBe('1240px');
  fireEvent(viewer, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog', { name: '教程原图' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'QQ 通知' })).toBeTruthy();
  expect(screen.queryByText('接入设置尚未保存。')).toBeNull();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '前往接入设置' }));
  expect(screen.getByLabelText('AppID')).toHaveProperty('value', 'UNSAVED');
  expect(api.sendTest).not.toHaveBeenCalled();
});
