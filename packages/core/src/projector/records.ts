/** Copies JSON into own-property-only records, including dictionaries restored from snapshots. */
export function safeRecords<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map((item: unknown) => safeRecords(item)) as Value;
  if (value === null || typeof value !== 'object') return value;
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) result[key] = safeRecords(item);
  return result as Value;
}

/**
 * Parses JSON into the same own-property-only records as `safeRecords`, without a copy: every parsed object gets a null
 * prototype in place. Unlike `Object.create(null)` copies, the objects keep V8's shared fast layout, so a restored
 * snapshot costs about a third of the heap. `JSON.parse` defines keys such as `__proto__` as own properties.
 */
export function parseRecords<Value>(text: string): Value {
  return withoutPrototypes(JSON.parse(text)) as Value;
}

function withoutPrototypes(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) withoutPrototypes(item);
    return value;
  }
  for (const item of Object.values(value)) withoutPrototypes(item);
  Object.setPrototypeOf(value, null);
  return value;
}
