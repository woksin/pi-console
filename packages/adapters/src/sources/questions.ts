import { parseLink } from '@pi-console/contract';
import type { Fact, Mapper } from '../tailing/events.ts';
import { excerpt, fact, integer, list, object, text, timestamp } from '../values.ts';
import { entries, recorded, status, type Entry } from './question-history.ts';

type Row = Record<string, unknown>;

/** Bump when the facts a question revision maps to change; the daemon rereads unchanged revisions once (snapshot checkpoint namespace). */
export const questionMapperVersion = 'questions-history-v1';

/** Local unversioned revisions and the installed v1 model use different field names. */
function questionRecord(value: unknown): Row {
  const row = object(value);
  if (row.v === 1) return row;
  if (row.v !== undefined) throw new Error('Unknown question version');
  if (typeof row.body !== 'string') throw new Error('Expected string');
  return {
    ...row, type: text(row.kind), priority: text(row.urgency), text: row.body,
    history: list(row.history).map(event => ({ ...event, ts: event.at })),
  };
}

function strings(value: unknown, pick: (item: unknown) => unknown = item => item): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Expected list');
  return (value as unknown[]).map(item => text(pick(item)));
}

function withoutControls(text: string): string {
  let kept = '';
  for (const char of text) if (char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127) kept += char;
  return kept;
}

/**
 * Link text is classified before ingestion truncates it (200 characters) or the API strips control characters. A link that is not a
 * whole recognised reference but would become one after either step keeps its text and ends in an ellipsis, so no truncated or
 * stripped form can ever parse as a target: server and clients then agree it is unsupported. Every other link passes unchanged.
 */
function linkText(item: unknown): unknown {
  if (typeof item !== 'string' || parseLink(item)) return item;
  return parseLink(withoutControls(item.slice(0, 200))) ? `${item.slice(0, 198)}\u2026` : item;
}

const optionText = (item: unknown): unknown => (typeof item === 'string' ? item : object(item).text);

/** Recorded times only: the first and last history timestamps stand in for stores that do not write `createdAt`/`updatedAt`. */
function times(row: Row, history: readonly Entry[]): { createdAt: string; updatedAt: string } {
  const ordered = history.map(entry => entry.at).sort((a, b) => Date.parse(a) - Date.parse(b));
  const created = row.createdAt ?? ordered[0];
  return { createdAt: timestamp(created), updatedAt: timestamp(row.updatedAt ?? ordered.at(-1) ?? created) };
}

function snapshot(row: Row, history: readonly Entry[]): Fact {
  const questionId = text(row.id);
  const revision = integer(row.rev);
  const kind = text(row.type);
  const urgency = text(row.priority);
  if (typeof row.blocking !== 'string') throw new Error('Unknown blocking reason');
  if (!['question', 'decision', 'approval', 'fyi'].includes(kind)) throw new Error('Unknown question kind');
  if (!['normal', 'high'].includes(urgency)) throw new Error('Unrepresentable question priority');
  const { createdAt, updatedAt } = times(row, history);
  const payload = {
    questionId, revision, asker: null, kind, urgency, blocking: row.blocking.length > 0, status: status(row, history),
    options: strings(row.options, optionText), links: strings(row.links, linkText), createdAt, updatedAt, ...excerpt(row.text),
  };
  return { ...fact('QuestionSnapshotObserved', `question:${questionId}`, payload, updatedAt, `${questionId}:${revision}`), logical: { identity: `question:${questionId}`, offset: revision } };
}

/**
 * Every revision file carries the whole cumulative history, so each file maps to the question as of that revision plus all
 * history entries it holds. Logical identities (revision, sequence) make any entry or revision one event however often it is seen.
 */
export const questionMapper: Mapper = value => {
  const row = questionRecord(value);
  const history = entries(row);
  return [snapshot(row, history), ...history.map(entry => recorded(text(row.id), entry))];
};
