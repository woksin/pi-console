import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from '@pi-console/testkit';
import { specDaemon } from '../testing/harness.ts';

test('hostile v3 session header ids are ingested as data without poisoning the daemon', async t => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const sessions = mkdtempSync(join(tmpdir(), 'pi-console-hostile-'));
  t.after(() => { rmSync(sessions, { recursive: true, force: true }); });
  const root = join(sessions, 'project');
  mkdirSync(root);
  const ids = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
  for (const [index, id] of ids.entries()) {
    writeFileSync(join(root, `${index}.jsonl`), JSON.stringify({ type: 'session', version: 3, id,
      timestamp: new Date().toISOString(), cwd: '/repo' }) + '\n');
  }
  const spec = await specDaemon([], { ingest: true, pollMs: 20, sessionRoots: [sessions] });
  t.after(() => spec.close());
  for (let i = 0; i < 200 && !spec.daemon.ingestion.backfillComplete; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(spec.daemon.ingestion.backfillComplete);
  const reply = await call(spec.daemon.port, '/api/v1/sessions', { headers: { Authorization: `Bearer ${spec.token}` } });
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.items.map((session: { id: string }) => session.id).sort(), ids.sort());
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});
