import { healthTone, sourceRows } from './source-rows.ts';
import { healthText, healthValue } from './health-format.ts';
export { formatBytes, healthTimestamp } from './health-format.ts';
export { healthGroups, healthSourceRows, healthDetails, type HealthGroup } from './health.ts';

export interface SettingsInput {
  endpoint: string; connected: boolean; error: string; tokenSource: string;
  lastSeq: number | undefined; lastEventAt: number | undefined; eventsReceived: number; now: number;
  counts: Record<string, number>;
  /** The daemon health payload as fetched, if any; read defensively because older daemons omit the availability fields. */
  daemonHealth?: unknown;
}
const healthLabels: Record<string, string> = {
  eventLog: 'Event log', lastSeq: 'Last sequence', dbBytes: 'Database size',
  projection: 'Projection', position: 'Sequence', queueDepth: 'Queue depth', skipped: 'Skipped',
  stream: 'Stream', seq: 'Sequence', clients: 'Clients', retained: 'Retained events',
  backfill: 'Backfill', complete: 'Complete', windowDays: 'Window (days)',
  memory: 'Memory', rssBytes: 'Resident memory', heapUsedBytes: 'Heap used',
  startedAt: 'Started at', lastPollAt: 'Last poll', lagBytes: 'Lag',
  eventLoop: 'Event loop', p50: 'P50', p99: 'P99',
};
const healthLabel = (key: string): string => Object.hasOwn(healthLabels, key) ? healthLabels[key] : key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());

/** Flatten daemon-owned health data without leaking object coercions into either client. */
export function daemonHealthRows(health: unknown, prefix = '', now = Date.now()): SettingsRow[] {
  if (health === null || typeof health !== 'object') return [];
  return Object.entries(health).flatMap(([key, value]): SettingsRow[] => {
    const label = [prefix, healthText(healthLabel(key))].filter(Boolean).join(' · ');
    if (value !== null && typeof value === 'object') return daemonHealthRows(value, label, now);
    const text = healthValue(key, value, now, prefix === 'Event loop');
    return [{ label, value: text, tone: healthTone(key, value) }];
  });
}

export type Tone = 'good' | 'warn' | 'bad' | 'plain';
/** `detail` identifies the label; `valueDetail` is a faint secondary fact such as the last poll time. */
export interface SettingsRow { label: string; value: string; tone: Tone; detail?: string; valueDetail?: string }
export interface SettingsViewModel { health: SettingsRow[]; data: SettingsRow[]; sources: SettingsRow[] }

/** Read-only health: connection, stream lag, what the daemon has told us and whether each source directory is available. */
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
    sources: sourceRows(input.daemonHealth),
  };
}
