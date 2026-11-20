import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ProjectionRecord, ProjectionStore } from './projection.ts';

/** Projection snapshots in a `projections` table (same file as the log is fine: WAL, separate connection). */
export class SqliteProjectionStore implements ProjectionStore {
  readonly #database: DatabaseSync;
  readonly #select: StatementSync;
  readonly #upsert: StatementSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS projections (
        name TEXT PRIMARY KEY, version INTEGER NOT NULL, position INTEGER NOT NULL, state TEXT NOT NULL
      );
    `);
    this.#select = this.#database.prepare('SELECT name, version, position, state FROM projections WHERE name = ?');
    this.#upsert = this.#database.prepare(`INSERT INTO projections (name, version, position, state) VALUES (?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET version = excluded.version, position = excluded.position, state = excluded.state`);
  }

  load(name: string): ProjectionRecord | undefined {
    const row = this.#select.get(name) as { name: string; version: number; position: number; state: string } | undefined;
    return row && { name: row.name, version: row.version, position: row.position, state: JSON.parse(row.state) as unknown };
  }

  save(records: readonly ProjectionRecord[]): void {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) this.#upsert.run(record.name, record.version, record.position, JSON.stringify(record.state));
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }
}
