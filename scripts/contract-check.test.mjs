import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaSchemaProblems } from './contract-check-lib.mjs';

test('a schema with an unknown type is rejected by the 2020-12 meta-schema', () => {
  const bogus = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'bogus' };
  assert.ok(metaSchemaProblems('bogus.json', bogus).length > 0);
});

test('a well-formed schema passes the meta-schema', () => {
  const ok = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { a: { type: 'string' } } };
  assert.deepEqual(metaSchemaProblems('ok.json', ok), []);
});
