import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

for (const created of ['directory', 'root-symlink', 'ancestor-symlink']) {
  test(`a missing session root beneath a configured alias later appears as ${created}`, async t => {
    const { root, log } = fixture(t);
    const alias = join(root, 'configured');
    symlinkSync(root, alias);
    const sessions = join(alias, 'late', 'sessions');
    const worker = ingestion(log, sessions);
    await worker.poll();
    assert.equal((await events(log)).length, 0);
    const target = join(root, 'target');
    mkdirSync(target);
    if (created === 'ancestor-symlink') symlinkSync(target, join(root, 'late'));
    else mkdirSync(join(root, 'late'));
    if (created === 'root-symlink') symlinkSync(target, sessions);
    else mkdirSync(sessions);
    writeFileSync(join(sessions, 's.jsonl'), header('late') + message('late', 1, 'hello'));
    await worker.poll();
    const found = await events(log);
    assert.equal(found.some(event => event.type === 'SessionStarted'), true);
  });
}

for (const layout of ['leaf', 'ancestor', 'relative-chain']) for (const created of ['directory', 'target-symlink', 'suffix-symlink']) {
  if (layout === 'leaf' && created === 'suffix-symlink') continue;
  test(`a configured dangling session ${layout} alias resolves a late ${created} like a fresh start`, async t => {
    const { root, log } = fixture(t);
    const alias = join(root, 'configured');
    const target = join(root, 'late');
    const suffix = layout === 'leaf' ? [] : ['sessions'];
    symlinkSync(layout === 'relative-chain' ? 'intermediate' : 'late', alias);
    if (layout === 'relative-chain') symlinkSync('late', join(root, 'intermediate'));
    const worker = ingestion(log, join(alias, ...suffix));
    await worker.poll();
    assert.equal((await events(log)).length, 0);
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    if (created === 'target-symlink') symlinkSync(elsewhere, target);
    else mkdirSync(target);
    const sessions = join(target, ...suffix);
    if (created === 'suffix-symlink') symlinkSync(elsewhere, sessions);
    else mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, 's.jsonl'), header('late-alias') + message('late-alias', 1, 'hello'));
    await worker.poll();
    const found = await events(log);
    assert.equal(found.some(event => event.type === 'SessionStarted'), true);
  });
}

for (const layout of ['cycle', 'expanding']) {
  test(`a configured ${layout} session alias fails closed`, async t => {
    const { root, log } = fixture(t);
    const alias = join(root, 'configured');
    const target = layout === 'cycle' ? 'configured' : 'configured/child';
    symlinkSync(target, alias);
    const worker = ingestion(log, alias);
    await worker.poll();
    mkdirSync(join(root, 'late'));
    writeFileSync(join(root, 'late', 's.jsonl'), header('untrusted') + message('untrusted', 1, 'hello'));
    await worker.poll();
    assert.equal((await events(log)).length, 0);
  });
}

for (const late of [false, true]) {
  test(`nested relative configured session links resolve against canonical parents (${late ? 'pending' : 'startup'})`, async t => {
    const { root, log } = fixture(t);
    mkdirSync(join(root, 'store/config'), { recursive: true });
    symlinkSync('store/config', join(root, 'parent'));
    symlinkSync('../latest', join(root, 'store/config/root'));
    const sessions = join(root, 'store/latest');
    const create = () => {
      mkdirSync(sessions);
      writeFileSync(join(sessions, 's.jsonl'), header('nested') + message('nested', 1, 'hello'));
    };
    if (!late) create();
    const worker = ingestion(log, join(root, 'parent/root'));
    if (late) {
      await worker.poll();
      assert.equal((await events(log)).length, 0);
      create();
    }
    await worker.poll();
    const started = (await events(log)).filter(event => event.type === 'SessionStarted');
    assert.deepEqual(started.map(event => (event.payload as Record<string, unknown>).sessionId), ['nested']);
  });
}

test('symlinked session directories and files beneath the pinned root are rejected', async t => {
  const { root, log } = fixture(t);
  const sessions = join(root, 'sessions');
  const outside = join(root, 'outside');
  mkdirSync(sessions);
  mkdirSync(outside);
  writeFileSync(join(outside, 's.jsonl'), header('outside') + message('outside', 1, 'hello'));
  symlinkSync(outside, join(sessions, 'linked-directory'));
  symlinkSync(join(outside, 's.jsonl'), join(sessions, 'linked-file.jsonl'));
  await ingestion(log, sessions).poll();
  assert.equal((await events(log)).length, 0);
});

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
  try { while ((await tailer.poll([path])).lagBytes > 0); } finally { await tailer.close(); }
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
