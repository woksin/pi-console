import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryActionReceipt } from '@pi-console/contract';
import { ReviewReceipts, reviewReceiptRetentionMs } from './receipts.ts';

test('terminal receipt retention releases capacity but durable claims prevent pruned IDs from redispatching', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const dir = mkdtempSync(join(tmpdir(), 'pi-review-receipts-'));
  const path = join(dir, 'receipts.db');
  let receipts = new ReviewReceipts(path);
  t.after(() => { receipts.close(); rmSync(dir, { recursive: true, force: true }); });
  const value: MemoryActionReceipt = { version: 1, requestId: 'r1', itemId: 'i1', action: 'confirm', sessionId: 's1', generation: 'g1', connectionGeneration: 'c1', tokenId: 'owner', createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 30_000, state: 'declined', reason: 'refused', eventId: null };
  assert.equal(receipts.claim(value), true);
  assert.equal(receipts.claim({ ...value, requestId: 'pending', state: 'awaiting-ingestion', eventId: 'event1' }), true);
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
