import { existsSync, lstatSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import { contextMapper, issueMapper, laneMapper, orchMapper, pathDenied, phaseMapper, questionMapper, type Mapper } from '@pi-console/adapters';
import type { SourceId } from './source-ids.ts';

const day = 86_400_000;

/** One directory family of a source: how its files are read and which mapper understands them. */
export interface Feed {
  mapper: Mapper;
  /** `tail`: append-only JSONL read through a `FileTailer`; `snapshot`: whole-file JSON re-read when its content changes. */
  kind: 'tail' | 'snapshot';
  /** Allow-listed directories. Every file read is scoped to them; nothing else is ever opened. */
  directories: readonly string[];
  /** File name suffix, for example `.json`. */
  extension: string;
  /** Descend into subdirectories (default true); `false` reads only the files directly inside `directories`. */
  recursive?: boolean;
  /** Only files whose base name matches. */
  name?: RegExp;
  /**
   * Which files are old enough to skip unopened: `mtime` (default) older than the backfill window, `name-date` a leading
   * `YYYY-MM-DD` more than a day before the window (UTC slack), `none` never (current-state snapshots).
   */
  window?: 'mtime' | 'name-date' | 'none';
  /** In-record timestamp key of rows that are in time order: a fresh file is read from the first row in the window. */
  seekBy?: string;
  /** In-record timestamp key of rows in no particular order: rows older than the window are skipped. */
  filterBy?: string;
  /** Only lines containing this text are parsed; every other line is consumed unmapped. */
  lineFilter?: string;
}

export interface SourceSpec { id: SourceId; feeds: readonly Feed[] }

export interface SourceRoots { agentRoot: string; orchRoot: string }

/**
 * Where each source lives, as a pure function of the two roots (docs/architecture.md, adapters README), in the order
 * they start: smallest first, the large ledger last. Phase ledger rows live under pi-phase's state directory. Lane
 * status files are prose, not JSON, so they are not a feed (adapters README S4); the lane registry is. Context
 * `status/` and `turns*.jsonl` feed no fact and are never read; issue-work reads only `registry.jsonl`.
 */
export function sourceTable({ agentRoot, orchRoot }: SourceRoots): SourceSpec[] {
  const snapshot = (mapper: Mapper, recursive: boolean, ...directory: string[]): Feed => ({ mapper, kind: 'snapshot', extension: '.json', directories: [join(...directory)], recursive, window: 'none' });
  const tail = (mapper: Mapper, name: RegExp, extra: Partial<Feed>, ...directory: string[]): Feed => ({ mapper, kind: 'tail', extension: '.jsonl', directories: [join(...directory)], recursive: false, name, ...extra });
  return [
    { id: 'question-store', feeds: [snapshot(questionMapper, true, agentRoot, 'user-questions', 'items')] },
    { id: 'lane-messages', feeds: [snapshot(orchMapper, true, orchRoot, 'inbox'), snapshot(laneMapper, false, agentRoot, 'lanes')] },
    { id: 'lane-heartbeats', feeds: [snapshot(orchMapper, false, orchRoot, 'heartbeats')] },
    { id: 'context-budget', feeds: [tail(contextMapper, /^events(-[0-9TZ]+)?\.jsonl$/, { seekBy: 'at', lineFilter: '"handoff_committed"' }, agentRoot, 'context-budget')] },
    { id: 'issue-work', feeds: [tail(issueMapper, /^registry\.jsonl$/, { seekBy: 'ts' }, agentRoot, 'issue-work')] },
    { id: 'phase-ledger', feeds: [tail(phaseMapper, /^\d{4}-\d{2}-\d{2}\.jsonl$/, { window: 'name-date', filterBy: 'queuedAt' }, agentRoot, 'pi-phase', 'state', 'ledger')] },
  ];
}

type Scope = Pick<Feed, 'extension' | 'recursive' | 'name' | 'window'>;

/**
 * Files of the feed under `directory` that are inside the window `since`. Same boundary as the adapters' `discover`:
 * deny-listed names and symlinks (including the root) are skipped. A missing directory is empty; an unreadable one
 * throws. Only `mtime` windows stat a file.
 */
export function discoverFiles(directory: string, feed: Scope, since: number): string[] {
  if (!isReadableDirectory(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => filesOf(join(directory, entry.name), entry, feed, since)).sort();
}

/** A real, existing, non-denied directory: a missing root is empty and a symlinked root is never followed. */
function isReadableDirectory(directory: string): boolean {
  return !pathDenied(directory) && existsSync(directory) && !lstatSync(directory).isSymbolicLink();
}

function filesOf(path: string, entry: Dirent, feed: Scope, since: number): string[] {
  if (pathDenied(path) || entry.isSymbolicLink()) return [];
  if (entry.isDirectory()) return feed.recursive === false ? [] : discoverFiles(path, feed, since);
  return entry.isFile() && wanted(path, feed, since) ? [path] : [];
}

function wanted(path: string, feed: Scope, since: number): boolean {
  if (!path.endsWith(feed.extension) || feed.name?.test(basename(path)) === false) return false;
  return inWindow(path, feed.window ?? 'mtime', since);
}

function inWindow(path: string, window: NonNullable<Feed['window']>, since: number): boolean {
  if (window === 'none') return true;
  if (window === 'mtime') return statSync(path).mtimeMs >= since;
  const named = Date.parse(basename(path).slice(0, 10));
  return Number.isNaN(named) || named >= Math.floor(since / day) * day - day;
}
