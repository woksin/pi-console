import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTailer } from './tailer.ts';
import { MemoryLog } from './memory-log.test.ts';

const batchBytes = 1024 * 1024;
const normal = '{"value":"following"}\n';
const oversized = JSON.stringify({ value: 'withheld-body-'.repeat(200_000) });
const mapper = (record: Record<string, unknown>) => [{
  type: 'SessionHeartbeat', subject: 'session:fixture', payload: { sessionId: 'fixture', status: String(record.value) },
}];

function fixture(t: { after: (callback: () => void) => void }, filtered = false) {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-oversized-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'session.jsonl');
  const log = new MemoryLog();
  const tailer = new FileTailer(log, 'session-jsonl', mapper, { lineFilter: filtered ? line => line.includes('following') : undefined });
  t.after(() => tailer.close());
  return { file, log, tailer };
}

for (const filtered of [false, true]) test(`a complete oversized record is skipped explicitly, even before a line filter (${filtered})`, async t => {
  const { file, log, tailer } = fixture(t, filtered);
  writeFileSync(file, oversized + '\n' + normal);
  const result = await tailer.poll([file]);
  assert.equal(log.positions[0].offset, Buffer.byteLength(oversized) + 1);
  assert.equal(result.lagBytes, Buffer.byteLength(normal));
  assert.equal(result.partialFiles, 0);
  assert.deepEqual(log.rows.map(row => row.type), ['SourceSchemaUnknown']);
  assert.match(JSON.stringify(log.rows[0].payload), /exceeds.*withheld/);
  assert.equal(JSON.stringify(log.rows).includes('withheld-body-'), false);
  assert.equal(log.rows[0].refs?.offset, 0);
  await tailer.close();
  const restarted = new FileTailer(log, 'session-jsonl', mapper);
  t.after(() => restarted.close());
  assert.equal((await restarted.poll([file])).lagBytes, 0);
  assert.deepEqual(log.rows.map(row => row.type), ['SourceSchemaUnknown', 'SessionHeartbeat']);
  assert.equal(log.rows[1].refs?.offset, Buffer.byteLength(oversized) + 1);
  assert.equal((log.rows[1].payload as { status: string }).status, 'following');
  assert.equal(statSync(file).size, Buffer.byteLength(oversized + '\n' + normal));
});

test('an unterminated oversized tail stays pending until its newline, including after restart', async t => {
  const { file, log, tailer } = fixture(t);
  writeFileSync(file, oversized);
  for (let poll = 0; poll < 2; poll++) {
    const result = await tailer.poll([file]);
    assert.equal(result.lagBytes, Buffer.byteLength(oversized));
    assert.equal(result.partialFiles, 1);
    assert.equal(log.positions[0].offset, 0);
    assert.equal(log.rows.length, 0);
  }
  await tailer.close();
  const restarted = new FileTailer(log, 'session-jsonl', mapper);
  t.after(() => restarted.close());
  // A JSON-looking suffix is still part of the oversized line, never a fresh record.
  appendFileSync(file, normal + normal);
  await restarted.poll([file]);
  assert.equal(log.positions[0].offset, Buffer.byteLength(oversized + normal));
  await restarted.poll([file]);
  assert.deepEqual(log.rows.map(row => row.type), ['SourceSchemaUnknown', 'SessionHeartbeat']);
});

test('skip warning and checkpoint commit atomically and replay deduplicates the warning', async t => {
  const { file, log, tailer } = fixture(t);
  writeFileSync(file, oversized + '\n' + normal);
  log.failNext = true;
  await assert.rejects(tailer.poll([file]), /transaction abort/);
  assert.deepEqual(log.positions, []);
  assert.deepEqual(log.rows, []);
  await tailer.poll([file]);
  await tailer.poll([file]);
  const replay = new FileTailer(log, 'session-jsonl', mapper, { replay: true });
  t.after(() => replay.close());
  assert.equal((await replay.poll([file])).appended, 0);
  assert.equal((await replay.poll([file])).appended, 0);
  assert.equal(log.rows.length, 2);
});

test('a record ending exactly at the batch boundary is processed, not skipped', async t => {
  const { file, log, tailer } = fixture(t);
  const row = JSON.stringify({ value: 'x'.repeat(batchBytes - Buffer.byteLength('{"value":""}\n')) }) + '\n';
  assert.equal(Buffer.byteLength(row), batchBytes);
  writeFileSync(file, row + normal);
  await tailer.poll([file]);
  assert.deepEqual(log.rows.map(row => row.type), ['SessionHeartbeat']);
  assert.equal(log.positions[0].offset, batchBytes);
});
