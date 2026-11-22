import assert from 'node:assert/strict';
import './memory-live.e2e.ts';
import './timeline.e2e.ts';
import { after, before, test } from 'node:test';
import type { AttentionItem, MemoryItem } from '@pi-console/contract';
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
  assert.deepEqual(await page.locator('[data-reason] .card-text').allTextContents(), items.map(item => item.text));
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

test('memory review requests wait for pi and producer ingestion; actions never optimistically change status', async () => {
  const page = await rig.open('/session/s1');
  let phase = 'awaiting-human';
  let posted = { requestId: '', itemId: '', action: '' };
  let posts = 0;
  const hostile = `<img src=x onerror="globalThis.__memoryReviewXss=true">${String.fromCharCode(27)}[31munsafe`;
  await page.route('**/api/v1/memory-items?*', async route => {
    const response = await route.fetch();
    const body = await response.json() as { items: MemoryItem[] };
    await route.fulfill({ response, json: { ...body, items: body.items.map(item => item.id === 'item-2' ? { ...item, text: hostile } : item) } });
  });
  const reply = () => ({
    version: 1, ...posted, sessionId: 's1', generation: 'g1', connectionGeneration: 'c1', tokenId: 'synthetic-control',
    state: phase, reason: null, eventId: null, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 60_000,
  });
  await page.route('**/api/v1/**/memory-actions*', async route => {
    if (route.request().method() === 'POST') { posts++; posted = route.request().postDataJSON() as typeof posted; await route.fulfill({ json: reply() }); return; }
    await route.fulfill({ json: { version: 1, available: true, providerVersion: 1, generation: 'g1', reason: 'available' } });
  });
  await page.route('**/api/v1/memory-actions/*', route => route.fulfill({ json: reply() }));
  try {
    await page.reload();
    const row = page.locator('[data-memory-item="item-2"]');
    await row.getByRole('button', { name: 'Confirm…', exact: true }).waitFor();
    assert.match(await row.innerText(), /<img src=x onerror=/);
    assert.equal((await row.innerText()).includes(String.fromCharCode(27)), false);
    assert.equal(await row.locator('img, script').count(), 0);
    assert.equal(await page.evaluate(() => Object.hasOwn(globalThis, '__memoryReviewXss')), false);
    await row.getByRole('button', { name: 'Confirm…', exact: true }).click();
    await row.getByRole('status').filter({ hasText: 'Awaiting confirmation in pi' }).waitFor();
    assert.equal(await row.getByRole('button', { name: 'Confirm…', exact: true }).isDisabled(), true);
    assert.match(await row.innerText(), /proposed/);
    assert.equal(posts, 1);
    assert.deepEqual(Object.keys(posted).sort(), ['action', 'itemId', 'requestId']);
    phase = 'awaiting-ingestion';
    await row.getByRole('status').filter({ hasText: 'awaiting producer ingestion' }).waitFor();
    assert.match(await row.innerText(), /proposed/);
    phase = 'observed-applied';
    await row.getByRole('status').filter({ hasText: 'Producer change observed' }).waitFor();
    assert.match(await row.innerText(), /proposed/, 'a receipt alone cannot synthesize a producer update');
    assert.equal(posts, 1);
  } finally { await page.context().close(); }
});

test('memory review exposes every unavailability fallback and preserves copy commands', async () => {
  const page = await rig.open('/session/s1');
  let reason = 'read-only';
  await page.route('**/api/v1/sessions/*/memory-actions', route => route.fulfill({ json: { version: 1, available: false, providerVersion: null, generation: null, reason } }));
  try {
    for (const [value, label] of [['read-only', 'This token is read-only'], ['disabled', 'Memory review is disabled'], ['offline', 'The owning pi session is offline'], ['unsupported', 'does not support memory review v1'], ['not-ready', 'not ready for review']]) {
      reason = value;
      await page.reload();
      await page.locator('.memory-panel').getByText(label, { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Confirm…', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Copy command', exact: true }).count(), 1);
    }
  } finally { await page.context().close(); }
});

test('memory reject requests report pi decline and receipt loss as non-applied outcomes', async () => {
  for (const outcome of ['declined', 'lost']) {
    const page = await rig.open('/session/s1');
    let body: Record<string, unknown> = {};
    await page.route('**/api/v1/sessions/*/memory-actions', async route => {
      if (route.request().method() === 'GET') { await route.fulfill({ json: { version: 1, available: true, providerVersion: 1, generation: 'g1', reason: 'available' } }); return; }
      body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ...body, version: 1, sessionId: 's1', generation: 'g1', connectionGeneration: 'c1', tokenId: 'synthetic', state: 'awaiting-human', reason: null, eventId: null, createdAt: Date.now() - 60_000, updatedAt: Date.now(), expiresAt: outcome === 'lost' ? Date.now() - 28_500 : Date.now() + 60_000 } });
    });
    await page.route('**/api/v1/memory-actions/*', route => outcome === 'lost'
      ? route.fulfill({ status: 404, json: { error: 'Receipt not found' } })
      : route.fulfill({ json: { ...body, state: 'declined', reason: 'cancelled' } }));
    try {
      await page.reload();
      const row = page.locator('[data-memory-item="item-2"]');
      await row.getByRole('button', { name: 'Reject…', exact: true }).click();
      await row.getByRole('status').filter({ hasText: outcome === 'lost' ? 'Review outcome unknown' : 'Review declined in pi' }).waitFor();
      assert.equal(body.action, 'reject');
      assert.match(await row.innerText(), /proposed/);
    } finally { await page.context().close(); }
  }
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
  const selected = await page.locator('.lane.selected .lane-label').textContent();
  assert.ok(selected?.includes('/L'));
  await page.keyboard.press('j');
  assert.notEqual(await page.locator('.lane.selected .lane-label').textContent(), selected);
  await page.context().close();
});

test('1100px navigation is an icon rail, Fleet fits, and transcript controls do not cover text', async () => {
  const page = await rig.open('/fleet', { width: 1100, height: 900 });
  await page.locator('[data-session]').first().waitFor();
  // The accepted collapsed rail is 80px; the audit requires collapse and a Fleet table that fits, not a 60px rail.
  assert.equal(await page.locator('.sidebar').evaluate(node => node.getBoundingClientRect().width), 80);
  assert.ok(await page.locator('table').evaluate(node => node.getBoundingClientRect().right <= innerWidth));
  // Only s2 has seeded transcript entries; the first Fleet row correctly has an empty transcript.
  await page.locator('tr[data-session="s2"] a').click();
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
