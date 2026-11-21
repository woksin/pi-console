import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
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

test('a missing bundle fails at startup with build instructions, before a server can listen', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-web-missing-'));
  try {
    assert.throws(() => createStaticServer({ root, daemon: { host: '127.0.0.1', port: 1 } }), error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(join(root, 'index.html')));
      assert.match(error.message, /npm run build -w @pi-console\/web/);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** Isolate unhandled stream errors so a regression reports a failed child instead of killing the test runner. */
function checkStreamFailure(mode: string, path: string): void {
  const source = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { once } from 'node:events';
    import { syncBuiltinESMExports } from 'node:module';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { PassThrough } from 'node:stream';
    import { createStaticServer } from './packages/web/src/server/static-server.ts';
    const [mode, path] = process.argv.slice(1);
    const root = fs.mkdtempSync(join(tmpdir(), 'pi-web-stream-'));
    fs.writeFileSync(join(root, 'index.html'), '<div id="root"></div>');
    fs.writeFileSync(join(root, 'app.js'), 'export {}');
    const original = fs.createReadStream;
    let broken;
    fs.createReadStream = (file, ...args) => {
      fs.createReadStream = original;
      syncBuiltinESMExports();
      if (mode === 'missing') {
        fs.unlinkSync(file);
        return original(file, ...args);
      }
      broken = new PassThrough();
      process.nextTick(() => { broken.emit('open', 0); broken.write('partial body'); });
      return broken;
    };
    syncBuiltinESMExports();
    const server = createStaticServer({ root, daemon: { host: '127.0.0.1', port: 1 } });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      const response = await fetch(base + path);
      if (mode === 'missing') {
        assert.equal(response.status, 500);
        await response.text();
      } else {
        assert.equal(response.status, 200);
        const body = response.text();
        broken.destroy(new Error('read failed after headers'));
        await assert.rejects(body);
      }
      fs.writeFileSync(join(root, 'index.html'), '<div id="root"></div>');
      assert.equal(await (await fetch(base + '/')).text(), '<div id="root"></div>');
    } finally {
      server.closeAllConnections();
      await new Promise(done => server.close(done));
      fs.rmSync(root, { recursive: true, force: true });
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, mode, path], {
    cwd: new URL('../../../..', import.meta.url), encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.status, 0, result.stderr);
}

for (const path of ['/app.js', '/missing-route']) {
  test(`a file removed between lookup and open returns 500 and keeps serving (${path})`, () => {
    checkStreamFailure('missing', path);
  });
}

test('a read error after headers closes the connection and keeps serving', () => {
  checkStreamFailure('partial', '/app.js');
});

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

/** Raw request: fetch cannot send a hostile request target or a forged Host header. */
const raw = (path: string, headers: Record<string, string> = {}): Promise<number> => new Promise((done, fail) => {
  const { port } = new URL(base);
  const call = request({ host: '127.0.0.1', port: Number(port), path, headers }, reply => { reply.resume(); done(reply.statusCode ?? 0); });
  call.on('error', fail);
  call.end();
});

test('a malformed request target is a 400, not a crash, and the server keeps serving', async () => {
  assert.equal(await raw('//['), 400);
  assert.equal((await fetch(`${base}/`)).status, 200);
});

test('the proxy refuses a foreign Host or Origin instead of laundering it into the daemon allowlist', async () => {
  assert.equal(await raw('/api/v1/needs-you', { Host: 'evil.example:80' }), 403);
  assert.equal(await raw('/api/v1/needs-you', { Origin: 'http://evil.example' }), 403);
  const { port } = new URL(base);
  assert.equal(await raw('/api/v1/needs-you', { Host: `localhost:${port}`, Origin: `http://localhost:${port}` }), 200);
});
