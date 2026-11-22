import { existsSync, lstatSync, promises, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import { pathDenied } from '@pi-console/adapters';
import type { Feed } from './source-table.ts';
import { yieldToLoop } from './yield-to-loop.ts';

const day = 86_400_000;
const sliceMs = 5;

export type Scope = Pick<Feed, 'extension' | 'recursive' | 'name' | 'window' | 'ancestors'>;

/** One discovery pass: which files a feed wants and the start of its window. */
interface Scan { feed: Scope; since: number }
interface DirectoryScan extends Scan { directory: string }
interface Entry { path: string; kind: Dirent }

/**
 * Files of the feed under `directory` that are inside the window `since`. Same boundary as the adapters' `discover`:
 * deny-listed names and symlinks below the resolved configured root (the directory and its `ancestors`) are skipped. A missing directory is empty; an unreadable one
 * throws. Only `mtime` windows stat a file.
 */
export function discoverFiles(directory: string, feed: Scope, since: number): string[] {
  return [...walk({ directory, feed, since })].filter((path): path is string => path !== undefined).sort();
}

/** Read directories off-loop and yield even across empty/denied directories; slices target 5 ms. */
export async function discoverFilesSliced(directory: string, feed: Scope, since: number): Promise<string[]> {
  const files: string[] = [];
  let started = performance.now();
  for await (const path of walkAsync({ directory, feed, since })) {
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

function canEnter({ directory, feed }: DirectoryScan): boolean {
  if (!isReadableDirectory(directory)) return false;
  return feed.ancestors?.every(isReadableDirectory) ?? true;
}

/** Every wanted file under `directory`, with an `undefined` after each entry so a caller can yield between them. */
function* walk(scan: DirectoryScan): Generator<string | undefined> {
  if (!canEnter(scan)) return;
  for (const kind of readdirSync(scan.directory, { withFileTypes: true })) {
    yield undefined;
    yield* visit({ path: join(scan.directory, kind.name), kind }, scan);
  }
}

/** Directory enumeration itself can exceed a slice on a large feed, so do it on the I/O pool. */
async function* walkAsync(scan: DirectoryScan): AsyncGenerator<string | undefined> {
  if (!canEnter(scan)) return;
  for (const kind of await promises.readdir(scan.directory, { withFileTypes: true })) {
    yield undefined;
    yield* visitAsync({ path: join(scan.directory, kind.name), kind }, scan);
  }
}

function visible(entry: Entry): boolean {
  return !pathDenied(entry.path) && !entry.kind.isSymbolicLink();
}

function descends(entry: Entry, { feed }: Scan): boolean {
  return entry.kind.isDirectory() && feed.recursive !== false;
}

function matches(entry: Entry, scan: Scan): boolean {
  return entry.kind.isFile() && wanted(entry, scan);
}

function* visit(entry: Entry, scan: Scan): Generator<string | undefined> {
  if (!visible(entry)) return;
  if (descends(entry, scan)) yield* walk({ ...scan, directory: entry.path });
  else if (matches(entry, scan)) yield entry.path;
}

async function* visitAsync(entry: Entry, scan: Scan): AsyncGenerator<string | undefined> {
  if (!visible(entry)) return;
  if (descends(entry, scan)) yield* walkAsync({ ...scan, directory: entry.path });
  else if (matches(entry, scan)) yield entry.path;
}

function wanted(entry: Entry, scan: Scan): boolean {
  const { feed } = scan;
  if (!entry.path.endsWith(feed.extension) || feed.name?.test(basename(entry.path)) === false) return false;
  return inWindow(entry, scan);
}

function inWindow({ path }: Entry, { feed, since }: Scan): boolean {
  const window = feed.window ?? 'mtime';
  if (window === 'none') return true;
  if (window === 'mtime') return statSync(path).mtimeMs >= since;
  const named = Date.parse(basename(path).slice(0, 10));
  return Number.isNaN(named) || named >= Math.floor(since / day) * day - day;
}
