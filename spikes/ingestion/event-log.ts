import { DatabaseSync } from 'node:sqlite';

export interface Checkpoint {
    identity: string;
    generation: number;
    path: string;
    offset: number; // Only complete lines are committed; partial bytes stay at the source.
    size: number;
    mtimeMs: number;
}
export interface Candidate {
    idempotencyKey: string;
    source: string;
    type: string;
    payload: unknown;
}

// Isolated copy of the sqlite-eventlog spike's node:sqlite transaction approach.
export class EventLog {
    private readonly db: DatabaseSync;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY, idempotencyKey TEXT NOT NULL UNIQUE,
                source TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS checkpoints (
                source TEXT NOT NULL, identity TEXT NOT NULL, state TEXT NOT NULL,
                PRIMARY KEY (source, identity)
            );
        `);
    }

    checkpoint(source: string, identity: string): Checkpoint | undefined {
        const row = this.db.prepare('SELECT state FROM checkpoints WHERE source = ? AND identity = ?')
            .get(source, identity);
        return row ? JSON.parse(String(row.state)) : undefined;
    }

    commit(source: string, checkpoint: Checkpoint, events: Candidate[], beforeCommit = (): void => {}): number {
        const insert = this.db.prepare(`INSERT INTO events (idempotencyKey, source, type, payload)
            VALUES (?, ?, ?, ?) ON CONFLICT(idempotencyKey) DO NOTHING`);
        let added = 0;
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const event of events) {
                added += Number(insert.run(event.idempotencyKey, event.source, event.type,
                    JSON.stringify(event.payload)).changes);
            }
            this.db.prepare(`INSERT INTO checkpoints VALUES (?, ?, ?)
                ON CONFLICT(source, identity) DO UPDATE SET state = excluded.state`)
                .run(source, checkpoint.identity, JSON.stringify(checkpoint));
            beforeCommit();
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        return added;
    }

    keys(): string[] {
        return this.db.prepare('SELECT idempotencyKey FROM events ORDER BY seq').all()
            .map(row => String(row.idempotencyKey));
    }

    count(): number {
        return Number(this.db.prepare('SELECT count(*) AS count FROM events').get()!.count);
    }

    payloads(): unknown[] {
        return this.db.prepare('SELECT payload FROM events ORDER BY seq').all()
            .map(row => JSON.parse(String(row.payload)));
    }

    close(): void { this.db.close(); }
}
