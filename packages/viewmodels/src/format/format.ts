/** Display helpers shared by every view model: all pure, with layout measured in terminal cells. */

// Unbranded display units keep existing callers compatible while naming the meaning of each input.
type DisplayText = string;
type CellCount = number;
/** Measures a complete string or a single grapheme in the client's display cells. */
export type TextWidth = (text: DisplayText) => CellCount;
type IsoTimestamp = string;
type EpochMilliseconds = number;
type UsdAmount = number;
type Percentage = number;

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const terminalSequences = [
  new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?`, 'g'), // OSC (title, hyperlinks, clipboard)
  new RegExp(`${ESC}[P^_X][^${ESC}]*(?:${ESC}\\\\)?`, 'g'), // DCS, PM, APC, SOS
  new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g'), // CSI
  new RegExp(`${ESC}[@-Z\\\\-_]`, 'g'), // two-character escapes
];

/** Code points of a string; use `displayWidth` for terminal layout. */
export const cells = (text: DisplayText): string[] => Array.from(text);

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** User-perceived characters, including combining marks and joined emoji. */
export const graphemes = (text: DisplayText): string[] => Array.from(segmenter.segment(text), item => item.segment);
const zeroWidth = /[\p{Mark}\p{Cf}\p{Cc}]/gu;
const emojiPresentation = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[0-9#*]\uFE0F?\u20E3/u;
// East Asian Wide/Fullwidth blocks; ambiguous-width characters stay one cell.
const wideRanges = [
  [0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0xa4cf], [0xa960, 0xa97c],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff01, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x18dff], [0x1aff0, 0x1b2ff],
  [0x1f200, 0x1f251], [0x20000, 0x3fffd],
] as const;

function graphemeWidth(text: DisplayText): number {
  const base = text.replace(zeroWidth, '');
  if (!base) return 0;
  if (emojiPresentation.test(text)) return 2;
  const code = base.codePointAt(0) ?? 0;
  return code !== 0x303f && wideRanges.some(([start, end]) => code >= start && code <= end) ? 2 : 1;
}

/** Terminal display width, counting each grapheme once (including joined emoji and flags). */
export const displayWidth = (text: DisplayText): number => graphemes(text).reduce((sum, item) => sum + graphemeWidth(item), 0);

/** Takes whole graphemes, filling the last cell if a wide one would straddle the edge. */
function prefix(text: DisplayText, width: CellCount, measure: TextWidth): string {
  let result = '';
  let used = 0;
  for (const item of graphemes(text)) {
    const size = measure(item);
    if (used + size > width) return result + ' '.repeat(width - used);
    result += item;
    used += size;
  }
  return result;
}

const printable = (character: DisplayText): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code === 10 || (code >= 32 && code !== 127 && !(code >= 128 && code <= 159));
};

/** Strips terminal control sequences and control characters so transcript text can never drive the terminal or the DOM. */
export function sanitize(text: DisplayText): string {
  const stripped = terminalSequences.reduce((value, pattern) => value.replace(pattern, ''), text.replace(/\t/g, '  '));
  return cells(stripped).filter(printable).join('');
}

/** Clip terminal cells without changing whitespace; styled parts can retain their boundaries. */
export function clipCells(text: DisplayText, width: CellCount, measure: TextWidth = displayWidth): string {
  if (width <= 0) return '';
  return measure(text) <= width ? text : `${prefix(text, width - 1, measure)}…`;
}

/** One-line clip with an ellipsis. */
export function clip(text: DisplayText, width: CellCount, measure: TextWidth = displayWidth): string {
  return clipCells(text.replace(/\s+/g, ' '), width, measure);
}

export const pad = (text: DisplayText, width: CellCount, measure: TextWidth = displayWidth): string => {
  const clipped = clip(text, width, measure);
  return clipped + ' '.repeat(Math.max(0, width - measure(clipped)));
};
export const padStart = (text: DisplayText, width: CellCount, measure: TextWidth = displayWidth): string => ' '.repeat(Math.max(0, width - measure(text))) + text;

/** A wrapped row with one original UTF-16 index per text unit; -1 denotes synthetic text. */
export interface WrappedText { text: string; source: number[] }
interface WrapWord { text: string; at: number; space: number }
interface WrapBudget { width: CellCount; measure: TextWidth }

function wordPieces(word: WrapWord, { width, measure }: WrapBudget): WrappedText[] {
  const pieces: WrappedText[] = [];
  let piece: WrappedText = { text: '', source: [] };
  let used = 0;
  let at = word.at;
  for (const item of graphemes(word.text)) {
    const size = measure(item);
    if (used + size > width && piece.text) { pieces.push(piece); piece = { text: '', source: [] }; used = 0; }
    // A grapheme wider than the column cannot be displayed; leave synthetic spaces, never half a glyph.
    const rendered = size > width ? ' '.repeat(width) : item;
    piece.text += rendered;
    for (let unit = 0; unit < rendered.length; unit++) piece.source.push(size > width ? -1 : at + unit);
    at += item.length;
    used += Math.min(size, width);
  }
  if (piece.text) pieces.push(piece);
  return pieces;
}

function joinPiece(line: WrappedText, piece: WrappedText, space: number): WrappedText {
  line.text += ` ${piece.text}`;
  line.source.push(space);
  for (const index of piece.source) line.source.push(index);
  return line;
}

function appendWord(lines: WrappedText[], line: WrappedText, word: WrapWord, budget: WrapBudget): WrappedText {
  const { width, measure } = budget;
  let current = line;
  let space = word.space;
  for (const piece of wordPieces(word, budget)) {
    if (current.text && measure(current.text) + 1 + measure(piece.text) > width) { lines.push(current); current = piece; }
    else current = current.text ? joinPiece(current, piece, space) : piece;
    space = -1;
  }
  return current;
}

/** The same word wrapping as `wrap`, recording source indices while consuming the original paragraphs and words. */
export function wrapWithSources(text: DisplayText, width: CellCount, measure: TextWidth = displayWidth): WrappedText[] {
  if (width <= 0) return [{ text: '', source: [] }];
  const lines: WrappedText[] = [];
  let at = 0;
  for (const paragraph of text.split('\n')) {
    let line: WrappedText = { text: '', source: [] };
    for (const word of paragraph.matchAll(/\S+/g)) {
      const start = at + word.index;
      line = appendWord(lines, line, { text: word[0], at: start, space: text[start - 1] === ' ' ? start - 1 : -1 }, { width, measure });
    }
    lines.push(line);
    at += paragraph.length + 1;
  }
  return lines;
}

/** Word-wraps to `width` cells and at most `maxLines` lines, ending the last with an ellipsis when cut. */
export function wrap(text: DisplayText, width: CellCount, maxLines = Number.POSITIVE_INFINITY, measure: TextWidth = displayWidth): string[] {
  if (width <= 0) return [''];
  const lines = wrapWithSources(text, width, measure).map(line => line.text);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clip(`${kept[maxLines - 1]}…`, width, measure);
  return kept;
}

/** Relative age such as `4s`, `12m`, `3h`, `2d`; `now` is injected so view models stay deterministic. */
export function age(iso: IsoTimestamp, now: EpochMilliseconds): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(seconds)) return '–';
  if (seconds < 60) return `${String(seconds)}s`;
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${String(Math.floor(seconds / 3600))}h`;
  return `${String(Math.floor(seconds / 86400))}d`;
}

export const clock = (iso: IsoTimestamp): string => iso.slice(11, 19);
export const money = (usd: UsdAmount): string => `$${usd.toFixed(2)}`;
export const compactNumber = (value: number): string =>
  value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : String(value);

const blocks = '▁▂▃▄▅▆▇█';
/** Block-character sparkline, scaled to `max` (default: the series maximum, minimum 1). */
export function sparkline(values: readonly number[], max = Math.max(1, ...values)): string {
  return values.map(value => blocks.charAt(Math.min(7, Math.max(0, Math.floor(value / max * 7.999))))).join('');
}

/** Context pressure bands used for colour: calm below 60, warm to 80, hot above. */
export type Pressure = 'calm' | 'warm' | 'hot';
export const pressure = (percent: Percentage): Pressure => (percent > 80 ? 'hot' : percent > 60 ? 'warm' : 'calm');

/** Fuzzy subsequence match; the score is lower for tighter, earlier matches. `undefined` means no match. */
export function fuzzy(query: DisplayText, text: DisplayText): number | undefined {
  const haystack = text.toLowerCase();
  let position = 0;
  let score = 0;
  for (const letter of cells(query.toLowerCase())) {
    const found = haystack.indexOf(letter, position);
    if (found < 0) return undefined;
    score += found - position + (found === 0 ? -1 : 0);
    position = found + 1;
  }
  return score;
}
