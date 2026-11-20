// Secret sweep stage of the Tier 1 gate: runs the testkit secret-shape fixtures through the redactor.
// P0 ships the stage as a no-op stub. P2 (adapters) switches it on by adding a `secret-sweep` script to
// packages/adapters/package.json; from then on this stage runs it and a missing script becomes a failure.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const adapters = JSON.parse(readFileSync(resolve(root, 'packages/adapters/package.json'), 'utf8'));
if (!adapters.scripts?.['secret-sweep']) {
  console.log('secret sweep: not enabled yet (P2 adds the "secret-sweep" script to packages/adapters)');
  process.exit(0);
}
const result = spawnSync('npm', ['run', 'secret-sweep', '-w', '@pi-console/adapters'], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
