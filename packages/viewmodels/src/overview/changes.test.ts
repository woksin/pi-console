import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLASH_COOLDOWN_MS, FLASH_MS, FlashTracker, LookTracker, newSince } from './changes.ts';

test('nothing is new before the first look; later arrivals are counted until the user leaves', () => {
  assert.equal(newSince(null, ['a']).label, null);
  const look = new LookTracker();
  assert.equal(look.look(['a', 'b']).label, null, 'the first look is the baseline');
  const during = look.look(['c', 'a', 'b', 'd']);
  assert.deepEqual([...during.ids], ['c', 'd']);
  assert.equal(during.label, '2 new since you looked');
  look.leave();
  assert.equal(look.look(['c', 'a', 'b', 'd']).label, null, 'leaving marks what was shown as seen');
  look.leave();
  assert.equal(look.look(['e', 'a']).label, '1 new since you looked');
});

test('a status change flashes once for FLASH_MS, never on first sight, and at most once per row per cooldown', () => {
  const flash = new FlashTracker();
  assert.equal(flash.observe([{ id: 'a', status: 'working' }], 0), false);
  assert.equal(flash.isFlashing('a', 0), false);
  assert.equal(flash.observe([{ id: 'a', status: 'needs-you' }], 1_000), true);
  assert.equal(flash.isFlashing('a', 1_000 + FLASH_MS - 1), true);
  assert.equal(flash.isFlashing('a', 1_000 + FLASH_MS), false);
  assert.equal(flash.observe([{ id: 'a', status: 'working' }], 2_000), false, 'flapping inside the cooldown does not strobe');
  assert.equal(flash.observe([{ id: 'a', status: 'working' }], 1_000 + FLASH_COOLDOWN_MS), false, 'no change, no flash');
  assert.equal(flash.observe([{ id: 'a', status: 'blocked' }], 1_000 + FLASH_COOLDOWN_MS), true);
});
