// Initial mechanical import only. Review future changes in runtime/python normally.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
const source = resolve('third_party/bdsp-automation-reference/src/auto_bdsp_rng');
const destination = resolve('runtime/python/auto_bdsp_rng');
function visit(folder = '') {
  for (const entry of readdirSync(join(source, folder), { withFileTypes: true })) {
    const relative = join(folder, entry.name);
    if (entry.isDirectory()) { visit(relative); continue; }
    if (!entry.name.endsWith('.py')) continue;
    const target = join(destination, relative);
    if (existsSync(target)) throw Error(`Refusing to overwrite adapted source: ${target}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(source, relative)));
  }
}
visit();
console.log('Imported the frozen business core into the existing Python runtime.');
