import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextFor } from './keys.ts';
import { parseRoute } from './routes.ts';

test('web list contexts follow the route; overlays and graph take precedence', () => {
  for (const view of ['overview', 'fleet', 'requests', 'questions', 'messages', 'work', 'timeline']) {
    const route = parseRoute(`#/${view}`);
    assert.equal(contextFor({ route, palette: false, help: false }), view);
    assert.equal(contextFor({ route, palette: true, help: true }), 'palette');
    assert.equal(contextFor({ route, palette: false, help: true }), 'help');
  }
  assert.equal(contextFor({ route: parseRoute('#/messages?view=graph'), palette: false, help: false }), 'graph');
  assert.equal(contextFor({ route: parseRoute('#/session/s2'), palette: false, help: false }), 'detail');
});
