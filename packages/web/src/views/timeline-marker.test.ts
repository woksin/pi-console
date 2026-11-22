import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import type { Marker } from '@pi-console/viewmodels';

interface MarkerProps { marker: Marker; lane: string; x: number; selected: boolean; onSelect: () => void }
let server: ViteDevServer;
let TimelineMarker: ComponentType<MarkerProps>;
let TimelineDetail: ComponentType<{ marker: Marker; lane: string }>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ TimelineMarker } = await server.ssrLoadModule('/src/views/timeline-marker.tsx'));
  ({ TimelineDetail } = await server.ssrLoadModule('/src/views/timeline-detail.tsx'));
});
after(async () => { await server.close(); });

const marker: Marker = { id: 'answer', sessionId: 's1', at: Date.parse('2026-01-01T00:00:00Z'), glyph: '▼', kind: 'Final answer', text: '<img src=x onerror="alert(1)"> & details', color: 'green', rank: 3 };

test('SVG event control is labelled with kind, lane, session, time and escaped summary', () => {
  const html = renderToStaticMarkup(createElement(TimelineMarker, { marker, lane: 'repo/L1', x: 170, selected: false, onSelect: () => undefined }));
  assert.match(html, /role="button" tabindex="0"/);
  assert.match(html, /aria-label="Final answer · repo\/L1 \(s1\) · 2026-01-01T00:00:00.000Z · &lt;img/);
  assert.match(html, /aria-pressed="false" aria-controls="timeline-event-detail"/);
  assert.match(html, /class="marker-ring"/);
  assert.doesNotMatch(html, /<img|role="img"/);
});

test('selected state and HTML details expose the full text without interpreting markup', () => {
  const html = renderToStaticMarkup(createElement(TimelineMarker, { marker, lane: 'repo/L1', x: 170, selected: true, onSelect: () => undefined }));
  assert.match(html, /aria-pressed="true"/);
  const detail = renderToStaticMarkup(createElement(TimelineDetail, { marker, lane: 'repo/L1' }));
  assert.match(detail, /role="region" aria-label="Timeline event detail" aria-live="polite"/);
  assert.match(detail, /Final answer/);
  assert.match(detail, /repo\/L1/);
  assert.match(detail, /s1/);
  assert.match(detail, /2026-01-01T00:00:00.000Z/);
  assert.match(detail, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; details/);
  assert.doesNotMatch(detail, /<img|<script/);
});
