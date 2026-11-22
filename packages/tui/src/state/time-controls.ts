import { pan, resolve, zoom, type Action, type KeyContext, type TimeWindow } from '@pi-console/viewmodels';
import type { Bounds, UiState } from './ui.ts';

const windowMoves: Partial<Record<Action, (window: TimeWindow) => TimeWindow>> = {
  'time.left': window => pan(window, -1),
  'time.right': window => pan(window, 1),
  'time.zoomIn': window => zoom(window, 0.6),
  'time.zoomOut': window => zoom(window, 1 / 0.6),
};

const isTimeStep = (action: Action): boolean => action === 'time.left' || action === 'time.right';

/** The graph borrows only the timeline's movement keys, and only while scrubbing. */
export function scrubKey(context: KeyContext, key: string, scrubbing: boolean): Action | undefined {
  if (context !== 'graph') return undefined;
  if (!scrubbing) return undefined;
  const action = resolve('timeline', key);
  return action && isTimeStep(action) ? action : undefined;
}

function scrubStep(state: UiState, action: Action, bounds: Bounds): UiState {
  const step = (action === 'time.left' ? -1 : 1) * Math.max(1, Math.round(bounds.width / 40));
  return { ...state, scrubColumn: Math.max(0, Math.min(bounds.width - 1, state.scrubColumn + step)) };
}

function initialColumn(state: UiState, width: number): number {
  return state.section === 'messages' ? Math.max(0, width - 1) : Math.floor(width / 2);
}

/** Timeline pan/zoom is unchanged; the graph's last-activity cutoff starts at the newest edge. */
export function timeControl(state: UiState, bounds: Bounds, action: Action): UiState {
  if (state.scrub && isTimeStep(action)) return scrubStep(state, action, bounds);
  const move = windowMoves[action];
  if (move) return { ...state, window: move(state.window ?? bounds.fit) };
  return { ...state, scrub: !state.scrub, scrubColumn: state.scrub ? state.scrubColumn : initialColumn(state, bounds.width) };
}
