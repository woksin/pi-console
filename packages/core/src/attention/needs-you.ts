import type { SourceRef } from '@pi-console/contract';
import { compareText } from '../projector/canonical.ts';
import type { ReadModels } from '../projections/index.ts';
import type { SessionModel } from '../projections/sessions.ts';

export type AttentionReason = 'open-request' | 'answer-possibly-unseen' | 'blocking-question' | 'lane-waiting-on-user' | 'stale-session';

export interface AttentionPointer { sessionId: string; entryId: string; fileOffset: number }

/** One "needs you" item: the API `attentionItem` shape. */
export interface AttentionItem {
  id: string;
  reason: AttentionReason;
  sessionId: string | null;
  laneId: string | null;
  text: string;
  since: string;
  pointer: AttentionPointer | null;
}

export interface AttentionOptions {
  /** Query time. The only clock input; reducers never see it. */
  now: Date;
  /** A running turn silent for longer than this is stale. */
  staleAfterMs?: number;
}

/** `waitingOn` values that mean the owner, not another lane. */
const userPattern = /^(user|human|owner)(:|$)/i;
const defaultStaleMs = 30 * 60 * 1000;

const pointer = (sessionId: string | null, ref: SourceRef | null): AttentionPointer | null =>
  sessionId && ref?.entryId ? { sessionId, entryId: ref.entryId, fileOffset: ref.offset } : null;

/**
 * Open requests, human or launch only: an `unproven` request never raises a badge (ADR-0008). `answer-possibly-unseen`
 * is reserved for P5's derivation, which owns that judgement; the default derivation never emits it.
 */
function openRequests(models: ReadModels): AttentionItem[] {
  return Object.values(models.requests.requests)
    .filter(request => request.status === 'open' && request.origin !== 'unproven')
    .map(request => ({
      id: `request:${request.id}`, reason: 'open-request', sessionId: request.sessionId, laneId: null,
      text: request.text, since: request.createdAt, pointer: pointer(request.sessionId, request.ref),
    }));
}

/** The asker is a session id only when the console knows that session (askers may also be lanes or people). */
const knownSession = (models: ReadModels, asker: string | null) => (asker !== null && asker in models.sessions.sessions ? asker : null);

function blockingQuestions(models: ReadModels): AttentionItem[] {
  return Object.values(models.questions.questions)
    .filter(question => question.blocking && question.status === 'open')
    .map(question => ({
      id: `question:${question.id}`, reason: 'blocking-question', sessionId: knownSession(models, question.asker),
      laneId: null, text: question.text, since: question.createdAt, pointer: pointer(knownSession(models, question.asker), question.ref),
    }));
}

function lanesWaitingOnUser(models: ReadModels): AttentionItem[] {
  return Object.values(models.lanes.lanes)
    .filter(lane => !lane.closed && lane.waitingOn !== null && userPattern.test(lane.waitingOn))
    .map(lane => ({
      id: `lane:${lane.id}`, reason: 'lane-waiting-on-user', sessionId: null, laneId: lane.id,
      text: `${lane.name} is waiting on you`, since: lane.statusAt || lane.registeredAt, pointer: null,
    }));
}

const isStale = (session: SessionModel, cutoff: string) => session.endedAt === null && session.openTurnId !== null && session.updatedAt < cutoff;

function staleSessions(models: ReadModels, options: AttentionOptions): AttentionItem[] {
  const cutoff = new Date(options.now.getTime() - (options.staleAfterMs ?? defaultStaleMs)).toISOString();
  return Object.values(models.sessions.sessions)
    .filter(session => isStale(session, cutoff))
    .map(session => ({
      id: `session:${session.id}`, reason: 'stale-session', sessionId: session.id, laneId: null,
      text: 'Turn running with no activity', since: session.updatedAt, pointer: pointer(session.id, session.lastRef),
    }));
}

/**
 * THE single definition of "needs you" (M1, conservative per the orchestrator decision). Web and TUI render
 * `/needs-you`; they never compute their own. Ordered oldest first, then by id.
 */
export function needsYou(models: ReadModels, options: AttentionOptions): AttentionItem[] {
  const items = [...openRequests(models), ...blockingQuestions(models), ...lanesWaitingOnUser(models), ...staleSessions(models, options)];
  return items.sort((a, b) => compareText(a.since, b.since) || compareText(a.id, b.id));
}
