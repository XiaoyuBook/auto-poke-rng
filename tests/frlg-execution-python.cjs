const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pythonPath } = require('../electron/frlg-rng-client.cjs');
test('shared native interpreter supports the FRLG OCR and calibration contracts', () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, 'frlg-native-compat.py')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
