import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cells, type GraphGroup } from '@pi-console/viewmodels';
import { graphSize, placeLabel, placeNodes } from './graph-layout.ts';

/** Generous 7 px per character at 11 px: the label's far edge must stay inside the drawing. */
const extent = (x: number, label: { text: string; anchor: string; dx: number }): [number, number] => {
  const width = cells(label.text).length * 7;
  const at = x + label.dx;
  return label.anchor === 'start' ? [at, at + width] : label.anchor === 'end' ? [at - width, at] : [at - width / 2, at + width / 2];
};

test('outer node labels grow toward the centre and long names are clipped, so none leaves the drawing', () => {
  const nodes = Array.from({ length: 8 }, (_, index) => ({ sessionId: `s${String(index)}`, label: `a-rather-long-lane-name-for-session-${String(index)}` }));
  const positions = placeNodes({ nodes } as unknown as GraphGroup);
  const labels = nodes.map(node => {
    const at = positions.get(node.sessionId) ?? { x: 0, y: 0 };
    return { at, label: placeLabel(node.label, at) };
  });
  assert.deepEqual(labels.map(entry => entry.label.anchor), ['middle', 'end', 'end', 'end', 'middle', 'start', 'start', 'start']);
  for (const { at, label } of labels) {
    assert.ok(cells(label.text).length <= 30 && label.text.endsWith('…'));
    const [left, right] = extent(at.x, label);
    assert.ok(left >= 0 && right <= graphSize, `${label.text} spans ${String(left)}..${String(right)}`);
  }
  assert.equal(placeLabel('short', { x: 180, y: 50 }).text, 'short');
});
