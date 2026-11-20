// JSON Schema draft 2020-12 meta-schema validation shared by contract-check and its spec.
import Ajv2020 from 'ajv/dist/2020.js';

const ajv = new Ajv2020({ strict: false, validateFormats: false });

/** Problems found when validating `document` against the draft 2020-12 meta-schema; empty when valid. */
export function metaSchemaProblems(name, document) {
  if (ajv.validateSchema(document)) return [];
  return (ajv.errors ?? []).map(error => `${name}: not a valid 2020-12 schema at ${error.instancePath || '/'}: ${error.message}`);
}
