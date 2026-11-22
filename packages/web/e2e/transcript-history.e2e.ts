import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startRig, type Rig } from './harness.ts';

const base = 1_000_000;
const total = 8000;

describe('bounded long transcript history', () => {
  let rig: Rig;
  before(async () => {
    rig = await startRig({ speed: 0.001 });
    const template = rig.daemon.store.fixture.transcript.find(entry => entry.sessionId === 's2');
    assert.ok(template);
    for (let index = 1; index <= total; index++) rig.daemon.store.fixture.transcript.push({
      ...template, id: `long-${index}`, cursor: base + index, kind: 'assistant', text: `long transcript row ${index}`,
      requestId: null, toolCallId: null, toolResult: null, resetId: null,
    });
  });
  after(async () => { await rig.close(); });

  const ready = async (page: Page): Promise<void> => {
    await page.locator(`#line-${base + total}`).waitFor();
    await page.waitForFunction(() => {
      const pane = document.querySelector('.transcript');
      return pane && pane.scrollHeight - pane.clientHeight - pane.scrollTop < 12;
    });
  };

  test('opens at the newest entries in one request; controls and scroll-to-top load older', async () => {
    const page = await rig.open('/fleet');
    const queries: URL[] = [];
    page.on('request', request => { if (request.url().includes('/transcript?')) queries.push(new URL(request.url())); });
    await page.evaluate(() => { location.hash = '/session/s2'; });
    await ready(page);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].searchParams.get('order'), 'desc');
    assert.equal(queries[0].searchParams.has('after'), false);
    assert.equal(await page.locator('.tline').count(), 500);
    await page.getByRole('button', { name: 'Load older', exact: true }).click();
    await page.locator(`#line-${base + total - 999}`).waitFor();
    await page.locator('.transcript').hover();
    await page.mouse.wheel(0, -10_000_000);
    await page.locator(`#line-${base + total - 1499}`).waitFor();
    assert.equal([...queries].length, 3, 'opening and two deliberate older loads never scan the session');
    await page.context().close();
  });

  test('around jumps repeat after reopening; missing entries fall back to the newest window', async () => {
    const page = await rig.open('/session/s2?entry=long-42');
    await page.locator(`#line-${base + 42}.target`).waitFor();
    await page.getByRole('button', { name: 'Return to live', exact: true }).click();
    await ready(page);
    await page.evaluate(() => { location.hash = '/fleet'; });
    await page.getByRole('heading', { name: 'Fleet', exact: true }).waitFor();
    await page.evaluate(() => { location.hash = '/session/s2?entry=long-42'; });
    await page.locator(`#line-${base + 42}.target`).waitFor();
    await page.evaluate(() => { location.hash = '/session/s2?entry=missing'; });
    await ready(page);
    await page.getByRole('button', { name: /Following/ }).waitFor();
    assert.equal(await page.locator('.tline').count(), 500);
    await page.context().close();
  });

  test('resuming follow at live preserves the search and does not reload the transcript', async () => {
    const page = await rig.open('/fleet');
    const queries: URL[] = [];
    page.on('request', request => { if (request.url().includes('/transcript?')) queries.push(new URL(request.url())); });
    await page.evaluate(() => { location.hash = '/session/s2'; });
    await ready(page);
    await page.getByRole('button', { name: /Following/ }).click();
    const search = page.getByPlaceholder('Search this transcript…');
    await search.fill('long transcript row 7999');
    await page.getByRole('button', { name: /Follow tail/ }).focus();
    await page.keyboard.press('f');
    await page.getByRole('button', { name: /Following/ }).waitFor();
    assert.equal(await search.inputValue(), 'long transcript row 7999');
    assert.equal(queries.length, 1);
    await page.context().close();
  });

  test('older failures expose a keyboard-reachable Retry without discarding the visible window', async () => {
    const page = await rig.open('/session/s2');
    await ready(page);
    let fail = true;
    await page.route('**/sessions/s2/transcript?**', async route => {
      if (fail) { fail = false; await route.fulfill({ status: 503, body: 'unavailable' }); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Load older', exact: true }).click();
    const retry = page.getByRole('alert').getByRole('button', { name: 'Retry', exact: true });
    await retry.waitFor();
    assert.equal(await page.locator('.tline').count(), 500);
    await retry.focus(); await page.keyboard.press('Enter');
    await page.locator(`#line-${base + total - 999}`).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.context().close();
  });
});
