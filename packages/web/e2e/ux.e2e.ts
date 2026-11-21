import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { AttentionItem } from '@pi-console/contract';
import type { Page } from 'playwright-core';
import { startRig, type Rig } from './harness.ts';

let rig: Rig;
before(async () => { rig = await startRig({ speed: 1e-9 }); });
after(async () => { await rig.close(); });

async function connect(page: Page): Promise<void> {
  await page.getByLabel('Access token').fill(rig.daemon.token);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('.conn[data-connection="live"]').waitFor();
}

const fullyVisible = (page: Page, selector: string): Promise<number> => page.locator(selector).evaluateAll(nodes => nodes.filter(node => {
  const rect = node.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= innerHeight - 30;
}).length);

test('dense attention keeps daemon order, ten visible items and keyboard selection', async () => {
  const page = await rig.open('/overview', { token: null, width: 1440, height: 900 });
  const reasons: AttentionItem['reason'][] = ['blocking-question', 'open-request', 'answer-possibly-unseen', 'stale-session'];
  const items: AttentionItem[] = Array.from({ length: 40 }, (_, index) => ({
    id: `attention-${index}`, reason: reasons[index % reasons.length], sessionId: 's2', laneId: null,
    text: `Attention detail ${index}`, since: '2026-11-20T09:00:00Z', pointer: null,
  }));
  await page.route('**/api/v1/needs-you', route => route.fulfill({ json: { items } }));
  await connect(page);
  await page.locator('[data-reason]').nth(39).waitFor();
  assert.ok(await fullyVisible(page, '[data-reason]') >= 10);
  assert.equal(await page.locator('.attention-heading').count(), 40);
  await page.keyboard.press('j');
  assert.equal(await page.locator('[data-reason][aria-current="true"] .card-text').innerText(), 'Attention detail 1');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/#/session/s2');
  await page.context().close();
});

test('questions distinguish blocking and urgent, with read-only lettered options', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.questions;
  const seed = original[0];
  fixture.questions = [
    { ...seed, id: 'blocking-ux', status: 'open', blocking: true, urgency: 'high', options: ['Proceed', 'Wait'] },
    { ...seed, id: 'neutral-ux', status: 'open', blocking: false, urgency: 'normal', options: [] },
  ];
  const page = await rig.open('/questions');
  try {
    await page.locator('[data-question="neutral-ux"]').waitFor();
    await page.getByRole('img', { name: 'Urgent', exact: true }).waitFor();
    assert.match(await page.locator('.question-options').innerText(), /A · Proceed/);
    assert.equal(await page.locator('.question-options button').count(), 0);
    const borders = await page.locator('.question').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderLeftColor));
    assert.notEqual(borders[0], borders[1]);
    await page.keyboard.press('j');
    await page.locator('[data-question="neutral-ux"].selected').waitFor();
  } finally { fixture.questions = original; await page.context().close(); }
});

test('repository lane labels, readable timeline ticks and selected row survive zoom and pan', async () => {
  const page = await rig.open('/messages');
  await page.getByRole('list', { name: 'Messages', exact: true }).waitFor();
  assert.ok((await page.getByRole('list', { name: 'Messages', exact: true }).innerText()).includes('/L0'));
  await page.getByRole('button', { name: /^Graph/ }).click();
  await page.locator('.node .label').first().waitFor();
  assert.ok((await page.locator('.node .label').allTextContents()).every(label => label.includes('/L')));
  await page.evaluate(() => { location.hash = '/timeline'; });
  await page.locator('.lane.selected').waitFor();
  assert.ok((await page.locator('.lane-label').allTextContents()).every(label => label.includes('/L')));
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Pan later', exact: true }).click();
  const labels = await page.locator('.tl .axis').allTextContents();
  assert.ok(labels.length >= 2 && labels.every(label => /^\d{2}:\d{2}:[0-5]0$/.test(label)));
  const selected = await page.locator('.lane.selected .lane-label').innerText();
  await page.keyboard.press('j');
  assert.notEqual(await page.locator('.lane.selected .lane-label').innerText(), selected);
  await page.context().close();
});

test('1100px navigation is an icon rail, Fleet fits, and transcript controls do not cover text', async () => {
  const page = await rig.open('/fleet', { width: 1100, height: 900 });
  await page.locator('[data-session]').first().waitFor();
  assert.equal(await page.locator('.sidebar').evaluate(node => node.getBoundingClientRect().width), 60);
  assert.ok(await page.locator('table').evaluate(node => node.getBoundingClientRect().right <= innerWidth));
  await page.locator('table tbody a').first().click();
  await page.locator('.tline').first().waitFor();
  const bounds = await page.evaluate(() => ({
    controls: document.querySelector('.transcript-controls')?.getBoundingClientRect().bottom ?? Infinity,
    pane: document.querySelector('.transcript')?.getBoundingClientRect().top ?? 0,
  }));
  assert.ok(bounds.controls <= bounds.pane);
  await page.context().close();
});

test('compact human requests fit six per viewport while detail keeps full text', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.requests;
  const seed = original[0];
  fixture.requests = Array.from({ length: 12 }, (_, index) => ({
    ...seed, id: `human-ux-${index}`, origin: 'human', originLabel: 'Classified as human', status: 'open',
    text: 'A long human request with details. '.repeat(20), answer: null, interimAnswers: [],
    uncertain: false, uncertainReason: null, answerPossiblyUnseen: false,
  }));
  const page = await rig.open('/requests', { width: 1440, height: 900 });
  try {
    await page.locator('.human-request').nth(11).waitFor();
    assert.ok(await fullyVisible(page, '.human-request') >= 6);
    assert.ok((await page.locator('.request-detail').innerText()).includes(fixture.requests[0].text.trim()));
    await page.keyboard.press('j');
    assert.equal(await page.locator('.request-card.selected').count(), 1);
  } finally { fixture.requests = original; await page.context().close(); }
});
