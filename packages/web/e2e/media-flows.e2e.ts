import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRig } from './harness.ts';
import { preparePage } from '../../../scripts/media/web-page.ts';
import { fixedNow } from '../../../scripts/media/scenes.ts';
import { connectFlow, firstRunFlow, liveFleetFlow, memoryReviewFlow } from '../../../scripts/media/web-flows.ts';

// The gallery's four live flows run with no encoder: the behaviour they show is asserted here, the pictures are `npm run media`'s.
test('a visitor without a launch link pastes the token, connects and the token never reaches the address bar', { timeout: 60000 }, async () => { await connectFlow(); });
test('a connected daemon with no data shows the first-run checklist from an empty snapshot and no attention', { timeout: 60000 }, async () => { await firstRunFlow(); });
test('a finished session and a new blocking question arrive over SSE and raise the Needs you count without a reload', { timeout: 60000 }, async () => { await liveFleetFlow(); });
test('a memory review stays proposed through request and receipts and turns active only on the producer update', { timeout: 60000 }, async () => { await memoryReviewFlow(); });

test('a controlled page is frozen at the capture time and moves only by runFor', { timeout: 60000 }, async () => {
  const rig = await startRig({ speed: 1e-9 });
  try {
    const page = await preparePage(rig, { theme: 'midnight', scale: 1, clock: 'controlled' });
    const now = (): Promise<number> => page.evaluate(() => Date.now());
    assert.equal(await now(), Date.parse(fixedNow));
    await page.waitForTimeout(500);
    assert.equal(await now(), Date.parse(fixedNow));
    await page.clock.runFor(250);
    assert.equal(await now(), Date.parse(fixedNow) + 250);
    await page.context().close();
  } finally { await rig.close(); }
});
