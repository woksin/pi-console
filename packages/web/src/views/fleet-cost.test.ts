import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '@pi-console/contract';
import { fleetCostCell, partialCostExplanation } from './fleet-cost.ts';

const session = (patch: Partial<Session>): Session => ({
  id: 's', repositoryId: 'r', name: 'n', laneId: 'l', branch: '', cwd: '/', role: 'main', parentSessionId: null, orchestratorSessionId: 's',
  model: 'm', status: 'idle', startedAt: '', updatedAt: '', contextPercent: 0, samples: [], ...patch,
});

test('an incomplete known cost is a lower bound with an explanation', () => {
  assert.deepEqual(fleetCostCell(session({ costUsd: 1.76, costIncomplete: true })), { text: '≥$1.76', spoken: `at least $1.76. ${partialCostExplanation}`, title: partialCostExplanation });
});

test('a complete cost has no marker or tooltip', () => {
  assert.deepEqual(fleetCostCell(session({ costUsd: 1.76 })), { text: '$1.76' });
});

test('an actual zero is $0.00 while an unknown cost stays a dash', () => {
  assert.deepEqual(fleetCostCell(session({ costUsd: 0 })), { text: '$0.00' });
  assert.deepEqual(fleetCostCell(session({ costUsd: null })), { text: '—', spoken: 'cost unknown' });
  assert.equal(fleetCostCell(session({})).text, '—');
});

test('a cost derived from samples is recognised and an incomplete unknown cost is not marked', () => {
  assert.equal(fleetCostCell(session({ samples: [{ costUsd: 0.5 }, { costUsd: 0.25 }] as Session['samples'] })).text, '$0.75');
  assert.equal(fleetCostCell(session({ costUsd: null, costIncomplete: true })).text, '—');
});
