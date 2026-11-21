import { clip, type GraphGroup } from '@pi-console/viewmodels';

/** The graph's square viewBox and the circle the nodes sit on. */
export const graphSize = 360;
const radius = 130;
const centre = graphSize / 2;
/** Longest label ever drawn; longer names are clipped and kept whole in the node's tooltip. */
const maxLabel = 30;
/** A generous average advance for the 11 px label font, so a clipped label never reaches past its budget. */
export const labelCharWidth = 6.5;

export interface NodePlace { x: number; y: number }
export interface LabelPlace { text: string; anchor: 'start' | 'middle' | 'end'; dx: number }

export function placeNodes(group: GraphGroup): Map<string, NodePlace> {
  return new Map(group.nodes.map((node, index) => {
    const angle = (index / Math.max(1, group.nodes.length)) * Math.PI * 2 - Math.PI / 2;
    return [node.sessionId, { x: centre + Math.cos(angle) * radius, y: centre + Math.sin(angle) * radius }];
  }));
}

const fitted = (label: string, width: number): string => clip(label, Math.max(4, Math.min(maxLabel, Math.floor(width / labelCharWidth))));

/**
 * Nodes on the left and right of the circle label toward the centre and stop short of it, so a mirrored pair never
 * collides and nothing is clipped by a narrow (1024 px) panel. Every other node keeps a centred label, clipped to the
 * room it has: inside the drawing and short of its mirror node, so a bottom or top pair stays apart too.
 */
export function placeLabel(label: string, at: NodePlace): LabelPlace {
  const offset = at.x - centre;
  const side = Math.abs(at.y - centre) <= radius * 0.45;
  if (side && offset < 0) return { text: fitted(label, -offset + 11), anchor: 'start', dx: -15 };
  if (side && offset > 0) return { text: fitted(label, offset + 11), anchor: 'end', dx: 15 };
  const mirror = Math.abs(offset) < 1 ? Infinity : 2 * Math.abs(offset) - 8;
  return { text: fitted(label, Math.min(2 * Math.min(at.x, graphSize - at.x), mirror)), anchor: 'middle', dx: 0 };
}
