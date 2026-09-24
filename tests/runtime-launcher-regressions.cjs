const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');

test('[DEV-006] runtime test launcher selects one Node executable when discovery returns two', {
  timeout: 10000, skip: process.platform !== 'win32',
}, t => {
  const log = path.join(os.tmpdir(), `auto-poke-launcher-${randomUUID()}.log`);
  t.after(() => { if (fs.existsSync(log)) fs.unlinkSync(log); });
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'fixtures/runtime-launcher.ps1'),
    '-Runner', path.join(root, 'tools/test-runtime.ps1'), '-LogPath', log], {
    cwd: root, encoding: 'utf8', timeout: 8000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split(/\r?\n/), ['ctest', 'node-first']);
});
