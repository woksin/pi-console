import type { Graph, Job, MemoryItem, Message, Overview, Question, Request, Reset, Session, SessionDetail, SessionMemory, Snapshot } from '@pi-console/contract';
import { needsYou, type AttentionItem } from '../attention/needs-you.ts';
import { compareText } from '../projector/canonical.ts';
import type { ReadModels } from '../projections/index.ts';
import { graphOf } from './graph.ts';
import { sparkline } from './sparkline.ts';
import { jobEntries, messageEntries, questionEntries, referencedBy, requestEntries, resetEntries, sessionEntries } from './collections.ts';
import { pageOf, type Entry, type Page, type PageCollection, type PageParams } from './paging.ts';
import { memoryEntries, memoryStatuses, sessionMemory } from './memory.ts';
import type { MemoryItemStatus } from '../projections/memory.ts';
import { screenSnapshot } from './screen-snapshot.ts';
import { repositoryName, resetsOf, toJob, toMessage, toQuestion, toRequest, toSession } from './entities.ts';

export type RequestFilter = 'all' | 'unanswered' | 'interrupted';
export interface PageQuery extends PageParams { filter?: RequestFilter; sessionId?: Session['id']; status?: MemoryItemStatus }

export const requestFilters: readonly RequestFilter[] = ['all', 'unanswered', 'interrupted'];
export { memoryStatuses };

type Listed = Session | Request | Question | Message | Job | Reset | MemoryItem;

/** Own-property lookup: ingested ids may be JavaScript prototype property names. */
const own = <Row>(rows: Record<string, Row>, id: keyof typeof rows): Row | undefined => Object.hasOwn(rows, id) ? rows[id] : undefined;

const statuses = ['working', 'needs-you', 'blocked', 'waiting', 'idle', 'done', 'failed'] as const;

const by = <T>(...keys: ((item: T) => string)[]) => (a: T, b: T) => {
  for (const key of keys) {
    const order = compareText(key(a), key(b));
    if (order !== 0) return order;
  }
  return 0;
};

/**
 * The API v1 read side, over the projector's read models. Pure apart from `now`, which only feeds the
 * attention definition (stale sessions); every list has a total, locale-independent order.
 */
export class ConsoleQueries {
  readonly #models: () => ReadModels;
  readonly #now: () => Date;

  constructor(models: () => ReadModels, now: () => Date = () => new Date()) {
    this.#models = models;
    this.#now = now;
  }

  needsYou(): AttentionItem[] {
    return needsYou(this.#models(), { now: this.#now() });
  }

  sessions(): Session[] {
    const models = this.#models();
    const attention = this.needsYou();
    return Object.values(models.sessions.sessions)
      .map(session => toSession(models, session, attention))
      .sort(by(session => session.startedAt, session => session.id));
  }

  sessionById(id: Session['id']): Session | undefined {
    const models = this.#models();
    const row = own(models.sessions.sessions, id);
    return row ? toSession(models, row, this.needsYou()) : undefined;
  }

  session(id: Session['id']): SessionDetail | undefined {
    const sessions = this.sessions();
    const session = sessions.find(item => item.id === id);
    if (!session) return undefined;
    const belongs = (item: Pick<Request, 'sessionId'>) => item.sessionId === id;
    return {
      session, requests: this.requests().filter(belongs), questions: this.questions().filter(belongs),
      jobs: this.jobs().filter(belongs), resets: this.resets().filter(belongs),
      subagents: sessions.filter(item => item.parentSessionId === id),
    };
  }

  requests(filter: RequestFilter = 'all'): Request[] {
    return Object.values(this.#models().requests.requests)
      .filter(request => request.createdAt !== '')
      .filter(request => filter === 'all' || request.status === filter)
      .map(toRequest)
      .sort(by(request => request.createdAt, request => request.id));
  }

  requestById(id: Request['id']): Request | undefined {
    const row = own(this.#models().requests.requests, id);
    return row && row.createdAt !== '' ? toRequest(row) : undefined;
  }

  questions(): Question[] {
    return Object.values(this.#models().questions.questions).filter(question => question.createdAt !== '')
      .map(toQuestion).sort(by(question => question.createdAt, question => question.id));
  }

  questionById(id: Question['id']): Question | undefined {
    const row = own(this.#models().questions.questions, id);
    return row && row.createdAt !== '' ? toQuestion(row) : undefined;
  }

  /** Messages whose send has been seen; receipts that arrived first wait until it is. */
  messages(): Message[] {
    return Object.values(this.#models().messages.messages)
      .filter(message => message.sentAt !== '')
      .map(toMessage)
      .sort(by(message => message.sentAt, message => message.id));
  }

  messageById(id: Message['id']): Message | undefined {
    const row = own(this.#models().messages.messages, id);
    return row && row.sentAt !== '' ? toMessage(row) : undefined;
  }

  jobById(id: Job['id']): Job | undefined {
    const row = own(this.#models().work.jobs, id);
    return row ? toJob(row) : undefined;
  }

  jobs(): Job[] {
    return Object.values(this.#models().work.jobs).map(toJob).sort(by(job => job.startedAt, job => job.id));
  }

  resets(): Reset[] {
    return Object.values(this.#models().sessions.sessions).flatMap(resetsOf).sort(by(reset => reset.at, reset => reset.id));
  }

  // Reset ids are nested and need not be globally unique. Keep the list's existing tie-breaking semantics.
  resetById(id: Reset['id']): Reset | undefined { return this.resets().find(reset => reset.id === id); }

  repositories(): { id: string; name: string }[] {
    const ids = [...new Set(this.sessions().map(session => session.repositoryId))].sort(compareText);
    return ids.map(id => ({ id, name: repositoryName(id) }));
  }

  memoryItems(status?: MemoryItemStatus): MemoryItem[] {
    return memoryEntries(this.#models(), status).sort(by(entry => entry.key, entry => entry.id)).map(entry => entry.build());
  }

  /** The per-session summary without handoff figures (those are read on demand by the daemon); undefined for an unknown session. */
  sessionMemory(id: string): SessionMemory | undefined {
    return this.sessionById(id) ? sessionMemory(this.#models(), id) : undefined;
  }

  graph(): Graph {
    return graphOf(this.#models());
  }

  overview(): Overview {
    const sessions = this.sessions();
    const byStatus = Object.fromEntries(statuses.map(status => [status, sessions.filter(session => session.status === status).length])) as Overview['counts']['byStatus'];
    const needs = this.needsYou().flatMap(item => overviewItem(item));
    return { counts: { sessions: sessions.length, repositories: this.repositories().length, byStatus }, needsYou: needs, sparkline: sparkline(sessions) };
  }

  snapshot(generatedAt: Snapshot['generatedAt']): Snapshot {
    return {
      version: 0, generatedAt, repositories: this.repositories(), sessions: this.sessions(), requests: this.requests(),
      questions: this.questions(), messages: this.messages(), jobs: this.jobs(), resets: this.resets(),
      transcriptCursors: [], interventions: [],
    };
  }

  /** Bounded screen state for the stream: every active item plus the newest of each collection, with totals. */
  screenSnapshot(generatedAt: Snapshot['generatedAt'], recent?: number): Snapshot {
    return screenSnapshot(this.#models(), this.needsYou(), generatedAt, recent);
  }

  /** One keyset page of a list, in the list's total order (or its exact reverse). */
  page(collection: PageCollection, query: PageQuery): Page<Listed> {
    return pageOf<Listed>(collection, this.#pageEntries(collection, query), query);
  }

  /** Every entry of one list, narrowed to the queried session where the list belongs to sessions. */
  #pageEntries(collection: PageCollection, query: PageQuery): Entry<Listed>[] {
    const models = this.#models();
    const session = query.sessionId;
    const owned = (entry: { build: () => { sessionId: string | null } }) => session === undefined || entry.build().sessionId === session;
    const between = (entry: { build: () => Message }) => session === undefined || [entry.build().fromSessionId, entry.build().toSessionId].includes(session);
    const lists: Record<PageCollection, () => Entry<Listed>[]> = {
      sessions: () => sessionEntries(models, this.needsYou()),
      requests: () => requestEntries(models, referencedBy([]), query.filter).filter(owned),
      questions: () => questionEntries(models, referencedBy([])).filter(owned),
      messages: () => messageEntries(models).filter(between),
      jobs: () => jobEntries(models).filter(owned),
      resets: () => resetEntries(models).filter(owned),
      memoryItems: () => memoryEntries(models, query.status).filter(owned),
    };
    return lists[collection]();
  }
}

/** The v0 overview list only knows request and question items; lane and stale items live in `/needs-you`. */
function overviewItem(item: AttentionItem): Overview['needsYou'] {
  if (item.sessionId === null) return [];
  if (item.reason === 'blocking-question') return [{ id: item.id, sessionId: item.sessionId, kind: 'question', text: item.text }];
  if (item.reason === 'open-request' || item.reason === 'answer-possibly-unseen') return [{ id: item.id, sessionId: item.sessionId, kind: 'request', text: item.text }];
  return [];
}
