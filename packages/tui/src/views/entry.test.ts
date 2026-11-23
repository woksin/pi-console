import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TranscriptLine } from '@pi-console/viewmodels';
import { entryDocument, firstMatch, fullRows, previewNote, type EntryRow } from './entry.ts';

const cells = (text: string): number => [...text].length;
const entry = (kind: TranscriptLine['kind'], text: string): TranscriptLine => ({ key: 1, time: '12:00', kind, glyph: '', label: kind, color: 'text', text, streaming: false, tool: null, reset: null }) as unknown as TranscriptLine;
const row = (text: string): EntryRow => ({ text, color: 'text' });

test('firstMatch finds a row, case-insensitively, or a match that wraps across rows', () => {
  const rows = [row('alpha beta'), row('gam'), row('ma delta')];
  assert.equal(firstMatch(rows, 'beta', ' '), 0);
  assert.equal(firstMatch(rows, 'delta', ' '), 2);
  assert.equal(firstMatch(rows, 'gam ma', ' '), 1);
  assert.equal(firstMatch(rows, 'gamma', ''), 1);
  assert.equal(firstMatch(rows, 'zzz', ' '), null);
  assert.equal(firstMatch(rows, '', ' '), null);
});

test('previewNote counts hidden lines and clipped diff lines, and is silent for a whole entry', () => {
  assert.equal(previewNote(entry('assistant', 'short'), 80, cells), undefined);
  assert.equal(previewNote(entry('assistant', Array.from({ length: 20 }, (_, i) => `l${String(i)}`).join('\n')), 80, cells), '… 6 more lines · ⏎ opens the full entry');
  assert.match(previewNote(entry('diff', `+${'x'.repeat(200)}`), 40, cells) ?? '', /1 line clipped/);
});

test('fullRows keeps every line of a wide diff, wrapped at the cell edge', () => {
  const rows = fullRows(entry('diff', `+${'a'.repeat(95)}END\n-old`), 40, cells);
  assert.ok(rows.every(item => cells(item.text) <= 40));
  assert.equal(rows.map(item => item.text).join('').replace(/\s/g, ''), `+${'a'.repeat(95)}END-old`);
  assert.equal(rows[0].color, 'green');
  assert.equal(rows.at(-1)?.color, 'red');
});

test('entryDocument highlights the match and reports its row', () => {
  const text = Array.from({ length: 30 }, (_, i) => (i === 22 ? 'the NEEDLE here' : `line ${String(i)}`)).join('\n');
  const document = entryDocument(entry('assistant', text), { width: 60, search: 'needle', measure: cells });
  assert.equal(document.match, 22);
  assert.ok(document.lines[22].some(part => part.text === 'NEEDLE' && part.bold === true));
});
