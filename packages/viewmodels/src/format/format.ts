/** Display helpers shared by every view model: all pure, all width-aware in terminal cells (one code point = one cell). */

// Unbranded display units keep existing callers compatible while naming the meaning of each input.
type DisplayText = string;
type CellCount = number;
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

/** Terminal cells of a string (code points). */
export const cells = (text: DisplayText): string[] => Array.from(text);

const printable = (character: DisplayText): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code === 10 || (code >= 32 && code !== 127 && !(code >= 128 && code <= 159));
};

/** Strips terminal control sequences and control characters so transcript text can never drive the terminal or the DOM. */
export function sanitize(text: DisplayText): string {
  const stripped = terminalSequences.reduce((value, pattern) => value.replace(pattern, ''), text.replace(/\t/g, '  '));
  return cells(stripped).filter(printable).join('');
}

/** One-line clip with an ellipsis. */
export function clip(text: DisplayText, width: CellCount): string {
  const characters = cells(text.replace(/\s+/g, ' '));
  if (width <= 0) return '';
  return characters.length <= width ? characters.join('') : `${characters.slice(0, Math.max(0, width - 1)).join('')}…`;
}

export const pad = (text: DisplayText, width: CellCount): string => {
  const clipped = clip(text, width);
  return clipped + ' '.repeat(Math.max(0, width - cells(clipped).length));
};
export const padStart = (text: DisplayText, width: CellCount): string => ' '.repeat(Math.max(0, width - cells(text).length)) + text;

function appendWord(lines: DisplayText[], line: DisplayText, word: DisplayText, width: CellCount): string {
  const pieces = cells(word).length > width ? (word.match(new RegExp(`.{1,${String(Math.max(1, width))}}`, 'gu')) ?? []) : [word];
  let current = line;
  for (const piece of pieces) {
    if (current && cells(current).length + 1 + cells(piece).length > width) { lines.push(current); current = piece; }
    else current = current ? `${current} ${piece}` : piece;
  }
  return current;
}

/** Word-wraps to `width` cells and at most `maxLines` lines, ending the last with an ellipsis when cut. */
export function wrap(text: DisplayText, width: CellCount, maxLines = Number.POSITIVE_INFINITY): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) line = appendWord(lines, line, word, width);
    lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clip(`${kept[maxLines - 1]}…`, width);
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
