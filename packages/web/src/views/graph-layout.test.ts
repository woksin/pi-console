import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cells, type GraphGroup } from '@pi-console/viewmodels';
import { graphSize, labelCharWidth, placeLabel, placeNodes } from './graph-layout.ts';

/** Horizontal span of a placed label at the layout's own per-character budget. */
const extent = (x: number, label: { text: string; anchor: string; dx: number }): [number, number] => {
  const width = cells(label.text).length * labelCharWidth;
  const at = x + label.dx;
  return label.anchor === 'start' ? [at, at + width] : label.anchor === 'end' ? [at - width, at] : [at - width / 2, at + width / 2];
};

const layout = (count: number, name: (index: number) => string) => {
  const nodes = Array.from({ length: count }, (_, index) => ({ sessionId: `s${String(index)}`, label: name(index) }));
  const positions = placeNodes({ nodes } as unknown as GraphGroup);
  return nodes.map(node => {
    const at = positions.get(node.sessionId) ?? { x: 0, y: 0 };
    const label = placeLabel(node.label, at);
    return { at, label, span: extent(at.x, label) };
  });
};

test('side labels grow toward the centre, the rest stay centred, and long names are clipped', () => {
  const labels = layout(8, index => `a-rather-long-lane-name-for-session-${String(index)}`);
  assert.deepEqual(labels.map(entry => entry.label.anchor), ['middle', 'middle', 'end', 'middle', 'middle', 'middle', 'start', 'middle']);
  for (const { label } of labels) assert.ok(cells(label.text).length <= 30 && label.text.endsWith('…'));
  assert.equal(placeLabel('short', { x: 180, y: 50 }).text, 'short');
});

test('for 3 to 8 nodes no label leaves the drawing and no two labels on the same row overlap', () => {
  for (let count = 3; count <= 8; count++) {
    const labels = layout(count, index => `aurora/L19${String(index)} subagent with a long tail`);
    for (const { label, span: [left, right] } of labels) assert.ok(left >= 0 && right <= graphSize, `${String(count)}: ${label.text} spans ${String(left)}..${String(right)}`);
    for (const a of labels) {
      for (const b of labels) {
        if (a === b || Math.abs(a.at.y - b.at.y) > 14) continue;
        assert.ok(a.span[1] <= b.span[0] || b.span[1] <= a.span[0], `${String(count)}: ${a.label.text} overlaps ${b.label.text}`);
      }
    }
  }
});

test('a five-node group keeps its usual names whole', () => {
  const names = ['aurora/L0 orchestrator', 'aurora/L192 main', 'aurora/L193 main', 'aurora/L194 subagent', 'aurora/L195 subagent'];
  const labels = layout(5, index => names[index]);
  assert.deepEqual(labels.map(entry => entry.label.text), names);
});
