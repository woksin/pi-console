// Integration tier (`npm run gate:integration -- --scope daemon`): startup time with a realistic log, cold (full
// projection) and warm (projection snapshots). Prints the measurement recorded in docs/api/v1.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteEventLog } from '@pi-console/core';
import { scenario } from '@pi-console/core/testing';
import { call } from '@pi-console/testkit';
import { defaultConfig } from './config.ts';
import { startDaemon } from './daemon.ts';
import { loadToken } from './security/token.ts';

const events = Number(process.env.PI_CONSOLE_STARTUP_EVENTS ?? 100_000);

async function timedStart(directory: string): Promise<number> {
  const started = performance.now();
  const daemon = await startDaemon({ ...defaultConfig(directory), port: 0, sessionRoots: [], ingest: false });
  const reply = await call(daemon.port, '/api/v1/overview', { headers: { Authorization: `Bearer ${loadToken(directory)}` } });
  const elapsed = performance.now() - started;
  assert.equal(reply.status, 200);
  await daemon.close();
  return elapsed;
}

test(`startup with ${events} events answers the API quickly, cold and warm`, { timeout: 300_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-startup-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const log = new SqliteEventLog(join(directory, 'console.db'));
  const all = scenario({ count: events });
  for (let start = 0; start < all.length; start += 5_000) await log.append(all.slice(start, start + 5_000));
  log.close();
  const cold = await timedStart(directory);
  const warm = await timedStart(directory);
  console.log(`startup: ${events} events, cold ${cold.toFixed(0)} ms, warm ${warm.toFixed(0)} ms`);
  assert.ok(warm < 5_000, `warm start ${warm} ms`);
});
