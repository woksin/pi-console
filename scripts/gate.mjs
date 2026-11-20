// The Tier 1 gate: `npm run gate`. Fail-fast stages, each named in the output, with timings.
// `--scope <package>` narrows typecheck, lint, tests and build to one package for iteration only; a scoped run is
// not a gate result. Integration checks are separate: `npm run gate:integration`.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const scopeIndex = args.indexOf('--scope');
const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
if (scopeIndex >= 0 && (!scope || !existsSync(resolve(root, 'packages', scope)))) {
  console.error(`Unknown --scope ${scope ?? '(missing)'}; expected a directory under packages/`);
  process.exit(2);
}

const node = process.execPath;
const bin = name => resolve(root, 'node_modules/.bin', name);
const packageScripts = name => {
  const file = resolve(root, 'packages', name, 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).scripts ?? {} : {};
};
const optionalPackageStage = (script, packages) => () => {
  const names = (scope ? [scope] : packages).filter(name => packageScripts(name)[script]);
  if (names.length === 0) return { skipped: `no package defines "${script}" yet` };
  for (const name of names) {
    const status = run('npm', ['run', script, '-w', `@pi-console/${name}`]);
    if (status !== 0) return { status };
  }
  return { status: 0 };
};

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' }).status ?? 1;
}

const stages = [
  ['typecheck (tsc -b)', () => ({ status: run(bin('tsc'), ['-b', ...(scope ? [`packages/${scope}`] : [])]) })],
  ['lint (eslint)', () => ({ status: run(bin('eslint'), [scope ? `packages/${scope}` : '.']) })],
  ['unit specs (packages + passing spikes)', () => ({ status: run(node, ['scripts/test.mjs', ...(scope ? ['--scope', scope] : [])]) })],
  ['spike checks (syntax, JSON, whitespace)', () => (scope ? { skipped: 'scoped run' } : { status: run(node, ['spikes/mock-daemon/check.ts']) })],
  ['web build and proxy freshness', optionalPackageStage('build:check', ['web'])],
  ['tui build', optionalPackageStage('build:check', ['tui'])],
  ['docs (links, ADR headers, markers)', () => (scope ? { skipped: 'scoped run' } : { status: run(node, ['scripts/docs-check.mjs']) })],
  ['secret sweep', () => (scope ? { skipped: 'scoped run' } : { status: run(node, ['scripts/secret-sweep.mjs']) })],
  ['contract (schemas, generated types)', () => (scope ? { skipped: 'scoped run' } : { status: run(node, ['scripts/contract-check.mjs']) })],
];

const timings = [];
let failed = null;
const started = performance.now();
for (const [name, stage] of stages) {
  console.log(`\n=== gate stage: ${name}`);
  const begin = performance.now();
  const result = stage();
  const seconds = ((performance.now() - begin) / 1000).toFixed(1);
  if (result.skipped) {
    timings.push(`SKIP  ${name} (${result.skipped})`);
    continue;
  }
  timings.push(`${result.status === 0 ? 'PASS' : 'FAIL'}  ${name}  ${seconds}s`);
  if (result.status !== 0) {
    failed = name;
    break;
  }
}

console.log('\n=== gate summary');
for (const line of timings) console.log(line);
console.log(`total ${((performance.now() - started) / 1000).toFixed(1)}s${scope ? ` (scoped to ${scope}: not a gate result)` : ''}`);
if (failed) {
  console.error(`GATE FAILED at stage: ${failed}`);
  process.exit(1);
}
console.log('GATE PASSED');
