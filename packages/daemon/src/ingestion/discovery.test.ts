import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverFiles, discoverFilesSliced } from './source-table.ts';

const since = Date.parse('2026-05-01T00:00:00Z');

function fixture(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(join(tmpdir(), 'console-discovery-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  for (const name of ['nested', 'credentials', '.env-private', 'empty']) mkdirSync(join(root, name));
  for (const name of ['2026-05-02.jsonl', '2020-01-01.jsonl', 'other.json', 'nested/inside.jsonl', 'credentials/secret.jsonl', '.env-private/secret.jsonl']) {
    writeFileSync(join(root, name), '{}');
  }
  utimesSync(join(root, '2020-01-01.jsonl'), 0, 0);
  symlinkSync(join(root, 'nested'), join(root, 'linked'));
  return root;
}

test('sliced discovery keeps sorted scope, window and symlink rules identical to synchronous discovery', async t => {
  const root = fixture(t);
  for (const window of ['mtime', 'name-date', 'none'] as const) {
    for (const recursive of [false, true]) {
      const scope = { extension: '.jsonl', window, recursive };
      assert.deepEqual(await discoverFilesSliced(root, scope, since), discoverFiles(root, scope, since));
    }
  }
  assert.deepEqual(await discoverFilesSliced(root, { extension: '.jsonl' }, since), [join(root, '2026-05-02.jsonl'), join(root, 'nested/inside.jsonl')]);
  for (const path of ['missing', 'linked', 'credentials']) {
    assert.deepEqual(await discoverFilesSliced(join(root, path), { extension: '.jsonl' }, since), []);
  }
});

test('discovery gives macrotasks a turn even when scanning empty directories', async t => {
  const root = fixture(t);
  let clock = 0;
  t.mock.method(performance, 'now', () => { clock += 3; return clock; });
  let served = false;
  setImmediate(() => { served = true; });
  assert.deepEqual(await discoverFilesSliced(root, { extension: '.absent' }, since), []);
  assert.ok(served, 'HTTP and timers can run before discovery completes');
});
