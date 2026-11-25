import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ComponentType, type Context } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import type { Session } from '@pi-console/contract';
import { generate } from '@pi-console/testkit';
import { clock } from '@pi-console/viewmodels';
import { graph } from '../../../testkit/src/mock-daemon/v1-extras.ts';
import { ConsoleStore } from '../client/store.ts';
import { createApi } from '../client/api.ts';
import { emptyState, type ConsoleState } from '../state/state.ts';
import type { GraphScrub } from './graph-scrubber.tsx';

let server: ViteDevServer;
let GraphView: ComponentType<{ state: ConsoleState }>;
let StoreContext: Context<ConsoleStore | null>;
let GraphScrubber: ComponentType<{ scrub: GraphScrub }>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ GraphView } = await server.ssrLoadModule('/src/views/graph.tsx'));
  ({ StoreContext } = await server.ssrLoadModule('/src/app/hooks.ts'));
  ({ GraphScrubber } = await server.ssrLoadModule('/src/views/graph-scrubber.tsx'));
});
after(async () => { await server.close(); });

test('the scrubber cutoff reads in the viewer\'s local clock, like transcript times', () => {
  const times = [Date.parse('2026-01-01T08:00:00Z'), Date.parse('2026-01-01T09:30:15Z')];
  const scrub: GraphScrub = { times, scrubbing: true, upTo: times[1], toggle: () => undefined, move: () => undefined };
  const html = renderToStaticMarkup(createElement(GraphScrubber, { scrub }));
  assert.match(html, new RegExp(`<time class="mono muted" dateTime="2026-01-01T09:30:15.000Z">${clock('2026-01-01T09:30:15.000Z')}</time>`, 'i'));
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(GraphScrubber, { scrub: { ...scrub, scrubbing: false } })), /type="range"/);
});

test('lane nodes carry their newest session tone and glyph, and every node label sits on a plate', () => {
  const fixture = generate().fixture;
  const state = { ...emptyState(), graph: graph(fixture), sessions: fixture.sessions as unknown as Session[] };
  const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, createElement(GraphView, { state })));
  const lanes = html.slice(html.indexOf('aria-label="Lane communication"'), html.indexOf('aria-label="Session relationships"'));
  assert.match(lanes, /class="node tone-[a-z]+"/);
  assert.equal(lanes.match(/<g class="labels" filter="url\(#[^"]+\)"/g)?.length, lanes.match(/class="node[ "]/g)?.length);
  assert.match(lanes, /<feFlood class="label-plate"/);
});

test('mock status dependencies render directed edges, titles and a plain-language legend', () => {
  const state = { ...emptyState(), graph: graph(generate().fixture) };
  const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, createElement(GraphView, { state })));
  for (const kind of ['waiting-on', 'barred-by']) {
    const edge = state.graph.edges.find(edge => edge.kind === kind);
    assert.ok(edge, `the default mock supplies ${kind}`);
    assert.match(html, new RegExp(`class="edge ${kind}" data-from="${edge.fromLane}" data-to="${edge.toLane}"`));
    assert.match(html, new RegExp(`<title>${kind} 1×</title>`));
  }
  for (const text of ['Messages sent', 'Started a session', 'Waiting for', 'Blocked by', 'Thicker lines mean more messages.']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /session status only in spawn relationships|waiting-on →|barred-by →/);
  for (const kind of ['message', 'spawn', 'waiting-on', 'barred-by']) assert.match(html, new RegExp(`<svg viewBox="0 0 32 12" aria-hidden="true"><path class="edge ${kind}"`));
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

test('the default mock renders six repository groups with lane-ID and name labels and a full-text title', () => {
  const state = { ...emptyState(), graph: graph(generate().fixture) };
  const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: new ConsoleStore(createApi('unused')) }, createElement(GraphView, { state })));
  const lanes = html.slice(html.indexOf('aria-label="Lane communication"'));
  for (const repository of ['AURORA', 'HARBOR', 'MEADOW', 'QUARTZ', 'WILLOW', 'ZENITH']) assert.match(lanes, new RegExp(`aria-label="Graph for ${repository}`, 'i'));
  assert.equal(lanes.match(/aria-label="Graph for /g)?.length, 6);
  assert.match(lanes, /<title>L196 · harbor coordinator<\/title>/);
  assert.match(lanes, /<text class="label"[^>]*>L196<\/text><text class="label name"[^>]*>harbor coordinator<\/text>/);
  assert.doesNotMatch(html, /Time scrubber/, 'the scrubber toggle lives in the Messages toolbar row');
});
