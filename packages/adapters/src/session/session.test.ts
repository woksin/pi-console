import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryLog } from '../tailing/memory-log.test.ts';
import { sessionTailer } from './session.ts';

const fixture = new URL('../../../testkit/fixtures/sources/session-v3.jsonl', import.meta.url);
function setup(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'console-session-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.jsonl');
  copyFileSync(fixture, file);
  const log = new MemoryLog();
  const tailer = sessionTailer(log, file);
  t.after(() => tailer.close());
  return { directory, file, log, tailer };
}

test('v3 emits raw observations without pairing or leaking transcript bodies', async t => {
  const { file, log, tailer } = setup(t);
  const before = statSync(file).mtimeMs;
  await tailer.poll([file]);
  assert.deepEqual(log.rows.map(row => row.type), ['SessionStarted', 'ModelChanged', 'ThinkingLevelChanged', 'RequestObserved', 'SessionCostObserved', 'AnswerObserved', 'SessionCostObserved', 'RequestInterrupted', 'SessionCostObserved', 'ResetOccurred']);
  const request = log.rows.find(row => row.type === 'RequestObserved')!;
  assert.equal((request.payload as Record<string, unknown>).origin, 'unproven');
  assert.equal((request.payload as Record<string, unknown>).entryId, 'prompt-1');
  const answer = log.rows.find(row => row.type === 'AnswerObserved')!;
  assert.equal((answer.payload as Record<string, unknown>).raw, true);
  assert.equal('requestId' in (answer.payload as object), false);
  assert.equal(answer.refs?.entryId, 'answer-1');
  assert.equal(JSON.stringify(log.rows).includes('Synthetic summary'), false);
  assert.equal(statSync(file).mtimeMs, before);
  await tailer.close();
  const replay = sessionTailer(log, file, { replay: true });
  t.after(() => replay.close());
  assert.equal((await replay.poll([file])).appended, 0);
});

test('torn final message is reread; atomic replacement and old-inode writes drain', async t => {
  const { directory, file, log, tailer } = setup(t);
  const line = JSON.stringify({ type: 'message', id: 'late', timestamp: '2026-11-19T10:00:09.000Z', message: { role: 'user', content: 'late prompt' } }) + '\n';
  appendFileSync(file, line.slice(0, -2));
  await tailer.poll([file]);
  assert.equal(log.rows.length, 10);
  const archive = join(directory, 'archive.jsonl');
  renameSync(file, archive);
  appendFileSync(archive, line.slice(-2));
  writeFileSync(file, readFileSync(fixture));
  await tailer.poll([archive, file]);
  assert.equal(log.rows.filter(row => row.refs?.entryId === 'late').length, 1);
});

test('unsupported versions, malformed entries and secret excerpts fail closed', async t => {
  const { file, log, tailer } = setup(t);
  appendFileSync(file, JSON.stringify({ type: 'future', body: 'never persisted' }) + '\n');
  appendFileSync(file, JSON.stringify({ type: 'message', id: 'secret', timestamp: '2026-11-19T10:00:10.000Z', message: { role: 'user', content: 'sk-' + 'a'.repeat(48) } }) + '\n');
  await tailer.poll([file]);
  assert.equal(log.rows.at(-2)?.type, 'SourceSchemaUnknown');
  assert.equal(JSON.stringify(log.rows).includes('a'.repeat(48)), false);
  assert.equal(JSON.stringify(log.rows).includes('never persisted'), false);
  writeFileSync(file, JSON.stringify({ type: 'session', version: 999, id: 'future' }) + '\n');
  const unknown = sessionTailer(log, file);
  t.after(() => unknown.close());
  await unknown.poll([file]);
  assert.equal(log.rows.at(-1)?.type, 'SourceSchemaUnknown');
});
