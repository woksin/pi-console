import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let FirstRun: ComponentType<{ connected: boolean; sessions: number }>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ FirstRun } = await server.ssrLoadModule('/src/ui/empty.tsx'));
});
after(async () => { await server.close(); });

test('first run links the install steps once, without a second README pointer', () => {
  const html = renderToStaticMarkup(createElement(FirstRun, { connected: true, sessions: 0 }));
  assert.equal(html.match(/Install steps/g)?.length, 1);
  assert.doesNotMatch(html, /See README/);
});
