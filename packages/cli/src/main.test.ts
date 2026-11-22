import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installed = fileURLToPath(new URL('../bin/pi-console.mjs', import.meta.url));
const direct = fileURLToPath(new URL('./main.ts', import.meta.url));

function invoke(entry: string, argv: readonly string[], debug = '') {
  const result = spawnSync(process.execPath, [entry, ...argv], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, PI_CONSOLE_DEBUG: debug },
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.signal, null);
  return result;
}

for (const entry of [installed, direct]) {
  for (const [argv, message] of [
    [['--port', 'banana'], '--port must be a non-negative integer'],
    [['--source-poll-ms', '0'], '--source-poll-ms must be an integer 250-60000'],
  ] as const) {
    test(`${entry}: invalid ${argv[0]} prints only a short error and exits non-zero`, () => {
      const result = invoke(entry, ['daemon', ...argv]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `${message}\n`);
    });
  }

  test(`${entry}: argument parser failures also use the error boundary`, () => {
    const result = invoke(entry, ['daemon', '--not-an-option']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Unknown option '--not-an-option'/);
    assert.equal(result.stderr.trim().split('\n').length, 1);
  });

  test(`${entry}: PI_CONSOLE_DEBUG=1 includes the stack for diagnosis`, () => {
    const result = invoke(entry, ['daemon', '--port', 'banana'], '1');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Error: --port must be a non-negative integer\n\s+at /);
    assert.match(result.stderr, /daemon-command\.ts:\d+/);
  });

  test(`${entry}: other debug values keep stacks hidden`, () => {
    const result = invoke(entry, ['daemon', '--port', 'banana'], '0');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '--port must be a non-negative integer\n');
  });

  test(`${entry}: help documents debug errors and still succeeds`, () => {
    const result = invoke(entry, ['--help']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /PI_CONSOLE_DEBUG=1.*stack/);
  });
}
