// Import canonical files from the original repository at an immutable revision.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const repository = 'https://github.com/Lincoln-LM/Project_Xs';
const revision = '5439cec701e96280981a1fa6664cd8d0e885d514';
const root = resolve('third_party/Project_Xs');
const files = ['LICENSE', 'README.md', 'src/calc.py', 'src/rngtool.py', 'src/xorshift.py', 'src/player_blink_gui.py'];
const hash = data => createHash('sha256').update(data).digest('hex');
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
  if (manifest.revision !== revision) throw Error('Unexpected Project_Xs revision');
  for (const file of files) if (hash(readFileSync(`${root}/${file}`)) !== manifest.hashes[file]) throw Error(`Modified upstream file: ${file}`);
  console.log('Project_Xs upstream hashes verified');
} else {
  const blobs = await Promise.all(files.map(async file => {
    const response = await fetch(`https://raw.githubusercontent.com/Lincoln-LM/Project_Xs/${revision}/${file}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`${file}: HTTP ${response.status}`);
    return [file, Buffer.from(await response.arrayBuffer())];
  }));
  const hashes = {};
  for (const [file, data] of blobs) {
    mkdirSync(dirname(`${root}/${file}`), { recursive: true });
    writeFileSync(`${root}/${file}`, data);
    hashes[file] = hash(data);
  }
  writeFileSync(`${root}/manifest.json`, JSON.stringify({ repository, revision, hashes }, null, 2) + '\n');
  console.log(`Imported ${files.length} original Project_Xs files at ${revision}`);
}
