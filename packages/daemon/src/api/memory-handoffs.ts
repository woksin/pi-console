import { realpathSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { MemoryHandoff } from '@pi-console/contract';
import { openSource, pathDenied } from '@pi-console/adapters';

/** A session's handoff reset, as the projection knows it: `id` is the handoff file path the producer committed. */
export interface HandoffReset { id: string; at: string }

/**
 * Seam for the memory figures the producer wrote into handoff files. Read on demand, never ingested: the handoff
 * paths are in arbitrary repositories, and a handoff is never returned as text, only a few integers.
 */
export interface MemoryHandoffReader {
  /** The newest handoffs first, at most `limit`; resets whose file cannot be read safely yield null figures. */
  read(resets: readonly HandoffReset[], limit: number): MemoryHandoff[] | Promise<MemoryHandoff[]>;
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

/** Bounded bytes from the validated handle, including a sentinel byte for growth past the cap. */
async function readPrefix(handle: FileHandle, size: number): Promise<string | undefined> {
  if (size > maxBytes) return undefined;
  const buffer = Buffer.alloc(maxBytes + 1);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  return bytesRead > maxBytes ? undefined : buffer.subarray(0, bytesRead).toString('utf8');
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

  async read(resets: readonly HandoffReset[], limit: number): Promise<MemoryHandoff[]> {
    const newest = resets.filter(reset => acceptable(reset.id)).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, limit);
    return Promise.all(newest.map(async reset => ({ handoffId: basename(reset.id), at: reset.at, ...await this.#figures(reset.id) })));
  }

  async #figures(path: string): Promise<ReturnType<typeof parseHandoff>> {
    try {
      const root = realpathSync(dirname(dirname(dirname(path))));
      const { handle } = await openSource(join(root, '.ai-work/handoffs', basename(path)), [root]);
      try {
        return await this.#openedFigures(path, handle);
      } finally {
        await handle.close();
      }
    } catch {
      return empty;
    }
  }

  async #openedFigures(path: string, handle: FileHandle): Promise<ReturnType<typeof parseHandoff>> {
    const stat = await handle.stat();
    if (stat.size > maxBytes) return empty;
    const cached = this.#cache.get(path);
    if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.figures;
    const text = await readPrefix(handle, stat.size);
    if (text === undefined) return empty;
    const figures = parseHandoff(text);
    this.#cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, figures });
    return figures;
  }
}
