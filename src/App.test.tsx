// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  // jsdom does not implement the native dialog API; Electron supplies focus management.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function changeGame(label: string) {
  fireEvent.click(screen.getByRole('button', { name: /切换游戏/ }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(label) }));
}

describe('workspace interactions', () => {
  it('keeps the original navigation and lets the sidebar be reopened', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: '工作区' });
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['首页', '脚本编辑']);
    const globalTools = screen.getByRole('group', { name: '全局工具' });
    expect(within(globalTools).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['视频源：未连接', '虚拟手柄：输入预览', '通知：有未读通知']);
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(document.querySelector('.app-shell')?.getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(document.querySelector('.app-shell')?.getAttribute('data-collapsed')).toBe('false');
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

  it('keeps unsaved edits separate by game and restores only saved drafts after reopening', () => {
    const app = render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: '脚本内容' }), { target: { value: '# 火叶草稿\nwait 500' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(screen.getByText('已保存到本机')).toBeTruthy();
    changeGame('珍钻复刻');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).not.toContain('火叶草稿');
    fireEvent.change(screen.getByRole('textbox', { name: '脚本内容' }), { target: { value: '# 未保存的 BDSP 草稿' } });
    changeGame('火叶');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toContain('火叶草稿');
    changeGame('珍钻复刻');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toContain('未保存的 BDSP');
    app.unmount();
    render(<App />);
    expect(screen.getByText('已保存到本机')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toContain('火叶草稿');
    changeGame('珍钻复刻');
    expect(screen.getByText('未保存')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).not.toContain('未保存的 BDSP');
  });

  it('preserves the running game and timer across browsing, and really clears logs', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '开始运行' }));
    act(() => vi.advanceTimersByTime(2100));
    expect(screen.getByLabelText('执行时长').textContent).toBe('00:00:02');
    changeGame('珍钻复刻');
    expect(screen.getByText('火叶 · 演示运行中')).toBeTruthy();
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

  it('opens video without replacing the editor and clears the notification indicator', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '视频预览' }));
    expect(screen.getByRole('dialog', { name: '视频预览' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '脚本内容' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭视频预览' }));
    fireEvent.click(screen.getByRole('button', { name: '通知：有未读通知' }));
    expect(screen.getByRole('dialog', { name: '通知' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(screen.queryByRole('button', { name: '通知：有未读通知' })).toBeNull();
    expect(screen.getByRole('button', { name: '通知' })).toBeTruthy();
  });

  it('keeps edits and log filters while the floating panel expands, minimizes, and restores', () => {
    render(<App />);
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

  it('keeps separate script edits and only persists the selected script snapshot', () => {
    const app = render(<App />);
    const edit = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: '脚本内容' }), { target: { value } });
    const select = (name: string) => fireEvent.click(screen.getByRole('button', { name: '选择脚本：' + name }));
    edit('# 已保存的个人脚本');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    edit('# 尚未保存的个人修改');
    select('等待与确认');
    edit('# 示例的独立编辑内容');
    select('未命名脚本');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 尚未保存的个人修改');
    select('等待与确认');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 示例的独立编辑内容');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    changeGame('珍钻复刻');
    select('等待与确认');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).not.toContain('独立编辑内容');
    changeGame('火叶');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 示例的独立编辑内容');
    app.unmount();
    render(<App />);
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 已保存的个人脚本');
    select('等待与确认');
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 示例的独立编辑内容');
  });

  it('creates, renames, searches, and restores a saved library script', () => {
    const app = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '新建脚本' }));
    expect((screen.getByRole('textbox', { name: '脚本名称' }) as HTMLInputElement).value).toBe('未命名脚本 2');
    fireEvent.change(screen.getByRole('textbox', { name: '脚本名称' }), { target: { value: '  自定义流程  ' } });
    fireEvent.change(screen.getByRole('textbox', { name: '脚本内容' }), { target: { value: 'wait 250\npress B' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索脚本' }), { target: { value: '自定义' } });
    expect(screen.getAllByRole('button', { name: /^选择脚本：/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '选择脚本：自定义流程' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索脚本' }), { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的脚本')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建脚本' }));
    expect((screen.getByRole('searchbox', { name: '搜索脚本' }) as HTMLInputElement).value).toBe('');
    app.unmount();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '选择脚本：自定义流程' }));
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('wait 250\npress B');
    expect(screen.queryByRole('button', { name: '选择脚本：未命名脚本 2' })).toBeNull();
  });

  it('migrates legacy drafts and retains edits when library storage fails', () => {
    localStorage.setItem('auto-poke-rng:drafts', JSON.stringify({ frlg: '# 旧版本的草稿' }));
    const app = render(<App />);
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 旧版本的草稿');
    fireEvent.change(screen.getByRole('textbox', { name: '脚本内容' }), { target: { value: '# 新版本保存' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    app.unmount();
    render(<App />);
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 新版本保存');
    fireEvent.change(screen.getByRole('textbox', { name: '脚本内容' }), { target: { value: '# 保存失败也保留的内容' } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByText('保存失败，请检查本机存储空间')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择脚本：等待与确认' }));
    fireEvent.click(screen.getByRole('button', { name: '选择脚本：未命名脚本' }));
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 保存失败也保留的内容');
    expect(screen.getByText('未保存')).toBeTruthy();
  });
});
