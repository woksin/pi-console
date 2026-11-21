import { fstatSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { EventLog, NewEvent, SourceCheckpoint } from '@pi-console/contract';
import { mapLine, warning, type Mapper } from './events.ts';
import { sourcePath } from './paths.ts';
import { openSource, resolveSourceScope, type OpenedSource } from './open-source.ts';
import type { Scanner } from './redact.ts';

interface Handle extends OpenedSource { fd: number; identity: string; replayed: boolean }
export interface TailerOptions {
  /** Canonical trust roots pinned before discovery; standalone tailers default to the candidate's parent. */
  roots?: readonly string[];
  scanner?: Scanner;
  replay?: boolean;
  batchBytes?: number;
  /** Skip complete over-batch records with a body-free warning; use 'error' when retrying with a larger batch. */
  oversizedRecords?: 'skip' | 'error';
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

/** Scan only the captured file size, reusing the batch buffer and yielding between chunks. */
async function recordEnd(fd: number, offset: number, size: number, bytes: Buffer): Promise<number | undefined> {
  while (offset < size) {
    await yieldToLoop();
    const read = readSync(fd, bytes, 0, Math.min(bytes.length, size - offset), offset);
    if (read === 0) break;
    const newline = bytes.subarray(0, read).indexOf(10);
    if (newline !== -1) return offset + newline + 1;
    offset += read;
  }
  return undefined;
}

/** Bounded read-only transport. Source adapters supply a schema-guarded domain mapper. */
export class FileTailer {
  private readonly handles = new Map<string, Handle>();
  private readonly log: EventLog;
  private readonly source: string;
  private mapper: Mapper;
  private loadMapper: (() => Promise<Mapper>) | undefined;
  private readonly options: TailerOptions;
  private polling = false;

  constructor(log: EventLog, source: string, mapper: Mapper | { load: () => Promise<Mapper> }, options: TailerOptions = {}) {
    this.log = log;
    this.source = source;
    this.mapper = typeof mapper === 'function' ? mapper : () => [];
    this.loadMapper = typeof mapper === 'function' ? undefined : mapper.load;
    this.options = options;
    validateBatchSize(options.batchBytes ?? 1024 * 1024);
  }

  private async track(path: string): Promise<void> {
    try {
      sourcePath(path); // Preserve path/extension validation, but never open its pre-resolved target.
      const scope = this.options.roots ? { path, roots: this.options.roots } : resolveSourceScope(path, [dirname(path)]);
      const opened = await openSource(scope.path, scope.roots);
      let retained = false;
      try {
        retained = this.retain(opened);
      } finally {
        if (!retained) await opened.handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private retain(opened: OpenedSource): boolean {
    const { stat, path, handle } = opened;
    const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    const existing = this.handles.get(identity);
    if (existing) {
      existing.path = path;
      return false;
    }
    this.handles.set(identity, { ...opened, fd: handle.fd, identity, replayed: false });
    return true;
  }

  async poll(paths: readonly string[]): Promise<PollResult> {
    if (this.polling) throw new Error('Concurrent poll is not allowed');
    this.polling = true;
    try {
      if (this.loadMapper) {
        this.mapper = await this.loadMapper();
        this.loadMapper = undefined;
      }
      for (const path of paths) await this.track(path);
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
    if (await this.readRecords(handle, checkpoint, events)) result.partialFiles++;
    checkpoint.headHash = headHash(handle.fd, checkpoint.size);
    const appended = await this.log.append(events, [checkpoint]);
    handle.replayed = true;
    result.entries += events.length;
    result.appended += appended.appended;
    result.lagBytes += checkpoint.size - checkpoint.offset;
  }

  /** Consumes complete records only; returns whether an incomplete line was encountered. */
  private async readRecords(handle: Handle, checkpoint: SourceCheckpoint, events: NewEvent[]): Promise<boolean> {
    const bytes = this.readBatch(handle, checkpoint);
    const complete = bytes.lastIndexOf(10) + 1;
    if (complete === 0 && bytes.length === (this.options.batchBytes ?? 1024 * 1024)) {
      return !await this.skipOversized(handle, checkpoint, bytes, events);
    }
    events.push(...this.mapBatch(bytes.subarray(0, complete), checkpoint));
    checkpoint.offset += complete;
    return complete < bytes.length;
  }

  /** An unterminated oversized tail remains pending at its line start, even across restarts. */
  private async skipOversized(handle: Handle, checkpoint: SourceCheckpoint, bytes: Buffer, events: NewEvent[]): Promise<boolean> {
    if (this.options.oversizedRecords === 'error') throw new Error('Source record exceeds batch limit; checkpoint not advanced');
    const end = await recordEnd(handle.fd, checkpoint.offset + bytes.length, checkpoint.size, bytes);
    if (end === undefined) return false;
    events.push(warning(checkpoint, checkpoint.offset, 'Source record exceeds batch limit; body withheld'));
    checkpoint.offset = end;
    return true;
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

  close(): Promise<void> {
    if (this.polling) throw new Error('Cannot close during a poll');
    const handles = [...this.handles.values()];
    this.handles.clear();
    return Promise.all(handles.map(opened => opened.handle.close())).then(() => undefined);
  }
}
