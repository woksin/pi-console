/** JSON with object keys sorted at every level, so equal values always serialise to equal bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** Code-unit order: locale-independent, so every machine sorts identically. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareText(a, b));
  return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
}
