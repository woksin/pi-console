import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType, type Context } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { ConsoleStore } from '../client/store.ts';
import { createApi } from '../client/api.ts';
import { emptyState, type ConsoleState } from '../state/state.ts';
import type { ViewProps } from '../app/view.tsx';

const collections = ['sessions', 'requests', 'questions', 'messages', 'resets'] as const;
let server: ViteDevServer;
let TimelineHistory: ComponentType<{ state: ConsoleState }>;
let TimelineView: ComponentType<ViewProps>;
let StoreContext: Context<ConsoleStore | null>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ TimelineHistory } = await server.ssrLoadModule('/src/views/timeline-history.tsx'));
  ({ TimelineView } = await server.ssrLoadModule('/src/views/timeline.tsx'));
  ({ StoreContext } = await server.ssrLoadModule('/src/app/hooks.ts'));
});
after(async () => { await server.close(); });

function boundedState(): ConsoleState {
  const state = { ...emptyState(), snapshotLoaded: true };
  state.bounded = collections;
  state.totals = { sessions: 10, requests: 20, questions: 30, messages: 40, resets: 50, jobs: 0 };
  state.sessions = [{ id: 's1', repositoryId: 'repo', name: 'Session', laneId: 'L1', role: 'main', parentSessionId: null, orchestratorSessionId: 's1', branch: '', cwd: '', model: '', status: 'idle', startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', contextPercent: 0, samples: [] }];
  state.requests = Array.from({ length: 2 }, (_, id) => ({ id: `r${String(id)}`, sessionId: 's1', text: 'Request', origin: 'human', originLabel: 'Human request', originEvidence: '', status: 'answered', createdAt: '2026-01-01T00:00:00Z', resetId: null, answer: null, interimAnswers: [] }));
  state.questions = Array.from({ length: 3 }, (_, id) => ({ id: `q${String(id)}`, sessionId: 's1', kind: 'question', text: 'Question', options: [], urgency: 'normal', blocking: false, status: 'closed', createdAt: '2026-01-01T00:00:00Z' }));
  state.messages = Array.from({ length: 4 }, (_, id) => ({ id: `m${String(id)}`, fromSessionId: 's1', toSessionId: 's1', text: 'Message', status: 'read', sentAt: '2026-01-01T00:00:00Z' }));
  state.resets = Array.from({ length: 5 }, (_, id) => ({ id: `reset${String(id)}`, sessionId: 's1', kind: 'compaction', at: '2026-01-01T00:00:00Z', carriedRequestIds: [], interruptedRequestIds: [] }));
  return state;
}

function render(state: ConsoleState, view = false): string {
  const child = view ? createElement(TimelineView, { state, now: 0 }) : createElement(TimelineHistory, { state });
  return renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, child));
}

test('all five bounded collections expose separate row counts and named controls independent of zoom', () => {
  const html = render(boundedState());
  for (const [index, collection] of collections.entries()) {
    assert.ok(html.includes(`role="group" aria-label="${collection} history"`));
    assert.ok(html.includes(`Showing ${String(index + 1)} of ${String((index + 1) * 10)} ${collection}`));
    assert.ok(html.includes(`aria-label="Load older ${collection}"`));
  }
  assert.match(html, /Limited history/);
  assert.doesNotMatch(html, /Loaded history counts/);
});

test('legacy and unbounded snapshots suppress history claims and unknown totals do not fabricate counts', () => {
  const state = boundedState();
  state.bounded = [];
  assert.equal(render(state), '');
  state.totals = null;
  assert.equal(render(state), '');
  state.bounded = ['requests'];
  const html = render(state);
  assert.doesNotMatch(html, /Showing|<button/);
});

test('exhausted collections retain their counts but hide controls and no longer claim missing history', () => {
  const state = boundedState();
  state.history.requests = { cursor: null, more: false };
  const partial = render(state);
  assert.doesNotMatch(partial, /aria-label="Load older requests"/);
  assert.match(partial, /aria-label="Load older sessions"/);
  assert.match(partial, /Showing 2 of 20 requests/);
  for (const collection of collections) state.history[collection] = { cursor: null, more: false };
  assert.doesNotMatch(render(state), /<button|Limited history/);
});

test('empty Timeline still exposes every available history collection with collection row counts', () => {
  const state = boundedState();
  state.sessions = [];
  const html = render(state, true);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /Showing 0 of 10 sessions/);
  assert.match(html, /Showing 2 of 20 requests/);
  for (const collection of collections) assert.ok(html.includes(`aria-label="Load older ${collection}"`));
});
