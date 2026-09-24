const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const localPython = path.join(root, '.deps/script-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

test('[DEV-004] deterministic frame freshness, ordering and stopped-source contracts', { timeout: 10000 }, () => {
  const python = process.env.AUTO_POKE_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
  const result = spawnSync(python, ['-X', 'utf8', path.join(root, 'runtime/tests/test_frames.py')], {
    cwd: root, encoding: 'utf8', timeout: 8000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
