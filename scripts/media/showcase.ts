// Gallery-only synthetic state for the web captures: health that agrees with the stream, the empty first-run fixture, the
// controlled live events and the memory-review receipt stages. Pure helpers: nothing here launches a browser or touches production code.
import type { MemoryActionReceipt } from '@pi-console/contract';
import { memoryItems } from '../../packages/testkit/src/mock-daemon/memory.ts';
import { needsYou } from '../../packages/testkit/src/mock-daemon/needs-you.ts';
import type { Store } from '../../packages/testkit/src/mock-daemon/store.ts';
import { fixedNow } from './scenes.ts';

type Fixture = Store['fixture'];
type Session = Fixture['sessions'][number];
type Question = Fixture['questions'][number];

/** The adapters a gallery daemon reports; the Settings Sources panel shows each one as available. */
export const showcaseSources = ['session-jsonl', 'issue-work', 'lane-messages'] as const;

/** `/api/v1/health` for the gallery: every sequence is the stream's own current sequence, so Settings can never disagree with itself. */
export function showcaseHealth(seq: number, clients: number) {
  return {
    status: 'ok', agentRootAvailability: 'available',
    eventLog: { lastSeq: seq, dbBytes: 4194304 }, projection: { position: seq, queueDepth: 0, skipped: 0 },
    stream: { seq, clients, retained: Math.min(seq, 512) }, backfill: { complete: true, windowDays: 7 },
    sources: showcaseSources.map(source => ({ source, files: 12, lagBytes: 0, lastPollAt: fixedNow, errors: 0, availability: 'available' })),
    memory: { rssBytes: 112197632, heapUsedBytes: 50331648 },
  };
}

/** Resolves once the sequence has stopped moving (the mock's t=0 replay is done); bounded, never a bare sleep. */
export async function quiesce(store: { seq(): number }, options: { stableMs?: number; timeoutMs?: number } = {}): Promise<number> {
  const { stableMs = 150, timeoutMs = 5000 } = options;
  const deadline = Date.now() + timeoutMs;
  let last = store.seq();
  let since = Date.now();
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    const now = store.seq();
    if (now !== last) { last = now; since = Date.now(); }
    else if (last > 0 && Date.now() - since >= stableMs) return last;
  }
  throw new Error('The mock daemon sequence never settled');
}

/** Every collection the snapshot is built from, emptied in place: the next snapshot has zero totals and no transcript cursors. */
export function emptyFixture(fixture: Fixture): void {
  for (const name of ['repositories', 'sessions', 'requests', 'questions', 'messages', 'jobs', 'resets', 'transcript'] as const) fixture[name].length = 0;
}

/** The first session of a status that Needs you does not mention, so a live change to it is visibly new. */
export function quietSession(fixture: Fixture, status: Session['status']): Session {
  const needy = new Set(needsYou(fixture).items.map(item => item.sessionId));
  const found = fixture.sessions.find(session => session.status === status && !needy.has(session.id));
  if (!found) throw new Error(`No ${status} session without attention in the fixture`);
  return found;
}

export const finishedSession = (session: Session): Session => ({ ...session, status: 'done', updatedAt: '2026-11-20T11:59:00Z', contextPercent: Math.min(session.contextPercent, 40) });

export const liveQuestionText = 'Approve the cache sweep before the nightly window starts?';
export const liveQuestion = (sessionId: string): Question => ({
  id: 'q-live-1', sessionId, kind: 'approval', text: liveQuestionText, options: ['Approve', 'Hold until morning'],
  urgency: 'high', blocking: true, status: 'open', createdAt: '2026-11-20T11:58:00Z',
}) as Question;

/** "N things need you" -> N; null for the calm headline or anything else. */
export function needsYouCount(headline: string): number | null {
  const match = /^(\d+) things? needs? you\b/.exec(headline.trim());
  return match ? Number(match[1]) : null;
}

export const memoryReviewText = 'Keep retry checkpoints before acknowledging the batch';
export const memoryReviewItem = 'item-2';
export const memoryReviewSession = 's2';

/** Gallery-only edits of the module-global mock memory store; the returned function puts every field back. */
export function prepareMemoryReview(): () => void {
  const target = memoryItems().find(item => item.id === memoryReviewItem);
  if (!target) throw new Error(`${memoryReviewItem} is not in the mock memory store`);
  const saved = structuredClone(target);
  Object.assign(target, { sessionId: memoryReviewSession, scope: { kind: 'session', key: memoryReviewSession }, text: memoryReviewText });
  return () => { Object.assign(target, saved); };
}

/** What the producer records once it has applied the confirmation: the item becomes active; the receipt alone never does this. */
export function applyProducerConfirmation(): void {
  const target = memoryItems().find(item => item.id === memoryReviewItem);
  if (!target) throw new Error(`${memoryReviewItem} is not in the mock memory store`);
  Object.assign(target, { status: 'active', statusBasis: 'recorded', command: null });
}

/** A synthetic provider receipt for one stage; times are the shared capture time so the browser's fixed clock never sees it expire. */
export function memoryReceipt(state: MemoryActionReceipt['state'], posted: { requestId: string; itemId: string; action: string }) {
  const now = Date.parse(fixedNow);
  return {
    version: 1, ...posted, sessionId: memoryReviewSession, generation: 'gallery-s2', connectionGeneration: 'gallery-c1', tokenId: 'synthetic-control',
    state, reason: null, eventId: null, createdAt: now, updatedAt: now, expiresAt: now + 60_000,
  };
}

/** The review's stage order; every stage appears once and only `observed-applied` may follow `awaiting-ingestion`. */
export const memoryReviewStages = ['awaiting-human', 'awaiting-ingestion', 'observed-applied'] as const satisfies readonly MemoryActionReceipt['state'][];
