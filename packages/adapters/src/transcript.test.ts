import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscript } from './transcript.ts';

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
