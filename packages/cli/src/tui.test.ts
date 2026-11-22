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
  let launches = 0;
  return {
    stdout, stderr,
    get launches() { return launches; },
    out: (line: string) => { stdout.push(line); },
    err: (line: string) => { stderr.push(line); },
    launch: async () => { launches++; return 7; },
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
  assert.deepEqual(io.stdout, []);
  assert.deepEqual(io.stderr, []);
});

test('unknown commands print usage and fail', async () => {
  const written: string[] = [];
  const original = console.error;
  console.error = (message: string) => { written.push(message); };
  try { assert.equal(await main(['nope']), 2); } finally { console.error = original; }
  assert.match(written.join(''), /Unknown command "nope"/);
  assert.match(written.join(''), /tui +Open the terminal console/);
});
