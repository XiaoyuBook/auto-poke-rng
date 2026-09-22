const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_BYTES = 1024 * 1024;
const revision = body => createHash('sha256').update(body).digest('hex');
const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 100
  && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name)
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

function createScriptStore(rootDirectory) {
  const rootPath = path.resolve(rootDirectory);
  let writes = Promise.resolve();
  const serialize = action => {
    const next = writes.then(action);
    writes = next.catch(() => {});
    return next;
  };

  async function resolveEntry(relative, { directory = false, allowMissing = false } = {}) {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || path.isAbsolute(relative)
      || relative.split('/').some(part => part === '.' || part === '..' || (!part && relative !== ''))) {
      throw new Error('脚本路径无效。');
    }
    await fs.mkdir(rootPath, { recursive: true });
    const rootInfo = await fs.lstat(rootPath);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('scripts 必须是项目内的普通文件夹。');
    const parts = relative ? relative.split('/') : [];
    let current = rootPath;
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      let info;
      try { info = await fs.lstat(current); }
      catch (error) {
        if (error.code === 'ENOENT' && allowMissing && index === parts.length - 1) return current;
        throw error;
      }
      if (info.isSymbolicLink()) throw new Error('脚本库不读取或写入链接文件。');
      const needsDirectory = index < parts.length - 1 || directory;
      if (needsDirectory ? !info.isDirectory() : !info.isFile()) throw new Error('脚本路径类型无效。');
    }
    if (!directory && (!relative || path.extname(relative).toLowerCase() !== '.rng')) throw new Error('请选择 .rng 脚本文件。');
    return current;
  }

  async function read(relative) {
    const absolute = await resolveEntry(relative);
    if ((await fs.stat(absolute)).size > MAX_BYTES) throw new Error('脚本超过 1 MB，无法打开。');
    const body = await fs.readFile(absolute, 'utf8');
    return { path: relative, name: path.posix.basename(relative).slice(0, -4), body, revision: revision(body) };
  }

  async function list() {
    await resolveEntry('', { directory: true });
    const folders = [], files = [], warnings = [];
    async function visit(folder) {
      const directory = await resolveEntry(folder, { directory: true });
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      for (const entry of entries) {
        const relative = folder ? folder + '/' + entry.name : entry.name;
        if (entry.isSymbolicLink()) { warnings.push('已跳过链接：' + relative); continue; }
        try {
          if (entry.isDirectory()) {
            folders.push({ path: relative, name: entry.name });
            await visit(relative);
          } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.rng') files.push(await read(relative));
        } catch (error) { warnings.push(relative + '：' + error.message); }
      }
    }
    await visit('');
    return { rootPath, folders, files, warnings };
  }

  const create = ({ folder }) => serialize(async () => {
    const directory = await resolveEntry(folder, { directory: true });
    const body = '# 在此编写脚本\n';
    for (let index = 1; index < 10000; index++) {
      const name = '未命名脚本' + (index === 1 ? '' : ' ' + index) + '.rng';
      try {
        await fs.writeFile(path.join(directory, name), body, { encoding: 'utf8', flag: 'wx' });
        return read(folder ? folder + '/' + name : name);
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    throw new Error('未能生成可用的脚本名称。');
  });

  const save = ({ path: relative, name, body, expectedRevision }) => serialize(async () => {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!validName(trimmed)) throw new Error('脚本名称不能为空，或包含文件名不支持的字符。');
    if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw new Error('脚本内容无效或超过 1 MB。');
    const source = await resolveEntry(relative);
    const current = await read(relative);
    if (current.revision !== expectedRevision) throw new Error('文件已在外部修改，请保留当前编辑并刷新查看，避免覆盖。');
    const parent = path.posix.dirname(relative);
    // Preserve the original extension, including its case, when renaming.
    const targetRelative = (parent === '.' ? '' : parent + '/') + trimmed + path.posix.extname(relative);
    const target = await resolveEntry(targetRelative, { allowMissing: true });
    if (targetRelative !== relative) {
      try { await fs.lstat(target); throw new Error('此文件夹已有同名脚本，请换一个名称。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const temporary = path.join(path.dirname(source), '.save-' + randomUUID() + '.tmp');
    try {
      await fs.writeFile(temporary, body, { encoding: 'utf8', flag: 'wx' });
      if (targetRelative === relative) await fs.rename(temporary, target);
      else {
        // link creates the destination exclusively; rename would overwrite on some platforms.
        await fs.link(temporary, target);
        await fs.unlink(source);
      }
    } finally { await fs.rm(temporary, { force: true }); }
    return { path: targetRelative, name: trimmed, body, revision: revision(body) };
  });

  return { list, read, create, save };
}

function registerScriptFiles({ getMainWindow, rootDirectory }) {
  const { ipcMain } = require('electron');
  const store = createScriptStore(rootDirectory);
  for (const operation of ['list', 'create', 'save']) {
    ipcMain.handle('scripts:' + operation, (event, payload) => {
      const main = getMainWindow();
      if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) {
        throw new Error('Main window required');
      }
      return store[operation](payload);
    });
  }
}

module.exports = { createScriptStore, registerScriptFiles };
