import type { Transcript, TranscriptEntry } from '@pi-console/contract';

export const transcriptRetention = 2500;
export type TranscriptLoad = 'tail' | 'older' | 'newer' | 'around';
export interface TranscriptProgress {
  older: boolean; newer: boolean; revision: number; observedTail: number;
  loading?: TranscriptLoad; error?: TranscriptLoad; lastPage?: TranscriptLoad; focusEntry?: string;
}
export const emptyProgress: TranscriptProgress = { older: false, newer: false, revision: 0, observedTail: 0 };

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
  // Keep arrivals newer than the captured tail, never a previously browsed window.
  const newest = Math.max(0, ...page.items.map(entry => entry.cursor));
  return current.filter(entry => entry.cursor > newest);
}

function windowEdges(progress: TranscriptProgress, page: Transcript, direction: TranscriptLoad, window: { total: number; entries: readonly TranscriptEntry[] }): { older: boolean; newer: boolean } {
  const edges = pageEdges(progress, page, direction);
  if (window.total > transcriptRetention) {
    if (direction === 'older') edges.newer = true;
    else edges.older = true;
  }
  if (progress.observedTail > (window.entries.at(-1)?.cursor ?? 0)) edges.newer = true;
  return edges;
}

/** A contiguous, movable window: evict only the edge opposite the requested direction. */
export function transcriptPage(current: readonly TranscriptEntry[], progress: TranscriptProgress, page: Transcript, direction: TranscriptLoad): { entries: TranscriptEntry[]; progress: TranscriptProgress } {
  const previous = retainedBeforePage(current, page, direction);
  const unique = new Map([...page.items, ...previous].map(entry => [entry.id, entry]));
  const all = [...unique.values()].sort((a, b) => a.cursor - b.cursor);
  const entries = direction === 'older' ? all.slice(0, transcriptRetention) : all.slice(-transcriptRetention);
  const edges = windowEdges(progress, page, direction, { total: all.length, entries });
  return { entries, progress: { ...edges, focusEntry: direction === 'tail' ? undefined : progress.focusEntry, observedTail: progress.observedTail, revision: progress.revision + (direction === 'tail' || direction === 'around' ? 1 : 0), lastPage: direction } };
}

function deferArrival(progress: TranscriptProgress): boolean {
  return progress.newer || progress.loading === 'around' || progress.loading === 'older';
}

/** Live entries must not splice the tail into an older window or evict an in-flight page boundary. */
export function transcriptArrival(current: readonly TranscriptEntry[], progress: TranscriptProgress, entry: TranscriptEntry): { entries: TranscriptEntry[]; progress: TranscriptProgress } {
  const observedTail = Math.max(progress.observedTail, entry.cursor);
  if (deferArrival(progress)) return { entries: [...current], progress: { ...progress, observedTail, newer: true } };
  const unique = new Map([...current, entry].map(item => [item.id, item]));
  const all = [...unique.values()].sort((a, b) => a.cursor - b.cursor);
  return { entries: all.slice(-transcriptRetention), progress: { ...progress, observedTail, older: progress.older || all.length > transcriptRetention } };
}
