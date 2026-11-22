import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { SourceCheckpoint } from '@pi-console/contract';
import { TranscriptSources } from './transcript-sources.ts';

const at = '2026-01-02T03:04:05.000Z';
const header = (id: string) => JSON.stringify({ type: 'session', version: 3, id, timestamp: at, cwd: '/synthetic' }) + '\n';

function fixture(t: { after: (callback: () => void) => void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-transcript-index-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const positions: SourceCheckpoint[] = [];
  const index = new TranscriptSources({ checkpoints: async () => positions }, [root]);
  const save = (path: string, generation = 0) => {
    const stat = statSync(path);
    const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    const checkpoint: SourceCheckpoint = { source: 'session-jsonl', identity, path, generation, offset: stat.size, size: stat.size, mtimeMs: stat.mtimeMs,
      headHash: createHash('sha256').update(readFileSync(path).subarray(0, 512)).digest('hex') };
    const previous = positions.findIndex(item => item.identity === identity);
    if (previous < 0) positions.push(checkpoint); else positions[previous] = checkpoint;
    return checkpoint;
  };
  return { root, positions, index, save };
}

test('only validated checkpoint headers associate paths; append, generation and rename refresh metadata', async t => {
  const { root, positions, index, save } = fixture(t);
  const path = join(root, 'unrelated-name.jsonl');
  writeFileSync(path, header('wanted'));
  assert.equal(await index.resolve('wanted'), undefined, 'not discovered by transcript reads');
  save(path);
  const initial = await index.resolve('wanted');
  assert.equal(initial?.path, path);
  assert.equal(await index.resolve('../unrelated-name.jsonl'), undefined);
  appendFileSync(path, '{}\n');
  assert.ok((await index.resolve('wanted'))!.version.size > initial.version.size);
  save(path, 1);
  assert.notEqual((await index.resolve('wanted'))?.epoch, initial?.epoch);
  const renamed = join(root, 'renamed.jsonl');
  renameSync(path, renamed);
  assert.equal(await index.resolve('wanted'), undefined);
  positions[0].path = renamed;
  assert.equal((await index.resolve('wanted'))?.path, renamed);
});

test('duplicate headers fail closed regardless of checkpoint order; mismatches and torn headers never guess', async t => {
  const { root, positions, index, save } = fixture(t);
  for (const name of ['a', 'b']) { const path = join(root, name + '.jsonl'); writeFileSync(path, header('same')); save(path); }
  assert.equal(await index.resolve('same'), undefined);
  positions.reverse();
  assert.equal(await index.resolve('same'), undefined);
  rmSync(positions[0].path);
  assert.ok(await index.resolve('same'));
  const path = positions[1].path;
  writeFileSync(path, header('evil'));
  assert.equal(await index.resolve('same'), undefined, 'same-inode head rewrite must fail fingerprint');
  writeFileSync(path, '{"type":"session"');
  save(path, 1);
  assert.equal(await index.resolve('same'), undefined);
});

test('removed, replaced, truncated, hardlinked and symlinked sources fail closed', async t => {
  const { root, index, save } = fixture(t);
  const path = join(root, 'file.jsonl');
  writeFileSync(path, header('safe'));
  save(path);
  assert.ok(await index.resolve('safe'));
  const hidden = join(root, 'hidden.jsonl');
  linkSync(path, hidden);
  assert.equal(await index.resolve('safe'), undefined);
  rmSync(hidden);
  writeFileSync(path, '');
  assert.equal(await index.resolve('safe'), undefined);
  rmSync(path);
  writeFileSync(path, header('safe'));
  assert.equal(await index.resolve('safe'), undefined, 'replacement identity is not the saved identity');
  save(path);
  renameSync(path, hidden);
  symlinkSync(hidden, path);
  assert.equal(await index.resolve('safe'), undefined);
});

test('outside roots, denied directories, non-regular sources and invalid header versions are unavailable', async t => {
  const { root, positions, index, save } = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'pi-history-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const foreign = join(outside, 'foreign.jsonl');
  writeFileSync(foreign, header('foreign'));
  save(foreign);
  assert.equal(await index.resolve('foreign'), undefined);
  const denied = join(root, 'credentials');
  mkdirSync(denied);
  const deniedFile = join(denied, 'file.jsonl');
  writeFileSync(deniedFile, header('denied'));
  save(deniedFile);
  assert.equal(await index.resolve('denied'), undefined);
  const invalid = join(root, 'invalid.jsonl');
  writeFileSync(invalid, header('invalid').replace('"version":3', '"version":2'));
  save(invalid);
  assert.equal(await index.resolve('invalid'), undefined);
  const fifo = join(root, 'fifo.jsonl');
  execFileSync('mkfifo', [fifo]);
  const stat = statSync(fifo);
  positions.push({ source: 'session-jsonl', path: fifo, identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`, generation: 0, offset: 0, size: 0, mtimeMs: stat.mtimeMs });
  assert.equal(await index.resolve('fifo'), undefined);
});

test('root pins permit missing-root discovery but reject later root replacement', async t => {
  const { root, positions } = fixture(t);
  const missing = join(root, 'missing');
  const index = new TranscriptSources({ checkpoints: async () => positions }, [missing]);
  assert.equal(await index.resolve('safe'), undefined);
  mkdirSync(missing);
  const path = join(missing, 'file.jsonl');
  writeFileSync(path, header('safe'));
  const stat = statSync(path);
  positions.push({ source: 'session-jsonl', path, identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`, generation: 0, offset: stat.size, size: stat.size, mtimeMs: stat.mtimeMs });
  assert.ok(await index.resolve('safe'));
  const moved = join(root, 'moved');
  renameSync(missing, moved);
  symlinkSync(moved, missing);
  assert.equal(await index.resolve('safe'), undefined);
});
