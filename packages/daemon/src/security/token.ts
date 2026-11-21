import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

/** Read credentials never grant memory-review request scope. */
export type Scope = 'read' | 'memory-review';

const tokenPattern = /^[a-f0-9]{64}$/;

const digest = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

function ownerOnly(path: string, mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlinked credential path ${path}`);
  if (process.getuid && stat.uid !== process.getuid()) throw new Error(`Credential path ${path} is owned by another user`);
  chmodSync(path, mode);
}

function createIfMissing(path: string): void {
  try {
    writeFileSync(path, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/**
 * The owner token: 256 random bits in `<directory>/token` (0600) inside an owner-only directory (0700). Created on
 * first start, reused afterwards. Rotation: stop the daemon, delete the file, start again.
 */
export function loadToken(directory: string, name = 'token'): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  ownerOnly(directory, 0o700);
  const path = join(directory, name);
  createIfMissing(path);
  ownerOnly(path, 0o600);
  const token = readFileSync(path, 'utf8').trim();
  if (!tokenPattern.test(token)) throw new Error('Invalid token file; delete it to generate a new one');
  return token;
}

/** Holds only a hash of the token and its scope; candidates are compared in constant time. */
export class Credentials {
  readonly #hash: Buffer;
  readonly scope: Scope = 'read';

  readonly #control: Buffer | undefined;

  constructor(token: string, control?: string) {
    this.#hash = digest(token);
    this.#control = control === undefined ? undefined : digest(control);
  }

  verify(candidate: string | undefined): boolean {
    if (candidate === undefined) return false;
    return timingSafeEqual(digest(candidate), this.#hash) || this.controls(candidate);
  }

  controls(candidate: string | undefined): boolean {
    return candidate !== undefined && this.#control !== undefined && timingSafeEqual(digest(candidate), this.#control);
  }

  controlId(): string { return this.#control?.toString('hex').slice(0, 16) ?? ''; }
}
