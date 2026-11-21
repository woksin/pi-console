import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscript } from './transcript.ts';

// A child timeout also bounds a regression to a blocking FIFO open.
const raceScript = `
  import fs from 'node:fs';
  import promises from 'node:fs/promises';
  import { syncBuiltinESMExports } from 'node:module';
  import { dirname } from 'node:path';
  import { spawnSync } from 'node:child_process';
  import { readTranscript } from './packages/adapters/src/transcript.ts';
  const [path, outside, replacement] = process.argv.slice(1);
  const root = dirname(path);
  let replaced = false, opened = 0, closed = 0, reads = 0;
  const replacements = {
    fifo: () => { if (spawnSync('mkfifo', [path]).status !== 0) throw new Error('mkfifo failed'); },
    symlink: () => fs.symlinkSync(outside, path),
    directory: () => fs.mkdirSync(path),
    normal: () => fs.writeFileSync(path, '{"safe":true}\\n'),
    'read-error': () => fs.writeFileSync(path, '{"safe":true}\\n'),
  };
  function replace(candidate) {
    if (replaced || candidate !== path) return;
    replaced = true;
    if (replacement === 'ancestor') {
      fs.renameSync(root, root + '-moved');
      fs.symlinkSync(root + '-moved', root);
    } else {
      fs.rmSync(path);
      replacements[replacement]();
    }
  }
  const originalSyncOpen = fs.openSync;
  const originalSyncRead = fs.readSync;
  const originalSyncClose = fs.closeSync;
  fs.openSync = (candidate, ...args) => { replace(candidate); const fd = originalSyncOpen(candidate, ...args); opened++; return fd; };
  fs.readSync = (...args) => { reads++; return originalSyncRead(...args); };
  fs.closeSync = (...args) => { const result = originalSyncClose(...args); closed++; return result; };
  const originalOpen = promises.open;
  promises.open = async (candidate, ...args) => {
    replace(candidate);
    const handle = await originalOpen(candidate, ...args);
    opened++;
    const read = handle.read.bind(handle);
    handle.read = (...args) => { reads++; if (replacement === 'read-error') throw new Error('read failed'); return read(...args); };
    const close = handle.close.bind(handle);
    handle.close = async () => { await close(); closed++; };
    return handle;
  };
  syncBuiltinESMExports();
  let entries = [];
  try { entries = (await readTranscript({ path, roots: [root], resolvedRoots: [root] })).entries; }
  catch { /* A rejected replacement must expose no bytes. */ }
  process.stdout.write(JSON.stringify({ replaced, entries, reads, unclosed: opened - closed }));
`;

for (const replacement of ['fifo', 'symlink', 'directory', 'ancestor', 'read-error', 'normal']) {
  test(`transcripts validate ${replacement} replacement and close the descriptor`, { skip: process.platform === 'win32', timeout: 5000 }, t => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'pi-transcript-open-')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const root = join(directory, 'root');
    mkdirSync(root);
    const path = join(root, 'session.jsonl');
    const outside = join(directory, 'outside.jsonl');
    writeFileSync(path, '{"original":true}\n');
    writeFileSync(outside, '{"outside":true}\n');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', raceScript, path, outside, replacement], {
      cwd: new URL('../../..', import.meta.url), encoding: 'utf8', timeout: 2000,
    });
    assert.equal(child.error, undefined, child.error);
    assert.equal(child.status, 0, child.stderr);
    const reads = ['normal', 'read-error'].includes(replacement) ? 1 : 0;
    assert.deepEqual(JSON.parse(child.stdout), { replaced: true, entries: replacement === 'normal' ? [{ safe: true }] : [], reads, unclosed: 0 });
  });
}

test('configured transcript root aliases resolve at call time, while supplied pins cannot be retargeted', { skip: process.platform === 'win32' }, async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'pi-transcript-roots-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'root');
  const outside = join(directory, 'outside');
  const alias = join(directory, 'alias');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(root, 'session.jsonl'), '{"original":true}\n');
  writeFileSync(join(outside, 'session.jsonl'), '{"outside":true}\n');
  symlinkSync(root, alias);
  assert.deepEqual((await readTranscript({ path: join(alias, 'session.jsonl'), roots: [alias] })).entries, [{ original: true }]);
  rmSync(alias);
  symlinkSync(outside, alias);
  assert.deepEqual((await readTranscript({ path: join(alias, 'session.jsonl'), roots: [alias] })).entries, [{ outside: true }]);
  const request = { path: join(root, 'session.jsonl'), roots: [alias], resolvedRoots: [root] };
  assert.deepEqual((await readTranscript(request)).entries, [{ original: true }]);
  await assert.rejects(async () => readTranscript({ ...request, resolvedRoots: [] }), /Source outside configured roots/);
  renameSync(root, `${root}-moved`);
  symlinkSync(outside, root);
  await assert.rejects(async () => readTranscript(request), /Source outside configured roots/);
});
