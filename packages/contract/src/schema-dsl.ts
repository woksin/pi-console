// Small stdlib-only description language for the JSON Schemas in this package.
// The TypeScript types in generated/ are produced from these schemas (see generate-types.ts).
export type Schema = Record<string, unknown>;

export const str: Schema = { type: 'string' };
export const id: Schema = { type: 'string', minLength: 1 };
export const int: Schema = { type: 'integer', minimum: 0 };
export const num: Schema = { type: 'number', minimum: 0 };
export const bool: Schema = { type: 'boolean' };
export const time: Schema = { type: 'string', format: 'date-time' };
export const percent: Schema = { type: 'number', minimum: 0, maximum: 100 };
export const excerpt: Schema = { type: 'string', maxLength: 200 };

export const oneOf = (...values: string[]): Schema => ({ type: 'string', enum: values });
export const nullable = (value: Schema): Schema => ({ anyOf: [value, { type: 'null' }] });
export const array = (items: Schema): Schema => ({ type: 'array', items });
export const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });

/** Closed object: every key required unless listed in `required`, no extra fields. */
export function strict(properties: Record<string, Schema>, required = Object.keys(properties)): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Open object for event payloads: additive within a version (event-model section 5). */
export function open(properties: Record<string, Schema>, required = Object.keys(properties)): Schema {
  return { type: 'object', properties, required };
}
