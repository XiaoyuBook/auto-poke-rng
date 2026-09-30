// Import the pinned upstream generator and its resources. No runtime checkout dependency.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const revision = '5a5383ff226059cbf85f0b531c9de283f7b76c45';
const root = resolve('runtime/python/frlg_planner');
const manifestPath = resolve('runtime/python/frlg-runtime-manifest.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (hash(readFileSync(resolve(root, file))) !== expected) throw Error(`Modified upstream runtime: ${file}`);
  }
  console.log('FRLG generator resource fingerprints verified');
} else {
  const source = process.argv[2];
  if (!source) throw Error('Usage: node tools/vendor-frlg-runtime.mjs <reference-checkout>');
  const files = [
    'automation/easycon118.py', 'automation/precalibration.py',
    'automation/calibration_trust_gates.py', 'automation/seed_common_regions.py',
    'automation/starter_calibration.py', 'device_label_overrides.py',
  ];
  const assets = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision, 'assets/easycon118_extensions'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
  const hashes = {};
  for (const file of [...files, ...assets]) {
    const bytes = execFileSync('git', ['show', `${revision}:${file}`], { cwd: source, maxBuffer: 16 * 1024 * 1024 });
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    writeFileSync(resolve(root, file), bytes);
    hashes[file] = hash(bytes);
  }
  writeFileSync(manifestPath, JSON.stringify({ repository: 'https://github.com/axechaso/frlg-auto-rng', revision, files: hashes }, null, 2) + '\n');
}
