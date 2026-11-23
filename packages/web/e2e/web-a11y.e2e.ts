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

test('request filters are native, Tab-reachable toggle buttons with no incomplete tab widget', async () => {
  const page = await rig.open('/requests');
  try {
    const filters = page.getByRole('group', { name: 'Request state' });
    const buttons = filters.getByRole('button');
    await buttons.first().focus();
    assert.equal(await page.getByRole('tablist').count(), 0);
    assert.equal(await page.getByRole('tab').count(), 0);
    assert.equal(await buttons.first().getAttribute('aria-pressed'), 'true');
    for (const [index, key] of [[1, 'Space'], [2, 'Enter']] as const) {
      await page.keyboard.press('Tab');
      await focused(buttons.nth(index));
      await page.keyboard.press(key);
      assert.equal(await buttons.nth(index).getAttribute('aria-pressed'), 'true');
      assert.equal(await filters.locator('[aria-pressed="true"]').count(), 1);
    }
    assert.match(page.url(), /#\/requests$/);
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
    await page.getByLabel('Reduce motion').uncheck();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.locator('html[data-motion="full"]').waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByLabel('Reduce motion').check();
    await page.reload();
    await page.locator('html[data-motion="reduced"]').waitFor();
    await page.getByRole('button', { name: 'Follow system motion', exact: true }).click();
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
    const selectedFilter = page.getByRole('group', { name: 'Request state' }).locator('[aria-pressed="true"]');
    await selectedFilter.waitFor();
    await outlined(selectedFilter);
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
