import type { MemoryItem, SessionMemory } from '@pi-console/contract';
import { memoryPanelViewModel } from '@pi-console/viewmodels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryLines } from './session-memory.ts';
import type { Line } from '../view/renderer.ts';

const now = Date.parse('2026-11-20T09:25:00.000Z');
const memory: SessionMemory = {
  sessionId: 's1', storeDetected: true, counts: { active: 0, proposed: 1, done: 0, superseded: 0, withdrawn: 0, rejected: 0 }, proposedConfirmable: 1,
  unresolved: { lowerBound: 1, atLastHandoff: null }, wider: 0, handoffs: [],
};
const item: MemoryItem = {
  id: 'item-1', kind: 'order', scope: { kind: 'session', key: 's1' }, sessionId: 's1', status: 'proposed', statusBasis: 'recorded', text: 'synthetic order',
  withheld: false, sourceType: 'coordinator_order', sourceMessageId: null, at: '2026-11-20T09:00:00.000Z', command: '/memory confirm item-1',
};
const plain = (lines: Line[]) => lines.map(line => line.map(part => part.text).join('')).join('\n');

test('a proposed item shows the exact confirm and reject commands and the unavailable fallback', () => {
  const text = plain(memoryLines(memoryPanelViewModel({ memory, items: [item], now }), 60));
  assert.match(text, /\/memory confirm item-1/);
  assert.match(text, /\/memory reject item-1/);
  assert.match(text, /Run the command in pi/);
});

test('an unseen store renders a single explanatory line', () => {
  assert.match(plain(memoryLines(memoryPanelViewModel({ memory: null, items: [], now }), 60)), /No intent-memory store seen/);
});
