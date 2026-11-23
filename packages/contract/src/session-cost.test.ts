import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiV0Schema, apiV1Schema } from './api.ts';
import { definitionOf, payloadValid } from './catalogue.ts';
import { validate } from './validate.ts';

const session = {
  id: 's1', repositoryId: '/work/repo', name: 'repo', laneId: 'unassigned', role: 'main', parentSessionId: null,
  orchestratorSessionId: 's1', branch: '', cwd: '/work/repo', model: '', status: 'idle',
  startedAt: '2026-07-01T09:00:00Z', updatedAt: '2026-07-01T09:00:00Z', contextPercent: 0, samples: [],
};

test('v1 session costs are optional, nullable and nonnegative, including on updates and pages', () => {
  validate(session, apiV0Schema.$defs.session, apiV0Schema);
  validate(session, apiV1Schema.$defs.session, apiV1Schema);
  for (const costUsd of [null, 0, 1.25]) {
    const enriched = { ...session, costUsd, costIncomplete: true };
    validate(enriched, apiV1Schema.$defs.session, apiV1Schema);
    validate({ items: [enriched], nextCursor: null, hasMore: false, total: 1 }, apiV1Schema.$defs.sessionPage, apiV1Schema);
    validate({ seq: 1, type: 'session.updated', occurredAt: session.updatedAt, payload: { ...enriched, memoryChanged: true } }, apiV1Schema.$defs.event, apiV1Schema);
  }
  for (const costUsd of [-1, '0', false]) assert.throws(() => validate({ ...session, costUsd }, apiV1Schema.$defs.session, apiV1Schema));
  assert.throws(() => validate({ ...session, costIncomplete: 'true' }, apiV1Schema.$defs.session, apiV1Schema));
});

test('assistant costs have a session-only source and lane metadata remains additive', () => {
  const cost = definitionOf('SessionCostObserved')!;
  assert.deepEqual(cost.sources, ['session-jsonl']);
  for (const costUsd of [null, 0, 1.5]) assert.equal(payloadValid(cost, { sessionId: 's', entryId: 'e', costUsd }), null);
  assert.ok(payloadValid(cost, { sessionId: 's', entryId: 'e', costUsd: -1 }));
  const lane = definitionOf('LaneRegistered')!;
  assert.equal(payloadValid(lane, { laneId: 'L1', name: 'L1' }), null);
  assert.equal(payloadValid(lane, { laneId: 'L1', name: 'L1', cwd: '/work/repo', branch: null }), null);
});
