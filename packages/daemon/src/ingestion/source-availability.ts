import fs, { lstatSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DaemonConfig } from '../config.ts';
import { sourceTable } from './source-table.ts';
import type { SourceId } from './source-ids.ts';

/** Whether a configured directory can be read: `disabled` means nothing reads it, so it is never expected to exist. */
export type Availability = 'available' | 'missing' | 'unavailable' | 'disabled';

/** The agent directory, or the id of the source that reads the directory. */
export type DirectoryOwner = 'agent-root' | 'session-jsonl' | SourceId;

/** Internal only (startup output): carries the absolute path, which the HTTP API never does. */
export interface DirectoryDiagnostic { owner: DirectoryOwner; path: string; state: Availability }

export type AvailabilityConfig = DaemonConfig & { ingest?: boolean };

const rank: Record<Availability, number> = { available: 0, disabled: 0, unavailable: 1, missing: 2 };

/** A directory is only usable when it can be listed and traversed. Any failure is reported as the state alone, never the error. */
function readable(path: string): Availability {
  try {
    fs.accessSync(path, fs.constants.R_OK | fs.constants.X_OK);
    return 'available';
  } catch {
    return 'unavailable';
  }
}

/** Metadata and permission bits only, never contents. A missing entry is `missing`; any other failure, a non-directory or an unreadable directory is `unavailable`. */
function probe(path: string, lookup: typeof statSync | typeof lstatSync): Availability {
  try {
    return lookup(path).isDirectory() ? readable(path) : 'unavailable';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable';
  }
}

/** Every directory of a feed chain below the trusted root must be a real directory: descendant symlinks are never followed. */
function probeFeed(directory: string, scope: { directories: readonly string[]; trustRoot?: string; ancestors?: readonly string[] } | undefined): Availability {
  if (scope === undefined) return probe(directory, statSync);
  const chain = [scope.trustRoot, ...(scope.ancestors ?? []), ...scope.directories].filter((path): path is string => path !== undefined);
  for (const path of chain) {
    const state = probe(path, lstatSync);
    if (state !== 'available') return state;
  }
  return 'available';
}

/** Fresh read-only probe of the agent root and every configured source directory, in stable order. Creates nothing and caches nothing. */
export function directoryDiagnostics(config: AvailabilityConfig): DirectoryDiagnostic[] {
  const ingesting = config.ingest !== false;
  const state = (enabled: boolean, check: () => Availability): Availability => (enabled ? check() : 'disabled');
  const result: DirectoryDiagnostic[] = [{ owner: 'agent-root', path: resolve(config.agentRoot), state: state(ingesting, () => probe(config.agentRoot, statSync)) }];
  for (const root of config.sessionRoots) result.push({ owner: 'session-jsonl', path: resolve(root), state: state(ingesting, () => probe(root, statSync)) });
  for (const spec of sourceTable(config)) {
    const seen = new Set<string>();
    for (const feed of spec.feeds) {
      const directory = feed.directories[0];
      if (seen.has(directory)) continue;
      seen.add(directory);
      result.push({ owner: spec.id, path: directory, state: state(ingesting && config.sources[spec.id], () => probeFeed(directory, feed.resolveScope?.())) });
    }
  }
  return result;
}

/** Path-free summary per owner: any `missing` wins, then any `unavailable`. */
export function summarizeAvailability(diagnostics: readonly DirectoryDiagnostic[]): Map<DirectoryOwner, Availability> {
  const summary = new Map<DirectoryOwner, Availability>();
  for (const { owner, state } of diagnostics) {
    const known = summary.get(owner);
    if (known === undefined || rank[state] > rank[known]) summary.set(owner, state);
  }
  return summary;
}

export const isProblem = (state: Availability): boolean => state === 'missing' || state === 'unavailable';
