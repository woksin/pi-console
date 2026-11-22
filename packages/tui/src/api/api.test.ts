import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonClient } from './client.ts';
import { FrameParser } from './sse.ts';
import { CredentialError, resolveCredentials } from './token.ts';

test('the SSE parser handles split chunks, CRLF, comments and multi-line data', () => {
  const parser = new FrameParser();
  assert.deepEqual(parser.push(': keep-alive\n\nid: 4\nev'), []);
  const frames = parser.push('ent: session.updated\r\ndata: {"a":\r\ndata: 1}\r\n\r\nid: 5\ndata: x\n\n');
  assert.deepEqual(frames, [{ id: '4', event: 'session.updated', data: '{"a":\n1}' }, { id: '5', data: 'x' }]);
});

test('credentials: env token wins, loopback only', () => {
  assert.deepEqual(resolveCredentials({ PI_CONSOLE_TOKEN: ' abc ', PI_CONSOLE_URL: 'http://127.0.0.1:9' }), { baseUrl: 'http://127.0.0.1:9', token: 'abc', tokenSource: 'PI_CONSOLE_TOKEN' });
  assert.throws(() => resolveCredentials({ PI_CONSOLE_TOKEN: 'abc', PI_CONSOLE_URL: 'http://example.com:9' }), CredentialError);
  assert.throws(() => resolveCredentials({ PI_CONSOLE_TOKEN: 'abc', PI_CONSOLE_URL: 'https://127.0.0.1:9' }), CredentialError);
});

for (const origin of ['http://127.0.0.1:9', 'http://localhost:9', 'http://[::1]:9']) {
  test(`credentials: slash and no-slash endpoints use identical REST and SSE URLs for ${origin}`, async t => {
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', (url: string) => {
      requests.push(url);
      return Promise.resolve(new Response(url.endsWith('/stream') ? ': keep-alive\n\n' : '{"items":[]}'));
    });
    for (const endpoint of [origin, `${origin}/`]) {
      const client = new DaemonClient(resolveCredentials({ PI_CONSOLE_TOKEN: 'abc', PI_CONSOLE_URL: endpoint }));
      try {
        assert.equal(client.credentials.baseUrl, origin);
        await client.needsYou();
        await client.stream({ onEvent: () => { assert.fail('No data events expected'); }, onState: state => { if (state.connected) client.stop(); } });
      } finally { client.stop(); }
    }
    const expected = [`${origin}/api/v1/needs-you`, `${origin}/api/v1/stream`];
    assert.deepEqual(requests, [...expected, ...expected]);
  });
}

for (const [component, endpoint] of [
  ['path', 'http://127.0.0.1:9/api/v1'],
  ['path', 'http://127.0.0.1:9//'],
  ['query', 'http://127.0.0.1:9/?limit=1'],
  ['query', 'http://127.0.0.1:9/?'],
  ['fragment', 'http://127.0.0.1:9/#section'],
  ['fragment', 'http://127.0.0.1:9/#'],
  ['fragment', 'http://127.0.0.1:9/#?section'],
  ['username', 'http://user@127.0.0.1:9'],
  ['password', 'http://:secret@127.0.0.1:9'],
  ['username', 'http://user:secret@127.0.0.1:9'],
]) {
  test(`credentials: unsupported ${component} in ${endpoint} fails before connecting`, t => {
    const fetch = t.mock.method(globalThis, 'fetch');
    const stream = t.mock.method(DaemonClient.prototype, 'stream', () => Promise.resolve());
    assert.throws(() => {
      const client = new DaemonClient(resolveCredentials({ PI_CONSOLE_TOKEN: 'abc', PI_CONSOLE_URL: endpoint }));
      const unexpected = () => { assert.fail('Invalid credentials must not start streaming'); };
      void client.stream({ onEvent: unexpected, onState: unexpected });
    }, (error: unknown) => {
      assert.ok(error instanceof CredentialError);
      assert.equal(error.message, `PI_CONSOLE_URL has an unsupported ${component}. Set PI_CONSOLE_URL to http://127.0.0.1:<port> (origin only).`);
      return true;
    });
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(stream.mock.callCount(), 0);
  });
}

test('credentials: a token file must be owner-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-token-'));
  try {
    const file = join(directory, 'token');
    writeFileSync(file, 'secret\n');
    chmodSync(file, 0o644);
    assert.throws(() => resolveCredentials({ PI_CONSOLE_TOKEN_FILE: file }), /Refusing to read/);
    chmodSync(file, 0o600);
    assert.deepEqual(resolveCredentials({ PI_CONSOLE_TOKEN_FILE: file, PI_CONSOLE_URL: 'http://localhost:9/' }), { baseUrl: 'http://localhost:9', token: 'secret', tokenSource: file });
    assert.throws(() => resolveCredentials({ PI_CONSOLE_TOKEN_FILE: join(directory, 'missing') }), /No daemon token/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
