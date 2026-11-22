import { consoleTitle } from '@pi-console/viewmodels';
import type { ConsoleState } from '../state/state.ts';

type AttentionState = Pick<ConsoleState, 'connection' | 'needsYou' | 'needsYouLoaded' | 'needsYouError' | 'needsYouCached'>;
export interface AttentionPresentation {
  status: 'ready' | 'checking' | 'unavailable' | 'stale';
  count: number | null;
  label: string;
  badge: string;
}

/** Only a successful latest fetch on a live stream can claim a current count or all-clear. */
export function attentionPresentation(state: AttentionState): AttentionPresentation {
  const count = state.needsYou.length;
  const loaded = state.needsYouLoaded && !state.needsYouError;
  if (loaded && state.connection === 'live') return { status: 'ready', count, label: `${String(count)} need you`, badge: count > 0 ? String(count) : '' };
  if (state.needsYouCached) return { status: 'stale', count, label: `${String(count)} need you · stale`, badge: `${String(count)} stale` };
  if (state.needsYouError) return { status: 'unavailable', count: null, label: 'Needs you unavailable', badge: 'unavailable' };
  return { status: 'checking', count: null, label: 'Checking needs you…', badge: 'checking…' };
}

export function attentionTitle(attention: AttentionPresentation, place: string): string {
  if (attention.status === 'ready') return consoleTitle({ needsYou: attention.count ?? 0, place });
  return `(${attention.badge}) ${consoleTitle({ needsYou: 0, place })}`;
}
