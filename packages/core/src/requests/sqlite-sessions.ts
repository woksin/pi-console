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
  /** Test instrumentation: sessions whose normalized arrays were read back after startup. */
  hydrations = 0;

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
    if (size <= this.#inlineLimit) {
      this.#saved.delete(record);
      return record;
    }
    const saved = this.#saved.get(record);
    for (const field of sessionArrays) this.#writeArray(id, record, field, saved?.[field]);
    this.#pending.set(record, savedOf(record));
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

  /** Legacy snapshots/rows already contain their arrays and remain readable without a rebuild. */
  #initializeArrays(sessions: DerivationState['sessions']): Set<string> {
    const normalized = new Set<string>();
    for (const [id, record] of Object.entries(sessions)) {
      if (Object.hasOwn(record, 'observations')) continue;
      Object.assign(record, emptyArrays());
      normalized.add(id);
    }
    return normalized;
  }

  /** Eager restore: every normalized history is read back, streamed row by row. */
  load(state: DerivationState): void {
    if (!Object.hasOwn(state, 'sessions')) return;
    const normalized = this.#initializeArrays(state.sessions);
    const rows = this.#db.prepare('SELECT session_id, field, value FROM request_session_arrays ORDER BY session_id, field, idx').iterate();
    for (const row of rows as Iterable<unknown> as Iterable<ArrayRow>) {
      if (normalized.has(row.session_id)) itemsOf(state.sessions[row.session_id], row.field).push(JSON.parse(row.value) as unknown);
    }
  }

  /** Lazy restore: normalized sessions keep empty placeholder arrays until `hydrate`; returns their ids. */
  defer(state: DerivationState): Set<string> {
    return Object.hasOwn(state, 'sessions') ? this.#initializeArrays(state.sessions) : new Set();
  }

  /** Reads one deferred session's arrays back, seeding the saved hints so the next write is a delta. */
  hydrate(id: string, record: SessionRecord): void {
    Object.assign(record, emptyArrays());
    const rows = this.#db.prepare('SELECT field, value FROM request_session_arrays WHERE session_id = ? ORDER BY field, idx').iterate(id);
    for (const row of rows as Iterable<unknown> as Iterable<ArrayRow>) itemsOf(record, row.field).push(JSON.parse(row.value) as unknown);
    this.#saved.set(record, savedOf(record));
    this.hydrations++;
  }

  /** After a successful commit: drops a normalized session's arrays (they are on disk). False when it stays inline. */
  release(record: SessionRecord): boolean {
    if (this.#pending.has(record) || !this.#saved.has(record)) return false;
    this.#saved.delete(record);
    committedArrays(record);
    Object.assign(record, emptyArrays());
    return true;
  }

  /** Request ids of every persisted raw prompt, streamed without materializing observations. */
  promptOwners(): Iterable<{ sessionId: string; requestId: string }> {
    const rows = this.#db.prepare(`SELECT session_id, json_extract(value, '$.requestId') AS request_id FROM request_session_arrays
      WHERE field = 'observations' AND json_extract(value, '$.kind') = 'prompt'`).iterate();
    return (function* () {
      for (const row of rows) yield { sessionId: row.session_id as string, requestId: row.request_id as string };
    })();
  }
}

const itemsOf = (record: SessionRecord, field: SessionArray): unknown[] => record[field];
const emptyArrays = () => ({ observations: [], explicitIds: [], requestIds: [] });
const savedOf = (record: SessionRecord): SavedArrays => Object.fromEntries(sessionArrays.map(field =>
  [field, { items: record[field], length: record[field].length }])) as SavedArrays;
