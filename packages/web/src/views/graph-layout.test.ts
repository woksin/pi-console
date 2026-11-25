import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cells, sessionLabels } from '@pi-console/viewmodels';
import { arrowLength, edgePath, graphHeight, graphSize, labelCharWidth, labelRows, nodeRadius, placeLabel, placeNodes } from './graph-layout.ts';

/** Horizontal span of a placed label at the layout's own per-character budget. */
const extent = (x: number, label: { text: string; anchor: string; dx: number }): [number, number] => {
  const width = cells(label.text).length * labelCharWidth;
  const at = x + label.dx;
  return label.anchor === 'start' ? [at, at + width] : label.anchor === 'end' ? [at - width, at] : [at - width / 2, at + width / 2];
};

const layout = (count: number, name: (index: number) => string) => {
  const nodes = Array.from({ length: count }, (_, index) => ({ sessionId: `s${String(index)}`, label: name(index) }));
  const positions = placeNodes(nodes.map(node => node.sessionId));
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

function assertNoOverlaps(labels: ReturnType<typeof layout>, count: number): void {
  for (const a of labels) {
    for (const b of labels) {
      if (a === b || Math.abs(a.at.y - b.at.y) > 14) continue;
      assert.ok(a.span[1] <= b.span[0] || b.span[1] <= a.span[0], `${String(count)}: ${a.label.text} overlaps ${b.label.text}`);
    }
  }
}

test('for 3 to 8 nodes no label leaves the drawing and no two labels on the same row overlap', () => {
  for (let count = 3; count <= 8; count++) {
    const labels = layout(count, index => `aurora/L19${String(index)} subagent with a long tail`);
    for (const { label, span: [left, right] } of labels) assert.ok(left >= 0 && right <= graphSize, `${String(count)}: ${label.text} spans ${String(left)}..${String(right)}`);
    assertNoOverlaps(labels, count);
  }
});

test('a five-node group keeps its usual names whole', () => {
  const names = ['aurora/L0 orchestrator', 'aurora/L192 main', 'aurora/L193 main', 'aurora/L194 subagent', 'aurora/L195 subagent'];
  const labels = layout(5, index => names[index]);
  assert.deepEqual(labels.map(entry => entry.label.text), names);
});

test('session labels keep their lane suffix when clipped at every node position', () => {
  const positions = placeNodes(Array.from({ length: 8 }, (_, index) => String(index)));
  const identity = sessionLabels({ id: 's1', name: 'aurora implementation with a long name', laneId: 'L192' });
  for (const at of positions.values()) {
    const label = placeLabel(identity.title, at, identity);
    assert.match(label.text, /… · L192$/);
    const [left, right] = extent(at.x, label);
    assert.ok(left >= 0 && right <= graphSize);
  }
});

test('the drawing reserves room under the lowest node for its lane-ID line and its name line', () => {
  const lowest = Math.max(...layout(8, () => 'L196').map(entry => entry.at.y));
  assert.ok(lowest + 45 + 4 <= graphHeight, 'second label line plus descender stays inside the viewBox');
  assert.ok(graphHeight > graphSize);
});

test('edges start at the sender circle and stop an arrowhead short of the receiver circle, never at a centre', () => {
  const positions = [...placeNodes(['a', 'b', 'c', 'd', 'e']).values()];
  const numbers = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  for (const from of positions) for (const to of positions) {
    if (from === to) continue;
    const values = numbers(edgePath(from, to));
    const [sx, sy] = values.slice(0, 2);
    const [ex, ey] = values.slice(-2);
    assert.ok(Math.abs(Math.hypot(sx - from.x, sy - from.y) - (nodeRadius + 2)) < 0.2, 'leaves from the circle edge');
    assert.ok(Math.abs(Math.hypot(ex - to.x, ey - to.y) - (nodeRadius + 2 + arrowLength)) < 0.2, 'the arrow tip lands just outside the circle');
  }
  const loop = numbers(edgePath(positions[0], positions[0]));
  assert.ok(loop[loop.length - 1] > positions[0].y, 'a top self-loop bulges toward the centre, away from its label');
});

test('top-arc labels sit above their node; the rest below, so edges inside the circle stay clear of the text', () => {
  const [top, right, , , left] = [...placeNodes(['a', 'b', 'c', 'd', 'e']).values()];
  assert.deepEqual(labelRows(top, true), { label: -36, name: -23 });
  assert.deepEqual(labelRows(top, false), { label: -23, name: -23 });
  assert.ok(labelRows(top, true).name < -nodeRadius);
  for (const at of [right, left]) assert.deepEqual(labelRows(at, true), { label: 32, name: 45 });
});
