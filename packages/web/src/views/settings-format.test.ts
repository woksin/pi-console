import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsTimestamp } from './settings-format.ts';

test('settings UTC timestamps use the console clock without dropping the date', () => {
  assert.equal(settingsTimestamp('2026-05-26T16:24:42.123Z'), '2026-05-26 16:24:42 UTC');
  assert.equal(settingsTimestamp('2026-05-26T00:02:03Z'), '2026-05-26 00:02:03 UTC');
  assert.equal(settingsTimestamp('this tab (session storage)'), null);
  assert.equal(settingsTimestamp('123'), null);
});
