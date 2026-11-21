import type { MemoryItem, SessionMemory } from '@pi-console/contract';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPanelViewModel } from './memory.ts';
import { golden, now } from '../test-support.ts';

const item = (id: string, over: Partial<MemoryItem> = {}): MemoryItem => ({
  id, kind: 'order', scope: { kind: 'session', key: 's1' }, sessionId: 's1', status: 'proposed', statusBasis: 'recorded', text: `synthetic ${id}`, withheld: false,
  sourceType: 'coordinator_order', sourceMessageId: null, at: '2026-11-20T09:00:00.000Z', command: `/memory confirm ${id}`, ...over,
});
const memory: SessionMemory = {
  sessionId: 's1', storeDetected: true, counts: { active: 2, proposed: 1, done: 0, superseded: 0, withdrawn: 0, rejected: 1 }, proposedConfirmable: 1,
  unresolved: { lowerBound: 2, atLastHandoff: { count: 3, at: '2026-11-20T09:10:00.000Z' } }, wider: 1,
  handoffs: [
    { handoffId: 'sess-1-1.md', at: '2026-11-20T09:10:00.000Z', degraded: false, memoryIndex: { items: 4, messages: 3, unresolved: 3, withheld: 0, proposed: 1, rejected: 1 }, resumeCheck: null },
    { handoffId: 'sess-1-2.md', at: '2026-11-20T09:11:00.000Z', degraded: true, memoryIndex: null, resumeCheck: null },
  ],
};
const items = [item('item-1'), item('item-2', { status: 'active', statusBasis: 'assumed', command: null, kind: 'directive', sourceType: 'user_message' }), item('item-3', { withheld: true, text: '', status: 'rejected', command: null })];

test('memory panel: counts, unresolved bound with the last handoff figure, items, commands and handoffs', () => {
  const model = memoryPanelViewModel({ memory, items, now });
  assert.equal(model.available, true);
  assert.equal(model.unresolved.text, 'unresolved: 2+ (lower bound) · last handoff: 3');
  assert.deepEqual(model.items.map(row => [row.statusLabel, row.command, row.rejectCommand]), [
    ['proposed', '/memory confirm item-1', '/memory reject item-1'], ['active (assumed)', null, null], ['rejected', null, null],
  ]);
  assert.equal(model.items[2].text, '[withheld: secret-shaped content]');
  assert.match(model.hint, /cannot confirm/);
  golden('session', model, 'memory.golden.json');
});

test('memory panel is unavailable without a summary or a detected store, and sanitizes text', () => {
  assert.equal(memoryPanelViewModel({ memory: null, items: [], now }).available, false);
  assert.equal(memoryPanelViewModel({ memory: { ...memory, storeDetected: false }, items: [], now }).available, false);
  const dirty = memoryPanelViewModel({ memory, items: [item('item-9', { text: 'a\u001b[31mred\u0007' })], now });
  assert.equal(dirty.items[0].text, 'ared');
  assert.equal(memoryPanelViewModel({ memory: { ...memory, unresolved: { lowerBound: 0, atLastHandoff: null } }, items: [], now }).unresolved.text, 'unresolved: 0+ (lower bound) · last handoff: unknown');
});
