// Integration tier: `npm run gate:integration [-- --scope <package>]`. Not part of the Tier 1 gate.
// Integration specs are files named *.integration.ts inside a package's src/. Packages with none are skipped.
// Later packages add their own heavier checks (web e2e, Linux-container OpenTUI, real-week probe).
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const scopeIndex = args.indexOf('--scope');
const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
const packagesDirectory = join(root, 'packages');

const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

let status = 0;
let ran = 0;
for (const name of readdirSync(packagesDirectory)) {
  if (scope && name !== scope) continue;
  const source = join(packagesDirectory, name, 'src');
  const specs = existsSync(source) ? walk(source).filter(file => file.endsWith('.integration.ts')) : [];
  if (specs.length === 0) continue;
  ran += specs.length;
  console.log(`\n=== integration: ${name} (${specs.length} spec files)`);
  const result = spawnSync(process.execPath, ['--experimental-ffi', '--disable-warning=ExperimentalWarning', '--test', ...specs], { cwd: root, stdio: 'inherit' });
  status ||= result.status ?? 1;
}
if (ran === 0) console.log('No integration specs yet.');
process.exit(status);
