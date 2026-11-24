import assert from 'node:assert/strict';
import './memory-live.e2e.ts';
import './timeline.e2e.ts';
import './graph.e2e.ts';
import './media-flows.e2e.ts';
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

test('dense attention groups by priority and recency, with counted headings, ten visible items and keyboard selection', async () => {
  const page = await rig.open('/overview', { token: null, width: 1440, height: 900 });
  const priority: AttentionItem['reason'][] = ['blocking-question', 'open-request', 'answer-possibly-unseen', 'stale-session'];
  const reasons = priority.toReversed();
  const items: AttentionItem[] = Array.from({ length: 40 }, (_, index) => ({
    id: `attention-${index}`, reason: reasons[index % reasons.length], sessionId: 's2', laneId: null,
    text: `Attention detail ${index}`, since: new Date(Date.parse('2026-11-20T09:00:00Z') + index * 60_000).toISOString(), pointer: null,
  }));
  const ordered = priority.flatMap(reason => items.filter(item => item.reason === reason).toReversed());
  await page.route('**/api/v1/needs-you', route => route.fulfill({ json: { items } }));
  await connect(page);
  await page.locator('[data-reason]').nth(39).waitFor();
  assert.ok(await fullyVisible(page, '[data-reason]') >= 10);
  assert.deepEqual(await page.locator('.attention-heading').allTextContents(), ['Blocking question 10', 'Open request 10', 'Possibly unseen 10', 'Stale session 10']);
  assert.deepEqual(await page.locator('[data-reason] .card-text').allTextContents(), ordered.map(item => item.text));
  await page.keyboard.press('j');
  assert.equal(await page.locator('[data-reason][aria-current="true"] .card-text').innerText(), ordered[1].text);
  await page.keyboard.press('k');
  assert.equal(await page.locator('[data-reason][aria-current="true"] .card-text').innerText(), ordered[0].text);
  await page.keyboard.press('Enter');
  await page.waitForURL('**/#/session/s2');
  await page.context().close();
});

test('Work keyboard paging and bottom jump keep the selected row visible', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.jobs;
  fixture.jobs = Array.from({ length: 40 }, (_, index) => ({
    ...original[0], id: `work-scroll-${String(index).padStart(2, '0')}`, name: `Work row ${String(index)}`, status: 'running',
  }));
  const page = await rig.open('/work', { width: 1440, height: 400 });
  try {
    const rows = page.locator('.grid[aria-label="Work"] tbody tr');
    await rows.first().waitFor();
    for (const [key, index] of [['PageDown', 10], ['G', 39]] as const) {
      await page.keyboard.press(key);
      await page.locator('.grid tr.selected').filter({ hasText: `Work row ${String(index)}` }).waitFor();
      await page.waitForFunction(() => {
        const selected = document.querySelector('.grid tr.selected')?.getBoundingClientRect();
        const viewport = document.querySelector('#content')?.getBoundingClientRect();
        return selected && viewport && selected.top >= viewport.top && selected.bottom <= viewport.bottom;
      }, undefined, { timeout: 2000 });
    }
  } finally { fixture.jobs = original; await page.context().close(); }
});

/** Rows mounted by a virtualized table body (spacers carry no index). */
const mountedRows = (page: Page, table: string): Promise<number> => page.locator(`table[aria-label="${table}"] tbody tr[data-vindex]`).count();

/** The logical row count the table announces, excluding its header row. */
async function loadedRows(page: Page, table: string): Promise<number> {
  const count = await page.locator(`table[aria-label="${table}"]`).getAttribute('aria-rowcount');
  return Number(count) - 1;
}

test('a large Work list mounts a bounded window; distant scroll, keyboard jumps, filter, open and copy still work', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.jobs;
  fixture.jobs = Array.from({ length: 3000 }, (_, index) => ({ ...original[0], id: `work-big-${String(index).padStart(4, '0')}`, name: `Big work ${String(index)}`, status: 'running' }));
  const page = await rig.open('/work', { width: 1440, height: 600 });
  try {
    const table = 'Work';
    await page.locator('table[aria-label="Work"] tbody tr[data-vindex]').first().waitFor();
    const total = await loadedRows(page, table);
    assert.ok(total > 200, `the snapshot loads a large list (${String(total)})`);
    const mounted = await mountedRows(page, table);
    assert.ok(mounted > 0 && mounted < 60, `mounted rows are bounded by viewport plus overscan, not ${String(total)} (got ${String(mounted)})`);

    await page.keyboard.press('G');
    const last = page.locator(`table[aria-label="Work"] tr.selected[data-vindex="${String(total - 1)}"]`);
    await last.waitFor();
    assert.equal(await last.getAttribute('aria-rowindex'), String(total + 1), 'the header is row 1');
    assert.ok(await mountedRows(page, table) < 60);

    await page.locator('#content').evaluate(node => { node.scrollTop = node.scrollHeight / 2; });
    await page.waitForFunction(count => [...document.querySelectorAll('table[aria-label="Work"] tr[data-vindex]')].some(row => Math.abs(Number(row.getAttribute('data-vindex')) - count / 2) < 40), total);
    const middle = await page.locator('#content').evaluate(node => node.scrollTop);
    await page.waitForTimeout(300);
    assert.ok(Math.abs(await page.locator('#content').evaluate(node => node.scrollTop) - middle) < 2, 'manual scrolling is not pulled back to the selection');
    assert.ok(await mountedRows(page, table) < 60);

    await page.locator('#content').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.locator(`table[aria-label="Work"] tr[data-vindex="${String(total - 1)}"]`).waitFor();

    await page.keyboard.press('/');
    await page.getByRole('searchbox').fill('work-big-0007');
    await page.waitForFunction(() => document.querySelector('table[aria-label="Work"]')?.getAttribute('aria-rowcount') === '2');
    await page.getByRole('searchbox').fill('');
    await page.waitForFunction(count => document.querySelector('table[aria-label="Work"]')?.getAttribute('aria-rowcount') === String(count + 1), total);

    await page.getByRole('searchbox').evaluate(node => { node.blur(); });
    await page.keyboard.press('G');
    await last.waitFor();
    await page.keyboard.press('y');
    await page.getByTestId('copy-notice').filter({ hasText: /Copied id|Could not copy id/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.waitForURL(`**/#/session/${original[0].sessionId}`);
  } finally { fixture.jobs = original; await page.context().close(); }
});

test('a large Fleet mounts a bounded window and keeps native group toggles and keyboard jumps', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.sessions;
  const repositories = fixture.repositories.map(repository => repository.id);
  // The mock stream drops a client whose first snapshot exceeds 1 MiB, so keep each session lean.
  fixture.sessions = Array.from({ length: 400 }, (_, index) => ({
    ...original[0], samples: original[0].samples.slice(-2), id: `fleet-big-${String(index).padStart(4, '0')}`, name: `Fleet big ${String(index).padStart(4, '0')}`, parentSessionId: null, repositoryId: repositories[index % repositories.length],
  }));
  const page = await rig.open('/fleet', { width: 1440, height: 600 });
  try {
    const table = 'Fleet';
    await page.locator('table[aria-label="Fleet"] tbody tr[data-vindex]').first().waitFor();
    const total = await loadedRows(page, table);
    assert.ok(total > 200, `the snapshot loads a large list (${String(total)})`);
    assert.ok(await mountedRows(page, table) < 60, 'mounted rows are bounded by viewport plus overscan');

    await page.keyboard.press('G');
    const last = page.locator(`table[aria-label="Fleet"] tr[aria-current="true"][data-vindex="${String(total - 1)}"]`);
    await last.waitFor();
    assert.equal(await last.getAttribute('aria-rowindex'), String(total + 1));
    assert.equal(await page.locator('table[aria-label="Fleet"] tr[aria-current="true"]').count(), 1, 'exactly one current row');
    assert.equal(await page.locator('table[aria-label="Fleet"] [aria-selected]').count(), 0);

    await page.keyboard.press('g');
    await page.locator('table[aria-label="Fleet"] tr[aria-current="true"][data-vindex="0"]').waitFor();
    const toggle = page.locator('.group-toggle').first();
    await toggle.focus();
    await page.keyboard.press('Space');
    await toggle.and(page.locator('[aria-expanded="false"]')).waitFor();
    assert.ok(await loadedRows(page, table) < total, 'collapsing a group removes its rows from the logical list');
    await page.keyboard.press('Enter');
    await toggle.and(page.locator('[aria-expanded="true"]')).waitFor();
    assert.equal(await loadedRows(page, table), total);

    await page.keyboard.press('Tab');
    const focusedRow = page.locator('table[aria-label="Fleet"] tbody tr[data-vindex="1"] a');
    await focusedRow.and(page.locator(':focus')).waitFor();
  } finally { fixture.sessions = original; await page.context().close(); }
});

test('advancing the clock updates visible ages without remounting rows', async () => {
  const page = await rig.open('/work', { token: null, width: 1440, height: 600 });
  try {
    await page.clock.install({ time: new Date('2026-11-20T10:00:00.000Z') });
    await page.clock.pauseAt(new Date('2026-11-20T10:00:00.000Z'));
    await connect(page);
    const row = page.locator('table[aria-label="Work"] tbody tr[data-vindex="0"]');
    await row.waitFor();
    await row.evaluate(node => { node.setAttribute('data-probe', 'kept'); });
    const before = await row.locator('td').last().innerText();
    const mounted = await mountedRows(page, 'Work');
    await page.clock.fastForward(2 * 86_400_000);
    await page.waitForFunction(text => document.querySelector('table[aria-label="Work"] tbody tr[data-vindex="0"] td:last-child')?.textContent !== text, before);
    assert.equal(await row.getAttribute('data-probe'), 'kept', 'the row element is updated in place, not remounted');
    assert.equal(await mountedRows(page, 'Work'), mounted);
  } finally { await page.context().close(); }
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

test('question history discloses by keyboard, newest first, as text, with stale text and named sort and threshold controls', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.questions;
  const seed = original[0];
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const recent = new Date().toISOString();
  // The mock fixture type predates the optional v1 history fields; the daemon serves them through unchanged.
  const questions: (typeof seed & { updatedAt?: string; history?: unknown[] })[] = [
    { ...seed, id: 'history-ux', text: 'History question', status: 'open', blocking: false, createdAt: old, updatedAt: recent, history: [
      { sequence: 2, operation: 'comment', at: recent, actor: 'L0', excerpt: '<b>not html</b>', withheld: false },
      { sequence: 1, operation: 'created', at: old, actor: null, withheld: false }] },
    { ...seed, id: 'stale-ux', text: 'Forgotten question', status: 'open', blocking: false, createdAt: old },
  ];
  fixture.questions = questions;
  const page = await rig.open('/questions');
  try {
    const card = page.locator('[data-question="history-ux"]');
    await card.waitFor();
    await page.locator('[data-question="stale-ux"]').getByText(/Stale · no activity for/).waitFor();
    assert.equal(await card.getByText(/Stale ·/).count(), 0, 'recent activity clears the badge');
    assert.match(await page.locator('[data-question="stale-ux"]').innerText(), /History unavailable/);
    const summary = card.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await card.locator('details').getAttribute('open'), '');
    const entries = card.locator('ol[aria-label^="History of"] > li');
    assert.equal(await entries.count(), 2);
    assert.match(await entries.nth(0).innerText(), /commented by L0/);
    assert.match(await entries.nth(1).innerText(), /created by unknown/);
    assert.equal(await card.locator('.question-history b').count(), 0, 'note text is not interpreted as HTML');
    assert.match(page.url(), /#\/questions$/, 'summary activation does not navigate');
    await page.getByLabel('Sort').selectOption('activity');
    assert.equal(await page.locator('[data-question]').first().getAttribute('data-question'), 'history-ux');
    await page.getByLabel('Warn after').selectOption('30');
    assert.equal(await page.getByText(/Stale ·/).count(), 0, 'a longer threshold clears the badge');
  } finally { fixture.questions = original; await page.context().close(); }
});

test('a possibly-moot question is marked in text with inspectable evidence, advisory only, while unproven ones are not', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.questions;
  const seed = original[0];
  // The page shows the daemon's clock (the newest snapshot time), which the mock holds at its fixture date, not the test machine's: evidence dated by the wall clock would be "future" and withheld.
  const shown = Math.max(Date.parse(fixture.generatedAt), ...fixture.messages.map(message => Date.parse(message.sentAt)), ...fixture.sessions.map(session => Date.parse(session.updatedAt)));
  const closedAt = new Date(shown - 86_400_000).toISOString();
  const fetchedAt = new Date(shown - 60_000).toISOString();
  const evidence = (target: string, state: string) => ({ target, kind: 'issue', state, closedAt: state === 'open' ? null : closedAt, fetchedAt, source: 'github-gh' });
  const questions: (typeof seed & { links?: string[]; linkEvidence?: unknown[] })[] = [
    { ...seed, id: 'moot-ux', text: 'Moot question', status: 'open', blocking: false, links: ['a/b#1'], linkEvidence: [evidence('a/b#1', 'closed')] },
    { ...seed, id: 'open-ux', text: 'Still live', status: 'open', blocking: false, links: ['a/b#2'], linkEvidence: [evidence('a/b#2', 'open')] },
  ];
  fixture.questions = questions;
  const page = await rig.open('/questions');
  try {
    const moot = page.locator('[data-question="moot-ux"]');
    await moot.waitFor();
    await moot.getByText('Possibly moot', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-question="open-ux"]').getByText('Possibly moot', { exact: true }).count(), 0);
    const summary = moot.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.match(await moot.locator('ul[aria-label^="GitHub evidence"]').innerText(), /a\/b#1 · issue closed · closed .* · github-gh/);
    // The evidence is a collapsed disclosure on every card that has it, so innerText of a closed one is only its summary: open it as a user would.
    const unproven = page.locator('[data-question="open-ux"] .question-moot');
    await unproven.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.match(await unproven.innerText(), /observed open/);
    assert.match(page.url(), /#\/questions$/);
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
    const copyButton = page.getByRole('button', { name: 'Copy command', exact: true });
    for (const theme of ['dawn', 'contrast']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      assert.match(await copyButton.getAttribute('class') ?? '', /\bbtn\b/, `Copy command is a themed button in ${theme}`);
    }
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); });
    await copyButton.click();
    await page.getByTestId('copy-notice').filter({ hasText: 'Could not copy memory command' }).waitFor();
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

test('session labels, readable timeline ticks and selected row survive zoom and pan', async () => {
  const page = await rig.open('/messages');
  await page.getByRole('list', { name: 'Messages', exact: true }).waitFor();
  assert.ok((await page.getByRole('list', { name: 'Messages', exact: true }).innerText()).includes('aurora coordinator · L0'));
  await page.getByRole('button', { name: /^Graph/ }).click();
  await page.locator('.node .label').first().waitFor();
  assert.ok((await page.getByRole('region', { name: 'Lane communication' }).locator('.node .label:not(.name)').allTextContents()).every(label => /^L\d+$/.test(label)));
  assert.ok((await page.getByRole('region', { name: 'Session relationships' }).locator('.node title').allTextContents()).every(label => label.includes(' · L')));
  await page.evaluate(() => { location.hash = '/timeline'; });
  await page.locator('.lane.selected').waitFor();
  assert.ok((await page.locator('.lane-label').allTextContents()).every(label => label.includes(' · L')));
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Pan later', exact: true }).click();
  const labels = await page.locator('.tl .axis').allTextContents();
  assert.ok(labels.length >= 2 && labels.every(label => /^\d{2}:\d{2}:[0-5]0$/.test(label)));
  const selected = await page.locator('.lane.selected .lane-label').textContent();
  assert.ok(selected?.includes(' · L'));
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

test('request filters keep every control inside the viewport at 768px and the state select offers all seven states', async () => {
  const page = await rig.open('/requests', { width: 768, height: 900 });
  try {
    const state = page.getByRole('combobox', { name: 'State', exact: true });
    await state.waitFor();
    assert.deepEqual(await state.locator('option').allTextContents(), ['All', 'Open', 'Answered', 'Unanswered', 'Interrupted', 'Uncertain', 'Possibly unseen']);
    for (const control of [state, page.getByRole('combobox', { name: 'Origin', exact: true }), page.getByRole('combobox', { name: 'Session', exact: true }), page.getByRole('searchbox')]) {
      assert.equal(await control.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
      }), true, 'filter control is inside the viewport');
    }
    await state.selectOption('uncertain');
    await page.getByTestId('request-summary').getByText('state uncertain').waitFor();
  } finally { await page.context().close(); }
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
