import type { Transcript, TranscriptEntry } from '@pi-console/contract';

export const TRANSCRIPT_LIMIT = 2500;
export type TranscriptLoad = 'tail' | 'older' | 'newer' | 'around';
export interface TranscriptProgress {
  older: boolean; newer: boolean; revision: number;
  loading?: TranscriptLoad; error?: TranscriptLoad; lastPage?: TranscriptLoad; returnToLive?: boolean; observedTail?: number;
}
export const emptyProgress: TranscriptProgress = { older: false, newer: false, revision: 0 };

/** A page shifts a bounded window; only the edge opposite the requested direction is evicted. */
export function transcriptPage(current: readonly TranscriptEntry[], progress: TranscriptProgress, page: Transcript, direction: TranscriptLoad): { entries: TranscriptEntry[]; progress: TranscriptProgress } {
  const previous = retainedBeforePage(current, page, direction);
  const unique = new Map([...page.items, ...previous].map(entry => [entry.id, entry]));
  const all = [...unique.values()].sort((a, b) => a.cursor - b.cursor);
  const dropped = all.length > TRANSCRIPT_LIMIT;
  const entries = direction === 'older' ? all.slice(0, TRANSCRIPT_LIMIT) : all.slice(-TRANSCRIPT_LIMIT);
  const edges = pageEdges(progress, page, direction);
  if (dropped) {
    if (direction === 'older') edges.newer = true;
    else edges.older = true;
  }
  const observedTail = progress.observedTail ?? 0;
  if (observedTail > (entries.at(-1)?.cursor ?? 0)) edges.newer = true;
  return { entries, progress: { ...edges, revision: progress.revision + 1, lastPage: direction, observedTail, returnToLive: edges.newer ? false : progress.returnToLive } };
}

function pageEdges(progress: TranscriptProgress, page: Transcript, direction: TranscriptLoad): { older: boolean; newer: boolean } {
  switch (direction) {
    case 'tail': return { older: page.hasMore, newer: false };
    case 'around': return { older: page.hasOlder === true, newer: page.hasMore };
    case 'older': return { older: page.hasMore, newer: progress.newer };
    case 'newer': return { older: progress.older, newer: page.hasMore };
  }
}

function retainedBeforePage(current: readonly TranscriptEntry[], page: Transcript, direction: TranscriptLoad): readonly TranscriptEntry[] {
  if (direction === 'around') return [];
  if (direction !== 'tail') return current;
  // Preserve live arrivals newer than the captured tail, not a previously browsed window.
  const newest = Math.max(0, ...page.items.map(entry => entry.cursor));
  return current.filter(entry => entry.cursor > newest);
}
