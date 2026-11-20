import type { NewEvent } from '@pi-console/contract';
import { testEvent } from './events.ts';

/** Small seeded PRNG (mulberry32) so scenarios are identical on every run. */
export function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Maker = (n: number, pick: <T>(items: readonly T[]) => T) => [string, unknown];

const sessions = ['s1', 's2', 's3', 's4'];
const lanes = ['lane-a', 'lane-b', 'lane-c'];

const makers: Maker[] = [
  (n, pick) => ['SessionStarted', { sessionId: pick(sessions), cwd: '/repo/x', model: pick(['m1', 'm2', null]), role: pick(['main', 'orchestrator', 'subagent']), parentSessionId: null }],
  (n, pick) => ['ModelChanged', { sessionId: pick(sessions), model: pick(['m1', 'm2', 'm3']), previousModel: null }],
  (n, pick) => ['ThinkingLevelChanged', { sessionId: pick(sessions), level: pick(['low', 'high']) }],
  (n, pick) => ['TurnStarted', { sessionId: pick(sessions), turnId: `t${n % 5}` }],
  (n, pick) => ['TurnEnded', { sessionId: pick(sessions), turnId: `t${n % 5}`, stopReason: null, usage: { inputTokens: n, outputTokens: 2 } }],
  (n, pick) => ['ContextPressureSampled', { sessionId: pick(sessions), percent: n % 101, tokens: n * 10 }],
  (n, pick) => ['ResetOccurred', { sessionId: pick(sessions), resetId: `r${n % 7}`, kind: pick(['handoff', 'compaction', 'relaunch']), carriedRequestIds: [], interruptedRequestIds: [] }],
  (n, pick) => ['SessionHeartbeat', { sessionId: pick(sessions), status: pick(['ok', 'busy']) }],
  (n, pick) => ['SessionEnded', { sessionId: pick(sessions), reason: 'exit' }],
  (n, pick) => ['RequestObserved', { requestId: `q${n % 9}`, sessionId: pick(sessions), origin: pick(['human', 'launch', 'unproven']), originEvidence: 'spec', excerpt: `ask ${n}`, withheld: false }],
  (n) => ['AnswerObserved', { requestId: `q${n % 9}`, answerId: `a${n}`, interim: n % 3 === 0, excerpt: `answer ${n}`, withheld: false }],
  (n, pick) => ['RequestInterrupted', { requestId: `q${n % 9}`, sessionId: pick(sessions), resetId: null }],
  (n, pick) => ['QuestionAsked', { questionId: `k${n % 6}`, asker: pick(sessions), kind: 'decision', options: ['yes', 'no'], urgency: 'high', blocking: n % 2 === 0, excerpt: `decide ${n}` }],
  (n, pick) => [pick(['QuestionAnswered', 'QuestionDeferred', 'QuestionClosed']), { questionId: `k${n % 6}`, until: null, reason: 'done', excerpt: 'ok' }],
  (n, pick) => ['MessageSent', { messageId: `m${n % 11}`, from: pick(lanes), to: pick(lanes), excerpt: `hello ${n}`, withheld: false }],
  (n) => [n % 2 ? 'MessageDelivered' : 'MessageRead', { messageId: `m${n % 11}` }],
  (n, pick) => ['LaneRegistered', { laneId: pick(lanes), name: `Lane ${n}`, repositoryId: null }],
  (n, pick) => ['LaneStatusChanged', { laneId: pick(lanes), status: pick(['working', 'waiting']), waitingOn: pick(['user', 'lane-b', null]), barredBy: null, parked: false }],
  (n, pick) => ['JobStarted', { jobId: `j${n % 8}`, sessionId: pick(sessions), name: 'build', kind: pick(['job', 'ci']) }],
  (n) => ['JobFinished', { jobId: `j${n % 8}`, status: n % 2 ? 'done' : 'failed', exitCode: n % 2 ? 0 : 1 }],
  (n) => ['PhaseFinished', { phaseId: `p${n % 4}`, label: 'gate', exitCode: n % 3 }],
  (n, pick) => ['SubagentStarted', { sessionId: pick(sessions), parentSessionId: 's1', name: null }],
  (n) => ['ReviewRecorded', { reviewId: `v${n % 3}`, headSha: 'abc', verdict: 'approve' }],
];

/** Raw, unpaired session-JSONL observations (S1 adapter shape) for the request derivation. */
const rawRequestMakers: Maker[] = [
  (n, pick) => ['RequestObserved', { raw: true, requestId: `${n}`, sessionId: pick(sessions), entryId: `e${n}`, origin: 'unproven', originEvidence: 'spec', excerpt: `prompt ${n}`, withheld: false }],
  (n, pick) => ['AnswerObserved', { raw: true, sessionId: pick(sessions), entryId: `e${n}`, answerId: `ra${n}`, interim: false, excerpt: `reply ${n}`, withheld: n % 13 === 0 }],
  (n, pick) => ['RequestInterrupted', { raw: true, sessionId: pick(sessions), entryId: `e${n}`, reason: 'aborted' }],
];

export interface ScenarioOptions { count: number; seed?: number; jitterSeconds?: number; rawRequests?: boolean }

/**
 * A mixed stream over every M1 event type plus some the console must skip (unknown type, future version, bad
 * payload). `rawRequests` adds unpaired session-JSONL request facts. `jitterSeconds` moves occurredAt off arrival order to imitate backfill late arrivals.
 */
export function scenario({ count, seed = 7, jitterSeconds = 0, rawRequests = false }: ScenarioOptions): NewEvent[] {
  const random = seeded(seed);
  const all = rawRequests ? [...makers, ...rawRequestMakers, ...rawRequestMakers] : makers;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  return Array.from({ length: count }, (_, n) => {
    const offset = Math.round((random() - 0.5) * 2 * jitterSeconds) * 1000;
    const occurredAt = new Date(Date.UTC(2026, 10, 20, 8) + n * 1000 + offset).toISOString();
    if (n % 97 === 13) return { ...testEvent(n, 'SessionHeartbeat', { sessionId: 's1' }, { occurredAt }), version: 9 };
    if (n % 89 === 5) return testEvent(n, 'SomethingNew', { anything: true }, { occurredAt });
    if (n % 83 === 3) return testEvent(n, 'TurnStarted', { sessionId: 's1' }, { occurredAt });
    const [type, payload] = pick(all)(n, pick);
    return testEvent(n, type, payload, { occurredAt, refs: { file: '/s.jsonl', offset: n * 100, entryId: `e${n}` } });
  });
}
