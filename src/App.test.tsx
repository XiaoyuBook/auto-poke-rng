// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { DesktopApi } from './desktop';
import type { ScriptFile, ScriptFilesApi, ScriptListing } from './scriptLibrary';

let disk: ScriptListing;
let api: ScriptFilesApi;
const file = (path: string, body: string): ScriptFile => ({ path, name: path.split('/').at(-1)!.slice(0, -4), body, revision: body });
const edit = (body: string) => fireEvent.change(screen.getByRole('textbox', { name: '脚本内容' }), { target: { value: body } });
const select = (name: string) => fireEvent.click(screen.getByRole('button', { name: '选择脚本：' + name }));
const openBdsp = () => fireEvent.click(screen.getByRole('button', { name: '文件夹：珍钻复刻' }));
async function openApp() {
  const app = render(<App />);
  await screen.findByRole('textbox', { name: '脚本内容' });
  await screen.findByRole('button', { name: '选择脚本：等待与确认' });
  return app;
}

beforeEach(() => {
  localStorage.clear();
  disk = {
    rootPath: 'D:/project/auto-poke-rng/scripts', warnings: [],
    folders: [{ path: '火红', name: '火红' }, { path: '珍钻复刻', name: '珍钻复刻' }],
    files: [file('火红/等待与确认.rng', '# 火红确认'), file('珍钻复刻/对话确认.rng', '# 珍钻对话'), file('珍钻复刻/菜单操作.rng', '# 珍钻菜单')],
  };
  api = {
    list: vi.fn(async () => structuredClone(disk)),
    create: vi.fn(async folder => {
      const created = file((folder ? folder + '/' : '') + '未命名脚本.rng', '# 在此编写脚本\n');
      disk.files.push(created);
      return structuredClone(created);
    }),
    save: vi.fn(async request => {
      const old = disk.files.find(item => item.path === request.path)!;
      if (old.revision !== request.expectedRevision) throw new Error('文件已在外部修改');
      const saved = file(request.path.slice(0, request.path.lastIndexOf('/') + 1) + request.name.trim() + '.rng', request.body);
      disk.files = disk.files.map(item => item.path === old.path ? saved : item);
      return structuredClone(saved);
    }),
  };
  window.desktop = { getMetadata: async () => ({ name: 'test', version: '0.1.0', platform: 'win32' }), scripts: api } as DesktopApi;
  // jsdom does not implement the native dialog API; Electron supplies focus management.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

describe('project script folders', () => {
  it('shows real folders together, expands them, searches across them and reads the selected content', async () => {
    await openApp();
    expect(screen.getByRole('button', { name: '文件夹：火红' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: '选择脚本：对话确认' })).toBeNull();
    openBdsp();
    select('对话确认');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 珍钻对话');
    changeGame('珍钻复刻');
    expect(screen.getByRole('button', { name: '文件夹：火红' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 珍钻对话');
    openBdsp();
    expect(screen.queryByRole('button', { name: '选择脚本：对话确认' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索脚本' }), { target: { value: '菜单' } });
    expect(screen.getAllByRole('button', { name: /^选择脚本：/ })).toHaveLength(1);
    select('菜单操作');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 珍钻菜单');
  });

  it('preserves each file buffer, saves only the selected file and reopens disk content', async () => {
    const app = await openApp();
    edit('# 未保存的火红');
    openBdsp(); select('对话确认'); edit('# 保存的珍钻');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await screen.findByText('脚本已保存到文件');
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ path: '珍钻复刻/对话确认.rng', body: '# 保存的珍钻' }));
    select('等待与确认');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 未保存的火红');
    app.unmount(); await openApp();
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 火红确认');
    openBdsp(); select('对话确认');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 保存的珍钻');
  });

  it('creates in the chosen folder and renames the actual file on save', async () => {
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: '新建脚本' }));
    fireEvent.click(screen.getByRole('button', { name: '珍钻复刻' }));
    await screen.findByRole('button', { name: '选择脚本：未命名脚本' });
    expect(api.create).toHaveBeenCalledWith('珍钻复刻');
    fireEvent.change(screen.getByRole('textbox', { name: '脚本名称' }), { target: { value: '  我的流程  ' } });
    edit('wait 250\npress B');
    fireEvent.click(screen.getByRole('button', { name: '保存脚本' }));
    await screen.findByText('脚本已保存到文件');
    expect(disk.files.find(file => file.path === '珍钻复刻/我的流程.rng')?.body).toBe('wait 250\npress B');
    expect(disk.files.some(file => file.path.includes('未命名'))).toBe(false);
    expect(screen.getByRole('button', { name: '选择脚本：我的流程' }).getAttribute('aria-current')).toBe('true');
  });

  it('refreshes external changes without losing dirty or externally deleted buffers', async () => {
    await openApp();
    edit('# 保留的编辑');
    disk.files[0] = file('火红/等待与确认.rng', '# 外部修改');
    disk.folders.push({ path: '自定义', name: '自定义' });
    disk.files.push(file('自定义/新流程.rng', '# 新流程'));
    fireEvent.click(screen.getByRole('button', { name: '刷新脚本库' }));
    await screen.findByRole('button', { name: '文件夹：自定义' });
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 保留的编辑');
    expect(screen.getByText('外部已修改 · 编辑保留')).toBeTruthy();
    disk.files = disk.files.filter(file => !file.path.startsWith('火红/'));
    disk.folders = disk.folders.filter(folder => folder.name !== '火红');
    fireEvent.click(screen.getByRole('button', { name: '刷新脚本库' }));
    await screen.findByText('文件已移除 · 编辑保留');
    expect(screen.getByRole('button', { name: '选择脚本：等待与确认' })).toBeTruthy();
  });

  it('retains changes on save failure and keeps newer typing during an in-flight save', async () => {
    await openApp(); edit('# 第一次修改');
    vi.mocked(api.save).mockRejectedValueOnce(new Error('此文件夹已有同名脚本'));
    fireEvent.click(screen.getByRole('button', { name: '保存脚本' }));
    await screen.findByText('保存失败：此文件夹已有同名脚本');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 第一次修改');
    let complete!: (file: ScriptFile) => void;
    vi.mocked(api.save).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '保存脚本' }));
    edit('# 保存过程中继续编辑');
    await act(async () => complete(file('火红/等待与确认.rng', '# 第一次修改')));
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 保存过程中继续编辑');
    expect(screen.getByText('未保存')).toBeTruthy();
  });

  it('shows empty folders and a recoverable read failure without inventing scripts', async () => {
    disk.files = []; disk.folders = [{ path: '空目录', name: '空目录' }];
    vi.mocked(api.list).mockRejectedValueOnce(new Error('读取失败'));
    render(<App />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('textbox', { name: '脚本内容' })).toBeNull();
    expect((screen.getByRole('button', { name: '开始运行' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '刷新脚本库' }));
    fireEvent.click(await screen.findByRole('button', { name: '文件夹：空目录' }));
    expect(screen.getByText('暂无脚本')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains desktop access in browser preview and leaves old saved drafts intact', () => {
    localStorage.setItem('auto-poke-rng:script-library', '{"version":1,"scripts":[]}');
    delete window.desktop;
    render(<App />);
    expect(screen.getByText('请在桌面应用中打开项目脚本库')).toBeTruthy();
    expect(localStorage.getItem('auto-poke-rng:script-library')).toBe('{"version":1,"scripts":[]}');
  });
});
afterEach(() => { cleanup(); delete window.desktop; vi.useRealTimers(); vi.restoreAllMocks(); });

function changeGame(label: string) {
  fireEvent.click(screen.getByRole('button', { name: /切换游戏/ }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(label) }));
}

describe('workspace interactions', () => {
  it('keeps the original navigation and lets the sidebar be reopened', async () => {
    await openApp();
    const nav = screen.getByRole('navigation', { name: '工作区' });
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['首页', '脚本编辑']);
    const globalTools = screen.getByRole('group', { name: '全局工具' });
    expect(within(globalTools).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['视频源：未尝试连接', '伊机控：未尝试连接', '通知：有未读通知']);
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(document.querySelector('.app-shell')?.getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(document.querySelector('.app-shell')?.getAttribute('data-collapsed')).toBe('false');
  });

  it('requires an EasyCon connection before opening the virtual controller', async () => {
    await openApp();
    const toggle = screen.getByRole('button', { name: '虚拟手柄' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.queryByRole('dialog', { name: '虚拟手柄' })).toBeNull();
    expect(screen.getByText('请先在左上角“伊机控”中连接单片机。')).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('filters commands, handles no results, and opens a result with Enter', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const search = screen.getByRole('combobox', { name: '搜索页面或工具' });
    fireEvent.change(search, { target: { value: '找不到的命令' } });
    expect(screen.getAllByText(/没有找到/).length).toBe(1);
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: '快速查找' })).toBeTruthy();
    fireEvent.change(search, { target: { value: '日志' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('dialog', { name: '日志中心' })).toBeTruthy());
    expect(screen.getByRole('heading', { name: '脚本编辑', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '快速查找' })).toBeNull();
  });

  it('preserves the running script folder and timer across browsing, and really clears logs', async () => {
    await openApp();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '开始运行' }));
    act(() => vi.advanceTimersByTime(2100));
    expect(screen.getByLabelText('执行时长').textContent).toBe('00:00:02');
    changeGame('珍钻复刻');
    expect(screen.getByText('火红 · 演示运行中')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: '脚本编辑' }));
    expect(screen.getByLabelText('执行时长').textContent).toBe('00:00:03');
    fireEvent.click(screen.getByRole('button', { name: '停止运行' }));
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByLabelText('执行时长').textContent).toBe('00:00:03');
    fireEvent.click(screen.getByRole('button', { name: '清屏' }));
    fireEvent.click(screen.getByRole('button', { name: '日志中心' }));
    expect(screen.getByRole('heading', { name: '暂无日志' })).toBeTruthy();
  });

  it('opens video without replacing the editor and clears the notification indicator', async () => {
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: '视频预览' }));
    expect(screen.getByRole('dialog', { name: '视频预览' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '脚本内容' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭视频预览' }));
    fireEvent.click(screen.getByRole('button', { name: '通知：有未读通知' }));
    expect(screen.getByRole('dialog', { name: '通知' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(screen.queryByRole('button', { name: '通知：有未读通知' })).toBeNull();
    expect(screen.getByRole('button', { name: '通知：无未读通知' })).toBeTruthy();
  });

  it('keeps edits and log filters while the floating panel expands, minimizes, and restores', async () => {
    await openApp();
    fireEvent.change(screen.getByRole('textbox', { name: '脚本内容' }), { target: { value: '# 工作中的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '日志中心' }));
    const panel = screen.getByRole('dialog', { name: '日志中心' });
    expect(panel.getAttribute('aria-modal')).toBe('false');
    expect(screen.getByRole('heading', { name: '脚本编辑', level: 1 })).toBeTruthy();
    fireEvent.change(within(panel).getByRole('combobox', { name: '筛选日志来源' }), { target: { value: '脚本' } });
    fireEvent.click(within(panel).getByRole('button', { name: '展开面板' }));
    expect(panel.getAttribute('data-expanded')).toBe('true');
    fireEvent.click(within(panel).getByRole('button', { name: '还原面板大小' }));
    expect(panel.getAttribute('data-expanded')).toBe('false');
    fireEvent.click(within(panel).getByRole('button', { name: '收起日志中心' }));
    expect(within(panel).queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '日志中心' }));
    expect((within(panel).getByRole('combobox') as HTMLSelectElement).value).toBe('脚本');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 工作中的草稿');
    // Switching the dock tool replaces panel content, without stacking another panel.
    fireEvent.click(screen.getByRole('button', { name: '视频预览' }));
    expect(screen.queryByRole('dialog', { name: '日志中心' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const video = screen.getByRole('dialog', { name: '视频预览' });
    fireEvent.click(within(video).getByRole('button', { name: '收起视频预览' }));
    fireEvent.click(within(video).getByRole('button', { name: '恢复视频预览' }));
    expect(video.getAttribute('data-minimized')).toBe('false');
    fireEvent.keyDown(video, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '视频预览' }));
  });


});
