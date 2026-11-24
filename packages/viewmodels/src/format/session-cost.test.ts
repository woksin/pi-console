import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@pi-console/contract';
import { sessionCost, sessionCostLabel, fleetCostLabel, fleetCostCoverage } from './session-cost.ts';

const session: Session = {
  id: 's', repositoryId: '/repo', name: 'repo', laneId: 'unassigned', branch: '', cwd: '/repo', role: 'main',
  parentSessionId: null, orchestratorSessionId: 's', model: '', status: 'idle', startedAt: '', updatedAt: '', contextPercent: 0, samples: [],
};
const sampled = (costUsd: number): Session => ({ ...session, samples: [{ at: '', contextPercent: 0, tokens: 0, costUsd }] });

test('unknown, explicit zero, known subtotal and legacy samples are distinct', () => {
  assert.equal(sessionCost(session), null);
  assert.equal(sessionCost(sampled(0)), null);
  assert.equal(sessionCost(sampled(1.5)), 1.5);
  assert.equal(sessionCost({ ...sampled(2), costUsd: null }), null);
  assert.equal(sessionCostLabel({ ...session, costUsd: 0 }), '$0.00');
  assert.equal(sessionCostLabel({ ...session, costUsd: 1.5, costIncomplete: true }), '≥$1.50');
  assert.equal(sessionCostLabel({ ...sampled(1), costUsd: null }), '—');
});

test('fleet totals disclose coverage without counting unknown sessions as complete zero', () => {
  assert.equal(fleetCostLabel([]), '—');
  assert.equal(fleetCostLabel([session, sampled(0)]), '—');
  assert.equal(fleetCostLabel([sampled(1), sampled(2)]), '$3.00');
  assert.equal(fleetCostLabel([{ ...session, costUsd: 0 }]), '$0.00');
  assert.equal(fleetCostLabel([session, sampled(2)]), '≥$2.00');
  assert.equal(fleetCostCoverage([session, sampled(2)]), '1/2 sessions priced');
  assert.equal(fleetCostCoverage([sampled(1), sampled(2)]), undefined);
  assert.equal(fleetCostCoverage([session]), undefined);
  assert.equal(fleetCostLabel([{ ...session, costUsd: 0, costIncomplete: true }]), '≥$0.00');
});
