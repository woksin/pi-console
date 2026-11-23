import { useSyncExternalStore } from 'react';
import type { ThemeId } from './theme.ts';

export interface Prefs { theme: ThemeId; reducedMotion: boolean; sidebarCollapsed: boolean }

const key = 'pi-console.prefs';
type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface StoredPrefs extends Partial<Prefs> { version?: number }
interface MotionPreference {
  readonly matches: boolean;
  addEventListener: (event: 'change', listener: () => void) => void;
  removeEventListener: (event: 'change', listener: () => void) => void;
}

function write(storage: PrefsStorage, prefs: Partial<Prefs>): void {
  try { storage.setItem(key, JSON.stringify({ ...prefs, version: 1 })); } catch { /* storage may be unavailable; preferences then last for the tab */ }
}

function read(storage: PrefsStorage): Partial<Prefs> {
  try {
    const stored = storage.getItem(key);
    if (stored === null) return {};
    const { version, ...saved } = JSON.parse(stored) as StoredPrefs | null ?? {};
    if (version === undefined) {
      // Legacy saves included the resolved OS value, even without a motion choice.
      delete saved.reducedMotion;
      write(storage, saved);
    }
    return saved;
  } catch { return {}; }
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
      write(storage, saved);
      notify();
    },
    followSystemMotion(): void {
      delete saved.reducedMotion;
      snapshot();
      write(storage, saved);
      notify();
    },
  };
}

let currentStore: ReturnType<typeof createPrefsStore> | null = null;
const store = () => (currentStore ??= createPrefsStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => { localStorage.setItem(key, value); } }, window.matchMedia('(prefers-reduced-motion: reduce)')));

export const setPrefs = (patch: Partial<Prefs>): void => { store().set(patch); };
export const followSystemMotion = (): void => { store().followSystemMotion(); };
export const usePrefs = (): Prefs => { const prefs = store(); return useSyncExternalStore(prefs.subscribe, prefs.snapshot); };
