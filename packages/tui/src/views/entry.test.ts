import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, matchesSearch, searchNeedle, type TextWidth, type TranscriptLine } from '@pi-console/viewmodels';
import { entryDocument, fullRows, matchSpans, previewNote } from './entry.ts';

const cells = (text: string): number => [...text].length;
const entry = (kind: TranscriptLine['kind'], text: string): TranscriptLine => ({ key: 1, time: '12:00', kind, glyph: '', label: kind, color: 'text', text, streaming: false, tool: null, reset: null }) as unknown as TranscriptLine;

/** What the viewer underlines, in reading order. */
const highlighted = (kind: TranscriptLine['kind'], text: string, search: string, width: number, measure: TextWidth = cells) => {
  const document = entryDocument(entry(kind, text), { width, search, measure });
  return { match: document.match, marked: document.lines.map(line => line.filter(part => part.underline === true).map(part => part.text).join('|')) };
};

test('matches are found and marked in the original text, case-insensitively', () => {
  const text = 'alpha Beta gamma';
  const rows = fullRows(entry('assistant', text), 40, cells);
  assert.deepEqual([...matchSpans(rows, text, 'beta')], [[0, [[6, 10]]]]);
  assert.equal(matchSpans(rows, text, 'zzz').size, 0);
  assert.equal(matchSpans(rows, text, '').size, 0);
});

test('emoji and other surrogate pairs before and inside a match do not shift it', () => {
  assert.deepEqual(highlighted('assistant', '😀needle', 'needle', 40).marked, ['needle']);
  assert.deepEqual(highlighted('assistant', '😀😀😀😀😀😀needle', 'needle', 40).marked, ['needle']);
  assert.deepEqual(highlighted('assistant', 'a 😀x😀 b', '😀x😀', 40).marked, ['😀x😀']);
  assert.equal(highlighted('result', '😀😀😀😀😀😀needle', 'NEEDLE', 4).marked.join('').replace(/\|/g, ''), 'needle');
});

test('wide characters wrap by cells and the match stays on the right characters', () => {
  const result = highlighted('result', '你好世界你好needle世界', 'needle', 6, displayWidth);
  assert.equal(result.marked.join('').replace(/\|/g, ''), 'needle');
  assert.ok(result.match !== null);
  assert.equal(highlighted('result', '你好世界你好', '世界', 4, displayWidth).marked.join('').replace(/\|/g, ''), '世界');
});

test('a match split across a wrap boundary is marked on every row it touches', () => {
  assert.deepEqual(highlighted('assistant', 'aaaa bbbb cccc', 'bbbb cccc', 9), { match: 0, marked: ['bbbb', 'cccc'] });
  assert.deepEqual(highlighted('assistant', 'aaaa bbbb cccc', 'bb cc', 9).marked, ['bb', 'cc']);
  assert.deepEqual(highlighted('assistant', 'aaaa bbbb cccc', 'bbb', 9), { match: 0, marked: ['bbb', ''] });
  const split = highlighted('assistant', `${'filler '.repeat(8)}xxxxNEEDLExxxx`, 'needle', 10);
  assert.ok(split.match !== null && split.match > 0);
  assert.equal(split.marked.join('').replace(/\|/g, ''), 'NEEDLE');
});

test('the viewer marks exactly what the transcript filter selects', () => {
  const cases: [string, string][] = [['ab', 'a b'], ['a b', 'a b'], ['a  b', 'a b'], ['A\nb', 'a\nb'], ['İstanbul needle', 'needle'], ['xİx', 'x'], ['plain', 'zzz'], ['Straße', 'STRASSE'], ['😀a b😀', 'a b']];
  for (const [text, search] of cases) for (const kind of ['assistant', 'result', 'diff'] as const) {
    const selected = matchesSearch(text, searchNeedle(search));
    const result = highlighted(kind, text, search, 7);
    assert.equal(result.match !== null, selected, `${kind}: ${JSON.stringify(text)} / ${JSON.stringify(search)}`);
  }
  assert.equal(highlighted('assistant', 'ab', 'a b', 40).match, null);
});

test('a search term split inside a wrapped token opens at its row and is highlighted on both halves', () => {
  const text = `${'filler '.repeat(8)}xxxxNEEDLExxxx`;
  const document = entryDocument(entry('assistant', text), { width: 10, search: 'needle', measure: cells });
  assert.ok(document.match !== null && document.match > 0);
  assert.equal(document.lines.flat().filter(part => part.underline === true).map(part => part.text).join('').toLowerCase(), 'needle');
});

test('a clipped tool call gets the note too', () => {
  const tool = { name: 'read', args: 'a'.repeat(160), resultKind: 'text', withheld: false, truncated: false };
  assert.equal(previewNote({ ...entry('tool', ''), tool }, 80, cells), '… 1 line clipped · ⏎ opens the full entry');
  assert.equal(previewNote({ ...entry('tool', ''), tool: { ...tool, args: 'src/a.ts' } }, 80, cells), undefined);
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
