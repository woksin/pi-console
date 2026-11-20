import type { Job, Message, Question, Request, Reset, Session } from '@pi-console/contract';
import type { AttentionItem } from '../attention/needs-you.ts';
import type { ReadModels } from '../projections/index.ts';
import type { JobModel } from '../projections/work.ts';
import type { MessageModel } from '../projections/messages.ts';
import type { QuestionModel } from '../projections/questions.ts';
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

function statusOf(session: SessionModel, attention: readonly AttentionItem[]): Session['status'] {
  if (session.endedAt !== null) return failedPattern.test(session.endReason ?? '') ? 'failed' : 'done';
  if (attention.some(item => item.sessionId === session.id)) return 'needs-you';
  if (session.heartbeatStatus === 'blocked' || session.heartbeatStatus === 'waiting') return session.heartbeatStatus;
  return session.openTurnId === null ? 'idle' : 'working';
}

export function toSession(models: ReadModels, session: SessionModel, attention: readonly AttentionItem[]): Session {
  const burn = models.burn.sessions[session.id] as ReadModels['burn']['sessions'][string] | undefined;
  return {
    id: session.id, repositoryId: repositoryOf(session), name: baseName(session.cwd) || session.id, laneId: unassignedLane,
    role: session.role, parentSessionId: session.parentSessionId, orchestratorSessionId: rootOf(models, session), branch: '',
    cwd: session.cwd, model: session.model ?? '', status: statusOf(session, attention), startedAt: session.startedAt,
    updatedAt: session.updatedAt, contextPercent: burn?.contextPercent ?? 0,
    samples: (burn?.samples ?? []).map(sample => ({ at: sample.at, contextPercent: sample.contextPercent, tokens: sample.tokens, costUsd: 0 })),
  };
}

export function toRequest(request: RequestModel): Request {
  return {
    id: request.id, sessionId: request.sessionId, text: request.text, origin: request.origin, originLabel: originLabels[request.origin],
    originEvidence: request.originEvidence, status: request.status, createdAt: request.createdAt, resetId: request.resetId,
    answer: request.answer, interimAnswers: request.interimAnswers,
  };
}

export function toQuestion(question: QuestionModel): Question {
  return {
    id: question.id, sessionId: question.asker ?? consoleOwner, kind: question.kind, text: question.text, options: question.options,
    urgency: question.urgency, blocking: question.blocking, status: question.status, createdAt: question.createdAt,
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
