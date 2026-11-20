export interface SettingsInput {
  endpoint: string; connected: boolean; error: string; tokenSource: string;
  lastSeq: number | undefined; lastEventAt: number | undefined; eventsReceived: number; now: number;
  counts: Record<string, number>;
}
export type Tone = 'good' | 'warn' | 'bad' | 'plain';
export interface SettingsRow { label: string; value: string; tone: Tone }
export interface SettingsViewModel { health: SettingsRow[]; data: SettingsRow[]; sources: SettingsRow[] }

/** Read-only health: connection, stream lag and what the daemon has told us. Sources arrive with the daemon's source API. */
export function settingsViewModel(input: SettingsInput): SettingsViewModel {
  const lag = input.lastEventAt === undefined ? undefined : Math.max(0, Math.round((input.now - input.lastEventAt) / 1000));
  const lagTone: Tone = lag === undefined ? 'plain' : lag > 60 ? 'bad' : lag > 15 ? 'warn' : 'good';
  return {
    health: [
      { label: 'Daemon', value: input.endpoint, tone: 'plain' },
      { label: 'Stream', value: input.connected ? 'connected' : (input.error || 'disconnected'), tone: input.connected ? 'good' : 'bad' },
      { label: 'Last event', value: lag === undefined ? 'none yet' : `${String(lag)}s ago`, tone: lagTone },
      { label: 'Sequence', value: input.lastSeq === undefined ? '–' : String(input.lastSeq), tone: 'plain' },
      { label: 'Events this run', value: String(input.eventsReceived), tone: 'plain' },
      { label: 'Token', value: input.tokenSource, tone: 'plain' },
    ],
    data: Object.entries(input.counts).map(([label, count]) => ({ label, value: String(count), tone: 'plain' as const })),
    sources: [{ label: 'Source adapters', value: 'reported by the daemon once the sources endpoint ships', tone: 'plain' }],
  };
}
