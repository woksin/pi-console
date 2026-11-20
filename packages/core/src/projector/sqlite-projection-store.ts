import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ProjectionRecord, ProjectionStore, ProjectionWrite } from './projection.ts';
import { safeRecords } from './records.ts';

/** Projection metadata and dirty rows share one WAL transaction with their replay positions. */
export class SqliteProjectionStore implements ProjectionStore {
  readonly #db: DatabaseSync;
  readonly #load: StatementSync;
  readonly #save: StatementSync;
  readonly #rows: StatementSync;
  readonly #putRow: StatementSync;
  readonly #deleteRow: StatementSync;
  readonly #resetRows: StatementSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.#db.exec(`CREATE TABLE IF NOT EXISTS projections (
      name TEXT PRIMARY KEY, version INTEGER NOT NULL, position INTEGER NOT NULL, state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projection_rows (
      name TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (name, collection, id)
    );`);
    this.#load = this.#db.prepare('SELECT version, position, state FROM projections WHERE name = ?');
    this.#save = this.#db.prepare(`INSERT INTO projections (name, version, position, state) VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET version = excluded.version, position = excluded.position, state = excluded.state`);
    this.#rows = this.#db.prepare('SELECT collection, id, value FROM projection_rows WHERE name = ? ORDER BY collection, id');
    this.#putRow = this.#db.prepare(`INSERT INTO projection_rows (name, collection, id, value) VALUES (?, ?, ?, ?)
      ON CONFLICT(name, collection, id) DO UPDATE SET value = excluded.value`);
    this.#deleteRow = this.#db.prepare('DELETE FROM projection_rows WHERE name = ? AND collection = ? AND id = ?');
    this.#resetRows = this.#db.prepare('DELETE FROM projection_rows WHERE name = ?');
  }

  load(name: string): ProjectionRecord | undefined {
    const row = this.#load.get(name);
    if (!row) return undefined;
    const state = safeRecords(JSON.parse(row.state as string)) as Record<string, Record<string, unknown>>;
    for (const item of this.#rows.iterate(name)) {
      state[item.collection as string][item.id as string] = safeRecords(JSON.parse(item.value as string));
    }
    return { name, version: row.version as number, position: row.position as number, state };
  }

  /** Existing callers (including the SSE reservation) continue to save ordinary snapshots. */
  save(records: readonly ProjectionRecord[]): void { this.saveChanges(records); }

  saveChanges(records: readonly ProjectionWrite[]): void {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) this.#write(record);
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #write(record: ProjectionWrite): void {
    this.#save.run(record.name, record.version, record.position, JSON.stringify(record.state));
    if (record.resetRows || !record.rows) this.#resetRows.run(record.name);
    for (const row of record.rows ?? []) {
      if (row.value === undefined) this.#deleteRow.run(record.name, row.collection, row.id);
      else this.#putRow.run(record.name, row.collection, row.id, JSON.stringify(row.value));
    }
  }

  close(): void { this.#db.close(); }
}
