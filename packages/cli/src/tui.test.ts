import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { main } from './main.ts';
import { runTuiCommand, tuiCommand, tuiUsage } from './tui.ts';

test('the TUI is launched with the FFI flag in a child process', () => {
  const { command, args } = tuiCommand('/usr/bin/node');
  assert.equal(command, '/usr/bin/node');
  assert.ok(args.includes('--experimental-ffi'));
  assert.ok(existsSync(args.at(-1) ?? ''));
});

function commandIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const environments: NodeJS.ProcessEnv[] = [];
  return {
    stdout, stderr, environments,
    get launches() { return environments.length; },
    out: (line: string) => { stdout.push(line); },
    err: (line: string) => { stderr.push(line); },
    launch: async (env: NodeJS.ProcessEnv) => { environments.push(env); return 7; },
  };
}

for (const flag of ['--help', '-h']) {
  test(`TUI ${flag} prints usage and exits zero without launching`, async () => {
    const io = commandIo();
    assert.equal(await runTuiCommand([flag], io), 0);
    assert.deepEqual(io.stdout, [tuiUsage]);
    assert.deepEqual(io.stderr, []);
    assert.equal(io.launches, 0);
  });
}

for (const args of [['--not-an-option'], ['-x'], ['unexpected'], ['--help', '--not-an-option']]) {
  test(`TUI ${args.join(' ')} fails with a usage hint without launching`, async () => {
    const io = commandIo();
    assert.equal(await runTuiCommand(args, io), 2);
    assert.deepEqual(io.stdout, []);
    assert.match(io.stderr.join('\n'), /Unknown option|Unexpected argument/);
    assert.match(io.stderr.join('\n'), /pi-console tui --help/);
    assert.equal(io.launches, 0);
  });
}

test('TUI without arguments launches once and preserves the child exit code', async () => {
  const io = commandIo();
  assert.equal(await runTuiCommand([], io), 7);
  assert.equal(io.launches, 1);
  assert.deepEqual(io.environments, [{ ...process.env }]);
  assert.deepEqual(io.stdout, []);
  assert.deepEqual(io.stderr, []);
});

test('TUI URL and data-dir flags override the inherited environment without changing it', async t => {
  const original = process.env;
  process.env = { ...original, PI_CONSOLE_URL: 'http://127.0.0.1:5888', PI_CONSOLE_DATA_DIR: '/env/data' };
  t.after(() => { process.env = original; });
  const io = commandIo();
  assert.equal(await runTuiCommand(['--url', 'http://localhost:5999', '--data-dir', '/flag/data'], io), 7);
  assert.deepEqual(io.environments, [{ ...process.env, PI_CONSOLE_URL: 'http://localhost:5999', PI_CONSOLE_DATA_DIR: '/flag/data' }]);
  assert.equal(process.env.PI_CONSOLE_URL, 'http://127.0.0.1:5888');
  assert.equal(process.env.PI_CONSOLE_DATA_DIR, '/env/data');
});

for (const flag of ['--url', '--data-dir']) {
  test(`TUI ${flag} needs a value and does not launch`, async () => {
    const io = commandIo();
    assert.equal(await runTuiCommand([flag], io), 2);
    assert.equal(io.launches, 0);
    assert.match(io.stderr.join('\n'), /argument missing/);
    assert.match(io.stderr.join('\n'), /pi-console tui --help/);
  });
}

test('unknown commands print usage and fail', async () => {
  const written: string[] = [];
  const original = console.error;
  console.error = (message: string) => { written.push(message); };
  try { assert.equal(await main(['nope']), 2); } finally { console.error = original; }
  assert.match(written.join(''), /Unknown command "nope"/);
  assert.match(written.join(''), /tui +Open the terminal console/);
});
