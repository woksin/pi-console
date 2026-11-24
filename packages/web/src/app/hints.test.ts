import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hints } from '@pi-console/viewmodels';
import { visibleHints } from './hints.ts';

const none = { sessions: [], needsYou: [] };

test('Overview and Fleet drop selection hints when there is nothing to select', () => {
  for (const context of ['overview', 'fleet'] as const) {
    const shown = visibleHints(hints(context, 'web'), context, none);
    for (const dead of ['j/k move', '⏎ open', 'y copy id', 'space fold']) assert.ok(!shown.includes(dead), `${context} hides ${dead}`);
    assert.ok(shown.includes(': palette'), 'global hints stay');
  }
});

test('selection hints stay when rows exist and on other screens', () => {
  const full = hints('fleet', 'web');
  assert.deepEqual(visibleHints(full, 'fleet', { sessions: [{}] as never, needsYou: [] }), full);
  const requests = hints('requests', 'web');
  assert.deepEqual(visibleHints(requests, 'requests', none), requests);
});
