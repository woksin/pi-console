import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ProjectionRecord, ProjectionRow, ProjectionStore, ProjectionWrite } from './projection.ts';
import { parseRecords } from './records.ts';
import { SqliteWorkRows } from './sqlite-work-rows.ts';

/**
 * Projection metadata and dirty rows share one WAL transaction with their replay positions. The store is derived state:
 * `synchronous = NORMAL` may lose the last commits on power loss, never atomicity, and replay from the event log (which
 * stays FULL) restores them.
 */
export class SqliteProjectionStore implements ProjectionStore {
  readonly #db: DatabaseSync;
  readonly #load: StatementSync;
  readonly #save: StatementSync;
  readonly #rows: StatementSync;
  readonly #putRow: StatementSync;
  readonly #deleteRow: StatementSync;
  readonly #resetRows: StatementSync;
  #workRows: SqliteWorkRows | undefined;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
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
      if (this.#db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'work_rows'").get()) this.workRows();
    } catch (error) {
      try { this.#db.close(); }
      catch { process.stderr.write('pi-console: SQLite startup cleanup failed\n'); }
      throw error;
    }
  }

  #indexedWork(name: string): SqliteWorkRows | undefined {
    if (name !== 'work') return undefined;
    if (this.#workRows) return this.#workRows;
    if (!this.#db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'work_rows'").get()) return undefined;
    return this.workRows();
  }

  #writeRow(name: string, row: ProjectionRow): void {
    if (row.value === undefined) this.#deleteRow.run(name, row.collection, row.id);
    else this.#putRow.run(name, row.collection, row.id, JSON.stringify(row.value));
  }

  load(name: string): ProjectionRecord | undefined {
    const row = this.#load.get(name);
    if (!row) return undefined;
    const state = parseRecords<Record<string, Record<string, unknown>>>(row.state as string);
    for (const item of this.#rows.iterate(name)) {
      state[item.collection as string][item.id as string] = parseRecords(item.value as string);
    }
    return { name, version: row.version as number, position: row.position as number, state };
  }

  /** Opt-in indexed work access on the same transaction/connection as projection rows. */
  workRows(): SqliteWorkRows { return this.#workRows ??= new SqliteWorkRows(this.#db); }

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
    const work = this.#indexedWork(record.name);
    this.#save.run(record.name, record.version, record.position, JSON.stringify(record.state));
    if (record.resetRows || !record.rows) {
      this.#resetRows.run(record.name);
      work?.reset();
    }
    const rows = record.rows ?? (work ? snapshotRows(record.state) : []);
    for (const row of rows) {
      this.#writeRow(record.name, row);
      work?.change(row);
    }
  }

  close(): void { this.#db.close(); }
}

function snapshotRows(state: unknown) {
  return Object.entries(state as Record<string, Record<string, unknown>>).flatMap(([collection, items]) =>
    Object.entries(items).map(([id, value]) => ({ collection, id, value })));
}
