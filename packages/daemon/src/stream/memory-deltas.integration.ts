import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, openStream } from '@pi-console/testkit';
import { apiV1Schema, validate, type Event, type MemoryItem, type Session, type SessionMemory, type Snapshot } from '@pi-console/contract';
import { memoryDaemon } from '../testing/memory-live.ts';

async function eventually(check: () => Promise<boolean>): Promise<void> {
  for (let n = 0; n < 150; n++) { if (await check()) return; await new Promise(resolve => { setTimeout(resolve, 20); }); }
  assert.fail('canonical memory did not converge');
}

test('real memory producer append reaches canonical REST and additive existing SSE name', { timeout: 15000 }, async () => {
  const spec = await memoryDaemon();
  const stream = await openStream(spec.daemon.port, spec.headers);
  const frames: unknown[] = [];
  const marked = async () => {
    for (let n = 0; n < 30; n++) {
      const frame = await stream.next();
      const event = frame.data as Event; frames.push(event);
      validate(event, apiV1Schema.$defs.event, apiV1Schema);
      assert.ok(['snapshot', 'session.updated', 'request.added', 'question.opened', 'question.answered', 'message.added', 'job.updated', 'work.updated', 'transcript.appended', 'needs-you.changed', 'health.updated'].includes(frame.event ?? ''));
      if (event.type === 'session.updated' && event.payload.memoryChanged) {
        assert.equal(event.payload.id, 's1');
        assert.equal(Object.hasOwn(event.payload, 'items'), false);
        return;
      }
    }
    assert.fail('no memory marker');
  };
  const summary = async () => (await call(spec.daemon.port, '/api/v1/sessions/s1/memory', { headers: spec.headers })).body as SessionMemory;
  const items = async () => ((await call(spec.daemon.port, '/api/v1/memory-items?sessionId=s1', { headers: spec.headers })).body as { items: MemoryItem[] }).items;
  try {
    const initial = await stream.next();
    assert.equal(initial.event, 'snapshot');
    assert.equal(Object.hasOwn((initial.data as { payload: Snapshot }).payload.sessions[0], 'memoryChanged'), false);
    spec.add(); await marked();
    await eventually(async () => (await items())[0]?.status === 'proposed');
    assert.equal((await summary()).counts.proposed, 1);
    spec.confirm(); await marked();
    await eventually(async () => (await items())[0]?.status === 'active');
    assert.equal((await items())[0].statusBasis, 'recorded');
    spec.retire(); await marked();
    await eventually(async () => (await items())[0]?.status === 'done');
    spec.journal(); await marked();
    await eventually(async () => (await summary()).unresolved.lowerBound === 1);
    spec.classify(); await marked();
    await eventually(async () => (await summary()).unresolved.lowerBound === 0);
    assert.equal(JSON.stringify(frames).includes('PRIVATE JOURNAL BODY'), false);
    assert.equal(JSON.stringify(frames).includes('Synthetic live order'), false, 'SSE is invalidation-only');
    const sessions = await call(spec.daemon.port, '/api/v1/sessions', { headers: spec.headers });
    assert.equal(Object.hasOwn((sessions.body as { items: Session[] }).items[0], 'memoryChanged'), false);
  } finally { stream.close(); await spec.close(); }
});
