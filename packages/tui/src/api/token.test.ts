import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { resolveCredentials } from './token.ts';

function dataDir(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-tui-token-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  writeFileSync(join(directory, 'token'), 'secret', { mode: 0o600 });
  return directory;
}

function setEnv(t: TestContext, key: string, value: string): void {
  const before = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (before === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = before;
  });
}

test('credentials use the configured port and token from the same data directory', t => {
  const directory = dataDir(t);
  writeFileSync(join(directory, 'config.json'), '{"port":5888}');
  assert.deepEqual(resolveCredentials({ PI_CONSOLE_DATA_DIR: directory }), {
    baseUrl: 'http://127.0.0.1:5888', token: 'secret', tokenSource: join(directory, 'token'),
  });
});

test('an explicit URL in the environment takes precedence over the configured port', t => {
  const directory = dataDir(t);
  writeFileSync(join(directory, 'config.json'), '{"port":5888}');
  const credentials = resolveCredentials({ PI_CONSOLE_DATA_DIR: directory, PI_CONSOLE_URL: 'http://localhost:5999' });
  assert.equal(credentials.baseUrl, 'http://localhost:5999');
  assert.equal(credentials.tokenSource, join(directory, 'token'));
});

test('relative data directories resolve both configuration and token paths', t => {
  const directory = dataDir(t);
  writeFileSync(join(directory, 'config.json'), '{"port":5888}');
  const credentials = resolveCredentials({ PI_CONSOLE_DATA_DIR: relative(process.cwd(), directory) });
  assert.equal(credentials.baseUrl, 'http://127.0.0.1:5888');
  assert.equal(credentials.tokenSource, join(directory, 'token'));
});

test('without a data-dir override credentials use the shared daemon default directory', t => {
  const home = dataDir(t);
  const directory = join(home, '.pi-console');
  mkdirSync(directory);
  writeFileSync(join(directory, 'config.json'), '{"port":5888}');
  writeFileSync(join(directory, 'token'), 'default-home-token', { mode: 0o600 });
  setEnv(t, 'HOME', home);
  setEnv(t, 'USERPROFILE', home);
  assert.deepEqual(resolveCredentials({}), {
    baseUrl: 'http://127.0.0.1:5888', token: 'default-home-token', tokenSource: join(directory, 'token'),
  });
});

test('without a config file credentials fall back to loopback port 4777', t => {
  const directory = dataDir(t);
  assert.equal(resolveCredentials({ PI_CONSOLE_DATA_DIR: directory }).baseUrl, 'http://127.0.0.1:4777');
});

for (const config of ['{', 'null', '[]', '{}', '{"port":"5888"}', '{"port":70000}']) {
  test(`credentials silently use the default port for config ${config}`, t => {
    const directory = dataDir(t);
    writeFileSync(join(directory, 'config.json'), config);
    const credentials = resolveCredentials({ PI_CONSOLE_DATA_DIR: directory });
    assert.equal(credentials.baseUrl, 'http://127.0.0.1:4777');
    assert.equal(credentials.tokenSource, join(directory, 'token'));
  });
}

test('a token with a control character is refused up front without echoing it', t => {
  const directory = dataDir(t);
  const hostile = 'abc123\nX-Injected: sekrit-tail';
  for (const env of [{ PI_CONSOLE_DATA_DIR: directory, PI_CONSOLE_TOKEN: hostile }, { PI_CONSOLE_DATA_DIR: directory, PI_CONSOLE_TOKEN: 'abc\u0007def' }]) {
    assert.throws(() => resolveCredentials(env), (error: Error) => error.name === 'Error' && error.message.includes('control') && !/sekrit|abc123|abc.def/.test(error.message));
  }
  const file = join(directory, 'hostile');
  writeFileSync(file, 'abc123\u0000sekrit-tail\n', { mode: 0o600 });
  assert.throws(() => resolveCredentials({ PI_CONSOLE_DATA_DIR: directory, PI_CONSOLE_TOKEN_FILE: file }), (error: Error) => !/sekrit|abc123/.test(error.message));
});
