import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Locator } from 'playwright-core';
import { type Rig, startRig } from './harness.ts';

let rig: Rig;
before(async () => { rig = await startRig({ speed: 0.000000001 }); });
after(async () => { await rig.close(); });

async function focused(control: Locator): Promise<void> {
  await control.and(control.page().locator(':focus')).waitFor();
}

async function outlined(control: Locator): Promise<void> {
  assert.equal(await control.evaluate(node => {
    const style = getComputedStyle(node);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
  }), true);
}

test('skip link is keyboard reachable, focuses main and does not replace the hash route', async () => {
  const page = await rig.open('/fleet');
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.locator('#content-heading:focus').waitFor();
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    assert.equal(await skip.evaluate(node => node.getBoundingClientRect().bottom <= 0), true);
    await page.getByRole('navigation').locator('a').first().focus();
    await page.keyboard.press('Shift+Tab');
    await focused(skip);
    assert.equal(await skip.evaluate(node => node.getBoundingClientRect().top >= 0), true);
    await page.keyboard.press('Enter');
    await focused(page.getByRole('main', { name: 'Fleet' }));
    assert.match(page.url(), /#\/fleet$/);
  } finally { await page.context().close(); }
});

test('sidebar and keyboard navigation focus the new view heading, including session detail', async () => {
  const page = await rig.open('/overview');
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.getByRole('navigation').getByRole('link', { name: 'Fleet', exact: true }).click();
    await page.locator('#content-heading:focus').filter({ hasText: 'Fleet' }).waitFor();
    await page.keyboard.press('3');
    await page.locator('#content-heading:focus').filter({ hasText: 'Requests' }).waitFor();
    await page.keyboard.press('2');
    await page.locator('#content-heading:focus').filter({ hasText: 'Fleet' }).waitFor();
    const session = page.getByRole('table', { name: 'Fleet' }).locator('tbody tr[data-session] a').first();
    const name = (await session.innerText()).trim();
    await session.click();
    await page.waitForURL('**/#/session/*');
    await page.locator('#content-heading:focus').filter({ hasText: name }).waitFor();
  } finally { await page.context().close(); }
});

test('expanded and collapsed navigation names include attention and question badge counts', async () => {
  const page = await rig.open('/overview');
  try {
    await page.locator('.nav-badge[data-attention="ready"]').waitFor();
    const nav = page.getByRole('navigation');
    const attention = await nav.locator('#nav-overview-badge').getAttribute('aria-label');
    const questions = await nav.locator('#nav-questions-badge').getAttribute('aria-label');
    assert.match(attention ?? '', /^\d+ need you$/);
    assert.match(questions ?? '', /^\d+ waiting$/);
    for (const collapsed of [false, true]) {
      if (collapsed) await nav.getByRole('button', { name: '« Collapse', exact: true }).click();
      await nav.getByRole('link', { name: `Overview ${attention}`, exact: true }).waitFor();
      await nav.getByRole('link', { name: `Questions ${questions}`, exact: true }).waitFor();
      await nav.getByRole('link', { name: 'Fleet', exact: true }).waitFor();
    }
  } finally { await page.context().close(); }
});

test('request state is a native select reachable by Tab and changed from the keyboard', async () => {
  const page = await rig.open('/requests');
  try {
    const state = page.getByRole('combobox', { name: 'State', exact: true });
    await state.focus();
    assert.equal(await page.getByRole('tablist').count(), 0);
    assert.equal(await state.inputValue(), 'all');
    await state.selectOption('open');
    await page.getByTestId('request-summary').getByText('State: Open').waitFor();
    await page.keyboard.press('Tab');
    await focused(page.getByRole('combobox', { name: 'Origin', exact: true }));
  } finally { await page.context().close(); }
});

for (const [route, container, item, attribute] of [
  ['/fleet', 'table[aria-label="Fleet"]', 'tbody tr', 'data-session'],
  ['/questions', 'ol[aria-label="Questions"]', '[data-question]', 'data-question'],
  ['/messages', 'ol[aria-label="Messages"]', '[data-message]', 'data-message'],
] as const) {
  test(`${route} exposes keyboard selection as current without invalid aria-selected`, async () => {
    const page = await rig.open(route);
    try {
      await page.locator('.conn[data-connection="live"]').waitFor();
      const list = page.locator(container);
      const current = list.locator(`${item}[aria-current="true"]`);
      await current.waitFor();
      const before = await current.getAttribute(attribute);
      await page.keyboard.press('j');
      await page.waitForFunction(({ container, item, attribute, before }) => {
        const selected = document.querySelector(`${container} ${item}[aria-current="true"]`);
        return selected !== null && selected.getAttribute(attribute) !== before;
      }, { container, item, attribute, before });
      assert.equal(await current.count(), 1);
      assert.equal(await list.locator('[aria-selected]').count(), 0);
    } finally { await page.context().close(); }
  });
}

test('/questions history summary and preference selects have accessible names and keep list selection', async () => {
  const page = await rig.open('/questions');
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    for (const name of ['Sort', 'Warn after']) assert.equal(await page.getByRole('combobox', { name }).count(), 1, name);
    const summaries = page.locator('.question-history summary');
    if (await summaries.count() > 0) {
      assert.match(await summaries.first().innerText(), /^History \(\d+\)$/);
      assert.equal(await page.locator('.question-history ol[aria-label]').count(), await summaries.count());
    }
    assert.equal(await page.locator('ol[aria-label="Questions"] [aria-selected]').count(), 0);
    assert.equal(await page.locator('[data-question][aria-current="true"]').count(), 1);
  } finally { await page.context().close(); }
});

test('motion follows OS changes, unrelated saves do not override it, and explicit choices survive reloads', async () => {
  const page = await rig.open('/settings');
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('html[data-motion="reduced"]').waitFor();
    await page.getByRole('navigation').getByRole('button', { name: '« Collapse', exact: true }).click();
    await page.getByRole('button', { name: 'dawn theme', exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pi-console.prefs') ?? '{}') as Record<string, unknown>);
    assert.equal(Object.hasOwn(saved, 'reducedMotion'), false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('html[data-motion="full"]').waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('html[data-motion="reduced"]').waitFor();
    await page.getByRole('group', { name: 'Reduce motion' }).getByRole('button', { name: 'Off', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.locator('html[data-motion="full"]').waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('group', { name: 'Reduce motion' }).getByRole('button', { name: 'On', exact: true }).click();
    await page.reload();
    await page.locator('html[data-motion="reduced"]').waitFor();
    await page.getByRole('group', { name: 'Reduce motion' }).getByRole('button', { name: 'System', exact: true }).click();
    await page.locator('html[data-motion="full"]').waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('html[data-motion="reduced"]').waitFor();
    await page.reload();
    await page.locator('html[data-motion="reduced"]').waitFor();
    const following = await page.evaluate(() => JSON.parse(localStorage.getItem('pi-console.prefs') ?? '{}') as Record<string, unknown>);
    assert.equal(Object.hasOwn(following, 'reducedMotion'), false);
  } finally { await page.context().close(); }
});

test('forced colors retains search, button, current-navigation and selection outlines', async () => {
  const page = await rig.open('/fleet');
  try {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.locator('table[aria-label="Fleet"] tbody tr[aria-current="true"]').waitFor();
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox');
    await focused(search);
    await outlined(search);
    await page.keyboard.press('Tab');
    const group = page.locator('.group-toggle').first();
    await focused(group);
    await outlined(group);
    await outlined(page.getByRole('navigation').locator('[aria-current="page"]'));
    await outlined(page.locator('table[aria-label="Fleet"] tbody tr[aria-current="true"]'));
    await page.keyboard.press('3');
    const state = page.getByRole('combobox', { name: 'State', exact: true });
    await state.waitFor();
    await state.focus();
    await focused(state);
    await outlined(state);
  } finally { await page.context().close(); }
});

test('silent live streams announce a stable warning while the visible frame age advances', async () => {
  const silentRig = await startRig({ speed: 0.000000001 });
  const page = await silentRig.open('/fleet', { token: null });
  try {
    const now = new Date('2026-11-20T10:00:00.000Z');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    await page.getByLabel('Access token', { exact: true }).fill(silentRig.daemon.token);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.clock.runFor(21_000);
    const banner = page.getByTestId('banner');
    await banner.waitFor();
    assert.match(await banner.innerText(), /No frames for 21s: the data below may be stale\./);
    const alert = banner.getByRole('alert');
    const announcement = await alert.innerText();
    assert.equal(announcement, 'No frames');
    await page.clock.runFor(2000);
    assert.match(await banner.innerText(), /No frames for 23s: the data below may be stale\./);
    assert.equal(await alert.innerText(), announcement);
    assert.equal(await banner.getAttribute('role'), null);
  } finally { await page.context().close(); await silentRig.close(); }
});

test('virtualized Work keeps table row counts, a focused row mounted, and Tab reveals the adjacent logical row', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.jobs;
  fixture.jobs = Array.from({ length: 2000 }, (_, index) => ({ ...original[0], id: `a11y-big-${String(index).padStart(4, '0')}`, name: `A11y work ${String(index)}`, status: 'running' }));
  const page = await rig.open('/work', { width: 1440, height: 600 });
  try {
    const table = page.getByRole('table', { name: 'Work' });
    await table.locator('tbody tr[data-vindex="0"]').waitFor();
    const total = Number(await table.getAttribute('aria-rowcount')) - 1;
    assert.ok(total > 200, 'a large list is loaded');
    assert.equal(await table.locator('thead tr').getAttribute('aria-rowindex'), '1');
    assert.equal(await table.locator('tbody tr[data-vindex="3"]').getAttribute('aria-rowindex'), '5');
    assert.equal(await table.locator('tbody tr[aria-hidden="true"]').evaluateAll(rows => rows.every(row => row.querySelector('a, button') === null)), true, 'spacers hold no controls');
    assert.equal(await table.locator('[aria-selected]').count(), 0);

    const link = table.locator('tbody tr[data-vindex="3"] a');
    await link.focus();
    await page.locator('#content').evaluate(node => { node.scrollTop = node.scrollHeight / 2; });
    await page.waitForFunction(count => [...document.querySelectorAll('table[aria-label="Work"] tr[data-vindex]')].some(row => Math.abs(Number(row.getAttribute('data-vindex')) - count / 2) < 40), total);
    await focused(link);
    assert.ok(await table.locator('tbody tr[data-vindex]').count() < 60, 'only the focused row is kept beyond the window');

    await page.keyboard.press('Tab');
    await focused(table.locator('tbody tr[data-vindex="4"] a'));
    await page.keyboard.press('Shift+Tab');
    await focused(table.locator('tbody tr[data-vindex="3"] a'));
  } finally { fixture.jobs = original; await page.context().close(); }
});

test('virtualized Work keeps focus on the same job when a live update inserts a row above it', async () => {
  const fixture = rig.daemon.store.fixture;
  const original = fixture.jobs;
  fixture.jobs = Array.from({ length: 2000 }, (_, index) => ({ ...original[0], id: `shift-${String(index).padStart(4, '0')}`, name: `Shift work ${String(index)}`, status: 'running', startedAt: new Date(Date.parse('2026-11-20T09:00:00Z') - index * 1000).toISOString() }));
  const page = await rig.open('/work', { width: 1440, height: 600 });
  try {
    const table = page.getByRole('table', { name: 'Work' });
    await table.locator('tbody tr[data-vindex="0"]').waitFor();
    const row = table.locator('tbody tr[data-vkey="shift-0003"]');
    const link = row.locator('a');
    await link.focus();
    await page.locator('#content').evaluate(node => { node.scrollTop = node.scrollHeight / 2; });
    await page.waitForFunction(() => document.querySelector('table[aria-label="Work"] tr[data-vindex="0"]') === null);
    await focused(link);
    rig.daemon.store.publish('job.updated', { ...original[0], id: 'shift-newest', name: 'Shift newest', status: 'running', startedAt: '2026-11-20T10:00:00Z' });
    await page.waitForFunction(() => document.querySelector('table[aria-label="Work"] tr[data-vkey="shift-0003"]')?.getAttribute('data-vindex') === '4');
    await focused(link);
    assert.equal(await row.getAttribute('data-vindex'), '4', 'the focused job moved down by one and is still the pinned row');
    assert.ok(await table.locator('tbody tr[data-vindex]').count() < 60);
    await page.keyboard.press('Tab');
    await focused(table.locator('tbody tr[data-vkey="shift-0004"] a'));
  } finally { fixture.jobs = original; await page.context().close(); }
});
