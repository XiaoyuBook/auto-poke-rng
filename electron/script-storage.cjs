const fs = require('node:fs/promises');
const path = require('node:path');

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
    // Copy the user's current files once, including local edits; later starts never reseed them.
    let legacyExists = true;
    try { await fs.lstat(legacyRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; legacyExists = false; }
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
module.exports = { createScriptGate, initializeUserScripts };
