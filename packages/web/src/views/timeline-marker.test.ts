import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import type { Marker } from '@pi-console/viewmodels';

interface MarkerProps { marker: Marker; lane: string; x: number; cellWidth: number; selected: boolean; onSelect: () => void }
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
  const html = renderToStaticMarkup(createElement(TimelineMarker, { marker, lane: 'repo/L1', x: 170, cellWidth: 8, selected: false, onSelect: () => undefined }));
  assert.match(html, /role="button" tabindex="0"/);
  assert.match(html, /aria-label="Final answer · repo\/L1 \(s1\) · 2026-01-01T00:00:00.000Z · &lt;img/);
  assert.match(html, /aria-pressed="false"/);
  assert.doesNotMatch(html, /aria-controls/);
  assert.match(html, /class="marker-ring"/);
  assert.doesNotMatch(html, /<img|role="img"/);
});

test('selected state and HTML details expose the full text without interpreting markup', () => {
  const html = renderToStaticMarkup(createElement(TimelineMarker, { marker, lane: 'repo/L1', x: 170, cellWidth: 8, selected: true, onSelect: () => undefined }));
  assert.match(html, /aria-pressed="true" aria-controls="timeline-event-detail"/);
  const detail = renderToStaticMarkup(createElement(TimelineDetail, { marker, lane: 'repo/L1' }));
  assert.match(detail, /role="region" aria-label="Timeline event detail" aria-live="polite"/);
  assert.match(detail, /Final answer/);
  assert.match(detail, /repo\/L1/);
  assert.match(detail, /s1/);
  assert.match(detail, /2026-01-01T00:00:00.000Z/);
  assert.match(detail, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; details/);
  assert.doesNotMatch(detail, /<img|<script/);
});

test('adjacent marker hit boxes stay within their cells and decorations do not take clicks', () => {
  const boxes = [170, 178].map(x => {
    const html = renderToStaticMarkup(createElement(TimelineMarker, { marker, lane: 'repo/L1', x, cellWidth: 8, selected: true, onSelect: () => undefined }));
    assert.match(html, /class="marker-ring"[^>]+pointer-events="none"/);
    assert.match(html, /<text[^>]+pointer-events="none"/);
    const hit = /class="marker-hit" x="([^"]+)" y="3" width="([^"]+)"[^>]+pointer-events="all"/.exec(html);
    assert.ok(hit);
    return { left: Number(hit[1]), width: Number(hit[2]) };
  });
  assert.equal(boxes[0].width, 8);
  assert.equal(boxes[0].left + boxes[0].width, boxes[1].left);
});
