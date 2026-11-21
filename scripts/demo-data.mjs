// Synthetic facts only. No source discovery, user files, credentials or live agent connections.
import { generate } from '../packages/testkit/src/fixture/generate.ts';
import { testEvent } from '../packages/core/src/testing/events.ts';

function addSession(add, session) {
  add('SessionStarted', { sessionId: session.id, cwd: session.cwd, model: session.model, role: session.role, parentSessionId: session.parentSessionId }, session.startedAt);
  add('SessionHeartbeat', { sessionId: session.id, status: session.status });
  for (const sample of session.samples) {
    add('ContextPressureSampled', { sessionId: session.id, percent: sample.contextPercent, tokens: sample.tokens }, sample.at);
  }
  if (session.status === 'working') add('TurnStarted', { sessionId: session.id, turnId: `turn-${session.id}` });
  if (session.status === 'done') add('SessionEnded', { sessionId: session.id, reason: 'completed' });
}

function addRequest(add, request) {
  add('RequestObserved', { requestId: request.id, sessionId: request.sessionId, excerpt: request.text, origin: request.origin, originEvidence: request.originEvidence }, request.createdAt);
  if (request.answer) add('AnswerObserved', { requestId: request.id, answerId: request.answer.id, excerpt: request.answer.text, interim: false });
  if (request.resetId) add('RequestInterrupted', { requestId: request.id, sessionId: request.sessionId, resetId: request.resetId });
}

function addMessage(add, message) {
  add('MessageSent', { messageId: message.id, from: message.fromSessionId, to: message.toSessionId, excerpt: message.text }, message.sentAt);
  if (message.status !== 'sent') add('MessageDelivered', { messageId: message.id });
  if (message.status === 'read') add('MessageRead', { messageId: message.id });
}

function addJob(add, job) {
  add('JobStarted', { jobId: job.id, sessionId: job.sessionId, kind: job.kind, name: job.name }, job.startedAt);
  if (['done', 'failed'].includes(job.status)) add('JobFinished', { jobId: job.id, status: job.status, exitCode: job.exitCode });
}

function transcriptReader(transcript) {
  const page = (items, after, limit) => {
    const selected = items.filter(item => item.cursor > after).slice(0, limit);
    const nextCursor = selected.at(-1)?.cursor ?? after;
    return { items: selected, nextCursor, hasMore: items.some(item => item.cursor > nextCursor) };
  };
  return {
    page: (sessionId, after, limit) => page(transcript.filter(item => item.sessionId === sessionId), after, limit),
    around(sessionId, entryId, limit) {
      const items = transcript.filter(item => item.sessionId === sessionId);
      const index = items.findIndex(item => item.id === entryId);
      if (index < 0) return undefined;
      const start = Math.max(0, index - Math.floor(limit / 2));
      return page(items, items[start]?.cursor - 1, limit);
    },
  };
}

export function demoData() {
  const { fixture } = generate(192);
  const events = [];
  const add = (type, payload, at = fixture.sessions[0].updatedAt) => {
    events.push(testEvent(events.length + 1, type, payload, { occurredAt: at }));
  };
  for (const session of fixture.sessions) addSession(add, session);
  for (const request of fixture.requests) addRequest(add, request);
  for (const question of fixture.questions) {
    add('QuestionAsked', { questionId: question.id, asker: question.sessionId, kind: question.kind, excerpt: question.text, options: question.options, urgency: question.urgency, blocking: question.blocking }, question.createdAt);
  }
  for (const message of fixture.messages) addMessage(add, message);
  for (const job of fixture.jobs) addJob(add, job);
  add('ResetOccurred', { sessionId: 's2', ...fixture.resets[0], resetId: 'reset1' }, fixture.resets[0].at);
  return { events, transcripts: transcriptReader(fixture.transcript) };
}
