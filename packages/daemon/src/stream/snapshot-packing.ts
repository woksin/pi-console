import type { Snapshot } from '@pi-console/contract';
import { safeJson } from '../http/output.ts';
import { bundle, candidateOrder, collections, displayOrder, snapshotEntities, type Collection, type SnapshotEntity } from './snapshot-candidates.ts';

type Encode = (payload: unknown) => string;
interface WireBudget { encode: Encode; preferred: number; hard: number }
type Counts = Record<SnapshotEntity['group'], number>;
const emptyCounts = (): Counts => ({ sessions: 0, requests: 0, questions: 0, messages: 0, jobs: 0, resets: 0, repositories: 0 });

function bounded(counts: Counts, totals: NonNullable<Snapshot['totals']>): Collection[] {
  return collections.filter(name => counts[name] < totals[name]);
}

function addition(rows: SnapshotEntity[], counts: Counts): { bytes: number; counts: Counts } {
  const next = { ...counts };
  let bytes = 0;
  for (const row of rows) {
    bytes += row.bytes + (next[row.group] > 0 ? 1 : 0);
    next[row.group]++;
  }
  return { bytes, counts: next };
}

function payload(minimal: Snapshot, rows: SnapshotEntity[], omitted: Collection[]): Snapshot {
  const result = { ...minimal, bounded: omitted };
  for (const group of [...collections, 'repositories'] as const) {
    // Each entity retains its source collection; the union is only erased at this assignment.
    (result[group] as SnapshotEntity['row'][]) = rows.filter(row => row.group === group).sort(displayOrder).map(row => row.row);
  }
  return result;
}

/** Headers are flushed separately; each HTTP chunk adds a hexadecimal length and two CRLFs. */
export function snapshotLimits(cap: number): Omit<WireBudget, 'encode'> {
  const hard = Math.max(0, cap - cap.toString(16).length - 4);
  return { preferred: Math.min(cap / 2, hard), hard };
}

/** Prefer half the output cap; use the transport-safe hard budget only if no complete bundle fits there. */
export function packSnapshot(normal: unknown, active: unknown, minimal: unknown, wire: WireBudget): string | null {
  const empty = minimal as Snapshot;
  const minimalFrame = wire.encode(empty);
  if (Buffer.byteLength(minimalFrame) > wire.hard) return null;
  const entities = snapshotEntities(normal ?? {}, active ?? {});
  return packWithin(entities, empty, wire.encode, wire.preferred)
    ?? packWithin(entities, empty, wire.encode, wire.hard) ?? minimalFrame;
}

/** Cached per-entity costs keep both attempts linear; rejected bundles do not consume space. */
function packWithin(entities: SnapshotEntity[], empty: Snapshot, encode: Encode, cap: number): string | null {
  const index = new Map(entities.map(row => [row.key, row]));
  const held = new Set<string>();
  const kept: SnapshotEntity[] = [];
  const totals = empty.totals ?? emptyCounts();
  let counts = emptyCounts();
  let omitted = bounded(counts, totals);
  let bytes = Buffer.byteLength(encode({ ...empty, bounded: omitted }));
  for (const candidate of entities.filter(row => row.group !== 'repositories').sort(candidateOrder)) {
    const rows = bundle(candidate, index, held);
    const next = addition(rows, counts);
    const nextOmitted = bounded(next.counts, totals);
    const size = bytes + next.bytes + Buffer.byteLength(safeJson(nextOmitted)) - Buffer.byteLength(safeJson(omitted));
    if (size > cap) continue;
    for (const row of rows) { held.add(row.key); kept.push(row); }
    counts = next.counts; omitted = nextOmitted; bytes = size;
  }
  if (!kept.length) return null;
  const frame = encode(payload(empty, kept, omitted));
  return Buffer.byteLength(frame) <= cap ? frame : null;
}
