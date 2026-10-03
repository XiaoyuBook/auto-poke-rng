const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const output = process.env.AUTO_POKE_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'poke-reconnect-ui-'));
for (const phase of ['failure', 'restart', 'video']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'run-electron.cjs'), 'device-reconnect-electron.cjs'], {
    env: { ...process.env, AUTO_POKE_QA_OUTPUT: output, AUTO_POKE_QA_PHASE: phase },
    stdio: 'inherit', windowsHide: true, timeout: 65000,
  });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status || 1);
}
