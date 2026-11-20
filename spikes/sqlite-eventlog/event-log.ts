import { DatabaseSync } from 'node:sqlite';
import BetterSqlite from 'better-sqlite3';

export type Driver = 'node:sqlite' | 'better-sqlite3';
export interface EventInput {
    idempotencyKey: string;
    type: string;
    version: number;
    payload: unknown;
}
export interface StoredEvent extends EventInput { seq: number }
export interface SeqRange { first: number; last: number; count: number }
export interface EventLog {
    append(events: EventInput[]): SeqRange | null;
    readFrom(seq: number, limit: number): StoredEvent[];
    subscribe(fromSeq: number, handler: (event: StoredEvent) => void): () => void;
    close(): void;
}

type Value = string | number;
interface Statement {
    run(...values: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...values: Value[]): Record<string, unknown>[];
}
interface Connection {
    exec(sql: string): unknown;
    prepare(sql: string): Statement;
    close(): void;
}

export function connect(driver: Driver, path: string): Connection {
    if (driver === 'node:sqlite') return new DatabaseSync(path) as Connection;
    return new BetterSqlite(path) as Connection;
}

export class SqliteEventLog implements EventLog {
    private readonly database: Connection;
    private readonly insert: Statement;
    private readonly read: Statement;
    private readonly subscriptions = new Set<() => void>();

    constructor(driver: Driver, path: string) {
        this.database = connect(driver, path);
        this.database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
            INSERT OR IGNORE INTO schema_version VALUES (1);
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY,
                idempotencyKey TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL,
                version INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
        `);
        this.insert = this.database.prepare(`INSERT INTO events (idempotencyKey, type, version, payload)
            VALUES (?, ?, ?, ?) ON CONFLICT(idempotencyKey) DO NOTHING`);
        this.read = this.database.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?');
    }

    append(events: EventInput[]): SeqRange | null {
        let range: SeqRange | null = null;
        this.database.exec('BEGIN IMMEDIATE');
        try {
            for (const event of events) {
                const result = this.insert.run(event.idempotencyKey, event.type, event.version,
                    JSON.stringify(event.payload));
                if (Number(result.changes) === 0) continue;
                const seq = Number(result.lastInsertRowid);
                if (!range) range = { first: seq, last: seq, count: 0 };
                range.last = seq;
                range.count++;
            }
            this.database.exec('COMMIT');
        } catch (error) {
            this.database.exec('ROLLBACK');
            throw error;
        }
        for (const pump of this.subscriptions) pump();
        return range;
    }

    // seq is an exclusive checkpoint; zero starts replay at the first event.
    readFrom(seq: number, limit: number): StoredEvent[] {
        if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError('Invalid checkpoint');
        if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid limit');
        return (this.read.all(seq, limit) as (Omit<StoredEvent, 'payload'> & { payload: string })[])
            .map(event => ({ ...event, payload: JSON.parse(event.payload) }));
    }

    // Register before catch-up. Synchronous pumping also handles appends from a callback.
    subscribe(fromSeq: number, handler: (event: StoredEvent) => void): () => void {
        let cursor = fromSeq;
        let active = true;
        let pumping = false;
        const stop = (): void => { active = false; this.subscriptions.delete(pump); };
        const pump = (): void => {
            if (pumping || !active) return;
            pumping = true;
            try {
                this.deliver(() => this.readFrom(cursor, 1000), event => {
                    cursor = event.seq;
                    handler(event);
                }, () => active);
            } catch {
                // A failed observer is detached; a committed append must not appear to fail.
                stop();
            } finally { pumping = false; }
        };
        // Validate even when the log is empty; do not swallow invalid subscription arguments.
        this.readFrom(fromSeq, 1);
        this.subscriptions.add(pump);
        pump();
        return stop;
    }

    private deliver(read: () => StoredEvent[], handler: (event: StoredEvent) => void,
        active: () => boolean): void {
        while (active()) {
            const batch = read();
            if (batch.length === 0) return;
            for (const event of batch) {
                if (!active()) return;
                handler(event);
            }
        }
    }

    close(): void {
        this.subscriptions.clear();
        this.database.close();
    }
}
