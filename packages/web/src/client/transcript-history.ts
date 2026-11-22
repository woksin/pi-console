import type { Transcript } from '@pi-console/contract';
import type { ConsoleState } from '../state/state.ts';
import { emptyProgress, transcriptPage, type TranscriptLoad } from '../state/transcript-history.ts';
import type { Api } from './api.ts';

const pageSize = 500;

/** One visible transcript, one cancellable request; reopening always fetches a fresh bounded window. */
export class TranscriptHistory {
  readonly #api: Api;
  readonly #read: () => ConsoleState;
  readonly #publish: (state: ConsoleState) => void;
  #session: string | null = null;
  #request: AbortController | null = null;

  constructor(api: Api, read: () => ConsoleState, publish: (state: ConsoleState) => void) {
    this.#api = api; this.#read = read; this.#publish = publish;
  }

  close(sessionId?: string): void {
    if (sessionId !== undefined && this.#session !== sessionId) return;
    this.#request?.abort(); this.#request = null; this.#session = null;
  }

  open(sessionId: string, focus: string | null): Promise<void> {
    this.close(); this.#session = sessionId;
    const state = this.#read();
    this.#publish({ ...state, transcripts: { ...state.transcripts, [sessionId]: [] }, transcriptHistory: { ...state.transcriptHistory, [sessionId]: { ...emptyProgress, focusEntry: focus ?? undefined, revision: (state.transcriptHistory[sessionId]?.revision ?? 0) + 1 } } });
    return this.#load(sessionId, focus ? 'around' : 'tail', focus);
  }

  page(sessionId: string, direction: 'older' | 'newer'): Promise<void> {
    const progress = this.#read().transcriptHistory[sessionId];
    if (this.#session !== sessionId || this.#request || !progress?.[direction]) return Promise.resolve();
    return this.#load(sessionId, direction);
  }

  tail(sessionId: string): Promise<void> {
    return this.open(sessionId, null);
  }

  #fetch(sessionId: string, direction: TranscriptLoad, focus: string | null, signal: AbortSignal): Promise<Transcript> {
    const entries = this.#read().transcripts[sessionId] ?? [];
    const cursor = direction === 'older' ? entries[0]?.cursor : direction === 'newer' ? entries.at(-1)?.cursor : undefined;
    return this.#api.transcript(sessionId, cursor, pageSize, { order: direction === 'tail' || direction === 'older' ? 'desc' : 'asc', around: focus ?? undefined, signal });
  }

  #progress(sessionId: string, patch: { loading?: TranscriptLoad; error?: TranscriptLoad }): void {
    const state = this.#read();
    this.#publish({ ...state, transcriptHistory: { ...state.transcriptHistory, [sessionId]: { ...state.transcriptHistory[sessionId] ?? emptyProgress, ...patch } } });
  }

  async #load(sessionId: string, direction: TranscriptLoad, focus: string | null = null): Promise<void> {
    const request = new AbortController(); this.#request = request;
    this.#progress(sessionId, { loading: direction, error: undefined });
    try {
      let page: Transcript;
      try { page = await this.#fetch(sessionId, direction, focus, request.signal); }
      catch (error) {
        if (direction !== 'around' || request.signal.aborted) throw error;
        direction = 'tail';
        this.#progress(sessionId, { loading: direction });
        page = await this.#fetch(sessionId, direction, null, request.signal);
      }
      if (this.#request !== request) return;
      const state = this.#read();
      const result = transcriptPage(state.transcripts[sessionId] ?? [], state.transcriptHistory[sessionId] ?? emptyProgress, page, direction);
      this.#publish({ ...state, transcripts: { ...state.transcripts, [sessionId]: result.entries }, transcriptHistory: { ...state.transcriptHistory, [sessionId]: result.progress } });
    } catch {
      if (this.#request === request) this.#progress(sessionId, { loading: undefined, error: direction });
    } finally {
      if (this.#request === request) this.#request = null;
    }
  }
}
