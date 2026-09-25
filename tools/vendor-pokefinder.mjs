// Import an audited upstream checkout without modifying its files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const revision = '2d5c6afed9240f2bdb98634b5b8b1fab352aefa5';
const encounterRevision = '7769c1df80be93761fe6479d51cbf2fe7a7dc4f9';
const encounterPrefix = 'Core/Resources/EncounterTables/';
const source = resolve(process.argv[2] || '');
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision) throw Error('Unexpected PokeFinder revision');
const destination = resolve('third_party/PokeFinder');
const sources = [
  'Core/Gen8/Generators/StaticGenerator8.cpp', 'Core/Gen8/Profile8.cpp',
  'Core/Parents/Profile.cpp', 'Core/Parents/States/State.cpp', 'Core/Parents/Filters/StateFilter.cpp',
  'Core/RNG/Xorshift.cpp', 'Core/RNG/Xoroshiro.cpp', 'Core/Util/Nature.cpp',
  'Core/Util/IVChecker.cpp',
];
const files = new Set();
if (!execFileSync('git', ['-C', source, 'ls-tree', revision, encounterPrefix.slice(0, -1)], { encoding: 'utf8' }).includes(encounterRevision)) throw Error('Unexpected encounter submodule revision');
const blob = file => execFileSync('git', ['-C', file.startsWith(encounterPrefix) ? join(source, encounterPrefix) : source, 'show',
  file.startsWith(encounterPrefix) ? `${encounterRevision}:${file.slice(encounterPrefix.length)}` : `${revision}:${file}`], { maxBuffer: 10 * 1024 * 1024 });
function include(file) {
  file = file.replaceAll('\\', '/');
  if (files.has(file)) return;
  const content = blob(file).toString('utf8');
  files.add(file);
  for (const match of content.matchAll(/^#include [<"]([^>"]+)[>"]/gm)) {
    const dependency = match[1];
    if (dependency.startsWith('Core/')) include(dependency);
    else if (match[0].includes('"')) include(join(dirname(file), dependency));
  }
}
sources.forEach(include);
for (const file of ['LICENSE', 'Core/Resources/Personal/Gen8/personal_bdsp.bin',
  'Core/Resources/EncounterTables/Gen8/encounters.json', 'Test/Gen8/static8.json', 'Test/Gen8/StaticGenerator8Test.cpp',
  'Test/Util/ivchecker.json', 'Test/Util/IVCheckerTest.cpp',
  ...['species', 'natures', 'characteristic', 'abilities', 'forms', 'powers'].map(name => `Core/Resources/i18n/zh/${name}_zh.txt`)]) files.add(file);
const hashes = {};
const blobs = [...files].sort().map(file => [file, blob(file)]);
for (const [file, bytes] of blobs) {
  const target = join(destination, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
}
writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ repository: 'https://github.com/Admiral-Fish/PokeFinder', revision, version: '4.3.2',
  encounterTables: { repository: 'https://github.com/Admiral-Fish/EncounterTableGenerator', revision: encounterRevision }, sources, hashes }, null, 2) + '\n');
console.log(`Imported ${files.size} unchanged upstream files at ${revision}`);
