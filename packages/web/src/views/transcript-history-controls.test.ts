import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyProgress } from '../state/transcript-history.ts';
import { historyControls, retryDirection, shouldLoadOlder } from './transcript-history-controls.ts';

test('following at the tail hides return-to-live, while paused or newer-below windows show it', () => {
  assert.deepEqual(historyControls(undefined, true), { busy: false, showLive: false });
  assert.deepEqual(historyControls(emptyProgress, true), { busy: false, showLive: false });
  assert.deepEqual(historyControls(undefined, false), { busy: false, showLive: true });
  assert.deepEqual(historyControls({ ...emptyProgress, newer: true }, true), { busy: false, showLive: true });
});

test('every loading direction disables controls; an error alone leaves them retryable', () => {
  for (const loading of ['tail', 'around', 'older', 'newer'] as const) {
    assert.equal(historyControls({ ...emptyProgress, loading }, true).busy, true);
  }
  assert.equal(historyControls({ ...emptyProgress, error: 'older' }, false).busy, false);
});

test('scrolling upward into the top tolerance loads an available older page', () => {
  const position = { previousTop: 100, top: 2, progress: { ...emptyProgress, older: true }, following: false, searching: false };
  assert.equal(shouldLoadOlder(position), true);
  assert.equal(shouldLoadOlder({ ...position, top: 0 }), true);
  assert.equal(shouldLoadOlder({ ...position, progress: { ...position.progress, error: 'older' } }), true);
});

test('stationary, downward and non-edge scrolls do not trigger history loads', () => {
  const position = { previousTop: 100, top: 0, progress: { ...emptyProgress, older: true }, following: false, searching: false };
  assert.equal(shouldLoadOlder({ ...position, previousTop: 0 }), false);
  assert.equal(shouldLoadOlder({ ...position, previousTop: 0, top: 1 }), false);
  assert.equal(shouldLoadOlder({ ...position, top: 3 }), false);
});

test('following, filtering, pending requests and absent older history suppress scroll paging', () => {
  const position = { previousTop: 100, top: 0, progress: { ...emptyProgress, older: true }, following: false, searching: false };
  assert.equal(shouldLoadOlder({ ...position, following: true }), false);
  assert.equal(shouldLoadOlder({ ...position, searching: true }), false);
  assert.equal(shouldLoadOlder({ ...position, progress: undefined }), false);
  assert.equal(shouldLoadOlder({ ...position, progress: emptyProgress }), false);
  for (const loading of ['tail', 'around', 'older', 'newer'] as const) {
    assert.equal(shouldLoadOlder({ ...position, progress: { ...position.progress, loading } }), false);
  }
});

test('retry preserves a failed paging direction and otherwise returns to a fresh tail', () => {
  assert.equal(retryDirection('older'), 'older');
  assert.equal(retryDirection('newer'), 'newer');
  assert.equal(retryDirection('around'), 'tail');
  assert.equal(retryDirection('tail'), 'tail');
  assert.equal(retryDirection(undefined), 'tail');
});
