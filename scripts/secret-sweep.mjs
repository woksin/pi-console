// Secret sweep stage of the Tier 1 gate: runs the testkit secret-shape fixtures through the redactor.
// Explicitly activated by secretSweepActive in gate.mjs; this runner never silently falls back to a stub.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const adapters = JSON.parse(readFileSync(resolve(root, 'packages/adapters/package.json'), 'utf8'));
if (!adapters.scripts?.['secret-sweep']) {
  console.error('secret sweep: activated but packages/adapters is missing its "secret-sweep" script');
  process.exit(1);
}
const result = spawnSync('npm', ['run', 'secret-sweep', '-w', '@pi-console/adapters'], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
