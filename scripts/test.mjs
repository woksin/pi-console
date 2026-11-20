// Unit specs: every package `test` script (integration specs are named *.integration.ts and never match), then the
// spike specs that still pass. Usage: node scripts/test.mjs [--scope <package>]
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const scopeIndex = process.argv.indexOf('--scope');
const scope = scopeIndex >= 0 ? process.argv[scopeIndex + 1] : undefined;
const run = (command, args) => spawnSync(command, args, { cwd: root, stdio: 'inherit' }).status ?? 1;

const packages = scope ? ['-w', `@pi-console/${scope}`] : ['--workspaces'];
let status = run('npm', ['run', 'test', ...packages, '--if-present']);
if (status === 0 && !scope) {
  status = run(process.execPath, ['--test', 'spikes/fixture/*.test.ts', 'spikes/mock-daemon/*.test.ts']);
}
process.exit(status);
