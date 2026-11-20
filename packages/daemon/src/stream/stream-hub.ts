import type { ServerResponse } from 'node:http';
import { HttpError } from '../security/guard.ts';
import { safeJson } from '../http/output.ts';

export interface StreamOptions {
  /** First id is `base + 1`. The daemon passes the projected log position, so ids grow across restarts. */
  base: number;
  /** Deltas kept for `Last-Event-ID` resume (v1: 10,000). */
  ringSize: number;
  heartbeatMs: number;
  /** A client whose unsent output exceeds this is disconnected and resumes from its last parsed id. */
  maxBufferedBytes: number;
  /** Current read models as the v0 `snapshot` payload. */
  snapshot: () => unknown;
  now?: () => Date;
}

interface Frame { seq: number; text: string }

/** Parses `Last-Event-ID`; nonnumeric, unsafe or future ids are a 400 before any stream bytes are written. */
export function resumePoint(lastId: string | undefined, current: number): number | undefined {
  if (lastId === undefined) return undefined;
  if (!/^\d+$/.test(lastId)) throw new HttpError(400, 'Invalid Last-Event-ID');
  const after = Number(lastId);
  if (!Number.isSafeInteger(after) || after > current) throw new HttpError(400, 'Invalid Last-Event-ID');
  return after;
}

/**
 * SSE fan-out with a bounded replay ring. Ids are contiguous per process. A resume inside the ring replays the
 * deltas after the id and continues live; a resume before it (or across a restart) gets a fresh snapshot.
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

  publish(type: string, payload: unknown): void {
    const frame = this.#frame(++this.#seq, type, payload);
    this.#ring.push(frame);
    if (this.#ring.length > this.#options.ringSize) this.#ring.shift();
    for (const client of this.#clients) this.#send(client, frame.text);
  }

  connect(client: ServerResponse, lastEventId: string | undefined): void {
    const after = resumePoint(lastEventId, this.#seq);
    client.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    client.flushHeaders();
    for (const text of this.#catchUp(after)) this.#send(client, text);
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
    if (after === undefined || after < earliest - 1) return [this.#frame(this.#seq, 'snapshot', this.#options.snapshot()).text];
    return this.#ring.filter(frame => frame.seq > after).map(frame => frame.text);
  }

  #frame(seq: number, type: string, payload: unknown): Frame {
    const occurredAt = (this.#options.now ?? (() => new Date()))().toISOString();
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
