import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { JobModel, WorkState } from '../projections/work.ts';
import type { PageOrder } from '../queries/paging.ts';
import type { ProjectionRecord, ProjectionRow } from './projection.ts';
import { parseRecords } from './records.ts';

/** SQLite TEXT uses UTF-8 order; the API compares JavaScript UTF-16 code units. */
export function workOrderKey(text: string): Uint8Array {
  const bytes = Buffer.allocUnsafe(text.length * 2);
  for (let index = 0; index < text.length; index++) bytes.writeUInt16BE(text.charCodeAt(index), index * 2);
  return bytes;
}

export const terminalWork = (row: JobModel): boolean => row.status === 'done' || row.status === 'failed';

export interface WorkSelection {
  sessionId?: string;
  exclude?: readonly string[];
  after?: { key: string; id: string };
  order?: PageOrder;
  limit?: number;
}

/** Canonical payloads stay in projection_rows. This small derived index contains no JSON or history cache. */
export class SqliteWorkRows {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_rows'").get()) this.#create();
  }

  #create(): void {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.exec(`CREATE TABLE work_rows (
        id TEXT PRIMARY KEY, terminal INTEGER NOT NULL, owner TEXT NOT NULL, started_key BLOB NOT NULL, id_key BLOB NOT NULL
      );
      CREATE INDEX work_recent ON work_rows (terminal, started_key, id_key);
      CREATE INDEX work_owner_recent ON work_rows (terminal, owner, started_key, id_key);`);
      for (const row of this.#db.prepare("SELECT id, value FROM projection_rows WHERE name = 'work' AND collection = 'jobs'").iterate()) {
        this.put(row.id as string, parseRecords<JobModel>(row.value as string));
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** A snapshot with embedded jobs must replay work only, without transporting/parsing that history into JS. */
  restore(version: number): ProjectionRecord | undefined {
    const metadata = this.#db.prepare(`SELECT version, position,
      EXISTS (SELECT 1 FROM json_each(state, '$.jobs') LIMIT 1) AS embedded
      FROM projections WHERE name = 'work'`).get();
    if (!metadata || metadata.version !== version || metadata.embedded) return undefined;
    const row = this.#db.prepare("SELECT json_remove(state, '$.jobs') AS state FROM projections WHERE name = 'work'").get()!;
    const state = parseRecords<WorkState>(row.state as string);
    state.jobs = Object.create(null) as WorkState['jobs'];
    for (const item of this.#db.prepare(`SELECT p.id, p.value FROM work_rows w JOIN projection_rows p
      ON p.name = 'work' AND p.collection = 'jobs' AND p.id = w.id WHERE w.terminal = 0`).iterate()) {
      state.jobs[item.id as string] = parseRecords<JobModel>(item.value as string);
    }
    for (const item of this.#db.prepare("SELECT id, value FROM projection_rows WHERE name = 'work' AND collection = 'reviews'").iterate()) {
      state.reviews[item.id as string] = parseRecords<WorkState['reviews'][string]>(item.value as string);
    }
    return { name: 'work', version, position: metadata.position as number, state };
  }

  get(id: string): JobModel | undefined {
    const row = this.#db.prepare("SELECT value FROM projection_rows WHERE name = 'work' AND collection = 'jobs' AND id = ?").get(id);
    return row ? parseRecords<JobModel>(row.value as string) : undefined;
  }

  put(id: string, value: JobModel): void {
    this.#db.prepare(`INSERT INTO work_rows (id, terminal, owner, started_key, id_key) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET terminal = excluded.terminal, owner = excluded.owner,
      started_key = excluded.started_key, id_key = excluded.id_key`)
      .run(id, Number(terminalWork(value)), value.sessionId ?? 'console', workOrderKey(value.startedAt), workOrderKey(id));
  }

  change(row: ProjectionRow): void {
    if (row.collection !== 'jobs') return;
    if (row.value === undefined) this.#db.prepare('DELETE FROM work_rows WHERE id = ?').run(row.id);
    else this.put(row.id, row.value as JobModel);
  }

  reset(): void { this.#db.exec('DELETE FROM work_rows'); }

  count(selection: WorkSelection): number {
    const { where, values } = predicates(selection, false);
    return this.#db.prepare(`SELECT COUNT(*) AS total FROM work_rows w WHERE ${where}`).get(...values)!.total as number;
  }

  select(selection: WorkSelection): JobModel[] {
    const { sql, values } = selectionSql(selection);
    return this.#db.prepare(sql).all(...values).map(row => parseRecords<JobModel>(row.value as string));
  }

  /** Structural specs inspect the very same statement used for page/recent reads. */
  explain(selection: WorkSelection): string[] {
    const { sql, values } = selectionSql(selection);
    return this.#db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map(row => row.detail as string);
  }
}

function predicates(selection: WorkSelection, cursor: boolean): { where: string; values: SQLInputValue[] } {
  const clauses = ['w.terminal = 1'];
  const values: SQLInputValue[] = [];
  if (selection.sessionId !== undefined) { clauses.push('w.owner = ?'); values.push(selection.sessionId); }
  if (selection.exclude?.length) {
    clauses.push(`w.id NOT IN (${selection.exclude.map(() => '?').join(',')})`);
    values.push(...selection.exclude);
  }
  if (cursor && selection.after) {
    clauses.push(`(w.started_key, w.id_key) ${selection.order === 'desc' ? '<' : '>'} (?, ?)`);
    values.push(workOrderKey(selection.after.key), workOrderKey(selection.after.id));
  }
  return { where: clauses.join(' AND '), values };
}

function selectionSql(selection: WorkSelection): { sql: string; values: SQLInputValue[] } {
  const { where, values } = predicates(selection, true);
  const direction = selection.order === 'desc' ? 'DESC' : 'ASC';
  let sql = `SELECT p.value FROM work_rows w JOIN projection_rows p
    ON p.name = 'work' AND p.collection = 'jobs' AND p.id = w.id
    WHERE ${where} ORDER BY w.started_key ${direction}, w.id_key ${direction}`;
  if (selection.limit !== undefined) { sql += ' LIMIT ?'; values.push(selection.limit); }
  return { sql, values };
}
