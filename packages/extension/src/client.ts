import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import { reviewReadinessChanged, memoryReviewTtlMs, maxReviewFrameBytes, parseChannelFrame, reviewPrefix, reviewReadinessSchema, reviewResultSchema, reviewValue, type ChannelBinding, type ChannelFrame, type ReviewReadiness, type ReviewResult, type ReviewRequest } from '@pi-console/contract';

export interface ReviewBus { on(name: string, listener: (value: unknown) => void): () => void; emit(name: string, value: unknown): void }
interface Options { url: string; secret: string; binding: ChannelBinding; bus: ReviewBus; reconnectMs?: number }
interface Challenge { nonce: string; generation: string }
interface Authentication { challenge: Challenge; nonce: string; binding: ChannelBinding }
interface Connection { socket: WebSocket; challenge?: Challenge; nonce: string; timer: ReturnType<typeof setTimeout> }
const mac = (secret: string, role: string, auth: Authentication): string =>
  createHmac('sha256', secret).update(JSON.stringify([role, auth.challenge.nonce, auth.challenge.generation, auth.nonce, auth.binding.sessionId, auth.binding.pid, auth.binding.cwd])).digest('hex');
const currentRequest = (request: ReviewRequest, binding: ChannelBinding, ready?: ReviewReadiness): boolean => request.sessionId === binding.sessionId && request.generation === ready?.generation;
const timelyRequest = (request: ReviewRequest): boolean => request.expiresAt > Date.now() && request.expiresAt <= Date.now() + memoryReviewTtlMs;
const currentReady = (ready: ReviewReadiness, binding: ChannelBinding): boolean => ready.sessionId === binding.sessionId && Boolean(ready.generation) && /^[a-f0-9]{64}$/u.test(ready.storeId);
const activeProvider = (ready?: ReviewReadiness): boolean => ready?.available === true && ready.version === 1;
const acceptableReady = (ready: ReviewReadiness, binding: ChannelBinding): boolean => ready.version !== 1 || !ready.available || currentReady(ready, binding);

/** An outbound fixed-message transport. It never constructs UI responders or reads/writes memory. */
export class MemoryReviewClient {
  readonly #options: Options;
  readonly #off: (() => void)[];
  readonly #pending = new Set<string>();
  #socket: WebSocket | undefined;
  #authenticated = false;
  #readiness: ReviewReadiness | undefined;
  #stopped = false;
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  constructor(options: Options) {
    this.#options = options;
    this.#off = [
      options.bus.on(`${reviewPrefix}readiness`, value => { this.#ready(value); }),
      options.bus.on(`${reviewPrefix}result`, value => { this.#result(value); }),
    ];
    this.#connect();
  }
  #connect(): void {
    const socket = new WebSocket(this.#options.url, { maxPayload: maxReviewFrameBytes, perMessageDeflate: false, handshakeTimeout: 5000 });
    this.#socket = socket;
    const state: Connection = { socket, nonce: randomBytes(32).toString('hex'), timer: setTimeout(() => { socket.terminate(); }, 5000) };
    socket.on('error', () => { socket.terminate(); });
    socket.on('message', (bytes, binary) => { this.#message(state, { bytes, binary }); });
    socket.on('close', () => { this.#disconnected(state); });
  }
  #message(state: Connection, message: { bytes: RawData; binary: boolean }): void {
    try {
      if (message.binary || !Buffer.isBuffer(message.bytes)) throw new Error('Binary frame');
      const frame = parseChannelFrame(message.bytes.toString());
      if (frame.type === 'challenge' && !state.challenge) { this.#hello(state, frame); return; }
      if (!this.#authenticated) { this.#authenticate(state, frame); return; }
      this.#receive(frame);
    } catch { state.socket.terminate(); }
  }
  #hello(state: Connection, challenge: Challenge): void {
    state.challenge = challenge;
    const { nonce } = state;
    const { binding } = this.#options;
    this.#send({ type: 'hello', nonce, binding, proof: mac(this.#options.secret, 'client', { challenge, nonce, binding }) });
  }
  #authenticate(state: Connection, frame: ChannelFrame): void {
    if (!state.challenge) throw new Error('Authentication required');
    this.#welcome(frame, { challenge: state.challenge, nonce: state.nonce, binding: this.#options.binding });
    clearTimeout(state.timer);
  }
  #disconnected(state: Connection): void {
    clearTimeout(state.timer);
    this.#authenticated = false;
    this.#readiness = undefined;
    this.#cancelAll();
    this.#scheduleReconnect();
  }
  #scheduleReconnect(): void {
    if (this.#stopped) return;
    this.#reconnect = setTimeout(() => { this.#connect(); }, this.#options.reconnectMs ?? 2000);
    this.#reconnect.unref();
  }
  #welcome(frame: ChannelFrame, auth: Authentication): void {
    if (frame.type !== 'welcome') throw new Error('Authentication required');
    const expected = mac(this.#options.secret, 'server', auth);
    if (!/^[a-f0-9]{64}$/u.test(frame.proof) || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(frame.proof, 'hex'))) throw new Error('Authentication refused');
    this.#authenticated = true;
    this.#options.bus.emit(`${reviewPrefix}probe`, { version: 1 });
  }
  #receive(frame: ChannelFrame): void {
    if (frame.type === 'cancel') { this.#cancel(frame.requestId); return; }
    if (frame.type !== 'request') throw new Error('Unexpected frame');
    this.#request(frame.value);
  }
  #request(request: ReviewRequest): void {
    if (this.#pending.size > 0 || !activeProvider(this.#readiness)) throw new Error('Request refused');
    if (!currentRequest(request, this.#options.binding, this.#readiness) || !timelyRequest(request)) throw new Error('Request refused');
    this.#pending.add(request.requestId);
    this.#options.bus.emit(`${reviewPrefix}request`, request);
  }
  #ready(value: unknown): void {
    try {
      const ready = reviewValue(value, reviewReadinessSchema) as ReviewReadiness;
      if (!acceptableReady(ready, this.#options.binding)) return;
      if (reviewReadinessChanged(this.#readiness, ready)) this.#cancelAll();
      this.#readiness = ready;
      if (this.#authenticated) this.#send({ type: 'readiness', value: ready });
    } catch { this.#readiness = undefined; this.#cancelAll(); this.#socket?.terminate(); }
  }
  #result(value: unknown): void {
    try {
      const result = reviewValue(value, reviewResultSchema) as ReviewResult;
      if (!this.#pending.delete(result.requestId) || !this.#authenticated) return;
      this.#send({ type: 'result', value: result });
    } catch { this.#socket?.terminate(); }
  }
  #send(frame: ChannelFrame): void {
    if (this.#socket?.readyState !== WebSocket.OPEN || this.#socket.bufferedAmount > maxReviewFrameBytes) { this.#socket?.terminate(); return; }
    this.#socket.send(JSON.stringify(frame));
  }
  #cancel(id: string): void { if (this.#pending.delete(id)) this.#options.bus.emit(`${reviewPrefix}cancel`, { requestId: id }); }
  #cancelAll(): void { for (const id of this.#pending) this.#cancel(id); }
  close(): void {
    this.#stopped = true;
    clearTimeout(this.#reconnect);
    this.#cancelAll();
    for (const off of this.#off) off();
    this.#socket?.terminate();
  }
}
