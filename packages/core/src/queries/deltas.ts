import type { EventEnvelope } from '@pi-console/contract';
import type { ConsoleQueries } from './console-queries.ts';

/** One SSE delta: a v0 transport name and the whole current entity (clients upsert by id). */
export interface Delta { type: string; payload: unknown }

interface Target {
  id: (payload: Record<string, unknown>) => unknown;
  lookup: (queries: ConsoleQueries, id: string) => unknown;
}

const target = (field: string, lookup: Target['lookup']): Target => ({ id: payload => payload[field], lookup });
const session = target('sessionId', (queries, id) => queries.sessionById(id));
const request = target('requestId', (queries, id) => queries.requestById(id));
const question = target('questionId', (queries, id) => queries.questionById(id));
const message = target('messageId', (queries, id) => queries.messageById(id));
const job = target('jobId', (queries, id) => queries.jobById(id));
const phase: Target = { ...job, id: payload => `phase:${String(payload.phaseId)}` };
const reset = target('resetId', (queries, id) => queries.resetById(id));

/** Catalogue event type to the transport event it produces. Unlisted types produce no delta. */
const routes: Record<string, [string, Target]> = {
  SessionStarted: ['session.updated', session], SessionEnded: ['session.updated', session],
  ModelChanged: ['session.updated', session], ThinkingLevelChanged: ['session.updated', session],
  TurnStarted: ['session.updated', session], TurnEnded: ['session.updated', session],
  ContextPressureSampled: ['session.updated', session], SessionHeartbeat: ['session.updated', session],
  SubagentStarted: ['session.updated', session], SubagentFinished: ['session.updated', session],
  ResetOccurred: ['reset.occurred', reset],
  RequestObserved: ['request.observed', request], AnswerObserved: ['request.observed', request],
  RequestInterrupted: ['request.interrupted', request],
  QuestionAsked: ['question.asked', question], QuestionRevised: ['question.asked', question],
  QuestionAnswered: ['question.asked', question], QuestionDeferred: ['question.asked', question], QuestionClosed: ['question.asked', question],
  QuestionSnapshotObserved: ['question.asked', question], QuestionHistoryRecorded: ['question.asked', question],
  MessageSent: ['message.sent', message], MessageDelivered: ['message.sent', message], MessageRead: ['message.sent', message],
  BroadcastSent: ['message.sent', message],
  JobStarted: ['job.updated', job], JobFinished: ['job.finished', job],
  PhaseQueued: ['job.updated', phase], PhaseStarted: ['job.updated', phase], PhaseFinished: ['job.finished', phase],
};

/** The delta for a log event once it is folded into the read models, or undefined when nothing visible changed. */
export function deltaFor(queries: ConsoleQueries, event: EventEnvelope, seen?: Set<string>): Delta | undefined {
  const route = Object.hasOwn(routes, event.type) ? routes[event.type] : undefined;
  if (!route) return undefined;
  if (event.payload === null || typeof event.payload !== 'object') return undefined;
  const id = route[1].id(event.payload as Record<string, unknown>);
  if (typeof id !== 'string') return undefined;
  const key = `${route[0]}:${id}`;
  if (seen?.has(key)) return undefined;
  const payload = route[1].lookup(queries, id);
  if (payload === undefined) return undefined;
  seen?.add(key);
  return { type: route[0], payload };
}
