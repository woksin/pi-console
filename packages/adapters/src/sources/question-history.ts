import type { Fact } from '../tailing/events.ts';
import { fact, integer, list, text, timestamp } from '../values.ts';
import { redact, scanPatterns } from '../tailing/redact.ts';

type Row = Record<string, unknown>;
export type QuestionStatus = 'open' | 'answered' | 'deferred' | 'closed';
const maxActor = 64;

const operationStatus: Record<string, QuestionStatus | undefined> = {
  created: 'open', edited: undefined, comment: undefined, linked: undefined, claimed: undefined, unclaimed: undefined, declined: undefined,
  reopened: 'open', answered: 'answered', decided: 'answered', deferred: 'deferred', withdrawn: 'closed', superseded: 'closed', closed: 'closed',
};
const statuses: Record<string, QuestionStatus | undefined> = {
  open: 'open', answered: 'answered', decided: 'answered', deferred: 'deferred', withdrawn: 'closed', superseded: 'closed', closed: 'closed',
};

export interface Entry { sequence: number; operation: string; at: string; actor: string | null; note: unknown }

/** A display label from the actor the store recorded: lane, else name, else the user label, else the session; never enriched. */
function actorLabel(value: unknown): string | null {
  const actor = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Row : { name: value };
  const candidates = [actor.lane, actor.name, actor.kind === 'user' ? 'user' : undefined, actor.sessionId];
  const label = candidates.map(item => (typeof item === 'string' ? clean(item) : '')).find(item => item !== '');
  return label ?? null;
}

/** Scans the complete original first, so a secret straddling the bound cannot survive, then strips control characters and bounds it. */
const clean = (value: string): string => Array.from(scanPatterns(value), char => { const code = char.charCodeAt(0); return code < 32 || (code >= 127 && code < 160) ? ' ' : char; }).join('').trim().slice(0, maxActor);

/** Entries are validated for shape and unique sequence only; the revision number is independent of the history sequence. */
export function entries(row: Row): Entry[] {
  const seen = new Set<number>();
  return list(row.history).map(event => {
    const sequence = integer(event.seq);
    const operation = text(event.type);
    if (!Object.hasOwn(operationStatus, operation)) throw new Error('Unknown question event');
    if (seen.has(sequence)) throw new Error('Duplicate question history sequence');
    seen.add(sequence);
    return { sequence, operation, at: timestamp(event.ts), actor: actorLabel(event.actor), note: event.text };
  });
}

export function status(row: Row, history: readonly Entry[]): QuestionStatus {
  if (row.status !== undefined) {
    const known = typeof row.status === 'string' && Object.hasOwn(statuses, row.status) ? statuses[row.status] : undefined;
    if (!known) throw new Error('Unknown question status');
    return known;
  }
  const latest = [...history].sort((a, b) => b.sequence - a.sequence).find(entry => operationStatus[entry.operation] !== undefined);
  return (latest && operationStatus[latest.operation]) ?? 'open';
}


/** Scan the whole note, then bound it; `truncated` tells clients the text is a shortened excerpt. */
function noteOf(body: string): { excerpt: string; withheld: boolean; truncated?: true } {
  const safe = redact(body);
  return { excerpt: safe.text ?? '[withheld]', withheld: safe.withheld, ...(safe.truncated ? { truncated: true } : {}) };
}

/** One `QuestionHistoryRecorded` fact, identified by the producer's per-question sequence. */
export function recorded(questionId: string, entry: Entry): Fact {
  const note = typeof entry.note === 'string' && entry.note !== '' ? noteOf(entry.note) : {};
  const payload = { questionId, sequence: entry.sequence, operation: entry.operation, at: entry.at, actor: entry.actor, ...note };
  return { ...fact('QuestionHistoryRecorded', `question:${questionId}`, payload, entry.at, `${questionId}:${entry.sequence}`), logical: { identity: `question:${questionId}`, offset: entry.sequence } };
}
