import type { Health, Settings } from '@pi-console/contract';
import { requestFilters, type ConsoleQueries, type RequestFilter } from '@pi-console/core';
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
  sessions: context => ({ items: context.queries().sessions() }),
  requests: (context, url) => ({ items: context.queries().requests(requestFilter(url)) }),
  questions: context => ({ items: context.queries().questions() }),
  messages: context => ({ items: context.queries().messages() }),
  jobs: context => ({ items: context.queries().jobs() }),
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
