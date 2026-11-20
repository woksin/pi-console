import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { getTimelineEngine } from '@opentui/core';
import { App } from './app.tsx';
import { Store, type Snapshot } from './model.ts';

test('composer validates, requires lane confirmation, reports transport error and cancels without delivery', async () => {
  const store = new Store();
  store.apply({ seq: 0, type: 'snapshot', payload: JSON.parse(readFileSync(new URL('../../fixture/data/fixture.json', import.meta.url), 'utf8')) as Snapshot });
  store.flush();
  let submissions = 0;
  const ui = await testRender(<App store={store} submit={async input => {
    submissions++;
    assert.equal(input.type, 'abort'); assert.equal(input.confirmation, 'L192');
    throw new Error('HTTP 503: mock unavailable');
  }} />, { width: 120, height: 40 });
  const key = async (name: string, ctrl = false) => {
    await act(async () => {
      ui.mockInput.pressKey(name, { ctrl });
      if (name === 'ESCAPE') await new Promise(resolve => setTimeout(resolve, 40));
    });
    await act(async () => { getTimelineEngine(ui.renderer).update(700); });
  };
  try {
    await key('i');
    await ui.waitForFrame(f => f.includes('HUMAN IN THE LOOP'));
    await key('s', true);
    await ui.waitForFrame(f => f.includes('Write a message before submitting.'));
    assert.equal(submissions, 0);
    for (let i = 0; i < 3; i++) await key('TAB');
    await ui.waitForFrame(f => f.includes('Abort requires explicit lane confirmation.'));
    await key('s', true);
    await ui.waitForFrame(f => f.includes('Type L192 to confirm abort.'));
    await act(async () => ui.mockInput.typeText('L192'));
    await key('s', true);
    await ui.waitForFrame(f => f.includes('HTTP 503: mock unavailable'));
    assert.equal(submissions, 1);
    assert.equal(store.state.interventions.length, 0);
    await key('ESCAPE');
    await ui.waitForFrame(f => f.includes('01 OVERVIEW') && !f.includes('HUMAN IN THE LOOP'));
  } finally { await act(async () => ui.dispose()); }
});
