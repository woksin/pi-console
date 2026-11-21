import { join } from 'node:path';
import { contextMapper, issueMapper, laneMapper, laneStatusMapper, orchMapper, phaseMapper, questionMapper, rosterMapper, type Mapper } from '@pi-console/adapters';
import { laneStatusJson } from './lane-status.ts';
import type { SourceId } from './source-ids.ts';

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
 * Where each source lives, as a pure function of the two roots (docs/architecture.md, adapters README), in the order
 * they start: smallest first, the large ledger last. Phase ledger rows live under pi-phase's state directory. Lane
 * status files are one prose line each: a snapshot feed with a decoder (adapters README S4). The lanes root feeds the
 * roster first (a true start time), then `lanes.json`. Context
 * `status/` and `turns*.jsonl` feed no fact and are never read; issue-work reads only `registry.jsonl`.
 */
export function sourceTable({ agentRoot, orchRoot, lanesRoot, laneStatusDir }: SourceRoots): SourceSpec[] {
  const snapshot = (mapper: Mapper, recursive: boolean, ...directory: string[]): Feed => ({ mapper, kind: 'snapshot', extension: '.json', directories: [join(...directory)], recursive, window: 'none' });
  const tail = (mapper: Mapper, name: RegExp, extra: Partial<Feed>, ...directory: string[]): Feed => ({ mapper, kind: 'tail', extension: '.jsonl', directories: [join(...directory)], recursive: false, name, ...extra });
  const lanes = lanesRoot === undefined ? [] : [snapshot(rosterMapper, false, lanesRoot, '.state', 'roster'), { ...snapshot(laneMapper, false, lanesRoot), name: /^lanes\.json$/ }];
  const status: Feed = { mapper: laneStatusMapper, kind: 'snapshot', extension: '.status', directories: [laneStatusDir], recursive: false, window: 'none', decode: laneStatusJson };
  return [
    { id: 'question-store', feeds: [snapshot(questionMapper, true, agentRoot, 'user-questions', 'items')] },
    { id: 'lane-messages', feeds: [snapshot(orchMapper, true, orchRoot, 'inbox'), ...lanes, status] },
    { id: 'lane-heartbeats', feeds: [snapshot(orchMapper, false, orchRoot, 'heartbeats')] },
    { id: 'context-budget', feeds: [tail(contextMapper, /^events(-[0-9TZ]+)?\.jsonl$/, { seekBy: 'at', lineFilter: '"handoff_committed"' }, agentRoot, 'context-budget')] },
    { id: 'issue-work', feeds: [tail(issueMapper, /^registry\.jsonl$/, { seekBy: 'ts' }, agentRoot, 'issue-work')] },
    { id: 'phase-ledger', feeds: [tail(phaseMapper, /^\d{4}-\d{2}-\d{2}\.jsonl$/, { window: 'name-date', filterBy: 'queuedAt' }, agentRoot, 'pi-phase', 'state', 'ledger')] },
  ];
}

