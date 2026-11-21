import type { IncomingMessage, Server } from 'node:http';
import { join } from 'node:path';
import { identifier, memoryReviewTtlMs, memoryActionRequestSchema, reviewValue, type EventEnvelope, type MemoryActionAvailability, type MemoryActionReceipt, type MemoryActionRequest, type ReviewResult } from '@pi-console/contract';
import type { ConsoleQueries, SqliteEventLog } from '@pi-console/core';
import type { DaemonConfig } from '../config.ts';
import { HttpError } from '../security/guard.ts';
import { ReviewChannel, type ReviewPeer } from './channel.ts';
import { ReviewReceipts } from './receipts.ts';
import { ReviewLimits } from './limits.ts';
import { providerAvailability, reviewableItem } from './availability.ts';
import { ReviewSource } from './source.ts';

export const memoryActionsPath = '/api/v1/memory-actions';
interface Options { config: DaemonConfig; server: Server; secret: string; queries(): ConsoleQueries; log: SqliteEventLog }
type Receipt = MemoryActionReceipt;
const resultStates: Partial<Record<ReviewResult['reason'], Receipt['state']>> = { cancelled: 'declined', refused: 'declined', conflict: 'conflict', stale: 'conflict', not_proposed: 'conflict', expired: 'expired' };
const sameIntent = (receipt: Receipt, request: Pick<ReviewResult, 'itemId' | 'action'>): boolean => receipt.itemId === request.itemId && receipt.action === request.action;
const sameTarget = (receipt: Receipt, result: ReviewResult): boolean => receipt.sessionId === result.sessionId && receipt.generation === result.generation;
const appliedResult = (result: ReviewResult): boolean => result.reason === 'applied' && result.ok === true && result.status === 'applied' && identifier(result.eventId);

/** Durable intent before delivery; source-native human authority is never manufactured here. */
export class MemoryActions {
  readonly #options: Options;
  readonly #receipts: ReviewReceipts;
  readonly #channel: ReviewChannel;
  readonly #unsubscribe: () => void;
  readonly #timer: ReturnType<typeof setInterval>;
  readonly #limits = new ReviewLimits();
  readonly #source: ReviewSource;
  constructor(options: Options) {
    this.#options = options;
    this.#source = new ReviewSource(options.config);
    this.#receipts = new ReviewReceipts(join(options.config.dataDir, 'memory-actions.db'));
    this.#channel = new ReviewChannel(options.server, options.secret, {
      gone: peer => { this.#lost(peer); },
      result: (peer, value) => { void this.#result(peer, value); },
    });
    this.#unsubscribe = options.log.subscribe(0, event => { this.#observe(event); });
    this.#timer = setInterval(() => { this.#expire(); }, 1000);
    this.#timer.unref();
  }
  port(port: number): void { this.#channel.port(port); }
  availability(sessionId: string): MemoryActionAvailability {
    return providerAvailability(this.#channel.peers.get(sessionId), this.#source.store()?.id);
  }
  receipt(id: string, tokenId: string): Receipt {
    const receipt = identifier(id) ? this.#receipts.get(id) : undefined;
    if (receipt?.tokenId !== tokenId) throw new HttpError(404, 'Review receipt not found');
    return receipt;
  }
  async post(req: IncomingMessage, tokenId: string, sessionId: string): Promise<Receipt> {
    const request = await readRequest(req);
    const existing = this.#receipts.get(request.requestId);
    if (existing) return this.#retry(existing, request, { tokenId, sessionId });
    this.#expire();
    const peer = this.#target(request, sessionId);
    this.#admit(peer, tokenId);
    const receipt = this.#claim(peer, request, tokenId);
    return this.#deliver(peer, receipt);
  }
  #claim(peer: ReviewPeer, request: MemoryActionRequest, tokenId: string): Receipt {
    const now = Date.now();
    const { requestId, itemId, action } = request;
    const receipt: Receipt = { version: 1, requestId, itemId, action, sessionId: peer.binding.sessionId, generation: peer.readiness?.generation ?? '', connectionGeneration: peer.connectionGeneration, tokenId, createdAt: now, expiresAt: now + memoryReviewTtlMs, updatedAt: now, state: 'awaiting-human', reason: null, eventId: null };
    if (!this.#receipts.claim(receipt)) throw new HttpError(409, 'Review request id already used');
    return receipt;
  }
  #deliver(peer: ReviewPeer, receipt: Receipt): Receipt {
    const { requestId, itemId, action, sessionId, generation, expiresAt } = receipt;
    if (!this.#channel.send(peer, { requestId, itemId, action, sessionId, generation, expiresAt })) return this.#update(receipt, 'unknown');
    return receipt;
  }
  #retry(existing: Receipt, request: MemoryActionRequest, target: { tokenId: string; sessionId: string }): Receipt {
    if (existing.tokenId !== target.tokenId || existing.sessionId !== target.sessionId) throw new HttpError(409, 'Review request id already used');
    if (!sameIntent(existing, request)) throw new HttpError(409, 'Review request id already used');
    return existing;
  }
  #target(request: MemoryActionRequest, sessionId: string): ReviewPeer {
    const items = this.#options.queries().memoryItems().filter(item => item.sessionId === sessionId);
    const item = items.find(item => item.id === request.itemId);
    if (!item) throw new HttpError(404, 'Memory item not found');
    if (!reviewableItem(item)) throw new HttpError(409, 'Memory item is not proposed');
    if (!this.#source.owns(item.id)) throw new HttpError(503, 'Memory review unavailable');
    return this.#peer(sessionId);
  }
  #peer(sessionId: string): ReviewPeer {
    const peer = this.#channel.peers.get(sessionId);
    if (!this.availability(sessionId).available || !peer) throw new HttpError(503, 'Memory review unavailable');
    return peer;
  }
  #admit(peer: ReviewPeer, tokenId: string): void {
    const pending = this.#receipts.pending();
    if (this.#receipts.count() >= 10_000) throw new HttpError(429, 'Review receipt capacity reached');
    if (pending.some(receipt => receipt.state === 'awaiting-human' && receipt.sessionId === peer.binding.sessionId)) throw new HttpError(409, 'Memory review busy');
    this.#limits.take(tokenId, peer.binding.sessionId);
  }
  #update(receipt: Receipt, state: Receipt['state'], reason = receipt.reason, eventId = receipt.eventId): Receipt {
    const updated = { ...receipt, state, reason, eventId, updatedAt: Date.now() };
    this.#receipts.save(updated);
    return updated;
  }
  #lost(peer: ReviewPeer): void {
    for (const receipt of this.#receipts.pending()) {
      if (receipt.state !== 'awaiting-human' || receipt.connectionGeneration !== peer.connectionGeneration) continue;
      this.#update(receipt, 'unknown');
      this.#channel.cancel(peer, receipt.requestId);
    }
  }
  #expire(): void {
    this.#receipts.prune();
    for (const receipt of this.#receipts.pending()) this.#expireReceipt(receipt);
  }
  #expireReceipt(receipt: Receipt): void {
    if (receipt.state === 'awaiting-ingestion' && receipt.expiresAt + 30_000 <= Date.now()) this.#update(receipt, 'unknown');
    if (receipt.state !== 'awaiting-human' || receipt.expiresAt > Date.now()) return;
    this.#update(receipt, 'expired', 'expired');
    const peer = this.#channel.peers.get(receipt.sessionId);
    if (peer?.connectionGeneration === receipt.connectionGeneration) this.#channel.cancel(peer, receipt.requestId);
  }
  async #result(peer: ReviewPeer, result: ReviewResult): Promise<void> {
    const receipt = this.#pending(peer, result);
    if (!receipt) return;
    if (!sameTarget(receipt, result) || !sameIntent(receipt, result)) { this.#update(receipt, 'unknown'); return; }
    if (!appliedResult(result)) { this.#update(receipt, resultStates[result.reason] ?? 'unavailable', result.reason); return; }
    this.#update(receipt, 'awaiting-ingestion', result.reason, result.eventId);
    try { for await (const event of this.#options.log.readFrom(0)) this.#observe(event); }
    catch { /* A result remains unverified until canonical ingestion is available. */ }
  }
  #pending(peer: ReviewPeer, result: ReviewResult): Receipt | undefined {
    const receipt = this.#receipts.get(result.requestId);
    if (receipt?.state !== 'awaiting-human' || receipt.connectionGeneration !== peer.connectionGeneration) return;
    if (receipt.expiresAt <= Date.now()) { this.#expire(); return; }
    return receipt;
  }
  #observe(event: EventEnvelope): void {
    this.#source.observe(event);
    if (event.type === 'SessionEnded') this.#sessionEnded(event);
    if (!this.#canonical(event)) return;
    const payload = event.payload as { itemId: string; actorKind: string; status?: string };
    if (payload.actorKind !== 'human') return;
    for (const receipt of this.#receipts.pending()) {
      if (!this.#matches(receipt, event, payload.itemId)) continue;
      this.#reconcile(receipt, event, payload.status);
    }
  }
  #reconcile(receipt: Receipt, event: EventEnvelope, status?: string): void {
    const matches = matchesAction(receipt, event, status) && this.#folded(receipt);
    this.#update(receipt, matches ? 'observed-applied' : 'conflict');
  }
  #folded(receipt: Receipt): boolean {
    const status = this.#options.queries().memoryItems().find(item => item.id === receipt.itemId)?.status;
    return status === (receipt.action === 'confirm' ? 'active' : 'rejected');
  }
  #sessionEnded(event: EventEnvelope): void {
    const { sessionId } = event.payload as { sessionId: string };
    const peer = this.#channel.peers.get(sessionId);
    if (peer) this.#lost(peer);
  }
  #canonical(event: EventEnvelope): boolean {
    if (event.source !== 'intent-memory' || !event.refs) return false;
    if (event.refs.file !== this.#source.store()?.events) return false;
    return event.type === 'MemoryItemConfirmed' || event.type === 'MemoryItemRetired';
  }
  #matches(receipt: Receipt, event: EventEnvelope, itemId: string): boolean {
    if (receipt.state !== 'awaiting-ingestion' && receipt.state !== 'unknown') return false;
    return receipt.eventId !== null && receipt.eventId === event.refs?.entryId && receipt.itemId === itemId;
  }
  close(): void { clearInterval(this.#timer); for (const peer of this.#channel.peers.values()) this.#lost(peer); this.#channel.close(); this.#unsubscribe(); this.#receipts.close(); }
}

function matchesAction(receipt: Receipt, event: EventEnvelope, status?: string): boolean {
  return receipt.action === 'confirm' ? event.type === 'MemoryItemConfirmed' : event.type === 'MemoryItemRetired' && status === 'rejected';
}
async function readRequest(req: IncomingMessage): Promise<MemoryActionRequest> {
  const body = await readBody(req);
  try { return reviewValue(JSON.parse(body), memoryActionRequestSchema) as MemoryActionRequest; }
  catch { throw new HttpError(400, 'Invalid review request'); }
}
async function readBody(req: IncomingMessage): Promise<string> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'JSON required');
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 1024) throw new HttpError(413, 'Review request too large');
  }
  return body;
}
