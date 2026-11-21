import { existsSync, lstatSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import { pathDenied } from '@pi-console/adapters';
import type { Feed } from './source-table.ts';
import { yieldToLoop } from './yield-to-loop.ts';

const day = 86_400_000;
const sliceMs = 5;

export type Scope = Pick<Feed, 'extension' | 'recursive' | 'name' | 'window' | 'ancestors'>;

/** One discovery pass: which files a feed wants and the start of its window. */
interface Scan { feed: Scope; since: number }

/**
 * Files of the feed under `directory` that are inside the window `since`. Same boundary as the adapters' `discover`:
 * deny-listed names and symlinks below the resolved configured root (the directory and its `ancestors`) are skipped. A missing directory is empty; an unreadable one
 * throws. Only `mtime` windows stat a file.
 */
export function discoverFiles(directory: string, feed: Scope, since: number): string[] {
  return [...walk(directory, { feed, since })].filter((path): path is string => path !== undefined).sort();
}

/** Yield even across empty/denied directories; no discovery slice intentionally exceeds 5 ms. */
export async function discoverFilesSliced(directory: string, feed: Scope, since: number): Promise<string[]> {
  const files: string[] = [];
  let started = performance.now();
  for (const path of walk(directory, { feed, since })) {
    if (path !== undefined) files.push(path);
    if (performance.now() - started < sliceMs) continue;
    await yieldToLoop();
    started = performance.now();
  }
  files.sort();
  return files;
}

/** A real, existing, non-denied directory: a missing root is empty and a symlinked root is never followed. */
function isReadableDirectory(directory: string): boolean {
  return !pathDenied(directory) && existsSync(directory) && !lstatSync(directory).isSymbolicLink();
}

/** Every wanted file under `directory`, with an `undefined` after each entry so a caller can yield between them. */
function* walk(directory: string, scan: Scan): Generator<string | undefined> {
  if (!isReadableDirectory(directory) || scan.feed.ancestors?.some(path => !isReadableDirectory(path))) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    yield undefined;
    yield* visit(join(directory, entry.name), entry, scan);
  }
}

function* visit(path: string, entry: Dirent, scan: Scan): Generator<string | undefined> {
  if (pathDenied(path) || entry.isSymbolicLink()) return;
  if (entry.isDirectory() && scan.feed.recursive !== false) yield* walk(path, scan);
  else if (entry.isFile() && wanted(path, scan)) yield path;
}

function wanted(path: string, { feed, since }: Scan): boolean {
  if (!path.endsWith(feed.extension) || feed.name?.test(basename(path)) === false) return false;
  return inWindow(path, feed.window ?? 'mtime', since);
}

function inWindow(path: string, window: NonNullable<Feed['window']>, since: number): boolean {
  if (window === 'none') return true;
  if (window === 'mtime') return statSync(path).mtimeMs >= since;
  const named = Date.parse(basename(path).slice(0, 10));
  return Number.isNaN(named) || named >= Math.floor(since / day) * day - day;
}
