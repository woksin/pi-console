import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Health } from '@pi-console/contract';
import { SqliteEventLog } from '@pi-console/core';
import { call } from '@pi-console/testkit';
import { SessionIngestion } from './session-ingestion.ts';
import { specDaemon } from '../testing/harness.ts';

const header = JSON.stringify({ type: 'session', version: 3, id: 'oversized', timestamp: '2026-01-02T00:00:00Z', cwd: '/fixture' }) + '\n';
const message = (text: string) => JSON.stringify({
  type: 'message', id: text.length > 100 ? 'large' : text, timestamp: '2026-01-02T00:00:00Z',
  message: { role: 'user', content: [{ type: 'text', text }] },
}) + '\n';
const worker = (log: SqliteEventLog, root: string) => new SessionIngestion(log, { roots: [root], backfillWindowDays: 14, pollMs: 60_000 });

function fixture(t: { after: (callback: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-large-session-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, file: join(root, 's.jsonl') };
}

test('session ingestion skips a >1 MiB record visibly, ingests following records, and restarts past the skip', async t => {
  const { root, file } = fixture(t);
  const log = new SqliteEventLog(':memory:');
  t.after(() => log.close());
  writeFileSync(file, header + message('private-body-'.repeat(200_000)) + message('following'));
  const ingestion = worker(log, root);
  await ingestion.poll();
  assert.equal(ingestion.status.lagBytes, Buffer.byteLength(message('following')));
  assert.equal((await log.checkpoints('session-jsonl'))[0].offset, statSync(file).size - ingestion.status.lagBytes);
  const resumed = worker(log, root);
  await resumed.poll();
  assert.equal(resumed.status.lagBytes, 0);
  const rows = [];
  for await (const row of log.readFrom(0)) rows.push(row);
  assert.equal(rows.filter(row => row.type === 'SourceSchemaUnknown').length, 1);
  assert.ok(rows.some(row => JSON.stringify(row.payload).includes('following')));
  assert.equal(JSON.stringify(rows).includes('private-body-'), false);
  assert.equal((await log.checkpoints('session-jsonl'))[0].offset, statSync(file).size);
  const restarted = worker(log, root);
  await restarted.poll();
  appendFileSync(file, message('after-restart'));
  await restarted.poll();
  const after = [];
  for await (const row of log.readFrom(0)) after.push(row);
  assert.equal(after.filter(row => row.type === 'SourceSchemaUnknown').length, 1);
  assert.ok(after.some(row => JSON.stringify(row.payload).includes('after-restart')));
});

test('sub-budget records still grow the pacing batch and are processed instead of skipped', async t => {
  const { root, file } = fixture(t);
  const log = new SqliteEventLog(':memory:');
  t.after(() => log.close());
  writeFileSync(file, header + message('x'.repeat(700_000)) + message('following'));
  const ingestion = worker(log, root);
  await ingestion.poll();
  const types = [];
  for await (const row of log.readFrom(0)) types.push(row.type);
  assert.equal(ingestion.status.lagBytes, 0);
  assert.equal(types.includes('SourceSchemaUnknown'), false);
  assert.ok(types.includes('RequestObserved'));
});

test('health exposes a failed session append and its unread bytes, then clears after recovery', async t => {
  const { root, file } = fixture(t);
  writeFileSync(file, header + message('following'));
  const spec = await specDaemon([], { sessionRoots: [root] });
  t.after(() => spec.close());
  const failing = t.mock.method(spec.daemon.log, 'append', async () => { throw new Error('private failure detail'); });
  await spec.daemon.ingestion.poll();
  const health = async () => (await call(spec.daemon.port, '/api/v1/health', {
    headers: { Authorization: `Bearer ${spec.token}` },
  })).body as Health;
  const failed = await health();
  assert.equal(failed.status, 'degraded');
  const session = failed.sources.find(source => source.source === 'session-jsonl');
  assert.equal(session?.errors, 1);
  assert.equal(session?.lagBytes, statSync(file).size);
  assert.equal(JSON.stringify(failed).includes('private failure detail'), false);
  assert.equal(JSON.stringify(failed).includes(root), false);
  failing.mock.restore();
  await spec.daemon.ingestion.poll();
  const recovered = await health();
  assert.equal(recovered.status, 'ok');
  assert.equal(recovered.sources.find(source => source.source === 'session-jsonl')?.errors, 0);
  assert.equal(recovered.sources.find(source => source.source === 'session-jsonl')?.lagBytes, 0);
});

test('health exposes an initial checkpoint failure before the first session poll, then recovers', async t => {
  const { root, file } = fixture(t);
  writeFileSync(file, header + message('following'));
  const spec = await specDaemon([], { sessionRoots: [root] });
  t.after(() => spec.close());
  const discoveryFailure = t.mock.method(spec.daemon.log, 'checkpoints', async () => { throw new Error('checkpoint read failure'); });
  await assert.rejects(spec.daemon.ingestion.poll(), /checkpoint read failure/);
  const health = async () => (await call(spec.daemon.port, '/api/v1/health', {
    headers: { Authorization: `Bearer ${spec.token}` },
  })).body as Health;
  const unavailable = await health();
  assert.equal(unavailable.status, 'degraded');
  assert.equal(unavailable.sources.find(source => source.source === 'session-jsonl')?.errors, 1);
  discoveryFailure.mock.restore();
  await spec.daemon.ingestion.poll();
  const recovered = await health();
  assert.equal(recovered.status, 'ok');
  assert.equal(recovered.sources.find(source => source.source === 'session-jsonl')?.errors, 0);
  assert.equal(recovered.sources.find(source => source.source === 'session-jsonl')?.lagBytes, 0);
});
