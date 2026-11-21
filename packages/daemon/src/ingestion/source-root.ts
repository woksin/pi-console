import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** The configured path, including its symlinks, is trusted; containment starts at its canonical target. */
export class SourceRoot {
  readonly #configuredPath: string;
  #path: string;

  constructor(candidate: string) {
    this.#configuredPath = resolve(candidate);
    this.#path = this.#configuredPath;
    this.available();
  }

  get path(): string { return this.#path; }

  /** Resolve again each poll: missing or invalid roots stay pending, and changed aliases are re-pinned. */
  available(): string | undefined {
    try {
      this.#path = realpathSync(this.#configuredPath);
      return this.#path;
    } catch {
      return undefined;
    }
  }
}
