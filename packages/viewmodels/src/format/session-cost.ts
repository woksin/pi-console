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
  return `${session.costIncomplete ? '≥' : ''}${money(cost)}`;
}

function knownCosts(sessions: readonly Session[]): number[] {
  return sessions.flatMap(session => {
    const cost = sessionCost(session);
    return cost === null ? [] : [cost];
  });
}

const isPartial = (sessions: readonly Session[], known: readonly number[]): boolean => known.length < sessions.length || sessions.some(session => session.costIncomplete);

/** `—` unknown, `$x` complete, `≥$x` partial; the coverage lives in {@link fleetCostCoverage}. */
export function fleetCostLabel(sessions: readonly Session[]): string {
  const known = knownCosts(sessions);
  if (known.length === 0) return '—';
  const total = money(known.reduce((sum, value) => sum + value, 0));
  return isPartial(sessions, known) ? `≥${total}` : total;
}

/** Secondary text for a partial fleet total ("28/30 sessions priced"); undefined when the total is complete or unknown. */
export function fleetCostCoverage(sessions: readonly Session[]): string | undefined {
  const known = knownCosts(sessions);
  if (known.length === 0 || !isPartial(sessions, known)) return undefined;
  return `${String(known.length)}/${String(sessions.length)} sessions priced`;
}
