import type { MemoryItem, SessionMemory } from '@pi-console/contract';
import type { Store } from './store.ts';

// MOCK intent memory, synthetic only. The real definitions live in the daemon core; the mock holds a small fixed
// store for the first session so web and TUI can render every status, and the conformance suite can walk the routes.

const at = (minute: number) => `2026-07-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
const item = (n: number, over: Partial<MemoryItem> = {}): MemoryItem => ({
  id: `item-${String(n)}`, kind: 'directive', scope: { kind: 'session', key: 's1' }, sessionId: 's1', status: 'active', statusBasis: 'assumed',
  text: `synthetic memory item ${String(n)}`, withheld: false, sourceType: 'user_message', sourceMessageId: `msg-${String(n)}`, at: at(n), command: null, ...over,
});

const items: MemoryItem[] = [
  item(1), item(2, { kind: 'order', sourceType: 'coordinator_order', sourceMessageId: null, status: 'proposed', statusBasis: 'recorded', command: '/memory confirm item-2' }),
  item(3, { kind: 'decision', sourceType: 'agent_decision', status: 'active', statusBasis: 'recorded' }),
  item(4, { status: 'done', statusBasis: 'recorded' }), item(5, { status: 'superseded', statusBasis: 'recorded' }),
  item(6, { status: 'withdrawn', statusBasis: 'recorded' }), item(7, { status: 'rejected', statusBasis: 'recorded', withheld: true, text: '' }),
  item(8, { scope: { kind: 'global', key: 'all' }, sessionId: null }),
];

export const memoryItems = (): MemoryItem[] => items;

/** The summary for a known session; the first session carries the synthetic store, the rest report none. */
export function sessionMemory(store: Store, sessionId: string): SessionMemory | undefined {
  if (!store.fixture.sessions.some(session => session.id === sessionId)) return undefined;
  const own = store.memory.filter(row => row.sessionId === sessionId);
  const count = (status: MemoryItem['status']) => own.filter(row => row.status === status).length;
  return {
    sessionId, storeDetected: true,
    counts: { active: count('active'), proposed: count('proposed'), done: count('done'), superseded: count('superseded'), withdrawn: count('withdrawn'), rejected: count('rejected') },
    proposedConfirmable: own.filter(row => row.status === 'proposed' && row.statusBasis === 'recorded').length,
    unresolved: { lowerBound: sessionId === 's1' ? 2 : 0, atLastHandoff: sessionId === 's1' ? { count: 3, at: store.memoryHandoffAt } : null },
    wider: store.memory.filter(row => row.sessionId === null && ['active', 'proposed'].includes(row.status)).length,
    handoffs: sessionId === 's1' ? [{
      handoffId: 'sess-1-1.md', at: store.memoryHandoffAt, degraded: false,
      memoryIndex: { items: 8, messages: 4, unresolved: 3, withheld: 1, proposed: 1, rejected: 1 }, resumeCheck: { activeDirectives: 3, unresolvedMessages: 3, proposedItems: 1 },
    }] : [],
  };
}

