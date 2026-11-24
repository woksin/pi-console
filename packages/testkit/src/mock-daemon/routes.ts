import type { IncomingMessage } from 'node:http';
import { apiV1Schema as schema, validate } from '@pi-console/contract';
import { sessionMemory } from './memory.ts';
import { needsYou } from './needs-you.ts';
import { HttpError } from './security.ts';
import { pageOf, type Collection } from './paging.ts';
import { transcriptAround, v1Routes } from './v1-extras.ts';
import type { Store } from './store.ts';
import type { MockInfo } from './v1-extras.ts';

export type { MockInfo };

type Fixture = Store['fixture'];
const statuses = ['working', 'needs-you', 'blocked', 'waiting', 'idle', 'done', 'failed'];
const attentionRequest = (request: Fixture['requests'][number]) => ['unanswered', 'interrupted'].includes(request.status);
const blockingQuestion = (question: Fixture['questions'][number]) => question.blocking && question.status === 'open';
const attentionItem = (kind: string) => (item: { id: string; sessionId: string; text: string }) => ({ id: item.id, sessionId: item.sessionId, kind, text: item.text });

function sparklineOf(sessions: Fixture['sessions']) {
  const total = (index: number, field: 'contextPercent' | 'tokens' | 'costUsd') => sessions.reduce((sum, session) => sum + session.samples[index][field], 0);
  return sessions[0].samples.map((sample, index) => ({
    at: sample.at,
    contextPercent: Math.round(total(index, 'contextPercent') / sessions.length),
    tokens: total(index, 'tokens'),
    costUsd: Math.round(total(index, 'costUsd') * 100) / 100,
  }));
}

export function overview(store: Store) {
  const { sessions, repositories, requests, questions } = store.fixture;
  const byStatus = Object.fromEntries(statuses.map(status => [status, sessions.filter(session => session.status === status).length]));
  const needsYou = [...requests.filter(attentionRequest).map(attentionItem('request')), ...questions.filter(blockingQuestion).map(attentionItem('question'))];
  return { counts: { sessions: sessions.length, repositories: repositories.length, byStatus }, needsYou, sparkline: sparklineOf(sessions) };
}
const boundedInteger = (text: string, value: number, maximum: number): boolean => /^\d+$/.test(text) && Number.isSafeInteger(value) && value <= maximum;
function queryInteger(url: URL, name: string, fallback: number, maximum: number) {
  const text = url.searchParams.get(name);
  if (text === null) return fallback;
  const value = Number(text);
  if (!boundedInteger(text, value, maximum)) throw new HttpError(400, `Invalid ${name}`);
  return value;
}
function sessionResponse(store: Store, url: URL) {
  const parts = url.pathname.split('/');
  const session = store.fixture.sessions.find(item => item.id === parts[4]);
  if (!session) throw new HttpError(404, 'Session not found');
  if (parts.length === 6 && parts[5] === 'transcript') return transcriptResponse(store, session.id, url);
  if (parts.length === 6 && parts[5] === 'memory-actions') return { version: 1, available: false, providerVersion: 1, generation: null, reason: 'read-only' };
  if (parts.length === 6 && parts[5] === 'memory') return sessionMemory(store, session.id);
  if (parts.length !== 5) throw new HttpError(404, 'Not found');
  return sessionDetail(store, session);
}
function transcriptResponse(store: Store, sessionId: string, url: URL) {
  const limit = queryInteger(url, 'limit', 100, 1000);
  if (limit === 0) throw new HttpError(400, 'Invalid limit');
  const around = url.searchParams.get('around');
  if (around !== null) return transcriptAround(store, sessionId, around, limit);
  const reverse = transcriptOrder(url) === 'desc';
  const after = queryInteger(url, 'after', reverse ? Number.MAX_SAFE_INTEGER : 0, Number.MAX_SAFE_INTEGER);
  const own = store.fixture.transcript.filter(entry => entry.sessionId === sessionId);
  const available = own.filter(entry => reverse ? entry.cursor < after : entry.cursor > after);
  if (reverse) available.reverse();
  const items = available.slice(0, limit);
  return { items, nextCursor: items.at(-1)?.cursor ?? after, hasMore: available.length > items.length };
}
function transcriptOrder(url: URL): string {
  const order = url.searchParams.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') throw new HttpError(400, 'Invalid order');
  return order;
}
function sessionDetail(store: Store, session: Store['fixture']['sessions'][number]) {
  const belongs = (item: { sessionId: string }) => item.sessionId === session.id;
  return {
    session, requests: store.fixture.requests.filter(belongs), questions: store.fixture.questions.filter(belongs),
    jobs: store.fixture.jobs.filter(belongs), resets: store.fixture.resets.filter(belongs),
    subagents: store.fixture.sessions.filter(item => item.parentSessionId === session.id),
  };
}
type Route = (store: Store, info: MockInfo, url: URL) => unknown;
const listing = (collection: Collection, rows: (store: Store, url: URL) => { id: string }[]): Route => (store, _info, url) => pageOf(collection, rows(store, url), url) ?? { items: rows(store, url) };
const exactRoutes = new Map<string, Route>([
  ['/api/v1/overview', store => overview(store)],
  ['/api/v1/needs-you', store => needsYou(store.fixture)],
  ['/api/v1/requests', listing('requests', requestRows)],
  ['/api/v1/sessions', listing('sessions', store => store.fixture.sessions)],
  ['/api/v1/questions', listing('questions', store => store.fixture.questions)],
  ['/api/v1/messages', listing('messages', store => store.fixture.messages)],
  ['/api/v1/jobs', listing('jobs', store => store.fixture.jobs)],
  ['/api/v1/memory-items', listing('memoryItems', (store, url) => memoryRows(store, url))],
]);
export function query(store: Store, url: URL, info: MockInfo): unknown {
  if (url.pathname.startsWith('/api/v1/sessions/')) return sessionResponse(store, url);
  const route = exactRoutes.get(url.pathname) ?? v1Routes.get(url.pathname);
  if (!route) throw new HttpError(404, 'Not found');
  return route(store, info, url);
}
const memoryStatuses = ['active', 'proposed', 'done', 'superseded', 'withdrawn', 'rejected'];
function memoryRows(store: Store, url: URL) {
  const status = url.searchParams.get('status');
  if (status !== null && !memoryStatuses.includes(status)) throw new HttpError(400, 'Invalid status');
  return store.memory.filter(row => status === null || row.status === status);
}
function requestRows(store: Store, url: URL) {
  const filter = url.searchParams.get('filter') ?? 'all';
  if (!['all', 'unanswered', 'interrupted'].includes(filter)) throw new HttpError(400, 'Invalid filter');
  return store.fixture.requests.filter(request => filter === 'all' || request.status === filter);
}
async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
}
type InterventionInput = { type: string; sessionId: string; questionId?: string; text?: string; confirmation?: string };
function checkIntervention(store: Store, input: InterventionInput) {
  const session = store.fixture.sessions.find(item => item.id === input.sessionId);
  if (!session) throw new HttpError(404, 'Session not found');
  checkInterventionText(input, session.laneId);
  checkQuestion(store, input);
}
function checkInterventionText(input: InterventionInput, laneId: string) {
  if (input.type === 'abort') {
    if (input.confirmation !== laneId) throw new HttpError(400, 'Abort requires lane confirmation');
    return;
  }
  if (!input.text) throw new HttpError(400, 'Text required');
}
function checkQuestion(store: Store, input: InterventionInput) {
  if (input.type === 'answer' && !input.questionId) throw new HttpError(400, 'Question required');
  if (!input.questionId) return;
  const question = store.fixture.questions.find(item => item.id === input.questionId);
  if (question?.sessionId !== input.sessionId) throw new HttpError(404, 'Question not found for session');
}
function interventionRecord(store: Store, input: InterventionInput, req: IncomingMessage) {
  return {
    id: `intervention${store.interventions.length + 1}`, type: input.type, sessionId: input.sessionId,
    questionId: input.questionId ?? null, text: input.text ?? '', confirmation: input.confirmation ?? null,
    actor: 'user:dev', tokenId: 'dev', origin: req.headers.origin ?? 'bearer',
    result: 'mock-only', recordedAt: new Date().toISOString(),
  };
}
async function readIntervention(req: IncomingMessage): Promise<InterventionInput> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'Expected application/json');
  const input = await readBody(req) as InterventionInput;
  try { validate(input, schema.$defs.interventionInput, schema); }
  catch { throw new HttpError(400, 'Invalid intervention'); }
  return input;
}
export async function intervene(store: Store, req: IncomingMessage) {
  const input = await readIntervention(req);
  checkIntervention(store, input);
  const recent = store.interventions.filter(item => Date.parse(item.recordedAt as string) > Date.now() - 60000);
  if (recent.length >= 60) throw new HttpError(429, 'Intervention rate limit exceeded');
  const record = interventionRecord(store, input, req);
  store.interventions.push(record);
  store.publish('intervention.recorded', record);
  return record;
}
