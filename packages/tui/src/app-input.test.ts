import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoryItem, SessionMemory } from '@pi-console/contract';
import { sessionSideWidth, terminalContentWidth } from './state/session-layout.ts';
import { emptyMemoryReview } from '@pi-console/viewmodels';
import { initial } from './state/ui.ts';
import { Store } from './store/store.ts';
import { memoryLines } from './views/session-memory.ts';
import { memoryPanelViewModel } from '@pi-console/viewmodels';
import { collectionToLoad, countsOf, memoryInput } from './app-input.ts';
import type { Data } from './store/store.ts';

test('history loads only for a list section at its end and outside a session', () => {
  assert.equal(collectionToLoad({ section: 'fleet', sessionId: null }, true), 'sessions');
  assert.equal(collectionToLoad({ section: 'work', sessionId: null }, true), 'jobs');
  assert.equal(collectionToLoad({ section: 'fleet', sessionId: null }, false), undefined);
  assert.equal(collectionToLoad({ section: 'fleet', sessionId: 's1' }, true), undefined);
  assert.equal(collectionToLoad({ section: 'timeline', sessionId: null }, true), 'resets');
});

test('visible memory selection requests exactly the selected proposed item; other contexts never act', () => {
  const item: MemoryItem = { id: 'item-1', kind: 'order', scope: { kind: 'session', key: 's1' }, sessionId: 's1', status: 'proposed', statusBasis: 'recorded', text: 'synthetic', withheld: false, sourceType: 'coordinator_order', sourceMessageId: null, at: '', command: '/memory confirm item-1' };
  const memory: SessionMemory = { sessionId: 's1', storeDetected: true, counts: { active: 0, proposed: 2, done: 0, superseded: 0, withdrawn: 0, rejected: 0 }, proposedConfirmable: 2, unresolved: { lowerBound: 0, atLastHandoff: null }, wider: 0, handoffs: [] };
  const review = { ...emptyMemoryReview(), availability: { version: 1 as const, available: true, providerVersion: 1, generation: 'g1', reason: 'available' as const } };
  const data = { ...new Store().getSnapshot(), memory: new Map([['s1', memory]]), memoryItems: new Map([['s1', [item, { ...item, id: 'item-2' }]]]), memoryReviews: new Map([['s1', review]]) };
  const ui = { ...initial, sessionId: 's1', pane: 'memory' as const };
  const requests: unknown[][] = [];
  const request = (...args: unknown[]) => { requests.push(args); };
  const selected = memoryInput(ui, ']', data, 120, request) ?? ui;
  assert.equal(selected.memoryIndex, 1);
  memoryInput(selected, 'c', data, 120, request);
  assert.deepEqual(requests, [['s1', 'item-2', 'confirm']]);
  memoryInput(selected, 'x', data, 120, request);
  assert.deepEqual(requests[1], ['s1', 'item-2', 'reject']);
  assert.deepEqual(memoryInput(selected, '[', data, 120, request), ui);
  assert.deepEqual(memoryInput({ ...ui, memoryIndex: 999 }, ']', data, 120, request), selected, 'stale selection clamps to the last item');
  assert.deepEqual(memoryInput(ui, ']', { ...data, memoryItems: new Map() }, 120, request), ui, 'empty memory selection stays at zero');
  memoryInput(selected, 'c', data, 120);
  assert.equal(requests.length, 2, 'selection without a request callback stays read-only');
  const text = memoryLines(memoryPanelViewModel({ memory, items: data.memoryItems.get('s1') ?? [], review, now: 0 }), 36, selected.memoryIndex).flat().map(part => part.text).join('');
  assert.match(text, /Item 2 of 2/);
  assert.equal(memoryInput(ui, 'j', data, 120, request), null, 'transcript navigation is untouched');
  for (const variant of [{ ...ui, overlay: 'search' as const }, { ...ui, pane: 'requests' as const }, { ...ui, sessionId: null }]) assert.equal(memoryInput(variant, 'c', data, 120, request), null);
  assert.equal(memoryInput(ui, 'c', data, 90, request), null, 'hidden pane cannot act');
  assert.equal(requests.length, 2);
  const blocked = { ...data, memoryReviews: new Map([['s1', { ...review, availability: { ...review.availability, available: false, reason: 'read-only' as const } }]]) };
  memoryInput(ui, 'c', blocked, 120, request);
  assert.equal(requests.length, 2, 'read-only credentials retain command-only fallback');
  const resized: unknown[] = [];
  const resizeRequest = (...args: unknown[]) => { resized.push(args); };
  for (const width of [109, 110, 111]) {
    assert.equal(sessionSideWidth(terminalContentWidth(width)), 0);
    assert.equal(memoryInput(ui, 'c', data, width, resizeRequest), null);
    assert.equal(memoryInput(ui, 'x', data, width, resizeRequest), null);
  }
  assert.equal(resized.length, 0, 'shrinking below the visible-pane boundary cannot request');
  assert.equal(sessionSideWidth(terminalContentWidth(112)), 40);
  memoryInput(ui, 'c', data, 112, resizeRequest);
  memoryInput(ui, 'x', data, 112, resizeRequest);
  assert.deepEqual(resized, [['s1', 'item-1', 'confirm'], ['s1', 'item-1', 'reject']]);
  memoryInput(ui, 'c', data, 111, resizeRequest);
  assert.equal(resized.length, 2, 'resizing back to a hidden pane stops new requests');
});

test('counts prefer the daemon totals and fall back to what is loaded, in display order', () => {
  const data = { sessions: [1, 2], requests: [1], questions: [], messages: [1], jobs: [1, 2, 3], resets: [1], needsYou: [1, 2], totals: null } as unknown as Data;
  assert.deepEqual(Object.entries(countsOf(data)), [['sessions', 2], ['requests', 1], ['questions', 0], ['messages', 1], ['jobs', 3], ['resets', 1], ['needs you', 2]]);
  const bounded = { ...data, totals: { sessions: 50, requests: 9, questions: 8, messages: 7, jobs: 6, resets: 3000 } } as unknown as Data;
  assert.deepEqual(Object.values(countsOf(bounded)), [50, 9, 8, 7, 6, 3000, 2]);
});
