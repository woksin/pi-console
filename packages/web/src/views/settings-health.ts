import type { SettingsRow, Tone } from '@pi-console/viewmodels';
import { settingsTimestamp } from './settings-format.ts';

export interface HealthGroup { title: string; rows: SettingsRow[] }

const objectOf = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined);
const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const plain = (label: string, value: string, tone: Tone = 'plain'): SettingsRow => ({ label, value, tone });

/** Binary byte sizes with the unit that keeps the number short. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.abs(bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${bytes < 0 ? '-' : ''}${unit === 0 ? String(size) : size.toFixed(1)} ${units[unit]}`;
}

const numberRow = (label: string, value: unknown, format: (n: number) => string = n => n.toLocaleString('en-US')): SettingsRow => {
  const n = count(value);
  return plain(label, n === undefined ? '–' : format(n));
};

const eventLogRows = (health: Record<string, unknown> | undefined): SettingsRow[] => {
  const log = objectOf(health?.eventLog);
  return log === undefined ? [] : [numberRow('Last sequence', log.lastSeq), numberRow('Database size', log.dbBytes, formatBytes)];
};

const streamRows = (health: Record<string, unknown> | undefined): SettingsRow[] => {
  const stream = objectOf(health?.stream);
  return stream === undefined ? [] : [numberRow('Sequence', stream.seq), numberRow('Connected clients', stream.clients), numberRow('Retained events', stream.retained)];
};

/** What one source reports besides availability, in plain units; unreported facts are left out, not invented. */
function sourceFacts(entry: Record<string, unknown>): string[] {
  const files = count(entry.files);
  const lag = count(entry.lagBytes);
  const errors = count(entry.errors);
  const polled = typeof entry.lastPollAt === 'string' ? settingsTimestamp(entry.lastPollAt) ?? entry.lastPollAt : undefined;
  return [
    ...files === undefined ? [] : [`${String(files)} ${files === 1 ? 'file' : 'files'}`],
    ...lag === undefined ? [] : [lag === 0 ? 'no lag' : `${formatBytes(lag)} behind`],
    ...errors === undefined || errors === 0 ? [] : [`${String(errors)} ${errors === 1 ? 'error' : 'errors'}`],
    ...polled === undefined ? [] : [`polled ${polled}`],
  ];
}

const sourceEntries = (health: Record<string, unknown> | undefined): Map<string, Record<string, unknown>> => {
  const entries = Array.isArray(health?.sources) ? health.sources.map(objectOf) : [];
  return new Map(entries.flatMap(entry => (typeof entry?.source === 'string' ? [[entry.source, entry] as const] : [])));
};

/** Named source rows: the shared availability text and tone (`sources`), plus the facts the daemon reported for that source. */
export function healthSourceRows(health: unknown, sources: readonly SettingsRow[]): SettingsRow[] {
  const entries = sourceEntries(objectOf(health));
  return sources.map(row => {
    const entry = entries.get(row.label);
    const errored = typeof entry?.errors === 'number' && entry.errors !== 0;
    return { ...row, value: [row.value, ...entry === undefined ? [] : sourceFacts(entry)].join(' · '), tone: row.tone === 'plain' && errored ? 'warn' : row.tone };
  });
}

/** Readable Sources, Event log and Stream groups; Event log and Stream are omitted when the daemon did not report them. */
export function healthGroups(health: unknown, sources: readonly SettingsRow[]): HealthGroup[] {
  const reported = objectOf(health);
  const groups: HealthGroup[] = [
    { title: 'Sources', rows: healthSourceRows(health, sources) },
    { title: 'Event log', rows: eventLogRows(reported) },
    { title: 'Stream', rows: streamRows(reported) },
  ];
  return groups.filter(group => group.rows.length > 0);
}
