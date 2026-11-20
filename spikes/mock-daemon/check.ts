import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
// spikes/arc-ts has its own tsconfigs and uses decorators and Arc-generated proxies (@generated, parameter properties), which strip-only TypeScript rejects; its own build and test cover it.
const ownToolchain = /[\\/]spikes[\\/]arc-ts[\\/].*\.ts$/;
const sources = files('spikes').filter(path => /\.(ts|json|jsonl)$/.test(path) && !ownToolchain.test(path));
const contracts = files('docs/api').filter(path => /\.(json|md)$/.test(path));
for (const path of [...sources, ...contracts, 'package.json', 'tsconfig.base.json', '.gitignore', '.nvmrc']) {
  const text = readFileSync(path, 'utf8');
  if (!text.endsWith('\n') || /[\t ]+$/m.test(text) || text.includes('\r')) throw new Error(`Whitespace check failed: ${path}`);
  if (path.endsWith('.json')) JSON.parse(text);
  if (path.endsWith('.jsonl')) text.trim().split('\n').forEach(line => JSON.parse(line));
  if (path.endsWith('.ts')) {
    const input = stripTypeScriptTypes(text, { mode: 'strip' });
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input, stdio: ['pipe', 'inherit', 'inherit'] });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log('PASS: all spike TypeScript syntax, API JSON, and whitespace checks (no build step or compiler dependencies).');
