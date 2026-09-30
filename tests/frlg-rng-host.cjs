const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const host = path.join(root, 'runtime', 'python', 'frlg_rng_host.py');
const bundledPython = path.join(root, '.deps', 'script-python', 'Scripts', 'python.exe');
const python = process.env.AUTO_POKE_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : 'python');

const request = {
  game: 'fr_nx',
  tid: 12345,
  sid: 54321,
  method: 'Static 1',
  category: 'Starter',
  location: '',
  pokemon: 'Bulbasaur',
  max_advances: 100,
  min_advances: 0,
  iv_min: [0, 0, 0, 0, 0, 0],
  iv_max: [31, 31, 31, 31, 31, 31],
  shiny: 'Any',
  nature: 'Any',
  gender: 'Any',
  ability: 'Any',
  hidden_type: 'Any',
  initial_seed_result_count: 1,
  max_iv_combinations: 25000000,
  seed_mode: null,
  direct_mode: true,
  direct_seed: '0000',
  direct_advances: 0,
  dunsparce_three_segment: false,
};

function runHost() {
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-poke-frlg-host-'));
  try {
    const env = { ...process.env };
    delete env.FRLG_AUTO_RNG_ROOT;
    const input = [
      { id: 1, method: 'validate', params: request },
      { id: 2, method: 'search', params: request },
      { command: 'shutdown' },
    ].map(value => JSON.stringify(value)).join('\n') + '\n';
    const result = spawnSync(python, ['-u', host], {
      cwd: workDirectory,
      env,
      input,
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.error, undefined, result.error?.message);
    return result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

test('FRLG planner validates and searches from the bundled runtime without a sibling project', () => {
  const messages = runHost();
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0].result, {
    valid: true,
    source: path.join(root, 'runtime', 'python', 'frlg_planner'),
  });
  assert.equal(messages[1].ok, true);
  assert.equal(messages[1].result.search_summary.matching_outcomes, 1);
  assert.equal(messages[1].result.initial_seed.seed, '0000');
});
