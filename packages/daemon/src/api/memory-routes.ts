import type { SessionMemory } from '@pi-console/contract';
import { memoryStatuses, type ConsoleQueries, type MemoryItemStatus } from '@pi-console/core';
import { HttpError } from '../security/guard.ts';
import type { MemoryHandoffReader } from './memory-handoffs.ts';

const handoffLimit = 5;

/** `status` for `/memory-items`: one of the six item statuses. */
export function memoryStatus(url: URL): MemoryItemStatus | undefined {
  const status = url.searchParams.get('status');
  if (status === null) return undefined;
  const known = memoryStatuses.find(candidate => candidate === status);
  if (!known) throw new HttpError(400, 'Invalid status');
  return known;
}

/** The session's summary plus the figures from its newest handoff files; the exact unresolved count is the producer's, as of the last handoff. */
export async function sessionMemory(queries: ConsoleQueries, handoffs: MemoryHandoffReader, sessionId: string): Promise<SessionMemory> {
  const summary = queries.sessionMemory(sessionId);
  if (!summary) throw new HttpError(404, 'Session not found');
  const read = await handoffs.read(queries.resets().filter(reset => reset.sessionId === sessionId), handoffLimit);
  const last = read.find(handoff => (handoff.memoryIndex ?? handoff.resumeCheck) !== null);
  const count = last?.memoryIndex?.unresolved ?? last?.resumeCheck?.unresolvedMessages;
  const atLastHandoff = last && count !== undefined ? { count, at: last.at } : null;
  return { ...summary, unresolved: { ...summary.unresolved, atLastHandoff }, handoffs: read };
}
