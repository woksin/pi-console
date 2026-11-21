export interface SettingsInput {
  endpoint: string; connected: boolean; error: string; tokenSource: string;
  lastSeq: number | undefined; lastEventAt: number | undefined; eventsReceived: number; now: number;
  counts: Record<string, number>;
}
const healthLabels: Record<string, string> = {
  eventLog: 'Event log', lastSeq: 'Last sequence', dbBytes: 'Database size',
  projection: 'Projection', position: 'Sequence', queueDepth: 'Queue depth', skipped: 'Skipped',
  stream: 'Stream', seq: 'Sequence', clients: 'Clients', retained: 'Retained events',
  backfill: 'Backfill', complete: 'Complete', windowDays: 'Window (days)',
  memory: 'Memory', rssBytes: 'Resident memory', heapUsedBytes: 'Heap used',
  startedAt: 'Started at', lastPollAt: 'Last poll', lagBytes: 'Lag (bytes)',
};
const healthLabel = (key: string): string => healthLabels[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());

/** Flatten daemon-owned health data without leaking object coercions into either client. */
export function daemonHealthRows(health: unknown, prefix = ''): SettingsRow[] {
  if (health === null || typeof health !== 'object') return [];
  return Object.entries(health).flatMap(([key, value]): SettingsRow[] => {
    const label = [prefix, healthLabel(key)].filter(Boolean).join(' · ');
    if (value !== null && typeof value === 'object') return daemonHealthRows(value, label);
    const text = key.endsWith('Bytes') && typeof value === 'number' && key !== 'lagBytes'
      ? `${(value / 1048576).toFixed(1)} MB` : String(value ?? '–');
    return [{ label, value: text, tone: 'plain' }];
  });
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
