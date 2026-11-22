import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEnd, recordSpans } from './framing.ts';

test('framing retains UTF-8 byte offsets, blank lines, CRLF and a torn tail', () => {
  const bytes = Buffer.from('λ\r\n\n{}\npartial');
  assert.deepEqual([...recordSpans(bytes)], [{ start: 0, end: 4 }, { start: 4, end: 5 }, { start: 5, end: 8 }]);
});

test('oversize scanner reuses a bounded buffer, yields, and never scans beyond captured EOF', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-framing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'source.jsonl');
  writeFileSync(path, 'x'.repeat(1024));
  const fd = openSync(path, 'r');
  t.after(() => closeSync(fd));
  appendFileSync(path, '\nnext\n');
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const bytes = Buffer.alloc(16);
  assert.equal(await recordEnd(fd, 0, 1024, bytes), undefined);
  assert.equal(yielded, true);
  assert.equal(await recordEnd(fd, 0, 1030, bytes), 1025);
  assert.equal(await recordEnd(fd, 1025, 1030, bytes), 1030);
});
