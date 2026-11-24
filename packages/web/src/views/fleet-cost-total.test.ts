import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { partialCostExplanation } from './fleet-cost.ts';

let server: ViteDevServer;
let FleetCost: ComponentType<{ cost: string; coverage: string | undefined }>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ FleetCost } = await server.ssrLoadModule('/src/views/overview.tsx'));
});
after(async () => { await server.close(); });

const render = (cost: string, coverage?: string): string => renderToStaticMarkup(createElement(FleetCost, { cost, coverage }));

test('a partial fleet total shows the ≥ marker, explains itself in a tooltip and to screen readers', () => {
  const html = render('≥$82.85', '28/30 sessions priced');
  assert.match(html, /<span aria-hidden="true">≥\$82\.85<\/span>/);
  assert.match(html, new RegExp(`title="${partialCostExplanation}; 28/30 sessions priced"`));
  assert.match(html, /at least \$82\.85\. Partial cost/);
});

test('an unknown or complete total, including a real zero, is plain text', () => {
  assert.equal(render('—'), '—');
  assert.equal(render('$0.00'), '$0.00');
  assert.equal(render('$82.85'), '$82.85');
});
