import type { Transcript } from '@pi-console/contract';
import type { ConsoleState } from '../state/state.ts';
import { emptyProgress, transcriptPage, type TranscriptLoad, type TranscriptProgress } from '../state/transcript-history.ts';
import type { Api } from './api.ts';

const pageSize = 500;
interface TranscriptTarget { sessionId: string }

/** One visible transcript, one cancellable request; reopening always fetches a fresh bounded window. */
export class TranscriptHistory {
  readonly #api: Api;
  readonly #read: () => ConsoleState;
  readonly #publish: (state: ConsoleState) => void;
  #session: string | null = null;
  #request: AbortController | null = null;
  #following = true;

  constructor(api: Api, read: () => ConsoleState, publish: (state: ConsoleState) => void) {
    this.#api = api; this.#read = read; this.#publish = publish;
  }

  close(sessionId?: string): void {
    if (sessionId !== undefined && this.#session !== sessionId) return;
    this.invalidate(); this.#session = null;
  }

  /** A new snapshot invalidates requests, not the visible reader's position or follow state. */
  invalidate(): void { this.#request?.abort(); this.#request = null; }

  following({ sessionId, following }: TranscriptTarget & { following: boolean }): void {
    if (this.#session === sessionId) this.#following = following;
  }

  refresh({ sessionId }: TranscriptTarget): Promise<void> {
    if (this.#session !== sessionId) return Promise.resolve();
    this.invalidate();
    const progress = this.#read().transcriptHistory[sessionId];
    if (this.#following && !progress?.newer) return this.#load(sessionId, 'tail', null, true);
    this.#progress(sessionId, { loading: undefined, error: undefined, newer: true });
    return Promise.resolve();
  }

  resume(target: TranscriptTarget): Promise<void> {
    const { sessionId } = target;
    this.following({ ...target, following: true });
    if (!this.#read().transcriptHistory[sessionId]?.newer) return Promise.resolve();
    return this.tail(sessionId);
  }

  open(sessionId: string, focus: string | null): Promise<void> {
    this.close(); this.#session = sessionId; this.#following = focus === null;
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

  #progress(sessionId: string, patch: Partial<TranscriptProgress>): void {
    const state = this.#read();
    this.#publish({ ...state, transcriptHistory: { ...state.transcriptHistory, [sessionId]: { ...state.transcriptHistory[sessionId] ?? emptyProgress, ...patch } } });
  }

  #merge(sessionId: string, direction: TranscriptLoad, page: Transcript, preservePosition: boolean): void {
    const state = this.#read();
    const progress = state.transcriptHistory[sessionId] ?? emptyProgress;
    const result = transcriptPage(state.transcripts[sessionId] ?? [], progress, page, direction);
    if (preservePosition) result.progress.revision = progress.revision;
    else if (direction === 'tail') this.#following = true;
    this.#publish({ ...state, transcripts: { ...state.transcripts, [sessionId]: result.entries }, transcriptHistory: { ...state.transcriptHistory, [sessionId]: result.progress } });
  }

  async #load(sessionId: string, direction: TranscriptLoad, focus: string | null = null, preservePosition = false): Promise<void> {
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
      this.#merge(sessionId, direction, page, preservePosition);
    } catch {
      if (this.#request === request) this.#progress(sessionId, { loading: undefined, error: direction });
    } finally {
      if (this.#request === request) this.#request = null;
    }
  }
}
