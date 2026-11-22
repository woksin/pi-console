import { useEffect, type EffectCallback, type RefObject } from 'react';
import { resolve } from '@pi-console/viewmodels';
import { contextOf, type UiState } from './state/ui.ts';
import { pauseTranscript, resumeTranscript, transcriptWindow, type TranscriptLayout } from './state/transcript-window.ts';
import type { Data } from './store/store.ts';
import type { TranscriptLoad, TranscriptProgress } from './store/transcript-history.ts';

export type PageTranscript = (id: string, direction?: TranscriptLoad) => void;
interface WindowState { ui: UiState; data: Data; layout: TranscriptLayout; viewport: number }
interface Navigation extends WindowState { key: string; load?: PageTranscript }
type Edge = 'older' | 'newer' | 'tail';
const actionEdges: Readonly<Record<string, Edge | undefined>> = {
  'move.up': 'older', 'page.up': 'older', 'move.top': 'older',
  'move.down': 'newer', 'page.down': 'newer', 'move.bottom': 'newer',
  'follow.toggle': 'tail',
};

function progressOf({ ui, data }: WindowState): TranscriptProgress | undefined {
  if (!ui.sessionId) return undefined;
  return contextOf(ui) === 'transcript' ? data.transcriptHistory.get(ui.sessionId) : undefined;
}

function availableEdges(state: WindowState, progress: TranscriptProgress): Record<Edge, boolean> {
  const window = transcriptWindow(state.layout, state.ui, state.viewport);
  const last = state.layout.ends.at(-1) ?? 0;
  return { tail: progress.newer, older: window.start === 0 && progress.older, newer: window.end === last && progress.newer };
}

function edgeDirection(action: string, state: WindowState, progress: TranscriptProgress): Edge | undefined {
  const edge = actionEdges[action];
  if (!edge) return undefined;
  return availableEdges(state, progress)[edge] ? edge : undefined;
}

function navigationDirection(state: Navigation, progress: TranscriptProgress): TranscriptLoad | undefined {
  const action = resolve('transcript', state.key, 'tui') ?? '';
  return state.key === 'r' ? progress.error : edgeDirection(action, state, progress);
}

/** Navigation beyond a retained edge fetches one page; r retries the failed operation. */
export function transcriptNavigation(state: Navigation): UiState | undefined {
  const id = state.ui.sessionId;
  if (!id) return undefined;
  const progress = progressOf(state);
  if (!progress) return undefined;
  const direction = navigationDirection(state, progress);
  if (!direction) return undefined;
  state.load?.(id, direction);
  return state.key === 'r' ? state.ui : { ...state.ui, ...pauseTranscript(state.layout, state.ui, state.viewport) };
}

/** Live-follow cannot apply to a window that still has newer history on the daemon. */
export function keepHistorical(ui: UiState, data: Data, layout: TranscriptLayout, viewport: number): UiState {
  return ui.sessionId && ui.follow && data.transcriptHistory.get(ui.sessionId)?.newer ? { ...ui, ...pauseTranscript(layout, ui, viewport) } : ui;
}

function pageUi(ui: UiState, progress: TranscriptProgress | undefined, layout: TranscriptLayout, viewport: number): UiState {
  if (progress?.returnToLive && progress.lastPage === 'tail') return { ...ui, ...resumeTranscript };
  if (ui.anchor) return { ...ui, anchor: { ...ui.anchor, limit: layout.keys.at(-1) ?? ui.anchor.limit } };
  return progress?.newer ? { ...ui, ...pauseTranscript(layout, ui, viewport) } : ui;
}

/** Page merges retain the stable top anchor and make newly loaded newer entries navigable. */
export function useTranscriptWindow({ ref, apply, data, layout, viewport }: { ref: RefObject<UiState>; apply: (ui: UiState) => void; data: Data; layout: TranscriptLayout; viewport: number }): void {
  const id = ref.current.sessionId;
  const progress = id ? data.transcriptHistory.get(id) : undefined;
  useEffect(() => {
    if (ref.current.sessionId === id) apply(pageUi(ref.current, progress, layout, viewport));
  }, [id, progress?.revision, progress?.newer]);
}

interface Loads { loadTranscript: (id: string, entryId?: string) => ReturnType<EffectCallback>; focusTranscript?: (id: string, entryId: string) => void }
export function useTranscriptLoads(ui: UiState, loads: Loads): void {
  useEffect(() => { if (ui.sessionId) return loads.loadTranscript(ui.sessionId, ui.focusEntry ?? undefined); }, [ui.sessionId]);
  useEffect(() => { if (ui.sessionId && ui.focusEntry) loads.focusTranscript?.(ui.sessionId, ui.focusEntry); }, [ui.sessionId, ui.focusEntry]);
}
