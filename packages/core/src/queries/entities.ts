import type { Job, Message, Question, Request, Reset, Session } from '@pi-console/contract';
import type { ReadModels } from '../projections/index.ts';
import type { JobModel } from '../projections/work.ts';
import type { MessageModel } from '../projections/messages.ts';
import { evidenceOf } from '../projections/question-links.ts';
import type { QuestionHistoryModel, QuestionModel } from '../projections/questions.ts';
import type { RequestModel } from '../projections/requests.ts';
import type { SessionModel } from '../projections/sessions.ts';

/**
 * Read model to API v1 entity mapping. Fields the M1 event catalogue does not carry get explicit placeholders
 * (documented in docs/api/v1.md): a session's lane is `unassigned` and its branch empty; a job or question without
 * a known session belongs to `console`.
 */
export const unassignedLane = 'unassigned';
export const consoleOwner = 'console';

const originLabels = { human: 'Human request', launch: 'Initial prompt', unproven: 'Unproven origin' } as const;

/** Last path segment of a cwd, or the whole value. */
const baseName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export const repositoryOf = (session: SessionModel) => (session.cwd ? session.cwd : 'unknown');
export const repositoryName = (id: string) => baseName(id);

function rootOf(models: ReadModels, session: SessionModel): string {
  const seen = new Set<string>();
  let current = session;
  while (current.parentSessionId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = models.sessions.sessions[current.parentSessionId] as SessionModel | undefined;
    if (!parent) return current.parentSessionId;
    current = parent;
  }
  return current.id;
}

const failedPattern = /fail|error|crash|abort/i;

function statusOf(session: SessionModel, attentionSessionIds: ReadonlySet<string>): Session['status'] {
  if (session.endedAt !== null) return failedPattern.test(session.endReason ?? '') ? 'failed' : 'done';
  if (attentionSessionIds.has(session.id)) return 'needs-you';
  if (session.heartbeatStatus === 'blocked' || session.heartbeatStatus === 'waiting') return session.heartbeatStatus;
  return session.openTurnId === null ? 'idle' : 'working';
}

export function toSession(models: ReadModels, session: SessionModel, attentionSessionIds: ReadonlySet<string>): Session {
  const burn = models.burn.sessions[session.id] as ReadModels['burn']['sessions'][string] | undefined;
  return {
    id: session.id, repositoryId: repositoryOf(session), name: baseName(session.cwd) || session.id, laneId: unassignedLane,
    role: session.role, parentSessionId: session.parentSessionId, orchestratorSessionId: rootOf(models, session), branch: '',
    cwd: session.cwd, model: session.model ?? '', status: statusOf(session, attentionSessionIds), startedAt: session.startedAt,
    updatedAt: session.updatedAt, contextPercent: burn?.contextPercent ?? 0,
    samples: (burn?.samples ?? []).map(sample => ({ at: sample.at, contextPercent: sample.contextPercent, tokens: sample.tokens, costUsd: 0 })),
  };
}

/** The optional v1 derivation fields, present only when the request derivation produced them. */
function derivation(request: RequestModel): Partial<Request> {
  if (!request.derivedFrom) return {};
  return {
    withheld: request.withheld ?? false, answerWithheld: request.answerWithheld ?? false, answerPossiblyUnseen: request.answerPossiblyUnseen ?? false,
    uncertain: Boolean(request.uncertainReason), uncertainReason: request.uncertainReason ?? null, evidence: request.evidence ?? [],
    derivedFrom: request.derivedFrom,
    pointer: request.ref?.entryId ? { sessionId: request.sessionId, entryId: request.ref.entryId, fileOffset: request.ref.offset } : null,
  };
}

export function toRequest(request: RequestModel): Request {
  return {
    id: request.id, sessionId: request.sessionId, text: request.text, origin: request.origin, originLabel: originLabels[request.origin],
    originEvidence: request.originEvidence, status: request.status, createdAt: request.createdAt, resetId: request.resetId,
    answer: request.answer, interimAnswers: request.interimAnswers, ...derivation(request),
  };
}

/** Newest first: time descending, then sequence descending so equal timestamps stay deterministic. */
const newestFirst = (a: QuestionHistoryModel, b: QuestionHistoryModel) => Date.parse(b.at) - Date.parse(a.at) || b.sequence - a.sequence;

/** The optional v1 fields exist only when the source supplied them; old events keep the v0 shape. */
function questionDetail(question: QuestionModel): Partial<Question> {
  const linkEvidence = question.revision > 0 ? evidenceOf(question.linkObservations, question.links) : null;
  return {
    ...(question.revision > 0 ? { updatedAt: question.updatedAt, links: question.links } : {}),
    ...(linkEvidence ? { linkEvidence } : {}),
    ...(question.history ? { history: Object.values(question.history).sort(newestFirst).map(entry => ({ ...entry })) } : {}),
  };
}

export function toQuestion(question: QuestionModel): Question {
  return {
    id: question.id, sessionId: question.asker ?? consoleOwner, kind: question.kind, text: question.text, options: question.options,
    urgency: question.urgency, blocking: question.blocking, status: question.status, createdAt: question.createdAt, ...questionDetail(question),
  };
}

export const toMessage = (message: MessageModel): Message => ({
  id: message.id, fromSessionId: message.from, toSessionId: message.to, text: message.text, status: message.status, sentAt: message.sentAt,
});

export const toJob = (job: JobModel): Job => ({
  id: job.id, sessionId: job.sessionId ?? consoleOwner, kind: job.kind, name: job.name, status: job.status, startedAt: job.startedAt, exitCode: job.exitCode,
});

export function resetsOf(session: SessionModel): Reset[] {
  return session.resets.map(reset => ({ ...reset, sessionId: session.id }));
}
