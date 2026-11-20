import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('credentials: a token file must be owner-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-token-'));
  try {
    const file = join(directory, 'token');
    writeFileSync(file, 'secret\n');
    chmodSync(file, 0o644);
    assert.throws(() => resolveCredentials({ PI_CONSOLE_TOKEN_FILE: file }), /Refusing to read/);
    chmodSync(file, 0o600);
    assert.equal(resolveCredentials({ PI_CONSOLE_TOKEN_FILE: file }).token, 'secret');
    assert.throws(() => resolveCredentials({ PI_CONSOLE_TOKEN_FILE: join(directory, 'missing') }), /No daemon token/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
