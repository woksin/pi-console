import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, openStream } from '@pi-console/testkit';
import { testEvent } from '@pi-console/core/testing';
import { specDaemon } from '../testing/harness.ts';

test('oversized headers are rejected by the actual HTTP server without disrupting subsequent requests', async t => {
  const spec = await specDaemon([]);
  t.after(() => spec.close());
  const headers = { Authorization: `Bearer ${spec.token}`, 'X-Oversized': 'x'.repeat(20 * 1024) };
  assert.equal((await call(spec.daemon.port, '/api/v1/health', { headers })).status, 431);
  assert.equal((await call(spec.daemon.port, '/api/v1/health', { headers: { Authorization: `Bearer ${spec.token}` } })).status, 200);
});

test('request and question SSE snapshots invalidate session status and needs-you after opening and closing', async t => {
  const spec = await specDaemon([testEvent(1, 'SessionStarted', { sessionId: 's1', cwd: '/repo', model: null, role: 'main', parentSessionId: null })]);
  t.after(() => spec.close());
  const headers = { Authorization: `Bearer ${spec.token}` };
  const stream = await openStream(spec.daemon.port, headers);
  t.after(() => { stream.close(); });
  await stream.next();
  for (const [event, status, count] of [
    [testEvent(2, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'human', originEvidence: 'spec' }), 'needs-you', 1],
    [testEvent(3, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false }), 'idle', 0],
    [testEvent(4, 'QuestionAsked', { questionId: 'q1', asker: 's1', kind: 'question', urgency: 'normal', blocking: true }), 'needs-you', 1],
    [testEvent(5, 'QuestionAnswered', { questionId: 'q1' }), 'idle', 0],
  ] as const) {
    await spec.daemon.log.append([event]);
    const frame = await stream.next();
    assert.equal(frame.event, 'snapshot');
    assert.equal(frame.data.payload.sessions[0].status, status);
    const overview = await call(spec.daemon.port, '/api/v1/overview', { headers });
    assert.equal(overview.body.needsYou.length, count);
  }
});

test('foreign-Origin SSE is refused even with valid credentials by the actual server', async t => {
  const spec = await specDaemon([]);
  t.after(() => spec.close());
  const stream = await openStream(spec.daemon.port, { Authorization: `Bearer ${spec.token}`, Origin: 'http://evil.example' });
  try { assert.equal(stream.status, 403); }
  finally { stream.close(); }
});
