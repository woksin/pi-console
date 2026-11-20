import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { Projector } from '../projector/projector.ts';
import { scenario } from '../testing/scenario.ts';
import { testEvent } from '../testing/events.ts';
import { canonicalJson } from '../projector/canonical.ts';
import { ConsoleQueries } from './console-queries.ts';
import { deltaFor } from './deltas.ts';

test('point DTOs equal list DTOs including hidden placeholders and adversarial ids', async () => {
  const log = new SqliteEventLog(':memory:');
  try {
    const adversarial = ['__proto__', 'constructor'].flatMap((id, index) => [
      testEvent(8000 + index * 10, 'SessionStarted', { sessionId: id, cwd: '/spec', role: 'main', model: null, parentSessionId: null }),
      testEvent(8001 + index * 10, 'JobStarted', { jobId: id, kind: 'job', name: id }),
      testEvent(8002 + index * 10, 'QuestionAsked', { questionId: id, kind: 'question', urgency: 'normal', blocking: true }),
      testEvent(8003 + index * 10, 'MessageSent', { messageId: id, from: id, to: id }),
      testEvent(8004 + index * 10, 'RequestObserved', { requestId: id, sessionId: id, origin: 'human', originEvidence: 'spec' }),
    ]);
    await log.append([...scenario({ count: 200, rawRequests: true }), ...adversarial,
      testEvent(9000, 'MessageRead', { messageId: 'placeholder' }),
      testEvent(9001, 'QuestionClosed', { questionId: 'placeholder' })]);
    const projector = new Projector(log, consoleProjections());
    await projector.catchUp();
    const queries = new ConsoleQueries(() => readModels(projector), () => new Date('2026-01-01'));
    const pairs = [
      [queries.sessions(), (id: string) => queries.sessionById(id)],
      [queries.jobs(), (id: string) => queries.jobById(id)],
      [queries.questions(), (id: string) => queries.questionById(id)],
      [queries.requests(), (id: string) => queries.requestById(id)],
      [queries.messages(), (id: string) => queries.messageById(id)],
      [queries.resets(), (id: string) => queries.resetById(id)],
    ] as const;
    for (const [list, lookup] of pairs) {
      for (const entity of list) assert.equal(canonicalJson(lookup(entity.id)), canonicalJson(list.find(first => first.id === entity.id)));
      assert.equal(lookup('missing'), undefined);
    }
    assert.equal(queries.messageById('placeholder'), undefined);
    assert.equal(queries.questionById('placeholder'), undefined);
    const find = (items: { id: string }[], id: unknown) => items.find(item => item.id === id);
    const legacy: Record<string, [string, (payload: Record<string, unknown>) => unknown]> = {
      JobStarted: ['job.updated', p => find(queries.jobs(), p.jobId)],
      JobFinished: ['job.finished', p => find(queries.jobs(), p.jobId)],
      PhaseFinished: ['job.finished', p => find(queries.jobs(), `phase:${String(p.phaseId)}`)],
      RequestObserved: ['request.observed', p => find(queries.requests(), p.requestId)],
      QuestionAsked: ['question.asked', p => find(queries.questions(), p.questionId)],
      MessageSent: ['message.sent', p => find(queries.messages(), p.messageId)],
      ResetOccurred: ['reset.occurred', p => find(queries.resets(), p.resetId)],
    };
    const seen = new Set<string>();
    const expected = new Map<string, unknown>();
    const actual = [];
    for await (const event of log.readFrom(0)) {
      const route = legacy[event.type];
      if (!route) continue;
      const payload = route[1](event.payload as Record<string, unknown>);
      if (payload !== undefined) {
        const key = `${route[0]}:${(payload as { id: string }).id}`;
        if (!expected.has(key)) expected.set(key, { type: route[0], payload });
      }
      const delta = deltaFor(queries, event, seen);
      if (delta) actual.push(delta);
    }
    assert.equal(canonicalJson(actual), canonicalJson([...expected.values()]));
  } finally { log.close(); }
});

test('dedupe happens before point lookup and keeps finished distinct from updated', async () => {
  const log = new SqliteEventLog(':memory:');
  try {
    await log.append([testEvent(1, 'JobStarted', { jobId: 'j', name: 'j', kind: 'job' }),
      testEvent(2, 'JobFinished', { jobId: 'j', status: 'done' })]);
    const projector = new Projector(log, consoleProjections());
    await projector.catchUp();
    let lookups = 0;
    class Queries extends ConsoleQueries {
      override jobs(): never { throw new Error('list lookup'); }
      override jobById(id: string) { lookups++; return super.jobById(id); }
    }
    const queries = new Queries(() => readModels(projector));
    const events = [];
    for await (const event of log.readFrom(0)) events.push(event);
    const seen = new Set<string>();
    const types = [...events, ...events].flatMap(event => deltaFor(queries, event, seen) ?? []).map(delta => delta.type);
    assert.deepEqual(types, ['job.updated', 'job.finished']);
    assert.equal(lookups, 2);
  } finally { log.close(); }
});
