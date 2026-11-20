import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscript } from './transcript.ts';

test('oversized records are withheld and paging reaches the following record', t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-transcript-large-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'session.jsonl');
  const huge = JSON.stringify({ text: 'λ'.repeat(1024 * 1024) }) + '\n';
  const next = JSON.stringify({ ok: true }) + '\n';
  writeFileSync(path, huge + next);
  for (const limitBytes of [16, 256 * 1024, 1024 * 1024]) {
    const page = readTranscript({ path, roots: [root], limitBytes });
    assert.deepEqual(page.entries, [{ withheld: true, oversize: true }]);
    assert.equal(page.nextOffset, Buffer.byteLength(huge));
    assert.deepEqual(readTranscript({ path, roots: [root], offset: page.nextOffset }).entries, [{ ok: true }]);
  }
  assert.equal(readFileSync(path, 'utf8'), huge + next);
});

test('an oversized torn tail remains resumable until its newline arrives', t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-transcript-torn-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'session.jsonl');
  writeFileSync(path, JSON.stringify({ text: 'x'.repeat(100) }));
  const request = { path, roots: [root], limitBytes: 16 };
  assert.deepEqual(readTranscript(request), { entries: [], nextOffset: 0, partial: true });
  appendFileSync(path, '\n');
  const page = readTranscript(request);
  assert.deepEqual(page.entries, [{ withheld: true, oversize: true }]);
  assert.equal(page.nextOffset, Buffer.byteLength(readFileSync(path)));
  assert.deepEqual(readTranscript({ ...request, offset: page.nextOffset }), { entries: [], nextOffset: page.nextOffset, partial: false });
});

test('transcript paging returns only complete redacted records and leaves source unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-transcript-'));
  try {
    const path = join(root, 'session.jsonl');
    const secret = 'ghp_' + 'x'.repeat(36);
    const first = JSON.stringify({ type: 'message', text: 'synthetic λ' }) + '\n';
    const second = JSON.stringify({ type: 'message', text: secret }) + '\n';
    const body = first + second + '{"torn":';
    writeFileSync(path, body);
    const page = readTranscript({ path, roots: [root], limitBytes: Buffer.byteLength(first) + 3 });
    assert.equal(page.entries.length, 1);
    assert.equal(page.nextOffset, Buffer.byteLength(first));
    assert.equal(page.partial, true);
    const next = readTranscript({ path, roots: [root], offset: page.nextOffset });
    assert.equal(next.entries.length, 1);
    assert.ok(!JSON.stringify(next).includes(secret));
    assert.equal(next.partial, true);
    assert.equal(readFileSync(path, 'utf8'), body);
    assert.throws(() => readTranscript({ path, roots: [] }));
    assert.throws(() => readTranscript({ path, roots: [root], offset: -1 }));
    assert.throws(() => readTranscript({ path, roots: [root], limitBytes: 2 ** 21 }));
    const withheld = readTranscript({ path, roots: [root], scanner: () => { throw new Error('scanner failed'); } });
    assert.ok(!JSON.stringify(withheld).includes('synthetic'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
