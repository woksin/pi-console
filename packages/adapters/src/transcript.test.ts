import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscript, readTranscriptFrames } from './transcript.ts';

test('framed reads retain start/end bytes and safely seek around CRLF and multibyte records', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-transcript-frames-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'session.jsonl');
  const first = JSON.stringify({ text: 'λ' }) + '\r\n';
  const second = JSON.stringify({ text: 'next' }) + '\n';
  writeFileSync(path, first + '\n' + second + '{torn');
  const end = Buffer.byteLength(first + '\n' + second);
  const page = await readTranscriptFrames({ path, roots: [root] });
  assert.deepEqual(page.entries, [
    { value: { text: 'λ' }, start: 0, end: Buffer.byteLength(first) },
    { value: { text: 'next' }, start: Buffer.byteLength(first) + 1, end },
  ]);
  assert.equal(page.partial, true);
  const seek = await readTranscriptFrames({ path, roots: [root], offset: 3, seekAfter: true });
  assert.deepEqual(seek.entries, [page.entries[1]]);
  assert.deepEqual(await readTranscriptFrames({ path, roots: [root], endOffset: Buffer.byteLength(first) }), {
    entries: [page.entries[0]], nextOffset: Buffer.byteLength(first), partial: false,
  });
});

test('oversized records are withheld and paging reaches the following record', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-transcript-large-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'session.jsonl');
  const huge = JSON.stringify({ text: 'λ'.repeat(1024 * 1024) }) + '\n';
  const next = JSON.stringify({ ok: true }) + '\n';
  writeFileSync(path, huge + next);
  for (const limitBytes of [16, 256 * 1024, 1024 * 1024]) {
    const page = await readTranscript({ path, roots: [root], limitBytes });
    assert.deepEqual(page.entries, [{ withheld: true, oversize: true }]);
    assert.equal(page.nextOffset, Buffer.byteLength(huge));
    assert.deepEqual((await readTranscript({ path, roots: [root], offset: page.nextOffset })).entries, [{ ok: true }]);
  }
  assert.equal(readFileSync(path, 'utf8'), huge + next);
});

test('an oversized torn tail remains resumable until its newline arrives', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-transcript-torn-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'session.jsonl');
  writeFileSync(path, JSON.stringify({ text: 'x'.repeat(100) }));
  const request = { path, roots: [root], limitBytes: 16 };
  assert.deepEqual(await readTranscript(request), { entries: [], nextOffset: 0, partial: true });
  appendFileSync(path, '\n');
  const page = await readTranscript(request);
  assert.deepEqual(page.entries, [{ withheld: true, oversize: true }]);
  assert.equal(page.nextOffset, Buffer.byteLength(readFileSync(path)));
  assert.deepEqual(await readTranscript({ ...request, offset: page.nextOffset }), { entries: [], nextOffset: page.nextOffset, partial: false });
});

test('transcript paging returns only complete redacted records and leaves source unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-transcript-'));
  try {
    const path = join(root, 'session.jsonl');
    const secret = 'ghp_' + 'x'.repeat(36);
    const first = JSON.stringify({ type: 'message', text: 'synthetic λ' }) + '\n';
    const second = JSON.stringify({ type: 'message', text: secret }) + '\n';
    const body = first + second + '{"torn":';
    writeFileSync(path, body);
    const page = await readTranscript({ path, roots: [root], limitBytes: Buffer.byteLength(first) + 3 });
    assert.equal(page.entries.length, 1);
    assert.equal(page.nextOffset, Buffer.byteLength(first));
    assert.equal(page.partial, true);
    const next = await readTranscript({ path, roots: [root], offset: page.nextOffset });
    assert.equal(next.entries.length, 1);
    assert.ok(!JSON.stringify(next).includes(secret));
    assert.equal(next.partial, true);
    assert.equal(readFileSync(path, 'utf8'), body);
    await assert.rejects(async () => readTranscript({ path, roots: [] }));
    await assert.rejects(async () => readTranscript({ path, roots: [root], offset: -1 }));
    await assert.rejects(async () => readTranscript({ path, roots: [root], limitBytes: 2 ** 21 }));
    const withheld = await readTranscript({ path, roots: [root], scanner: () => { throw new Error('scanner failed'); } });
    assert.ok(!JSON.stringify(withheld).includes('synthetic'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
