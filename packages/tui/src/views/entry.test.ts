import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, graphemes, matchesSearch, searchNeedle, searchRanges, type TextWidth, type TranscriptLine } from '@pi-console/viewmodels';
import { entryDocument, fullRows, matchSpans, previewNote, type EntryDocument, type EntryRow } from './entry.ts';

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

test('indentation after a dropped newline has its exact source indices', () => {
  const text = 'a\n  needle';
  const rows = fullRows(entry('result', text), 80, displayWidth);
  assert.deepEqual(rows.map(row => row.source), [[0], [2, 3, 4, 5, 6, 7, 8, 9]]);
  assert.deepEqual(highlighted('result', text, 'needle', 80).marked, ['', 'needle']);
});

test('Greek capitals fold the same way with and without an expanding dotted I', () => {
  for (const kind of ['assistant', 'result', 'diff'] as const) {
    assert.deepEqual(highlighted(kind, 'ΟΣ İ', 'ΟΣ', 80).marked, ['ΟΣ']);
    assert.deepEqual(highlighted(kind, '😀ΟΣ İ😀', '😀ΟΣ', 2, displayWidth).marked, ['😀', 'ΟΣ', '', '']);
  }
});

test('synthetic tool labels, arguments and reset descriptions never receive highlights', () => {
  const tool = { name: 'needle', args: 'needle', resultKind: 'text', withheld: false, truncated: false };
  for (const item of [{ ...entry('tool', ''), tool }, { ...entry('tool', 'actual needle'), tool }, entry('reset', 'needle')]) {
    const rows = fullRows(item, 4, displayWidth);
    const document = entryDocument(item, { width: 4, search: 'needle', measure: displayWidth });
    const sources = underlinedSources(document, rows);
    assert.ok(sources.every(index => index >= 0));
    assert.equal(sources.length, item.kind === 'tool' && item.text ? 6 : 0);
  }
});

/** Fixed-seed samples include indentation, blank lines, combining marks, astral CJK and joined emoji. */
function generatedTexts(): string[] {
  let seed = 0x180;
  const next = (limit: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const alphabet = ['a', 'b', 'N', 'e', ' ', '  ', '\n', '\n  ', '😀', '👩🏽‍💻', '界', '𠀀', 'e\u0301', 'İ', 'Ο', 'Σ', '-'];
  return Array.from({ length: 60 }, () => Array.from({ length: 15 + next(45) }, () => alphabet[next(alphabet.length)]).join(''));
}

/** Every retained unit is original, in order; only whitespace may have disappeared at these widths. */
function retainedSources(rows: readonly EntryRow[], text: string): number[] {
  const indices: number[] = [];
  let retained = '';
  for (const row of rows) {
    assert.equal(row.source?.length, row.text.length);
    row.source?.forEach((source, column) => {
      if (source < 0) return;
      assert.equal(row.text[column], text[source]);
      assert.ok(source > (indices.at(-1) ?? -1));
      indices.push(source);
      retained += row.text[column];
    });
  }
  const kept = new Set(indices);
  const expected = text.split('').filter((unit, index) => {
    if (kept.has(index)) return true;
    assert.match(unit, /\s/);
    return false;
  }).join('');
  assert.equal(retained, expected);
  return indices;
}

/** Read the actual styled parts, not just the intermediate match spans. */
function underlinedSources(document: EntryDocument, rows: readonly EntryRow[]): number[] {
  return document.lines.flatMap((line, index) => {
    assert.equal(line.map(part => part.text).join(''), rows[index].text);
    let column = 0;
    return line.flatMap(part => {
      const from = column;
      column += part.text.length;
      return part.underline ? (rows[index].source ?? []).slice(from, column) : [];
    });
  });
}

function checkHighlights(item: TranscriptLine, { width, rows, retained }: { width: number; rows: EntryRow[]; retained: number[] }, search: string): void {
  const needle = searchNeedle(search);
  const ranges = searchRanges(item.text, needle);
  assert.equal(matchesSearch(item.text, needle), ranges.length > 0);
  const matched = new Set<number>();
  for (const [from, to] of ranges) for (let index = from; index < to; index++) matched.add(index);
  const document = entryDocument(item, { width, search, measure: displayWidth });
  assert.deepEqual(underlinedSources(document, rows), retained.filter(index => matched.has(index)));
  const first = rows.findIndex(row => row.source?.some(index => matched.has(index)));
  assert.equal(document.match, first < 0 ? null : first);
}

test('seeded source-map properties hold across generated text, widths, kinds and needles', () => {
  for (const text of generatedTexts()) for (const width of [2, 3, 7, 16, 40]) for (const kind of ['assistant', 'result', 'diff'] as const) {
    const item = entry(kind, text);
    const rows = fullRows(item, width, displayWidth);
    const retained = retainedSources(rows, text);
    const needles = ['', 'a', ' ', '\n  ', '😀', '界', 'ΟΣ', ...graphemes(text).slice(0, 2), graphemes(text).slice(-3).join('')];
    for (const search of needles) checkHighlights(item, { width, rows, retained }, search);
  }
});

function timedDocument(matches: number): { elapsed: number; document: ReturnType<typeof entryDocument> } {
  const item = entry('assistant', 'a '.repeat(matches));
  const start = performance.now();
  const document = entryDocument(item, { width: 80, search: 'a', measure: displayWidth });
  return { elapsed: performance.now() - start, document };
}

test('entry document cost grows linearly with the number of matches', () => {
  timedDocument(2000);
  const small = timedDocument(10000).elapsed;
  const { elapsed: large, document } = timedDocument(20000);
  // Scaling, not wall-clock time, is the contract: a quadratic sweep is about 4x here; linear is about 2x.
  // The absolute bound only catches catastrophic regressions on a loaded machine.
  assert.ok(large < Math.max(small, 20) * 3.2, `20k matches took ${String(large)} ms versus ${String(small)} ms for 10k`);
  assert.ok(large < 3000, `entryDocument took ${String(large)} ms`);
  assert.equal(document.match, 0);
  assert.equal(document.lines.flat().filter(part => part.underline).map(part => part.text).join(''), 'a'.repeat(20000));
});
