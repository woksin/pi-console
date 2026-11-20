import { themeTokens } from '@pi-console/contract';
import { plural } from '../common/format.ts';
import type { ConsoleState } from '../state/index.ts';

export interface SettingsViewModel {
  banner: string;
  connection: { label: string; detail: string; healthy: boolean };
  sources: { label: string; value: string }[];
  counts: { label: string; value: string }[];
  themes: { id: string; label: string }[];
  tokenNote: string;
  palette: { token: string; color: string }[];
}

const connectionText = {
  connecting: 'Connecting to the daemon…', live: 'Live: receiving updates', reconnecting: 'Disconnected: reconnecting with the last event id',
  offline: 'Offline: the daemon is not reachable', unauthorized: 'Token rejected by the daemon',
} as const;

/** Settings and health, read-only. Health rows are shown exactly as the daemon reports them. */
export function buildSettings(state: ConsoleState): SettingsViewModel {
  return {
    banner: 'Read-only console (M1). Nothing here changes a session.',
    connection: { label: connectionText[state.connection], detail: `event ${String(state.seq)}`, healthy: state.connection === 'live' },
    sources: Object.entries(state.health ?? {}).map(([label, value]) => ({ label, value: String(value) })),
    counts: [
      { label: 'Sessions', value: String(state.sessions.length) }, { label: 'Repositories', value: String(state.repositories.length) },
      { label: 'Requests', value: String(state.requests.length) }, { label: 'Questions', value: String(state.questions.length) },
      { label: 'Messages', value: String(state.messages.length) }, { label: 'Work items', value: String(state.jobs.length) },
      { label: 'Needs you', value: plural(state.needsYou.length, 'item') }, { label: 'Snapshot refreshes after a gap', value: String(state.gapCount) },
    ],
    themes: [{ id: 'midnight', label: 'Midnight (default)' }, { id: 'contrast', label: 'High contrast' }],
    tokenNote: 'The token lives in memory and session storage of this tab only. Closing the tab forgets it.',
    palette: Object.entries(themeTokens).map(([token, color]) => ({ token, color })),
  };
}
