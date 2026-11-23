import { useSyncExternalStore } from 'react';
import type { ThemeId } from './theme.ts';

export interface Prefs { theme: ThemeId; reducedMotion: boolean; sidebarCollapsed: boolean }

const key = 'pi-console.prefs';
type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface MotionPreference {
  readonly matches: boolean;
  addEventListener: (event: 'change', listener: () => void) => void;
  removeEventListener: (event: 'change', listener: () => void) => void;
}

function read(storage: PrefsStorage): Partial<Prefs> {
  try { return JSON.parse(storage.getItem(key) ?? '{}') as Partial<Prefs> | null ?? {}; } catch { return {}; }
}

/** Persist only explicit choices; resolving an OS preference must never turn it into an override. */
export function createPrefsStore(storage: PrefsStorage, motion: MotionPreference) {
  let saved = read(storage);
  let current: Prefs = { theme: 'midnight', sidebarCollapsed: false, ...saved, reducedMotion: saved.reducedMotion ?? motion.matches };
  const listeners = new Set<() => void>();
  const snapshot = (): Prefs => {
    const reducedMotion = saved.reducedMotion ?? motion.matches;
    if (current.reducedMotion !== reducedMotion) current = { ...current, reducedMotion };
    return current;
  };
  const notify = (): void => { for (const listener of listeners) listener(); };
  return {
    snapshot,
    subscribe: (listener: () => void): (() => void) => {
      if (listeners.size === 0) motion.addEventListener('change', notify);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) motion.removeEventListener('change', notify);
      };
    },
    set(patch: Partial<Prefs>): void {
      saved = { ...saved, ...patch };
      current = { ...snapshot(), ...patch };
      try { storage.setItem(key, JSON.stringify(saved)); } catch { /* storage may be unavailable; preferences then last for the tab */ }
      notify();
    },
  };
}

let currentStore: ReturnType<typeof createPrefsStore> | null = null;
const store = () => (currentStore ??= createPrefsStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => { localStorage.setItem(key, value); } }, window.matchMedia('(prefers-reduced-motion: reduce)')));

export const setPrefs = (patch: Partial<Prefs>): void => { store().set(patch); };
export const usePrefs = (): Prefs => { const prefs = store(); return useSyncExternalStore(prefs.subscribe, prefs.snapshot); };
