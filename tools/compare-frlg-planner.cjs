// Read-only comparison against an explicit reference checkout; never used by the app.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { pythonPath } = require('../electron/frlg-rng-client.cjs');
const fixture = require('../tests/fixtures/frlg-golbat-plan.json');

const reference = process.argv[2];
if (!reference || reference.startsWith('--')) throw Error('Usage: node tools/compare-frlg-planner.cjs <reference-checkout> [--legacy-range]');
function search(label, sourceRoot, params) {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
  delete env.FRLG_AUTO_RNG_ROOT;
  if (sourceRoot) env.FRLG_AUTO_RNG_ROOT = path.resolve(sourceRoot);
  const start = performance.now();
  const run = spawnSync(pythonPath(), ['-u', path.resolve(__dirname, '../runtime/python/frlg_rng_host.py')], {
    env, input: JSON.stringify({ id: 1, method: 'search', params }) + '\n', encoding: 'utf8', windowsHide: true, timeout: 180000,
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  const response = JSON.parse(run.stdout);
  assert.equal(response.ok, true, response.error?.message);
  const result = response.result;
  console.log(JSON.stringify({ label, seconds: (performance.now() - start) / 1000, seed: result.initial_seed.seed, advances: result.initial_seed.advances, ivTotal: result.selection.iv_total }));
  return result;
}
for (const [name, expected] of [['wild', fixture], ['static', require('../tests/fixtures/frlg-starter-plan.json')]]) {
  const bundled = search(`${name}:bundled`, null, expected.request);
  const original = search(`${name}:reference`, reference, expected.request);
  assert.deepEqual(bundled, original, 'bundled and reference results must match field for field');
  assert.deepEqual(original, expected, 'fixture must be the original serialized result');
}
console.log('PASS: full serialized result matches the original and the UI fixture.');
if (process.argv.includes('--legacy-range')) search('legacy-range', null, { ...fixture.request, min_advances: 0, max_advances: 10000 });
