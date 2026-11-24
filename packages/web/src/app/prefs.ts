import { useSyncExternalStore } from 'react';
import type { ThemeId } from './theme.ts';

/** `system` follows the OS preference; `on` and `off` are explicit, persisted choices. */
export type MotionChoice = 'system' | 'on' | 'off';
export interface Prefs { theme: ThemeId; reducedMotion: boolean; sidebarCollapsed: boolean; motionChoice: MotionChoice }
type StoredChoices = Partial<Omit<Prefs, 'motionChoice'>>;

const key = 'pi-console.prefs';
type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface StoredPrefs extends StoredChoices { version?: number }
interface MotionPreference {
  readonly matches: boolean;
  addEventListener: (event: 'change', listener: () => void) => void;
  removeEventListener: (event: 'change', listener: () => void) => void;
}

function write(storage: PrefsStorage, prefs: StoredChoices): void {
  try { storage.setItem(key, JSON.stringify({ ...prefs, version: 1 })); } catch { /* storage may be unavailable; preferences then last for the tab */ }
}

function read(storage: PrefsStorage): StoredChoices {
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
  const choiceOf = (): MotionChoice => (saved.reducedMotion === undefined ? 'system' : saved.reducedMotion ? 'on' : 'off');
  let current: Prefs = { theme: 'midnight', sidebarCollapsed: false, ...saved, reducedMotion: saved.reducedMotion ?? motion.matches, motionChoice: choiceOf() };
  const listeners = new Set<() => void>();
  const snapshot = (): Prefs => {
    const reducedMotion = saved.reducedMotion ?? motion.matches;
    const motionChoice = choiceOf();
    if (current.reducedMotion !== reducedMotion || current.motionChoice !== motionChoice) current = { ...current, reducedMotion, motionChoice };
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
    set(patch: StoredChoices): void {
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

export const setPrefs = (patch: StoredChoices): void => { store().set(patch); };
export const followSystemMotion = (): void => { store().followSystemMotion(); };
/** The single motion control: System clears the override, On/Off persist an explicit one. */
export const setMotionChoice = (choice: MotionChoice): void => { if (choice === 'system') followSystemMotion(); else setPrefs({ reducedMotion: choice === 'on' }); };
export const usePrefs = (): Prefs => { const prefs = store(); return useSyncExternalStore(prefs.subscribe, prefs.snapshot); };
