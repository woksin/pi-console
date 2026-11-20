import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventLog, type Candidate, type Checkpoint } from './event-log.ts';
import { redact, type Scanner } from './redact.ts';

interface Handle { fd: number; path: string; identity: string; replayed: boolean }
interface Options {
    scanner?: Scanner;
    replay?: boolean;
    beforeCommit?: () => void; // Fault injection, inside SQLite's transaction.
}
export interface PollResult { entries: number; added: number; lagBytes: number; partialFiles: number }
const batchBytes = 8 * 1024 * 1024;

function sourcePath(path: string): string {
    const resolved = realpathSync(path);
    const denied = resolved.split('/').some(part =>
        ['accounts', 'profiles', 'profiles-retired', 'auth.json'].includes(part) || part.startsWith('.env'));
    if (denied || !resolved.endsWith('.jsonl')) throw new Error('Source path is not an allowed JSONL file');
    return resolved;
}

function isObject(value: unknown): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface BatchContext { source: string; checkpoint: Checkpoint; scanner?: Scanner }
function candidates(bytes: Buffer, context: BatchContext): Candidate[] {
    const { source, checkpoint, scanner } = context;
    const events: Candidate[] = [];
    let start = 0;
    for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
        const line = bytes.subarray(start, end).toString('utf8');
        let parsed: unknown;
        try { parsed = JSON.parse(line); }
        catch { throw new Error('Invalid complete JSONL entry; checkpoint not advanced'); }
        if (!isObject(parsed)) {
            throw new Error('Expected a JSONL object; checkpoint not advanced');
        }
        const offset = checkpoint.offset + start;
        const type = 'JsonlEntryObserved'; // Transport proof, not an M1 domain adapter.
        const key = JSON.stringify([source, checkpoint.identity, checkpoint.generation, offset, type]);
        events.push({
            idempotencyKey: createHash('sha256').update(key).digest('hex'), source, type,
            payload: {
                refs: { file: checkpoint.path, identity: checkpoint.identity, offset },
                excerpt: redact(line, scanner),
            },
        });
        start = end + 1;
    }
    return events;
}

export class JsonlTailer {
    private readonly handles = new Map<string, Handle>();

    private readonly log: EventLog;
    private readonly source: string;
    private readonly options: Options;

    constructor(log: EventLog, source: string, options: Options = {}) {
        this.log = log;
        this.source = source;
        this.options = options;
    }

    private track(path: string): void {
        let fd: number | undefined;
        try {
            const resolved = sourcePath(path);
            fd = openSync(resolved, 'r'); // Never lock or write a source.
            const stat = fstatSync(fd);
            if (!stat.isFile()) throw new Error('Source is not a regular file');
            const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
            const existing = this.handles.get(identity);
            if (existing) {
                existing.path = resolved;
                closeSync(fd);
            } else {
                this.handles.set(identity, { fd, path: resolved, identity, replayed: false });
            }
        } catch (error) {
            if (fd !== undefined) closeSync(fd);
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            // Rename/reopen can leave a brief gap; retained descriptors are still drained.
        }
    }

    poll(paths: string[]): PollResult {
        for (const path of paths) this.track(path);
        const result: PollResult = { entries: 0, added: 0, lagBytes: 0, partialFiles: 0 };
        for (const handle of this.handles.values()) this.read(handle, result);
        return result;
    }

    private checkpointFor(handle: Handle): Checkpoint {
        const stat = fstatSync(handle.fd);
        const saved = this.log.checkpoint(this.source, handle.identity);
        const checkpoint: Checkpoint = saved ?? {
            identity: handle.identity, generation: 0, path: handle.path, offset: 0, size: 0, mtimeMs: 0,
        };
        if (stat.size < checkpoint.size) {
            checkpoint.generation++;
            checkpoint.offset = 0;
        }
        if (this.options.replay && !handle.replayed) checkpoint.offset = 0;
        checkpoint.path = handle.path;
        checkpoint.size = stat.size;
        checkpoint.mtimeMs = stat.mtimeMs;
        return checkpoint;
    }

    private read(handle: Handle, result: PollResult): void {
        const checkpoint = this.checkpointFor(handle);
        const bytes = Buffer.alloc(Math.min(batchBytes, checkpoint.size - checkpoint.offset));
        const length = readSync(handle.fd, bytes, 0, bytes.length, checkpoint.offset);
        const data = bytes.subarray(0, length);
        const complete = data.lastIndexOf(10) + 1;
        if (complete === 0 && length === batchBytes) throw new Error('JSONL line exceeds batch limit');
        const events = candidates(data.subarray(0, complete), {
            source: this.source, checkpoint, scanner: this.options.scanner,
        });
        checkpoint.offset += complete;
        result.added += this.log.commit(this.source, checkpoint, events, this.options.beforeCommit);
        handle.replayed = true;
        result.entries += events.length;
        result.lagBytes += checkpoint.size - checkpoint.offset;
        if (complete < length && length < batchBytes) result.partialFiles++;
    }

    close(): void {
        for (const { fd } of this.handles.values()) closeSync(fd);
        this.handles.clear();
    }
}
