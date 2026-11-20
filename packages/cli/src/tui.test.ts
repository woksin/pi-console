import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { main } from './main.ts';
import { tuiCommand } from './tui.ts';

test('the TUI is launched with the FFI flag in a child process', () => {
  const { command, args } = tuiCommand('/usr/bin/node');
  assert.equal(command, '/usr/bin/node');
  assert.ok(args.includes('--experimental-ffi'));
  assert.ok(existsSync(args.at(-1) ?? ''));
});

test('unknown commands print usage and fail', async () => {
  const written: string[] = [];
  const original = console.error;
  console.error = (message: string) => { written.push(message); };
  try { assert.equal(await main(['nope']), 2); } finally { console.error = original; }
  assert.match(written.join(''), /Unknown command "nope"/);
  assert.match(written.join(''), /tui +Open the terminal console/);
});
