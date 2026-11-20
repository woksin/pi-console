import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLargeTree } from './large-tree.ts';

const sizes = { ledgerRows: 10, statusFiles: 1, registryRows: 10, questionFiles: 1, eventRows: 10 };

function sessionFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
}

test('session files are opt-in, v3, sized and parse line by line', t => {
  const base = mkdtempSync(join(tmpdir(), 'pi-console-large-'));
  t.after(() => { rmSync(base, { recursive: true, force: true }); });
  assert.deepEqual(sessionFiles(buildLargeTree(join(base, 'none'), sizes).sessionRoot), []);
  const tree = buildLargeTree(join(base, 'some'), { ...sizes, sessionFiles: 3, sessionBytes: 64 * 1024 });
  const files = sessionFiles(tree.sessionRoot);
  assert.equal(files.length, 3);
  for (const file of files) {
    const size = statSync(file).size;
    assert.ok(size >= 64 * 1024 && size < 96 * 1024, `${file}: ${size}`);
    const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line) as { type: string; version?: number });
    assert.equal(rows[0].type, 'session');
    assert.equal(rows[0].version, 3);
    assert.ok(rows.some(row => (row as { message?: { toolName?: string } }).message?.toolName === 'job_start'));
  }
});
