const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RuntimeClient } = require('../electron/runtime-client.cjs');
const client = new RuntimeClient({ role: 'rng' });
after(() => client.close());
// Preserve all 64 seed bits: JSON.parse numbers would silently round these values.
const text = fs.readFileSync(path.join(__dirname, '../third_party/PokeFinder/Test/Gen8/static8.json'), 'utf8');
const fixtures = JSON.parse(text.replace(/("seed[01]"\s*:\s*)(\d+)/g, '$1"$2"'));
const data = require('../src/generated/bdsp-data.json');
const hex = n => n.toString(16).toUpperCase().padStart(8, '0');
const request = (overrides = {}) => ({ seed0: BigInt(fixtures.generate[0].seed0).toString(16), seed1: BigInt(fixtures.generate[0].seed1).toString(16), initialAdvances: 0, maxAdvances: 9, offset: 0, lead: 255, target: 'Turtwig', profile: { version: 'BD', tid: 12345, sid: 54321 }, filter: {}, ...overrides });
const run = args => client.call('static.generate', request(args), 30000);

for (const fixture of [...fixtures.generate, ...fixtures.generateRoamer]) {
  test(`unmodified upstream fixture: ${fixture.name}`, async () => {
    const target = data.targets.find(t => t.speciesKey === fixture.name);
    const actual = await run({ seed0: BigInt(fixture.seed0).toString(16), seed1: BigInt(fixture.seed1).toString(16), target: target.speciesKey, lead: { None: 255, CuteCharmF: 25, Synchronize: 0 }[fixture.lead ?? 'None'], profile: { version: target.version === 'SP' ? 'SP' : 'BD', tid: 12345, sid: 54321 } });
    assert.deepEqual(actual, fixture.results.map(row => ({ ...row, ec: hex(row.ec), pid: hex(row.pid) })));
  });
}
test('upper seed bits, initial advances, offset, and inclusive maximum reach Core unchanged', async () => {
  const rows = await run({ maxAdvances: 20 });
  assert.deepEqual(await run({ initialAdvances: 9, maxAdvances: 0 }), [rows[9]]);
  assert.deepEqual(await run({ offset: 9, maxAdvances: 0 }), [{ ...rows[9], advances: 0 }]);
  assert.notDeepEqual(await run({ seed0: request().seed0.slice(-8) }), rows.slice(0, 10));
});
test('sync all 25 natures, both Cute Charm leads and hidden abilities use native fields', async () => {
  for (let lead = 0; lead < 25; lead++) assert.ok((await run({ lead })).every(row => row.nature === lead));
  const female = await run({ target: 'Heatran', lead: 25, maxAdvances: 99 });
  const male = await run({ target: 'Heatran', lead: 26, maxAdvances: 99 });
  assert.notDeepEqual(female.map(r => r.gender), male.map(r => r.gender));
  assert.ok((await run({ target: 'Regirock' })).every(r => r.ability === 2 && r.abilityIndex === 5));
});
test('trainer IDs correct PID, preserve forced shiny type, and all filters match native result fields', async () => {
  const first = (await run({ maxAdvances: 0 }))[0];
  const pid = parseInt(first.pid, 16);
  const tid = (pid >>> 16) ^ (pid & 0xffff);
  const profile = { version: 'BD', tid, sid: 0 };
  const corrected = (await run({ maxAdvances: 0, profile }))[0];
  assert.equal(corrected.shiny, 0);
  assert.equal(corrected.pid, hex((pid ^ 0x10000000) >>> 0));
  const star = (await run({ initialAdvances: 810, maxAdvances: 0, profile }))[0];
  assert.equal(star.shiny, 1);
  const starPid = parseInt(star.pid, 16);
  assert.equal((starPid >>> 16) ^ (starPid & 0xffff) ^ tid, 1);
  assert.deepEqual(await run({ initialAdvances: 810, maxAdvances: 0, filter: { shiny: 0 } }), []);
  assert.equal((await run({ initialAdvances: 810, maxAdvances: 0, filter: { shiny: 1 } })).length, 1);
  assert.equal((await run({ target: 'Darkrai', initialAdvances: 810, maxAdvances: 0, filter: { shiny: 2 } }))[0].shiny, 2);
  assert.deepEqual(await run({ maxAdvances: 0, filter: { heightMax: 0, weightMax: 0 } }), []);
  const exact = { ability: first.ability, gender: first.gender, heightMin: first.height, heightMax: first.height, weightMin: first.weight, weightMax: first.weight, ivMin: first.ivs, ivMax: first.ivs, natures: Array.from({ length: 25 }, (_, i) => i === first.nature) };
  assert.deepEqual(await run({ maxAdvances: 0, filter: exact }), [first]);
  assert.deepEqual(await run({ maxAdvances: 0, filter: { skip: true, heightMax: 0, weightMax: 0, shiny: 2, ivMax: [0,0,0,0,0,0] } }), [first]);
});
test('invalid seeds, version-exclusive targets and reversed ranges fail rather than fabricate data', async () => {
  for (const args of [{ seed0: '0', seed1: '0' }, { seed0: 'FFFFFFFFFFFFFFFFF' }, { seed1: 'xyz' }, { target: 'Palkia' }, { profile: { version: 'BD', tid: 65536, sid: 0 } }, { filter: { heightMin: 10, heightMax: 0 } }, { filter: { ivMin: [31,0,0,0,0,0], ivMax: [0,31,31,31,31,31] } }]) await assert.rejects(run(args));
  assert.equal((await run({ seed0: 'FFFFFFFFFFFFFFFF', seed1: '0', maxAdvances: 0 })).length, 1);
});
