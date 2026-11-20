// Contract checks for the Tier 1 gate: published schemas are valid and generated contract types are current.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { metaSchemaProblems } from './contract-check-lib.mjs';
import { apiV0Schema, apiV1Schema } from '../packages/contract/src/api.ts';

const root = resolve(import.meta.dirname, '..');
const directory = join(root, 'docs/api/schemas');
const documents = new Map(readdirSync(directory).filter(name => name.endsWith('.json')).map(name => [name, JSON.parse(readFileSync(join(directory, name), 'utf8'))]));
const problems = [];

function refsIn(value, found = []) {
  if (Array.isArray(value)) value.forEach(item => refsIn(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') found.push(item);
      else refsIn(item, found);
    }
  }
  return found;
}

for (const [name, document] of documents) {
  if (typeof document.$schema !== 'string') problems.push(`${name}: missing $schema`);
  problems.push(...metaSchemaProblems(name, document));
  for (const reference of refsIn(document)) {
    const [file, pointer] = reference.includes('#') ? reference.split('#') : [reference, ''];
    const target = file ? documents.get(file) : document;
    const definition = pointer.replace(/^\/\$defs\//, '');
    if (!target) problems.push(`${name}: $ref to unknown file ${reference}`);
    else if (definition && !target.$defs?.[definition]) problems.push(`${name}: $ref to unknown definition ${reference}`);
  }
}

for (const [name, document] of [['contract api v0', apiV0Schema], ['contract api v1', apiV1Schema]]) problems.push(...metaSchemaProblems(name, document));

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const specs = spawnSync(process.execPath, ['--test', 'scripts/contract-check.test.mjs'], { cwd: root, stdio: 'inherit' });
if (specs.status !== 0) process.exit(specs.status ?? 1);
const fresh = spawnSync(process.execPath, ['packages/contract/src/generate-types.ts', '--check'], { cwd: root, stdio: 'inherit' });
process.exit(fresh.status ?? 1);
