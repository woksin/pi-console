import { useEffect } from 'react';
import type { ConsoleStore } from '../client/store.ts';
import type { ConsoleState } from '../state/state.ts';

/** One reconciliation decides whether this render opens, keeps or gap-refreshes the reader generation. */
export function useSessionTranscript(store: ConsoleStore, id: string, entry: string | null, state: Pick<ConsoleState, 'snapshotLoaded' | 'gapCount'>): void {
  useEffect(() => {
    void store.transcriptReader.reconcile({ sessionId: id, focus: entry, snapshotLoaded: state.snapshotLoaded, gapCount: state.gapCount });
  }, [store, id, entry, state.snapshotLoaded, state.gapCount]);
  // Disposal owns the route lifetime only; a gap or focus change never closes a generation before reconciliation.
  useEffect(() => () => { store.closeTranscript(id); }, [store, id]);
}
