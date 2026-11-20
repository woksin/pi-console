import type { Health, Settings } from '@pi-console/contract';
import { InvalidCursorError, requestFilters, type ConsoleQueries, type PageCollection, type PageQuery, type RequestFilter } from '@pi-console/core';
import { apiPrefix, HttpError } from '../security/guard.ts';
import type { TranscriptReader } from './transcripts.ts';

export interface ApiContext {
  queries: () => ConsoleQueries;
  transcripts: TranscriptReader;
  health: () => Health;
  settings: () => Settings;
}

type Route = (context: ApiContext, url: URL) => unknown;

function queryInteger(url: URL, name: string, fallback: number, maximum: number): number {
  const text = url.searchParams.get(name);
  if (text === null) return fallback;
  if (!/^\d+$/.test(text)) throw new HttpError(400, `Invalid ${name}`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > maximum) throw new HttpError(400, `Invalid ${name}`);
  return value;
}

function requestFilter(url: URL): RequestFilter {
  const filter = url.searchParams.get('filter') ?? 'all';
  const known = requestFilters.find(candidate => candidate === filter);
  if (!known) throw new HttpError(400, 'Invalid filter');
  return known;
}

/** Paging parameters, present only when the client sends `limit` (1..1000); otherwise the list stays complete. */
function pageQuery(url: URL, collection: PageCollection): PageQuery | undefined {
  if (url.searchParams.get('limit') === null) return undefined;
  const limit = queryInteger(url, 'limit', 0, 1000);
  if (limit === 0) throw new HttpError(400, 'Invalid limit');
  const order = url.searchParams.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') throw new HttpError(400, 'Invalid order');
  const query: PageQuery = { limit, order, after: url.searchParams.get('after') ?? undefined };
  const sessionId = url.searchParams.get('sessionId');
  if (sessionId !== null && collection !== 'sessions') query.sessionId = sessionId;
  if (collection === 'requests') query.filter = requestFilter(url);
  return query;
}

/** A list route: a keyset page when `limit` is sent, the complete `{items}` otherwise. */
function listRoute(collection: PageCollection, complete: (context: ApiContext, url: URL) => unknown[]): Route {
  return (context, url) => {
    const query = pageQuery(url, collection);
    if (!query) return { items: complete(context, url) };
    try {
      return context.queries().page(collection, query);
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new HttpError(400, error.message);
      throw error;
    }
  };
}

function transcript(context: ApiContext, sessionId: string, url: URL): unknown {
  const limit = queryInteger(url, 'limit', 100, 1000);
  if (limit === 0) throw new HttpError(400, 'Invalid limit');
  const around = url.searchParams.get('around');
  if (around === null) return context.transcripts.page(sessionId, queryInteger(url, 'after', 0, Number.MAX_SAFE_INTEGER), limit);
  const window = context.transcripts.around(sessionId, around, limit);
  if (!window) throw new HttpError(404, 'Transcript entry not found');
  return window;
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, 'Invalid path');
  }
}

/** `/sessions/:id` and `/sessions/:id/transcript`. */
function session(context: ApiContext, url: URL, parts: string[]): unknown {
  const sessionId = decoded(parts[0]);
  const detail = context.queries().session(sessionId);
  if (!detail) throw new HttpError(404, 'Session not found');
  if (parts.length === 1) return detail;
  if (parts.length === 2 && parts[1] === 'transcript') return transcript(context, sessionId, url);
  throw new HttpError(404, 'Not found');
}

const routes = new Map<string, Route>(Object.entries({
  overview: context => context.queries().overview(),
  sessions: listRoute('sessions', context => context.queries().sessions()),
  requests: listRoute('requests', (context, url) => context.queries().requests(requestFilter(url))),
  questions: listRoute('questions', context => context.queries().questions()),
  messages: listRoute('messages', context => context.queries().messages()),
  jobs: listRoute('jobs', context => context.queries().jobs()),
  resets: listRoute('resets', context => context.queries().resets()),
  'needs-you': context => ({ items: context.queries().needsYou() }),
  graph: context => context.queries().graph(),
  health: context => context.health(),
  settings: context => context.settings(),
} satisfies Record<string, Route>));

/** Read-only API v1 queries (docs/api/v1.md). Throws `HttpError` for unknown paths and invalid parameters. */
export function apiQuery(context: ApiContext, url: URL): unknown {
  const parts = url.pathname.slice(apiPrefix.length + 1).split('/');
  if (parts[0] === 'sessions' && parts.length > 1) return session(context, url, parts.slice(1));
  const route = parts.length === 1 ? routes.get(parts[0]) : undefined;
  if (!route) throw new HttpError(404, 'Not found');
  return route(context, url);
}
