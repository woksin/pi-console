import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoryItemModel } from '../projections/memory.ts';
import { syntheticModels } from '../testing/synthetic-models.ts';
import { proposedMemoryAttention } from './memory.ts';

const emptyModels = () => syntheticModels({ sessions: 0, jobs: 0, messages: 0, requests: 0, questions: 0 });
const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 8, minute)).toISOString();
const item = (id: string, overrides: Partial<MemoryItemModel> = {}): MemoryItemModel => ({
  id, recorded: true, kind: 'order', scopeKind: 'session', scopeKey: 's1', sourceType: 'coordinator_order', sourceMessageId: null,
  authorityMode: null, excerpt: id, withheld: false, at: at(5), status: 'proposed', statusBasis: 'recorded', transitions: [], stamps: {}, ...overrides,
});

test('proposals group by scoped or cited session and unlinked bucket using the oldest timestamp', () => {
  const models = emptyModels();
  const rows = [
    item('z-scoped'), item('a-cited', { scopeKind: 'repo', sourceMessageId: 'message', at: at(1) }),
    item('z-unlinked', { scopeKind: 'global', at: at(4) }), item('a-unlinked', { scopeKind: 'repo', sourceMessageId: 'missing', at: at(2) }),
    item('single', { scopeKey: 's2', at: at(3) }), item('active', { status: 'active' }),
    item('assumed', { statusBasis: 'assumed' }), item('unrecorded', { recorded: false }),
  ];
  models.memory.items = Object.fromEntries(rows.map(row => [row.id, row]));
  models.memory.messages.message = { id: 'message', recorded: true, sessionId: 's1', origin: 'injected', at: at(0), classified: false, itemIds: [], stamps: {} };
  const before = structuredClone(models);
  assert.deepEqual(proposedMemoryAttention(models), [
    { id: 'memory:s1', reason: 'proposed-memory', sessionId: 's1', laneId: null, text: '2 proposed memory items waiting for /memory confirm', since: at(1), pointer: null },
    { id: 'memory:unlinked', reason: 'proposed-memory', sessionId: null, laneId: null, text: '2 proposed memory items waiting for /memory confirm', since: at(2), pointer: null },
    { id: 'memory:s2', reason: 'proposed-memory', sessionId: 's2', laneId: null, text: '1 proposed memory item waiting for /memory confirm single', since: at(3), pointer: null },
  ]);
  assert.deepEqual(models, before, 'grouping must not mutate read models');
});

test('a large single bucket traverses proposal references only linearly', () => {
  const models = emptyModels();
  const count = 4000;
  models.memory.items = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const row = item(`p${String(index)}`, { scopeKind: 'global' });
    return [row.id, row];
  }));
  const proposals = new Set<unknown>(Object.values(models.memory.items));
  const values = Array.prototype.values;
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  let traversed = 0;
  // Count copied proposal references, not elapsed time; array spreading must not recopy a growing bucket.
  Object.defineProperty(Array.prototype, Symbol.iterator, { ...descriptor, value: function* (this: unknown[]) {
    for (const value of values.call(this)) {
      if (proposals.has(value)) traversed++;
      yield value;
    }
  } });
  try {
    const attention = proposedMemoryAttention(models);
    assert.equal(attention.length, 1);
    assert.equal(attention[0].text, `${String(count)} proposed memory items waiting for /memory confirm`);
    assert.equal(attention[0].since, at(5));
    assert.ok(traversed <= count * 4, `expected linear traversal, visited ${String(traversed)} proposal references`);
  } finally { Object.defineProperty(Array.prototype, Symbol.iterator, descriptor); }
});
