import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoute, sectionFor, sessionHref, titleFor } from './routes.ts';

for (const hash of ['#/session/%', '#/session/%E0%A4%A', '#/session/%FF', '#/%']) {
  test(`malformed route ${hash} becomes a not-found route`, () => {
    const route = parseRoute(hash);
    assert.deepEqual(route, { view: 'not-found', id: null, params: {} });
    assert.equal(titleFor(route.view), 'Not found');
    assert.equal(sectionFor(route.view), null);
  });
}

test('session IDs and entry queries still round-trip', () => {
  assert.deepEqual(parseRoute(sessionHref('session/with spaces', 'entry 1')), {
    view: 'session', id: 'session/with spaces', params: { entry: 'entry 1' },
  });
});

test('existing default and unknown routes still show overview', () => {
  assert.equal(parseRoute('').view, 'overview');
  assert.equal(parseRoute('#/unknown').view, 'overview');
});
