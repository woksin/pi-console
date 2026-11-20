import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { EventLog, NewEvent, SourceCheckpoint } from '@pi-console/contract';
import { mapLine, warning, type Mapper } from './events.ts';
import { sourcePath } from './paths.ts';
import type { Scanner } from './redact.ts';

interface Handle { fd: number; path: string; identity: string; replayed: boolean }
export interface TailerOptions {
  scanner?: Scanner;
  replay?: boolean;
  batchBytes?: number;
  /** Where to start a file with no saved checkpoint (or after truncation) instead of byte 0: must be a line start. */
  startOffset?: (fd: number, size: number) => number;
  /** Lines failing this are neither parsed nor mapped; their bytes are still consumed. */
  lineFilter?: (line: string) => boolean;
}
export interface PollResult { entries: number; appended: number; lagBytes: number; partialFiles: number }

function headHash(fd: number, length: number): string {
  const bytes = Buffer.alloc(Math.min(512, length));
  const read = readSync(fd, bytes, 0, bytes.length, 0);
  return createHash('sha256').update(bytes.subarray(0, read)).digest('hex');
}

function checkpointFor(handle: Handle, source: string, saved?: SourceCheckpoint): SourceCheckpoint {
  const stat = fstatSync(handle.fd);
  const checkpoint = saved ? { ...saved } : {
    source, identity: handle.identity, generation: 0, offset: 0, path: handle.path, size: 0, mtimeMs: 0,
  };
  if (stat.size < checkpoint.size) {
    checkpoint.generation++;
    checkpoint.offset = 0;
  }
  return { ...checkpoint, path: handle.path, size: stat.size, mtimeMs: stat.mtimeMs };
}

function validateBatchSize(size: number): void {
  if (!Number.isSafeInteger(size)) throw new Error('batchBytes must be a positive safe integer');
  if (size < 1) throw new Error('batchBytes must be a positive safe integer');
}

function sameEpoch(saved: SourceCheckpoint, current: SourceCheckpoint): boolean {
  return saved.size > 0 && saved.generation === current.generation;
}

/** Bounded read-only transport. Source adapters supply a schema-guarded domain mapper. */
export class FileTailer {
  private readonly handles = new Map<string, Handle>();
  private readonly log: EventLog;
  private readonly source: string;
  private readonly mapper: Mapper;
  private readonly options: TailerOptions;
  private polling = false;

  constructor(log: EventLog, source: string, mapper: Mapper, options: TailerOptions = {}) {
    this.log = log;
    this.source = source;
    this.mapper = mapper;
    this.options = options;
    validateBatchSize(options.batchBytes ?? 1024 * 1024);
  }

  private track(path: string): void {
    let fd: number | undefined;
    try {
      const canonical = sourcePath(path);
      fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new Error('Source is not a regular file');
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      const existing = this.handles.get(identity);
      if (existing) {
        existing.path = canonical;
        closeSync(fd);
      } else {
        this.handles.set(identity, { fd, path: canonical, identity, replayed: false });
      }
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async poll(paths: readonly string[]): Promise<PollResult> {
    if (this.polling) throw new Error('Concurrent poll is not allowed');
    this.polling = true;
    try {
      for (const path of paths) this.track(path);
      const saved = new Map((await this.log.checkpoints(this.source)).map(checkpoint => [checkpoint.identity, checkpoint]));
      const result: PollResult = { entries: 0, appended: 0, lagBytes: 0, partialFiles: 0 };
      for (const handle of this.handles.values()) await this.read(handle, saved.get(handle.identity), result);
      return result;
    } finally {
      this.polling = false;
    }
  }

  /** Where this poll starts: 0 when replaying, the windowed start for a new epoch, else where it left off. */
  private startAt(handle: Handle, saved: SourceCheckpoint | undefined, checkpoint: SourceCheckpoint): number {
    if (this.options.replay && !handle.replayed) return 0;
    const newEpoch = saved?.generation !== checkpoint.generation;
    return newEpoch && this.options.startOffset ? this.options.startOffset(handle.fd, checkpoint.size) : checkpoint.offset;
  }

  private async read(handle: Handle, saved: SourceCheckpoint | undefined, result: PollResult): Promise<void> {
    const checkpoint = checkpointFor(handle, this.source, saved);
    const events: NewEvent[] = [];
    this.checkHead(handle, saved, checkpoint, events);
    checkpoint.offset = this.startAt(handle, saved, checkpoint);
    const bytes = this.readBatch(handle, checkpoint);
    const complete = bytes.lastIndexOf(10) + 1;
    if (complete === 0 && bytes.length === (this.options.batchBytes ?? 1024 * 1024)) {
      throw new Error('Source record exceeds batch limit; checkpoint not advanced');
    }
    events.push(...this.mapBatch(bytes.subarray(0, complete), checkpoint));
    checkpoint.offset += complete;
    checkpoint.headHash = headHash(handle.fd, checkpoint.size);
    const appended = await this.log.append(events, [checkpoint]);
    handle.replayed = true;
    result.entries += events.length;
    result.appended += appended.appended;
    result.lagBytes += checkpoint.size - checkpoint.offset;
    if (complete < bytes.length) result.partialFiles++;
  }

  private checkHead(handle: Handle, saved: SourceCheckpoint | undefined, checkpoint: SourceCheckpoint, events: NewEvent[]): void {
    if (!saved?.headHash) return;
    if (!sameEpoch(saved, checkpoint)) return;
    if (headHash(handle.fd, saved.size) === saved.headHash) return;
    events.push(warning(checkpoint, checkpoint.offset, 'Source head changed without an observed size drop; missed epoch possible'));
  }

  private readBatch(handle: Handle, checkpoint: SourceCheckpoint): Buffer {
    const limit = this.options.batchBytes ?? 1024 * 1024;
    const remaining = checkpoint.size - checkpoint.offset;
    const bytes = Buffer.alloc(Math.min(limit, remaining));
    const read = readSync(handle.fd, bytes, 0, bytes.length, checkpoint.offset);
    return bytes.subarray(0, read);
  }

  private mapBatch(bytes: Buffer, checkpoint: SourceCheckpoint): NewEvent[] {
    if (bytes.length === 0) return [];
    const events: NewEvent[] = [];
    let start = 0;
    for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
      const line = bytes.subarray(start, end).toString('utf8');
      if (line.trim() && (this.options.lineFilter?.(line) ?? true)) events.push(...mapLine(line, checkpoint.offset + start, {
        checkpoint, mapper: this.mapper, scanner: this.options.scanner,
      }));
      start = end + 1;
    }
    return events;
  }

  close(): void {
    if (this.polling) throw new Error('Cannot close during a poll');
    for (const handle of this.handles.values()) closeSync(handle.fd);
    this.handles.clear();
  }
}
