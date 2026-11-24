import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as shared from '@pi-console/viewmodels';
import { formatBytes, healthGroups, healthSourceRows } from './settings-health.ts';

test('web health presentation uses the shared viewmodel without client-specific formatting', () => {
  assert.equal(formatBytes, shared.formatBytes);
  assert.equal(healthGroups, shared.healthGroups);
  assert.equal(healthSourceRows, shared.healthSourceRows);
});
