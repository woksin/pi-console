import { clip, fitSessionLabel, type SessionLabel } from '@pi-console/viewmodels';

/** The graph's square viewBox and the circle the nodes sit on. */
export const graphSize = 440;
/** Extra room below the circle for the bottom nodes' two label lines. */
export const graphHeight = 464;
const radius = 160;
const centre = graphSize / 2;
/** Longest label ever drawn; longer names are clipped and kept whole in the node's tooltip. */
const maxLabel = 30;
/** A generous average advance for the 11 px label font, so a clipped label never reaches past its budget. */
export const labelCharWidth = 6.5;

/** Node circle radius; edges stop this far plus `edgeGap` from a node's centre. */
export const nodeRadius = 15;
const edgeGap = 2;
/** Length of the arrowhead drawn past the end of an edge path (marker `refX` 0, tip forward). */
export const arrowLength = 10;

export interface NodePlace { x: number; y: number }
export interface LabelPlace { text: string; anchor: 'start' | 'middle' | 'end'; dx: number }
/** Baseline offsets of a node's label and name lines from its centre. */
export interface LabelRows { label: number; name: number }

export function placeNodes(ids: readonly string[]): Map<string, NodePlace> {
  return new Map(ids.map((id, index) => {
    const angle = (index / Math.max(1, ids.length)) * Math.PI * 2 - Math.PI / 2;
    return [id, { x: centre + Math.cos(angle) * radius, y: centre + Math.sin(angle) * radius }];
  }));
}

/** Nodes in the top arc label above themselves, outside the circle the edges cross; every other node labels below. */
export function labelRows(at: NodePlace, named: boolean): LabelRows {
  if (at.y >= centre - radius * 0.45) return { label: 32, name: 45 };
  return named ? { label: -36, name: -23 } : { label: -23, name: -23 };
}

const unit = (x: number, y: number): NodePlace => { const length = Math.hypot(x, y) || 1; return { x: x / length, y: y / length }; };
const toward = (at: NodePlace, direction: NodePlace, by: number): NodePlace => ({ x: at.x + direction.x * by, y: at.y + direction.y * by });
const point = (at: NodePlace): string => `${String(Math.round(at.x * 10) / 10)} ${String(Math.round(at.y * 10) / 10)}`;

/**
 * A gently bowed edge that leaves the sender's circle and stops where the arrowhead's base meets it, so the arrow tip
 * lands just outside the receiver's circle. A self-loop bulges toward the centre, away from the node's own label.
 */
export function edgePath(from: NodePlace, to: NodePlace): string {
  if (from.x === to.x && from.y === to.y) return loopPath(from);
  const control = { x: (from.x + to.x) / 2 + (to.y - from.y) * 0.12, y: (from.y + to.y) / 2 - (to.x - from.x) * 0.12 };
  const start = nodeRadius + edgeGap;
  const end = start + arrowLength;
  const fit = Math.min(1, Math.max(0, Math.hypot(to.x - from.x, to.y - from.y) - 4) / (start + end));
  const head = toward(from, unit(control.x - from.x, control.y - from.y), start * fit);
  const tail = toward(to, unit(control.x - to.x, control.y - to.y), end * fit);
  return `M${point(head)} Q${point(control)} ${point(tail)}`;
}

function loopPath(at: NodePlace): string {
  const inward = unit(centre - at.x, centre - at.y);
  const out = unit(inward.x - inward.y, inward.y + inward.x);
  const back = unit(inward.x + inward.y, inward.y - inward.x);
  const reach = 70;
  return `M${point(toward(at, out, nodeRadius + edgeGap))} C${point(toward(at, out, reach))} ${point(toward(at, back, reach))} ${point(toward(at, back, nodeRadius + edgeGap + arrowLength))}`;
}

const fitted = (label: string, width: number, identity?: SessionLabel): string => {
  const budget = Math.max(4, Math.min(maxLabel, Math.floor(width / labelCharWidth)));
  return identity ? fitSessionLabel(identity, budget) : clip(label, budget);
};

/**
 * Nodes on the left and right of the circle label toward the centre and stop short of it, so a mirrored pair never
 * collides and nothing is clipped by a narrow (1024 px) panel. Every other node keeps a centred label, clipped to the
 * room it has: inside the drawing and short of its mirror node, so a bottom or top pair stays apart too.
 */
export function placeLabel(label: string, at: NodePlace, identity?: SessionLabel): LabelPlace {
  const offset = at.x - centre;
  const side = Math.abs(at.y - centre) <= radius * 0.45;
  if (side && offset < 0) return { text: fitted(label, -offset + 11, identity), anchor: 'start', dx: -15 };
  if (side && offset > 0) return { text: fitted(label, offset + 11, identity), anchor: 'end', dx: 15 };
  const mirror = Math.abs(offset) < 1 ? Infinity : 2 * Math.abs(offset) - 8;
  return { text: fitted(label, Math.min(2 * Math.min(at.x, graphSize - at.x), mirror), identity), anchor: 'middle', dx: 0 };
}
