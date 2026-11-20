import { setTimeout as delay } from 'node:timers/promises';
import { Model, type Entry, type Event } from './model.ts';

/** Streaming decoder: UTF-8 boundaries, CRLF, comments and multiline SSE data. */
export class Frames {
  buffer = '';
  push(chunk: string): Event[] {
    this.buffer += chunk;
    const result: Event[] = [];
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) result.push(JSON.parse(data));
    }
    return result;
  }
}

export class Client {
  controller = new AbortController();
  historyLoading = new Set<string>();
  lastSequence: number | undefined;
  onSnapshot = () => {};

  model: Model;
  base: string;
  private token: string;

  constructor(model: Model, base: string, token: string) {
    this.model = model;
    this.base = base;
    this.token = token;
    const url = new URL(base);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Only loopback HTTP mock daemons are allowed');
  }

  async get(path: string) {
    const response = await fetch(`${this.base}/api/v0${path}`, {
      headers: { Authorization: `Bearer ${this.token}` }, signal: this.controller.signal,
    });
    if (!response.ok) throw new Error(`Mock API: HTTP ${response.status}`);
    return response.json();
  }

  async history(sessionId: string) {
    if (this.historyLoading.has(sessionId)) return;
    this.historyLoading.add(sessionId);
    try {
      let after = 0;
      let more = true;
      const entries: Entry[] = [];
      // A fixed upper bound avoids chasing a 5k/s live stream forever.
      for (let page = 0; page < 5 && more; page++) {
        const result = await this.get(`/sessions/${encodeURIComponent(sessionId)}/transcript?after=${after}&limit=1000`);
        entries.push(...result.items);
        after = result.nextCursor;
        more = result.hasMore;
      }
      this.model.mergeHistory(sessionId, entries);
    } catch (error) { this.model.error = (error as Error).message; }
    finally { this.historyLoading.delete(sessionId); }
  }

  async run() {
    while (!this.controller.signal.aborted) {
      try { await this.connect(); }
      catch (error) {
        this.model.error = (error as Error).message;
        this.model.connected = false;
      }
      if (!this.controller.signal.aborted) await delay(700, undefined, { signal: this.controller.signal }).catch(() => {});
    }
  }

  private async connect() {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (this.lastSequence !== undefined) headers['Last-Event-ID'] = String(this.lastSequence);
    const response = await fetch(`${this.base}/api/v0/stream`, { headers, signal: this.controller.signal });
    // A restarted daemon may have a lower process-local sequence.
    if (response.status === 400) this.lastSequence = undefined;
    if (!response.ok || !response.body) throw new Error(`SSE: HTTP ${response.status}`);
    this.model.connected = true;
    this.model.error = '';
    const decoder = new TextDecoder();
    const frames = new Frames();
    for await (const chunk of response.body) {
      for (const event of frames.push(decoder.decode(chunk, { stream: true }))) {
        this.model.apply(event);
        this.lastSequence = event.seq;
        if (event.type === 'snapshot') {
          void this.history(this.model.selected);
          this.onSnapshot();
        }
      }
    }
    this.model.connected = false;
    this.model.error = 'Stream closed · reconnecting';
  }

  close() { this.controller.abort(); }
}
