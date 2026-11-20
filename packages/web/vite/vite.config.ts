import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Static bundle for the daemon to serve under a strict CSP: no inline script or style, no external origins. */
export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  resolve: { alias: { '@pi-console/contract': resolve(import.meta.dirname, 'contract-browser.ts') } },
  build: { outDir: resolve(import.meta.dirname, '../dist'), emptyOutDir: true, target: 'es2023', sourcemap: false, cssCodeSplit: false, assetsInlineLimit: 0, modulePreload: { polyfill: false } },
  server: { host: '127.0.0.1' },
});
