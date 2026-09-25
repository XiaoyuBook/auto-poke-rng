const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const bundled = path.join(root, '.deps/script-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.AUTO_POKE_PYTHON || (existsSync(bundled) ? bundled : 'python');
const reference = process.argv.includes('--reference');
const args = process.argv.slice(2).filter(value => value !== '--reference');
const checked = spawnSync(process.execPath, ['tools/snapshot-bdsp-automation.mjs', '--check'], { cwd: root, stdio: 'inherit' });
if (checked.status !== 0) process.exit(checked.status || 1);
const result = spawnSync(python, ['-m', 'pytest', '-q', 'tests/automation', ...args], {
  cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', BDSP_CONTRACT_REFERENCE: reference ? '1' : '0' },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
