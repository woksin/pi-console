import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { TextAttributes } from '@opentui/core';
import { startHarness, type Harness } from '../testing/harness.ts';
import { palette, themeFromEnv } from './theme.ts';

type Cell = ReturnType<Harness['ui']['spans']>['lines'][number]['spans'][number];
const cells = (harness: Harness): Cell[] => harness.ui.spans().lines.flatMap(line => line.spans);
/** Blank cells are skipped: OpenTUI writes its own white for cells nothing was drawn on, and a space shows no colour. */
const drawn = (harness: Harness): Cell[] => cells(harness).filter(cell => cell.text.trim() !== '');
const coloured = (cell: Cell): boolean => cell.fg.intent !== 'default' || (cell.bg.a > 0 && cell.bg.intent !== 'default');
const harnesses: Harness[] = [];
after(async () => { for (const harness of harnesses) await harness.stop(); palette.configure('truecolor', 'midnight'); });

const start = async (env: NodeJS.ProcessEnv): Promise<Harness> => {
  const harness = await startHarness({ width: 140, height: 42 }, { theme: themeFromEnv(env) });
  harnesses.push(harness);
  return harness;
};

test('NO_COLOR=1 draws overview, fleet and a selected row without colour and marks the selection inverse', async () => {
  const harness = await start({ NO_COLOR: '1' });
  assert.ok(palette.plain);
  const views: [string, string][] = [['1', 'Fleet'], ['2', 'Fleet ·']];
  for (const [key, title] of views) {
    await harness.ui.press(key);
    await harness.ui.waitFor(title);
    assert.deepEqual(drawn(harness).filter(coloured).map(cell => cell.text), [], `view ${key}`);
  }
  await harness.ui.press('j');
  await harness.ui.settle();
  assert.deepEqual(drawn(harness).filter(coloured).map(cell => cell.text), []);
  assert.ok(cells(harness).some(cell => (cell.attributes & TextAttributes.INVERSE) !== 0 && cell.text.trim() !== ''), 'the selected row is inverse');
  assert.ok(cells(harness).some(cell => (cell.attributes & TextAttributes.BOLD) !== 0), 'weight still carries emphasis');
});

test('an empty NO_COLOR keeps colour', async () => {
  const harness = await start({ NO_COLOR: '' });
  assert.ok(!palette.plain);
  assert.ok(drawn(harness).some(coloured));
  assert.ok(!cells(harness).some(cell => (cell.attributes & TextAttributes.INVERSE) !== 0));
});
