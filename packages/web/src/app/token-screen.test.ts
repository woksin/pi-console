import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let TokenScreen: ComponentType<{ rejected: boolean; onToken: (token: string) => void }>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ TokenScreen } = await server.ssrLoadModule('/src/app/token-screen.tsx'));
});
after(async () => { await server.close(); });

test('the token screen points at the launch link and the token file, not at a command that does not exist', () => {
  const html = renderToStaticMarkup(createElement(TokenScreen, { rejected: false, onToken: () => undefined }));
  assert.match(html, /launch link the daemon printed/);
  assert.match(html, /<code>~\/\.pi-console\/token<\/code>/);
  assert.equal(html.includes('pi-console open'), false);
});
