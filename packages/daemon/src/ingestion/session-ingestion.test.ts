import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventEnvelope, EventLog } from '@pi-console/contract';
import { SqliteEventLog } from '@pi-console/core';
import { sessionTailer } from '@pi-console/adapters';
import { CheckpointCache } from './checkpoint-cache.ts';
import { SessionIngestion } from './session-ingestion.ts';

const now = new Date('2026-01-02T00:00:00Z');
const line = (row: Record<string, unknown>) => JSON.stringify(row) + '\n';
const header = (id: string) => line({ type: 'session', version: 3, id, cwd: '/repo', timestamp: now.toISOString() });
const message = (id: string, n: number, text: string) => line({
  type: 'message', id: `${id}-${n}`, timestamp: now.toISOString(), message: { role: n % 2 ? 'assistant' : 'user', stopReason: 'stop', content: [{ type: 'text', text }] },
});

function fixture(t: { after: (fn: () => void) => void }): { root: string; log: SqliteEventLog } {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-sessions-'));
  const log = new SqliteEventLog(':memory:');
  t.after(() => { log.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, log };
}

/** Counts appends (one per batch, checkpoint-only ones included) so a skipped file is observable. */
function counted(log: EventLog): { log: EventLog; appends: () => number } {
  let appends = 0;
  const wrapper: EventLog = Object.assign(Object.create(log) as EventLog, {
    append: (...args: Parameters<EventLog['append']>) => { appends++; return log.append(...args); },
    checkpoints: (source: string) => log.checkpoints(source),
  });
  return { log: wrapper, appends: () => appends };
}

const ingestion = (log: EventLog, root: string) => new SessionIngestion(new CheckpointCache(log), { roots: [root], backfillWindowDays: 14, pollMs: 60_000, now: () => now });

async function events(log: EventLog): Promise<Omit<EventEnvelope, 'seq' | 'recordedAt' | 'id'>[]> {
  const result = [];
  // Compare source facts, excluding generated seq/recordedAt/id metadata.
  for await (const { type, version, occurredAt, source, idempotencyKey, subject, actor, payload, refs } of log.readFrom(0)) {
    result.push({ type, version, occurredAt, source, idempotencyKey, subject, actor, payload, refs });
  }
  return result;
}

test('a poll over many files yields to the event loop between files', async t => {
  const { root, log } = fixture(t);
  for (let i = 0; i < 200; i++) writeFileSync(join(root, `s-${i}.jsonl`), header(`s-${i}`) + message(`s-${i}`, 1, 'hello'));
  let ticks = 0;
  let ticking = true;
  const tick = (): void => { ticks++; if (ticking) setImmediate(tick); };
  setImmediate(tick);
  await ingestion(log, root).poll();
  ticking = false;
  assert.ok(ticks >= 200, `${ticks} macrotask turns during a 200-file poll`);
});

test('an unchanged file is not read again, also after a restart; appended bytes still are', async t => {
  const { root, log } = fixture(t);
  const path = join(root, 's.jsonl');
  writeFileSync(path, header('s') + message('s', 1, 'one'));
  await ingestion(log, root).poll();
  const before = (await events(log)).length;
  const restarted = counted(log);
  const second = ingestion(restarted.log, root);
  await second.poll();
  await second.poll();
  assert.equal(restarted.appends(), 0);
  assert.equal(second.status.files, 1);
  appendFileSync(path, message('s', 2, 'two'));
  await second.poll();
  assert.equal(restarted.appends(), 1);
  assert.ok((await events(log)).length > before);
});

test('small paced batches produce the same events as one large batch, long records included', async t => {
  const { root, log } = fixture(t);
  const path = join(root, 's.jsonl');
  let text = header('s');
  for (let n = 1; n <= 60; n++) text += message('s', n, (n % 7 === 0 ? 'x'.repeat(150_000) : 'y'.repeat(3_000)) + n);
  writeFileSync(path, text);
  const paced = ingestion(log, root);
  for (let poll = 0; poll < 5 && (await paced.poll(), paced.status.lagBytes > 0); poll++);
  assert.equal(paced.status.lagBytes, 0);
  const reference = new SqliteEventLog(':memory:');
  t.after(() => { reference.close(); });
  const tailer = sessionTailer(reference, path);
  try { while ((await tailer.poll([path])).lagBytes > 0); } finally { tailer.close(); }
  assert.deepEqual(await events(log), await events(reference));
});

test('a poll advances each file by at most the former single-batch budget', async t => {
  const { root, log } = fixture(t);
  mkdirSync(join(root, 'nested'));
  let text = header('big');
  for (let n = 1; text.length < 3 * 1024 * 1024; n++) text += message('big', n, 'z'.repeat(4_000));
  writeFileSync(join(root, 'nested', 'big.jsonl'), text);
  const paced = ingestion(log, root);
  await paced.poll();
  const lag = paced.status.lagBytes;
  assert.ok(lag >= text.length - 1024 * 1024 && lag < text.length - 1024 * 1024 + 64 * 1024, `lag ${lag}`);
});
