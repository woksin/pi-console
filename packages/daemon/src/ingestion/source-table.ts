import { existsSync, lstatSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { contextMapper, issueMapper, laneMapper, orchMapper, pathDenied, phaseMapper, questionMapper, type Mapper } from '@pi-console/adapters';
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
}

export interface SourceSpec { id: SourceId; feeds: readonly Feed[] }

export interface SourceRoots { agentRoot: string; orchRoot: string }

/**
 * Where each source lives, as a pure function of the two roots (docs/architecture.md, adapters README).
 * Phase ledger rows live under pi-phase's state directory. Lane status files are prose, not JSON, so they are not a
 * feed (adapters README S4); the lane registry is.
 */
export function sourceTable({ agentRoot, orchRoot }: SourceRoots): SourceSpec[] {
  const feed = (mapper: Mapper, kind: Feed['kind'], extension: string, ...directory: string[]): Feed => ({ mapper, kind, extension, directories: [join(...directory)] });
  const context = join(agentRoot, 'context-budget');
  return [
    { id: 'context-budget', feeds: [feed(contextMapper, 'tail', '.jsonl', context), feed(contextMapper, 'snapshot', '.json', context, 'status')] },
    { id: 'lane-messages', feeds: [feed(orchMapper, 'snapshot', '.json', orchRoot, 'inbox'), feed(laneMapper, 'snapshot', '.json', agentRoot, 'lanes')] },
    { id: 'lane-heartbeats', feeds: [feed(orchMapper, 'snapshot', '.json', orchRoot, 'heartbeats')] },
    { id: 'question-store', feeds: [feed(questionMapper, 'snapshot', '.json', agentRoot, 'user-questions', 'items')] },
    { id: 'issue-work', feeds: [feed(issueMapper, 'tail', '.jsonl', agentRoot, 'issue-work')] },
    { id: 'phase-ledger', feeds: [feed(phaseMapper, 'tail', '.jsonl', agentRoot, 'pi-phase', 'state', 'ledger')] },
  ];
}

/**
 * Files with `extension` under `directory`, newer than `since`. Same boundary as the adapters' `discover`: deny-listed
 * names and symlinks (including the root) are skipped. A missing directory is empty; an unreadable one throws.
 */
export function discoverFiles(directory: string, extension: string, since: number): string[] {
  if (!isReadableDirectory(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => filesOf(join(directory, entry.name), entry, extension, since)).sort();
}

/** A real, existing, non-denied directory: a missing root is empty and a symlinked root is never followed. */
function isReadableDirectory(directory: string): boolean {
  return !pathDenied(directory) && existsSync(directory) && !lstatSync(directory).isSymbolicLink();
}

function filesOf(path: string, entry: Dirent, extension: string, since: number): string[] {
  if (pathDenied(path) || entry.isSymbolicLink()) return [];
  if (entry.isDirectory()) return discoverFiles(path, extension, since);
  return entry.isFile() && path.endsWith(extension) && statSync(path).mtimeMs >= since ? [path] : [];
}
