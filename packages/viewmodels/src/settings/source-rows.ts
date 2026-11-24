import type { SettingsRow, Tone } from './settings.ts';

const notReported = 'availability not reported';
const availabilityKeys = new Set(['availability', 'agentRootAvailability']);
const availabilityText: Record<string, [string, Tone]> = {
  available: ['available', 'good'], disabled: ['disabled', 'plain'],
  missing: ['missing directory — check startup paths', 'warn'], unavailable: ['directory unavailable — check startup paths', 'warn'],
};

/** The tone of one flattened health value: only a missing or unavailable directory warns. */
export function healthTone(key: string, value: unknown): Tone {
  return availabilityKeys.has(key) && (value === 'missing' || value === 'unavailable') ? 'warn' : 'plain';
}

/** A recognised availability becomes its text and tone; anything else, including a legacy daemon's silence, is neutral. */
function availabilityRow(label: string, value: unknown): SettingsRow {
  const known = typeof value === 'string' ? availabilityText[value] : undefined;
  return { label, value: known?.[0] ?? notReported, tone: known?.[1] ?? 'plain' };
}

const sourceNames: Record<string, string> = {
  'session-jsonl': 'Session transcripts', 'issue-work': 'Issue register', 'lane-messages': 'Lane messages',
  'context-budget': 'Context budget', 'lane-heartbeats': 'Lane heartbeats', 'question-store': 'Question store',
  'intent-memory': 'Intent memory', 'phase-ledger': 'Phase ledger', 'github-closures': 'GitHub closures',
};

/** The human name of a daemon source id; an unknown id is its own name. */
export const sourceName = (id: string): string => sourceNames[id] ?? id;

/** A source row named for people, with the daemon id as secondary `detail` when the name differs. */
function sourceRow(id: string, availability: unknown): SettingsRow {
  const name = sourceName(id);
  return { ...availabilityRow(name, availability), ...name === id ? {} : { detail: id } };
}

const objectOf = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

function reportedSources(reported: Record<string, unknown> | undefined): Record<string, unknown>[] {
  const sources: unknown = reported?.sources;
  if (!Array.isArray(sources)) return [];
  return sources.map(objectOf).filter((entry): entry is Record<string, unknown> => typeof entry?.source === 'string');
}

/** The agent directory and each reported source, from the daemon's own report; no state is invented for what it did not report. */
export function sourceRows(health: unknown): SettingsRow[] {
  const reported = objectOf(health);
  const entries = reportedSources(reported);
  const root = reported?.agentRootAvailability;
  if (root === undefined && entries.length === 0) return [{ label: 'Source adapters', value: notReported, tone: 'plain' }];
  return [availabilityRow('Agent directory', root), ...entries.map(entry => sourceRow(String(entry.source), entry.availability))];
}
