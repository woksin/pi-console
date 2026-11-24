import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { memoryPanelViewModel, type MemoryPanelItem, type MemoryPanelViewModel } from '@pi-console/viewmodels';
import type { SessionMemory } from '@pi-console/contract';
import type * as CopyNotice from '../app/copy-notice.ts';

type ItemView = ComponentType<{ item: MemoryPanelItem; request: () => void }>;
let server: ViteDevServer;
let MemoryItemView: ItemView;
let MemorySummary: ComponentType<{ view: MemoryPanelViewModel }>;
let copy: typeof CopyNotice;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ MemoryItemView, MemorySummary } = await server.ssrLoadModule('/src/views/session-memory.tsx'));
  copy = await server.ssrLoadModule('/src/app/copy-notice.ts') as typeof CopyNotice;
});
after(async () => { copy.cancelExpiry(); await server.close(); });

const item = (patch: Partial<MemoryPanelItem>): MemoryPanelItem => ({
  id: 'm1', kind: 'decision', status: 'proposed', statusLabel: 'proposed', badge: { label: 'proposed', tone: 'amber' }, details: 'decision · repo · recorded · 1m ago', scope: 'repo', sourceNote: 'recorded', text: 'Use X',
  canRequest: true, review: null, command: '/memory confirm m1', rejectCommand: '/memory reject m1', ...patch,
});
const render = (patch: Partial<MemoryPanelItem>): string => renderToStaticMarkup(createElement(MemoryItemView, { item: item(patch), request: () => undefined }));

const summary = (unresolved: SessionMemory['unresolved']): string => {
  const memory: SessionMemory = {
    sessionId: 's1', storeDetected: true, counts: { active: 0, proposed: 2, done: 0, superseded: 0, withdrawn: 0, rejected: 0 },
    proposedConfirmable: 2, unresolved, wider: 0, handoffs: [],
  };
  const view = memoryPanelViewModel({ memory, items: [], now: 0 });
  return renderToStaticMarkup(createElement(MemorySummary, { view }));
};

test('proposed memory items with no uncaptured human messages show no contradictory zero line or empty paragraph', () => {
  assert.equal(summary({ lowerBound: 0, atLastHandoff: null }), '<p class="small muted">2 proposed</p>');
});

test('the memory summary names uncaptured human messages independently of proposed items', () => {
  const html = summary({ lowerBound: 2, atLastHandoff: null });
  assert.match(html, />2 proposed<\/p>/);
  assert.match(html, />At least 2 human messages not yet captured in memory<\/p>/);
  assert.doesNotMatch(html, /No unresolved|loaded history/);
});

test('a historical unresolved-message figure remains visible when the current lower bound is zero', () => {
  const html = summary({ lowerBound: 0, atLastHandoff: { count: 1, at: '2026-11-20T09:10:00.000Z' } });
  assert.match(html, />2 proposed<\/p>/);
  assert.match(html, />Unresolved messages at last handoff: 1<\/p>/);
  assert.doesNotMatch(html, /No unresolved|loaded history/);
});

test('confirm, reject and copy use the themed button class', () => {
  const html = render({});
  assert.match(html, /<button type="button" class="btn" aria-busy="false">Confirm…<\/button>/);
  assert.match(html, /<button type="button" class="btn" aria-busy="false">Reject…<\/button>/);
  assert.match(html, /<button type="button" class="btn memory-copy">Copy command<\/button>/);
});

test('confirm, reject and copy share one action row, with the verbose commands in a collapsed disclosure', () => {
  const html = render({});
  assert.equal(html.match(/class="memory-actions"/g)?.length, 1);
  assert.match(html, /class="memory-actions"><button[^>]*>Confirm…<\/button><button[^>]*>Reject…<\/button><button[^>]*>Copy command<\/button><\/span>/);
  assert.match(html, /<details class="memory-command small mono"><summary>pi commands<\/summary>Run in a pi session:/);
});

test('without review support the commands stay visible beside Copy command', () => {
  const html = render({ canRequest: false });
  assert.doesNotMatch(html, /Confirm…/);
  assert.match(html, /<details class="memory-command small mono" open="">/);
  assert.match(html, /<button type="button" class="btn memory-copy">Copy command<\/button>/);
});

test('an unavailable receipt followed by offline readiness leaves the commands visible', () => {
  const html = render({ canRequest: false, review: { state: 'unavailable', message: 'Review unavailable' } });
  assert.match(html, /disabled="" aria-busy="false">Confirm…/);
  assert.match(html, /<details class="memory-command small mono" open="">/);
});

test('a review in flight keeps the commands collapsed', () => {
  const html = render({ canRequest: false, review: { state: 'requesting', message: 'Requesting' } });
  assert.match(html, /<details class="memory-command small mono"><summary>/);
});

test('an item without a command has no copy button or disclosure', () => {
  const html = render({ command: null, rejectCommand: null });
  assert.doesNotMatch(html, /Copy command|<details/);
});

test('an item leads with a toned status badge and its text, with details on a smaller second line', () => {
  const html = render({});
  assert.match(html, /<span class="memory-head"><span class="badge memory-badge tone-amber" data-memory-status="proposed">proposed<\/span><span class="memory-text" title="Use X">Use X<\/span><\/span><span class="small faint memory-details">decision · repo · recorded · 1m ago<\/span>/);
});

test('a pending review disables both actions and marks them busy', () => {
  const html = render({ canRequest: false, review: { state: 'requesting', message: 'Requesting' } });
  assert.match(html, /class="btn" disabled="" aria-busy="true">Confirm…/);
  assert.match(html, /class="btn" disabled="" aria-busy="true">Reject…/);
});

test('a settled review disables without busy', () => {
  const html = render({ canRequest: false, review: { state: 'declined', message: 'Declined' } });
  assert.match(html, /class="btn" disabled="" aria-busy="false">Confirm…/);
});

test('a rejected clipboard write announces a labelled copy failure', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } } });
  try {
    assert.equal(await copy.copyWithNotice('/memory confirm m1', 'memory command'), false);
    assert.equal(copy.currentNotice(), 'Could not copy memory command: clipboard unavailable');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else Reflect.deleteProperty(globalThis, 'navigator');
    copy.cancelExpiry();
  }
});
