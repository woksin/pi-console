import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { contextMapper, issueMapper, laneMapper, laneStatusMapper, memoryEventMapper, memoryJournalMapper, orchMapper, phaseMapper, questionMapper, rosterMapper, type Mapper } from '@pi-console/adapters';
import { laneStatusJson } from './lane-status.ts';
import type { SourceId } from './source-ids.ts';

/** One directory family of a source: how its files are read and which mapper understands them. */
export interface Feed {
  mapper: Mapper;
  /** `tail`: append-only JSONL read through a `FileTailer`; `snapshot`: whole-file JSON re-read when its content changes. */
  kind: 'tail' | 'snapshot';
  /** Allow-listed directories. Every file read is scoped to them; nothing else is ever opened. */
  directories: readonly string[];
  /** Directories below the resolved configured root, validated before following any feed. */
  ancestors?: readonly string[];
  /** File name suffix, for example `.json`. */
  extension: string;
  /** Descend into subdirectories (default true); `false` reads only the files directly inside `directories`. */
  recursive?: boolean;
  /** Turns a non-JSON file into the JSON line its mapper reads (snapshot feeds only). */
  decode?: (bytes: Buffer, path: string) => string;
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

export interface SourceRoots {
  agentRoot: string;
  orchRoot: string;
  /** The lanes root with `lanes.json` and `.state/roster`; it lives wherever `LANES_DIR` points, so it is optional. */
  lanesRoot?: string;
  /** The lane status directory with one `<LANE>.status` file per lane. */
  laneStatusDir: string;
}

/**
 * Where each source lives, resolving configured roots once (docs/architecture.md, adapters README), in the order
 * they start: smallest first, the large ledger last. Phase ledger rows live under pi-phase's state directory. Lane
 * status files are one prose line each: a snapshot feed with a decoder (adapters README S4). The lanes root feeds the
 * roster first (a true start time), then `lanes.json`. Context
 * `status/` and `turns*.jsonl` feed no fact and are never read; issue-work reads only `registry.jsonl`.
 * Intent memory reads only `events.jsonl` (state: never windowed, read from byte 0) and `journal/*.jsonl` (metadata only);
 * `answers/`, `blobs/` and the prune cursor are never opened.
 */
export function sourceTable({ agentRoot, orchRoot, lanesRoot, laneStatusDir }: SourceRoots): SourceSpec[] {
  agentRoot = resolveRoot(agentRoot);
  orchRoot = resolveRoot(orchRoot);
  lanesRoot = lanesRoot === undefined ? undefined : resolveRoot(lanesRoot);
  laneStatusDir = resolveRoot(laneStatusDir);
  const scope = (directory: string[]) => ({ directories: [join(...directory)], ancestors: directory.slice(1).map((_, index) => join(...directory.slice(0, index + 2))) });
  const snapshot = (mapper: Mapper, recursive: boolean, ...directory: string[]): Feed => ({ mapper, kind: 'snapshot', extension: '.json', ...scope(directory), recursive, window: 'none' });
  const tail = (mapper: Mapper, name: RegExp, extra: Partial<Feed>, ...directory: string[]): Feed => ({ mapper, kind: 'tail', extension: '.jsonl', ...scope(directory), recursive: false, name, ...extra });
  const lanes = lanesRoot === undefined ? [] : [snapshot(rosterMapper, false, lanesRoot, '.state', 'roster'), { ...snapshot(laneMapper, false, lanesRoot), name: /^lanes\.json$/ }];
  const status: Feed = { mapper: laneStatusMapper, kind: 'snapshot', extension: '.status', directories: [laneStatusDir], recursive: false, window: 'none', decode: laneStatusJson };
  return [
    { id: 'question-store', feeds: [snapshot(questionMapper, true, agentRoot, 'user-questions', 'items')] },
    { id: 'lane-messages', feeds: [snapshot(orchMapper, true, orchRoot, 'inbox'), ...lanes, status] },
    { id: 'lane-heartbeats', feeds: [snapshot(orchMapper, false, orchRoot, 'heartbeats')] },
    { id: 'context-budget', feeds: [tail(contextMapper, /^events(-[0-9TZ]+)?\.jsonl$/, { seekBy: 'at', lineFilter: '"handoff_committed"' }, agentRoot, 'context-budget')] },
    { id: 'issue-work', feeds: [tail(issueMapper, /^registry\.jsonl$/, { seekBy: 'ts' }, agentRoot, 'issue-work')] },
    { id: 'intent-memory', feeds: [
      tail(memoryEventMapper, /^events\.jsonl$/, { window: 'none' }, agentRoot, 'memory'),
      tail(memoryJournalMapper, /^[A-Za-z0-9_-]{1,200}\.jsonl$/, {}, agentRoot, 'memory', 'journal'),
    ] },
    { id: 'phase-ledger', feeds: [tail(phaseMapper, /^\d{4}-\d{2}-\d{2}\.jsonl$/, { window: 'name-date', filterBy: 'queuedAt' }, agentRoot, 'pi-phase', 'state', 'ledger')] },
  ];
}

/** Configured roots may be symlinks; pin their targets without preventing a missing store from appearing later. */
function resolveRoot(root: string): string {
  try { return realpathSync(root); } catch { return root; }
}
