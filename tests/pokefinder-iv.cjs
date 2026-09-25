const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeClient } = require('../electron/runtime-client.cjs');
const fixtures = require('../third_party/PokeFinder/Test/Util/ivchecker.json').calculateIVRange;
const client = new RuntimeClient({ role: 'rng' });
after(() => client.close());
const request = fixture => ({ species: fixture.specie, form: fixture.form, nature: fixture.nature, characteristic: fixture.characteristic, hiddenPower: fixture.hiddenPower, entries: fixture.stats.map((stats, i) => ({ stats, level: fixture.levels[i] })) });
const run = args => client.call('iv.calculate', args);

// Shaymin's two forms have identical personal stats in HGSS and BDSP. Do not
// reuse the old Alakazam fixture: its Sp. Def changed before BDSP.
for (const fixture of fixtures.filter(row => row.version === 'BDSP' || row.specie === 492)) {
  test(`native IVChecker upstream fixture: ${fixture.name}`, async () => {
    const result = await run(request(fixture));
    assert.equal(result.possible, true);
    assert.deepEqual(result.ivs, fixture.results);
    assert.ok(result.nextLevels.every(level => level === null || level > Math.max(...fixture.levels)));
    assert.deepEqual(await run({ ...request(fixture), entries: request(fixture).entries.reverse() }), result, 'measurement order cannot change suggested levels');
  });
}
test('multiple observations narrow ranges; unknown options and distinct form base stats reach Core', async () => {
  const fixture = request(fixtures[0]);
  const first = await run({ ...fixture, characteristic: 255, hiddenPower: 255, entries: fixture.entries.slice(0, 1) });
  const all = await run({ ...fixture, characteristic: 255, hiddenPower: 255 });
  assert.ok(all.ivs.every((values, i) => values.every(iv => first.ivs[i].includes(iv))));
  assert.ok(all.ivs.some((values, i) => values.length < first.ivs[i].length));
  const unknown = await run({ ...fixture, nature: 255, characteristic: 255, hiddenPower: 255 });
  assert.ok(all.ivs.every((values, i) => values.every(iv => unknown.ivs[i].includes(iv))));
  assert.deepEqual(first.baseStats, [100,100,100,100,100,100]);
  assert.deepEqual((await run(request(fixtures[1]))).baseStats, [100,103,75,120,75,127]);
});
test('impossible stats yield no candidates or misleading suggested levels', async () => {
  const fixture = request(fixtures[3]);
  const result = await run({ ...fixture, entries: [{ level: 5, stats: [9999,9,11,22,16,18] }] });
  assert.equal(result.possible, false);
  assert.deepEqual(result.ivs, [[],[],[],[],[],[]]);
  assert.deepEqual(result.nextLevels, [null,null,null,null,null,null]);
});
test('Shedinja fixed HP does not constrain its HP IV or suggest a useless HP measurement', async () => {
  const args = { species: 292, nature: 0, entries: [{ level: 50, stats: [1,110,65,50,50,60] }] };
  const result = await run(args);
  assert.equal(result.possible, true);
  assert.deepEqual(result.ivs, [Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 5 }, () => [30,31])]);
  assert.equal(result.nextLevels[0], null);
  assert.deepEqual((await run({ ...args, characteristic: 1 })).ivs[0], [31]);
  assert.deepEqual((await run({ ...args, hiddenPower: 0 })).ivs.slice(3), [[30],[30],[30]]);
  assert.equal((await run({ ...args, entries: [{ level: 50, stats: [2,110,65,50,50,60] }] })).possible, false);
});
test('invalid species, forms, optional enums, levels and stats fail before Core', async () => {
  const args = request(fixtures[3]);
  for (const patch of [
    { species: 0 }, { species: 494 }, { form: 2 }, { nature: 25 }, { characteristic: 30 }, { hiddenPower: 16 },
    { entries: [] }, { entries: Array(101).fill(args.entries[0]) },
    { entries: [{ level: 0, stats: args.entries[0].stats }] }, { entries: [{ level: 101, stats: args.entries[0].stats }] },
    { entries: [{ level: 5, stats: [1,2] }] }, { entries: [{ level: 5, stats: [0,9,11,22,16,18] }] },
    { entries: [{ level: 5, stats: [22.1,9,11,22,16,18] }] }, { entries: [{ level: 5, stats: [10000,9,11,22,16,18] }] },
  ]) await assert.rejects(run({ ...args, ...patch }));
});
