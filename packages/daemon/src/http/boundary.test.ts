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

test('request, answer and question SSE entity deltas also update derived session status without snapshots', async t => {
  const spec = await specDaemon([testEvent(1, 'SessionStarted', { sessionId: 's1', cwd: '/repo', model: null, role: 'main', parentSessionId: null })]);
  t.after(() => spec.close());
  const headers = { Authorization: `Bearer ${spec.token}` };
  const stream = await openStream(spec.daemon.port, headers);
  t.after(() => { stream.close(); });
  let seq = Number((await stream.next()).id);
  for (const [event, status, count] of [
    [testEvent(2, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'human', originEvidence: 'spec' }), 'needs-you', 1],
    [testEvent(3, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false }), 'idle', 0],
    [testEvent(4, 'QuestionAsked', { questionId: 'q1', asker: 's1', kind: 'question', urgency: 'normal', blocking: true }), 'needs-you', 1],
    [testEvent(5, 'QuestionAnswered', { questionId: 'q1' }), 'idle', 0],
  ] as const) {
    await spec.daemon.log.append([event]);
    const entity = await stream.next();
    const session = await stream.next();
    assert.equal(entity.event, event.type.startsWith('Question') ? 'question.asked' : 'request.observed');
    assert.equal(session.event, 'session.updated');
    assert.equal(session.data.payload.id, 's1');
    assert.equal(session.data.payload.status, status);
    assert.deepEqual([Number(entity.id), Number(session.id)], [seq + 1, seq + 2]);
    seq += 2;
    const overview = await call(spec.daemon.port, '/api/v1/overview', { headers });
    assert.equal(overview.body.needsYou.length, count);
    assert.equal((await call(spec.daemon.port, '/api/v1/needs-you', { headers })).body.items.length, count);
  }
  await assert.rejects(stream.next(100));
});

test('foreign-Origin SSE is refused even with valid credentials by the actual server', async t => {
  const spec = await specDaemon([]);
  t.after(() => spec.close());
  const stream = await openStream(spec.daemon.port, { Authorization: `Bearer ${spec.token}`, Origin: 'http://evil.example' });
  try { assert.equal(stream.status, 403); }
  finally { stream.close(); }
});
