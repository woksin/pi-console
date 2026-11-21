import { existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

interface RootState { path: string; ancestor: string; pending: boolean }
interface RootPrefix { path: string; suffix: string[]; alias: boolean }

/** lstat sees a configured dangling alias even when realpath cannot yet follow it. */
function existingPrefix(candidate: string): RootPrefix {
  let path = candidate;
  const suffix: string[] = [];
  for (;;) {
    try {
      return { path, suffix, alias: lstatSync(path).isSymbolicLink() };
    } catch (error) {
      const parent = dirname(path);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === path) throw error;
      suffix.unshift(basename(path));
      path = parent;
    }
  }
}

/** Snapshot trusted alias targets now, then pin their existing canonical prefix and missing suffix. */
function initialRoot(candidate: string): RootState {
  const path = resolve(candidate);
  let expanded = path;
  try {
    for (let aliases = 0; aliases < 40; aliases++) {
      const prefix = existingPrefix(expanded);
      if (!prefix.alias) {
        const canonical = realpathSync(prefix.path);
        return { path: join(canonical, ...prefix.suffix), ancestor: canonical, pending: prefix.suffix.length > 0 };
      }
      expanded = resolve(dirname(prefix.path), readlinkSync(prefix.path), ...prefix.suffix);
    }
  } catch { /* Lookup errors, like cycles and excessive expansion, must not approve an unresolved alias. */ }
  return { path, ancestor: parse(path).root, pending: true };
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
