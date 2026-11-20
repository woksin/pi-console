// No secret ever leaves through the API or SSE: not via the ingestion path (adapters redact) and not even when an
// event in the log carries one (the API boundary scans every string again on the way out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewEvent } from '@pi-console/contract';
import { testEvent } from '@pi-console/core/testing';
import { call, openStream, secretShapes, secretsIn } from '@pi-console/testkit';
import { sessionStarted, specDaemon } from './testing/harness.ts';

const routes = ['/overview', '/sessions', '/sessions/s1', '/sessions/s1/transcript', '/requests', '/questions', '/messages', '/jobs', '/needs-you', '/graph', '/health', '/settings'];

async function everything(port: number, token: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}` };
  const bodies = await Promise.all(routes.map(async path => (await call(port, `/api/v1${path}`, { headers })).text));
  const stream = await openStream(port, headers);
  const snapshot = await stream.next();
  stream.close();
  return [...bodies, JSON.stringify(snapshot)].join('\n');
}

const leakingEvents = (): NewEvent[] => secretShapes.flatMap((secret, index) => [
  testEvent(10 + index * 3, 'MessageSent', { messageId: `leak-m${index}`, from: 'L1', to: 'L2', excerpt: secret.value.slice(0, 200), withheld: false }),
  testEvent(11 + index * 3, 'QuestionAsked', { questionId: `leak-q${index}`, asker: 's1', kind: 'question', options: [secret.value], urgency: 'high', blocking: true, excerpt: `see ${secret.value}`.slice(0, 200) }),
  testEvent(12 + index * 3, 'SessionStarted', { sessionId: `leak-s${index}`, cwd: `/repo/${secret.value}`, model: secret.value, role: 'main', parentSessionId: null }),
]);

test('secrets that reached the log are scanned out of every API body and the SSE snapshot', async t => {
  const spec = await specDaemon([sessionStarted(1, 's1'), ...leakingEvents()]);
  t.after(() => spec.close());
  const output = await everything(spec.daemon.port, spec.token);
  assert.deepEqual(secretsIn(output), []);
  assert.ok(output.includes('leak-m0'), 'the events themselves are still served');
});

test('secrets in SSE deltas are scanned out as well', async t => {
  const spec = await specDaemon([sessionStarted(1, 's1')]);
  t.after(() => spec.close());
  const stream = await openStream(spec.daemon.port, { Authorization: `Bearer ${spec.token}` });
  await stream.next();
  await spec.daemon.log.append(leakingEvents());
  const frames: string[] = [];
  for (let i = 0; i < secretShapes.length * 2; i++) frames.push(JSON.stringify(await stream.next()));
  stream.close();
  assert.deepEqual(secretsIn(frames.join('\n')), []);
});

test('terminal escapes and bidi overrides never reach a client', async t => {
  const hostile = 'red\u001b[31m\u0007bell\u202eevil\u0085';
  const spec = await specDaemon([sessionStarted(1, 's1'), testEvent(2, 'MessageSent', { messageId: 'x', from: 'L1', to: 'L2', excerpt: hostile, withheld: false })]);
  t.after(() => spec.close());
  const output = await everything(spec.daemon.port, spec.token);
  assert.ok(output.includes('red[31mbellevil'));
  // JSON.stringify escapes C0 controls as \u00XX; none may remain in any form.
  assert.equal(/\\u00(0[0-8b-f]|1[0-9a-f]|7f|8[0-9a-f]|9[0-9a-f])|\u001b|\u202e|\u0085/i.test(output), false);
});

test('secrets in session files never leave through the API after real ingestion', async t => {
  const sessions = mkdtempSync(join(tmpdir(), 'pi-console-sessions-'));
  t.after(() => { rmSync(sessions, { recursive: true, force: true }); });
  const root = join(sessions, 'project');
  mkdirSync(root, { recursive: true });
  const lines = [{ type: 'session', version: 3, id: 'secret-session', timestamp: new Date().toISOString(), cwd: `/repo/${secretShapes[0].value}` },
    ...secretShapes.map((secret, index) => ({
      type: 'message', id: `p${index}`, parentId: null, timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: `please use ${secret.value}` }], timestamp: Date.now() },
    }))];
  writeFileSync(join(root, 'session.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  const ingesting = await specDaemon([], { ingest: true, pollMs: 20, sessionRoots: [sessions] });
  t.after(() => ingesting.close());
  for (let i = 0; i < 200 && !ingesting.daemon.ingestion.backfillComplete; i++) await new Promise(resolve => setTimeout(resolve, 10));
  for (let i = 0; i < 200 && ingesting.daemon.log.lastSeq() === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(ingesting.daemon.log.lastSeq() > 0, 'the session file was ingested');
  assert.deepEqual(secretsIn(await everything(ingesting.daemon.port, ingesting.token)), []);
});
