// Update the bundled browsing snapshot from a validated, published repository catalog.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateCatalog } = require('../electron/script-repository.cjs');
if (!process.argv[2]) throw Error('请指定脚本仓库 catalog.json 的路径。');
const catalog = validateCatalog(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const directory = new URL('../resources/', import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(new URL('script-catalog.json', directory), JSON.stringify(catalog, null, 2) + '\n');
console.log(`已更新 ${catalog.packages.length} 个脚本包的内置目录。`);
