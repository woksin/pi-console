import type { MemoryItem, SessionMemory } from '@pi-console/contract';
import { sessionLabels, memoryPanelViewModel, type MemoryPanelViewModel } from '@pi-console/viewmodels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemHeadLines, memoryLines } from './session-memory.ts';
import { memoryDocument } from './memory.ts';
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

for (const [name, render] of [
  ['rail', (panel: MemoryPanelViewModel) => memoryLines(panel, 200)],
  ['full view', (panel: MemoryPanelViewModel) => memoryDocument(panel, { width: 200 }, 0)],
] as const) {
  test(`memory ${name} hides an uninformative zero next to proposed items without leaving an empty row`, () => {
    const zero = { ...memory, unresolved: { lowerBound: 0, atLastHandoff: null } };
    const rows = render(memoryPanelViewModel({ memory: zero, items: [item], now })).map(line => line.map(part => part.text).join('').trimEnd());
    const index = rows.indexOf('1 proposed');
    assert.ok(index >= 0);
    assert.equal(rows[index + 1], '');
    assert.notEqual(rows[index + 2], '');
    assert.doesNotMatch(rows.join('\n'), /No unresolved|loaded history|not yet captured|at last handoff/);
  });

  test(`memory ${name} distinguishes uncaptured human messages from the last handoff figure`, () => {
    const current = plain(render(memoryPanelViewModel({ memory, items: [item], now })));
    assert.ok(current.includes('At least 1 human message not yet captured in memory'));
    const historical = { ...memory, unresolved: { lowerBound: 0, atLastHandoff: { count: 2, at: '2026-11-20T09:10:00.000Z' } } };
    const text = plain(render(memoryPanelViewModel({ memory: historical, items: [item], now })));
    assert.match(text, /1 proposed/);
    assert.match(text, /Unresolved messages at last handoff: 2/);
    assert.doesNotMatch(text, /No unresolved|loaded history|not yet captured/);
  });
}

test('a proposed item shows the exact confirm and reject commands and the unavailable fallback', () => {
  const text = plain(memoryLines(memoryPanelViewModel({ memory, items: [item], now }), 60));
  assert.match(text, /\/memory confirm item-1/);
  assert.match(text, /\/memory reject item-1/);
  assert.match(text, /Run the command in pi/);
});

test('hostile memory text is inert next to review controls and contains no terminal escape sequence', () => {
  const escape = String.fromCharCode(27);
  const hostile = `<img src=x onerror="globalThis.__memoryReviewXss=true">${escape}[31munsafe${escape}[0m`;
  const review = { availability: { version: 1 as const, available: true, providerVersion: 1, generation: 'g1', reason: 'available' as const }, items: new Map() };
  const text = plain(memoryLines(memoryPanelViewModel({ memory, items: [{ ...item, text: hostile }], review, now }), 200, 0));
  assert.match(text, /c Confirm… · x Reject…/);
  assert.match(text, /Item 1 of 1 · \[ \] prev\/next/);
  assert.doesNotMatch(text, /\[ \] item/);
  assert.match(text, /<img src=x onerror="globalThis.__memoryReviewXss=true">/);
  assert.equal(text.includes(escape), false);
  assert.match(text, /unsafe/);
});

test('an unseen store renders a single explanatory line', () => {
  assert.match(plain(memoryLines(memoryPanelViewModel({ memory: null, items: [], now }), 60)), /No intent-memory store seen/);
});

const rows = (lines: Line[]) => lines.map(line => line.map(part => part.text).join(''));

test('an item leads with a coloured status badge and its text, then a smaller details line', () => {
  const lines = memoryLines(memoryPanelViewModel({ memory, items: [item], now, sessionNames: new Map([['s1', sessionLabels({ id: 's1', name: 'Planner' })]]) }), 70);
  const text = rows(lines);
  const head = lines.find(line => line[0]?.text === '[proposed]');
  assert.ok(head);
  assert.equal(head[0].color, 'amber');
  assert.equal(head[0].bold, true);
  assert.equal(head.length, 1);
  assert.ok(text.includes('  synthetic order'));
  assert.ok(text.includes('  order · session Planner · from a coordinator order · 25m ago'));
  assert.match(text.join('\n'), /At least 1 human message not yet captured in memory/);
  assert.doesNotMatch(text.join('\n'), /lower bound/);
});

test('narrow widths keep every row within the width with the text under the badge', () => {
  const [row] = memoryPanelViewModel({ memory, items: [{ ...item, text: 'a long synthetic order that must wrap across several rows' }], now }).items;
  for (const width of [14, 20, 30, 60]) {
    const lines = rows(itemHeadLines(row, { width }));
    for (const line of lines) assert.ok([...line].length <= width, `${String(width)}: "${line}"`);
    assert.ok(lines.length >= 2);
  }
  assert.equal(rows(itemHeadLines(row, { width: 14 }))[0], '[proposed]');
  assert.equal(rows(itemHeadLines(row, { width: 60 }))[1], '  a long synthetic order that must wrap across several rows');
  const cjk = rows(itemHeadLines({ ...row, text: '漢字漢字漢字漢字漢字漢字' }, { width: 14, measure: text => [...text].length * 2 }));
  assert.ok(cjk.filter(line => line.includes('漢')).every(line => 2 + [...line.trim()].length * 2 <= 14));
});
