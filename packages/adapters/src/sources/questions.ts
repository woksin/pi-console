import type { Mapper } from '../tailing/events.ts';
import { excerpt, fact, integer, list, object, text } from '../values.ts';

type Row = Record<string, unknown>;
const ignored = new Set(['claimed', 'unclaimed', 'declined', 'reopened', 'comment']);
const operations: Record<string, { type: string; payload: (row: Row) => Row }> = {
  created: { type: 'QuestionAsked', payload: created },
  edited: { type: 'QuestionRevised', payload: row => excerpt(row.text) },
  answered: { type: 'QuestionAnswered', payload: row => excerpt(object(row.answer).text) },
  decided: { type: 'QuestionAnswered', payload: row => excerpt(object(row.answer).text) },
  closed: { type: 'QuestionClosed', payload: () => ({}) },
  withdrawn: { type: 'QuestionClosed', payload: () => ({ reason: 'withdrawn' }) },
  deferred: { type: 'QuestionDeferred', payload: () => ({ until: null }) },
};

function created(row: Row): Row {
  if (typeof row.blocking !== 'string') throw new Error('Unknown blocking reason');
  const kind = text(row.type);
  const urgency = text(row.priority);
  if (!['question', 'decision', 'approval', 'fyi'].includes(kind)) throw new Error('Unknown question kind');
  if (!['normal', 'high'].includes(urgency)) throw new Error('Unrepresentable question priority');
  return { kind, urgency, blocking: row.blocking.length > 0, ...excerpt(row.text) };
}

function lastOperation(row: Row): Row {
  const event = list(row.history).at(-1);
  if (!event) throw new Error('Missing question history');
  if (integer(event.seq) !== integer(row.rev)) throw new Error('Question revision mismatch');
  return event;
}

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

/** Revision files contain all history; only the revision's last explicit operation is new. */
export const questionMapper: Mapper = value => {
  const row = questionRecord(value);
  const questionId = text(row.id);
  const event = lastOperation(row);
  const type = text(event.type);
  if (ignored.has(type)) return [];
  const operation = Object.hasOwn(operations, type) ? operations[type] : undefined;
  if (!operation) throw new Error('Unknown question event');
  return [fact(operation.type, `question:${questionId}`, {
    questionId, ...operation.payload(row),
  }, event.ts, `${questionId}:${integer(row.rev)}`)];
};
