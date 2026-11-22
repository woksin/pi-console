import type { Action } from '@pi-console/viewmodels';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ConsoleStore } from '../client/store.ts';
import type { ConsoleState } from '../state/state.ts';
import { copyWithNotice } from './copy-notice.ts';
import { useActions } from './commands.ts';
import { parseRoute, type Route } from './routes.ts';

export const StoreContext = createContext<ConsoleStore | null>(null);

export function useStore(): ConsoleStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext missing');
  return store;
}

export const useConsole = (): ConsoleState => {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
};

/** "Now" for ages: the stream's own clock, advanced by wall time since its event-time anchor, independent of heartbeats. */
export function clockNow(state: ConsoleState, wall: number): number {
  return state.liveAt > 0 && state.liveAtReceivedAt !== null ? state.liveAt + (wall - state.liveAtReceivedAt) : wall;
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = (): void => { setHash(window.location.hash); };
    window.addEventListener('hashchange', onChange);
    return () => { window.removeEventListener('hashchange', onChange); };
  }, []);
  return useMemo(() => parseRoute(hash), [hash]);
}

export function navigate(href: string): void {
  window.location.hash = href.replace(/^#/, '');
}

/** Copies text to the clipboard, falling back silently where the API is unavailable (non-secure contexts). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export interface ListNav { selected: string | null; select: (id: string) => void }

/** The index a move action lands on, clamped to the list; null when the action is not a move. */
function moveTarget(action: Action, index: number, length: number): number | null {
  const offsets: Partial<Record<Action, number>> = { 'move.down': index + 1, 'move.up': index - 1, 'page.down': index + 10, 'page.up': index - 10, 'move.top': 0, 'move.bottom': length - 1 };
  const next = offsets[action];
  return next === undefined ? null : Math.max(0, Math.min(length - 1, next));
}

/** The picked id if it is still listed, else the preferred fallback, else the first. */
function resolveSelection(ids: readonly string[], picked: string | null, fallback: string | null | undefined): string | null {
  if (picked !== null && ids.includes(picked)) return picked;
  return fallback && ids.includes(fallback) ? fallback : ids.at(0) ?? null;
}

/** `y` copies the selected id unless the list opts out (a transcript copies its session id instead). */
const copies = (action: Action, options: { copy?: boolean }): boolean => action === 'copy.id' && options.copy !== false;

/** Keyboard selection over an ordered id list, bound to the shared move/open/copy actions. */
export function useListNav(ids: readonly string[], options: { onOpen?: (id: string) => void; initial?: string | null; fallback?: string | null; enabled?: boolean; onMove?: (id: string) => void; copy?: boolean } = {}): ListNav {
  const [picked, setPicked] = useState<string | null>(options.initial ?? null);
  const selected = resolveSelection(ids, picked, options.fallback);
  useActions(action => {
    const target = moveTarget(action, selected === null ? -1 : ids.indexOf(selected), ids.length);
    if (target !== null) { if (ids.length > 0) { setPicked(ids[target]); options.onMove?.(ids[target]); } return true; }
    if (selected === null) return false;
    if (action === 'open' && options.onOpen) { options.onOpen(selected); return true; }
    if (copies(action, options)) { void copyWithNotice(selected, 'id'); return true; }
    return false;
  }, options.enabled ?? true);
  return { selected, select: setPicked };
}

/** Binds `/` to focusing a view's search box and Esc inside it to leaving it. */
export function useSearchFocus(ref: React.RefObject<HTMLInputElement | null>): void {
  useActions(action => {
    if (action !== 'filter.open') return false;
    ref.current?.focus();
    ref.current?.select();
    return true;
  });
}
