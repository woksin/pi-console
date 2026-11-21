import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionMapper } from '@pi-console/adapters';
import type { Request } from '@pi-console/contract';
import { testEvent } from '@pi-console/core/testing';
import { call, openStream } from '@pi-console/testkit';
import { specDaemon } from '../testing/harness.ts';

const mapped = (n: number, record: Record<string, unknown>) => sessionMapper('s1')({
  id: `e${n}`, timestamp: `2026-01-01T00:00:0${n}.000Z`, ...record,
}).map(fact => testEvent(n, fact.type, fact.payload));

const header = mapped(1, { type: 'session', version: 3, id: 's1', cwd: '/repo' });
const prompt = mapped(2, { type: 'message', message: { role: 'user', content: 'Please answer' } });

for (const [name, record, status, deltaType] of [
  ['answer', { type: 'message', message: { role: 'assistant', stopReason: 'stop', content: 'The answer' } }, 'answered', 'request.observed'],
  ['abort', { type: 'message', message: { role: 'assistant', stopReason: 'aborted', content: '' } }, 'interrupted', 'request.interrupted'],
  ['reset', { type: 'compaction' }, 'interrupted', 'request.interrupted'],
] as const) {
  test(`a connected client receives the request changed by a mapper-shaped raw ${name}`, async t => {
    const spec = await specDaemon([...header, ...prompt]);
    t.after(() => spec.close());
    const headers = { Authorization: `Bearer ${spec.token}` };
    const stream = await openStream(spec.daemon.port, headers);
    t.after(() => { stream.close(); });
    assert.equal((await stream.next()).event, 'snapshot');
    const events = mapped(3, record);
    assert.equal(Object.hasOwn(events[0].payload as object, 'requestId'), false);
    await spec.daemon.log.append(events);
    if (name === 'reset') assert.equal((await stream.next()).event, 'reset.occurred');
    const entity = await stream.next();
    assert.equal(entity.event, deltaType);
    const request = (entity.data as { payload: Request }).payload;
    assert.equal(request.id, 's1:e2');
    assert.equal(request.status, status);
    if (name === 'answer') assert.equal(request.answer?.id, 's1:e3');
    if (name === 'reset') assert.equal(request.resetId, 'e3');
    const current = await call(spec.daemon.port, '/api/v1/requests', { headers });
    assert.equal(current.status, 200);
    assert.deepEqual((current.body as { items: Request[] }).items, [request]);
  });
}
