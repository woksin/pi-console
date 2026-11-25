// Integration tier (`npm run gate:integration -- --scope daemon`): session and non-session sources over a large, `cp`-shaped
// tree (all mtimes fresh, in-record timestamps spanning 40 days). The daemon must answer /health throughout the
// backfill, keep memory flat and bound what it stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { EventEnvelope, Health } from '@pi-console/contract';
import { buildLargeTree, call } from '@pi-console/testkit';
import { loadConfig } from '../config.ts';
import { startDaemon, type RunningDaemon } from '../daemon.ts';
import { loadToken } from '../security/token.ts';
import { describeTurns, LoopTurns } from '../testing/loop-turns.ts';

const mebibyte = 1024 * 1024;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Expose GC only to this spec's isolated context; no shared runner flags or global.gc are needed.
setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

async function memoryAfterGc(): Promise<NodeJS.MemoryUsage> {
  collectGarbage();
  // Let finalizers run, then collect again so external/ArrayBuffer accounting has caught up too.
  await new Promise(resolve => { setImmediate(resolve); });
  collectGarbage();
  return process.memoryUsage();
}

async function allEvents(daemon: RunningDaemon): Promise<EventEnvelope[]> {
  const found: EventEnvelope[] = [];
  for await (const event of daemon.log.readFrom(0)) found.push(event);
  return found;
}

test('a large tree backfills in the background: /health stays fast, memory flat, nothing out of scope is stored', { timeout: 600_000 }, async t => {
  const base = mkdtempSync(join(tmpdir(), 'pi-console-volume-'));
  t.after(() => { rmSync(base, { recursive: true, force: true }); });
  const tree = buildLargeTree(join(base, 'agent'), { ledgerRows: 50_000, statusFiles: 20_000, registryRows: 54_000, questionFiles: 1_500, eventRows: 200_000, sessionFiles: 100, sessionBytes: 300 * 1024 });
  const dataDir = join(base, 'data');
  const config = loadConfig(dataDir, { port: 0, agentRoot: tree.root, orchRoot: tree.orchRoot, sessionRoots: [tree.sessionRoot], pollMs: 1_000, sourcePollMs: 250 });
  const baseline = await memoryAfterGc();
  const turns = new LoopTurns();
  turns.start();
  const started = performance.now();
  const daemon = await startDaemon(config);
  t.after(async () => { await daemon.close().catch(() => undefined); });
  const headers = { Authorization: `Bearer ${loadToken(dataDir)}` };
  let firstOk: number | undefined;
  let worst = 0;
  let complete = false;
  let loop = { p50: 0, p99: 0, max: 0 };
  while (!complete && performance.now() - started < 540_000) {
    const sent = performance.now();
    const reply = await call(daemon.port, '/api/v1/health', { headers });
    const elapsed = performance.now() - sent;
    if (reply.status === 200) firstOk ??= performance.now() - started;
    worst = Math.max(worst, elapsed);
    const health = reply.body as Health;
    loop = health.eventLoop;
    complete = health.backfill.complete && health.projection.queueDepth === 0 && health.sources.every(source => source.lagBytes === 0);
    await wait(50);
  }
  const summary = await turns.stop();
  console.log(describeTurns(summary));
  // Forced collections sit outside the loop-turn/health measurements, not inside the daemon's latency budget.
  const memory = await memoryAfterGc();
  const heapGrowth = memory.heapUsed - baseline.heapUsed;
  const externalGrowth = memory.external - baseline.external;
  // arrayBuffers is included in external: log it separately, but do not double-count it. A drop in one category
  // must not hide retention in the other.
  const retainedGrowth = Math.max(0, heapGrowth) + Math.max(0, externalGrowth);
  const rssGrowth = memory.rss - baseline.rss;
  console.log(`volume: first 200 ${firstOk?.toFixed(0)} ms, worst /health ${worst.toFixed(0)} ms, backfill ${((performance.now() - started) / 1000).toFixed(1)} s, rss growth ${(rssGrowth / mebibyte).toFixed(0)} MiB (informational)`);
  console.log(`retained memory: heap growth ${(heapGrowth / mebibyte).toFixed(1)} MiB, external growth ${(externalGrowth / mebibyte).toFixed(1)} MiB, arrayBuffers growth ${((memory.arrayBuffers - baseline.arrayBuffers) / mebibyte).toFixed(1)} MiB, total ${(retainedGrowth / mebibyte).toFixed(1)} MiB`);
  console.log(`event loop: p50 ${loop.p50.toFixed(1)} ms, p99 ${loop.p99.toFixed(1)} ms, max ${loop.max.toFixed(1)} ms`);
  assert.ok(complete, 'backfill finished');
  assert.ok((firstOk ?? Infinity) < 3_000, `first 200 after ${firstOk} ms`);
  // Main-thread CPU per loop turn is what the daemon controls: descheduling on a loaded host or CI runner adds wall
  // time, not CPU time. Healthy turns peak at 24-36 ms of CPU; a 150 ms synchronous step fails both bounds.
  const heavy = summary.long.filter(turn => turn.cpuMs >= 50);
  assert.ok(summary.maxCpuMs < 100, `a loop turn used ${summary.maxCpuMs} ms of CPU`);
  assert.ok(heavy.length <= 3, `${heavy.length} loop turns used 50 ms of CPU or more`);
  // Wall time (HTTP and event-loop delay) includes host descheduling, seen at 1.5 s on a loaded host with 20 ms of
  // CPU in the turn, so it only proves the daemon is not hung.
  assert.ok(worst < 5_000, `worst /health ${worst} ms`);
  assert.ok(loop.max < 5_000, `event-loop max ${loop.max} ms`);
  // Healthy backfill retained 4.7 MiB after GC on a loaded host. 32 MiB leaves ~7x headroom for bounded caches,
  // but not for retaining the input tree; unlike RSS, this excludes unused allocator pages and collectible garbage.
  assert.ok(retainedGrowth < 32 * mebibyte, `retained memory grew ${retainedGrowth / mebibyte} MiB`);
  const events = await allEvents(daemon);
  assert.equal(events.filter(event => event.type === 'SessionStarted').length, 100, 'every synthetic session was ingested');
  const warnings = events.filter(event => event.type === 'SourceSchemaUnknown');
  assert.deepEqual(warnings.map(event => event.payload), [], 'status and turns files raise nothing');
  const checkpoints = new Set<string>();
  for (const source of ['context-budget', 'issue-work', 'phase-ledger', 'question-store']) for (const checkpoint of await daemon.log.checkpoints(source)) checkpoints.add(checkpoint.path);
  assert.ok(checkpoints.size <= 1_500 + 2 + 1 + 16 + 1, `${checkpoints.size} checkpoints`);
  await daemon.close();
  const second = await startDaemon(config);
  t.after(async () => { await second.close().catch(() => undefined); });
  for (let i = 0; i < 2_000 && !(second.sources.backfillComplete && second.ingestion.backfillComplete); i++) await wait(100);
  assert.ok(second.sources.backfillComplete && second.ingestion.backfillComplete, 'warm backfill finished');
  assert.equal((await allEvents(second)).length, events.length, 'a second start appends nothing');
});
