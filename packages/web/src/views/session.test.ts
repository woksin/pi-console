import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType, type Context } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import type { SessionDetail } from '@pi-console/contract';
import type { ViewProps } from '../app/view.tsx';
import { ConsoleStore, type Clock } from '../client/store.ts';
import type { Api } from '../client/api.ts';

let server: ViteDevServer;
let SessionView: ComponentType<ViewProps & { id: string; entry: string | null }>;
let StoreContext: Context<ConsoleStore | null>;
before(async () => {
  server = await createServer({
    configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom',
    // Memory subscribes to its own external store; these server-rendered specs exercise only the session detail boundary.
    plugins: [{
      name: 'session-memory-stub', enforce: 'pre',
      transform: (_source, id) => id.endsWith('/src/views/session-memory.tsx') ? 'export function SessionMemory() { return null; }' : null,
    }],
  });
  ({ SessionView } = await server.ssrLoadModule('/src/views/session.tsx'));
  ({ StoreContext } = await server.ssrLoadModule('/src/app/hooks.ts'));
});
after(async () => { await server.close(); });

const clock: Clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
const detail: SessionDetail = {
  session: {
    id: 's1', repositoryId: 'r1', name: 'Session one', laneId: 'L1', role: 'main', parentSessionId: null, orchestratorSessionId: 's1',
    branch: 'main', cwd: '/repo', model: 'model', status: 'idle', startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', contextPercent: 0, samples: [],
  },
  requests: [], questions: [], jobs: [], resets: [], subagents: [],
};

function render(store: ConsoleStore, state = store.getState()): string {
  return renderToStaticMarkup(createElement(StoreContext.Provider, { value: store }, createElement(SessionView, { state, now: 0, id: 's1', entry: null })));
}

function assertLoading(store: ConsoleStore): void {
  const html = render(store);
  assert.match(html, /role="status" aria-label="Loading session" aria-busy="true"/);
  assert.doesNotMatch(html, /Session not found|role="alert"/);
  assert.match(html, /<button type="button" class="btn" aria-disabled="true" aria-busy="true">Retry<\/button>/);
}

test('a missing snapshot row shows loading before and during the detail request, never not-found', async () => {
  const pending = Promise.withResolvers<SessionDetail>();
  const store = new ConsoleStore({ session: () => pending.promise } as unknown as Api, clock);
  assertLoading(store);
  const load = store.loadSessionDetail('s1');
  assertLoading(store);
  pending.resolve(detail);
  await load;
  assert.equal(store.getSessionDetailStatus('s1'), 'loaded');
  assert.deepEqual(store.getState().sessions, [detail.session]);
});

test('a detail failure shows a native Retry button and recovers through loading to the session', async () => {
  let pending = Promise.withResolvers<SessionDetail>();
  const store = new ConsoleStore({ session: () => pending.promise } as unknown as Api, clock);
  const load = store.loadSessionDetail('s1');
  pending.reject(new Error('daemon offline'));
  await load;
  const html = render(store);
  assert.match(html, /role="status" aria-busy="false"/);
  assert.match(html, /Could not load session\./);
  assert.match(html, /<button type="button" class="btn" aria-disabled="false" aria-busy="false">Retry<\/button>/);
  assert.doesNotMatch(html, /Session not found|Loading session/);
  pending = Promise.withResolvers<SessionDetail>();
  const retry = store.loadSessionDetail('s1');
  assertLoading(store);
  pending.resolve(detail);
  await retry;
  assert.equal(store.getSessionDetailStatus('s1'), 'loaded');
  assert.deepEqual(store.getState().sessions, [detail.session]);
});

test('live session data renders even if a stale not-found detail status is still present', async () => {
  const store = new ConsoleStore({ session: () => Promise.resolve(null) } as unknown as Api, clock);
  await store.loadSessionDetail('s1');
  assert.equal(store.getSessionDetailStatus('s1'), 'not-found');
  const html = render(store, { ...store.getState(), sessions: [detail.session] });
  assert.match(html, /class="session-head"/);
  assert.doesNotMatch(html, /Session not found|Could not load session|Loading session/);
});

test('only an explicit not-found response shows Session not found and the fleet link', async () => {
  const store = new ConsoleStore({ session: () => Promise.resolve(null) } as unknown as Api, clock);
  await store.loadSessionDetail('s1');
  const html = render(store);
  assert.match(html, /<h2>Session not found<\/h2>/);
  assert.match(html, /<a href="#\/fleet">Back to the fleet<\/a>/);
  assert.doesNotMatch(html, /role="status"|role="alert"|>Retry</);
});
