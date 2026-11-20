import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { contentSecurityPolicy, createStaticServer } from './static-server.ts';

let daemon: Server;
let web: Server;
let base = '';

const listen = (server: Server): Promise<number> => new Promise(done => { server.listen(0, '127.0.0.1', () => { done((server.address() as AddressInfo).port); }); });

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-web-'));
  writeFileSync(join(root, 'index.html'), '<div id="root"></div>');
  writeFileSync(join(root, 'app.js'), 'export {}');
  daemon = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization ?? null })); });
  const daemonPort = await listen(daemon);
  web = createStaticServer({ root, daemon: { host: '127.0.0.1', port: daemonPort } });
  base = `http://127.0.0.1:${String(await listen(web))}`;
});
after(() => { web.close(); daemon.close(); });

test('serves the shell and assets with the strict CSP and no inline allowances', async () => {
  const shell = await fetch(`${base}/`);
  assert.equal(shell.headers.get('content-security-policy'), contentSecurityPolicy);
  assert.doesNotMatch(contentSecurityPolicy, /unsafe-inline|unsafe-eval|\*/);
  assert.match(contentSecurityPolicy, /connect-src 'self'/);
  assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
  const script = await fetch(`${base}/app.js`);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
});

test('unknown paths and path traversal fall back to the shell, never the filesystem', async () => {
  assert.equal(await (await fetch(`${base}/fleet/anything`)).text(), '<div id="root"></div>');
  assert.equal(await (await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).text(), '<div id="root"></div>');
});

test('forwards /api requests with the bearer token untouched', async () => {
  const response = await fetch(`${base}/api/v1/needs-you`, { headers: { Authorization: 'Bearer abc' } });
  assert.deepEqual(await response.json(), { path: '/api/v1/needs-you', auth: 'Bearer abc' });
  assert.equal(response.headers.get('content-security-policy'), contentSecurityPolicy);
});

test('refuses non-GET requests to the static surface', async () => {
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
});
