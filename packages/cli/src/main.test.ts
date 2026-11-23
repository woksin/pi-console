import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const installed = fileURLToPath(new URL('../bin/pi-console.mjs', import.meta.url));
const direct = fileURLToPath(new URL('./main.ts', import.meta.url));
const launcher = new URL('../bin/pi-console.mjs', import.meta.url).href;
const { engines: { node: required } } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { engines: { node: string } };
const minimumMajor = Number(required.replace(/^>=/u, '').split('.')[0]);

for (const major of [18, minimumMajor - 1, minimumMajor, minimumMajor + 1]) {
  test(`launcher checks Node ${major} against package.json before importing the CLI`, () => {
    const version = `${major}.0.0`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });
      process.argv = [process.execPath, 'pi-console', '--help'];
      await import(${JSON.stringify(launcher)});
    `], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    if (major < minimumMajor) {
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `pi-console requires Node.js ${required} (running ${version}); install Node.js ${required} and retry.\n`);
    } else {
      assert.equal(result.status, 0);
      assert.match(result.stdout, /^Usage: pi-console <command>/);
      assert.equal(result.stderr, '');
    }
  });
}

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
    [['--backfill-days', '366'], '--backfill-days must be an integer 0-365'],
    [['--port', '65536'], '--port must be an integer 0-65535'],
  ] as const) {
    test(`${entry}: invalid ${argv[0]} exits two with a short error and usage hint`, () => {
      const result = invoke(entry, ['daemon', ...argv]);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `${message}\nRun "pi-console daemon --help" for usage.\n`);
    });
  }

  for (const argv of [['--not-an-option'], ['--port'], ['unexpected'], ['--no-source', 'not-a-source']]) {
    test(`${entry}: argument failure ${argv.join(' ')} exits two with a usage hint`, () => {
      const result = invoke(entry, ['daemon', ...argv]);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Run "pi-console daemon --help" for usage\.\n$/);
      assert.equal(result.stderr.trim().split('\n').length, 2);
    });
  }

  test(`${entry}: a broken config is a startup failure, not a usage error`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-console-cli-config-'));
    t.after(() => { rmSync(directory, { recursive: true, force: true }); });
    const file = join(directory, 'config.json');
    writeFileSync(file, '{');
    const result = invoke(entry, ['daemon', '--data-dir', directory]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `Invalid JSON in ${file}; fix the JSON syntax and restart the daemon.\n`);
  });

  for (const flag of ['--help', '-h']) {
    test(`${entry}: tui ${flag} prints usage without launching the terminal`, () => {
      const result = invoke(entry, ['tui', flag]);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /^Usage: pi-console tui \[options\]/);
      assert.match(result.stdout, /PI_CONSOLE_DATA_DIR/);
      assert.equal(result.stderr, '');
    });
  }

  test(`${entry}: an unsupported TUI option exits two with a usage hint`, () => {
    const result = invoke(entry, ['tui', '--not-an-option']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Unknown option '--not-an-option'/);
    assert.match(result.stderr, /pi-console tui --help/);
  });

  test(`${entry}: PI_CONSOLE_DEBUG=1 includes the stack for diagnosis`, () => {
    const result = invoke(entry, ['daemon', '--port', 'banana'], '1');
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Error: --port must be a non-negative integer\n\s+at /);
    assert.match(result.stderr, /daemon-command\.ts:\d+/);
    assert.match(result.stderr, /Run "pi-console daemon --help" for usage\.\n$/);
  });

  test(`${entry}: other debug values keep stacks hidden`, () => {
    const result = invoke(entry, ['daemon', '--port', 'banana'], '0');
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '--port must be a non-negative integer\nRun "pi-console daemon --help" for usage.\n');
  });

  for (const word of ['--help', '-h', 'help']) {
    test(`${entry}: ${word} prints usage to stdout and exits zero`, () => {
      const result = invoke(entry, [word]);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.match(result.stdout, /^Usage: pi-console <command>/);
      assert.match(result.stdout, /PI_CONSOLE_DEBUG=1.*stack/);
    });
  }

  test(`${entry}: an unknown command exits two with usage on stderr`, () => {
    const result = invoke(entry, ['open']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Unknown command "open"/);
  });
}
