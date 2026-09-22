const { spawnSync } = require('node:child_process');
const path = require('node:path');

const testEnv = { ...process.env };
delete testEnv.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [path.resolve(__dirname, 'electron-panels.cjs')], {
  env: testEnv, encoding: 'utf8', timeout: 60000, windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
