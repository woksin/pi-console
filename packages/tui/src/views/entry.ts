import { displayWidth, graphemes, searchNeedle, searchRanges, wrap, wrapWithSources, type TextRange, type TextWidth, type TranscriptLine, type WrappedText } from '@pi-console/viewmodels';
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

/** One wrapped row of the full entry, with the style its logical line carries. `source` gives each UTF-16 unit's index in the entry text the search matches against; synthetic units use -1. */
export interface EntryRow { text: string; color: Color; bold?: boolean; italic?: boolean; source?: readonly number[] }

/** Wraps at the cell edge and records source units as they are consumed, retaining indentation verbatim. */
function hardWrap(input: { text: string; at: number }, width: number, measure: TextWidth): WrappedText[] {
  const rows: WrappedText[] = [];
  let row: WrappedText = { text: '', source: [] };
  let used = 0;
  let at = input.at;
  for (const item of graphemes(input.text)) {
    const size = measure(item);
    if (used + size > width && row.text) { rows.push(row); row = { text: '', source: [] }; used = 0; }
    row.text += item;
    for (let unit = 0; unit < item.length; unit++) row.source.push(at < 0 ? -1 : at + unit);
    if (at >= 0) at += item.length;
    used += size;
  }
  return [...rows, row];
}

interface RowLayout { width: number; measure: TextWidth; sourced?: boolean }

function cellRows(text: string, { width, measure, sourced }: RowLayout, style: (line: string) => EntryStyle): EntryRow[] {
  let at = 0;
  return text.split('\n').flatMap(line => {
    const rows = hardWrap({ text: line, at: sourced ? at : -1 }, width, measure).map(row => ({ ...row, ...style(line) }));
    at += line.length + 1;
    return rows;
  });
}

const plainRows = (text: string, width: number, measure: TextWidth, style: EntryStyle): EntryRow[] =>
  cellRows(text, { width, measure }, () => style);

function resetRows(entry: TranscriptLine, width: number, measure: TextWidth): EntryRow[] {
  const { reset } = entry;
  if (!reset) return plainRows(`reset · ${entry.text}`, width, measure, { color: 'pink' });
  const requests = (label: string, items: typeof reset.carried): string[] => items.map(request => `${label} ${request.id} ${request.text}`);
  return plainRows([reset.summary, ...requests('carried', reset.carried), ...requests('interrupted', reset.interrupted)].join('\n'), width, measure, { color: 'pink' });
}

/** The call's arguments, then (when it differs) the entry text the search matches against; whichever is the entry text carries the sources. */
function toolRows(entry: TranscriptLine, width: number, measure: TextWidth): EntryRow[] {
  const label = entry.tool?.name ?? 'tool';
  const name: EntryRow = { text: label, source: Array.from({ length: label.length }, () => -1), color: 'cyan', bold: true };
  const args = entry.tool?.args ?? '';
  const rows = (text: string, sourced = false): EntryRow[] => cellRows(text, { width, measure, sourced }, () => ({ color: 'muted' }));
  if (!entry.text) return [name, ...rows(args)];
  if (entry.text === args) return [name, ...rows(args, true)];
  return [name, ...(args ? [...rows(args), ...rows('')] : []), ...rows(entry.text, true)];
}

/** The complete entry, wrapped to `width`; nothing is capped. Prose wraps at words, everything else at the cell edge. */
export function fullRows(entry: TranscriptLine, width: number, measure: TextWidth): EntryRow[] {
  const style = entryStyle(entry);
  switch (entry.kind) {
    case 'diff': return cellRows(entry.text, { width, measure, sourced: true }, line => ({ color: diffColor(line) }));
    case 'reset': return resetRows(entry, width, measure);
    case 'tool': return toolRows(entry, width, measure);
    case 'result': return cellRows(entry.text, { width, measure, sourced: true }, () => style);
    default: return wrapWithSources(entry.text, width, measure).map(row => ({ ...row, ...style }));
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

interface MatchCursor { at: number; ranges: readonly TextRange[] }

/** The cursor only moves forwards, once per match, even across dropped whitespace or synthetic cells. */
function rangeAt(source: number, cursor: MatchCursor): number {
  if (source < 0) return -1;
  while (cursor.at < cursor.ranges.length && source >= cursor.ranges[cursor.at][1]) cursor.at++;
  const range = cursor.ranges[cursor.at];
  return range && source >= range[0] ? cursor.at : -1;
}

function spansIn(row: EntryRow, cursor: MatchCursor): Span[] {
  const spans: Span[] = [];
  let start = 0;
  let active = -1;
  (row.source ?? []).forEach((source, column) => {
    const hit = rangeAt(source, cursor);
    if (hit === active) return;
    if (active >= 0) spans.push([start, column]);
    start = column;
    active = hit;
  });
  if (active >= 0) spans.push([start, row.text.length]);
  return spans;
}

/**
 * Match spans per row for `search`. Matches are found in the entry's own text by the transcript filter's rule, then mapped onto the wrapped rows through
 * each row's source indexes, so a match split at a wrap boundary (inside a token, or across a space the wrap dropped) is marked on every row it touches.
 */
export function matchSpans(rows: readonly EntryRow[], entryText: string, search: string): Map<number, Span[]> {
  const found = new Map<number, Span[]>();
  const ranges = searchRanges(entryText, searchNeedle(search));
  const cursor = { at: 0, ranges };
  rows.forEach((row, index) => {
    const spans = spansIn(row, cursor);
    if (spans.length > 0) found.set(index, spans);
  });
  return found;
}

export interface EntryDocument { lines: Line[]; match: number | null }

/** The viewer's content: every wrapped row, the search needle highlighted, and the row of the first match. */
export function entryDocument(entry: TranscriptLine, view: { width: number; search: string; measure: TextWidth }): EntryDocument {
  const rows = fullRows(entry, view.width, view.measure);
  const spans = matchSpans(rows, entry.text, view.search);
  return { lines: rows.map((row, index) => marked(row, spans.get(index))), match: spans.keys().next().value ?? null };
}
