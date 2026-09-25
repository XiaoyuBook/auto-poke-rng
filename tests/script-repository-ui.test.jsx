// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScriptRepositoryDialog } from '../src/components/ScriptRepositoryDialog';
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); delete window.desktop; vi.restoreAllMocks(); });
function fixture({ cached = true, conflicts = [], installed = [] } = {}) {
  const pack = { id: 'bdsp', name: 'BDSP 官方脚本包', version: '1.0.0', minimumAppVersion: '0.1.0', game: 'BDSP', installFolder: 'BDSP', authors: ['作者'], description: '测种与撞闪脚本', instructions: '请核对运行起点。' };
  const state = { packages: [pack], installed, rootPath: 'user/scripts', cached };
  const plan = { token: 'plan', package: pack, installedVersion: null, changes: [{ path: '测种.txt', action: 'add' }], conflicts };
  const api = { getState: vi.fn(async () => state), refresh: vi.fn(async () => ({ ...state, cached: true })), prepare: vi.fn(async () => plan), importZip: vi.fn(async () => plan), apply: vi.fn(async () => ({ state: { ...state, installed: [pack] }, kept: conflicts.length, backupPath: 'user/backup' })) };
  window.desktop = { scriptRepository: api };
  const onInstalled = vi.fn(async () => {}), close = vi.fn();
  return { api, onInstalled, close, state, plan, pack };
}
test('browsing and preview do not install until confirmation, then refresh the local library', async () => {
  const f = fixture(); render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  fireEvent.click(await screen.findByRole('button', { name: '预览安装' }));
  await screen.findByText('安装预览 · BDSP 官方脚本包');
  expect(f.api.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
  await waitFor(() => expect(f.onInstalled).toHaveBeenCalledOnce());
  expect(f.api.apply).toHaveBeenCalledWith({ token: 'plan', policy: 'keep' });
  expect(screen.getByRole('status').textContent).toContain('user/backup');
});
test('conflicts default to preserving edits and replacement requires choosing it', async () => {
  const f = fixture({ conflicts: ['测种.txt'] }); render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  fireEvent.click(await screen.findByRole('button', { name: '预览安装' }));
  expect((await screen.findByLabelText('保留我的修改，更新其余文件')).checked).toBe(true);
  fireEvent.click(screen.getByLabelText('备份后使用仓库版本'));
  fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
  await waitFor(() => expect(f.api.apply).toHaveBeenCalledWith({ token: 'plan', policy: 'replace' }));
});
test('unsaved editor contents block installation and ZIP import uses the same preview', async () => {
  const f = fixture(); render(<ScriptRepositoryDialog {...f} hasUnsaved />);
  await screen.findByRole('button', { name: '预览安装' });
  fireEvent.click(screen.getByRole('button', { name: '导入 ZIP' }));
  const confirm = await screen.findByRole('button', { name: '确认安装' });
  expect(confirm.disabled).toBe(true); fireEvent.click(confirm);
  expect(f.api.apply).not.toHaveBeenCalled();
});
test('initial index fetch and update failures leave existing cached details visible', async () => {
  const f = fixture({ cached: false }); render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  await waitFor(() => expect(f.api.refresh).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button', { name: '检查更新' }).disabled).toBe(false));
  f.api.refresh.mockRejectedValueOnce(Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
  expect((await screen.findByRole('alert')).textContent).toContain('offline');
  expect(screen.getByText('请核对运行起点。')).toBeTruthy();
});
test('search and installed filters select the expected package', async () => {
  const f = fixture(); render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  await screen.findByRole('button', { name: '预览安装' });
  fireEvent.change(screen.getByLabelText('搜索仓库脚本'), { target: { value: '不存在' } });
  expect(screen.queryByRole('button', { name: '预览安装' })).toBeNull();
  fireEvent.change(screen.getByLabelText('搜索仓库脚本'), { target: { value: '作者' } });
  expect(screen.getByRole('button', { name: '预览安装' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('脚本包筛选'), { target: { value: 'installed' } });
  expect(screen.queryByRole('button', { name: '预览安装' })).toBeNull();
});
