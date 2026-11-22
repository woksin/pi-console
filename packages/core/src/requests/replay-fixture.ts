import type { EventEnvelope } from '@pi-console/contract';
import { testEvent } from '../testing/events.ts';

const envelope = (n: number, type: string, payload: unknown): EventEnvelope => {
  const event = testEvent(n, type, payload, { refs: { file: '/fixture.jsonl', offset: n, entryId: `entry-${n}` } });
  return { ...event, seq: n, recordedAt: event.occurredAt };
};
interface SessionPoint { n: number; sessionId: string }
const start = ({ n, sessionId }: SessionPoint) => envelope(n, 'SessionStarted', {
  sessionId, cwd: '/fixture', model: null, role: 'main', parentSessionId: null, parentSessionKnown: true,
});
const prompt = ({ n, sessionId }: SessionPoint) => envelope(n, 'RequestObserved', {
  raw: true, sessionId, requestId: `${sessionId}:${n}`, entryId: `entry-${n}`, excerpt: `prompt ${n}`, origin: 'unproven', originEvidence: 'fixture',
});
const answer = ({ n, sessionId }: SessionPoint) => envelope(n, 'AnswerObserved', {
  raw: true, sessionId, answerId: `answer-${n}`, entryId: `entry-${n}`, interim: false, excerpt: `answer ${n}`, withheld: n % 2 === 0,
});
const stated = (n: number, requestId: string, sessionId: string, entryId: string) => envelope(n, 'RequestObserved', {
  requestId, sessionId, entryId, origin: 'human', originEvidence: 'explicit fixture', excerpt: `stated ${n}`,
});

/** Small mixed fixture: shared answers, supersession, resets, overrides, moves and hostile dictionary keys. */
export function mixedRequestEvents(): EventEnvelope[] {
  return [
    start({ n: 1, sessionId: 's' }), prompt({ n: 2, sessionId: 's' }), envelope(3, 'ResetOccurred', { sessionId: 's', resetId: 'r1', kind: 'compaction' }),
    prompt({ n: 4, sessionId: 's' }), answer({ n: 5, sessionId: 's' }), envelope(6, 'ResetOccurred', { sessionId: 's', resetId: 'r2', kind: 'compaction' }), answer({ n: 7, sessionId: 's' }),
    prompt({ n: 8, sessionId: 's' }), envelope(9, 'RequestInterrupted', { raw: true, sessionId: 's', entryId: 'entry-9', reason: 'aborted' }),
    prompt({ n: 10, sessionId: 's' }), envelope(11, 'SessionEnded', { sessionId: 's', reason: 'exit' }),
    stated(12, 'stated', 's', 'entry-2'), envelope(13, 'AnswerObserved', { requestId: 'stated', answerId: 'interim', interim: true, excerpt: 'working' }),
    envelope(14, 'AnswerObserved', { requestId: 'stated', answerId: 'final', interim: false, excerpt: 'done' }),
    envelope(15, 'RequestInterrupted', { requestId: 'stated', sessionId: 's', resetId: 'r3' }),
    stated(16, 's:4', 's', 'entry-4'), stated(17, 's:4', 't', 'entry-4'),
    envelope(18, 'SubagentStarted', { sessionId: 's', parentSessionId: 'parent' }),
    envelope(19, 'AnswerObserved', { requestId: 's:20', answerId: 'explicit', interim: false, excerpt: 'stated answer' }), prompt({ n: 20, sessionId: 's' }), answer({ n: 21, sessionId: 's' }),
    envelope(22, 'ResetOccurred', { sessionId: 's', resetId: 'r4', kind: 'compaction', interruptedRequestIds: ['stated'] }),
    start({ n: 23, sessionId: '__proto__' }), stated(24, 'constructor', '__proto__', 'entry-24'),
  ];
}

/** Alternating prompt/answer requests, with bounded text and periodic explicit upgrades. */
export function* volumeRequestEvents(sessions: number, requests: number): Generator<EventEnvelope> {
  let n = 0;
  for (let s = 0; s < sessions; s++) {
    const sessionId = `session-${s}`;
    yield start({ n: ++n, sessionId });
    for (let r = 0; r < requests; r++) {
      const request = prompt({ n: ++n, sessionId });
      yield request;
      if (r % 20 === 0) yield stated(++n, (request.payload as { requestId: string }).requestId, sessionId, `entry-${request.seq}`);
      yield answer({ n: ++n, sessionId });
    }
  }
}
