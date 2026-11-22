import type { Transcript } from '@pi-console/contract';
import type { ConsoleState } from '../state/state.ts';
import { emptyProgress, transcriptPage, type TranscriptLoad, type TranscriptProgress } from '../state/transcript-history.ts';
import type { Api } from './api.ts';
import { readerTransition, type ReaderGeneration, type ReaderView } from './transcript-reader.ts';

const pageSize = 500;
interface TranscriptTarget { sessionId: string }
interface TranscriptOpening extends TranscriptTarget { focus: string | null }
interface ReaderRequest { controller: AbortController; readerId: number }
interface OpeningIntent { direction: 'around' | 'tail'; focus: string | null }

/** One visible transcript, one cancellable request; reopening always fetches a fresh bounded window. */
export class TranscriptHistory {
  readonly #api: Api;
  readonly #read: () => ConsoleState;
  readonly #publish: (state: ConsoleState) => void;
  #session: string | null = null;
  #request: ReaderRequest | null = null;
  #following = true;
  #reader: ReaderGeneration | undefined;
  #opening: OpeningIntent | undefined;
  #activeGeneration = 0;
  #nextGeneration = 1;

  constructor(api: Api, read: () => ConsoleState, publish: (state: ConsoleState) => void) {
    this.#api = api; this.#read = read; this.#publish = publish;
  }

  close(sessionId?: string): void {
    if (sessionId !== undefined && this.#session !== sessionId) return;
    this.invalidate(); this.#session = null; this.#reader = undefined; this.#opening = undefined; this.#activeGeneration = 0;
  }

  /** A new snapshot invalidates requests, not the visible reader's position or follow state. */
  invalidate(): void { this.#request?.controller.abort(); this.#request = null; }

  /** A render can open or refresh a generation, never both. Route identity survives local tail replacements. */
  reconcile(view: ReaderView): Promise<void> {
    const transition = readerTransition(this.#reader, view, this.#nextGeneration);
    if (transition.action === 'wait') return Promise.resolve();
    this.#reader = transition.reader;
    switch (transition.action) {
      case 'open':
        this.#activeGeneration = this.#nextGeneration++;
        return this.#openWindow(transition.reader);
      case 'refresh': return this.refresh(transition.reader);
      case 'keep': return Promise.resolve();
    }
  }

  #current(request: ReaderRequest): boolean {
    return this.#request === request && this.#activeGeneration === request.readerId;
  }

  following({ sessionId, following }: TranscriptTarget & { following: boolean }): void {
    if (this.#session === sessionId) this.#following = following;
  }

  refresh({ sessionId }: TranscriptTarget): Promise<void> {
    if (this.#session !== sessionId) return Promise.resolve();
    this.invalidate();
    if (this.#opening) return this.#load(sessionId, this.#opening.direction, this.#opening.focus);
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
    this.#reader = undefined;
    this.#activeGeneration = this.#nextGeneration++;
    return this.#openWindow({ sessionId, focus });
  }

  #openWindow({ sessionId, focus }: TranscriptOpening): Promise<void> {
    this.invalidate(); this.#session = sessionId; this.#following = focus === null;
    const intent: OpeningIntent = { direction: focus ? 'around' : 'tail', focus };
    this.#opening = intent;
    const state = this.#read();
    this.#publish({ ...state, transcripts: { ...state.transcripts, [sessionId]: [] }, transcriptHistory: { ...state.transcriptHistory, [sessionId]: { ...emptyProgress, focusEntry: focus ?? undefined, revision: (state.transcriptHistory[sessionId]?.revision ?? 0) + 1 } } });
    return this.#load(sessionId, intent.direction, intent.focus);
  }

  page(sessionId: string, direction: 'older' | 'newer'): Promise<void> {
    const progress = this.#read().transcriptHistory[sessionId];
    if (this.#session !== sessionId || this.#request || !progress?.[direction]) return Promise.resolve();
    return this.#load(sessionId, direction);
  }

  tail(sessionId: string): Promise<void> {
    if (this.#session !== sessionId) return this.open(sessionId, null);
    return this.#openWindow({ sessionId, focus: null });
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
    this.#opening = undefined;
    const state = this.#read();
    const progress = state.transcriptHistory[sessionId] ?? emptyProgress;
    const result = transcriptPage(state.transcripts[sessionId] ?? [], progress, page, direction);
    if (preservePosition) result.progress.revision = progress.revision;
    else if (direction === 'tail') this.#following = true;
    this.#publish({ ...state, transcripts: { ...state.transcripts, [sessionId]: result.entries }, transcriptHistory: { ...state.transcriptHistory, [sessionId]: result.progress } });
  }

  async #load(sessionId: string, direction: TranscriptLoad, focus: string | null = null, preservePosition = false): Promise<void> {
    const request: ReaderRequest = { controller: new AbortController(), readerId: this.#activeGeneration }; this.#request = request;
    this.#progress(sessionId, { loading: direction, error: undefined });
    try {
      let page: Transcript;
      try { page = await this.#fetch(sessionId, direction, focus, request.controller.signal); }
      catch (error) {
        if (direction !== 'around' || !this.#current(request)) throw error;
        direction = 'tail';
        this.#opening = { direction, focus: null };
        this.#progress(sessionId, { loading: direction });
        page = await this.#fetch(sessionId, direction, null, request.controller.signal);
      }
      if (!this.#current(request)) return;
      this.#merge(sessionId, direction, page, preservePosition);
    } catch {
      if (this.#current(request)) this.#progress(sessionId, { loading: undefined, error: direction });
    } finally {
      if (this.#current(request)) this.#request = null;
    }
  }
}
