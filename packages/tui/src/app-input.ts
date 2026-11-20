import type { WindowedCollection } from '@pi-console/viewmodels';
import type { Section, UiState } from './state/ui.ts';
import type { Data } from './store/store.ts';

const listCollection: Partial<Record<Section, WindowedCollection>> = { fleet: 'sessions', requests: 'requests', questions: 'questions', messages: 'messages', work: 'jobs' };

/** The list to fetch older history for: only when a list section is open at its last row, never inside a session. */
export const collectionToLoad = (ui: Pick<UiState, 'section' | 'sessionId'>, atEnd: boolean): WindowedCollection | undefined =>
  ui.sessionId || !atEnd ? undefined : listCollection[ui.section];

/** A collection's full size: the daemon's total when the snapshot was bounded, otherwise what is loaded. */
const sizeOf = (data: Data, collection: WindowedCollection): number => data.totals?.[collection] ?? data[collection].length;

/** The counts shown in settings, in display order. */
export const countsOf = (data: Data) => ({
  sessions: sizeOf(data, 'sessions'), requests: sizeOf(data, 'requests'), questions: sizeOf(data, 'questions'), messages: sizeOf(data, 'messages'), jobs: sizeOf(data, 'jobs'),
  resets: data.resets.length, 'needs you': data.needsYou.length,
});
