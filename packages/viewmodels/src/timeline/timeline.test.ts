import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markers, pan, timelineViewModel, zoom } from './timeline.ts';
import { fixture, golden } from '../test-support.ts';

const input = { sessions: fixture.sessions, requests: fixture.requests, resets: fixture.resets, questions: fixture.questions, messages: fixture.messages, width: 80 };

test('timeline builds one lane per session with markers, within the window', () => {
  const model = timelineViewModel(input);
  assert.ok(model.lanes.length > 0);
  for (const lane of model.lanes) for (const cell of lane.cells) assert.ok(cell.column >= 0 && cell.column < 80);
  assert.ok(model.markers.some(marker => marker.glyph === '╳'), 'interrupted request marker');
  assert.ok(model.markers.some(marker => marker.glyph === '⟲'), 'reset marker');
  golden('timeline', { ...model, markers: model.markers.length });
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
