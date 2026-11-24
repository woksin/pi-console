import { daemonHealthRows, type SettingsRow, type Tone } from './settings.ts';
import { formatBytes, healthText, healthTimestamp } from './health-format.ts';

export interface HealthGroup { title: string; rows: SettingsRow[] }

const objectOf = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined);
const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const plain = (label: string, value: string, tone: Tone = 'plain'): SettingsRow => ({ label, value, tone });
const numberRow = (label: string, value: unknown, format: (n: number) => string = n => n.toLocaleString('en-US')): SettingsRow => {
  const n = count(value);
  return plain(label, n === undefined ? '–' : format(n));
};

const eventLogRows = (health: Record<string, unknown> | undefined): SettingsRow[] => {
  const log = objectOf(health?.eventLog);
  return log === undefined ? [] : [numberRow('Database size', log.dbBytes, formatBytes)];
};

const streamRows = (health: Record<string, unknown> | undefined): SettingsRow[] => {
  const stream = objectOf(health?.stream);
  return stream === undefined ? [] : [numberRow('Connected clients', stream.clients), numberRow('Retained events', stream.retained)];
};

/** Facts are omitted when unreported, never invented. Poll time stays secondary to availability. */
function sourceFacts(entry: Record<string, unknown>): string[] {
  const files = count(entry.files);
  const lag = count(entry.lagBytes);
  const errors = count(entry.errors);
  return [
    ...files === undefined ? [] : [`${String(files)} ${files === 1 ? 'file' : 'files'}`],
    ...lag === undefined ? [] : [lag === 0 ? 'no lag' : `${formatBytes(lag)} behind`],
    ...errors === undefined || errors === 0 ? [] : [`${String(errors)} ${errors === 1 ? 'error' : 'errors'}`],
  ];
}

const sourceEntries = (health: Record<string, unknown> | undefined): Map<string, Record<string, unknown>> => {
  const entries = Array.isArray(health?.sources) ? health.sources.map(objectOf) : [];
  return new Map(entries.flatMap(entry => (typeof entry?.source === 'string' ? [[entry.source, entry] as const] : [])));
};

function sourcePoll(entry: Record<string, unknown> | undefined, now: number): string | undefined {
  if (typeof entry?.lastPollAt !== 'string') return undefined;
  return `polled ${healthTimestamp(entry.lastPollAt, now) ?? healthText(entry.lastPollAt)}`;
}

/** Named source availability and facts; ids are matched before sanitizing daemon-owned text. */
export function healthSourceRows(health: unknown, sources: readonly SettingsRow[], now = Date.now()): SettingsRow[] {
  const entries = sourceEntries(objectOf(health));
  return sources.map(row => {
    const entry = entries.get(row.detail ?? row.label);
    const errored = typeof entry?.errors === 'number' && entry.errors !== 0;
    const valueDetail = sourcePoll(entry, now);
    return {
      ...row, label: healthText(row.label), ...row.detail === undefined ? {} : { detail: healthText(row.detail) },
      value: [healthText(row.value), ...entry === undefined ? [] : sourceFacts(entry)].join(' · '),
      tone: row.tone === 'plain' && errored ? 'warn' : row.tone,
      ...valueDetail === undefined ? {} : { valueDetail },
    };
  });
}

/** Source facts already shown in the summary are omitted, but adapter-specific diagnostics remain. */
function sourceDetails(health: Record<string, unknown>, now: number): SettingsRow[] {
  if (!Array.isArray(health.sources)) return [];
  const known = ['source', 'files', 'lagBytes', 'errors', 'availability', 'lastPollAt'];
  return health.sources.flatMap((value: unknown, index) => {
    const entry = objectOf(value);
    if (entry === undefined) return [];
    const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => !known.includes(key)));
    const name = typeof entry.source === 'string' ? healthText(entry.source) : String(index);
    return daemonHealthRows(rest, `Sources · ${name}`, now);
  });
}

/** Connection's received sequence is the single sequence row; grouped facts are not repeated in Details. */
export function healthDetails(health: unknown, now = Date.now()): SettingsRow[] {
  const reported = objectOf(health);
  if (reported === undefined) return [];
  const rest = Object.fromEntries(Object.entries(reported).filter(([key]) => !['sources', 'agentRootAvailability'].includes(key)));
  const grouped = { eventLog: ['lastSeq', 'dbBytes'], stream: ['seq', 'clients', 'retained'], projection: ['position'] };
  for (const [key, fields] of Object.entries(grouped)) {
    const entry = objectOf(rest[key]);
    if (entry === undefined) continue;
    rest[key] = Object.fromEntries(Object.entries(entry).filter(([field]) => !fields.includes(field)));
  }
  return [...daemonHealthRows(rest, '', now), ...sourceDetails(reported, now)];
}

/** Shared readable groups, with the remaining daemon fields under Details. */
export function healthGroups(health: unknown, sources: readonly SettingsRow[], now = Date.now()): HealthGroup[] {
  const reported = objectOf(health);
  const groups: HealthGroup[] = [
    { title: 'Sources', rows: healthSourceRows(health, sources, now) },
    { title: 'Event log', rows: eventLogRows(reported) },
    { title: 'Stream', rows: streamRows(reported) },
    { title: 'Details', rows: healthDetails(health, now) },
  ];
  return groups.filter(group => group.rows.length > 0);
}
