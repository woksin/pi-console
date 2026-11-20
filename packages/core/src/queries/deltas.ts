import type { EventEnvelope } from '@pi-console/contract';
import type { ConsoleQueries } from './console-queries.ts';

/** One SSE delta: a v0 transport name and the whole current entity (clients upsert by id). */
export interface Delta { type: string; payload: unknown }

type Lookup = (queries: ConsoleQueries, payload: Record<string, unknown>) => unknown;

const find = <T extends { id: string }>(items: T[], id: unknown) => items.find(item => item.id === id);

const session: Lookup = (queries, payload) => find(queries.sessions(), payload.sessionId);
const request: Lookup = (queries, payload) => find(queries.requests(), payload.requestId);
const question: Lookup = (queries, payload) => find(queries.questions(), payload.questionId);
const message: Lookup = (queries, payload) => find(queries.messages(), payload.messageId);
const job: Lookup = (queries, payload) => find(queries.jobs(), payload.jobId);
const phase: Lookup = (queries, payload) => find(queries.jobs(), `phase:${String(payload.phaseId)}`);
const reset: Lookup = (queries, payload) => find(queries.resets(), payload.resetId);

/** Catalogue event type to the transport event it produces. Unlisted types produce no delta. */
const routes: Record<string, [string, Lookup]> = {
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
  MessageSent: ['message.sent', message], MessageDelivered: ['message.sent', message], MessageRead: ['message.sent', message],
  BroadcastSent: ['message.sent', message],
  JobStarted: ['job.updated', job], JobFinished: ['job.finished', job],
  PhaseQueued: ['job.updated', phase], PhaseStarted: ['job.updated', phase], PhaseFinished: ['job.finished', phase],
};

/** The delta for a log event once it is folded into the read models, or undefined when nothing visible changed. */
export function deltaFor(queries: ConsoleQueries, event: EventEnvelope): Delta | undefined {
  const route = Object.hasOwn(routes, event.type) ? routes[event.type] : undefined;
  if (!route || event.payload === null || typeof event.payload !== 'object') return undefined;
  const payload = route[1](queries, event.payload as Record<string, unknown>);
  return payload === undefined ? undefined : { type: route[0], payload };
}
