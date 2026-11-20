import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ConsoleStore } from '../client/store.ts';
import type { ConsoleState } from '../state/state.ts';
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

/** "Now" for ages: the stream's own clock, advanced by wall time since the last frame, so fixture data and live data both read sensibly. */
export function clockNow(state: ConsoleState, wall: number): number {
  return state.liveAt > 0 && state.lastFrameAt > 0 ? state.liveAt + (wall - state.lastFrameAt) : wall;
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

/** Keyboard selection over an ordered id list, bound to the shared move/open/copy actions. */
export function useListNav(ids: readonly string[], options: { onOpen?: (id: string) => void; initial?: string | null; fallback?: string | null; enabled?: boolean } = {}): ListNav {
  const [picked, setPicked] = useState<string | null>(options.initial ?? null);
  const selected = picked !== null && ids.includes(picked) ? picked : options.fallback && ids.includes(options.fallback) ? options.fallback : ids.at(0) ?? null;
  useActions(action => {
    const index = selected === null ? -1 : ids.indexOf(selected);
    const to = (next: number): boolean => { if (ids.length > 0) setPicked(ids[Math.max(0, Math.min(ids.length - 1, next))]); return true; };
    switch (action) {
      case 'move.down': return to(index + 1);
      case 'move.up': return to(index - 1);
      case 'page.down': return to(index + 10);
      case 'page.up': return to(index - 10);
      case 'move.top': return to(0);
      case 'move.bottom': return to(ids.length - 1);
      case 'open': if (selected !== null && options.onOpen) { options.onOpen(selected); return true; } return false;
      case 'copy.id': if (selected !== null) { void copyText(selected); return true; } return false;
      default: return false;
    }
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
