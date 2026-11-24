import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import type { RequestsRow } from '@pi-console/viewmodels';

let server: ViteDevServer;
let RequestCard: ComponentType<{ row: RequestsRow; selected: boolean; onSelect: () => void }>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../../..'), server: { middlewareMode: true, watch: null }, appType: 'custom' });
  ({ RequestCard } = await server.ssrLoadModule('/src/views/requests/request-card.tsx'));
});
after(async () => { await server.close(); });

const row: RequestsRow = {
  id: 'request-a11y', sessionId: 's2', session: { name: 'Session two', lane: '', title: 'Session two' }, origin: 'human', originLabel: 'Classified as human',
  status: { status: 'open', label: 'Open', color: 'cyan', glyph: '○' }, text: 'Explain <this> request', withheld: false, age: '1m',
  answer: null, uncertain: null, possiblyUnseen: null, source: 'Session transcript', transcript: null,
};

function render(selected: boolean, request = row): string {
  return renderToStaticMarkup(createElement(RequestCard, { row: request, selected, onSelect: () => undefined }));
}

test('request card has a labelled native selection button and retains its separate session link', () => {
  const html = render(false);
  assert.match(html, /<button type="button" class="card-text request-select"/);
  assert.match(html, /aria-label="Show details for Explain &lt;this&gt; request"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /<a href="#\/session\/s2">Session two<\/a>/);
  assert.match(html, />Explain &lt;this&gt; request<\/button>/);
});

test('selected and withheld request cards expose selection without losing their displayed text', () => {
  const html = render(true, { ...row, text: '[withheld]', withheld: true });
  assert.match(html, /aria-current="true"/);
  assert.match(html, /class="card-text request-select withheld"/);
  assert.match(html, /aria-label="Show details for \[withheld\]" aria-pressed="true"/);
  assert.match(html, />\[withheld\]<\/button>/);
});
