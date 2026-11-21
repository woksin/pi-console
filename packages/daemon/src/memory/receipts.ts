import { chmodSync, lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { MemoryActionReceipt } from '@pi-console/contract';

export const reviewReceiptRetentionMs = 24 * 60 * 60 * 1000;
const pendingStates = "json_extract(value,'$.state') IN ('awaiting-human','awaiting-ingestion','unknown')";
const terminalStates = "json_extract(value,'$.state') IN ('observed-applied','declined','conflict','unavailable','expired')";
function safePath(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  if (!stat.isFile()) throw new Error('Refusing unsafe receipt path');
}
/** Metadata only. Retired receipt bodies are pruned; durable ID tombstones still prevent redispatch. */
export class ReviewReceipts {
  readonly #db: DatabaseSync;
  #nextPrune = 0;
  constructor(path: string) {
    safePath(path);
    this.#db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.#db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS review_receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS review_claims (id TEXT PRIMARY KEY); INSERT OR IGNORE INTO review_claims SELECT id FROM review_receipts');
    this.#db.prepare("UPDATE review_receipts SET value=json_set(value,'$.state','unknown','$.updatedAt',?) WHERE json_extract(value,'$.state')='awaiting-human'").run(Date.now());
    this.prune();
  }
  get(id: string): MemoryActionReceipt | undefined {
    const row = this.#db.prepare('SELECT value FROM review_receipts WHERE id=?').get(id);
    return row ? JSON.parse(row.value as string) as MemoryActionReceipt : undefined;
  }
  pending(): MemoryActionReceipt[] {
    return this.#db.prepare(`SELECT value FROM review_receipts WHERE ${pendingStates}`).all().map(row => JSON.parse(row.value as string) as MemoryActionReceipt);
  }
  count(): number { return Number(this.#db.prepare('SELECT count(*) AS total FROM review_receipts').get()?.total); }
  prune(): void {
    const now = Date.now();
    if (now < this.#nextPrune) return;
    this.#db.prepare(`DELETE FROM review_receipts WHERE ${terminalStates} AND json_extract(value,'$.updatedAt') < ?`).run(now - reviewReceiptRetentionMs);
    this.#nextPrune = now + 60_000;
  }
  claim(receipt: MemoryActionReceipt): boolean {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const inserted = Number(this.#db.prepare('INSERT OR IGNORE INTO review_claims(id) VALUES (?)').run(receipt.requestId).changes) === 1;
      if (inserted) this.#db.prepare('INSERT INTO review_receipts(id,value) VALUES (?,?)').run(receipt.requestId, JSON.stringify(receipt));
      this.#db.exec('COMMIT');
      return inserted;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  save(receipt: MemoryActionReceipt): void { this.#db.prepare('UPDATE review_receipts SET value=? WHERE id=?').run(JSON.stringify(receipt), receipt.requestId); }
  close(): void { this.#db.close(); }
}
