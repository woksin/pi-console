import { HttpError } from '../security/guard.ts';

/** Shared control-token and per-session windows; rejecting the second key still consumes the first. */
export class ReviewLimits {
  readonly #rates = new Map<string, number[]>();
  take(tokenId: string, sessionId: string): void {
    const now = Date.now();
    this.#prune(now);
    for (const key of [`token:${tokenId}`, `session:${sessionId}`]) this.#takeKey(key, now);
  }
  #prune(now: number): void {
    for (const [key, times] of this.#rates) {
      if (!times.some(time => time > now - 60_000)) this.#rates.delete(key);
    }
  }
  #takeKey(key: string, now: number): void {
    const times = (this.#rates.get(key) ?? []).filter(time => time > now - 60_000);
    if (times.length >= 6) throw new HttpError(429, 'Review rate limit reached');
    if (this.#rates.size >= 1024 && !this.#rates.has(key)) throw new HttpError(429, 'Review rate limit reached');
    this.#rates.set(key, [...times, now]);
  }
}
