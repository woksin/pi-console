import { lstatSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';

const denied = new Set(['auth.json', 'credentials', 'credentials.json', 'accounts', 'profiles', 'profiles-retired', 'browser', 'google', 'chromium', 'chrome', 'firefox', 'safari', 'brave-browser']);

export function pathDenied(path: string): boolean {
  return resolve(path).split('/').some(part => denied.has(part.toLowerCase()) || part.toLowerCase().startsWith('.env'));
}

/** Check lexical and canonical paths before any source descriptor is opened. */
export function sourcePath(path: string): string {
  const canonical = checkedPath(path);
  if (!canonical.endsWith('.jsonl')) throw new Error('Source path is not JSONL');
  return canonical;
}

function checkedPath(path: string): string {
  if (pathDenied(path)) throw new Error('Source path denied');
  const canonical = realpathSync(path);
  if (pathDenied(canonical)) throw new Error('Source path denied');
  return canonical;
}

/** Snapshot and transcript readers must be explicitly scoped to source roots. */
export function sourceFile(path: string, roots: readonly string[]): string {
  const canonical = checkedPath(path);
  const allowed = roots.some(root => {
    const rel = relative(checkedPath(root), canonical);
    return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
  });
  if (!allowed) throw new Error('Source outside configured roots');
  return canonical;
}

type DiscoveryErrorHandler = (path: string, error: unknown) => void;
interface DiscoveryLocation { path: string; onError?: DiscoveryErrorHandler }

/**
 * No symlink traversal, including the root. Archives are bounded by mtime, not file size.
 * With an error handler, report each failed location and continue its siblings; otherwise errors still throw.
 */
export async function discover(directory: string, since = Date.now() - 14 * 86400_000, onError?: DiscoveryErrorHandler): Promise<string[]> {
  const paths: string[] = [];
  let visited = 0;
  for (const path of walk({ path: directory, onError }, since)) {
    if (path !== undefined) paths.push(path);
    // Include old, denied and non-JSONL entries: a mostly unchanged archive must yield too.
    if (++visited % 64 === 0) await setImmediate();
  }
  return paths.sort();
}

function* walk({ path: directory, onError }: DiscoveryLocation, since: number): Generator<string | undefined> {
  for (const entry of directoryEntries({ path: directory, onError })) {
    yield undefined;
    const location = { path: join(directory, entry.name), onError };
    if (pathDenied(location.path) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(location, since);
    else yield sessionPath(entry, location, since);
  }
}

function sessionPath(entry: Dirent, location: DiscoveryLocation, since: number): string | undefined {
  if (!entry.isFile()) return undefined;
  if (!location.path.endsWith('.jsonl')) return undefined;
  return modifiedSince(location, since) ? location.path : undefined;
}

function directoryEntries({ path: directory, onError }: DiscoveryLocation) {
  try {
    if (pathDenied(directory) || lstatSync(directory).isSymbolicLink()) return [];
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (!onError) throw error;
    onError(directory, error);
    return [];
  }
}

function modifiedSince({ path, onError }: DiscoveryLocation, since: number): boolean {
  try {
    return statSync(path).mtimeMs >= since;
  } catch (error) {
    if (!onError) throw error;
    onError(path, error);
    return false;
  }
}
