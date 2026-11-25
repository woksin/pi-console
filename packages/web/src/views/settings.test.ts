import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let ValueDetail: ComponentType<{ detail: string }>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ ValueDetail } = await server.ssrLoadModule('/src/views/settings.tsx'));
});
after(async () => { await server.close(); });

test('a Settings source detail renders each fact as its own unbroken block with no separator character', () => {
  const html = renderToStaticMarkup(createElement(ValueDetail, { detail: 'polled 3s ago · 2026-11-20 11:59:57' }));
  assert.equal((html.match(/<span class="nowrap">/g) ?? []).length, 2);
  assert.ok(html.includes('polled 3s ago') && html.includes('2026-11-20 11:59:57'));
  assert.ok(!html.replace(/ title="[^"]*"/, "").includes("·"));
});
