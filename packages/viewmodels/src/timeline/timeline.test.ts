import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markers, pan, timelineViewModel, zoom } from './timeline.ts';
import { fixture, golden } from '../test-support.ts';
import { displayWidth } from '../format/format.ts';
import { timelineTicks } from './ticks.ts';

const input = { sessions: fixture.sessions, requests: fixture.requests, resets: fixture.resets, questions: fixture.questions, messages: fixture.messages, width: 80 };

test('timeline builds one lane per session with markers, within the window', () => {
  const model = timelineViewModel(input);
  assert.ok(model.lanes.length > 0);
  for (const lane of model.lanes) for (const cell of lane.cells) assert.ok(cell.column >= 0 && cell.column < 80);
  assert.ok(model.markers.some(marker => marker.glyph === '/'), 'interrupted request marker');
  assert.ok(model.markers.some(marker => marker.glyph === '⟲'), 'reset marker');
  golden('timeline', { ...model, markers: model.markers.length });
});

test('the axis uses the same clock-aligned tick times and columns as the web at every width', () => {
  const start = Date.parse('2026-01-01T12:00:17Z');
  for (const width of [20, 80, 120]) for (const span of [60_000, 420_000, 7_341_000]) {
    const window = { start, span };
    const { axis } = timelineViewModel({ ...input, window, width });
    assert.deepEqual(axis, timelineTicks(window, width).map(({ column, label }) => ({ column, label })));
    assert.ok(axis[0].column > 0, 'panned window does not force a tick at its unaligned start');
  }
});

test('same-name timeline lanes stay distinct at the viewmodel and renderer label widths', () => {
  const sessions = fixture.sessions.slice(0, 2).map((session, index) => ({ ...session, name: 'aurora implementation', laneId: `L${String(index + 1)}` }));
  const resets = sessions.map(session => ({ id: session.id, sessionId: session.id, at: session.startedAt, kind: 'compaction' as const, carriedRequestIds: [], interruptedRequestIds: [] }));
  for (const labelWidth of [undefined, 21, 14]) {
    const { lanes } = timelineViewModel({ sessions, resets, requests: [], questions: [], messages: [], width: 80, labelWidth });
    assert.notEqual(lanes[0].label, lanes[1].label);
    assert.match(lanes[0].label, /… · L1$/);
    assert.match(lanes[1].label, /… · L2$/);
    assert.ok(lanes.every(lane => displayWidth(lane.label) <= (labelWidth ?? 22)));
  }
});

test('partial answers are labelled as not final', () => {
  assert.ok(markers(input).filter(marker => marker.glyph === '◐').every(marker => marker.kind.includes('not final')));
});

test('zoom is clamped and keeps the centre; pan moves by a fraction of the span', () => {
  const window = { start: 1000, span: 100_000 };
  const zoomed = zoom(window, 0.5);
  assert.equal(zoomed.start + zoomed.span / 2, window.start + window.span / 2);
  assert.equal(zoom(window, 1e-9).span, 5000);
  assert.equal(pan(window, 1).start, 1000 + 15_000);
});
