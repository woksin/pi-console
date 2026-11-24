import type { LaneModel } from '../projections/lanes.ts';

/** Lexical only: no filesystem access, case folding or basename association. */
export function normalizedCwd(cwd: string): string {
  const path = cwd.trim();
  return path ? path.replace(/\\/g, '/').replace(/\/+$/, '') || '/' : '';
}
export type LaneLookup = ReadonlyMap<string, ReadonlyMap<string, LaneModel>>;

export function laneLookup(rows: Record<string, LaneModel>): LaneLookup {
  const result = new Map<string, Map<string, LaneModel>>();
  for (const lane of Object.values(rows)) {
    const cwd = normalizedCwd(lane.cwd ?? '');
    if (!cwd) continue;
    const matches = result.get(cwd) ?? new Map<string, LaneModel>();
    matches.set(lane.id, lane);
    result.set(cwd, matches);
  }
  return result;
}

export function sessionIdentity(cwd: string, lanes: LaneLookup): { laneId: string; branch: string } {
  const path = normalizedCwd(cwd);
  const matches = path ? lanes.get(path) : undefined;
  const lane = matches?.size === 1 ? matches.values().next().value : undefined;
  return { laneId: lane?.id ?? 'unassigned', branch: lane?.branch ?? '' };
}
