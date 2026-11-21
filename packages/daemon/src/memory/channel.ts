import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { reviewReadinessChanged, maxReviewFrameBytes, parseChannelFrame, type ChannelBinding, type ChannelFrame, type ReviewRequest, type ReviewReadiness, type ReviewResult } from '@pi-console/contract';
import { checkSource } from '../security/guard.ts';

export const reviewChannelPath = '/api/v1/extensions/memory-review';
export interface ReviewPeer { binding: ChannelBinding; connectionGeneration: string; readiness?: ReviewReadiness; socket: WebSocket }
interface Hooks { gone(peer: ReviewPeer): void; result(peer: ReviewPeer, value: ReviewResult): void }
interface Challenge { nonce: string; generation: string }
interface Hello { nonce: string; binding: ChannelBinding }
interface Connection { socket: WebSocket; peer?: ReviewPeer; second: number; frames: number; challenge: Challenge; timer: ReturnType<typeof setTimeout> }
const mac = (secret: string, role: string, challenge: Challenge, hello: Hello): string =>
  createHmac('sha256', secret).update(JSON.stringify([role, challenge.nonce, challenge.generation, hello.nonce, hello.binding.sessionId, hello.binding.pid, hello.binding.cwd])).digest('hex');
const equal = (a: string, b: string): boolean => /^[a-f0-9]{64}$/u.test(a) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

/** Bounded live connections and frames; a fresh mutually authenticated challenge per connection. No queues. */
export class ReviewChannel {
  readonly #server = new WebSocketServer({ noServer: true, maxPayload: maxReviewFrameBytes, perMessageDeflate: false });
  readonly peers = new Map<string, ReviewPeer>();
  readonly #pending = new Set<WebSocket>();
  #upgradeSecond = 0;
  #upgradeCount = 0;
  readonly #hooks: Hooks;
  readonly #secret: string;
  #port = 0;
  #closed = false;
  constructor(server: Server, secret: string, hooks: Hooks) {
    this.#secret = secret;
    this.#hooks = hooks;
    server.on('upgrade', (request, socket, head) => {
      try { this.#checkUpgrade(request); this.#server.handleUpgrade(request, socket, head, ws => { this.#connect(ws); }); }
      catch { socket.destroy(); }
    });
  }
  port(port: number): void { this.#port = port; }
  #checkUpgrade(request: IncomingMessage): void {
    checkSource(request, this.#port);
    if (request.url !== reviewChannelPath || this.peers.size >= 32) throw new Error('Upgrade refused');
    if (request.headers.cookie && !request.headers.origin) throw new Error('Origin required');
    this.#admitUpgrade();
  }
  #admitUpgrade(): void {
    const now = Math.floor(Date.now() / 1000);
    if (now !== this.#upgradeSecond) { this.#upgradeSecond = now; this.#upgradeCount = 0; }
    if (this.#pending.size >= 8 || ++this.#upgradeCount > 8) throw new Error('Upgrade pressure');
  }
  #connect(socket: WebSocket): void {
    const challenge = { nonce: randomBytes(32).toString('hex'), generation: randomUUID() };
    this.#pending.add(socket);
    const state: Connection = { socket, challenge, second: 0, frames: 0, timer: setTimeout(() => { socket.terminate(); }, 1000) };
    socket.on('error', () => { socket.terminate(); });
    socket.on('close', () => { this.#disconnect(state); });
    socket.on('message', (bytes, binary) => { this.#message(socket, state, { bytes, binary }); });
    socket.send(JSON.stringify({ type: 'challenge', ...challenge }));
  }
  #disconnect(state: Connection): void {
    clearTimeout(state.timer);
    this.#pending.delete(state.socket);
    const peer = state.peer;
    if (!peer || this.#closed) return;
    if (this.peers.get(peer.binding.sessionId) === peer) this.peers.delete(peer.binding.sessionId);
    this.#hooks.gone(peer);
  }
  #message(socket: WebSocket, state: Connection, message: { bytes: RawData; binary: boolean }): void {
    try {
      this.#rate(state);
      if (message.binary || !Buffer.isBuffer(message.bytes)) throw new Error('Frame refused');
      const frame = parseChannelFrame(message.bytes.toString());
      if (!state.peer) { state.peer = this.#authenticate(socket, frame, state.challenge); clearTimeout(state.timer); return; }
      this.#receive(state.peer, frame);
    } catch { socket.terminate(); }
  }
  #rate(state: Connection): void {
    const now = Math.floor(Date.now() / 1000);
    if (now !== state.second) { state.second = now; state.frames = 0; }
    if (++state.frames > 32) throw new Error('Frame rate exceeded');
  }
  #authenticate(socket: WebSocket, frame: ChannelFrame, challenge: Challenge): ReviewPeer {
    if (frame.type !== 'hello' || !equal(frame.proof, mac(this.#secret, 'client', challenge, frame))) throw new Error('Authentication refused');
    this.#pending.delete(socket);
    const peer: ReviewPeer = { socket, binding: frame.binding, connectionGeneration: challenge.generation };
    const previous = this.peers.get(frame.binding.sessionId);
    if (previous) { this.#hooks.gone(previous); previous.socket.terminate(); }
    this.peers.set(frame.binding.sessionId, peer);
    socket.send(JSON.stringify({ type: 'welcome', proof: mac(this.#secret, 'server', challenge, frame) }));
    return peer;
  }
  #receive(peer: ReviewPeer, frame: ChannelFrame): void {
    if (frame.type === 'readiness') {
      if (reviewReadinessChanged(peer.readiness, frame.value)) this.#hooks.gone(peer);
      peer.readiness = frame.value;
      return;
    }
    if (frame.type !== 'result') throw new Error('Unexpected frame');
    this.#hooks.result(peer, frame.value);
  }
  send(peer: ReviewPeer, request: ReviewRequest): boolean { return this.#send(peer, { type: 'request', value: request }); }
  cancel(peer: ReviewPeer, requestId: string): void { this.#send(peer, { type: 'cancel', requestId }); }
  #send(peer: ReviewPeer, frame: ChannelFrame): boolean {
    if (peer.socket.readyState !== WebSocket.OPEN || peer.socket.bufferedAmount > maxReviewFrameBytes) { peer.socket.terminate(); return false; }
    peer.socket.send(JSON.stringify(frame));
    return true;
  }
  close(): void { this.#closed = true; for (const client of this.#server.clients) client.terminate(); this.#server.close(); }
}
