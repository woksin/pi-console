import type { ServerResponse } from 'node:http';
import type { Snapshot } from '@pi-console/contract';
import { HttpError } from '../security/guard.ts';
import { safeJson } from '../http/output.ts';
import { packSnapshot, snapshotLimits } from './snapshot-packing.ts';

export interface StreamOptions {
  /** First delta id is `base + 1`; the daemon reserves a durable restart barrier as the base. */
  base: number;
  /** Persist the high-water mark before a frame can reach any client. */
  persist: (seq: number) => void;
  /** Deltas kept for `Last-Event-ID` resume (v1: 10,000). */
  ringSize: number;
  heartbeatMs: number;
  /** A client whose unsent output exceeds this is disconnected and resumes from its last parsed id. */
  maxBufferedBytes: number;
  /** Current screen state as the `snapshot` payload; `activeOnly` asks for the smallest window (active items alone). */
  snapshot: (activeOnly?: boolean) => unknown;
  /** Told when a snapshot had to degrade to fit the buffer cap, with the frame sizes. */
  warn?: (message: string) => void;
  now?: () => Date;
}

interface Frame { seq: number; text: string }

const collections = ['sessions', 'requests', 'questions', 'messages', 'jobs', 'resets'] as const;

/** Last-resort bootstrap: REST pages and per-session detail supply every omitted row. */
function minimalSnapshot(payload: unknown, generatedAt: string): Snapshot {
  const source = payload as Partial<Snapshot> | null;
  const totals = Object.fromEntries(collections.map(name => [name, source?.totals?.[name] ?? source?.[name]?.length ?? 0])) as NonNullable<Snapshot['totals']>;
  return {
    version: 0, generatedAt, repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [],
    transcriptCursors: [], interventions: [], totals, bounded: [...collections],
  };
}

/** Parses `Last-Event-ID`; nonnumeric, unsafe or future ids are a 400 before any stream bytes are written. */
export function resumePoint(lastId: string | undefined, current: number): number | undefined {
  if (lastId === undefined) return undefined;
  if (!/^\d+$/.test(lastId)) throw new HttpError(400, 'Invalid Last-Event-ID');
  const after = Number(lastId);
  if (!Number.isSafeInteger(after) || after > current) throw new HttpError(400, 'Invalid Last-Event-ID');
  return after;
}

/**
 * SSE fan-out with a bounded replay ring. Ids are contiguous between replay barriers. A resume inside the ring
 * replays deltas after the id within a byte budget; an oversized replay, an older id, gap or restart gets a fresh snapshot.
 */
export class StreamHub {
  readonly #options: StreamOptions;
  readonly #clients = new Set<ServerResponse>();
  readonly #ring: Frame[] = [];
  readonly #heartbeat: NodeJS.Timeout;
  #seq: number;

  constructor(options: StreamOptions) {
    this.#options = options;
    this.#seq = options.base;
    this.#heartbeat = setInterval(() => { this.#beat(); }, options.heartbeatMs);
    this.#heartbeat.unref();
  }

  get seq(): number {
    return this.#seq;
  }

  get clients(): number {
    return this.#clients.size;
  }

  get retained(): number {
    return this.#ring.length;
  }

  /** Omit unobserved deltas, reserving an id so any pre-gap resume must take a fresh snapshot. */
  invalidateIfIdle(): boolean {
    if (this.#clients.size > 0) return false;
    this.#advance();
    this.#ring.length = 0;
    return true;
  }

  #advance(): number {
    const seq = this.#seq + 1;
    this.#options.persist(seq);
    this.#seq = seq;
    return seq;
  }

  publish(type: string, payload: unknown): void {
    const seq = this.#advance();
    const frame = this.#frame(seq, type, payload);
    this.#ring.push(frame);
    if (this.#ring.length > this.#options.ringSize) this.#ring.shift();
    for (const client of this.#clients) this.#send(client, frame.text);
  }

  connect(client: ServerResponse, lastEventId: string | undefined): void {
    const after = resumePoint(lastEventId, this.#seq);
    const catchUp = this.#catchUp(after);
    client.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    client.flushHeaders();
    for (const text of catchUp) this.#send(client, text);
    if (client.destroyed) return;
    this.#clients.add(client);
    client.on('close', () => { this.#clients.delete(client); });
  }

  close(): void {
    clearInterval(this.#heartbeat);
    for (const client of this.#clients) client.destroy();
    this.#clients.clear();
  }

  #catchUp(after: number | undefined): string[] {
    const earliest = this.#ring[0]?.seq ?? this.#seq + 1;
    if (after === undefined || after < earliest - 1) return [this.#snapshotFrame()];
    const replay: string[] = [];
    let bytes = 0;
    for (const frame of this.#ring) {
      if (frame.seq <= after) continue;
      bytes += Buffer.byteLength(frame.text);
      // Leave headroom for HTTP framing rather than treating a healthy reconnect as a slow live client.
      if (bytes > this.#options.maxBufferedBytes / 2) return [this.#snapshotFrame()];
      replay.push(frame.text);
    }
    return replay;
  }

  /** Prefer half-cap snapshots; active-only and compact fallbacks also reserve HTTP chunk framing. */
  #snapshotFrame(): string {
    const { preferred: limit, hard } = snapshotLimits(this.#options.maxBufferedBytes);
    const occurredAt = this.#now();
    const encode = (payload: unknown) => this.#frame(this.#seq, 'snapshot', payload, occurredAt).text;
    const normal = this.#options.snapshot();
    const text = encode(normal);
    const size = Buffer.byteLength(text);
    if (size <= limit) return text;
    const payload = this.#options.snapshot(true);
    const active = encode(payload);
    const activeSize = Buffer.byteLength(active);
    if (activeSize <= hard) {
      this.#options.warn?.(`snapshot frame of ${size} bytes exceeds ${limit}; sending active items only (${activeSize} bytes)`);
      return active;
    }
    const minimal = minimalSnapshot(payload, occurredAt);
    const packed = packSnapshot(normal, payload, minimal, { encode, preferred: limit, hard });
    // A cap too small even for the empty envelope cannot carry a snapshot: fail before sending SSE headers or bytes.
    if (!packed) throw new HttpError(503, 'Snapshot frame exceeds buffer cap');
    const kind = packed === encode(minimal) ? 'minimal' : 'compact';
    this.#options.warn?.(`snapshot frames of ${size} bytes and active-only ${activeSize} bytes exceed ${hard}; sending ${kind} snapshot (${Buffer.byteLength(packed)} bytes)`);
    return packed;
  }

  #now(): string {
    return (this.#options.now ?? (() => new Date()))().toISOString();
  }

  #frame(seq: number, type: string, payload: unknown, occurredAt = this.#now()): Frame {
    return { seq, text: `id: ${seq}\nevent: ${type}\ndata: ${safeJson({ seq, type, occurredAt, payload })}\n\n` };
  }

  #send(client: ServerResponse, text: string): void {
    client.write(text);
    if (client.writableLength <= this.#options.maxBufferedBytes) return;
    this.#clients.delete(client);
    client.destroy();
  }

  #beat(): void {
    for (const client of this.#clients) this.#send(client, ': heartbeat\n\n');
  }
}
