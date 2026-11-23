import { analyzeLinks, maxLinks, maxTargets, parseTargetKey, type LinkObservation, type LinkState } from '@pi-console/contract';

/** The latest observed state of one link target, with the link-set revision it was associated with. Keys are canonical `owner/repo#N`, so never prototype names. */
export interface LinkObservationModel extends Omit<LinkObservation, 'target'> { revision: number }
export type LinkObservations = Record<string, LinkObservationModel>;

export interface ObservedPayload {
  questionId: string; revision: number; target: string; kind: LinkObservation['kind']; state: LinkState; closedAt: string | null; fetchedAt: string; source: LinkObservation['source'];
}

/** A refreshed failure ('unknown') outranks a success with the same timestamp, so a tie can only withhold. */
const stateRank: Record<LinkState, number> = { unknown: 0, open: 1, closed: 2, merged: 3 };
const compare = (a: LinkObservationModel, b: LinkObservationModel): number =>
  Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt) || a.revision - b.revision || stateRank[b.state] - stateRank[a.state];

/** Canonical keys of the current links, or null when the link set is not (yet) known or has no recognised targets. */
export function currentTargets(links: readonly string[], revision: number): Set<string> | null {
  if (revision === 0) return null;
  if (links.length > maxLinks) return new Set(); // Incomplete coverage: no evidence is current, and no oversized list is parsed.
  return new Set(links.flatMap(link => analyzeLinks([link]).targets.map(target => target.key)));
}

function acceptable(payload: ObservedPayload, targets: Set<string> | null, rowRevision: number): boolean {
  if (!parseTargetKey(payload.target)) return false;
  return (rowRevision === 0 || payload.revision >= rowRevision) && (targets?.has(payload.target) ?? true);
}

/**
 * Keeps only the newest observation per current target. Evidence for a target that left the links is dropped, so a later
 * re-add starts without evidence; one for an older association revision, or one that is not a canonical target, is ignored.
 */
export function observe(current: LinkObservations | null, payload: ObservedPayload, targets: Set<string> | null, rowRevision: number): LinkObservations | null {
  if (!acceptable(payload, targets, rowRevision)) return current;
  const incoming: LinkObservationModel = {
    kind: payload.kind, state: payload.state, closedAt: payload.closedAt, fetchedAt: payload.fetchedAt, source: payload.source, revision: payload.revision,
  };
  const known = current?.[payload.target];
  if (known && compare(incoming, known) <= 0) return current;
  const next = { ...current };
  if (!known && Object.keys(next).length >= maxTargets) return current;
  next[payload.target] = incoming;
  return next;
}

/** Drops observations whose target is no longer linked. */
export function prune(current: LinkObservations | null, targets: Set<string> | null): LinkObservations | null {
  if (!current || !targets) return current;
  const kept = Object.entries(current).filter(([target]) => targets.has(target));
  return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
}

/** API rows for the current links only, in stable target order; null when there is nothing to show. */
export function evidenceOf(current: LinkObservations | null, links: readonly string[]): LinkObservation[] | null {
  const targets = currentTargets(links, 1);
  const rows = Object.entries(current ?? {}).filter(([target]) => targets?.has(target))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([target, found]) => ({ target, kind: found.kind, state: found.state, closedAt: found.closedAt, fetchedAt: found.fetchedAt, source: found.source }));
  return rows.length ? rows : null;
}
