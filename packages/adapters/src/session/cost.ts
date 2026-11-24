import type { Fact } from '../tailing/events.ts';

/** Optional usage is untrusted: malformed totals never suppress an otherwise valid answer. */
export function assistantCost(message: Record<string, unknown>): number | null {
  const usage = message.usage;
  if (!usage || typeof usage !== 'object') return null;
  const cost = (usage as Record<string, unknown>).cost;
  if (!cost || typeof cost !== 'object') return null;
  const total = (cost as Record<string, unknown>).total;
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : null;
}

/** Logical identity survives copies/rotations of the same transcript entry. */
export function costFact(sessionId: string, entryId: string, message: Record<string, unknown>): Fact {
  return {
    type: 'SessionCostObserved', subject: `session:${sessionId}`, entryId,
    logical: { identity: JSON.stringify(['assistant-cost', sessionId, entryId]), offset: 0 },
    payload: { sessionId, entryId, costUsd: assistantCost(message) },
  };
}
