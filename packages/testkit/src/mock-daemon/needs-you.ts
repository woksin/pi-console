import type { AttentionItem, NeedsYou } from '@pi-console/contract';
import type { generate } from '../fixture/generate.ts';

type Fixture = ReturnType<typeof generate>['fixture'];

/**
 * MOCK attention policy, for client development only. The real definition lives once in the daemon core (P1);
 * the mock only has to exercise every reason and the transcript pointer so web and TUI can render them.
 * `unproven` prompts never raise an item (ADR-0008).
 */
export function needsYou(fixture: Fixture): NeedsYou {
  return { items: [...requestItems(fixture), ...questionItems(fixture), ...sessionItems(fixture)] };
}

/** Pointer to the transcript entry that carries the request, when the fixture transcript has one. */
function pointer(fixture: Fixture, sessionId: string, requestId: string): AttentionItem['pointer'] {
  const entry = fixture.transcript.find(item => item.sessionId === sessionId && item.requestId === requestId);
  return entry ? { sessionId, entryId: entry.id, fileOffset: entry.cursor * 128 } : null;
}

function requestItems(fixture: Fixture): AttentionItem[] {
  return fixture.requests.flatMap(request => {
    if (request.origin === 'unproven') return [];
    const reason = reasonFor(request);
    if (!reason) return [];
    return [{
      id: `need-${request.id}`, reason, sessionId: request.sessionId, laneId: null, text: request.text,
      since: request.createdAt, pointer: pointer(fixture, request.sessionId, request.id),
    }];
  });
}

function reasonFor(request: Fixture['requests'][number]): AttentionItem['reason'] | null {
  if (request.status === 'unanswered' || request.status === 'interrupted' || request.status === 'open') return 'open-request';
  if (request.status === 'answered' && request.origin === 'human') return 'answer-possibly-unseen';
  return null;
}

function questionItems(fixture: Fixture): AttentionItem[] {
  return fixture.questions.filter(question => question.blocking && question.status === 'open').map(question => ({
    id: `need-${question.id}`, reason: 'blocking-question', sessionId: question.sessionId, laneId: null,
    text: question.text, since: question.createdAt, pointer: null,
  }));
}

function sessionItems(fixture: Fixture): AttentionItem[] {
  return fixture.sessions.flatMap(session => {
    if (session.status === 'waiting') return [sessionItem(session, 'lane-waiting-on-user', `Lane ${session.laneId} is waiting on you`)];
    if (session.status === 'blocked') return [sessionItem(session, 'stale-session', `${session.name} has not progressed`)];
    return [];
  });
}

function sessionItem(session: Fixture['sessions'][number], reason: AttentionItem['reason'], text: string): AttentionItem {
  return { id: `need-${session.id}-${reason}`, reason, sessionId: session.id, laneId: session.laneId, text, since: session.updatedAt, pointer: null };
}
