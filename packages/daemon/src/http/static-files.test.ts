import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from '@pi-console/testkit';
import { specDaemon } from '../testing/harness.ts';
import { pageCsp } from './static-files.ts';

function webBundle(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-web-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><script type="module" src="/assets/app.js"></script>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'export {};');
  writeFileSync(join(root, 'secret.txt'), 'outside the bundle');
  symlinkSync(join(root, 'secret.txt'), join(dist, 'assets', 'escape.txt'));
  return dist;
}

test('the web bundle is served with a strict CSP and an SPA fallback, without a token', async t => {
  const spec = await specDaemon(undefined, { webDist: webBundle(t) });
  t.after(() => spec.close());
  const { port } = spec.daemon;
  const index = await call(port, '/');
  assert.equal(index.status, 200);
  assert.match(String(index.headers['content-type']), /^text\/html/);
  assert.equal(index.headers['content-security-policy'], pageCsp);
  for (const directive of ["default-src 'none'", "script-src 'self'", "frame-ancestors 'none'", "connect-src 'self'"]) assert.ok(pageCsp.includes(directive));
  assert.ok(!pageCsp.includes('unsafe'));
  assert.equal(index.headers['x-frame-options'], 'DENY');
  const asset = await call(port, '/assets/app.js');
  assert.match(String(asset.headers['content-type']), /^text\/javascript/);
  assert.equal((await call(port, '/sessions/s1')).text, index.text, 'client routes fall back to index.html');
  assert.equal((await call(port, '/assets/missing.js')).status, 404);
});

test('static paths cannot leave the bundle and still obey Host and Origin checks', async t => {
  const spec = await specDaemon(undefined, { webDist: webBundle(t) });
  t.after(() => spec.close());
  const { port } = spec.daemon;
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/assets/escape.txt', '/%00', '/%E0%A4%A']) {
    const reply = await call(port, path);
    assert.ok([400, 404].includes(reply.status), `${path} -> ${reply.status}`);
    assert.equal(reply.text.includes('outside the bundle'), false, path);
  }
  assert.equal((await call(port, '/', { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await call(port, '/', { headers: { Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await call(port, '/', { method: 'POST' })).status, 405);
});

test('a missing or unconfigured bundle is a plain 404 and the API keeps working', async t => {
  for (const webDist of [undefined, join(tmpdir(), 'pi-console-no-such-dist')]) {
    const spec = await specDaemon(undefined, { webDist });
    t.after(() => spec.close());
    const page = await call(spec.daemon.port, '/');
    assert.equal(page.status, 404);
    assert.match(String(page.headers['content-type']), /^text\/plain/);
    const api = await call(spec.daemon.port, '/api/v1/overview', { headers: { Authorization: `Bearer ${spec.token}` } });
    assert.equal(api.status, 200);
  }
});

test('without a usable web bundle the response carries the API-only hint and never the token', async t => {
  const missing = join(mkdtempSync(join(tmpdir(), 'pi-console-web-')), 'no-such-dist');
  t.after(() => { rmSync(join(missing, '..'), { recursive: true, force: true }); });
  for (const webDist of [undefined, missing]) {
    const spec = await specDaemon(undefined, { webDist });
    t.after(() => spec.close());
    const page = await call(spec.daemon.port, '/');
    assert.equal(page.status, 404);
    assert.match(page.text, /API only: start with --web-dist <path to packages\/web\/dist> to serve the web console/);
    assert.equal(page.text.includes(spec.token), false);
    assert.equal(page.text.includes('#token='), false);
  }
});
