import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticate, checkCsrf, HttpError } from './guard.ts';
import { Credentials, loadToken } from './token.ts';

const temp = (t: { after(fn: () => void): void }): string => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-token-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  return directory;
};

const request = (method: string, headers: Record<string, string>): IncomingMessage => ({ method, headers }) as unknown as IncomingMessage;

const status = (fn: () => void): number | undefined => {
  try {
    fn();
    return undefined;
  } catch (error) {
    assert.ok(error instanceof HttpError);
    return error.status;
  }
};

test('the token file is created owner-only in an owner-only directory and reused', t => {
  const directory = join(temp(t), 'data');
  const token = loadToken(directory);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, 'token')).mode & 0o777, 0o600);
  assert.equal(loadToken(directory), token);
});

test('loose permissions are tightened; malformed or symlinked token files are refused', t => {
  const directory = temp(t);
  writeFileSync(join(directory, 'token'), 'a'.repeat(64), { mode: 0o644 });
  loadToken(directory);
  assert.equal(statSync(join(directory, 'token')).mode & 0o777, 0o600);
  writeFileSync(join(directory, 'token'), 'short');
  assert.throws(() => loadToken(directory), /Invalid token file/);
  const other = temp(t);
  writeFileSync(join(other, 'elsewhere'), 'b'.repeat(64));
  rmSync(join(directory, 'token'));
  const originalMode = statSync(join(other, 'elsewhere')).mode;
  symlinkSync(join(other, 'elsewhere'), join(directory, 'token'));
  assert.throws(() => loadToken(directory));
  assert.equal(statSync(join(other, 'elsewhere')).mode, originalMode, 'refusal never chmods the symlink target');
});

test('credentials keep only a hash and accept exactly the token with read scope', t => {
  const token = loadToken(temp(t));
  const credentials = new Credentials(token);
  assert.equal(credentials.scope, 'read');
  assert.ok(credentials.verify(token));
  for (const wrong of [undefined, '', token.toUpperCase(), `${token} `, token.slice(1)]) assert.equal(credentials.verify(wrong), false);
  assert.equal(JSON.stringify(credentials).includes(token), false);
});

test('mutating requests need the CSRF header and an Origin, even with a cookie', t => {
  const token = loadToken(temp(t));
  const credentials = new Credentials(token);
  const url = new URL('http://127.0.0.1/api/v1/anything');
  const cookie = { cookie: `piConsoleToken=${token}` };
  assert.equal(status(() => { authenticate(request('POST', cookie), url, credentials); }), 403);
  assert.equal(status(() => { authenticate(request('POST', { ...cookie, origin: 'http://127.0.0.1:1' }), url, credentials); }), 403);
  assert.equal(status(() => { authenticate(request('POST', { ...cookie, origin: 'http://127.0.0.1:1', 'x-pi-console-csrf': '1' }), url, credentials); }), undefined);
  assert.equal(status(() => { checkCsrf(request('POST', { 'x-pi-console-csrf': '1' })); }), 403);
  assert.equal(status(() => { authenticate(request('POST', { authorization: `Bearer ${token}` }), url, credentials); }), undefined);
});
