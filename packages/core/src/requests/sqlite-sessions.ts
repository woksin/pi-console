import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { DerivationState, SessionRecord } from './model.ts';
import { changedIndices, committedArrays, sessionArrays, type SessionArray } from './session-arrays.ts';

type SavedArrays = Record<SessionArray, { items: unknown[]; length: number }>;
interface ArrayRow { session_id: string; field: SessionArray; value: string }

/** Row codec for the growing request-session histories. Each changed array item is persisted once, not the whole session. */
export class SqliteRequestSessions {
  readonly #db: DatabaseSync;
  readonly #put: StatementSync;
  readonly #truncate: StatementSync;
  readonly #inlineLimit: number;
  #saved = new WeakMap<SessionRecord, SavedArrays>();
  readonly #pending = new Map<SessionRecord, SavedArrays>();

  constructor(db: DatabaseSync, inlineLimit = 64) {
    this.#db = db;
    this.#inlineLimit = inlineLimit;
    db.exec(`CREATE TABLE IF NOT EXISTS request_session_arrays (
      session_id TEXT NOT NULL, field TEXT NOT NULL, idx INTEGER NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (session_id, field, idx)
    )`);
    this.#put = db.prepare('INSERT OR REPLACE INTO request_session_arrays (session_id, field, idx, value) VALUES (?, ?, ?, ?)');
    this.#truncate = db.prepare('DELETE FROM request_session_arrays WHERE session_id = ? AND field = ? AND idx >= ?');
  }

  reset(): void {
    this.#db.exec('DELETE FROM request_session_arrays');
    this.#saved = new WeakMap();
    this.#pending.clear();
  }

  delete(id: string): void { this.#db.prepare('DELETE FROM request_session_arrays WHERE session_id = ?').run(id); }

  write(id: string, record: SessionRecord): Pick<SessionRecord, 'facts'> {
    // Keep a bounded small session inline: normalization must not add SQL work to distributed histories.
    const size = record.observations.length + record.explicitIds.length + record.requestIds.length;
    if (size <= this.#inlineLimit) return record;
    const saved = this.#saved.get(record);
    for (const field of sessionArrays) this.#writeArray(id, record, field, saved?.[field]);
    this.#pending.set(record, Object.fromEntries(sessionArrays.map(field =>
      [field, { items: record[field], length: record[field].length }])) as SavedArrays);
    return { facts: record.facts };
  }

  #writeArray(id: string, record: SessionRecord, field: SessionArray, saved: SavedArrays[SessionArray] | undefined): void {
    const items = record[field];
    if (saved?.items !== items) {
      this.#replaceArray(id, field, items);
      return;
    }
    for (const index of changedIndices(record, field)) {
      if (index < items.length) this.#writeItem(id, field, items, index);
    }
    if (items.length < saved.length) this.#truncate.run(id, field, items.length);
  }

  #replaceArray(id: string, field: SessionArray, items: unknown[]): void {
    this.#truncate.run(id, field, 0);
    for (let index = 0; index < items.length; index++) this.#writeItem(id, field, items, index);
  }

  #writeItem(id: string, field: SessionArray, items: unknown[], index: number): void {
    this.#put.run(id, field, index, JSON.stringify(items[index]));
  }

  /** A rollback must retain dirty indices. Only a committed projection transaction acknowledges them. */
  committed(): void {
    for (const [record, saved] of this.#pending) {
      this.#saved.set(record, saved);
      committedArrays(record);
    }
    this.#pending.clear();
  }

  rolledBack(): void { this.#pending.clear(); }

  #initializeArrays(sessions: DerivationState['sessions']): Set<string> {
    const normalized = new Set<string>();
    for (const [id, record] of Object.entries(sessions)) {
      // Legacy snapshots/rows already contain their arrays and remain readable without a rebuild.
      if (Object.hasOwn(record, 'observations')) continue;
      Object.assign(record, { observations: [], explicitIds: [], requestIds: [] });
      normalized.add(id);
    }
    return normalized;
  }

  load(state: DerivationState): void {
    if (!Object.hasOwn(state, 'sessions')) return;
    const normalized = this.#initializeArrays(state.sessions);
    const rows = this.#db.prepare('SELECT session_id, field, value FROM request_session_arrays ORDER BY session_id, field, idx').all() as unknown as ArrayRow[];
    for (const row of rows) {
      if (!normalized.has(row.session_id)) continue;
      const items: unknown[] = state.sessions[row.session_id][row.field];
      items.push(JSON.parse(row.value) as unknown);
    }
  }
}
