import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppendResult, EventLog, NewEvent, SourceCheckpoint } from '@pi-console/contract';
import { FileTailer } from '@pi-console/adapters';
import { CheckpointCache } from './checkpoint-cache.ts';

class StoredCheckpoints implements EventLog {
  readonly saved = new Map<string, SourceCheckpoint>();
  reads = 0;
  visits = 0;
  failAppend = false;

  async append(_events: readonly NewEvent[], checkpoints: readonly SourceCheckpoint[] = []): Promise<AppendResult> {
    if (this.failAppend) throw new Error('append failed');
    for (const checkpoint of checkpoints) this.saved.set(`${checkpoint.source}|${checkpoint.identity}`, checkpoint);
    return { appended: 0, duplicates: 0, lastSeq: 0 };
  }

  async checkpoints(source: string): Promise<SourceCheckpoint[]> {
    this.reads++;
    const checkpoints = [...this.saved.values()].filter(checkpoint => checkpoint.source === source);
    this.visits += checkpoints.length;
    return checkpoints;
  }

  readFrom(): AsyncIterable<never> { return (async function* () { /* empty */ })(); }
  subscribe(): () => void { return () => undefined; }
}

class CountedCache extends CheckpointCache {
  visits = 0;

  override async checkpoints(source: string): Promise<SourceCheckpoint[]> {
    const checkpoints = await super.checkpoints(source);
    this.visits += checkpoints.length;
    return checkpoints;
  }

  override async checkpoint(source: string, identity: string): Promise<SourceCheckpoint | undefined> {
    this.visits++;
    return super.checkpoint(source, identity);
  }
}

const saved = (source = 'session-jsonl'): SourceCheckpoint => ({
  source, path: '/session.jsonl', identity: '1:2', generation: 0, offset: 3, size: 9, mtimeMs: 0,
});

test('indexed checkpoints see only committed appends, including epoch and path changes', async () => {
  const log = new StoredCheckpoints();
  const cache = new CheckpointCache(log);
  const initial = saved();
  await log.append([], [initial]);
  assert.deepEqual(await cache.checkpoint(initial.source, initial.identity), initial);
  assert.equal(await cache.checkpoint(initial.source, 'missing'), undefined);
  const changed = { ...initial, generation: 1, offset: 0, size: 0, path: '/renamed.jsonl' };
  log.failAppend = true;
  await assert.rejects(cache.append([], [changed]), /append failed/);
  assert.deepEqual(await cache.checkpoint(initial.source, initial.identity), initial);
  log.failAppend = false;
  await cache.append([], [changed]);
  assert.deepEqual(await cache.checkpoint(initial.source, initial.identity), changed);
  assert.deepEqual(await cache.checkpoints(initial.source), [changed]);
  assert.equal(log.reads, 1);
});

test('an append before the first lookup is loaded without losing other checkpoints or mixing sources', async () => {
  const log = new StoredCheckpoints();
  const cache = new CheckpointCache(log);
  const initial = saved();
  const another = { ...initial, identity: '1:3' };
  const otherSource = saved('intent-memory');
  await log.append([], [initial]);
  await cache.append([], [another, otherSource]);
  assert.deepEqual(await cache.checkpoints(initial.source), [initial, another]);
  assert.deepEqual(await cache.checkpoint(otherSource.source, otherSource.identity), otherSource);
  assert.equal(log.reads, 2);
});

test('one-file session tailers visit O(N) checkpoints across chunks and a second pass', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'pi-checkpoint-volume-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = new StoredCheckpoints();
  const cache = new CountedCache(log);
  const paths = Array.from({ length: 50 }, (_, index) => join(directory, `${index}.jsonl`));
  for (const path of paths) {
    writeFileSync(path, '{}\n{}\n{}\n');
    const stat = statSync(path);
    const checkpoint = { ...saved(), path, identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`, mtimeMs: stat.mtimeMs, offset: 0 };
    log.saved.set(`${checkpoint.source}|${checkpoint.identity}`, checkpoint);
  }
  for (const chunks of [2, 1]) {
    // SessionIngestion enumerates checkpoints once per source pass for its age/size checks.
    await cache.checkpoints('session-jsonl');
    for (const path of paths) {
      const tailer = new FileTailer(cache, 'session-jsonl', () => [], { roots: [directory], batchBytes: 3 });
      try {
        for (let chunk = 0; chunk < chunks; chunk++) {
          const result = await tailer.poll([path]);
          assert.equal(result.lagBytes, chunks === 2 ? 6 - chunk * 3 : 0, 'every chunk resumes at the just-committed offset');
        }
      } finally { await tailer.close(); }
    }
  }
  const visits = log.visits + cache.visits;
  t.diagnostic(`N=${paths.length}; checkpoint visits=${visits}; source table reads=${log.reads}`);
  assert.equal(log.reads, 1);
  // The former source-wide lookup visits 3*N*N + 3*N rows: 7,650 at N=50, versus 300 here.
  assert.equal(visits, 6 * paths.length, 'one table load, two pass enumerations and three indexed chunk lookups');
  assert.ok([...log.saved.values()].every(checkpoint => checkpoint.offset === checkpoint.size));
});
