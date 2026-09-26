// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ScriptRepositoryDialog } from '../src/components/ScriptRepositoryDialog';
import { ScriptLibrary } from '../src/components/ScriptLibrary';
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
test('an empty local library opens the repository without inventing or installing scripts', async () => {
  const f = fixture(), create = vi.fn(), refresh = vi.fn();
  render(<ScriptLibrary game="bdsp" scripts={[]} folders={[]} rootPath="user/scripts" busy={false} loaded available error="" warnings={[]} select={vi.fn()} create={create} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: '浏览脚本仓库' }));
  await screen.findByRole('button', { name: '预览安装' });
  expect(f.api.prepare).not.toHaveBeenCalled();
  expect(f.api.apply).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

test('browsing and preview do not install until confirmation, then refresh the local library', async () => {
  const f = fixture(); render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  fireEvent.click(await screen.findByRole('button', { name: '预览安装' }));
  await screen.findByText('安装预览 · 珍钻复刻 官方脚本包');
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
  fireEvent.click(screen.getByRole('button', { name: '导入脚本包' }));
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
  expect((await screen.findByRole('alert')).textContent).toContain('无法连接官方脚本仓库');
  expect(screen.getByText('请核对运行起点。')).toBeTruthy();
});
test('search and installed filters select the expected package', async () => {
  const f = fixture(); render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  await screen.findByRole('button', { name: '预览安装' });
  fireEvent.change(screen.getByLabelText('搜索仓库脚本'), { target: { value: '不存在' } });
  expect(screen.queryByRole('button', { name: '预览安装' })).toBeNull();
  fireEvent.change(screen.getByLabelText('搜索仓库脚本'), { target: { value: '作者' } });
  expect(screen.getByRole('button', { name: '预览安装' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '已安装', exact: true }));
  expect(screen.queryByRole('button', { name: '预览安装' })).toBeNull();
});

test('starts in the active game, uses Chinese names, and switches games without mixing packages', async () => {
  const f = fixture();
  f.state.packages.push({ ...f.pack, id: 'frlg', game: 'FRLG', name: '火叶测种脚本包' });
  render(<ScriptRepositoryDialog {...f} currentGame="frlg" hasUnsaved={false} />);
  await screen.findByRole('heading', { name: '火叶测种脚本包' });
  expect(screen.getByRole('button', { name: '游戏分类：火红／叶绿' }).getAttribute('aria-current')).toBe('true');
  expect(screen.queryByRole('heading', { name: /珍钻复刻 官方/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '游戏分类：珍钻复刻' }));
  expect(screen.getByRole('heading', { name: '珍钻复刻 官方脚本包' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '火叶测种脚本包' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '游戏分类：剑／盾' }));
  expect(screen.getByText('这个游戏还没有脚本包')).toBeTruthy();
  expect(f.api.prepare).not.toHaveBeenCalled();
});

test('browses a categorized file tree and safe Markdown without preparing an installation', async () => {
  const f = fixture();
  f.pack.files = [{ path: '测种.txt', bytes: 4, category: '测种与识别' }, { path: 'ImgLabel/眼睛.IL', bytes: 4096, category: '图像标签' }];
  f.pack.readme = '## 开始使用\n\n先核对**游戏画面**。\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))';
  render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  await screen.findByRole('heading', { name: '开始使用' });
  expect(screen.getByRole('tabpanel', { name: '使用说明' }).querySelector('script')).toBeNull();
  expect(screen.getByText('危险链接').getAttribute('href')).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '用途分类：测种与识别' }));
  const panel = screen.getByRole('tabpanel', { name: '文件列表' });
  expect(within(panel).getByText('测种.txt')).toBeTruthy();
  expect(within(panel).queryByText('ImgLabel/眼睛.IL')).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: '显示全部' }));
  expect(within(panel).getByText('ImgLabel/眼睛.IL')).toBeTruthy();
  expect(f.api.prepare).not.toHaveBeenCalled();
});

test('bundled browsing remains available after a failed refresh and retry recovers', async () => {
  const f = fixture({ cached: false }); f.state.catalogSource = 'bundled';
  f.api.refresh.mockRejectedValueOnce(new TypeError('fetch failed'));
  render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  expect((await screen.findByRole('alert')).textContent).toContain('系统代理');
  expect(screen.getByText('请核对运行起点。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(f.api.refresh).toHaveBeenCalledTimes(2);
});

test('new-version filter excludes equal and older remote versions', async () => {
  const f = fixture();
  f.state.installed = [{ ...f.pack, version: '2.0.0', modified: false }];
  render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  await screen.findByRole('button', { name: '预览更新' });
  fireEvent.click(screen.getByRole('button', { name: '有更新', exact: true }));
  expect(screen.getByText('暂无可更新的脚本包')).toBeTruthy();
});

test('repository settings switch public channels and preserve browsing after network failure', async () => {
  const f = fixture();
  const switched = { ...f.state, channel: 'gitee', source: 'https://gitee.com/shekongsk/auto-poke-rng-scripts' };
  f.api.setChannel = vi.fn(async () => switched);
  f.api.refresh.mockRejectedValueOnce(new TypeError('fetch failed'));
  render(<ScriptRepositoryDialog {...f} hasUnsaved={false} />);
  await screen.findByRole('button', { name: '预览安装' });
  fireEvent.click(screen.getByRole('button', { name: '仓库设置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '更新渠道' }), { target: { value: 'gitee' } });
  await screen.findByRole('alert');
  expect(f.api.setChannel).toHaveBeenCalledWith('gitee');
  expect(screen.getByRole('textbox', { name: '仓库地址' }).value).toBe(switched.source);
  expect(f.api.apply).not.toHaveBeenCalled();
});
