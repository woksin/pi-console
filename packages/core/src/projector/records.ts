/** Copies JSON into own-property-only records, including dictionaries restored from snapshots. */
export function safeRecords<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map((item: unknown) => safeRecords(item)) as Value;
  if (value === null || typeof value !== 'object') return value;
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) result[key] = safeRecords(item);
  return result as Value;
}
