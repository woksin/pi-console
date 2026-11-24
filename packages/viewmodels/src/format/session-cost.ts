import type { Session } from '@pi-console/contract';
import { money } from './format.ts';

/** Explicit observations win, including null and genuine zero. Legacy zeros were placeholders. */
export function sessionCost(session: Session): number | null {
  if (session.costUsd !== undefined) return session.costUsd;
  const total = session.samples.reduce((sum, sample) => sum + sample.costUsd, 0);
  return total > 0 ? total : null;
}

export function sessionCostLabel(session: Session): string {
  const cost = sessionCost(session);
  if (cost === null) return '—';
  return `${money(cost)}${session.costIncomplete ? ' (known)' : ''}`;
}

export function fleetCostLabel(sessions: readonly Session[]): string {
  const known = sessions.flatMap(session => {
    const cost = sessionCost(session);
    return cost === null ? [] : [cost];
  });
  if (known.length === 0) return '—';
  const total = money(known.reduce((sum, value) => sum + value, 0));
  if (known.length === sessions.length && !sessions.some(session => session.costIncomplete)) return total;
  return `${total} (known; ${String(known.length)}/${String(sessions.length)} sessions)`;
}
