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
const golbatPlan = require('./fixtures/frlg-golbat-plan.json');
const starterPlan = require('./fixtures/frlg-starter-plan.json');

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
    const env = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
    delete env.FRLG_AUTO_RNG_ROOT;
    const wildRequest = { ...request, method: 'Wild 1', category: 'Grass', location: 'Route 1', pokemon: 'Pidgey' };
    const concreteRequest = {
      ...request,
      tid: 0,
      sid: 38448,
      method: 'All Wild Methods',
      category: 'Grass',
      location: 'Cerulean Cave 1F',
      pokemon: 'Golbat',
      max_advances: 10000,
      iv_min: [28, 31, 31, 26, 25, 24],
      iv_max: [28, 31, 31, 26, 25, 24],
      shiny: 'Square',
      nature: 'Docile',
      gender: 'F',
      ability: 'Inner Focus',
      hidden_type: 'Water',
      direct_mode: false,
      direct_seed: null,
      direct_advances: null,
    };
    const input = [
      { id: 1, method: 'validate', params: request },
      { id: 2, method: 'search', params: request },
      { id: 3, method: 'validate', params: wildRequest },
      { id: 4, method: 'search', params: wildRequest },
      { id: 5, method: 'search', params: concreteRequest },
      { id: 6, method: 'search', params: golbatPlan.request },
      { id: 7, method: 'search', params: starterPlan.request },
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
  assert.equal(messages.length, 7);
  assert.deepEqual(messages[0].result, {
    valid: true,
    source: path.join(root, 'runtime', 'python', 'frlg_planner'),
  });
  assert.equal(messages[1].ok, true);
  assert.equal(messages[1].result.search_summary.matching_outcomes, 1);
  assert.equal(messages[1].result.initial_seed.seed, '0000');
  assert.deepEqual(messages[2].result.valid, true);
  assert.equal(messages[3].result.target.pokemon, 'Pidgey');
  assert.equal(messages[3].result.target.method, 'Wild 1');
  assert.equal(messages[4].ok, true);
  assert.deepEqual(messages[4].result.target, {
    target_seed: '1054FF81',
    method: 'Wild 4',
    pokemon: 'Golbat',
    level: 46,
    pid: '0C319A01',
    shiny: 'Square',
    nature: 'Docile',
    ability: 'Inner Focus',
    ivs: { hp: 28, attack: 31, defense: 31, sp_attack: 26, sp_defense: 25, speed: 24 },
    hidden_type: 'Water',
    hidden_power: 43,
    gender: 'F',
  });
  assert.equal(messages[4].result.initial_seed.seed, 'BFBD');
  assert.equal(messages[4].result.initial_seed.advances, 212);
  assert.deepEqual(messages[4].result.search_summary, { matching_outcomes: 1, reachable_outcomes: 1, feasible_routes: 1 });
  assert.equal(messages[5].ok, true);
  assert.deepEqual(messages[5].result, golbatPlan, 'real filter search matches the original planner fixture used by the UI');
  assert.equal(messages[6].ok, true);
  assert.deepEqual(messages[6].result, starterPlan, 'static filter search matches the original without assuming a computed level');
});
