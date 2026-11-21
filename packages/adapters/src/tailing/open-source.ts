import { constants, lstatSync, realpathSync, type Stats } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathDenied } from './paths.ts';

interface SourceScope { path: string; roots: readonly string[] }
export interface OpenedSource { handle: FileHandle; path: string; stat: Stats }

const platformFlags: Partial<typeof constants> = constants;
const readFlags = constants.O_RDONLY | (platformFlags.O_NONBLOCK ?? 0) | (platformFlags.O_NOFOLLOW ?? 0);

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel.split(sep)[0] !== '..' && !isAbsolute(rel);
}

function checkAncestors(scope: { directory: string; root: string }): void {
  let directory = scope.directory;
  for (;;) {
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Source outside configured roots');
    if (directory === scope.root) return;
    directory = dirname(directory);
  }
}

class SourceBoundary {
  readonly path: string;
  readonly roots: readonly string[];

  constructor(scope: SourceScope) {
    this.path = resolve(scope.path);
    this.roots = scope.roots.map(root => resolve(root));
  }

  async open(): Promise<OpenedSource> {
    if (pathDenied(this.path)) throw new Error('Source path denied');
    const handle = await open(this.path, readFlags);
    try {
      const stat = await handle.stat();
      this.#checkFile(stat);
      const path = this.#canonicalPath();
      this.#checkFile(stat);
      return { handle, path, stat };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  #checkFile(stat: Stats): void {
    if (!stat.isFile()) throw new Error('Source is not a regular file');
    const current = lstatSync(this.path);
    if (current.isSymbolicLink()) throw new Error('Source outside configured roots');
    if (current.dev !== stat.dev || current.ino !== stat.ino) throw new Error('Source outside configured roots');
  }

  #canonicalPath(): string {
    const parent = dirname(this.path);
    const canonicalParent = realpathSync(parent);
    const root = this.roots.find(root => inside(root, parent) && inside(root, canonicalParent));
    if (!root) throw new Error('Source outside configured roots');
    checkAncestors({ directory: parent, root });
    const canonical = join(canonicalParent, basename(this.path));
    if (pathDenied(canonical)) throw new Error('Source path denied');
    return canonical;
  }
}

/** Resolve configured root aliases once, preserving the candidate's path beneath its root. */
export function resolveSourceScope(candidate: string, configuredRoots: readonly string[]): SourceScope {
  const path = resolve(candidate);
  const roots = configuredRoots.map(root => ({ lexical: resolve(root), canonical: realpathSync(root) }));
  const root = roots.find(root => inside(root.lexical, path));
  return {
    path: root ? join(root.canonical, relative(root.lexical, path)) : path,
    roots: roots.map(root => root.canonical),
  };
}

/** Open the candidate itself; roots must be the trust boundaries resolved once before discovery. */
export async function openSource(candidate: string, roots: readonly string[]): Promise<OpenedSource> {
  return new SourceBoundary({ path: candidate, roots }).open();
}
