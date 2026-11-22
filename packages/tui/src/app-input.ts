import { resolve, type WindowedCollection } from '@pi-console/viewmodels';
import { contextOf, questionDetailShown, type Section, type UiState } from './state/ui.ts';
import type { Data } from './store/store.ts';

export { memoryInput, type RequestMemoryAction } from './memory-input.ts';

const listCollection: Partial<Record<Section, WindowedCollection>> = { fleet: 'sessions', requests: 'requests', questions: 'questions', messages: 'messages', work: 'jobs', timeline: 'resets' };

/** The list to fetch older history for: only when a list section is open at its last row, never inside a session. */
export const collectionToLoad = (ui: Pick<UiState, 'section' | 'sessionId'>, atEnd: boolean): WindowedCollection | undefined =>
  ui.sessionId || !atEnd ? undefined : listCollection[ui.section];

/** The current list's failed history page; overlays and detail panes keep their own input. */
export function historyError(data: Data, ui: UiState): WindowedCollection | undefined {
  if (ui.overlay !== 'none' || questionDetailShown(ui)) return undefined;
  const collection = collectionToLoad(ui, true);
  return collection && data.history[collection]?.error ? collection : undefined;
}

const forwardNavigation = new Set(['move.down', 'page.down', 'move.bottom']);

/** Retry explicitly with r, or when forward navigation is clamped at the last loaded row. */
export function retryHistory(input: { ui: UiState; data: Data; key: string; length: number; loadMore?: (collection: WindowedCollection) => void }): void {
  const { ui, data, key, length, loadMore } = input;
  const collection = historyError(data, ui);
  if (!collection) return;
  const action = resolve(contextOf(ui), key, 'tui');
  const atEnd = ui.cursor[ui.section] >= length - 1;
  const forwardAtEnd = atEnd && forwardNavigation.has(action ?? '');
  if (key === 'r' || forwardAtEnd) loadMore?.(collection);
}

/** A collection's full size: the daemon's total when the snapshot was bounded, otherwise what is loaded. */
const sizeOf = (data: Data, collection: WindowedCollection): number => data.totals?.[collection] ?? data[collection].length;

/** The counts shown in settings, in display order. */
export const countsOf = (data: Data) => ({
  sessions: sizeOf(data, 'sessions'), requests: sizeOf(data, 'requests'), questions: sizeOf(data, 'questions'), messages: sizeOf(data, 'messages'), jobs: sizeOf(data, 'jobs'),
  resets: sizeOf(data, 'resets'), 'needs you': data.needsYou.length,
});
