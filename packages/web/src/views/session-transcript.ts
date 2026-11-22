import { useEffect, useRef } from 'react';
import type { ConsoleStore } from '../client/store.ts';
import type { ConsoleState } from '../state/state.ts';

function useGapRefresh(store: ConsoleStore, id: string, gapCount: number): void {
  const previous = useRef({ id, gapCount });
  useEffect(() => {
    const before = previous.current;
    previous.current = { id, gapCount };
    if (before.id === id && before.gapCount !== gapCount) void store.transcriptReader.refresh({ sessionId: id });
  }, [store, id, gapCount]);
}

/** Opening a route replaces the window; a gap refresh preserves the mounted reader and its anchor. */
export function useSessionTranscript(store: ConsoleStore, id: string, entry: string | null, state: Pick<ConsoleState, 'snapshotLoaded' | 'gapCount'>): void {
  useEffect(() => {
    if (!state.snapshotLoaded) return;
    void store.loadTranscript(id, entry);
    return () => { store.closeTranscript(id); };
  }, [store, id, entry, state.snapshotLoaded]);
  useGapRefresh(store, id, state.gapCount);
}
