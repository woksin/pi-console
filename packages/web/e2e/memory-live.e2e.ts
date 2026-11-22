import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { memoryDaemon } from '../../daemon/src/testing/memory-live.ts';
import { createStaticServer } from '../src/server/static-server.ts';
import { browserPath } from './harness.ts';

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
    spec.journal();
    await page.getByText('unresolved: 1+ (lower bound)', { exact: false }).waitFor();
    spec.classify();
    await page.getByText('unresolved: 0+ (lower bound)', { exact: false }).waitFor();
    assert.equal(actionCalls, 0, 'automatic refresh is read-only');
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE JOURNAL BODY'), false);
  } finally {
    await browser.close();
    await new Promise<void>(done => { web.close(() => { done(); }); });
    await spec.close();
  }
});
