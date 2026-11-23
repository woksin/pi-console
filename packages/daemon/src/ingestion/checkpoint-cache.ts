import type { AppendResult, EventEnvelope, EventLog, NewEvent, SourceCheckpoint } from '@pi-console/contract';

/**
 * Reads each source's checkpoints from the log once and keeps them current from what this process appends. One
 * instance serves one source ingestion (the only writer of that source's checkpoints), so the copy cannot go stale;
 * a restart builds a new one from the log. Avoids a `SELECT` plus a parse of every stored checkpoint per file.
 */
export class CheckpointCache implements EventLog {
  readonly #log: EventLog;
  readonly #sources = new Map<string, Map<string, SourceCheckpoint>>();

  constructor(log: EventLog) {
    this.#log = log;
  }

  async append(events: readonly NewEvent[], checkpoints: readonly SourceCheckpoint[] = []): Promise<AppendResult> {
    const result = await this.#log.append(events, checkpoints);
    for (const checkpoint of checkpoints) this.#sources.get(checkpoint.source)?.set(checkpoint.identity, checkpoint);
    return result;
  }

  async checkpoint(source: string, identity: string): Promise<SourceCheckpoint | undefined> {
    return (await this.#known(source)).get(identity);
  }

  async checkpoints(source: string): Promise<SourceCheckpoint[]> {
    return [...(await this.#known(source)).values()];
  }

  async #known(source: string): Promise<Map<string, SourceCheckpoint>> {
    let known = this.#sources.get(source);
    if (!known) {
      known = new Map((await this.#log.checkpoints(source)).map(checkpoint => [checkpoint.identity, checkpoint]));
      this.#sources.set(source, known);
    }
    return known;
  }

  readFrom(afterSeq: number, limit?: number): AsyncIterable<EventEnvelope> {
    return this.#log.readFrom(afterSeq, limit);
  }

  subscribe(afterSeq: number, onEvent: (event: EventEnvelope) => void): () => void {
    return this.#log.subscribe(afterSeq, onEvent);
  }
}
