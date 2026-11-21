import { clip, type GraphGroup } from '@pi-console/viewmodels';

/** The graph's square viewBox and the circle the nodes sit on. */
export const graphSize = 360;
const radius = 130;
/** About this many characters fit beside an outer node at 11 px; longer names are clipped and kept whole in the tooltip. */
const maxLabel = 30;

export interface NodePlace { x: number; y: number }
export interface LabelPlace { text: string; anchor: 'start' | 'middle' | 'end'; dx: number }

export function placeNodes(group: GraphGroup): Map<string, NodePlace> {
  const centre = graphSize / 2;
  return new Map(group.nodes.map((node, index) => {
    const angle = (index / Math.max(1, group.nodes.length)) * Math.PI * 2 - Math.PI / 2;
    return [node.sessionId, { x: centre + Math.cos(angle) * radius, y: centre + Math.sin(angle) * radius }];
  }));
}

/**
 * Labels on the left and right of the circle grow toward the centre instead of past the edge of the drawing, so they
 * are not clipped when the panel is narrow (1024 px); nodes near the top and bottom keep a centred label.
 */
export function placeLabel(label: string, at: NodePlace): LabelPlace {
  const text = clip(label, maxLabel);
  const offset = at.x - graphSize / 2;
  if (offset < -radius * 0.35) return { text, anchor: 'start', dx: -15 };
  if (offset > radius * 0.35) return { text, anchor: 'end', dx: 15 };
  return { text, anchor: 'middle', dx: 0 };
}
