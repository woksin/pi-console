import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ConsoleState } from '@pi-console/viewmodels';
import type { ConsoleStore } from '../client/store.ts';
import { parseRoute, type Route } from './routes.ts';

export const StoreContext = createContext<ConsoleStore | null>(null);

export function useStore(): ConsoleStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext missing');
  return store;
}

export function useConsole(): ConsoleState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
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

/** Selection that follows the keyboard: `move`/`top`/`bottom` walk a flat id list, clamped. */
export function useSelection(order: readonly string[], initial: string | null = null): [string | null, (id: string | null) => void, (delta: number) => void, (end: 'top' | 'bottom') => void] {
  const [selected, setSelected] = useState<string | null>(initial);
  const current = selected !== null && order.includes(selected) ? selected : order.at(0) ?? null;
  const move = (delta: number): void => {
    if (order.length === 0) return;
    const index = current === null ? -1 : order.indexOf(current);
    setSelected(order[Math.max(0, Math.min(order.length - 1, index + delta))]);
  };
  const jump = (end: 'top' | 'bottom'): void => { setSelected(end === 'top' ? order.at(0) ?? null : order.at(-1) ?? null); };
  return [current, setSelected, move, jump];
}

/** Copies text to the clipboard, falling back silently where the API is unavailable (non-secure contexts). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
