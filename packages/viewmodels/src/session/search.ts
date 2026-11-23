/** The transcript search rule, shared by the filter and by every client that highlights what it matched: a case-insensitive substring. */

/** The normalised search term; empty means no search. */
export const searchNeedle = (search: string | undefined): string => search?.toLowerCase() ?? '';

/** Whether `text` matches the normalised `needle`: the one predicate the transcript filter uses. */
export const matchesSearch = (text: string, needle: string): boolean => text.toLowerCase().includes(needle);

/** Half-open UTF-16 range `[from, to)` of `text`. */
export type TextRange = readonly [number, number];

/** For each unit of the lower-cased text, the original character it came from; used when lower-casing changes the text's length. */
function foldedUnits(text: string): { lower: string; from: number[]; to: number[] } {
  let lower = '';
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const char of text) {
    const folded = char.toLowerCase();
    from.push(...Array.from({ length: folded.length }, () => at));
    to.push(...Array.from({ length: folded.length }, () => at + char.length));
    lower += folded;
    at += char.length;
  }
  return { lower, from, to };
}

/** Every non-overlapping place `matchesSearch` finds `needle` in `text`, as ranges of the original text (UTF-16 indexes). */
export function searchRanges(text: string, needle: string): TextRange[] {
  if (!needle) return [];
  const direct = text.toLowerCase();
  const same = direct.length === text.length;
  const { lower, from, to } = same ? { lower: direct, from: [], to: [] } : foldedUnits(text);
  const ranges: TextRange[] = [];
  for (let hit = lower.indexOf(needle); hit >= 0; hit = lower.indexOf(needle, hit + needle.length)) {
    const last = hit + needle.length - 1;
    ranges.push(same ? [hit, hit + needle.length] : [from[hit], to[last]]);
  }
  return ranges;
}
