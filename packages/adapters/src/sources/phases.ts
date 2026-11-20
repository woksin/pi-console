import type { Mapper } from '../tailing/events.ts';
import { fact, integer, object, text } from '../values.ts';

/** Ledger rows arrive at completion; their explicit timestamps can be backfilled. */
export const phaseMapper: Mapper = value => {
  const row = object(value);
  if (row.v !== 1) throw new Error('Unknown phase version');
  const phaseId = `${text(row.argvHash)}:${text(row.queuedAt)}`;
  const emit = (type: string, payload: Record<string, unknown>, at: unknown) => fact(type, `phase:${phaseId}`, { phaseId, label: text(row.label), ...payload }, at, phaseId);
  const facts = [emit('PhaseQueued', { label: text(row.label) }, row.queuedAt)];
  if (row.startedAt == null) return facts;
  facts.push(emit('PhaseStarted', {}, row.startedAt));
  const statuses = new Map<unknown, string>([['passed', 'done'], ['failed', 'failed'], ['timeout', 'failed'], ['cancelled', 'cancelled'], ['error', 'failed']]);
  const status = statuses.get(row.outcome);
  if (!status) throw new Error('Unknown phase outcome');
  facts.push(emit('PhaseFinished', { status, exitCode: row.exit == null ? null : integer(row.exit) }, row.endedAt));
  return facts;
};
