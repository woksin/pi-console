import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seekStart, windowed } from './window.ts';

const timeOf = (line: string): number => Date.parse((JSON.parse(line) as { ts: string }).ts);
const row = (ms: number) => JSON.stringify({ ts: new Date(ms).toISOString(), pad: 'x'.repeat(40) }) + '\n';

function seek(content: string, since: number): number {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-seek-'));
  try {
    const file = join(directory, 'f.jsonl');
    writeFileSync(file, content);
    const fd = openSync(file, 'r');
    try { return seekStart(fd, Buffer.byteLength(content), since, timeOf); } finally { closeSync(fd); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('seekStart returns the offset of the first row at or after the cutoff, on a line start', () => {
  const rows = Array.from({ length: 4_000 }, (_, i) => row(1_000_000 + i * 1_000));
  const content = rows.join('');
  const index = 2_345;
  const offset = seek(content, 1_000_000 + index * 1_000);
  assert.equal(offset, Buffer.byteLength(rows.slice(0, index).join('')));
});

test('seekStart handles an empty file, a cutoff before everything and a cutoff after everything', () => {
  assert.equal(seek('', 5), 0);
  const content = row(10) + row(20);
  assert.equal(seek(content, 0), 0);
  assert.equal(seek(content, 100), Buffer.byteLength(content));
});

test('windowed skips rows older than the cutoff and passes undated rows to the mapper', () => {
  const seen: unknown[] = [];
  const mapper = windowed(record => { seen.push(record); return []; }, 'queuedAt', 1_000);
  mapper({ queuedAt: new Date(999).toISOString() });
  mapper({ queuedAt: new Date(1_000).toISOString() });
  mapper({ queuedAt: 'nonsense' });
  mapper({});
  assert.equal(seen.length, 3);
});
