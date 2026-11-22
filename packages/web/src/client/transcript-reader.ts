export interface ReaderView {
  sessionId: string; focus: string | null; snapshotLoaded: boolean; gapCount: number;
}
export interface ReaderGeneration {
  id: number; sessionId: string; focus: string | null; gapCount: number;
}
export type ReaderTransition = { action: 'wait' } | { action: 'open' | 'refresh' | 'keep'; reader: ReaderGeneration };

function sameReader(reader: ReaderGeneration | undefined, view: ReaderView): reader is ReaderGeneration {
  return reader?.sessionId === view.sessionId && reader.focus === view.focus;
}

/** One render chooses one action. Opening always wins over a simultaneous gap. */
export function readerTransition(reader: ReaderGeneration | undefined, view: ReaderView, nextId: number): ReaderTransition {
  if (!view.snapshotLoaded) return { action: 'wait' };
  if (!sameReader(reader, view)) return { action: 'open', reader: { id: nextId, sessionId: view.sessionId, focus: view.focus, gapCount: view.gapCount } };
  return { action: reader.gapCount === view.gapCount ? 'keep' : 'refresh', reader: { ...reader, gapCount: view.gapCount } };
}
