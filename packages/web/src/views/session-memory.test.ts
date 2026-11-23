import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import type { MemoryPanelItem } from '@pi-console/viewmodels';
import type * as CopyNotice from '../app/copy-notice.ts';

type ItemView = ComponentType<{ item: MemoryPanelItem; request: () => void }>;
let server: ViteDevServer;
let MemoryItemView: ItemView;
let copy: typeof CopyNotice;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ MemoryItemView } = await server.ssrLoadModule('/src/views/session-memory.tsx'));
  copy = await server.ssrLoadModule('/src/app/copy-notice.ts') as typeof CopyNotice;
});
after(async () => { copy.cancelExpiry(); await server.close(); });

const item = (patch: Partial<MemoryPanelItem>): MemoryPanelItem => ({
  id: 'm1', kind: 'decision', status: 'proposed', statusLabel: 'proposed', badge: { label: 'proposed', tone: 'amber' }, details: 'decision · repo · recorded · 1m ago', scope: 'repo', sourceNote: 'recorded', text: 'Use X',
  canRequest: true, review: null, command: '/memory confirm m1', rejectCommand: '/memory reject m1', ...patch,
});
const render = (patch: Partial<MemoryPanelItem>): string => renderToStaticMarkup(createElement(MemoryItemView, { item: item(patch), request: () => undefined }));

test('confirm, reject and copy use the themed button class', () => {
  const html = render({});
  assert.match(html, /<button type="button" class="btn" aria-busy="false">Confirm…<\/button>/);
  assert.match(html, /<button type="button" class="btn" aria-busy="false">Reject…<\/button>/);
  assert.match(html, /<button type="button" class="btn memory-copy">Copy command<\/button>/);
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
