const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pythonPath } = require('../electron/frlg-rng-client.cjs');
const { existsSync } = require('node:fs');
test('FRLG confirmed shiny observations survive compact logging without pre-calibration', () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, 'frlg-log-policy.py')], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
});
test('shared native interpreter supports the FRLG OCR and calibration contracts', () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, 'frlg-native-compat.py')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

const corpus = process.env.FRLG_SCRIPT_CORPUS || path.resolve(__dirname, '../../auto-poke-rng-scripts/bundles/frlg-automation/files');

test('application-authored refinement handles low levels, budgets and single encounter evidence', {
  skip: existsSync(corpus) ? false : 'Set FRLG_SCRIPT_CORPUS to generate the audited ECS probes',
}, () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, 'frlg-adaptive-refinement.py')], {
    env: { ...process.env, FRLG_SCRIPT_CORPUS: corpus }, encoding: 'utf8', windowsHide: true, timeout: 180000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
});

test('FRLG target shiny persists execution corrections without requiring capture or reverse', () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, 'frlg-precalibration.py')], {
    env: { ...process.env, FRLG_SCRIPT_CORPUS: corpus }, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
});

test('FRLG OCR preserves reference scores and verifies encounter-scoped sprite alternatives', {
  skip: existsSync(corpus) ? false : 'Set FRLG_SCRIPT_CORPUS to the audited script bundle',
}, () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, 'frlg-ocr-names.py')], {
    env: { ...process.env, FRLG_SCRIPT_CORPUS: corpus }, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
});
test('FRLG generated reverse scans execute in Python and preserve ECS results', {
  skip: existsSync(corpus) ? false : 'Set FRLG_SCRIPT_CORPUS to the audited script bundle to run differential tests',
}, () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, 'frlg-main-reverse-migration.py')], {
    env: { ...process.env, FRLG_SCRIPT_CORPUS: corpus },
    encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
});
