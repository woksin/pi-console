import type { Session } from '@pi-console/contract';
import { money, sessionCost } from '@pi-console/viewmodels';

export const partialCostExplanation = 'Partial cost: known recorded usage only';

export interface FleetCostCell {
  /** What the cell shows: `—` unknown, `$0.00` a recorded zero, `≥$1.76` known usage of an incomplete total. */
  text: string;
  /** Plain-language form for assistive technology; present only when the visible text needs explaining. */
  spoken?: string;
  /** Tooltip explaining a partial cost. */
  title?: string;
}

/** The web Fleet cost cell from the session's own cost truth (never from the shared row label). */
export function fleetCostCell(session: Session): FleetCostCell {
  const cost = sessionCost(session);
  if (cost === null) return { text: '—', spoken: 'cost unknown' };
  if (!session.costIncomplete) return { text: money(cost) };
  return { text: `≥${money(cost)}`, spoken: `at least ${money(cost)}. ${partialCostExplanation}`, title: partialCostExplanation };
}
