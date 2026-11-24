import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantCost } from './cost.ts';
import { sessionMapper } from './mapper.ts';

const record = { type: 'message', id: 'entry', timestamp: '2026-07-01T09:00:00Z' };

test('only finite nonnegative numeric assistant totals are trusted', () => {
  for (const total of [0, 1.25]) assert.equal(assistantCost({ usage: { cost: { total, input: 100 } } }), total);
  for (const total of [undefined, null, -1, NaN, Infinity, '1']) assert.equal(assistantCost({ usage: { cost: { total } } }), null);
  for (const usage of [undefined, null, false, 2, 'bad', {}, { cost: null }]) assert.equal(assistantCost({ usage }), null);
});

test('costs accompany supported assistant records without inventing answers or turns', () => {
  for (const stopReason of ['stop', 'aborted', 'toolUse', 'error', 'length', 'pending', 'deferred']) {
    const facts = sessionMapper('s')({ ...record, message: { role: 'assistant', stopReason, content: 'synthetic', usage: { cost: { total: 0 } } } });
    const costs = facts.filter(fact => fact.type === 'SessionCostObserved');
    assert.equal(costs.length, 1);
    assert.deepEqual(costs[0].payload, { sessionId: 's', entryId: 'entry', costUsd: 0 });
    assert.equal(costs[0].occurredAt, record.timestamp);
    assert.equal(facts.some(fact => fact.type === 'TurnEnded'), false);
    assert.equal(facts.some(fact => fact.type === 'AnswerObserved'), stopReason === 'stop');
  }
  const facts = sessionMapper('s')({ ...record, message: { role: 'assistant', stopReason: 'stop', content: 'synthetic', usage: false } });
  assert.deepEqual(facts.map(fact => fact.type), ['AnswerObserved', 'SessionCostObserved']);
  assert.equal(facts[1].payload.costUsd, null);
  const copy = sessionMapper('s')({ ...record, message: { role: 'assistant', stopReason: 'toolUse' } });
  assert.deepEqual(copy[0].logical, facts[1].logical);
  const user = sessionMapper('s')({ ...record, message: { role: 'user', content: 'synthetic', usage: { cost: { total: 5 } } } });
  assert.equal(user.some(fact => fact.type === 'SessionCostObserved'), false);
});
