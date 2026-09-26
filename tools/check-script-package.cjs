const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createScriptRepository } = require('../electron/script-repository.cjs');
const { ScriptRunner } = require('../electron/script-runner.cjs');

async function main() {
  if (!process.argv[2]) throw Error('请指定从脚本仓库下载的 ZIP 路径。');
  const archive = path.resolve(process.argv[2]);
  if ((await fs.stat(archive)).size > 20 * 1024 * 1024) throw Error('脚本包超过 20 MB。');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'poke-package-check-'));
  try {
    const rootDirectory = path.join(userData, 'scripts');
    const repository = createScriptRepository({ rootDirectory, userData, appVersion: require('../package.json').version, bundledCatalog: null });
    const plan = await repository.planArchive(await fs.readFile(archive));
    await repository.apply({ token: plan.token, policy: 'keep' });
    const runner = new ScriptRunner({ rootDirectory });
    const scripts = plan.package.files.filter(file => /\.(txt|rng)$/i.test(file.path));
    for (const file of scripts) {
      const relative = plan.package.installFolder + '/' + file.path;
      const result = await runner.validate({ path: relative, text: await fs.readFile(path.join(rootDirectory, relative), 'utf8') });
      if (!result.valid) throw Error(`${relative}: ${result.diagnostic?.message || '编译失败'}`);
    }
    console.log(`${plan.package.name} ${plan.package.version}：校验、临时目录安装及 ${scripts.length} 个脚本编译通过，未执行脚本。`);
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
