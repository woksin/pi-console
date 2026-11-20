import { isDeepStrictEqual } from 'node:util';

type Schema = {
  $ref?: string; type?: string; const?: unknown; enum?: unknown[]; format?: string;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean;
  items?: Schema; anyOf?: Schema[]; oneOf?: Schema[]; $defs?: Record<string, Schema>;
};
function matchesType(value: unknown, type: string) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'object') return isObject(value);
  return typeof value === type;
}
function isObject(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function checkMinimum(value: number, minimum: number | undefined, path: string) {
  if (minimum === undefined) return;
  if (value < minimum) throw new Error(`${path}: below minimum`);
}
function checkMaximum(value: number, maximum: number | undefined, path: string) {
  if (maximum === undefined) return;
  if (value > maximum) throw new Error(`${path}: above maximum`);
}
function checkConstant(value: unknown, schema: Schema, path: string) {
  if (!Object.hasOwn(schema, 'const')) return;
  if (!isDeepStrictEqual(value, schema.const)) throw new Error(`${path}: wrong constant`);
}
function checkEnum(value: unknown, schema: Schema, path: string) {
  if (!schema.enum) return;
  if (!schema.enum.includes(value)) throw new Error(`${path}: outside enum`);
}
function checkType(value: unknown, schema: Schema, path: string) {
  if (!schema.type) return;
  if (!matchesType(value, schema.type)) throw new Error(`${path}: expected ${schema.type}`);
}
function checkScalar(value: unknown, schema: Schema, path: string) {
  checkType(value, schema, path);
  checkConstant(value, schema, path);
  checkEnum(value, schema, path);
  if (typeof value === 'number') checkNumber(value, schema, path);
  if (typeof value === 'string') checkString(value, schema, path);
}
function checkNumber(value: number, schema: Schema, path: string) {
  if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number`);
  checkMinimum(value, schema.minimum, path);
  checkMaximum(value, schema.maximum, path);
}
function checkString(value: string, schema: Schema, path: string) {
  checkMinimum(Array.from(value).length, schema.minLength, path);
  checkMaximum(Array.from(value).length, schema.maxLength, path);
  if (schema.format === 'date-time') checkTimestamp(value, path);
}
function checkTimestamp(value: string, path: string) {
  const pattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
  if (!pattern.test(value)) throw new Error(`${path}: invalid RFC3339 timestamp`);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${path}: invalid RFC3339 timestamp`);
}
function matchingAlternatives(value: unknown, alternatives: Schema[], root: Schema) {
  return alternatives.filter(alternative => {
    try { validateNode(value, alternative, root); return true; } catch { return false; }
  }).length;
}
function checkAlternatives(value: unknown, schema: Schema, root: Schema, path: string) {
  if (schema.anyOf) checkAnyOf(value, schema.anyOf, root, path);
  if (schema.oneOf) checkOneOf(value, schema.oneOf, root, path);
}
function checkAnyOf(value: unknown, alternatives: Schema[], root: Schema, path: string) {
  if (matchingAlternatives(value, alternatives, root) === 0) throw new Error(`${path}: no anyOf match`);
}
function checkOneOf(value: unknown, alternatives: Schema[], root: Schema, path: string) {
  if (matchingAlternatives(value, alternatives, root) !== 1) throw new Error(`${path}: expected one oneOf match`);
}
function reference(schema: Schema, root: Schema) {
  const name = schema.$ref!.replace(/^.*#\/\$defs\//, '');
  const target = root.$defs?.[name];
  if (!target) throw new Error(`Unknown schema reference ${schema.$ref}`);
  return target;
}
function validateNode(value: unknown, schema: Schema, root = schema, path = '$'): void {
  if (schema.$ref) return validateNode(value, reference(schema, root), root, path);
  checkAlternatives(value, schema, root, path);
  checkScalar(value, schema, path);
  if (Array.isArray(value)) checkArray(value, schema, root, path);
  if (schema.properties) checkObject(value as Record<string, unknown>, schema, root, path);
}
function checkArray(value: unknown[], schema: Schema, root: Schema, path: string) {
  if (!schema.items) return;
  value.forEach((item, i) => validateNode(item, schema.items!, root, `${path}[${i}]`));
}
function checkObject(value: Record<string, unknown>, schema: Schema, root: Schema, path: string) {
  const missing = (schema.required ?? []).find(key => !Object.hasOwn(value, key));
  if (missing) throw new Error(`${path}: missing ${missing}`);
  Object.entries(value).forEach(([key, item]) => {
    const property = schema.properties![key];
    if (property) validateNode(item, property, root, `${path}.${key}`);
    else rejectExtraField(schema, `${path}.${key}`);
  });
}
function rejectExtraField(schema: Schema, path: string) {
  if (schema.additionalProperties === false) throw new Error(`${path}: unknown field`);
}

export type SchemaInput = object;

/** Validates `value` against a JSON Schema (the subset used by docs/api/schemas); throws an Error naming the failing path. */
export function validate(value: unknown, schema: SchemaInput, root: SchemaInput = schema, path = '$'): void {
  validateNode(value, schema, root, path);
}
