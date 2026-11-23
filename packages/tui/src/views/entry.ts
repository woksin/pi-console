import { displayWidth, graphemes, searchNeedle, searchRanges, wrap, type TextRange, type TextWidth, type TranscriptLine } from '@pi-console/viewmodels';
import type { Line, Part } from '../view/renderer.ts';
import type { Color } from '../view/theme.ts';
import { t } from '../view/parts.ts';

/** Compact transcript previews: wrapped rows shown per kind. Anything beyond is reachable in the full-entry viewer. */
export const LIMITS: Record<TranscriptLine['kind'], number> = { user: 8, thinking: 2, assistant: 14, tool: 1, result: 3, diff: 12, reset: 1 };

export interface EntryStyle { color: Color; italic?: true; bold?: true }

export function entryStyle(entry: TranscriptLine): EntryStyle {
  switch (entry.kind) {
    case 'thinking': return { color: 'faint', italic: true };
    case 'result': return { color: entry.tool?.resultKind === 'error' ? 'red' : 'muted' };
    case 'user': return { color: 'blue', bold: true };
    default: return { color: 'text' };
  }
}

export const diffColor = (text: string): Color => (text.startsWith('+') ? 'green' : text.startsWith('-') ? 'red' : text.startsWith('@') ? 'violet' : 'muted');

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

/** Shown diff lines that `clip` cut at the right edge. */
function clippedDiffLines(entry: TranscriptLine, body: number, measure: TextWidth = displayWidth): number {
  return entry.text.split('\n').slice(0, LIMITS.diff).filter(text => measure(text.replace(/\s+/g, ' ')) > body).length;
}

/** A tool call is one row, `name args`; its arguments are clipped to what is left of the row. */
function clippedToolArgs(tool: NonNullable<TranscriptLine['tool']>, body: number, measure: TextWidth = displayWidth): number {
  return measure(tool.args.replace(/\s+/g, ' ')) > Math.max(4, body - tool.name.length - 1) ? 1 : 0;
}

function hiddenOf(entry: TranscriptLine, body: number, measure?: TextWidth): { more: number; clipped: number } {
  if (entry.kind === 'tool' && entry.tool) return { more: 0, clipped: clippedToolArgs(entry.tool, body, measure) };
  if (entry.kind === 'diff') return { more: Math.max(0, entry.text.split('\n').length - LIMITS.diff), clipped: clippedDiffLines(entry, body, measure) };
  return { more: Math.max(0, wrap(entry.text, body, undefined, measure).length - LIMITS[entry.kind]), clipped: 0 };
}

/** The explicit "… N more lines" row under a compact preview that cut the entry short; `undefined` when nothing was hidden. */
export function previewNote(entry: TranscriptLine, body: number, measure?: TextWidth): string | undefined {
  const { more, clipped } = hiddenOf(entry, body, measure);
  const parts = [more > 0 ? plural(more, 'more line') : '', clipped > 0 ? `${plural(clipped, 'line')} clipped` : ''].filter(Boolean);
  return parts.length === 0 ? undefined : `… ${parts.join(', ')} · ⏎ opens the full entry`;
}

/** One wrapped row of the full entry, with the style its logical line carries. `source` gives, for each UTF-16 unit of `text`, its index in the entry text the search matches against; rows that are not entry text have none. */
export interface EntryRow { text: string; color: Color; bold?: boolean; italic?: boolean; source?: readonly number[] }

const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);

/** Records where each row unit came from in `text`. Wrapping only drops or collapses whitespace and cuts words, so the rows read back in order out of `text`. */
function withSources(rows: readonly EntryRow[], text: string): EntryRow[] {
  let at = 0;
  const skipSpace = (): void => { while (isSpace(text[at])) at++; };
  return rows.map(row => {
    const source: number[] = [];
    for (const char of row.text) {
      if (!isSpace(char)) skipSpace();
      const start = at;
      if (text.startsWith(char, at)) at += char.length;
      else skipSpace();
      for (let unit = 0; unit < char.length; unit++) source.push(start + unit);
    }
    return { ...row, source };
  });
}

/** Wraps at the cell edge and keeps every space, so code, diffs and tool output keep their shape. */
function hardWrap(text: string, width: number, measure: TextWidth): string[] {
  const rows: string[] = [];
  let row = '';
  let used = 0;
  for (const item of graphemes(text)) {
    const size = measure(item);
    if (used + size > width && row) { rows.push(row); row = ''; used = 0; }
    row += item;
    used += size;
  }
  return [...rows, row];
}

const plainRows = (text: string, width: number, measure: TextWidth, style: EntryStyle): EntryRow[] =>
  text.split('\n').flatMap(line => hardWrap(line, width, measure).map((row): EntryRow => ({ text: row, color: style.color, bold: style.bold, italic: style.italic })));

const diffRows = (text: string, width: number, measure: TextWidth): EntryRow[] =>
  text.split('\n').flatMap(line => hardWrap(line, width, measure).map((row): EntryRow => ({ text: row, color: diffColor(line) })));

function resetRows(entry: TranscriptLine, width: number, measure: TextWidth): EntryRow[] {
  const { reset } = entry;
  if (!reset) return plainRows(`reset · ${entry.text}`, width, measure, { color: 'pink' });
  const requests = (label: string, items: typeof reset.carried): string[] => items.map(request => `${label} ${request.id} ${request.text}`);
  return plainRows([reset.summary, ...requests('carried', reset.carried), ...requests('interrupted', reset.interrupted)].join('\n'), width, measure, { color: 'pink' });
}

/** The call's arguments, then (when it differs) the entry text the search matches against; whichever is the entry text carries the sources. */
function toolRows(entry: TranscriptLine, width: number, measure: TextWidth): EntryRow[] {
  const name: EntryRow = { text: entry.tool?.name ?? 'tool', color: 'cyan', bold: true };
  const args = entry.tool?.args ?? '';
  const rows = (text: string): EntryRow[] => plainRows(text, width, measure, { color: 'muted' });
  if (!entry.text) return [name, ...rows(args)];
  if (entry.text === args) return [name, ...withSources(rows(args), entry.text)];
  return [name, ...(args ? [...rows(args), ...rows('')] : []), ...withSources(rows(entry.text), entry.text)];
}

/** The complete entry, wrapped to `width`; nothing is capped. Prose wraps at words, everything else at the cell edge. */
export function fullRows(entry: TranscriptLine, width: number, measure: TextWidth): EntryRow[] {
  const style = entryStyle(entry);
  switch (entry.kind) {
    case 'diff': return withSources(diffRows(entry.text, width, measure), entry.text);
    case 'reset': return resetRows(entry, width, measure);
    case 'tool': return toolRows(entry, width, measure);
    case 'result': return withSources(plainRows(entry.text, width, measure, style), entry.text);
    default: return withSources(wrap(entry.text, width, undefined, measure).map((text): EntryRow => ({ text, color: style.color, bold: style.bold, italic: style.italic })), entry.text);
  }
}

/** Column ranges `[from, to)` of a row that belong to a search match. */
type Span = readonly [number, number];

/** Splits a row around the given match spans. */
function marked(row: EntryRow, spans: readonly Span[] = []): Part[] {
  const base = (text: string): Part => t(text, row.color, { bold: row.bold, italic: row.italic });
  const parts: Part[] = [];
  let at = 0;
  for (const [from, to] of spans) {
    if (from > at) parts.push(base(row.text.slice(at, from)));
    parts.push(t(row.text.slice(from, to), 'cyan', { bold: true, underline: true }));
    at = to;
  }
  return at < row.text.length ? [...parts, base(row.text.slice(at))] : parts;
}

/** The part of a row that lies inside a match range of the entry text. */
function spanIn(row: EntryRow, [from, to]: TextRange): Span | undefined {
  const columns = (row.source ?? []).flatMap((index, column) => (index >= from && index < to ? [column] : []));
  return columns.length === 0 ? undefined : [columns[0], columns[columns.length - 1] + 1];
}

/**
 * Match spans per row for `search`. Matches are found in the entry's own text by the transcript filter's rule, then mapped onto the wrapped rows through
 * each row's source indexes, so a match split at a wrap boundary (inside a token, or across a space the wrap dropped) is marked on every row it touches.
 */
export function matchSpans(rows: readonly EntryRow[], entryText: string, search: string): Map<number, Span[]> {
  const found = new Map<number, Span[]>();
  for (const range of searchRanges(entryText, searchNeedle(search))) {
    rows.forEach((row, index) => {
      const span = spanIn(row, range);
      if (span) found.set(index, [...(found.get(index) ?? []), span]);
    });
  }
  return found;
}

export interface EntryDocument { lines: Line[]; match: number | null }

/** The viewer's content: every wrapped row, the search needle highlighted, and the row of the first match. */
export function entryDocument(entry: TranscriptLine, view: { width: number; search: string; measure: TextWidth }): EntryDocument {
  const rows = fullRows(entry, view.width, view.measure);
  const spans = matchSpans(rows, entry.text, view.search);
  return { lines: rows.map((row, index) => marked(row, spans.get(index))), match: spans.size === 0 ? null : Math.min(...spans.keys()) };
}
