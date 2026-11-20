import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { redact, type Scanner } from './redact.ts';
import { FileTailer } from './tailer.ts';
import { MemoryLog } from './memory-log.test.ts';

// Load the shared synthetic fixture resource without coupling the production project to testkit.
const { secretShapes } = await import(new URL('../../../testkit/src/secret-shapes.ts', import.meta.url).href) as {
  secretShapes: { name: string; value: string; needle: string }[];
};

for (const secret of secretShapes) {
  test(`secret sweep: ${secret.name} is absent from EventLog events and checkpoints`, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-console-sweep-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, 'session.jsonl');
    writeFileSync(file, JSON.stringify({ text: secret.value }) + '\n');
    const log = new MemoryLog();
    const tailer = new FileTailer(log, 'session-jsonl', record => [{
      type: 'SessionHeartbeat', subject: 'session:fixture', payload: { sessionId: 'fixture', status: String(record.text) },
    }]);
    t.after(() => tailer.close());
    await tailer.poll([file]);
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].type, 'SessionHeartbeat');
    assert.equal(JSON.stringify([log.rows, log.positions]).includes(secret.needle), false);
  });
}

test('scanner exceptions and invalid returns fail closed; excerpts are at most 200 characters', () => {
  for (const scanner of [(() => { throw new Error('sensitive exception'); }), (() => null), (() => 42)] as unknown as Scanner[]) {
    assert.deepEqual(redact('private body', scanner), { withheld: true });
  }
  assert.equal(redact('x'.repeat(1000)).text?.length, 200);
  const secret = secretShapes[2];
  const excerpt = redact('x'.repeat(190) + ' ' + secret.value).text!;
  assert.equal(excerpt.includes(secret.value.slice(0, 8)), false);
});
