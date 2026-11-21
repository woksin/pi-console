import { type Stats, closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';
import type { MemoryHandoff } from '@pi-console/contract';
import { pathDenied } from '@pi-console/adapters';

/** A session's handoff reset, as the projection knows it: `id` is the handoff file path the producer committed. */
export interface HandoffReset { id: string; at: string }

/**
 * Seam for the memory figures the producer wrote into handoff files. Read on demand, never ingested: the handoff
 * paths are in arbitrary repositories, and a handoff is never returned as text, only a few integers.
 */
export interface MemoryHandoffReader {
  /** The newest handoffs first, at most `limit`; resets whose file cannot be read safely yield null figures. */
  read(resets: readonly HandoffReset[], limit: number): MemoryHandoff[];
}

export const noMemoryHandoffs: MemoryHandoffReader = { read: () => [] };

const maxBytes = 256 * 1024;
const fileName = /^[A-Za-z0-9_.-]+\.md$/;
const indexLine = /^items=(\d+) messages=(\d+) unresolved=(\d+) withheld=(\d+) proposed=(\d+) rejected=(\d+)(?: |$)/m;
const resumeLine = /active directives=(\d+); unresolved messages=(\d+); proposed items=(\d+)/;
const indexHeading = /^## Memory index\s*$/m;
const resumeHeading = /^## Memory resume check/m;
const degradedMarker = 'memory degraded: projection unavailable';

/** Absolute, not denied, `<name>.md` directly under `.ai-work/handoffs`. */
function acceptable(path: string): boolean {
  if (!isAbsolute(path) || pathDenied(path)) return false;
  const parent = dirname(path);
  const inHandoffs = basename(parent) === 'handoffs' && basename(dirname(parent)) === '.ai-work';
  return inHandoffs && fileName.test(basename(path));
}

/** A regular, small, non-symlink file whose real path is still an acceptable handoff path. */
function safeFile(path: string, stat: Stats): boolean {
  if (!stat.isFile() || stat.size > maxBytes) return false;
  return acceptable(realpathSync(path));
}

/** The first `maxBytes` of a regular, non-symlink file; undefined for anything else or on any failure. */
function readPrefix(path: string): string | undefined {
  try {
    const stat = lstatSync(path);
    if (!safeFile(path, stat)) return undefined;
    const descriptor = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
      const read = readSync(descriptor, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, read).toString('utf8');
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return undefined;
  }
}

const numbers = (match: RegExpExecArray | null): number[] | null => match ? match.slice(1).map(Number) : null;

/** Only the integer fields; every other byte of the file is dropped here. */
export function parseHandoff(text: string): Pick<MemoryHandoff, 'memoryIndex' | 'resumeCheck' | 'degraded'> {
  const section = (heading: RegExp) => { const at = text.search(heading); return at < 0 ? '' : text.slice(at, at + 1024); };
  const index = numbers(indexLine.exec(section(indexHeading).replaceAll('"', '')));
  const resume = numbers(resumeLine.exec(section(resumeHeading).replaceAll('"', '')));
  return {
    degraded: text.includes(degradedMarker),
    memoryIndex: index && { items: index[0], messages: index[1], unresolved: index[2], withheld: index[3], proposed: index[4], rejected: index[5] },
    resumeCheck: resume && { activeDirectives: resume[0], unresolvedMessages: resume[1], proposedItems: resume[2] },
  };
}

interface Cached { mtimeMs: number; size: number; figures: ReturnType<typeof parseHandoff> }
const empty = { degraded: false, memoryIndex: null, resumeCheck: null } as const;

/** Reads handoff files under the safety rules above, cached by `(path, mtimeMs, size)`. Never throws and never logs. */
export class FileMemoryHandoffs implements MemoryHandoffReader {
  readonly #cache = new Map<string, Cached>();

  read(resets: readonly HandoffReset[], limit: number): MemoryHandoff[] {
    return resets.filter(reset => acceptable(reset.id)).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, limit)
      .map(reset => ({ handoffId: basename(reset.id), at: reset.at, ...this.#figures(reset.id) }));
  }

  #figures(path: string): ReturnType<typeof parseHandoff> {
    try {
      const stat = lstatSync(path);
      const cached = this.#cache.get(path);
      if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.figures;
      const text = readPrefix(path);
      if (text === undefined) return empty;
      const figures = parseHandoff(text);
      this.#cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, figures });
      return figures;
    } catch {
      return empty;
    }
  }
}
