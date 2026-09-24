import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScriptStore } from '../electron/script-files.cjs';

let fixture, root, store;
const put = async (relative, body = '# example') => {
  const absolute = path.join(root, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, body, 'utf8');
};
beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'poke-script-test-'));
  root = path.join(fixture, 'scripts');
  store = createScriptStore(root);
});
afterEach(async () => { await fs.rm(fixture, { recursive: true, force: true }); });
const save = (file, changes) => store.save({ ...file, expectedRevision: file.revision, ...changes });

describe('project script files', () => {
  it('discovers actual folders recursively, root scripts, and empty folders, ignoring other file types', async () => {
    await put('火红/确认.rng', '# 火红');
    await put('珍钻复刻/菜单/确认.rng', '# 珍钻');
    await put('根目录.RNG', '# root');
    await put('开发工具.cjs', 'throw new Error("must never run")');
    await fs.mkdir(path.join(root, '空目录'));
    const listed = await store.list();
    expect(listed.folders.map(folder => folder.path)).toEqual(expect.arrayContaining(['火红', '珍钻复刻', '珍钻复刻/菜单', '空目录']));
    expect(listed.files.map(file => file.path)).toEqual(expect.arrayContaining(['火红/确认.rng', '珍钻复刻/菜单/确认.rng', '根目录.RNG']));
    expect(listed.files).toHaveLength(3);
    expect(listed.files.find(file => file.path === '火红/确认.rng').body).toBe('# 火红');
  });

  it('creates unique names and saves/renames UTF-8 files without touching sibling scripts', async () => {
    await put('珍钻复刻/确认.rng', '# original');
    const [first, second] = await Promise.all([store.create({ folder: '珍钻复刻' }), store.create({ folder: '珍钻复刻' })]);
    expect(first.path).not.toBe(second.path);
    const renamed = await save(first, { name: '我的流程', body: '# 编辑后\npress A' });
    expect(await fs.readFile(path.join(root, renamed.path), 'utf8')).toBe('# 编辑后\npress A');
    await expect(fs.stat(path.join(root, first.path))).rejects.toHaveProperty('code', 'ENOENT');
    const updated = await save(renamed, { body: '# 第二次保存' });
    expect((await store.read(updated.path)).body).toBe('# 第二次保存');
    expect((await store.read('珍钻复刻/确认.rng')).body).toBe('# original');
    expect((await fs.readdir(path.join(root, '珍钻复刻'))).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects collisions, external edits and invalid names while preserving both files', async () => {
    await put('火红/一.rng', '# one'); await put('火红/二.rng', '# two');
    const first = await store.read('火红/一.rng');
    await expect(save(first, { name: '二', body: 'overwrite' })).rejects.toThrow('同名');
    for (const name of ['../escape', 'CON', 'bad/name', '', 'ends.']) {
      await expect(save(first, { name })).rejects.toThrow('名称');
    }
    await put(first.path, '# external');
    await expect(save(first, { body: '# local' })).rejects.toThrow('外部修改');
    expect((await store.read(first.path)).body).toBe('# external');
    expect((await store.read('火红/二.rng')).body).toBe('# two');
  });

  it('rejects traversal and linked directories for reads, creates and writes', async () => {
    await fs.mkdir(root, { recursive: true });
    const outside = path.join(fixture, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, '秘密.rng'), '# untouched');
    await fs.symlink(outside, path.join(root, '链接'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await store.list()).warnings).toHaveLength(1);
    for (const relative of ['../outside/秘密.rng', '链接/秘密.rng', 'D:/outside/秘密.rng', 'folder/../../outside/秘密.rng']) {
      await expect(store.read(relative)).rejects.toThrow();
      await expect(store.save({ path: relative, name: '秘密', body: '# changed' })).rejects.toThrow();
    }
    await expect(store.create({ folder: '链接' })).rejects.toThrow('链接');
    await expect(store.create({ folder: '..' })).rejects.toThrow('路径');
    expect(await fs.readFile(path.join(outside, '秘密.rng'), 'utf8')).toBe('# untouched');
  });

  it('supports a missing scripts folder and reports oversized files without blocking other scripts', async () => {
    expect((await store.list()).files).toEqual([]);
    await put('大文件.rng', 'a'.repeat(1024 * 1024 + 1)); await put('可用.rng');
    const listing = await store.list();
    expect(listing.files).toHaveLength(1);
    expect(listing.warnings[0]).toContain('大文件.rng');
  });

  it('saves, lists, reads, and replaces image labels in a script folder', async () => {
    await put('火红/确认.rng');
    const label = {
      folder: '火红', name: '菜单按钮', searchMethod: 5, threshold: 92,
      range: { x: 10, y: 20, width: 300, height: 180 },
      target: { x: 80, y: 60, width: 64, height: 32 },
      imageBase64: Buffer.from('synthetic-template').toString('base64'),
    };
    const saved = await store.labelSave(label);
    expect(saved).toMatchObject({ name: '菜单按钮', path: '火红/ImgLabel/菜单按钮.IL', searchMethod: 5, threshold: 92, range: label.range, target: label.target, imageBase64: label.imageBase64 });
    const onDisk = JSON.parse(await fs.readFile(path.join(root, '火红', 'ImgLabel', '菜单按钮.IL'), 'utf8'));
    expect(onDisk).toMatchObject({ searchMethod: 5, threshold: 92, ImgBase64: label.imageBase64, RangeX: 10, TargetWidth: 64 });
    expect((await store.labelsList({ folder: '火红' })).labels).toEqual([expect.objectContaining({ name: '菜单按钮', imageBase64: undefined, range: label.range })]);
    expect(await store.labelRead({ folder: '火红', name: '菜单按钮' })).toMatchObject(saved);

    const replacement = await store.labelSave({ ...label, threshold: 97, target: { x: 90, y: 70, width: 48, height: 24 } });
    expect(replacement.threshold).toBe(97);
    expect(replacement.target).toEqual({ x: 90, y: 70, width: 48, height: 24 });
    expect((await store.labelsList({ folder: '火红' })).labels).toHaveLength(1);
  });

  it('rejects unsafe image label paths, data, and rectangles', async () => {
    await put('火红/确认.rng');
    const valid = {
      folder: '火红', name: '安全', searchMethod: 5, threshold: 90,
      range: { x: 0, y: 0, width: 100, height: 100 }, target: { x: 10, y: 10, width: 20, height: 20 }, imageBase64: 'YWJj',
    };
    for (const name of ['../越界', 'bad/name', 'CON']) await expect(store.labelSave({ ...valid, name })).rejects.toThrow('名称');
    await expect(store.labelSave({ ...valid, folder: '../outside' })).rejects.toThrow();
    await expect(store.labelSave({ ...valid, imageBase64: 'not base64!' })).rejects.toThrow('截图');
    await expect(store.labelSave({ ...valid, target: { x: 90, y: 90, width: 20, height: 20 } })).rejects.toThrow('坐标');
    await expect(store.labelSave({ ...valid, searchMethod: 999 })).rejects.toThrow('搜索方法');
  });

  it('stores OCR labels as expected text instead of image base64', async () => {
    await put('火红/确认.rng');
    const saved = await store.labelSave({
      folder: '火红', name: '状态文字', searchMethod: 107, threshold: 88,
      range: { x: 0, y: 0, width: 160, height: 60 }, target: { x: 8, y: 12, width: 120, height: 30 },
      imageBase64: '  READY  ',
    });
    expect(saved.imageBase64).toBe('READY');
    expect(JSON.parse(await fs.readFile(path.join(root, '火红', 'ImgLabel', '状态文字.IL'), 'utf8')).ImgBase64).toBe('READY');
    await expect(store.labelSave({
      folder: '火红', name: '空文字', searchMethod: 107, threshold: 88,
      range: validRect(), target: { x: 1, y: 1, width: 2, height: 2 }, imageBase64: '   ',
    })).rejects.toThrow('文本');
  });
});

function validRect() { return { x: 0, y: 0, width: 10, height: 10 }; }
