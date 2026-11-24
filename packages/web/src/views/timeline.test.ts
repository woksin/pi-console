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
import { generate } from '@pi-console/testkit';
import type { Snapshot } from '@pi-console/contract';
import { displayWidth } from '@pi-console/viewmodels';

let server: ViteDevServer;
let TimelineView: ComponentType<ViewProps>;
let StoreContext: Context<ConsoleStore | null>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ TimelineView } = await server.ssrLoadModule('/src/views/timeline.tsx'));
  ({ StoreContext } = await server.ssrLoadModule('/src/app/hooks.ts'));
});
after(async () => { await server.close(); });

test('timeline fits same-name lanes in its label column and retains full identity tooltips', () => {
  const fixture = generate().fixture as unknown as Snapshot;
  const sessions = fixture.sessions.slice(0, 2).map((session, index) => ({ ...session, name: 'aurora implementation of the long running coordinator', laneId: `L${String(index + 1)}` }));
  const resets = sessions.map(session => ({ id: session.id, sessionId: session.id, at: session.startedAt, kind: 'compaction' as const, carriedRequestIds: [], interruptedRequestIds: [] }));
  const state = { ...emptyState(), snapshotLoaded: true, sessions, resets };
  const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, createElement(TimelineView, { state, now: 0 })));
  const labels = [...html.matchAll(/<text class="lane-label"[^>]*>(.*?)<\/text>/g)].map(match => match[1]);
  assert.equal(labels.length, 2);
  for (const [index, label] of labels.entries()) {
    assert.ok(label.includes(`<title>aurora implementation of the long running coordinator · L${String(index + 1)}</title>`));
    const visible = label.replace(/<title>.*?<\/title>/, '').replace(/<[^>]+>/g, '');
    assert.match(visible, /… · L[12]$/);
    assert.ok(displayWidth(visible) <= 40, '38 label cells (widest column) plus the status glyph and space');
  }
});

const render = (state: ReturnType<typeof emptyState>): string => renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, createElement(TimelineView, { state, now: 0 })));

test('a group header shows the repository name, not the cwd path, with the full id in its tooltip', () => {
  const fixture = generate().fixture as unknown as Snapshot;
  const session = { ...fixture.sessions[0], repositoryId: '/work/src/aurora', name: 'aurora-planner', laneId: 'L7' };
  const resets = [{ id: 'r1', sessionId: session.id, at: session.startedAt, kind: 'compaction' as const, carriedRequestIds: [], interruptedRequestIds: [] }];
  const html = render({ ...emptyState(), snapshotLoaded: true, sessions: [session], resets });
  const header = /<text class="repository-label"[^>]*>(.*?)<\/text>/.exec(html)?.[1] ?? '';
  assert.match(header, /^aurora<title>\/work\/src\/aurora · 1 sessions<\/title>$/);
  assert.match(html, /aria-label="aurora"/);
  const label = /<text class="lane-label"[^>]*>(.*?)<\/text>/.exec(html)?.[1] ?? '';
  assert.match(label, /<title>aurora-planner · L7<\/title>/, 'the tooltip keeps the full name');
  assert.match(label.replace(/<title>.*?<\/title>/, '').replace(/<[^>]+>/g, ''), /planner · L7$/, 'the visible name drops the repeated repository');
  assert.doesNotMatch(label.replace(/<title>.*?<\/title>/, ''), /aurora/);
});

test('real timeline resolves the last indexed marker and replacement-array text', () => {
  const state = { ...emptyState(), snapshotLoaded: true };
  state.sessions = [{ id: 's1', repositoryId: 'repo', name: 'Session one', laneId: 'L1', role: 'main', parentSessionId: null, orchestratorSessionId: 's1', branch: '', cwd: '', model: '', status: 'idle', startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', contextPercent: 0, samples: [] }];
  state.resets = [{ id: 'last', sessionId: 's1', at: '2026-01-01T00:00:00Z', kind: 'compaction', carriedRequestIds: ['last marker'], interruptedRequestIds: [] }];
  const render = () => renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, createElement(TimelineView, { state, now: 0 })));
  assert.match(render(), /carried last marker/);
  state.resets = [{ ...state.resets[0], carriedRequestIds: ['replacement'] }];
  assert.match(render(), /carried replacement/);
  assert.doesNotMatch(render(), /last marker/);
});
