import type { Job, Message, Question, Request, Reset, Session } from '@pi-console/contract';
import type { AttentionItem } from '../attention/needs-you.ts';
import type { ReadModels } from '../projections/index.ts';
import type { RequestFilter } from './console-queries.ts';
import type { Entry } from './paging.ts';
import { resetsOf, toJob, toMessage, toQuestion, toRequest, toSession } from './entities.ts';


/** Ids the "needs you" list points at, by kind (`request:`/`answer:` are requests, `question:`, `session:`). */
export interface Referenced { requests: Set<string>; questions: Set<string>; sessions: Set<string> }

export function referencedBy(attention: readonly AttentionItem[]): Referenced {
  const found: Referenced = { requests: new Set(), questions: new Set(), sessions: new Set() };
  for (const item of attention) {
    const separator = item.id.indexOf(':');
    const prefix = item.id.slice(0, separator);
    const id = item.id.slice(separator + 1);
    if (prefix === 'request' || prefix === 'answer') found.requests.add(id);
    else if (prefix === 'question') found.questions.add(id);
    else if (prefix === 'session') found.sessions.add(id);
  }
  return found;
}

const inactiveSession = new Set<Session['status']>(['done', 'idle', 'failed']);

export function sessionEntries(models: ReadModels, attention: readonly AttentionItem[]): Entry<Session>[] {
  return Object.values(models.sessions.sessions).map(row => {
    const session = toSession(models, row, attention);
    return { key: session.startedAt, id: session.id, active: !inactiveSession.has(session.status), build: () => session };
  });
}

export function resetEntries(models: ReadModels): Entry<Reset>[] {
  return Object.values(models.sessions.sessions).flatMap(resetsOf)
    .map(reset => ({ key: reset.at, id: reset.id, active: false, build: () => reset }));
}

export function jobEntries(models: ReadModels): Entry<Job>[] {
  return Object.values(models.work.jobs).map(row => ({ key: row.startedAt, id: row.id, active: row.status === 'running', build: () => toJob(row) }));
}

export function requestEntries(models: ReadModels, referenced: Referenced, filter: RequestFilter = 'all'): Entry<Request>[] {
  return Object.values(models.requests.requests)
    .filter(row => row.createdAt !== '' && (filter === 'all' || row.status === filter))
    .map(row => ({
      key: row.createdAt, id: row.id, build: () => toRequest(row),
      active: row.status !== 'answered' || referenced.requests.has(row.id),
    }));
}

export function questionEntries(models: ReadModels, referenced: Referenced): Entry<Question>[] {
  return Object.values(models.questions.questions).filter(row => row.createdAt !== '').map(row => ({
    key: row.createdAt, id: row.id, build: () => toQuestion(row),
    active: row.status === 'open' || referenced.questions.has(row.id),
  }));
}

export function messageEntries(models: ReadModels): Entry<Message>[] {
  return Object.values(models.messages.messages).filter(row => row.sentAt !== '')
    .map(row => ({ key: row.sentAt, id: row.id, active: row.status !== 'read', build: () => toMessage(row) }));
}
