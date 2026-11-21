import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { MemoryActionReceipt } from '@pi-console/contract';

/** Daemon-owned metadata only. Never stores prompts, credentials or source content. */
export class ReviewReceipts {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error('Refusing unsafe receipt path');
    this.#db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.#db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS review_receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const receipt of this.all()) {
      if (receipt.state === 'awaiting-human') this.save({ ...receipt, state: 'unknown', updatedAt: Date.now() });
    }
  }
  get(id: string): MemoryActionReceipt | undefined {
    const row = this.#db.prepare('SELECT value FROM review_receipts WHERE id=?').get(id);
    return row ? JSON.parse(row.value as string) as MemoryActionReceipt : undefined;
  }
  all(): MemoryActionReceipt[] {
    return this.#db.prepare('SELECT value FROM review_receipts').all().map(row => JSON.parse(row.value as string) as MemoryActionReceipt);
  }
  claim(receipt: MemoryActionReceipt): boolean {
    return Number(this.#db.prepare('INSERT OR IGNORE INTO review_receipts(id,value) VALUES (?,?)').run(receipt.requestId, JSON.stringify(receipt)).changes) === 1;
  }
  save(receipt: MemoryActionReceipt): void { this.#db.prepare('UPDATE review_receipts SET value=? WHERE id=?').run(JSON.stringify(receipt), receipt.requestId); }
  close(): void { this.#db.close(); }
}
