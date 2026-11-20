import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InterventionInput } from './signature-model.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { Store, type Entry, type Event, type Intervention } from './model.ts';

export class Client {
  readonly store = new Store();
  private abort = new AbortController();
  private sequence: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  readonly base: string;
  private token: string;
  constructor(base: string, token: string) {
    this.base = base;
    this.token = token;
    const url = new URL(base);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('The mock client only connects to loopback HTTP.');
  }
  static local() {
    const token = readFileSync(process.env.PI_CONSOLE_TOKEN_FILE ?? resolve('.pi-console-dev/token'), 'utf8').trim();
    return new Client(process.env.PI_CONSOLE_URL ?? 'http://127.0.0.1:4777', token);
  }
  private async get(path: string, stream = false) {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (stream && this.sequence !== undefined) headers['Last-Event-ID'] = String(this.sequence);
    const response = await fetch(`${this.base}/api/v0${path}`, { headers, signal: this.abort.signal });
    if (!response.ok) throw new Error(`Mock daemon HTTP ${response.status}`);
    return response;
  }
  async intervene(input: InterventionInput): Promise<Intervention> {
    const response = await fetch(`${this.base}/api/v0/interventions`, {
      method: 'POST', signal: this.abort.signal,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = await response.json() as { error: string };
      throw new Error(`Mock daemon HTTP ${response.status}: ${body.error}`);
    }
    return await response.json() as Intervention;
  }
  async transcript(id: string) {
    let cursor = 0;
    const entries: Entry[] = [];
    let more = true;
    // Bound backfill even while the stress producer outruns pagination.
    for (let page = 0; more && page < 5; page++) {
      const body = await (await this.get(`/sessions/${encodeURIComponent(id)}/transcript?after=${cursor}&limit=1000`)).json() as { items: Entry[]; nextCursor: number; hasMore: boolean };
      entries.push(...body.items);
      cursor = body.nextCursor;
      more = body.hasMore;
    }
    // Merge live entries that may have arrived while the pages were in flight.
    const live = this.store.state.entries.get(id) ?? [];
    this.store.state.entries.set(id, []);
    const unique = new Map([...entries, ...live].map(entry => [entry.cursor, entry]));
    this.store.append([...unique.values()].sort((a, b) => a.cursor - b.cursor));
  }
  start() {
    this.timer = setInterval(this.store.flush, 50);
    void this.follow();
  }
  stop() { this.abort.abort(); clearInterval(this.timer); }
  private async follow() {
    while (!this.abort.signal.aborted) {
      try { await this.stream(); }
      catch (error) {
        if (this.abort.signal.aborted) return;
        this.store.connection(false, error instanceof Error ? error.message : 'Connection lost');
        // A daemon restart invalidates a process-local cursor.
        if (error instanceof Error && error.message.endsWith('400')) this.sequence = undefined;
      }
      try { await delay(1000, undefined, { signal: this.abort.signal }); } catch { return; }
    }
  }
  private async stream() {
    const response = await this.get('/stream', true);
    this.store.connection(true);
    let pending = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body!) {
      pending += decoder.decode(chunk, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (!data) continue;
        const event = JSON.parse(data.slice(6)) as Event;
        this.store.apply(event);
        this.sequence = event.seq;
        if (event.type === 'snapshot') void this.transcript('s2').catch(error => this.store.connection(false, String(error)));
      }
    }
    this.store.connection(false, 'Reconnecting…');
  }
}
