/** A parsed list filter: free-text terms plus `key:value` terms (`status:working,blocked`). */
export interface ParsedFilter { terms: string[]; fields: Record<string, string[]> }

export function parseFilter(query: string): ParsedFilter {
  const terms: string[] = [];
  const fields: Record<string, string[]> = {};
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const split = word.indexOf(':');
    if (split <= 0 || split === word.length - 1) terms.push(word);
    else fields[word.slice(0, split)] = word.slice(split + 1).split(',');
  }
  return { terms, fields };
}

/** True when every free-text term appears in `haystack` and every field filter accepts the item's value. */
export function matches(filter: ParsedFilter, haystack: string, values: Record<string, string> = {}): boolean {
  const text = haystack.toLowerCase();
  if (!filter.terms.every(term => text.includes(term))) return false;
  return Object.entries(filter.fields).every(([key, accepted]) => key in values && accepted.includes(values[key].toLowerCase()));
}

/** Subsequence fuzzy match used by the command palette; returns a score (lower is better) or null. */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLowerCase();
  const hay = text.toLowerCase();
  if (needle === '') return 0;
  let index = 0;
  let gaps = 0;
  let last = -1;
  for (let i = 0; i < hay.length && index < needle.length; i++) {
    if (hay[i] !== needle[index]) continue;
    if (last >= 0) gaps += i - last - 1;
    last = i;
    index++;
  }
  return index === needle.length ? gaps + hay.indexOf(needle[0]) : null;
}
