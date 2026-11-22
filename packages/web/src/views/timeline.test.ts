import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType, type Context } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { ConsoleStore } from '../client/store.ts';
import { createApi } from '../client/api.ts';
import type { ViewProps } from '../app/view.tsx';
import { emptyState } from '../state/state.ts';

let server: ViteDevServer;
let TimelineView: ComponentType<ViewProps>;
let StoreContext: Context<ConsoleStore | null>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ TimelineView } = await server.ssrLoadModule('/src/views/timeline.tsx'));
  ({ StoreContext } = await server.ssrLoadModule('/src/app/hooks.ts'));
});
after(async () => { await server.close(); });

test('real timeline resolves the last indexed marker and replacement-array text', () => {
  const state = emptyState();
  state.sessions = [{ id: 's1', repositoryId: 'repo', name: 'Session one', laneId: 'L1', role: 'main', parentSessionId: null, orchestratorSessionId: 's1', branch: '', cwd: '', model: '', status: 'idle', startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', contextPercent: 0, samples: [] }];
  state.resets = [{ id: 'last', sessionId: 's1', at: '2026-01-01T00:00:00Z', kind: 'compaction', carriedRequestIds: ['last marker'], interruptedRequestIds: [] }];
  const render = () => renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, createElement(TimelineView, { state, now: 0 })));
  assert.match(render(), /carried last marker/);
  state.resets = [{ ...state.resets[0], carriedRequestIds: ['replacement'] }];
  assert.match(render(), /carried replacement/);
  assert.doesNotMatch(render(), /last marker/);
});
