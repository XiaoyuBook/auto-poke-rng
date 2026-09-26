const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function createScriptGate() {
  let pending = Promise.resolve(), count = 0;
  return {
    get busy() { return count > 0; },
    run(action) {
      count++;
      const result = pending.then(action).finally(() => { count--; });
      pending = result.catch(() => {});
      return result;
    },
    drain: () => pending,
  };
}

async function initializeUserScripts(userData, legacyRoot) {
  const root = path.join(userData, 'scripts');
  await fs.mkdir(userData, { recursive: true });
  try {
    const info = await fs.lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('用户脚本目录必须是普通文件夹。');
    return root;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = await fs.mkdtemp(path.join(userData, '.scripts-import-'));
  try {
    // New profiles start empty. Only an explicitly supplied existing legacy
    // directory is migrated once; later starts never reseed user files.
    let legacyExists = false;
    if (legacyRoot) {
      try { await fs.lstat(legacyRoot); legacyExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (legacyExists) {
      await fs.cp(legacyRoot, temporary, { recursive: true, filter: async source => {
        if ((await fs.lstat(source)).isSymbolicLink()) throw Error('旧脚本目录包含链接，请移除链接后重试。');
        return true;
      } });
    }
    await fs.rename(temporary, root);
    return root;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

// Check every ancestor: lstat on the leaf alone misses Windows junctions.
async function assertDirectory(directory) {
  let current = path.parse(directory).root;
  for (const part of path.relative(current, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw Error('脚本目录及其上级必须是普通文件夹，不允许链接。');
  }
}
async function treeSnapshot(root) {
  await assertDirectory(root);
  const entries = [];
  async function visit(relative) {
    for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = relative ? relative + '/' + entry.name : entry.name, absolute = path.join(root, name);
      if (entry.isSymbolicLink()) throw Error('脚本目录包含链接，无法迁移。');
      if (entry.isDirectory()) { entries.push([name, 'directory']); await visit(name); }
      else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute);
        entries.push([name, bytes.length, createHash('sha256').update(bytes).digest('hex')]);
      } else throw Error('脚本目录包含不支持的文件。');
    }
  }
  await visit('');
  return entries;
}
async function createScriptStorage({ userData, legacyRoot, gate = createScriptGate(), isBusy = () => false, persist }) {
  const settings = path.join(userData, 'script-storage.json');
  let root, migration = null, migrating = false;
  let saved;
  try { saved = JSON.parse(await fs.readFile(settings, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('脚本目录设置无法读取：' + error.message); }
  if (saved) {
    if (typeof saved.rootPath !== 'string' || !path.isAbsolute(saved.rootPath)) throw Error('脚本目录设置无效。');
    root = path.resolve(saved.rootPath);
    try { await assertDirectory(root); }
    catch (error) { throw Error(`脚本目录无法访问：${root}。请连接对应磁盘或恢复该目录。`, { cause: error }); }
  } else root = await initializeUserScripts(userData, legacyRoot);
  const getRoot = () => root;
  const checkDestination = async target => {
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw Error('请选择完整的脚本目录路径。');
    const destination = path.resolve(target), a = root.toLowerCase(), b = destination.toLowerCase();
    if (destination === path.parse(destination).root || a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) throw Error('新旧目录不能相同或互相包含，也不能使用磁盘根目录。');
    await assertDirectory(destination);
    if ((await fs.readdir(destination)).length) throw Error('请选择一个空文件夹，避免覆盖已有文件。');
    return destination;
  };
  const prepare = target => gate.run(async () => {
    if (isBusy()) throw Error('请先停止脚本和自动流程，再迁移脚本目录。');
    const to = await checkDestination(target), snapshot = await treeSnapshot(root);
    const plan = { token: randomUUID(), from: root, to, files: snapshot.filter(entry => typeof entry[1] === 'number').length,
      bytes: snapshot.reduce((sum, entry) => sum + (typeof entry[1] === 'number' ? entry[1] : 0), 0) };
    migration = { ...plan, snapshot: JSON.stringify(snapshot), expires: Date.now() + 5 * 60000 };
    return plan;
  });
  const migrate = token => {
    if (migrating) return Promise.reject(Error('脚本目录正在迁移。'));
    migrating = true;
    return gate.run(async () => {
      const plan = migration;
      if (isBusy()) throw Error('请先停止脚本和自动流程，再迁移脚本目录。');
      if (!plan || plan.token !== token || plan.from !== root || plan.expires < Date.now()) throw Error('目录迁移预览已过期，请重新选择。');
      await checkDestination(plan.to);
      if (JSON.stringify(await treeSnapshot(root)) !== plan.snapshot) throw Error('原目录文件已变化，请重新预览迁移。');
      const stage = await fs.mkdtemp(path.join(path.dirname(plan.to), '.rng-migration-'));
      try {
        await fs.cp(root, stage, { recursive: true, filter: async source => {
          if ((await fs.lstat(source)).isSymbolicLink()) throw Error('脚本目录包含链接，无法迁移。');
          return true;
        } });
        if (JSON.stringify(await treeSnapshot(stage)) !== plan.snapshot || JSON.stringify(await treeSnapshot(root)) !== plan.snapshot) throw Error('迁移校验失败或原目录文件已变化，仍使用原目录。');
        await checkDestination(plan.to);
        // Only the empty destination is removed; rename is on the destination disk.
        await fs.rmdir(plan.to);
        await fs.rename(stage, plan.to);
        const temporary = settings + '.' + randomUUID() + '.tmp';
        try {
          if (persist) await persist(plan.to);
          else { await fs.writeFile(temporary, JSON.stringify({ rootPath: plan.to }), { flag: 'wx' }); await fs.rename(temporary, settings); }
        } catch (error) { throw Error(`保存目录设置失败，仍使用原目录；复制结果保留在 ${plan.to}：${error.message}`); }
        finally { await fs.rm(temporary, { force: true }); }
        root = plan.to; migration = null;
        return { rootPath: root, backupPath: plan.from };
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
    }).finally(() => { migrating = false; });
  };
  return { getRoot, prepare, migrate, get migrating() { return migrating; } };
}
module.exports = { createScriptGate, initializeUserScripts, createScriptStorage, assertDirectory };
