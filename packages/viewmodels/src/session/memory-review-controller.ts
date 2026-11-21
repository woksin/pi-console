import type { MemoryActionAvailability, MemoryActionReceipt, MemoryActionRequest } from '@pi-console/contract';
import { emptyMemoryReview, failedMemoryReview, memoryReviewIngestionGraceMs, memoryReviewPending, memoryReviewProgress, memoryReviewRetryable, requestingMemoryReview, type MemoryReviewProgress, type MemoryReviewSession } from './memory-review.ts';

export interface MemoryReviewApi {
  memoryActionAvailability(sessionId: string, signal?: AbortSignal): Promise<MemoryActionAvailability | null>;
  requestMemoryAction(sessionId: string, request: MemoryActionRequest, signal?: AbortSignal): Promise<MemoryActionReceipt>;
  memoryActionReceipt(requestId: string, signal?: AbortSignal): Promise<MemoryActionReceipt>;
}
export interface ReviewScheduler { set(callback: () => void, delayMs?: number): unknown; clear(timer: unknown): void }
interface ReviewTarget { readonly sessionId: string; readonly failures?: number }
const scheduler: ReviewScheduler = { set: (callback, delayMs = 1000) => setTimeout(callback, delayMs), clear: timer => { clearTimeout(timer as ReturnType<typeof setTimeout>); } };

/** Request-only lifecycle shared by the consoles. Never edits memory or redispatches on reconnect. */
export class MemoryReviewController {
  readonly #api: MemoryReviewApi;
  readonly #publish: (sessionId: string, review: MemoryReviewSession) => void;
  readonly #reload: (sessionId: string) => Promise<void>;
  readonly #scheduler: ReviewScheduler;
  readonly #sessions = new Map<string, MemoryReviewSession>();
  readonly #loading = new Map<string, Promise<void>>();
  readonly #timers = new Set<unknown>();
  readonly #abort = new AbortController();
  constructor(api: MemoryReviewApi, publish: (sessionId: string, review: MemoryReviewSession) => void, reload: (sessionId: string) => Promise<void>, timers = scheduler) {
    this.#api = api; this.#publish = publish; this.#reload = reload; this.#scheduler = timers;
  }
  #session(id: string): MemoryReviewSession { return this.#sessions.get(id) ?? emptyMemoryReview(); }
  #set(id: string, value: MemoryReviewSession): void {
    if (this.#abort.signal.aborted) return;
    this.#sessions.set(id, value); this.#publish(id, value);
  }
  load(sessionId: string): Promise<void> {
    if (this.#abort.signal.aborted) return Promise.resolve();
    const existing = this.#loading.get(sessionId);
    if (existing) return existing;
    const task = this.#availability(sessionId).finally(() => { this.#loading.delete(sessionId); });
    this.#loading.set(sessionId, task);
    return task;
  }
  async #availability(sessionId: string): Promise<void> {
    let availability: MemoryActionAvailability | null = null;
    try { availability = await this.#api.memoryActionAvailability(sessionId, this.#abort.signal); }
    catch { /* Older daemons and disconnects retain command fallback. */ }
    const current = this.#session(sessionId);
    if (JSON.stringify(current.availability) !== JSON.stringify(availability)) this.#set(sessionId, { ...current, availability });
  }
  #progress(sessionId: string, itemId: string, progress: MemoryReviewProgress): void {
    const session = this.#session(sessionId);
    this.#set(sessionId, { ...session, items: new Map(session.items).set(itemId, progress) });
  }
  async request(sessionId: string, itemId: string, action: MemoryActionRequest['action']): Promise<void> {
    if (this.#abort.signal.aborted) return;
    const session = this.#session(sessionId);
    if (!session.availability?.available || !memoryReviewRetryable(session.items.get(itemId))) return;
    if ([...session.items.values()].some(progress => memoryReviewPending(progress.state))) return;
    this.#progress(sessionId, itemId, requestingMemoryReview());
    const request: MemoryActionRequest = { requestId: globalThis.crypto.randomUUID(), itemId, action };
    try {
      const receipt = await this.#api.requestMemoryAction(sessionId, request, this.#abort.signal);
      await this.#accept({ sessionId }, receipt);
    } catch (error) { this.#progress(sessionId, itemId, failedMemoryReview(error)); await this.#refresh({ sessionId }); }
  }
  async #accept(target: ReviewTarget, receipt: MemoryActionReceipt): Promise<void> {
    if (this.#abort.signal.aborted) return;
    this.#progress(target.sessionId, receipt.itemId, memoryReviewProgress(receipt));
    if (memoryReviewPending(receipt.state)) { this.#pending(target, receipt); return; }
    await this.#refresh(target);
  }
  async #refresh(target: ReviewTarget): Promise<void> {
    if (this.#abort.signal.aborted) return;
    await this.#reload(target.sessionId).catch(() => undefined);
    await this.load(target.sessionId);
  }
  #deadline(receipt: MemoryActionReceipt): number { return receipt.expiresAt + memoryReviewIngestionGraceMs; }
  #pending(target: ReviewTarget, receipt: MemoryActionReceipt): void {
    if (this.#abort.signal.aborted) return;
    if (Date.now() >= this.#deadline(receipt)) {
      this.#progress(target.sessionId, receipt.itemId, memoryReviewProgress({ ...receipt, state: 'unknown' }));
      void this.#refresh(target);
      return;
    }
    this.#schedule(target, receipt);
  }
  #schedule(target: ReviewTarget, receipt: MemoryActionReceipt): void {
    const backoff = Math.min(1000 * 2 ** (target.failures ?? 0), 5000);
    const delay = Math.min(backoff, this.#deadline(receipt) - Date.now());
    const timer = this.#scheduler.set(() => { this.#timers.delete(timer); void this.#poll(target, receipt); }, delay);
    this.#timers.add(timer);
  }
  async #poll(target: ReviewTarget, receipt: MemoryActionReceipt): Promise<void> {
    if (this.#abort.signal.aborted) return;
    if (Date.now() >= this.#deadline(receipt)) { this.#pending(target, receipt); return; }
    try { await this.#accept({ ...target, failures: 0 }, await this.#api.memoryActionReceipt(receipt.requestId, this.#abort.signal)); }
    catch { this.#pending({ ...target, failures: (target.failures ?? 0) + 1 }, receipt); }
  }
  dispose(): void {
    this.#abort.abort();
    for (const timer of this.#timers) this.#scheduler.clear(timer);
    this.#timers.clear();
  }
}
