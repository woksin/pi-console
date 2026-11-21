import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryLog } from './memory-log.test.ts';
import { FileTailer } from './tailer.ts';
import { discover } from './paths.ts';

const line = (value = 'hello') => JSON.stringify({ value }) + '\n';
const map = (record: Record<string, unknown>) => [{ type: 'SessionHeartbeat', subject: 'session:fixture', payload: { sessionId: 'fixture', status: String(record.value) } }];

function fixture(t: { after: (callback: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-p2-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.jsonl');
  const log = new MemoryLog();
  const tailer = new FileTailer(log, 'session-jsonl', map);
  t.after(() => tailer.close());
  return { directory, file, log, tailer };
}

test('complete UTF-8 lines only, read-only source and restart from atomic checkpoint', async t => {
  const { file, log, tailer } = fixture(t);
  const bytes = Buffer.from(line('héllo'));
  writeFileSync(file, bytes.subarray(0, bytes.length - 3));
  const before = statSync(file).mtimeMs;
  assert.equal((await tailer.poll([file])).appended, 0);
  assert.equal(log.positions[0].offset, 0);
  await tailer.close();
  const restarted = new FileTailer(log, 'session-jsonl', map);
  t.after(() => restarted.close());
  appendFileSync(file, bytes.subarray(bytes.length - 3));
  const written = statSync(file).mtimeMs;
  await restarted.poll([file]);
  assert.equal(log.rows.length, 1);
  assert.equal((log.rows[0].payload as { status: string }).status, 'héllo');
  assert.equal(statSync(file).mtimeMs, written);
  assert.ok(written >= before);
  assert.equal(log.rows[0].refs?.offset, 0);
  assert.equal(readFileSync(file, 'utf8'), bytes.toString());
});

test('retained descriptor drains rename, discovers replacement and replays no rows', async t => {
  const { file, log, tailer, directory } = fixture(t);
  writeFileSync(file, line('first'));
  await tailer.poll([file]);
  const archive = join(directory, 'session-archive.jsonl');
  renameSync(file, archive);
  appendFileSync(archive, line('late'));
  writeFileSync(file, line('replacement'));
  await tailer.poll([file, archive]);
  assert.equal(log.rows.length, 3);
  await tailer.close();
  const replay = new FileTailer(log, 'session-jsonl', map, { replay: true });
  t.after(() => replay.close());
  assert.equal((await replay.poll([archive, file])).appended, 0);
});

test('size drop advances generation and discards an incomplete prior line', async t => {
  const { file, log, tailer } = fixture(t);
  writeFileSync(file, line('long original') + '{"unfinished":');
  await tailer.poll([file]);
  writeFileSync(file, line('new'));
  await tailer.poll([file]);
  assert.equal(log.positions[0].generation, 1);
  assert.equal(log.rows.length, 2);
});

test('transaction abort leaves events and checkpoint unchanged, then retry is gap-free', async t => {
  const { file, log, tailer } = fixture(t);
  writeFileSync(file, line());
  log.failNext = true;
  await assert.rejects(tailer.poll([file]), /transaction abort/);
  assert.deepEqual(log.rows, []);
  assert.deepEqual(log.positions, []);
  await tailer.poll([file]);
  assert.equal(log.rows.length, 1);
  assert.equal((await tailer.poll([file])).appended, 0);
});

test('unknown and malformed records produce body-free warnings, not guessed events', async t => {
  const { file, log, tailer } = fixture(t);
  writeFileSync(file, '{invalid}\nnull\n');
  await tailer.poll([file]);
  assert.deepEqual(log.rows.map(row => row.type), ['SourceSchemaUnknown', 'SourceSchemaUnknown']);
  assert.equal(JSON.stringify(log.rows).includes('invalid}'), false);
});

test('truncate-and-regrow at same size warns but cannot recover the missed epoch', async t => {
  const { file, log, tailer } = fixture(t);
  writeFileSync(file, line('aaaa'));
  await tailer.poll([file]);
  writeFileSync(file, line('bbbb'));
  await tailer.poll([file]);
  assert.deepEqual(log.rows.map(row => row.type), ['SessionHeartbeat', 'SourceSchemaUnknown']);
  assert.equal(log.positions[0].generation, 0);
  assert.equal(JSON.stringify(log.rows).includes('bbbb'), false);
  assert.equal((await tailer.poll([file])).appended, 0);
});

test('growing head on normal append is not a truncate-and-regrow warning', async t => {
  const { file, log, tailer } = fixture(t);
  writeFileSync(file, line('first'));
  await tailer.poll([file]);
  appendFileSync(file, line('second'));
  await tailer.poll([file]);
  assert.deepEqual(log.rows.map(row => row.type), ['SessionHeartbeat', 'SessionHeartbeat']);
});

test('discovery excludes old files and never follows directory symlinks', t => {
  const { directory, file } = fixture(t);
  writeFileSync(file, line());
  const old = join(directory, 'old.jsonl');
  writeFileSync(old, line());
  utimesSync(old, 0, 0);
  symlinkSync(directory, join(directory, 'loop'));
  assert.deepEqual(discover(directory), [file]);
});

test('deny credentials, environment and browser profiles including symlink targets', async t => {
  const { directory, tailer } = fixture(t);
  for (const name of ['auth.json', '.env', 'accounts', 'profiles', 'profiles-retired', 'Browser', 'Google', 'Firefox']) {
    const folder = join(directory, name);
    mkdirSync(folder);
    const file = join(folder, 'entry.jsonl');
    writeFileSync(file, line());
    await assert.rejects(tailer.poll([file]), /denied/);
  }
  const link = join(directory, 'allowed.jsonl');
  symlinkSync(join(directory, 'accounts', 'entry.jsonl'), link);
  await assert.rejects(tailer.poll([link]), /denied/);
});
