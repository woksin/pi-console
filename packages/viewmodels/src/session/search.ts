/** The transcript search rule, shared by the filter and by every client that highlights what it matched: a case-insensitive substring. */

/** Context-free folding: neighbouring characters never affect a code point's lower-case form. */
const fold = (text: string): string => Array.from(text, char => char.toLowerCase()).join('');

/** The normalised search term; empty means no search. */
export const searchNeedle = (search: string | undefined): string => fold(search ?? '');

/** Whether `text` matches the normalised `needle`: the one predicate the transcript filter uses. */
export const matchesSearch = (text: string, needle: string): boolean => needle.length > 0 && fold(text).includes(needle);

/** Half-open UTF-16 range `[from, to)` of `text`. */
export type TextRange = readonly [number, number];

/** For each folded UTF-16 unit, its original bounds; expanding folds retain the complete source code point. */
function foldedUnits(text: string): { lower: string; from: number[]; to: number[] } {
  let lower = '';
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const char of text) {
    const folded = char.toLowerCase();
    const same = folded.length === char.length;
    for (let unit = 0; unit < folded.length; unit++) {
      from.push(at + (same ? unit : 0));
      to.push(at + (same ? unit + 1 : char.length));
    }
    lower += folded;
    at += char.length;
  }
  return { lower, from, to };
}

/** Every non-overlapping place `matchesSearch` finds `needle` in `text`, as ranges of the original text (UTF-16 indexes). */
export function searchRanges(text: string, needle: string): TextRange[] {
  if (!needle) return [];
  const { lower, from, to } = foldedUnits(text);
  const ranges: TextRange[] = [];
  for (let hit = lower.indexOf(needle); hit >= 0; hit = lower.indexOf(needle, hit + needle.length)) {
    const last = hit + needle.length - 1;
    ranges.push([from[hit], to[last]]);
  }
  return ranges;
}
