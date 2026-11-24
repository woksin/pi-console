import type { MemoryItem, SessionMemory } from '@pi-console/contract';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPanelViewModel, type MemoryPanelInput } from './memory.ts';
import { sessionLabels } from '../format/session-labels.ts';
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
  assert.equal(model.unresolved.text, 'At least 2 human messages not yet captured in memory · Unresolved messages at last handoff: 3');
  assert.deepEqual(model.items.map(row => [row.statusLabel, row.command, row.rejectCommand]), [
    ['proposed', '/memory confirm item-1', '/memory reject item-1'], ['active (assumed)', null, null], ['rejected', null, null],
  ]);
  assert.equal(model.items[2].text, '[withheld: secret-shaped content]');
  assert.match(model.hint, /Run the command in pi/);
  golden('session', model, 'memory.golden.json');
});

test('memory panel is unavailable without a summary or a detected store, and sanitizes text', () => {
  assert.equal(memoryPanelViewModel({ memory: null, items: [], now }).available, false);
  assert.equal(memoryPanelViewModel({ memory: { ...memory, storeDetected: false }, items: [], now }).available, false);
  const dirty = memoryPanelViewModel({ memory, items: [item('item-9', { text: 'a\u001b[31mred\u0007' })], now });
  assert.equal(dirty.items[0].text, 'ared');
  });

test('proposed items do not imply uncaptured human messages; hide an uninformative zero', () => {
  const proposed = { ...memory, unresolved: { lowerBound: 0, atLastHandoff: null } };
  const model = memoryPanelViewModel({ memory: proposed, items, now });
  assert.equal(model.counts.find(cell => cell.status === 'proposed')?.count, 1);
  assert.equal(model.unresolved.text, '');
});

test('uncaptured human messages and the historical handoff figure are separate metrics', () => {
  const text = (lowerBound: number, atLastHandoff: SessionMemory['unresolved']['atLastHandoff'] = null) =>
    memoryPanelViewModel({ memory: { ...memory, unresolved: { lowerBound, atLastHandoff } }, items: [], now }).unresolved.text;
  assert.equal(text(1), 'At least 1 human message not yet captured in memory');
  assert.equal(text(4), 'At least 4 human messages not yet captured in memory');
  assert.equal(text(0, { count: 1, at: '2026-11-20T09:10:00.000Z' }), 'Unresolved messages at last handoff: 1');
  assert.equal(text(0, { count: 0, at: '2026-11-20T09:10:00.000Z' }), 'Unresolved messages at last handoff: 0');
  assert.equal(text(2, { count: 3, at: '2026-11-20T09:10:00.000Z' }), 'At least 2 human messages not yet captured in memory · Unresolved messages at last handoff: 3');
  assert.equal(memoryPanelViewModel({ memory: null, items: [], now }).unresolved.text, '');
});

test('each item leads with a status badge and its text; scope, source and age go on a secondary line', () => {
  const model = memoryPanelViewModel({ memory, items, now });
  assert.deepEqual(model.items.map(row => row.badge), [
    { label: 'proposed', tone: 'amber' }, { label: 'active (assumed)', tone: 'green' }, { label: 'rejected', tone: 'red' },
  ]);
  assert.equal(model.items[0].details, 'order · session s1 · from a coordinator order · 3h ago');
  assert.equal(model.items[0].text, 'synthetic item-1');
});

test('a session scope shows the session name when known and a short id otherwise', () => {
  const scoped = (key: string, names?: MemoryPanelInput['sessionNames']) =>
    memoryPanelViewModel({ memory, items: [item('item-1', { scope: { kind: 'session', key } })], now, sessionNames: names }).items[0].scope;
  assert.equal(scoped('s2', new Map([['s2', sessionLabels({ id: 's2', name: 'Planner' })]])), 'session Planner');
  assert.equal(scoped('s2', new Map()), 'session s2');
  const longName = 'aurora implementation with a long name';
  assert.equal(scoped('s2', new Map([['s2', sessionLabels({ id: 's2', name: longName, laneId: 'L192' })]])), 'session aurora implement… · L192');
  assert.equal(scoped('s2', new Map([['s2', sessionLabels({ id: 's2', name: longName })]])), 'session aurora implementation w…');
  assert.equal(scoped('s2', new Map([['s2', sessionLabels({ id: 's2', name: '', laneId: 'L192' })]])), 'session L192');
  assert.equal(scoped('0123456789abcdef'), 'session 0123456…');
  const repo = memoryPanelViewModel({ memory, items: [item('item-1', { scope: { kind: 'repo', key: 'app' } })], now }).items[0];
  assert.equal(repo.scope, 'repo:app');
});
