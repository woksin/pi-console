import type { Snapshot } from '@pi-console/contract';
import type { AttentionItem } from '../attention/needs-you.ts';
import type { ReadModels } from '../projections/index.ts';
import { attentionSessionIds, jobEntries, messageEntries, questionEntries, referencedBy, requestEntries, resetEntries, sessionEntries } from './collections.ts';
import { compareEntries, newest, sortedEntries, windowOf } from './paging.ts';
import { repositoryName } from './entities.ts';
import { compareText } from '../projector/canonical.ts';

/** Newest items per collection that the screen snapshot carries on top of every active one. */
export const recentWindow = 200;
/** Sessions are kept whole up to this count; beyond it they are windowed like the other collections. */
export const sessionCap = 500;

type Bounded = NonNullable<Snapshot['bounded']>;

/**
 * Bounded screen state: every active item plus the newest `recent` of each collection, with full totals. The
 * selection depends only on read-model state, so the same models always give the same snapshot.
 */
export function screenSnapshot(models: ReadModels, attention: readonly AttentionItem[], generatedAt: string, recent = recentWindow): Snapshot {
  const referenced = referencedBy(attention);
  const jobs = workWindow(models, recent);
  const requests = windowOf(requestEntries(models, referenced), recent);
  const questions = windowOf(questionEntries(models, referenced), recent);
  const messages = windowOf(messageEntries(models), recent);
  const everySession = sessionEntries(models, attentionSessionIds(attention));
  const owners = new Set<string>([...jobs.items, ...requests.items, ...questions.items].map(item => item.sessionId));
  for (const message of messages.items) { owners.add(message.fromSessionId); owners.add(message.toSessionId); }
  const keep = everySession.length <= sessionCap ? everySession : withAncestors(everySession, owners, recent);
  const sessions = sortedEntries(keep).map(entry => entry.build());
  const allResets = resetEntries(models);
  const keptIds = new Set(sessions.map(session => session.id));
  const resets = newest(allResets.filter(entry => keptIds.has(entry.build().sessionId)), recent).map(entry => entry.build());
  const repositories = [...new Set(everySession.map(entry => entry.build().repositoryId))].sort(compareText)
    .map(id => ({ id, name: repositoryName(id) }));
  const bounded: Bounded = [];
  if (sessions.length < everySession.length) bounded.push('sessions');
  if (requests.bounded) bounded.push('requests');
  if (questions.bounded) bounded.push('questions');
  if (messages.bounded) bounded.push('messages');
  if (jobs.bounded) bounded.push('jobs');
  if (resets.length < allResets.length) bounded.push('resets');
  return {
    version: 0, generatedAt, repositories, sessions, requests: requests.items, questions: questions.items,
    messages: messages.items, jobs: jobs.items, resets, transcriptCursors: [], interventions: [],
    totals: {
      sessions: everySession.length, requests: requests.total, questions: questions.total, messages: messages.total,
      jobs: jobs.total, resets: allResets.length,
    },
    bounded,
  };
}

function workWindow(models: ReadModels, recent: number) {
  return models.workQueries ? models.workQueries.window(recent) : windowOf(jobEntries(models), recent);
}

/** Active and newest sessions, plus sessions that own kept items, plus every parent of a kept session. */
function withAncestors(all: ReturnType<typeof sessionEntries>, owners: Set<string>, recent: number) {
  const byId = new Map(all.map(entry => [entry.id, entry]));
  const chosen = new Map(all.filter(entry => entry.active || owners.has(entry.id)).map(entry => [entry.id, entry]));
  for (const entry of newest(all, recent)) chosen.set(entry.id, entry);
  for (const entry of [...chosen.values()].sort(compareEntries)) {
    let parent = entry.build().parentSessionId;
    while (parent !== null && !chosen.has(parent)) {
      const found = byId.get(parent);
      if (!found) break;
      chosen.set(parent, found);
      parent = found.build().parentSessionId;
    }
  }
  return [...chosen.values()];
}
