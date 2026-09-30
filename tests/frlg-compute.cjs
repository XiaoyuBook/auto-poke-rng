const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pythonPath } = require('../electron/frlg-rng-client.cjs');

test('FRLG shared computations preserve the original corpus and bounded work', () => {
  const run = spawnSync(pythonPath(), [path.join(__dirname, 'frlg-compute-regressions.py')], {
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message || run.stdout);
});
