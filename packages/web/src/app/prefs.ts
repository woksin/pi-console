import { useSyncExternalStore } from 'react';
import type { ThemeId } from './theme.ts';

export interface Prefs { theme: ThemeId; reducedMotion: boolean; sidebarCollapsed: boolean }

const key = 'pi-console.prefs';
const systemReduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function read(): Prefs {
  const fallback: Prefs = { theme: 'midnight', reducedMotion: systemReduced(), sidebarCollapsed: false };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Prefs> }; } catch { return fallback; }
}

let current: Prefs | null = null;
const listeners = new Set<() => void>();

const snapshot = (): Prefs => (current ??= read());

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...snapshot(), ...patch };
  try { localStorage.setItem(key, JSON.stringify(current)); } catch { /* storage may be unavailable; preferences then last for the tab */ }
  for (const listener of listeners) listener();
}

export const usePrefs = (): Prefs => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, snapshot);
