import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  validateEnvelope, type AppendResult, type EventEnvelope, type EventLog, type NewEvent, type SourceCheckpoint,
} from '@pi-console/contract';

export interface SqliteEventLogOptions {
  /** Clock for `recordedAt`. Projections never read it, so replay stays deterministic. */
  now?: () => Date;
  /** Page size for `readFrom` and subscriber catch-up. */
  pageSize?: number;
  /** Events a subscriber receives synchronously before the rest of a large append continues on a later macrotask. */
  sliceEvents?: number;
}

interface Subscriber { position: number; onEvent: (event: EventEnvelope) => void; resumeScheduled: boolean }

interface EventRow {
  seq: number; id: string; type: string; version: number; occurredAt: string; recordedAt: string; source: string;
  idempotencyKey: string; subject: string; actor: string; payload: string; refs: string | null;
}

const schema = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, idempotencyKey TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL, version INTEGER NOT NULL, occurredAt TEXT NOT NULL, recordedAt TEXT NOT NULL,
    source TEXT NOT NULL, subject TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL, refs TEXT
  );
  CREATE TABLE IF NOT EXISTS checkpoints (
    source TEXT NOT NULL, identity TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (source, identity)
  );
`;

function toEnvelope(row: EventRow): EventEnvelope {
  return {
    seq: row.seq, id: row.id, type: row.type, version: row.version, occurredAt: row.occurredAt,
    recordedAt: row.recordedAt, source: row.source, idempotencyKey: row.idempotencyKey, subject: row.subject,
    actor: row.actor as EventEnvelope['actor'], payload: JSON.parse(row.payload) as unknown,
    refs: row.refs === null ? null : JSON.parse(row.refs) as EventEnvelope['refs'],
  };
}

/** Rejects a malformed event before anything is written; the whole batch fails. */
function checked(event: NewEvent, recordedAt: string): EventEnvelope {
  const result = validateEnvelope({ ...event, seq: 0, recordedAt });
  if (!result.ok) throw new Error(`Invalid event ${event.type}: ${result.error}`);
  return result.event;
}

/**
 * The default `EventLog` (ADR-0001) on `node:sqlite`: WAL, synchronous FULL, one `BEGIN IMMEDIATE` transaction per
 * append covering events and checkpoints. Duplicate idempotency keys (or ids) are skipped. Single writer: the daemon.
 */
export class SqliteEventLog implements EventLog {
  readonly #database: DatabaseSync;
  readonly #insert: StatementSync;
  readonly #saveCheckpoint: StatementSync;
  readonly #read: StatementSync;
  readonly #last: StatementSync;
  readonly #subscribers = new Set<Subscriber>();
  readonly #now: () => Date;
  readonly #pageSize: number;
  readonly #sliceEvents: number;

  constructor(path: string, options: SqliteEventLogOptions = {}) {
    this.#database = new DatabaseSync(path);
    this.#database.exec(schema);
    this.#insert = this.#database.prepare(`INSERT INTO events
      (id, idempotencyKey, type, version, occurredAt, recordedAt, source, subject, actor, payload, refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
    this.#saveCheckpoint = this.#database.prepare(`INSERT INTO checkpoints (source, identity, value) VALUES (?, ?, ?)
      ON CONFLICT (source, identity) DO UPDATE SET value = excluded.value`);
    this.#read = this.#database.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?');
    this.#last = this.#database.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events');
    this.#now = options.now ?? (() => new Date());
    this.#pageSize = options.pageSize ?? 500;
    this.#sliceEvents = options.sliceEvents ?? 250;
  }

  append(events: readonly NewEvent[], checkpoints: readonly SourceCheckpoint[] = []): Promise<AppendResult> {
    try {
      return Promise.resolve(this.appendSync(events, checkpoints));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Synchronous append; the async port method delegates here. */
  appendSync(events: readonly NewEvent[], checkpoints: readonly SourceCheckpoint[] = []): AppendResult {
    const recordedAt = this.#now().toISOString();
    const valid = events.map(event => checked(event, recordedAt));
    const appended = this.#transaction(() => {
      const stored = valid.reduce((count, event) => count + this.#insertOne(event), 0);
      for (const checkpoint of checkpoints) {
        this.#saveCheckpoint.run(checkpoint.source, checkpoint.identity, JSON.stringify(checkpoint));
      }
      return stored;
    });
    if (appended > 0) this.#notify();
    return { appended, duplicates: valid.length - appended, lastSeq: this.lastSeq() };
  }

  async *readFrom(afterSeq: number, limit = Number.MAX_SAFE_INTEGER): AsyncIterable<EventEnvelope> {
    let position = afterSeq;
    let remaining = limit;
    while (remaining > 0) {
      const page = this.readPage(position, Math.min(remaining, this.#pageSize));
      if (page.length === 0) return;
      for (const event of page) yield event;
      position = page[page.length - 1].seq;
      remaining -= page.length;
      await Promise.resolve();
    }
  }

  /** One page of events with `seq > afterSeq`, synchronously. */
  readPage(afterSeq: number, limit: number): EventEnvelope[] {
    return (this.#read.all(afterSeq, limit) as unknown as EventRow[]).map(toEnvelope);
  }

  subscribe(afterSeq: number, onEvent: (event: EventEnvelope) => void): () => void {
    const subscriber: Subscriber = { position: afterSeq, onEvent, resumeScheduled: false };
    this.#subscribers.add(subscriber);
    queueMicrotask(() => { this.#drain(subscriber); });
    return () => { this.#subscribers.delete(subscriber); };
  }

  checkpoints(source: string): Promise<SourceCheckpoint[]> {
    const rows = this.#database.prepare('SELECT value FROM checkpoints WHERE source = ? ORDER BY identity').all(source);
    return Promise.resolve(rows.map(row => JSON.parse(row.value as string) as SourceCheckpoint));
  }

  lastSeq(): number {
    return (this.#last.get() as { seq: number }).seq;
  }

  close(): void {
    this.#subscribers.clear();
    this.#database.close();
  }

  #insertOne(event: EventEnvelope): number {
    const result = this.#insert.run(
      event.id, event.idempotencyKey, event.type, event.version, event.occurredAt, event.recordedAt, event.source,
      event.subject, event.actor, JSON.stringify(event.payload), event.refs === null ? null : JSON.stringify(event.refs),
    );
    return Number(result.changes);
  }

  #transaction<T>(work: () => T): T {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #notify(): void {
    for (const subscriber of this.#subscribers) this.#drain(subscriber);
  }

  /**
   * Delivers every stored event after the subscriber's position, in order, exactly once. One call delivers at most a
   * slice; the rest follows on a later macrotask, so a large append never runs every subscriber's work in one go.
   */
  #drain(subscriber: Subscriber): void {
    let budget = this.#sliceEvents;
    while (this.#subscribers.has(subscriber)) {
      const page = this.readPage(subscriber.position, Math.min(this.#pageSize, budget));
      if (page.length === 0) return;
      for (const event of page) {
        subscriber.position = event.seq;
        subscriber.onEvent(event);
      }
      budget -= page.length;
      if (budget <= 0) {
        this.#resume(subscriber);
        return;
      }
    }
  }

  #resume(subscriber: Subscriber): void {
    if (subscriber.resumeScheduled) return;
    subscriber.resumeScheduled = true;
    setImmediate(() => {
      subscriber.resumeScheduled = false;
      this.#drain(subscriber);
    });
  }
}
