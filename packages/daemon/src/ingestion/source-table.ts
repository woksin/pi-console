import { join } from 'node:path';
import { contextMapper, issueMapper, laneMapper, laneStatusMapper, memoryEventMapper, memoryJournalMapper, orchMapper, phaseMapper, questionMapper, questionMapperVersion, rosterMapper, type Mapper } from '@pi-console/adapters';
import { laneStatusJson } from './lane-status.ts';
import type { SourceId } from './source-ids.ts';
import { SourceRoot } from './source-root.ts';

/** One directory family of a source: how its files are read and which mapper understands them. */
export interface Feed {
  mapper: Mapper;
  /** `tail`: append-only JSONL read through a `FileTailer`; `snapshot`: whole-file JSON re-read when its content changes. */
  kind: 'tail' | 'snapshot';
  /** Allow-listed directories. Every file read is scoped to them; nothing else is ever opened. */
  directories: readonly string[];
  /** Canonical configured root; pins the boundary while individual files are opened. */
  trustRoot?: string;
  /** Directories below the resolved configured root, validated before following any feed. */
  ancestors?: readonly string[];
  /** Resolve trusted configuration before each poll; an unresolved root makes the feed unavailable. */
  resolveScope?: () => Pick<Feed, 'directories' | 'trustRoot' | 'ancestors'> | undefined;
  /** File name suffix, for example `.json`. */
  extension: string;
  /** Descend into subdirectories (default true); `false` reads only the files directly inside `directories`. */
  recursive?: boolean;
  /** Turns a non-JSON file into the JSON line its mapper reads (snapshot feeds only). */
  decode?: (bytes: Buffer, path: string) => string;
  /** Snapshot feeds only: namespaces checkpoints so an updated mapper rereads unchanged files once. */
  mapperVersion?: string;
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
 * Where each source lives, resolving configured roots before each poll (docs/architecture.md, adapters README), in the order
 * they start: smallest first, the large ledger last. Phase ledger rows live under pi-phase's state directory. Lane
 * status files are one prose line each: a snapshot feed with a decoder (adapters README S4). The lanes root feeds the
 * roster first (a true start time), then `lanes.json`. Context
 * `status/` and `turns*.jsonl` feed no fact and are never read; issue-work reads only `registry.jsonl`.
 * Intent memory reads only `events.jsonl` (state: never windowed, read from byte 0) and `journal/*.jsonl` (metadata only);
 * `answers/`, `blobs/` and the prune cursor are never opened.
 */
export function sourceTable({ agentRoot, orchRoot, lanesRoot, laneStatusDir }: SourceRoots): SourceSpec[] {
  const agent = new SourceRoot(agentRoot);
  const orch = new SourceRoot(orchRoot);
  const lanesRootScope = lanesRoot === undefined ? undefined : new SourceRoot(lanesRoot);
  const statusRoot = new SourceRoot(laneStatusDir);
  const snapshot = (mapper: Mapper, recursive: boolean, ...directory: [SourceRoot, ...string[]]): Feed => ({ mapper, kind: 'snapshot', extension: '.json', ...scope(directory), recursive, window: 'none' });
  const tail = (mapper: Mapper, name: RegExp, extra: Partial<Feed>, ...directory: [SourceRoot, ...string[]]): Feed => ({ mapper, kind: 'tail', extension: '.jsonl', ...scope(directory), recursive: false, name, ...extra });
  const lanes = lanesRootScope === undefined ? [] : [snapshot(rosterMapper, false, lanesRootScope, '.state', 'roster'), { ...snapshot(laneMapper, false, lanesRootScope), name: /^lanes\.json$/ }];
  const status: Feed = { mapper: laneStatusMapper, kind: 'snapshot', extension: '.status', ...scope([statusRoot]), recursive: false, window: 'none', decode: laneStatusJson };
  return [
    { id: 'question-store', feeds: [{ ...snapshot(questionMapper, true, agent, 'user-questions', 'items'), mapperVersion: questionMapperVersion }] },
    { id: 'lane-messages', feeds: [snapshot(orchMapper, true, orch, 'inbox'), ...lanes, status] },
    { id: 'lane-heartbeats', feeds: [snapshot(orchMapper, false, orch, 'heartbeats')] },
    { id: 'context-budget', feeds: [tail(contextMapper, /^events(-[0-9TZ]+)?\.jsonl$/, { seekBy: 'at', lineFilter: '"handoff_committed"' }, agent, 'context-budget')] },
    { id: 'issue-work', feeds: [tail(issueMapper, /^registry\.jsonl$/, { seekBy: 'ts' }, agent, 'issue-work')] },
    { id: 'intent-memory', feeds: [
      tail(memoryEventMapper, /^events\.jsonl$/, { window: 'none' }, agent, 'memory'),
      tail(memoryJournalMapper, /^[A-Za-z0-9_-]{1,200}\.jsonl$/, {}, agent, 'memory', 'journal'),
    ] },
    { id: 'phase-ledger', feeds: [tail(phaseMapper, /^\d{4}-\d{2}-\d{2}\.jsonl$/, { window: 'name-date', filterBy: 'queuedAt' }, agent, 'pi-phase', 'state', 'ledger')] },
  ];
}

/** Capture one canonical scope per poll; only the configured path may contain trusted aliases. */
function scope([root, ...parts]: [SourceRoot, ...string[]]): Pick<Feed, 'directories' | 'trustRoot' | 'ancestors' | 'resolveScope'> {
  const at = (path: string) => ({ directories: [join(path, ...parts)], trustRoot: path, ancestors: parts.map((_, index) => join(path, ...parts.slice(0, index + 1))) });
  return {
    ...at(root.path),
    resolveScope: () => {
      const path = root.available();
      return path === undefined ? undefined : at(path);
    },
  };
}
