import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

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
export function discover(directory: string, since = Date.now() - 14 * 86400_000, onError?: DiscoveryErrorHandler): string[] {
  const paths: string[] = [];
  for (const entry of directoryEntries({ path: directory, onError })) {
    const path = join(directory, entry.name);
    if (pathDenied(path) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) paths.push(...discover(path, since, onError));
    if (entry.isFile() && path.endsWith('.jsonl') && modifiedSince({ path, onError }, since)) paths.push(path);
  }
  return paths.sort();
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
