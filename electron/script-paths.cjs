const fs = require('node:fs/promises');
const path = require('node:path');
const { assertDirectory } = require('./script-storage.cjs');
const META = '.rng-package.json';
function safePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[<>:"\\|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
const packageFolder = value => safePath(value) && value.split('/').every(part => !part.startsWith('.'));
const overlaps = (a, b) => { a = a.toLowerCase(); b = b.toLowerCase(); return a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); };
async function readOptional(root, relative) {
  if (!safePath(relative)) throw Error('脚本资源路径无效。');
  let current = root;
  await assertDirectory(root);
  const parts = relative.split('/');
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    let info;
    try { info = await fs.lstat(current); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (info.isSymbolicLink()) throw Error('脚本目录不允许链接。');
    if (i < parts.length - 1 ? !info.isDirectory() : !info.isFile()) throw Error('脚本资源路径类型无效。');
    if (i === parts.length - 1 && info.size > 12 * 1024 * 1024) throw Error('脚本资源文件过大。');
  }
  return fs.readFile(current);
}
async function packageFolders(root) {
  const found = [];
  async function visit(relative) {
    const directory = path.join(root, relative);
    if (relative && await readOptional(root, relative + '/' + META)) { found.push(relative); return; }
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && entry.name !== 'ImgLabel') await visit(relative ? relative + '/' + entry.name : entry.name);
    }
  }
  await assertDirectory(root); await visit('');
  return found;
}
async function scriptAliases(root) {
  const aliases = Object.create(null);
  for (const folder of await packageFolders(root)) {
    let info;
    try { info = JSON.parse((await readOptional(root, folder + '/' + META)).toString('utf8')); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    const manifest = info.manifest;
    if (manifest?.installFolder !== folder || !packageFolder(folder)) continue;
    for (const [file, legacy] of Object.entries(manifest.legacyPaths || {})) {
      if (!safePath(file) || !packageFolder(legacy) || !/\.(txt|rng)$/i.test(file) || !/\.(txt|rng)$/i.test(legacy) || !manifest.files?.some(item => item.path === file)) continue;
      const destination = folder + '/' + file;
      if (!await readOptional(root, destination)) continue;
      for (const old of [legacy, legacy.replace(/\.(txt|rng)$/i, (_,ext) => ext.toLowerCase() === 'txt' ? '.rng' : '.txt')]) {
        if (aliases[old] && aliases[old] !== destination) throw Error('旧脚本路径对应多个安装包，请检查安装记录。');
        if (old !== destination) aliases[old] = destination;
      }
    }
  }
  return aliases;
}
module.exports = { safePath, packageFolder, overlaps, readOptional, packageFolders, scriptAliases };
