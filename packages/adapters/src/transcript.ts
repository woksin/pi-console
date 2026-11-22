import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { recordEnd, recordSpans } from './tailing/framing.ts';
import { openSource, resolveSourceScope } from './tailing/open-source.ts';
import { redactValue, type Scanner } from './tailing/redact.ts';

export interface TranscriptVersion {
  identity: string;
  size: number;
  mtimeMs: number;
  headHash?: string;
  headBytes: number;
}
export interface TranscriptRequest {
  path: string;
  roots: readonly string[];
  /** Pinned canonical trust roots supplied by discovery; an empty list permits no reads. */
  resolvedRoots?: readonly string[];
  offset?: number;
  limitBytes?: number;
  scanner?: Scanner;
  expected?: TranscriptVersion;
  /** Captured EOF: appended bytes are left for the next request. */
  endOffset?: number;
  /** Seek past the record containing offset-1, without parsing any fragment. */
  seekAfter?: boolean;
}
export interface TranscriptPage { entries: unknown[]; nextOffset: number; partial: boolean }
export interface TranscriptFrame { value: unknown; start: number; end: number }
export interface FramedTranscriptPage { entries: TranscriptFrame[]; nextOffset: number; partial: boolean }

export class TranscriptSourceChanged extends Error {
  constructor() { super('Transcript source changed'); }
}

/** Only expected filesystem/boundary failures are unavailable history; programming errors still propagate. */
export function transcriptUnavailable(error: unknown): boolean {
  if (error instanceof TranscriptSourceChanged) return true;
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM', 'ESTALE', 'EIO', 'ENXIO'].includes(code ?? '')) return true;
  return ['Source path denied', 'Source is not a regular file', 'Source outside configured roots', 'Source path is not JSONL'].includes(error.message);
}

/** Validate the same descriptor used for reading, including the checkpoint's bounded head fingerprint. */
export async function validateTranscriptSource(handle: FileHandle, stat: Stats, expected: TranscriptVersion): Promise<void> {
  validateVersion(stat, expected);
  if (!expected.headHash) return;
  const bytes = Buffer.alloc(expected.headBytes);
  const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
  const hash = createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex');
  if (hash !== expected.headHash) throw new TranscriptSourceChanged();
}

function validateVersion(stat: Stats, expected: TranscriptVersion): void {
  if (stat.nlink !== 1) throw new TranscriptSourceChanged();
  if (`${stat.dev}:${stat.ino}:${stat.birthtimeMs}` !== expected.identity) throw new TranscriptSourceChanged();
  if (stat.size < expected.size) throw new TranscriptSourceChanged();
  if (stat.size === expected.size && stat.mtimeMs !== expected.mtimeMs) throw new TranscriptSourceChanged();
}

/** Source paths come only from the daemon's checkpoint index, never browser input. */
export async function readTranscript(request: TranscriptRequest): Promise<TranscriptPage> {
  const page = await readTranscriptFrames(request);
  return { entries: page.entries.map(entry => entry.value), nextOffset: page.nextOffset, partial: page.partial };
}

/** Complete oversized records are withheld; torn tails remain resumable. Offsets count bytes, not characters. */
export async function readTranscriptFrames(request: TranscriptRequest): Promise<FramedTranscriptPage> {
  const scope = request.resolvedRoots ? { path: request.path, roots: request.resolvedRoots } : resolveSourceScope(request.path, request.roots);
  if (!scope.path.endsWith('.jsonl')) throw new Error('Source path is not JSONL');
  const { offset, limit } = pageBounds(request);
  const { handle, stat } = await openSource(scope.path, scope.roots);
  try {
    if (request.expected) await validateTranscriptSource(handle, stat, request.expected);
    const size = Math.min(stat.size, request.endOffset ?? stat.size);
    const bytes = Buffer.alloc(limit);
    const batch = { offset, size, bytes };
    batch.offset = await startOf(handle, batch, request);
    return await readFrames(handle, batch, request.scanner);
  } finally { await handle.close(); }
}

async function startOf(handle: FileHandle, batch: Batch, request: TranscriptRequest): Promise<number> {
  if (request.seekAfter && batch.offset > 0) return await recordEnd(handle.fd, batch.offset - 1, batch.size, batch.bytes) ?? batch.size;
  if (request.expected) await validateBoundary(handle, batch.offset, batch.bytes);
  return batch.offset;
}

async function validateBoundary(handle: FileHandle, offset: number, bytes: Buffer): Promise<void> {
  if (offset === 0) return;
  const { bytesRead } = await handle.read(bytes, 0, 1, offset - 1);
  if (bytesRead !== 1 || bytes[0] !== 10) throw new TranscriptSourceChanged();
}

interface Batch { offset: number; size: number; bytes: Buffer }

async function readFrames(handle: FileHandle, batch: Batch, scanner?: Scanner): Promise<FramedTranscriptPage> {
  const { offset, size, bytes } = batch;
  const length = Math.max(0, Math.min(bytes.length, size - offset));
  const { bytesRead: count } = await handle.read(bytes, 0, length, offset);
  const complete = bytes.subarray(0, count).lastIndexOf(10) + 1;
  if (complete === 0 && count === bytes.length) return oversizedPage(handle, batch);
  const entries: TranscriptFrame[] = [];
  for (const { start, end } of recordSpans(bytes.subarray(0, complete))) {
    const line = bytes.subarray(start, end - 1).toString('utf8');
    if (line.trim()) entries.push({ value: decodeLine(line, scanner), start: offset + start, end: offset + end });
  }
  return { entries, nextOffset: offset + complete, partial: complete < count };
}

async function oversizedPage(handle: FileHandle, batch: Batch): Promise<FramedTranscriptPage> {
  const { offset, size, bytes } = batch;
  const end = await recordEnd(handle.fd, offset + bytes.length, size, bytes);
  if (end === undefined) return { entries: [], nextOffset: offset, partial: true };
  return { entries: [{ value: { withheld: true, oversize: true }, start: offset, end }], nextOffset: end, partial: false };
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid transcript ${name}`);
  if (value < minimum || value > maximum) throw new Error(`Invalid transcript ${name}`);
  return value;
}

function pageBounds(request: TranscriptRequest): { offset: number; limit: number } {
  return {
    offset: boundedInteger(request.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 'offset'),
    limit: boundedInteger(request.limitBytes ?? 256 * 1024, 1, 1024 * 1024, 'limit'),
  };
}

function decodeLine(line: string, scanner?: Scanner): unknown {
  try { return redactValue(JSON.parse(line) as unknown, scanner); }
  catch { return { withheld: true }; }
}
