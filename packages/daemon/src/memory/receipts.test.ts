import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryActionReceipt } from '@pi-console/contract';
import { ReviewReceipts, reviewIngestionGraceMs, reviewReceiptRetentionMs } from './receipts.ts';

test('unverified writes survive expiry and restart until retention, without allowing ID replay', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const dir = mkdtempSync(join(tmpdir(), 'pi-review-expiry-'));
  const path = join(dir, 'receipts.db');
  let receipts = new ReviewReceipts(path);
  t.after(() => { receipts.close(); rmSync(dir, { recursive: true, force: true }); });
  const now = Date.now();
  const value: MemoryActionReceipt = { version: 1, requestId: 'pending', itemId: 'i1', action: 'confirm', sessionId: 's1', generation: 'g1', connectionGeneration: 'c1', tokenId: 'owner', createdAt: now, updatedAt: now, expiresAt: now + 30_000, state: 'awaiting-human', reason: null, eventId: null };
  assert.equal(receipts.claim({ ...value, requestId: 'human' }), true);
  assert.equal(receipts.claim({ ...value, requestId: 'ingestion', state: 'awaiting-ingestion', reason: 'applied', eventId: 'producer-event' }), true);
  assert.equal(receipts.claim({ ...value, requestId: 'unknown', state: 'unknown' }), true);
  receipts.prune();
  assert.equal(receipts.pending().length, 3);
  t.mock.timers.tick(30_000);
  receipts.prune(); // Expiry must work even inside the one-minute body-pruning throttle.
  assert.equal(receipts.pending().length, 2);
  assert.equal(receipts.count(), 3);
  assert.equal(receipts.get('human')?.state, 'expired');
  assert.equal(receipts.get('ingestion')?.state, 'awaiting-ingestion');
  assert.equal(receipts.get('unknown')?.state, 'unknown');
  t.mock.timers.tick(reviewIngestionGraceMs);
  receipts.prune();
  assert.deepEqual(receipts.get('ingestion'), { ...value, requestId: 'ingestion', state: 'unknown', reason: 'applied', eventId: 'producer-event', updatedAt: now + 30_000 + reviewIngestionGraceMs });
  receipts.close();
  receipts = new ReviewReceipts(path);
  assert.equal(receipts.get('ingestion')?.state, 'unknown');
  assert.equal(receipts.get('ingestion')?.eventId, 'producer-event');
  t.mock.timers.tick(reviewReceiptRetentionMs + 60_000);
  receipts.prune();
  assert.equal(receipts.count(), 0);
  receipts.close();
  receipts = new ReviewReceipts(path);
  assert.equal(receipts.claim({ ...value, requestId: 'unknown' }), false);
});

test('restart repairs legacy false-expired producer writes without losing their event identity', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-review-legacy-'));
  const path = join(dir, 'receipts.db');
  let receipts = new ReviewReceipts(path);
  t.after(() => { receipts.close(); rmSync(dir, { recursive: true, force: true }); });
  const now = Date.now();
  const value: MemoryActionReceipt = { version: 1, requestId: 'legacy-write', itemId: 'i1', action: 'confirm', sessionId: 's1', generation: 'g1', connectionGeneration: 'c1', tokenId: 'owner', createdAt: now, updatedAt: now, expiresAt: now - 1, state: 'expired', reason: 'expired', eventId: 'producer-event' };
  assert.equal(receipts.claim(value), true);
  receipts.close();
  receipts = new ReviewReceipts(path);
  assert.equal(receipts.get(value.requestId)?.state, 'unknown');
  assert.equal(receipts.get(value.requestId)?.reason, 'applied');
  assert.equal(receipts.get(value.requestId)?.eventId, 'producer-event');
});

test('terminal receipt retention releases capacity but durable claims prevent pruned IDs from redispatching', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const dir = mkdtempSync(join(tmpdir(), 'pi-review-receipts-'));
  const path = join(dir, 'receipts.db');
  let receipts = new ReviewReceipts(path);
  t.after(() => { receipts.close(); rmSync(dir, { recursive: true, force: true }); });
  const value: MemoryActionReceipt = { version: 1, requestId: 'r1', itemId: 'i1', action: 'confirm', sessionId: 's1', generation: 'g1', connectionGeneration: 'c1', tokenId: 'owner', createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 30_000, state: 'declined', reason: 'refused', eventId: null };
  assert.equal(receipts.claim(value), true);
  assert.equal(receipts.claim({ ...value, requestId: 'pending', state: 'awaiting-ingestion', eventId: 'event1', expiresAt: Date.now() + reviewReceiptRetentionMs + 60_000 }), true);
  t.mock.timers.tick(reviewReceiptRetentionMs + 1);
  receipts.prune();
  assert.equal(receipts.get('r1'), undefined);
  assert.equal(receipts.count(), 1);
  assert.equal(receipts.pending()[0].requestId, 'pending');
  assert.equal(receipts.claim(value), false);
  receipts.close();
  receipts = new ReviewReceipts(path);
  assert.equal(receipts.claim(value), false);
});
