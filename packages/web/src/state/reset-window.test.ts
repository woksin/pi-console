import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Reset, Snapshot } from '@pi-console/contract';
import { applyEvent, mergePage } from './reduce.ts';
import { emptyState } from './state.ts';

const reset = (id: string): Reset => ({ id, sessionId: 's1', at: '2026-01-01T00:00:00Z', kind: 'compaction', carriedRequestIds: [], interruptedRequestIds: [] });
const snapshot = (resets: Reset[]): Snapshot => ({
  version: 0, generatedAt: '2026-01-01T00:00:00Z', repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets,
  transcriptCursors: [], interventions: [], totals: { sessions: 0, requests: 0, questions: 0, messages: 0, jobs: 0, resets: 3000 }, bounded: ['resets'],
});

test('reset pages and live rows survive bounded reconnects without duplicates; complete snapshots replace them', () => {
  let state = applyEvent(emptyState(), { seq: 1, occurredAt: '2026-01-01T00:00:00Z', type: 'snapshot', payload: snapshot([reset('new')]) });
  state = mergePage(state, 'resets', { items: [reset('old'), reset('new')], nextCursor: null, hasMore: false, total: 3000 });
  state = applyEvent(state, { seq: 2, occurredAt: '2026-01-01T00:00:00Z', type: 'reset.occurred', payload: reset('live') });
  state = applyEvent(state, { seq: 3, occurredAt: '2026-01-01T00:00:00Z', type: 'snapshot', payload: snapshot([]) });
  assert.deepEqual(state.resets.map(row => row.id), ['live', 'new', 'old']);
  assert.equal(state.totals?.resets, 3000);
  assert.deepEqual(state.history, {});
  state = applyEvent(state, { seq: 4, occurredAt: '2026-01-01T00:00:00Z', type: 'snapshot', payload: { ...snapshot([]), bounded: [] } });
  assert.deepEqual(state.resets, []);
});
