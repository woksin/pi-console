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

export interface NodePlace { x: number; y: number }
export interface LabelPlace { text: string; anchor: 'start' | 'middle' | 'end'; dx: number }

export function placeNodes(ids: readonly string[]): Map<string, NodePlace> {
  return new Map(ids.map((id, index) => {
    const angle = (index / Math.max(1, ids.length)) * Math.PI * 2 - Math.PI / 2;
    return [id, { x: centre + Math.cos(angle) * radius, y: centre + Math.sin(angle) * radius }];
  }));
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
