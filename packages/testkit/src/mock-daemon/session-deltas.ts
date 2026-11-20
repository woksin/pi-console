import type { generate } from '../fixture/generate.ts';
import { needsYou } from './needs-you.ts';

type Fixture = ReturnType<typeof generate>['fixture'];
type MockSession = Fixture['sessions'][number];

/** Entity updates invalidate attention queries; changed derived sessions also get their own upserts. */
export function sessionDeltas(fixture: Fixture, bases: Map<string, MockSession['status']>, change: { type: string; payload: unknown }, apply: () => void): MockSession[] {
  const collection = attentionCollection(fixture, change.type);
  if (!collection) { apply(); return []; }
  const entity = change.payload as { id: string; sessionId: string };
  const previous = collection.find(item => item.id === entity.id);
  const owners = new Set([previous?.sessionId, entity.sessionId]);
  const sessions = fixture.sessions.filter(session => owners.has(session.id));
  const before = needsYou(fixture).items;
  apply();
  const after = needsYou(fixture).items;
  return sessions.flatMap(session => {
    const oldItems = before.filter(item => item.sessionId === session.id);
    const newItems = after.filter(item => item.sessionId === session.id);
    if (session.status !== 'needs-you') bases.set(session.id, session.status);
    const status = statusWithAttention(session, bases.get(session.id) ?? 'idle', newItems.length > 0);
    if (status === session.status && JSON.stringify(oldItems) === JSON.stringify(newItems)) return [];
    return [{ ...session, status }];
  });
}

function statusWithAttention(session: MockSession, base: MockSession['status'], hasAttention: boolean): MockSession['status'] {
  if (session.status === 'done' || session.status === 'failed') return session.status;
  return hasAttention ? 'needs-you' : base;
}

function attentionCollection(fixture: Fixture, type: string): { id: string; sessionId: string }[] | undefined {
  if (type === 'request.observed' || type === 'request.interrupted') return fixture.requests;
  if (type === 'question.asked') return fixture.questions;
  return undefined;
}
