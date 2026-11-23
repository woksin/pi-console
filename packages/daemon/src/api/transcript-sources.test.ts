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

const scaleScript = `
  import fs from 'node:fs';
  import promises from 'node:fs/promises';
  import { syncBuiltinESMExports } from 'node:module';
  import { createHash } from 'node:crypto';
  import { TranscriptSources } from './packages/daemon/src/api/transcript-sources.ts';
  const root = fs.realpathSync(process.cwd());
  const files = new Map();
  const checkpoints = Array.from({ length: 5000 }, (_, i) => {
    const bytes = Buffer.from(JSON.stringify({ type: 'session', version: 3, id: 's' + i,
      timestamp: '2026-01-02T03:04:05.000Z', cwd: '/synthetic' }) + '\\n');
    const path = root + '/stub-' + i + '.jsonl';
    const stat = { dev: 1, ino: i, birthtimeMs: 1, nlink: 1, size: bytes.length, mtimeMs: 1,
      isFile: () => true, isSymbolicLink: () => false };
    files.set(path, { bytes, stat });
    return { source: 'session-jsonl', identity: '1:' + i + ':1', path, generation: 0,
      offset: bytes.length, size: bytes.length, mtimeMs: 1,
      headHash: createHash('sha256').update(bytes).digest('hex') };
  });
  let opens = 0;
  let closes = 0;
  const originalStat = fs.lstatSync;
  fs.lstatSync = path => files.get(path)?.stat ?? originalStat(path);
  promises.open = async path => {
    const file = files.get(path);
    if (!file) throw new Error('Unexpected open: ' + path);
    opens++;
    return {
      stat: async () => file.stat,
      read: async (buffer, offset, length, position) => ({ bytesRead: file.bytes.copy(buffer, offset, position, position + length) }),
      close: async () => { closes++; },
    };
  };
  syncBuiltinESMExports();
  const index = new TranscriptSources({ checkpoints: async () => checkpoints }, [root]);
  const warm = await index.resolve('s4999');
  const warmOpens = opens;
  opens = closes = 0;
  const selected = await index.resolve('s4999');
  const uniqueOpens = opens;
  const uniqueCloses = closes;
  opens = closes = 0;
  await index.resolve('missing');
  await index.resolve('another-missing');
  const unknownOpens = opens;
  opens = closes = 0;
  const concurrent = await Promise.all([index.resolve('s0'), index.resolve('s4999')]);
  process.stdout.write(JSON.stringify({ warmOpens, uniqueOpens, uniqueCloses, unknownOpens,
    concurrentOpens: opens, concurrentCloses: closes, paths: [warm, selected, ...concurrent].map(source => source?.path) }));
`;

test('5000 warm header associations validate only the selected candidates, including concurrent lookups', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', scaleScript], {
    cwd: new URL('../../../../', import.meta.url), encoding: 'utf8', timeout: 30_000,
  }));
  assert.equal(result.warmOpens, 5000);
  assert.equal(result.uniqueOpens, 1);
  assert.equal(result.uniqueCloses, 1);
  assert.equal(result.unknownOpens, 0, 'unchanged checkpoints do not repeat negative scans');
  assert.equal(result.concurrentOpens, 2);
  assert.equal(result.concurrentCloses, 2);
  assert.ok(result.paths[0]?.endsWith('/stub-4999.jsonl'));
  assert.equal(result.paths[1], result.paths[0]);
  assert.ok(result.paths[2]?.endsWith('/stub-0.jsonl'));
  assert.equal(result.paths[3], result.paths[0]);
});

test('new, rewritten and removed checkpoints refresh associations and negative lookups', async t => {
  const { root, positions, index, save } = fixture(t);
  const path = join(root, 'file.jsonl');
  assert.equal(await index.resolve('first'), undefined);
  writeFileSync(path, header('first'));
  save(path);
  assert.ok(await index.resolve('first'));
  assert.equal(await index.resolve('other'), undefined);
  writeFileSync(path, header('other'));
  save(path, 1);
  assert.equal((await index.resolve('other'))?.path, path);
  assert.equal(await index.resolve('first'), undefined);
  positions.splice(0);
  assert.equal(await index.resolve('other'), undefined);
  save(path, 1);
  assert.equal((await index.resolve('other'))?.path, path);
});

test('new duplicate checkpoints invalidate warm unique and negative lookups', async t => {
  const { root, positions, index, save } = fixture(t);
  const first = join(root, 'first.jsonl');
  writeFileSync(first, header('same'));
  save(first);
  assert.equal((await index.resolve('same'))?.path, first);
  assert.equal(await index.resolve('missing'), undefined);
  const second = join(root, 'second.jsonl');
  writeFileSync(second, header('same'));
  save(second);
  assert.equal(await index.resolve('same'), undefined);
  positions.pop();
  assert.equal((await index.resolve('same'))?.path, first);
});

test('duplicate candidates are revalidated after temporary unavailability without checkpoint changes', async t => {
  const { root, index, save } = fixture(t);
  const first = join(root, 'first.jsonl');
  const second = join(root, 'second.jsonl');
  for (const path of [first, second]) { writeFileSync(path, header('same')); save(path); }
  assert.equal(await index.resolve('same'), undefined);
  const alias = join(root, 'alias.jsonl');
  linkSync(second, alias);
  assert.equal((await index.resolve('same'))?.path, first);
  rmSync(alias);
  assert.equal(await index.resolve('same'), undefined);
});

function recoveryFixture(t: { after: (callback: () => void) => void }, duplicate: boolean) {
  const spec = fixture(t);
  const sessionId = duplicate ? 'same' : 'solo';
  const unavailable = join(spec.root, 'unavailable.jsonl');
  writeFileSync(unavailable, header(sessionId));
  spec.save(unavailable);
  const available = join(spec.root, 'available.jsonl');
  if (duplicate) { writeFileSync(available, header(sessionId)); spec.save(available); }
  return { ...spec, sessionId, unavailable, available };
}

const unreadableScript = `
  import promises from 'node:fs/promises';
  import { syncBuiltinESMExports } from 'node:module';
  import { TranscriptSources } from './packages/daemon/src/api/transcript-sources.ts';
  const { root, path, sessionId, checkpoints } = JSON.parse(process.argv[1]);
  let unreadable = true;
  let attempts = 0;
  const originalOpen = promises.open;
  promises.open = async (candidate, ...args) => {
    if (candidate === path) {
      attempts++;
      if (unreadable) throw Object.assign(new Error('Temporarily unreadable'), { code: 'EACCES' });
    }
    return originalOpen(candidate, ...args);
  };
  syncBuiltinESMExports();
  const index = new TranscriptSources({ checkpoints: async () => checkpoints }, [root]);
  const initial = await index.resolve(sessionId);
  await index.resolve('unrelated');
  await index.resolve(sessionId);
  const pendingAttempts = attempts;
  unreadable = false;
  const recovered = await index.resolve(sessionId);
  const recoveredAttempts = attempts;
  await index.resolve('unrelated-after-recovery');
  process.stdout.write(JSON.stringify({ initial: initial?.path ?? null, recovered: recovered?.path ?? null,
    pendingAttempts, recoveredAttempts, settledAttempts: attempts }));
`;

for (const duplicate of [false, true]) {
  test(`first-discovery hardlink failure recovers ${duplicate ? 'duplicate ambiguity' : 'a solo session'} without checkpoint changes`, async t => {
    const { root, positions, index, sessionId, unavailable, available } = recoveryFixture(t, duplicate);
    const alias = join(root, 'alias.jsonl');
    linkSync(unavailable, alias);
    assert.equal((await index.resolve(sessionId))?.path, duplicate ? available : undefined);
    assert.equal(await index.resolve('unrelated'), undefined);
    rmSync(alias);
    assert.equal(statSync(unavailable).mtimeMs, positions[0].mtimeMs);
    assert.equal((await index.resolve(sessionId))?.path, duplicate ? undefined : unavailable);
  });

  test(`unknown unreadable headers are retried on every lookup and recover ${duplicate ? 'duplicate ambiguity' : 'a solo session'}`, t => {
    const { root, positions, sessionId, unavailable, available } = recoveryFixture(t, duplicate);
    const input = JSON.stringify({ root, path: unavailable, sessionId, checkpoints: positions });
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', unreadableScript, input], {
      cwd: new URL('../../../../', import.meta.url), encoding: 'utf8', timeout: 30_000,
    }));
    assert.equal(result.initial, duplicate ? available : null);
    assert.equal(result.pendingAttempts, 3, 'including an unrelated session lookup while the header is unknown');
    assert.equal(result.recoveredAttempts, 4, 'recovery is retried without checkpoint changes');
    assert.equal(result.recovered, duplicate ? null : unavailable);
    assert.equal(result.settledAttempts, 4, 'a successfully learnt header no longer needs discovery');
  });
}

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
