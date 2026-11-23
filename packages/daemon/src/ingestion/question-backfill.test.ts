import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteEventLog } from '@pi-console/core';
import { questionMapper, questionMapperVersion } from '@pi-console/adapters';
import { SourceIngestion } from './source-ingestion.ts';
import type { Feed } from './source-table.ts';

test('a question mapper version rereads unchanged revisions once, keeping old events and unrelated checkpoints', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-console-qbackfill-')));
  const log = new SqliteEventLog(join(root, 'console.db'));
  t.after(() => { log.close(); rmSync(root, { recursive: true, force: true }); });
  const items = join(root, 'items');
  mkdirSync(items);
  const file = join(items, 'r00000002.json');
  const body = JSON.stringify({
    v: 1, id: 'q-1', rev: 2, type: 'question', priority: 'normal', blocking: '', text: 'Synthetic?',
    history: [{ seq: 1, type: 'created', ts: '2026-07-01T10:00:00Z' }, { seq: 2, type: 'comment', ts: '2026-07-01T10:01:00Z', text: 'note' }],
  });
  writeFileSync(file, body);
  // An older daemon already committed its checkpoint (no mapper version in the identity) and a legacy event.
  await log.append([], [
    { source: 'question-store', path: file, identity: `snapshot:${file}`, generation: 0, offset: body.length, size: body.length, mtimeMs: 0, headHash: createHash('sha256').update(body).digest('hex') },
    { source: 'lane-messages', path: '/elsewhere', identity: 'snapshot:/elsewhere', generation: 0, offset: 1, size: 1, mtimeMs: 0, headHash: 'x' },
  ]);
  const feed: Feed = { kind: 'snapshot', directories: [items], extension: '.json', window: 'none', mapper: questionMapper, mapperVersion: questionMapperVersion };
  const run = async () => {
    const worker = new SourceIngestion(log, { id: 'question-store', feeds: [feed], backfillWindowDays: 14 });
    try { await worker.poll(); } finally { worker.close(); }
  };
  const types = async () => { const found: string[] = []; for await (const event of log.readFrom(0)) found.push(event.type); return found; };
  await run();
  assert.deepEqual(await types(), ['QuestionSnapshotObserved', 'QuestionHistoryRecorded', 'QuestionHistoryRecorded']);
  await run();
  assert.equal((await types()).length, 3, 'a restart is a no-op');
  assert.equal((await log.checkpoints('lane-messages')).length, 1, 'unrelated checkpoints are untouched');
  assert.equal((await log.checkpoints('question-store')).length, 2, 'the old checkpoint stays beside the versioned one');
});
