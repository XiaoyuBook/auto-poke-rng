// Freeze the reference before porting. Never reads a developer's dirty files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const revision = '494793ed467cd1a2ef376d5886d0add5924b620f';
const root = resolve('third_party/bdsp-automation-reference');
const hash = value => createHash('sha256').update(value).digest('hex');
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
  if (manifest.revision !== revision) throw Error('BDSP reference revision changed');
  for (const [file, expected] of Object.entries(manifest.hashes)) {
    if (hash(readFileSync(resolve(root, file))) !== expected) throw Error(`Reference modified: ${file}`);
  }
  console.log(`BDSP reference verified: ${Object.keys(manifest.hashes).length} files`);
} else {
  const repository = resolve(process.argv[2] || '../auto-bdsp-rng');
  const show = file => execFileSync('git', ['-C', repository, 'show', `${revision}:${file}`], { maxBuffer: 16 * 1024 * 1024 });
  const tree = execFileSync('git', ['-C', repository, 'ls-tree', '-r', '-z', '--name-only', revision], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const modules = [
    'rng_core/__init__.py', 'rng_core/seed.py', 'rng_core/generators.py',
    'gen8_static/models.py', 'gen8_id/__init__.py', 'gen8_id/models.py', 'gen8_id/generator.py',
    'automation/auto_tid_rng.py', 'automation/easycon/models.py', 'automation/easycon/scripts.py',
    'automation/auto_rng/__init__.py', 'automation/auto_rng/models.py', 'automation/auto_rng/runner.py',
    'automation/auto_rng/scripts.py', 'automation/auto_rng/delay_strategy.py', 'automation/auto_rng/delay_profiles.py',
    'automation/auto_rng/ocr_regions.py', 'automation/auto_rng/ocr_runtime.py', 'automation/auto_rng/pokemon_info_ocr.py',
    'automation/auto_rng/dialog_timing.py', 'automation/auto_rng/zoom_recovery.py',
    'blink_detection/models.py', 'blink_detection/project_xs.py', 'resources.py',
  ];
  const testNames = ['auto_rng_runner', 'auto_tid_rng', 'auto_rng_scripts', 'delay_strategy', 'delay_profiles', 'dialog_timing', 'zoom_recovery', 'ocr_regions', 'pokemon_info_ocr'];
  const files = ['LICENSE.txt', ...modules.map(file => `src/auto_bdsp_rng/${file}`),
    ...testNames.map(name => `tests/automation/test_${name}.py`), 'tests/gen8_id/test_id_generator.py',
    ...tree.filter(file => file.startsWith('script/'))];
  const hashes = {};
  for (const file of files) {
    const content = show(file);
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    writeFileSync(resolve(root, file), content); hashes[file] = hash(content);
    if (file.startsWith('tests/')) {
      // Only fixture locations change. Assertions and scenarios stay verbatim.
      const adapted = content.toString('utf8')
        .replaceAll('Path(__file__).resolve().parents[2] / "script"', 'Path(__file__).resolve().parents[2] / "third_party/bdsp-automation-reference/script"')
        .replaceAll('third_party/Project_Xs_CHN/src/xorshift.py', 'third_party/Project_Xs/src/xorshift.py')
        .replaceAll('third_party/PokeFinder/Test/Gen8/id8.json', 'third_party/bdsp-automation-reference/fixtures/id8.json');
      const target = resolve('tests/automation', file.split('/').at(-1));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, adapted);
    }
  }
  const pokefinderRevision = '2d5c6afed9240f2bdb98634b5b8b1fab352aefa5';
  const ids = execFileSync('git', ['-C', resolve(repository, 'third_party/PokeFinder'), 'show', `${pokefinderRevision}:Test/Gen8/id8.json`]);
  mkdirSync(`${root}/fixtures`, { recursive: true });
  writeFileSync(`${root}/fixtures/id8.json`, ids); hashes['fixtures/id8.json'] = hash(ids);
  // Empty namespace packages avoid loading the legacy GUI / static generator.
  // These are harness files, deliberately not presented as upstream originals.
  for (const folder of ['', 'automation', 'automation/easycon', 'gen8_static', 'blink_detection']) {
    const file = `src/auto_bdsp_rng/${folder ? folder + '/' : ''}__init__.py`;
    if (!hashes[file]) writeFileSync(resolve(root, file), '# Reference harness namespace; no GUI imports.\n');
  }
  writeFileSync(`${root}/manifest.json`, JSON.stringify({ repository: 'https://github.com/XiaoyuBook/auto-bdsp-rng', revision, pokefinderRevision, hashes }, null, 2) + '\n');
  console.log(`Frozen ${files.length} reference files at ${revision}`);
}
