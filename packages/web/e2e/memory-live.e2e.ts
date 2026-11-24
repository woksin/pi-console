import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { memoryDaemon } from '../../daemon/src/testing/memory-live.ts';
import { createStaticServer } from '../src/server/static-server.ts';
import { browserPath, startRig } from './harness.ts';

for (const endpoint of ['sessions/s1/memory', 'memory-items?**']) test(`a delayed ${endpoint} failure shows loading, an error and keyboard retry, never absence`, { timeout: 20000 }, async () => {
  const rig = await startRig({ speed: 1e-9 });
  const delayed = Promise.withResolvers<boolean>();
  try {
    const page = await rig.browser.newPage();
    let fail = true;
    await page.route(`**/api/v1/${endpoint}`, async route => {
      if (!fail) { await route.continue(); return; }
      await delayed.promise;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily unavailable"}' });
    });
    await page.goto(`${rig.baseUrl}/#/session/s1?token=${rig.daemon.token}`);
    await page.getByRole('status', { name: 'Memory read status' }).filter({ hasText: 'Loading memory…' }).waitFor();
    const absent = page.getByText('No intent-memory store seen for this session');
    assert.equal(await absent.count(), 0);
    delayed.resolve(true);
    const error = page.getByRole('status').filter({ hasText: 'Could not load memory.' });
    await error.waitFor();
    assert.match(await error.innerText(), /503/);
    assert.equal(await absent.count(), 0);
    fail = false;
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await retry.focus();
    await page.keyboard.press('Enter');
    const item = page.getByText('synthetic memory item 2', { exact: true });
    await item.waitFor();
    assert.equal(await error.count(), 0);
    assert.equal(await absent.count(), 0);

    fail = true;
    await page.evaluate(() => { window.location.hash = '/fleet'; });
    await page.locator('.memory-panel').waitFor({ state: 'detached' });
    await page.evaluate(() => { window.location.hash = '/session/s1'; });
    await error.waitFor();
    assert.match(await error.innerText(), /Showing previously loaded memory/);
    assert.equal(await item.isVisible(), true, 'refresh failures retain the last good items');
    assert.equal(await absent.count(), 0);
    fail = false;
    await retry.focus();
    await page.keyboard.press('Space');
    await error.waitFor({ state: 'detached' });
    assert.equal(await item.isVisible(), true);
  } finally {
    delayed.resolve(true);
    await rig.close();
  }
});

test('an open browser memory panel converges from real producer files without heartbeat or navigation', { timeout: 20000 }, async () => {
  const spec = await memoryDaemon();
  const web = createStaticServer({ root: resolve(import.meta.dirname, '../dist'), daemon: { host: '127.0.0.1', port: spec.daemon.port } });
  await new Promise<void>(done => { web.listen(0, '127.0.0.1', done); });
  const browser = await chromium.launch({ executablePath: browserPath() });
  try {
    const page = await browser.newPage();
    let actionCalls = 0;
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('memory')) actionCalls++; });
    const base = `http://127.0.0.1:${String((web.address() as AddressInfo).port)}`;
    await page.goto(`${base}/#/session/s1?token=${spec.headers.Authorization.slice(7)}`);
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.getByText('No intent-memory store seen for this session').waitFor();
    spec.add();
    await page.getByText('Synthetic live order', { exact: true }).waitFor();
    const row = page.locator('li').filter({ hasText: 'Synthetic live order' });
    assert.match(await row.innerText(), /Proposed/i);
    spec.confirm();
    await page.waitForFunction(() => [...document.querySelectorAll('li')].some(node => node.textContent.includes('Synthetic live order') && /Active/i.test(node.textContent)));
    spec.retire();
    await page.waitForFunction(() => [...document.querySelectorAll('li')].some(node => node.textContent.includes('Synthetic live order') && /Done/i.test(node.textContent)));
    const uncaptured = page.getByText('At least 1 human message not yet captured in memory', { exact: true });
    spec.journal();
    await uncaptured.waitFor();
    spec.classify();
    await uncaptured.waitFor({ state: 'detached' });
    assert.equal(await page.getByText(/No unresolved|loaded history/).count(), 0);
    assert.equal(actionCalls, 0, 'automatic refresh is read-only');
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE JOURNAL BODY'), false);
  } finally {
    await browser.close();
    await new Promise<void>(done => { web.close(() => { done(); }); });
    await spec.close();
  }
});
