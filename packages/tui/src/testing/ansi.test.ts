import { test } from 'node:test';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
import { screenToAnsi } from './ansi.ts';

const { Terminal } = xterm;
const written = async (terminal: InstanceType<typeof Terminal>, data: string) => { await new Promise<void>(done => { terminal.write(data, done); }); };

test('the repaint carries truecolor, palette, bold and inverse and drops trailing blanks', async () => {
  const terminal = new Terminal({ cols: 20, rows: 3, allowProposedApi: true });
  await written(terminal, '\u001b[38;2;1;2;3mrgb\u001b[0m \u001b[1;31mbold\u001b[0m \u001b[7minv\u001b[0m   ');
  const rows = screenToAnsi(terminal).split('\r\n');
  assert.equal(rows.length, 3);
  const first = rows[0] ?? '';
  assert.ok(first.startsWith('\u001b[2J\u001b[H\u001b[0;38;2;1;2;3mrgb'));
  assert.ok(first.includes('\u001b[0;1;38;5;1mbold'));
  assert.ok(first.includes('\u001b[0;7minv'));
  assert.ok(first.endsWith('inv\u001b[0m'), 'trailing blanks are removed');
  assert.equal(rows[1], '\u001b[0m');
});
