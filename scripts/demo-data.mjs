// Synthetic facts only. No source discovery, user files, credentials or live agent connections.
import { generate } from '../packages/testkit/src/fixture/generate.ts';
import { memoryItems } from '../packages/testkit/src/mock-daemon/memory.ts';
import { testEvent } from '../packages/core/src/testing/events.ts';

// Translate the gallery's clock as a whole, including transcript and memory times.
function rebase(value, offset) {
  if (Array.isArray(value)) return value.map(item => rebase(item, offset));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item, offset)]));
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)) return new Date(Date.parse(value) + offset).toISOString();
  return value;
}

function showcase(now) {
  const { fixture } = generate(192);
  // The gallery's memory store predates the fleet recording; align its observation clock first.
  const memory = rebase(memoryItems(), Date.parse(fixture.generatedAt) - Date.parse('2026-07-01T10:30:00Z'));
  for (const item of memory) if (item.sessionId !== null) {
    item.sessionId = 's2';
    item.scope = { kind: 'session', key: 's2' };
  }
  return rebase({ fixture, memory }, now.getTime() - Date.parse(fixture.generatedAt));
}

function addSession(add, session) {
  // The real daemon names sessions from cwd and resolves globally unique lanes by exact cwd.
  const cwd = `${session.cwd}/${session.name}`;
  add('LaneRegistered', { laneId: `${session.laneId}-${session.repositoryId}`, name: session.laneId, repositoryId: session.repositoryId, cwd, branch: session.branch }, session.startedAt, 'lane-messages');
  add('SessionStarted', { sessionId: session.id, cwd, model: session.model, role: session.role, parentSessionId: session.parentSessionId }, session.startedAt);
  add('SessionHeartbeat', { sessionId: session.id, status: session.status }, session.updatedAt);
  add('SessionCostObserved', { sessionId: session.id, entryId: `cost-${session.id}`, costUsd: session.costUsd }, session.updatedAt);
  if (session.costIncomplete && session.costUsd !== null) add('SessionCostObserved', { sessionId: session.id, entryId: `missing-cost-${session.id}`, costUsd: null }, session.updatedAt);
  session.samples.forEach(sample => add('ContextPressureSampled', { sessionId: session.id, percent: sample.contextPercent, tokens: sample.tokens }, sample.at));
  if (session.status === 'working') add('TurnStarted', { sessionId: session.id, turnId: `turn-${session.id}` }, session.updatedAt);
  if (['done', 'failed'].includes(session.status)) add('SessionEnded', { sessionId: session.id, reason: session.status === 'failed' ? 'failed' : 'completed' }, session.updatedAt);
}

function addRequest(add, request) {
  add('RequestObserved', { requestId: request.id, sessionId: request.sessionId, excerpt: request.text, origin: request.origin, originEvidence: request.originEvidence }, request.createdAt);
  if (request.answer) add('AnswerObserved', { requestId: request.id, answerId: request.answer.id, excerpt: request.answer.text, interim: false }, request.answer.at);
  if (request.resetId) add('RequestInterrupted', { requestId: request.id, sessionId: request.sessionId, resetId: request.resetId }, request.createdAt);
}

function addQuestion(add, question) {
  add('QuestionAsked', { questionId: question.id, asker: question.sessionId, kind: question.kind, excerpt: question.text, options: question.options, urgency: question.urgency, blocking: question.blocking }, question.createdAt, 'question-store');
}

function addMessage(add, message) {
  add('MessageSent', { messageId: message.id, from: message.fromSessionId, to: message.toSessionId, excerpt: message.text }, message.sentAt);
  if (message.status !== 'sent') add('MessageDelivered', { messageId: message.id }, message.sentAt);
  if (message.status === 'read') add('MessageRead', { messageId: message.id }, message.sentAt);
}

function addJob(add, job) {
  add('JobStarted', { jobId: job.id, sessionId: job.sessionId, kind: job.kind, name: job.name }, job.startedAt);
  if (['done', 'failed'].includes(job.status)) add('JobFinished', { jobId: job.id, status: job.status, exitCode: job.exitCode }, job.startedAt);
}

function addMemory(add, item) {
  const source = 'intent-memory';
  if (item.sourceMessageId) add('MemoryMessageRecorded', { messageId: item.sourceMessageId, sessionId: item.sessionId ?? 's2', origin: 'human', injectedKind: null, withheld: false, textBytes: 32 }, item.at, source);
  add('MemoryItemRecorded', {
    itemId: item.id, kind: item.kind, scopeKind: item.scope.kind, scopeKey: item.scope.key,
    sourceType: item.sourceType, sourceMessageId: item.sourceMessageId, authorityMode: 'auto',
    supersedes: [], excerpt: item.text, withheld: item.withheld,
  }, item.at, source);
  if (['done', 'superseded', 'withdrawn', 'rejected'].includes(item.status)) add('MemoryItemRetired', { itemId: item.id, status: item.status, actorKind: 'human', reasonExcerpt: 'Synthetic gallery history' }, item.at, source);
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

export const demoTickMs = 7500;
export const demoTickLimit = 120;

/** A finite live sample: bounded events, questions and turn facts even if the demo is left open overnight. */
function liveEvents(sequence, fixture) {
  const working = fixture.sessions.filter(session => session.status === 'working' &&
    !fixture.requests.some(request => request.sessionId === session.id) && !fixture.questions.some(question => question.sessionId === session.id));
  const [active, finishing, asker] = working;
  let ticks = 0;
  return (now = new Date()) => {
    if (ticks >= demoTickLimit) return [];
    ticks++;
    const events = [];
    const add = (type, payload, source = 'session-jsonl') => events.push(testEvent(++sequence, type, payload, { occurredAt: now.toISOString(), source }));
    add('SessionHeartbeat', { sessionId: active.id, status: 'working' });
    if (ticks === 2) add('SessionEnded', { sessionId: finishing.id, reason: 'completed' });
    if (ticks % 20 === 3) add('QuestionAsked', {
      questionId: `demo-live-${ticks}`, asker: asker.id, kind: 'decision', excerpt: 'The synthetic checkpoint is ready. Which retention window should the next run use?',
      options: ['Keep one hour', 'Keep one day'], urgency: 'high', blocking: true,
    }, 'question-store');
    return events;
  };
}

export function demoData(now = new Date()) {
  const { fixture, memory } = showcase(now);
  const events = [];
  const add = (type, payload, at, source = 'session-jsonl') => {
    events.push(testEvent(events.length + 1, type, payload, { occurredAt: at, source }));
  };
  fixture.sessions.forEach(session => addSession(add, session));
  fixture.requests.forEach(request => addRequest(add, request));
  fixture.questions.forEach(question => addQuestion(add, question));
  fixture.messages.forEach(message => addMessage(add, message));
  fixture.jobs.forEach(job => addJob(add, job));
  add('ResetOccurred', { sessionId: 's2', ...fixture.resets[0], resetId: 'reset1' }, fixture.resets[0].at);
  memory.forEach(item => addMemory(add, item));
  return { events, transcripts: transcriptReader(fixture.transcript), tick: liveEvents(events.length, fixture) };
}
