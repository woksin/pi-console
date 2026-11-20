import type { AppendResult, EventEnvelope, EventLog, NewEvent, SourceCheckpoint } from '@pi-console/contract';

/** Atomic in-memory EventLog seam; failures happen before either collection changes. */
export class MemoryLog implements EventLog {
  rows: EventEnvelope[] = [];
  positions: SourceCheckpoint[] = [];
  failNext = false;

  async append(events: readonly NewEvent[], checkpoints: readonly SourceCheckpoint[] = []): Promise<AppendResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated transaction abort');
    }
    const fresh = events.filter(event => !this.rows.some(row => row.idempotencyKey === event.idempotencyKey));
    const rows = fresh.map((event, index) => ({ ...event, seq: this.rows.length + index + 1, recordedAt: new Date().toISOString() }));
    this.rows.push(...rows);
    for (const checkpoint of checkpoints) {
      this.positions = this.positions.filter(saved => saved.source !== checkpoint.source || saved.identity !== checkpoint.identity);
      this.positions.push({ ...checkpoint });
    }
    return { appended: rows.length, duplicates: events.length - rows.length, lastSeq: this.rows.length };
  }

  async *readFrom(afterSeq: number, limit = Infinity): AsyncIterable<EventEnvelope> {
    yield* this.rows.filter(row => row.seq > afterSeq).slice(0, limit);
  }

  subscribe(): () => void {
    return () => undefined;
  }

  async checkpoints(source: string): Promise<SourceCheckpoint[]> {
    return this.positions.filter(checkpoint => checkpoint.source === source).map(checkpoint => ({ ...checkpoint }));
  }
}
