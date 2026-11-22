import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Snapshot } from '@pi-console/contract';
import { timelineViewModel } from '@pi-console/viewmodels';
import { applyEvent, mergePage } from './reduce.ts';
import { emptyState, type ConsoleState } from './state.ts';

const at = '2026-01-01T00:00:00Z';
const collections = ['sessions', 'requests', 'questions', 'messages', 'resets'] as const;

function snapshot(id: string): Snapshot {
  const sessionId = `s-${id}`;
  return {
    version: 0, generatedAt: at, repositories: [], jobs: [], transcriptCursors: [], interventions: [], bounded: [...collections],
    totals: { sessions: 2, requests: 2, questions: 2, messages: 2, resets: 2, jobs: 0 },
    sessions: [{ id: sessionId, repositoryId: 'repo', name: id, laneId: id, role: 'main', parentSessionId: null, orchestratorSessionId: sessionId, branch: '', cwd: '', model: '', status: 'idle', startedAt: at, updatedAt: at, contextPercent: 0, samples: [] }],
    requests: [{ id: `r-${id}`, sessionId, text: id, origin: 'human', originLabel: 'Human request', originEvidence: '', status: 'answered', createdAt: at, resetId: null, answer: null, interimAnswers: [] }],
    questions: [{ id: `q-${id}`, sessionId, kind: 'question', text: id, options: [], urgency: 'normal', blocking: false, status: 'closed', createdAt: at }],
    messages: [{ id: `m-${id}`, fromSessionId: sessionId, toSessionId: sessionId, text: id, status: 'read', sentAt: at }],
    resets: [{ id: `reset-${id}`, sessionId, kind: 'compaction', at, carriedRequestIds: [], interruptedRequestIds: [] }],
  };
}

const frame = (seq: number, payload: Snapshot) => ({ seq, occurredAt: at, type: 'snapshot' as const, payload });

test('all Timeline collections page by ID, retain current values and preserve inactive history on reconnect', () => {
  const current = snapshot('new');
  const stale = snapshot('new');
  stale.requests[0].text = 'stale page value';
  stale.sessions[0].name = 'stale session name';
  const older = snapshot('old');
  let state = applyEvent(emptyState(), frame(1, current));
  for (const collection of ['requests', 'questions', 'messages', 'resets', 'sessions'] as const) {
    state = mergePage(state, collection, { items: stale[collection], nextCursor: 'opaque/+?cursor', hasMore: true, total: 2 });
    assert.equal(state[collection].length, 1, 'overlapping pages need not increase the loaded count');
    assert.deepEqual(state.history[collection], { cursor: 'opaque/+?cursor', more: true });
    state = mergePage(state, collection, { items: [...older[collection], ...stale[collection]], nextCursor: null, hasMore: false, total: 2 });
    assert.equal(state[collection].length, 2);
    assert.equal(new Set(state[collection].map(row => row.id)).size, 2);
    assert.equal(state.totals?.[collection], 2);
    assert.deepEqual(state.history[collection], { cursor: null, more: false });
    if (collection !== 'sessions') assert.equal(timelineViewModel({ ...state, width: 120 }).lanes.some(lane => lane.sessionId === 's-old'), false);
  }
  assert.equal(state.requests.find(row => row.id === 'r-new')?.text, 'new');
  assert.equal(state.sessions.find(row => row.id === 's-new')?.name, 'new');
  assert.ok(timelineViewModel({ ...state, width: 120 }).lanes.some(lane => lane.sessionId === 's-old' && lane.cells.length > 0));
  assertReconnect(state, current, older);
});

function assertReconnect(state: ConsoleState, current: Snapshot, older: Snapshot): void {
  state = applyEvent(state, { seq: 2, occurredAt: at, type: 'request.observed', payload: { ...older.requests[0], text: 'live update' } });
  state = applyEvent(state, frame(3, current));
  for (const collection of collections) assert.equal(state[collection].length, 2, `${collection} retains old inactive rows`);
  assert.equal(state.requests.find(row => row.id === 'r-old')?.text, 'live update');
  assert.deepEqual(state.history, {});
  state = applyEvent(state, frame(4, { ...current, bounded: [] }));
  for (const collection of collections) assert.equal(state[collection].length, 1, `${collection} respects complete snapshots`);
}
