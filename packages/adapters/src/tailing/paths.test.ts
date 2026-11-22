import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { discover } from './paths.ts';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const healthy = join(root, 'healthy.jsonl');
  writeFileSync(healthy, '{}\n');
  return { root, healthy };
}

function restoreBuiltins(t: TestContext): void {
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

for (const kind of ['missing', 'non-directory']) {
  test(`discovery reports a ${kind} root without throwing when a handler is provided`, t => {
    const { root } = fixture(t);
    const broken = join(root, 'broken');
    if (kind === 'non-directory') writeFileSync(broken, 'not a directory');
    const failures: { path: string; error: NodeJS.ErrnoException }[] = [];
    assert.deepEqual(discover(broken, 0, (path, error) => { failures.push({ path, error: error as NodeJS.ErrnoException }); }), []);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].path, broken);
    assert.equal(failures[0].error.code, kind === 'missing' ? 'ENOENT' : 'ENOTDIR');
    assert.throws(() => discover(broken, 0), { code: failures[0].error.code });
  });
}

for (const race of ['missing-directory', 'non-directory', 'missing-file']) {
  test(`discovery isolates a ${race} race after directory enumeration`, t => {
    const { root, healthy } = fixture(t);
    const broken = join(root, race === 'missing-file' ? 'broken.jsonl' : 'broken');
    if (race === 'missing-file') writeFileSync(broken, '{}\n');
    else mkdirSync(broken);
    const read = fs.readdirSync;
    t.mock.method(fs, 'readdirSync', (...args: Parameters<typeof read>) => {
      const entries = Reflect.apply(read, fs, args);
      if (String(args[0]) === root) {
        rmSync(broken, { recursive: true });
        if (race === 'non-directory') writeFileSync(broken, 'replaced');
      }
      return entries;
    });
    restoreBuiltins(t);
    const failures: { path: string; error: NodeJS.ErrnoException }[] = [];
    assert.deepEqual(discover(root, 0, (path, error) => { failures.push({ path, error: error as NodeJS.ErrnoException }); }), [healthy]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].path, broken);
    assert.equal(failures[0].error.code, race === 'non-directory' ? 'ENOTDIR' : 'ENOENT');
  });
}

for (const failure of [Object.assign(new Error('unreadable subtree'), { code: 'EACCES' }), new Error('unexpected discovery failure')]) {
  test(`discovery reports ${failure.message} and preserves healthy siblings`, t => {
    const { root, healthy } = fixture(t);
    const broken = join(root, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, 'hidden.jsonl'), '{}\n');
    const read = fs.readdirSync;
    t.mock.method(fs, 'readdirSync', (...args: Parameters<typeof read>) => {
      if (String(args[0]) === broken) throw failure;
      return Reflect.apply(read, fs, args);
    });
    restoreBuiltins(t);
    const failures: unknown[][] = [];
    assert.deepEqual(discover(root, 0, (path, error) => { failures.push([path, error]); }), [healthy]);
    assert.deepEqual(failures, [[broken, failure]]);
    assert.throws(() => discover(root, 0), error => error === failure);
  });
}

test('isolated discovery still denies private names and symlinks without reporting them as errors', t => {
  const { root, healthy } = fixture(t);
  const denied = join(root, 'credentials');
  mkdirSync(denied);
  writeFileSync(join(denied, 'private.jsonl'), '{}\n');
  symlinkSync(root, join(root, 'loop'));
  symlinkSync(healthy, join(root, 'linked.jsonl'));
  const failures: unknown[] = [];
  assert.deepEqual(discover(root, 0, (_path, error) => { failures.push(error); }), [healthy]);
  assert.deepEqual(failures, []);
});
