const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { unzipSync } = require('fflate');
const { createScriptGate, assertDirectory } = require('./script-storage.cjs');
const { safePath, packageFolder, overlaps, readOptional, packageFolders, scriptAliases } = require('./script-paths.cjs');

const SOURCE = 'https://raw.githubusercontent.com/XiaoyuBook/auto-poke-rng-scripts/main/';
const SOURCES = {
  github: { name: 'GitHub', url: 'https://github.com/XiaoyuBook/auto-poke-rng-scripts' },
  gitee: { name: 'Gitee', url: 'https://gitee.com/shekongsk/auto-poke-rng-scripts' },
};
const META = '.rng-package.json';
const MAX_ARCHIVE = 20 * 1024 * 1024, MAX_FILES = 256, MAX_EXPANDED = 50 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const version = value => typeof value === 'string' && value.length <= 50 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').every(n => Number.isSafeInteger(Number(n)));
const compare = (a,b) => { const right = b.split('.').map(Number); for (const [i,n] of a.split('.').map(Number).entries()) { if (n !== right[i]) return n > right[i] ? 1 : -1; } return 0; };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit;
function validatePackage(item) {
  if (!item || item.schemaVersion !== 1 || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || !version(item.version) || !version(item.minimumAppVersion)
    || !text(item.name, 100) || !text(item.description, 3000) || !text(item.game, 50) || !Array.isArray(item.authors) || !item.authors.length || item.authors.length > 20 || item.authors.some(author => !text(author, 100))
    || !packageFolder(item.installFolder) || (item.instructions != null && !text(item.instructions, 12000))) throw Error('脚本包描述无效。');
  if (item.legacyPaths != null && (typeof item.legacyPaths !== 'object' || Array.isArray(item.legacyPaths) || Object.keys(item.legacyPaths).length > MAX_FILES
    || Object.entries(item.legacyPaths).some(([file, legacy]) => !packageFolder(file) || !packageFolder(legacy) || !/\.(txt|rng|il)$/i.test(file) || path.posix.extname(file).toLowerCase() !== path.posix.extname(legacy).toLowerCase()
      || !item.files?.some(entry => entry.path === file) || overlaps(item.installFolder, legacy)))) throw Error('旧脚本迁移清单无效。');
  if (item.readme != null && !text(item.readme, 30000) || item.updatedAt != null && (typeof item.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.updatedAt))) throw Error('脚本包说明无效。');
  if (item.files != null) {
    if (!Array.isArray(item.files) || item.files.length > MAX_FILES) throw Error('脚本包文件清单无效。');
    const seen = new Set();
    for (const file of item.files) {
      if (!file || !safePath(file.path) || !/\.(txt|rng|il|md)$/i.test(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 12 * 1024 * 1024 || !digest(file.sha256)
        || seen.has(file.path.toLowerCase()) || file.category != null && !text(file.category, 50)) throw Error('脚本包资源路径或文件清单无效。');
      seen.add(file.path.toLowerCase());
    }
  }
  return item;
}
function validateCatalog(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.packages) || value.packages.length > 100) throw Error('脚本仓库索引无效。');
  const ids = new Set(), folders = new Set();
  for (const item of value.packages) {
    validatePackage(item);
    if (ids.has(item.id) || [...folders].some(folder => overlaps(folder, item.installFolder)) || item.archive !== `packages/${item.id}/${item.version}.zip` || !digest(item.sha256) || !Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_ARCHIVE) throw Error('脚本仓库索引存在重复、重叠或无效的包。');
    ids.add(item.id); folders.add(item.installFolder.toLowerCase());
  }
  return value;
}
function checkPathCase(paths) {
  const names = new Map();
  for (const name of paths) {
    const parts = name.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), key = prefix.toLowerCase();
      if (names.has(key) && names.get(key) !== prefix) throw Error('文件或目录存在大小写冲突：' + prefix);
      names.set(key, prefix);
    }
  }
}
function unpackArchive(bytes) {
  if (bytes.length > MAX_ARCHIVE) throw Error('脚本包超过 20 MB。');
  let total = 0, count = 0;
  const seen = new Set();
  const entries = unzipSync(bytes, { filter: entry => {
    const name = entry.name.replace(/\/$/, '');
    if (!safePath(name) || seen.has(name.toLowerCase())) throw Error('ZIP 中包含不安全或重复的路径。');
    seen.add(name.toLowerCase());
    total += entry.originalSize; count++;
    if (count > MAX_FILES * 2 + 10 || total > MAX_EXPANDED || entry.originalSize > 12 * 1024 * 1024) throw Error('脚本包解压大小或文件数量超限。');
    return !entry.name.endsWith('/');
  } });
  if (!entries['manifest.json'] || entries['manifest.json'].length > 1024 * 1024) throw Error('缺少脚本包描述。');
  const manifest = validatePackage(JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8')));
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES) throw Error('脚本包资源清单无效。');
  const files = Object.create(null), names = new Set();
  for (const file of manifest.files) {
    if (!safePath(file.path) || !/\.(rng|il|md|txt)$/i.test(file.path) || names.has(file.path.toLowerCase()) || !digest(file.sha256)) throw Error('脚本包资源路径无效。');
    names.add(file.path.toLowerCase());
    const content = entries['files/' + file.path];
    if (!content || content.length !== file.bytes || hash(content) !== file.sha256) throw Error('脚本包资源校验失败：' + file.path);
    if (/\.(txt|rng)$/i.test(file.path) && content.length > 1024 * 1024) throw Error('脚本超过 1 MB。');
    if (/\.il$/i.test(file.path)) {
      const label = JSON.parse(Buffer.from(content).toString('utf8').replace(/^\uFEFF/, ''));
      if (typeof label.ImgBase64 !== 'string' || !Number.isFinite(label.searchMethod)) throw Error('图像标签无效。');
    }
    files[file.path] = Buffer.from(content);
  }
  checkPathCase(Object.keys(files));
  if (!Object.keys(files).some(name => /\.(txt|rng)$/i.test(name)) || Object.keys(entries).length !== manifest.files.length + 1) throw Error('脚本包有未声明的文件或缺少脚本。');
  return { manifest, files };
}

async function readTree(directory) {
  const files = Object.create(null);
  async function visit(folder, relative = '') {
    let info;
    try { info = await fs.lstat(folder); } catch (error) { if (!relative && error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw Error('脚本目录不允许链接或普通文件。');
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw Error('脚本目录不允许链接。');
      if (entry.isDirectory()) await visit(path.join(folder, entry.name), name);
      else if (entry.isFile()) files[name] = await fs.readFile(path.join(folder, entry.name));
      else throw Error('脚本目录包含不支持的文件。');
    }
  }
  await visit(directory);
  return files;
}
const fingerprints = files => Object.fromEntries(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)).map(([name,bytes]) => [name, hash(bytes)]));
function installedInfo(files) {
  if (!files[META]) return null;
  const info = JSON.parse(files[META].toString('utf8'));
  validatePackage(info.manifest);
  if (!info.hashes || typeof info.hashes !== 'object' || Object.entries(info.hashes).some(([name,value]) => !safePath(name) || !digest(value))) throw Error('已安装脚本包记录损坏。');
  return info;
}

function createScriptRepository(options) {
  const { rootDirectory, gate = createScriptGate() } = options;
  if (typeof rootDirectory !== 'function') return createFixedRepository({ ...options, gate });
  let currentRoot, service;
  return Object.fromEntries(['state', 'refresh', 'setChannel', 'details', 'prepare', 'planArchive', 'apply'].map(method => [method, (...args) => gate.run(async () => {
    const root = rootDirectory();
    await assertDirectory(root);
    if (currentRoot !== root) {
      currentRoot = root;
      service = createFixedRepository({ ...options, rootDirectory: root, gate: { run: action => action() } });
    }
    return service[method](...args);
  })]));
}
function createFixedRepository({ rootDirectory, userData, appVersion, bundledCatalog = require('../resources/script-catalog.json'), gate = createScriptGate(), isBusy = () => false, fetch: download = globalThis.fetch, log = () => {}, rename = fs.rename }) {
  const stateDirectory = path.join(userData, 'script-repository');
  const settingsPath = path.join(stateDirectory, 'settings.json');
  let channel = 'github', settingsLoaded, catalogSource = 'empty', downloadedArchive;
  const cachePath = () => path.join(stateDirectory, channel === 'github' ? 'catalog.json' : 'catalog-gitee.json');
  const loadSettings = () => settingsLoaded ||= (async () => {
    try { const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8')); if (Object.hasOwn(SOURCES, saved.channel)) channel = saved.channel; }
    catch (error) { if (error.code !== 'ENOENT') log('仓库渠道设置无法读取，已使用默认渠道。', 'warning'); }
  })();
  const transactionDirectory = path.join(rootDirectory, '.rng-repository');
  const journalPath = path.join(transactionDirectory, 'install-pending.json');
  let catalog = null;
  let recovery;
  const plans = new Map();
  const exists = async file => { try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  async function recoverInstall(directory) {
    const journal = path.join(directory, 'install-pending.json');
    if (!await exists(journal)) return;
    const record = JSON.parse(await fs.readFile(journal, 'utf8'));
    if (!packageFolder(record.folder) || ![record.stage, record.backup].every(name => packageFolder(name) && !name.includes('/'))) throw Error('安装恢复记录无效，请检查脚本仓库备份。');
    const target = path.join(rootDirectory, record.folder), backup = path.join(directory, 'backups', record.backup), stage = path.join(directory, 'staging', record.stage);
    await assertDirectory(path.dirname(target)); await assertDirectory(path.dirname(backup)); await assertDirectory(path.dirname(stage));
    if (!await exists(target) && await exists(backup)) await fs.rename(backup, target);
    else if (await exists(target) && await exists(backup)) {
      const installed = installedInfo(await readTree(target));
      if (installed?.transaction !== record.transaction) throw Error('安装恢复发现文件冲突，已保留原文件和备份。');
    }
    await fs.rm(stage, { recursive: true, force: true });
    await fs.rm(journal);
    log('已恢复上次中断的脚本包安装。');
  }
  const ensureRoot = async () => {
    await fs.mkdir(rootDirectory, { recursive: true }); const info = await fs.lstat(rootDirectory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw Error('用户脚本目录无效。');
    await assertDirectory(rootDirectory);
    for (const directory of [transactionDirectory, path.join(transactionDirectory, 'backups'), path.join(transactionDirectory, 'staging')]) {
      await fs.mkdir(directory, { recursive: true }); await assertDirectory(directory);
    }
    recovery ||= (async () => { await recoverInstall(stateDirectory); await recoverInstall(transactionDirectory); })(); await recovery;
  };
  async function fetchBytes(relative, maximum) {
    await loadSettings();
    const resource = relative.split('/').map(encodeURIComponent).join('/');
    const useGitee = channel === 'gitee';
    const urls = useGitee ? [`https://gitee.com/shekongsk/auto-poke-rng-scripts/raw/main/${resource}`]
      : [new URL(resource, SOURCE).href, `https://api.github.com/repos/XiaoyuBook/auto-poke-rng-scripts/contents/${resource}?ref=main`];
    let failure;
    for (const url of urls) {
      try {
        const options = { signal: AbortSignal.timeout(12000), redirect: useGitee ? 'manual' : 'error', headers: { Accept: 'application/vnd.github.raw+json' }, maximumBytes: maximum };
        let response = await download(url, options);
        if (useGitee && [301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          const destination = location && new URL(location, url);
          // Gitee serves public files through a signed URL on its raw CDN.
          // Permit one hop to the same resource, retaining the original timeout.
          if (!destination || destination.origin !== 'https://raw.giteeusercontent.com' || destination.username || destination.password
            || destination.hash || destination.pathname !== new URL(url).pathname) throw Error('Gitee 下载跳转地址无效。');
          response = await download(destination.href, options);
        }
        if (!response.ok) { await response.body?.cancel(); throw Error(`HTTP ${response.status}`); }
        if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new RangeError('仓库下载大小超限。'); }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > maximum) throw new RangeError('仓库下载大小超限。'); chunks.push(Buffer.from(chunk)); }
        return Buffer.concat(chunks);
      } catch (error) {
        if (error instanceof RangeError) throw error;
        failure = error;
      }
    }
    log('脚本仓库连接失败：' + failure?.message, 'warning');
    throw Error('无法连接官方脚本仓库。请检查网络或系统代理后重试，也可以导入本地脚本包。', { cause: failure });
  }
  async function loadCatalog() {
    await loadSettings();
    if (!catalog) {
      try { catalog = validateCatalog(JSON.parse(await fs.readFile(cachePath(), 'utf8'))); catalogSource = 'cache'; }
      catch (error) {
        if (error.code !== 'ENOENT') log('本地仓库目录无法读取，已回退到内置目录。', 'warning');
        if (bundledCatalog) { catalog = validateCatalog(bundledCatalog); catalogSource = 'bundled'; }
      }
    }
    return catalog || { schemaVersion: 1, packages: [] };
  }
  async function state() {
    await ensureRoot();
    const index = await loadCatalog(), installed = [];
    for (const folder of await packageFolders(rootDirectory)) {
      const files = await readTree(path.join(rootDirectory, folder)), info = installedInfo(files);
      if (info.manifest.installFolder !== folder) throw Error('已安装脚本包目录与记录不一致。');
      installed.push({ ...info.manifest, modified: Object.entries(info.hashes).some(([name,value]) => !files[name] || hash(files[name]) !== value) });
    }
    return { packages: index.packages, installed, rootPath: rootDirectory, source: SOURCES[channel].url, channel, sources: SOURCES, catalogSource, cached: ['cache', 'remote'].includes(catalogSource) };
  }
  async function refresh() {
    const next = validateCatalog(JSON.parse((await fetchBytes('catalog.json', 2 * 1024 * 1024)).toString('utf8')));
    await fs.mkdir(stateDirectory, { recursive: true });
    const temporary = path.join(stateDirectory, 'catalog-' + randomUUID() + '.tmp');
    try { await fs.writeFile(temporary, JSON.stringify(next)); await fs.rename(temporary, cachePath()); }
    finally { await fs.rm(temporary, { force: true }); }
    catalog = next; catalogSource = 'remote';
    log('脚本仓库索引已更新。');
    return state();
  }
  async function setChannel(value) {
    if (!Object.hasOwn(SOURCES, value)) throw Error('仓库渠道无效。');
    await loadSettings();
    await fs.mkdir(stateDirectory, { recursive: true });
    const temporary = path.join(stateDirectory, 'settings-' + randomUUID() + '.tmp');
    try { await fs.writeFile(temporary, JSON.stringify({ channel: value })); await fs.rename(temporary, settingsPath); }
    finally { await fs.rm(temporary, { force: true }); }
    channel = value; catalog = null; catalogSource = 'empty'; downloadedArchive = undefined; plans.clear();
    return state();
  }
  async function planArchive(bytes, expected) {
    await ensureRoot();
    const pack = unpackArchive(bytes), { manifest } = pack;
    if (expected && (manifest.id !== expected.id || manifest.version !== expected.version || manifest.installFolder !== expected.installFolder)) throw Error('脚本包与仓库索引不一致。');
    if (compare(manifest.minimumAppVersion, appVersion) > 0) throw Error(`此脚本包需要 Auto Poke RNG ${manifest.minimumAppVersion} 或更新版本。`);
    const target = path.join(rootDirectory, manifest.installFolder);
    await checkOwnership(manifest.installFolder);
    const targetFiles = await readTree(target), old = installedInfo(targetFiles);
    const legacy = old ? { files: {}, hashes: {}, revisions: {}, migrations: [] } : await readLegacy(manifest, targetFiles);
    const current = { ...legacy.files, ...targetFiles }, before = fingerprints(current);
    checkPathCase([...Object.keys(current), ...Object.keys(pack.files)]);
    if (old && old.manifest.id !== manifest.id) throw Error('安装目录已由其他脚本包使用。');
    if (old && compare(old.manifest.version, manifest.version) > 0) throw Error('已安装版本更新，不允许降级覆盖。');
    const changes = [], conflicts = [];
    for (const [name,content] of Object.entries(pack.files)) {
      const incoming = hash(content), previous = old?.hashes[name] || legacy.hashes[name];
      if (before[name] === incoming) continue;
      changes.push({ path: name, action: before[name] ? 'update' : 'add' });
      if (before[name] !== previous) conflicts.push(name);
    }
    for (const [name,previous] of Object.entries(old?.hashes || {})) {
      if (pack.files[name] || !current[name]) continue;
      changes.push({ path: name, action: 'remove' });
      if (before[name] !== previous) conflicts.push(name);
    }
    const token = randomUUID();
    plans.clear(); plans.set(token, { ...pack, before: fingerprints(targetFiles), legacy, target, changes, conflicts, expires: Date.now() + 5 * 60000 });
    return { token, package: manifest, installedVersion: old?.manifest.version || null, changes, conflicts, migrations: legacy.migrations };
  }
  async function checkOwnership(folder) {
    // Validate even absent leaf paths, without following links in their ancestors.
    await readOptional(rootDirectory, folder + '/' + META);
    for (const installed of await packageFolders(rootDirectory)) if (installed !== folder && overlaps(installed, folder)) throw Error('安装目录与其他脚本包重叠。');
  }
  async function readLegacy(manifest, targetFiles) {
    const files = Object.create(null), hashes = Object.create(null), revisions = Object.create(null), migrations = [];
    for (const [file, source] of Object.entries(manifest.legacyPaths || {})) {
      if (targetFiles[file]) continue;
      let relative = source, bytes = await readOptional(rootDirectory, relative);
      revisions[relative] = bytes ? hash(bytes) : null;
      if (!bytes && /\.txt$/i.test(source)) {
        relative = source.replace(/\.txt$/i, '.rng'); bytes = await readOptional(rootDirectory, relative);
        revisions[relative] = bytes ? hash(bytes) : null;
      }
      let parent = path.posix.dirname(source);
      while (parent !== '.') {
        const metaPath = parent + '/' + META, metadata = await readOptional(rootDirectory, metaPath);
        if (metadata) {
          const previous = installedInfo({ [META]: metadata });
          const baseline = previous.hashes[source.slice(parent.length + 1)];
          if (baseline) { hashes[file] = baseline; revisions[metaPath] = hash(metadata); }
          break;
        }
        parent = path.posix.dirname(parent);
      }
      if (bytes) { files[file] = bytes; migrations.push({ from: relative, to: manifest.installFolder + '/' + file }); }
    }
    return { files, hashes, revisions, migrations };
  }
  async function downloadPackage(id) {
    const index = await loadCatalog(), item = index.packages.find(pack => pack.id === id);
    if (!item) throw Error('请先检查仓库更新并选择脚本包。');
    const bytes = downloadedArchive?.sha256 === item.sha256 ? downloadedArchive.bytes : await fetchBytes(item.archive, MAX_ARCHIVE);
    if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw Error('脚本包下载校验失败，未安装。');
    downloadedArchive = { sha256: item.sha256, bytes };
    return { bytes, item };
  }
  async function details(id) {
    const { bytes, item } = await downloadPackage(id), { manifest } = unpackArchive(bytes);
    if (manifest.id !== item.id || manifest.version !== item.version || manifest.installFolder !== item.installFolder) throw Error('脚本包与仓库索引不一致。');
    return manifest;
  }
  async function prepare(id) { const { bytes, item } = await downloadPackage(id); return planArchive(bytes, item); }
  const apply = ({ token, policy }) => gate.run(async () => {
    if (isBusy()) throw Error('请先停止脚本和自动流程，再安装或更新脚本包。');
    const plan = plans.get(token);
    if (!plan || plan.expires < Date.now()) throw Error('安装预览已过期，请重新检查。');
    if (!['keep', 'replace'].includes(policy)) throw Error('请选择本地修改处理方式。');
    await ensureRoot();
    await checkOwnership(plan.manifest.installFolder);
    const current = await readTree(plan.target);
    if (JSON.stringify(fingerprints(current)) !== JSON.stringify(plan.before)) throw Error('本地文件已变化，请重新预览后安装。');
    const stagingRoot = path.join(transactionDirectory, 'staging'), backupRoot = path.join(transactionDirectory, 'backups');
    await fs.mkdir(stagingRoot, { recursive: true }); await fs.mkdir(backupRoot, { recursive: true });
    const stage = await fs.mkdtemp(path.join(stagingRoot, plan.manifest.id + '-'));
    const backup = path.join(backupRoot, plan.manifest.id + '-' + Date.now() + '-' + randomUUID());
    let moved = false, committed = false;
    try {
      const next = { ...plan.legacy.files, ...current };
      for (const change of plan.changes) {
        if (policy === 'keep' && plan.conflicts.includes(change.path)) continue;
        if (change.action === 'remove') delete next[change.path]; else next[change.path] = plan.files[change.path];
      }
      next[META] = Buffer.from(JSON.stringify({ manifest: plan.manifest, hashes: fingerprints(plan.files), installedAt: new Date().toISOString(), transaction: token }, null, 2));
      for (const [name,content] of Object.entries(next)) {
        if (!safePath(name)) throw Error('本地文件路径不能安全迁移：' + name);
        const destination = path.join(stage, name);
        await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, content);
      }
      if (JSON.stringify(fingerprints(await readTree(plan.target))) !== JSON.stringify(plan.before)) throw Error('本地文件已变化，请重新预览后安装。');
      for (const [relative, revision] of Object.entries(plan.legacy.revisions)) {
        const bytes = await readOptional(rootDirectory, relative);
        if ((bytes ? hash(bytes) : null) !== revision) throw Error('旧目录文件已变化，请重新预览迁移。');
      }
      await checkOwnership(plan.manifest.installFolder);
      await fs.mkdir(path.dirname(plan.target), { recursive: true }); await assertDirectory(path.dirname(plan.target));
      await fs.writeFile(journalPath, JSON.stringify({ folder: plan.manifest.installFolder, stage: path.basename(stage), backup: path.basename(backup), transaction: token }), { flag: 'wx' });
      try { await rename(plan.target, backup); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await rename(stage, plan.target); committed = true; }
      catch (error) { if (moved) await fs.rename(backup, plan.target); await fs.rm(journalPath); throw error; }
      await fs.rm(journalPath);
      plans.delete(token);
      const kept = policy === 'keep' ? plan.conflicts.length : 0;
      log(`已安装脚本包 ${plan.manifest.name} ${plan.manifest.version}${kept ? `，保留 ${kept} 项本地修改` : ''}${moved ? `；备份：${backup}` : ''}。`);
      return { state: await state(), kept, backupPath: moved ? backup : null };
    } finally {
      if (!committed) {
        await fs.rm(stage, { recursive: true, force: true });
        if (!moved) await fs.rm(journalPath, { force: true });
      }
    }
  });
  return { state, refresh, setChannel, details, prepare, planArchive, apply };
}

function registerScriptRepository({ ipcMain, getMainWindow, dialog, storage, migrateScriptPaths, ...options }) {
  // Chromium networking follows the desktop session's system proxy settings.
  const service = createScriptRepository({ ...options, fetch: options.fetch || require('./script-repository-network.cjs').fetchRepositoryResource });
  const synchronize = async state => {
    if (migrateScriptPaths) await migrateScriptPaths(await scriptAliases(state.rootPath));
    return state;
  };
  const actions = {
    state: async () => synchronize(await service.state()), refresh: async () => synchronize(await service.refresh()), prepare: args => service.prepare(args?.id), apply: async args => {
      const result = await service.apply(args || {});
      try { await synchronize(result.state); } catch (error) { result.warning = '脚本已安装，自动流程路径设置保存失败，请重新打开仓库重试：' + error.message; options.log?.(result.warning, 'warning'); }
      return result;
    },
    channel: args => service.setChannel(args?.channel), details: args => service.details(args?.id),
    'choose-directory': async () => {
      if (!storage) throw Error('当前版本不支持迁移脚本目录。');
      await service.state(); // Recover any interrupted install before copying its library.
      const selected = await dialog.showOpenDialog(getMainWindow(), { title: '选择新的空脚本目录', defaultPath: storage.getRoot(), properties: ['openDirectory', 'createDirectory'] });
      return selected.canceled ? null : storage.prepare(selected.filePaths[0]);
    },
    'migrate-directory': async args => {
      if (!storage) throw Error('当前版本不支持迁移脚本目录。');
      const result = await storage.migrate(args?.token);
      options.log?.(`脚本目录已迁移至 ${result.rootPath}；原目录备份：${result.backupPath}。`);
      return { ...result, state: await service.state() };
    },
    'open-directory': async () => {
      await service.state();
      const error = await (options.openPath || require('electron').shell.openPath)(path.resolve(typeof options.rootDirectory === 'function' ? options.rootDirectory() : options.rootDirectory));
      if (error) throw Error('无法打开脚本目录，请在文件管理器中查看。');
    },
    import: async () => {
      const selected = await dialog.showOpenDialog(getMainWindow(), { title: '导入脚本包', filters: [{ name: '脚本包', extensions: ['zip'] }], properties: ['openFile'] });
      if (selected.canceled) return null;
      const file = selected.filePaths[0];
      if ((await fs.stat(file)).size > MAX_ARCHIVE) throw Error('脚本包超过 20 MB。');
      return service.planArchive(await fs.readFile(file));
    },
  };
  for (const [name,action] of Object.entries(actions)) ipcMain.handle('script-repository:' + name, async (event, args) => {
    if (!event.sender || event.sender !== getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw Error('Unknown script repository sender');
    try { return await action(args); } catch (error) { options.log?.('脚本仓库：' + error.message, 'warning'); throw error; }
  });
  return service;
}
module.exports = { createScriptRepository, registerScriptRepository, unpackArchive, validateCatalog };
