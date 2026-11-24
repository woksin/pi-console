import type { KeyContext } from '@pi-console/viewmodels';
import type { ConsoleState } from '../state/state.ts';

/** Hints that act on a selected row; with nothing to select they are dead keys. */
const selectionHints = new Set(['j/k move', '⏎ open', 'y copy id', 'space fold']);

/** True when the screen's list has no row the selection keys could act on. */
function nothingToSelect(context: KeyContext, state: Pick<ConsoleState, 'sessions' | 'needsYou'>): boolean {
  if (context === 'overview') return state.needsYou.length === 0;
  if (context === 'fleet') return state.sessions.length === 0;
  return false;
}

/** The key hints for the screen, without the selection keys when Overview or Fleet has nothing to select. */
export function visibleHints(items: string[], context: KeyContext, state: Pick<ConsoleState, 'sessions' | 'needsYou'>): string[] {
  return nothingToSelect(context, state) ? items.filter(item => !selectionHints.has(item)) : items;
}
