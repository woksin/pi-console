import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

interface RootState { path: string; ancestor: string; pending: boolean }

/** Pin the existing prefix, not a lexical alias that may never match the eventual canonical path. */
function initialRoot(candidate: string): RootState {
  const path = resolve(candidate);
  let ancestor = path;
  const suffix: string[] = [];
  for (;;) {
    try {
      const canonical = realpathSync(ancestor);
      return { path: join(canonical, ...suffix), ancestor: canonical, pending: suffix.length > 0 };
    } catch {
      const parent = dirname(ancestor);
      if (parent === ancestor) return { path, ancestor, pending: true };
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

function unlinked(scope: { path: string; ancestor: string }): boolean {
  let directory = scope.path;
  for (;;) {
    if (lstatSync(directory).isSymbolicLink()) return false;
    if (directory === scope.ancestor) return true;
    directory = dirname(directory);
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel.split(sep)[0] !== '..' && !isAbsolute(rel);
}

/** A configured alias is trusted once; missing descendants must appear as directories, not new aliases. */
export class SourceRoot {
  readonly #ancestor: string;
  #path: string;
  #pending: boolean;

  constructor(candidate: string) {
    const state = initialRoot(candidate);
    this.#ancestor = state.ancestor;
    this.#path = state.path;
    this.#pending = state.pending;
  }

  get path(): string { return this.#path; }

  available(): string | undefined {
    try {
      if (!existsSync(this.#path)) return undefined;
      if (this.#pending && !this.#pinAppearedRoot()) return undefined;
      return this.#path;
    } catch {
      return undefined;
    }
  }

  #pinAppearedRoot(): boolean {
    const scope = { path: this.#path, ancestor: this.#ancestor };
    if (!unlinked(scope)) return false;
    const canonical = realpathSync(this.#path);
    if (!inside(this.#ancestor, canonical) || !unlinked(scope)) return false;
    this.#path = canonical;
    this.#pending = false;
    return true;
  }
}
