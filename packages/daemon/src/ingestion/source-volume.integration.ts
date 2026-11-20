// Integration tier (`npm run gate:integration -- --scope daemon`): every non-session source over a large, `cp`-shaped
// tree (all mtimes fresh, in-record timestamps spanning 40 days). The daemon must answer /health throughout the
// backfill, keep memory flat and bound what it stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventEnvelope } from '@pi-console/contract';
import { buildLargeTree, call } from '@pi-console/testkit';
import { loadConfig } from '../config.ts';
import { startDaemon, type RunningDaemon } from '../daemon.ts';
import { loadToken } from '../security/token.ts';

const mebibyte = 1024 * 1024;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function allEvents(daemon: RunningDaemon): Promise<EventEnvelope[]> {
  const found: EventEnvelope[] = [];
  for await (const event of daemon.log.readFrom(0)) found.push(event);
  return found;
}

test('a large tree backfills in the background: /health stays fast, memory flat, nothing out of scope is stored', { timeout: 600_000 }, async t => {
  const base = mkdtempSync(join(tmpdir(), 'pi-console-volume-'));
  t.after(() => { rmSync(base, { recursive: true, force: true }); });
  const tree = buildLargeTree(join(base, 'agent'), { ledgerRows: 50_000, statusFiles: 20_000, registryRows: 54_000, questionFiles: 1_500, eventRows: 200_000 });
  const dataDir = join(base, 'data');
  const config = loadConfig(dataDir, { port: 0, agentRoot: tree.root, orchRoot: tree.orchRoot, sessionRoots: [], pollMs: 1_000, sourcePollMs: 250 });
  const baseline = process.memoryUsage().rss;
  const started = performance.now();
  const daemon = await startDaemon(config);
  t.after(async () => { await daemon.close().catch(() => undefined); });
  const headers = { Authorization: `Bearer ${loadToken(dataDir)}` };
  let firstOk: number | undefined;
  let worst = 0;
  let complete = false;
  while (!complete && performance.now() - started < 540_000) {
    const sent = performance.now();
    const reply = await call(daemon.port, '/api/v1/health', { headers });
    const elapsed = performance.now() - sent;
    if (reply.status === 200) firstOk ??= performance.now() - started;
    worst = Math.max(worst, elapsed);
    complete = (reply.body as { backfill: { complete: boolean } }).backfill.complete;
    await wait(50);
  }
  const grown = process.memoryUsage().rss - baseline;
  console.log(`volume: first 200 ${firstOk?.toFixed(0)} ms, worst /health ${worst.toFixed(0)} ms, backfill ${((performance.now() - started) / 1000).toFixed(1)} s, rss growth ${(grown / mebibyte).toFixed(0)} MiB`);
  assert.ok(complete, 'backfill finished');
  assert.ok((firstOk ?? Infinity) < 3_000, `first 200 after ${firstOk} ms`);
  assert.ok(worst < 200, `worst /health ${worst} ms`);
  assert.ok(grown < 150 * mebibyte, `rss grew ${grown / mebibyte} MiB`);
  const events = await allEvents(daemon);
  const warnings = events.filter(event => event.type === 'SourceSchemaUnknown');
  assert.deepEqual(warnings.map(event => event.payload), [], 'status and turns files raise nothing');
  const checkpoints = new Set<string>();
  for (const source of ['context-budget', 'issue-work', 'phase-ledger', 'question-store']) for (const checkpoint of await daemon.log.checkpoints(source)) checkpoints.add(checkpoint.path);
  assert.ok(checkpoints.size <= 1_500 + 2 + 1 + 16 + 1, `${checkpoints.size} checkpoints`);
  await daemon.close();
  const second = await startDaemon(config);
  t.after(async () => { await second.close().catch(() => undefined); });
  for (let i = 0; i < 2_000 && !second.sources.backfillComplete; i++) await wait(100);
  assert.equal((await allEvents(second)).length, events.length, 'a second start appends nothing');
});
