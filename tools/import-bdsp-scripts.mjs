// Mechanical extension adaptation of the frozen, user-visible workflow scripts.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
const source=resolve('third_party/bdsp-automation-reference/script');
const target=resolve('scripts/BDSP');
function visit(folder=''){
  for(const item of readdirSync(join(source,folder),{withFileTypes:true})){
    const relative=join(folder,item.name);
    if(item.isDirectory()){visit(relative);continue;}
    const output=join(target,relative.replace(/\.txt$/i,'.rng'));
    if(existsSync(output))throw Error(`Refusing to replace user script: ${output}`);
    mkdirSync(dirname(output),{recursive:true});writeFileSync(output,readFileSync(join(source,relative)));
  }
}
visit();
