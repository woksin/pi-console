/** A half-open character range `[start, end)` in a label that matched the query. */
export type MatchRange = readonly [number, number];

/** One run of label text, either matched (`hit`) or not. Clients render hits highlighted. */
export interface MatchSegment { text: string; hit: boolean }

/** Lower ranks first: whole-label prefix, word start, label substring, detail word start, detail substring, then subsequence. */
export interface Match { rank: number; ranges: MatchRange[] }

const boundary = /[\s/\-_.#@:·()[\]]/;

const wordStarts = (text: string, term: string): number => {
  for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + 1)) if (at === 0 || boundary.test(text[at - 1])) return at;
  return -1;
};

/** Each query letter in order, as single-letter ranges; `undefined` when a letter is missing. */
function subsequence(text: string, term: string): MatchRange[] | undefined {
  const ranges: MatchRange[] = [];
  let from = 0;
  for (const letter of term) {
    const at = text.indexOf(letter, from);
    if (at < 0) return undefined;
    ranges.push([at, at + 1]);
    from = at + 1;
  }
  return ranges;
}

/** The spread of a subsequence match: a tighter match ranks a little better within the subsequence tier. */
const spread = (ranges: readonly MatchRange[]): number => ranges.length === 0 ? 0 : ranges[ranges.length - 1][1] - ranges[0][0];

function matchTerm(label: string, detail: string, term: string): Match | undefined {
  if (label.startsWith(term)) return { rank: 0, ranges: [[0, term.length]] };
  const word = wordStarts(label, term);
  if (word >= 0) return { rank: 1, ranges: [[word, word + term.length]] };
  const inside = label.indexOf(term);
  if (inside >= 0) return { rank: 2, ranges: [[inside, inside + term.length]] };
  if (wordStarts(detail, term) >= 0) return { rank: 3, ranges: [] };
  if (detail.includes(term)) return { rank: 4, ranges: [] };
  const letters = subsequence(label, term);
  return letters ? { rank: 5 + spread(letters) / 1000, ranges: letters } : undefined;
}

/**
 * Ranks a label (and its detail line) against a query. Every space-separated term must match; the worst term decides the
 * tier, so "aur impl" never outranks a plain prefix hit. Case-insensitive. `undefined` when any term misses.
 */
export function matchQuery(query: string, label: string, detail = ''): Match | undefined {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = label.toLowerCase();
  const details = detail.toLowerCase();
  const matches: Match[] = [];
  for (const term of terms) {
    const match = matchTerm(haystack, details, term);
    if (!match) return undefined;
    matches.push(match);
  }
  return { rank: Math.max(0, ...matches.map(match => match.rank)), ranges: matches.flatMap(match => match.ranges) };
}

const merge = (ranges: readonly MatchRange[]): MatchRange[] => [...ranges].sort((a, b) => a[0] - b[0]).reduce<MatchRange[]>((merged, range) => {
  const last = merged.at(-1);
  if (last && range[0] <= last[1]) merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
  else merged.push(range);
  return merged;
}, []);

/** Splits a label into plain and matched runs for highlighting; overlapping ranges merge. */
export function segments(label: string, ranges: readonly MatchRange[]): MatchSegment[] {
  const parts: MatchSegment[] = [];
  let at = 0;
  for (const [start, end] of merge(ranges)) {
    if (start > at) parts.push({ text: label.slice(at, start), hit: false });
    parts.push({ text: label.slice(start, end), hit: true });
    at = end;
  }
  if (at < label.length) parts.push({ text: label.slice(at), hit: false });
  return parts;
}
