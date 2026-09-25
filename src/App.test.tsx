// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { DesktopApi } from './desktop';
import type { ScriptFile, ScriptFilesApi, ScriptListing } from './scriptLibrary';
import { EditorView } from '@codemirror/view';

let disk: ScriptListing;
let api: ScriptFilesApi;
const file = (path: string, body: string): ScriptFile => ({ path, name: path.split('/').at(-1)!.slice(0, -4), body, revision: body });
const edit = (body: string) => act(() => {
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: '脚本内容' }))!;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body } });
});
const select = (name: string) => fireEvent.click(screen.getByRole('button', { name: '选择脚本：' + name }));
const openBdsp = () => fireEvent.click(screen.getByRole('button', { name: '文件夹：珍钻复刻' }));
async function openApp() {
  const app = render(<App />);
  await screen.findByRole('textbox', { name: '脚本内容' });
  await screen.findByRole('button', { name: '选择脚本：等待与确认' });
  return app;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
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
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
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
afterEach(() => { cleanup(); delete window.desktop; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function changeGame(label: string) {
  fireEvent.click(screen.getByRole('button', { name: /切换游戏/ }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(label) }));
}

describe('workspace interactions', () => {
  it('keeps the original navigation and lets the sidebar be reopened', async () => {
    await openApp();
    const nav = screen.getByRole('navigation', { name: '工作区' });
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['首页', '脚本编辑']);
    expect(screen.queryByRole('button', { name: '定点数据' })).toBeNull();
    changeGame('珍钻复刻');
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['首页', '脚本编辑', '定点数据', '闪光反查区域', '眨眼捕获']);
    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    expect(screen.getByRole('region', { name: '存档信息' })).toBeTruthy();
    changeGame('火叶');
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['首页', '脚本编辑']);
    expect(screen.queryByRole('region', { name: '存档信息' })).toBeNull();
    const globalTools = screen.getByRole('group', { name: '全局工具' });
    expect(within(globalTools).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['视频源：未尝试连接', '伊机控：未尝试连接', 'QQ 通知：未配置']);
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(document.querySelector('.app-shell')?.getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(document.querySelector('.app-shell')?.getAttribute('data-collapsed')).toBe('false');
  });

  it('opens OCR settings with a selectable ROI over the persistent video', async () => {
    await openApp();
    changeGame('珍钻复刻');
    const video = screen.getByRole('region', { name: '视频预览' });
    const frame = within(video).getByLabelText('视频画面');
    fireEvent.click(screen.getByRole('button', { name: '闪光反查区域' }));
    expect(screen.getByRole('heading', { name: '闪光反查区域', level: 2 })).toBeTruthy();
    expect(screen.getByRole('region', { name: '反查识别区域' })).toBeTruthy();
    expect(screen.getByLabelText('反查识别区域框选')).toBeTruthy();
    expect(within(video).getByLabelText('视频画面')).toBe(frame);
    fireEvent.click(screen.getByRole('button', { name: '测试当前项' }));
    expect(within(screen.getByRole('region', { name: '反查识别预览' })).getByText('等待视频帧')).toBeTruthy();
  });

  it('limits blink capture and its video menu to BDSP, keeping the video and logs mounted', async () => {
    await openApp();
    const video = screen.getByRole('region', { name: '视频预览' });
    const logs = document.querySelector('.persistent-logs');
    expect(screen.queryByRole('button', { name: '眨眼捕获' })).toBeNull();
    changeGame('珍钻复刻');
    fireEvent.click(screen.getByRole('button', { name: '眨眼捕获' }));
    expect(screen.getByRole('region', { name: '眨眼捕获工作区' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '视频预览' })).toBe(video);
    expect(document.querySelector('.persistent-logs')).toBe(logs);
    expect((logs as HTMLElement).hidden).toBe(false);
    const result = within(video).getByRole('region', { name: '眨眼帧数与 Seed' });
    expect(within(result).getByText('当前帧数')).toBeTruthy();
    expect(within(result).getByLabelText('捕获 Seed 0')).toBeTruthy();
    fireEvent.contextMenu(video, { clientX: 300, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: '框选眨眼眼睛模板' })).toBeTruthy();
    expect((screen.getByRole('menuitem', { name: '框选眨眼 ROI' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    changeGame('火叶');
    expect(screen.queryByRole('region', { name: '眨眼捕获工作区' })).toBeNull();
    expect(within(video).queryByRole('region', { name: '眨眼帧数与 Seed' })).toBeNull();
    expect(screen.getByRole('heading', { name: '首页', level: 1 })).toBeTruthy();
    fireEvent.contextMenu(video);
    expect(screen.queryByRole('menuitem', { name: '框选眨眼 ROI' })).toBeNull();
  });

  it('shows full recovered seed strings only over the blink video', async () => {
    let update!: (state: import('./blink').BlinkState) => void;
    const result = { words: ['FFFFFFFF','FFFFFFFF','87654321','12345678'], pair: ['FFFFFFFFFFFFFFFF','8765432112345678'], mode: 'recover' as const, matchedAdvance: null, capturedAt: 10, blinks: [], intervals: [] };
    const staticGenerate = vi.fn();
    window.desktop!.rng = { staticGenerate, cancel: vi.fn(), calculateIvs: vi.fn() };
    window.desktop!.blink = { getState: async () => ({ revision: 0, status: 'idle', captured: 0, target: 40, message: '' }), start: vi.fn(), stop: vi.fn(), timeline: vi.fn(), observe: vi.fn(), importConfig: vi.fn(), onObservation: () => () => {}, onState: listener => { update = listener; return () => {}; } };
    await openApp(); changeGame('珍钻复刻');
    fireEvent.click(screen.getByRole('button', { name: '眨眼捕获' }));
    act(() => update({ revision: 1, runId: 'test', status: 'completed', captured: 40, target: 40, result, message: '已完成' }));
    const video = screen.getByRole('region', { name: '视频预览' });
    expect(within(video).getByLabelText('捕获 Seed 0').textContent).toBe('FFFFFFFFFFFFFFFF');
    expect(within(video).getByLabelText('捕获 Seed 1').textContent).toBe('8765432112345678');
    expect(screen.queryByRole('button', { name: '填入定点数据' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '定点数据' }));
    expect(within(video).queryByRole('region', { name: '眨眼帧数与 Seed' })).toBeNull();
    expect((screen.getByLabelText('Seed 0') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Seed 1') as HTMLInputElement).value).toBe('');
    expect(staticGenerate).not.toHaveBeenCalled();
  });

  it('opens static data search, keeps the persistent video, and generates only after clicking generate', async () => {
    const staticGenerate = vi.fn(async () => [{ advances: 0, ec: '220345D0', pid: '2203506A', ivs: [4,23,15,30,19,26], stats: [20,12,12,11,12,8], ability: 0, abilityIndex: 65, gender: 0, level: 5, nature: 22, shiny: 0, height: 124, weight: 99, characteristic: 20 }]);
    window.desktop!.rng = { staticGenerate, cancel: vi.fn(async () => {}), calculateIvs: vi.fn() };
    await openApp();
    changeGame('珍钻复刻');
    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    fireEvent.change(screen.getByLabelText('TID'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('SID'), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText('存档游戏版本'), { target: { value: 'SP' } });
    const videoFrame = screen.getByRole('region', { name: '视频预览' }).querySelector('.preview-frame');
    fireEvent.click(screen.getByRole('button', { name: '定点数据' }));
    expect(screen.getByRole('heading', { name: '定点数据', level: 2 })).toBeTruthy();
    expect(screen.getByRole('region', { name: '定点数据参数' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '定点搜索结果' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '视频预览' }).querySelector('.preview-frame')).toBe(videoFrame);
    expect(within(screen.getByRole('region', { name: '定点搜索结果' })).getByText('尚未生成结果')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Seed 0'), { target: { value: 'DEADBEEF' } });
    fireEvent.change(screen.getByLabelText('Seed 1'), { target: { value: '123456789ABCDEF0' } });
    expect(staticGenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await screen.findByText('已生成结果');
    expect(staticGenerate).toHaveBeenCalledWith(expect.objectContaining({ seed1: '123456789ABCDEF0', profile: expect.objectContaining({ version: 'SP', tid: 10000, sid: 20000 }) }));
    const table = screen.getByRole('region', { name: '定点搜索结果' });
    const resultRows = within(table).getAllByRole('row');
    expect(resultRows.length).toBeGreaterThan(1);
    fireEvent.click(within(resultRows[1]).getAllByRole('gridcell')[0]);
    expect((screen.getByRole('button', { name: '复制选中行' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '复制选中行' }));
    expect((screen.getByRole('button', { name: '复制选中行' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    expect((screen.getByLabelText('TID') as HTMLInputElement).value).toBe('10000');
    expect((screen.getByLabelText('存档游戏版本') as HTMLSelectElement).value).toBe('SP');
    expect(JSON.parse(localStorage.getItem('auto-poke-rng:bdsp-profile')!).sid).toBe(20000);
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

  it('keeps script and controller logs in the editor and clears them without removing system logs', async () => {
    await openApp();
    const editorLogs = () => within(screen.getByRole('region', { name: '运行日志' }));
    expect(editorLogs().queryByText('工作区已就绪，等待运行脚本。')).toBeNull();
    expect((editorLogs().getByRole('button', { name: '清屏' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '开始录制' }));
    await editorLogs().findByText('开始录制，虚拟手柄输入会按时间写入当前脚本。');
    fireEvent.click(screen.getByRole('button', { name: '停止录制' }));
    expect(editorLogs().getByText('录制完成，输入已写入当前脚本。')).toBeTruthy();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '开始运行' }));
    expect(editorLogs().getByText(/开始运行演示/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(2100));
    expect(screen.getByLabelText('执行时长').textContent).toBe('00:00:02');
    changeGame('珍钻复刻');
    expect(editorLogs().queryByText('已切换查看：珍钻复刻。')).toBeNull();
    expect(screen.getByText('火红 · 演示运行中')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: '脚本编辑' }));
    expect(screen.getByLabelText('执行时长').textContent).toBe('00:00:03');
    fireEvent.click(screen.getByRole('button', { name: '停止运行' }));
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByLabelText('执行时长').textContent).toBe('00:00:03');
    expect(editorLogs().getByText('运行演示已停止。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清屏' }));
    expect(editorLogs().queryByText('运行演示已停止。')).toBeNull();
    expect(editorLogs().queryByText('录制完成，输入已写入当前脚本。')).toBeNull();
    expect((editorLogs().getByRole('button', { name: '清屏' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '日志中心' }));
    const logCenter = within(screen.getByRole('dialog', { name: '日志中心' }));
    expect(logCenter.getByText('工作区已就绪，等待运行脚本。')).toBeTruthy();
    expect(logCenter.getByText('已切换查看：珍钻复刻。')).toBeTruthy();
    expect(logCenter.queryByText('运行演示已停止。')).toBeNull();
    fireEvent.click(logCenter.getByRole('button', { name: '清空日志' }));
    expect(logCenter.getByRole('heading', { name: '暂无日志' })).toBeTruthy();
  });

  it('keeps video mounted across navigation and opens QQ settings without an invented unread indicator', async () => {
    await openApp();
    const video = screen.getByRole('region', { name: '视频预览' });
    const frame = within(video).getByLabelText('视频画面');
    expect(within(screen.getByRole('toolbar', { name: '快捷工具' })).queryByRole('button', { name: '视频预览' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '脚本内容' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    expect(within(screen.getByRole('region', { name: '视频预览' })).getByLabelText('视频画面')).toBe(frame);
    fireEvent.click(screen.getByRole('button', { name: '脚本编辑' }));
    expect(within(video).getByLabelText('视频画面')).toBe(frame);
    fireEvent.click(screen.getByRole('button', { name: 'QQ 通知：未配置' }));
    expect(screen.getByRole('dialog', { name: 'QQ 通知' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭QQ 通知' }));
    expect(screen.getByRole('button', { name: 'QQ 通知：未配置' }).querySelector('.tool-status-dot')).toBeNull();
  });

  it('opens the video action menu from the persistent preview', async () => {
    await openApp();
    const video = screen.getByRole('region', { name: '视频预览' });
    fireEvent.contextMenu(video);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '弹出视频窗口' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('resizes the persistent video from its lower-left handle and remembers the width', async () => {
    await openApp();
    const workspace = document.querySelector('.workspace-content') as HTMLElement;
    const handle = screen.getByRole('button', { name: '调整视频预览大小' });
    const initial = Number.parseInt(workspace.style.getPropertyValue('--video-width'), 10);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(Number.parseInt(workspace.style.getPropertyValue('--video-width'), 10)).toBe(initial + 16);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(Number.parseInt(workspace.style.getPropertyValue('--video-width'), 10)).toBe(initial);
    expect(localStorage.getItem('auto-poke-rng:video-preview-width')).toBe(String(initial));
  });

  it('keeps edits and log filters while the floating panel expands, minimizes, and restores', async () => {
    await openApp();
    edit('# 工作中的草稿');
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
    const video = screen.getByRole('region', { name: '视频预览' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(video.querySelector('.preview-frame')).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '日志中心' }));
    expect(screen.getByRole('region', { name: '视频预览' })).toBe(video);
  });

  it('edits image labels in the workspace without replacing the persistent video or losing script edits', async () => {
    await openApp();
    edit('# 标签编辑前的草稿');
    const frame = screen.getByRole('region', { name: '视频预览' }).querySelector('.preview-frame');
    fireEvent.click(screen.getByRole('button', { name: '标签' }));
    expect(screen.getByRole('region', { name: '图像标签编辑' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '视频预览' }).querySelector('.preview-frame')).toBe(frame);
    fireEvent.click(screen.getByRole('button', { name: '关闭图像标签' }));
    expect(screen.queryByRole('region', { name: '图像标签编辑' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '脚本内容' }).textContent).toBe('# 标签编辑前的草稿');
    expect(screen.getByRole('region', { name: '视频预览' }).querySelector('.preview-frame')).toBe(frame);
  });


});
