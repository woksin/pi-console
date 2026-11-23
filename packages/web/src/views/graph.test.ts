import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ComponentType, type Context } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { generate } from '@pi-console/testkit';
import { graph } from '../../../testkit/src/mock-daemon/v1-extras.ts';
import { ConsoleStore } from '../client/store.ts';
import { createApi } from '../client/api.ts';
import { emptyState, type ConsoleState } from '../state/state.ts';

let server: ViteDevServer;
let GraphView: ComponentType<{ state: ConsoleState }>;
let StoreContext: Context<ConsoleStore | null>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ GraphView } = await server.ssrLoadModule('/src/views/graph.tsx'));
  ({ StoreContext } = await server.ssrLoadModule('/src/app/hooks.ts'));
});
after(async () => { await server.close(); });

test('mock status dependencies render directed edges, titles and matching TUI kind labels in the legend', () => {
  const state = { ...emptyState(), graph: graph(generate().fixture) };
  const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, createElement(GraphView, { state })));
  for (const kind of ['waiting-on', 'barred-by']) {
    const edge = state.graph.edges.find(edge => edge.kind === kind);
    assert.ok(edge, `the default mock supplies ${kind}`);
    assert.match(html, new RegExp(`class="edge ${kind}" data-from="${edge.fromLane}" data-to="${edge.toLane}"`));
    assert.match(html, new RegExp(`<title>${kind} 1×</title>`));
    assert.match(html, new RegExp(`</svg>${kind} →`));
  }
});

test('status dependency styles differ from message/spawn edges in both color and dash pattern', () => {
  const css = readFileSync(new URL('../styles/signature.css', import.meta.url), 'utf8');
  assert.match(css, /\.edge\.waiting-on \{ stroke: var\(--amber\); stroke-dasharray: 10 5; \}/);
  assert.match(css, /\.edge\.barred-by \{ stroke: var\(--red\); stroke-dasharray: 1 5; \}/);
});

test('a failed graph read renders a retry alert instead of the empty state; the first read renders a skeleton', () => {
  const store = new ConsoleStore(createApi('unused'));
  const html = (state: ConsoleState) => renderToStaticMarkup(createElement(StoreContext.Provider, { value: store }, createElement(GraphView, { state })));
  assert.match(html({ ...emptyState(), graph: null }), /aria-busy|skeleton/i);
  const failed = html({ ...emptyState(), graph: null, graphError: true });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Retry/);
  assert.match(html({ ...emptyState(), graph: graph(generate().fixture), graphError: true }), /Showing the last loaded graph/);
});
