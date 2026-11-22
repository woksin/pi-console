import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Locator, Page } from 'playwright-core';
import { startRig, type Rig } from './harness.ts';

let rig: Rig;
before(async () => { rig = await startRig({ speed: 1e-9 }); });
after(async () => { await rig.close(); });

async function focused(control: Locator): Promise<void> {
  assert.equal(await control.evaluate(node => node === document.activeElement), true);
}

test('timeline events are tabbable controls with visible focus and shared keyboard/click details', async () => {
  const page = await rig.open('/timeline');
  try {
    const events = page.locator('.timeline-marker');
    await events.nth(1).waitFor();
    await page.getByRole('button', { name: 'Fit', exact: true }).focus();
    await page.keyboard.press('Tab');
    await focused(events.first());
    assert.equal(await events.first().getAttribute('role'), 'button');
    assert.match(await events.first().getAttribute('aria-label') ?? '', /.+ · .+ · .+ · .+/);
    assert.equal(await events.first().evaluate(node => node.closest('[role="img"]') === null), true);
    assert.equal(await events.first().evaluate(node => {
      const ring = node.querySelector('.marker-ring');
      return node.matches(':focus-visible') && ring !== null && getComputedStyle(ring).stroke !== 'none';
    }), true);
    const detail = page.getByRole('region', { name: 'Timeline event detail' });
    for (const [index, key] of [[0, 'Enter'], [1, 'Space']] as const) {
      if (index === 1) await page.keyboard.press('Tab');
      const event = events.nth(index);
      const text = await event.locator('title').textContent();
      await page.keyboard.press(key);
      await page.locator('.timeline-marker[aria-pressed="true"]').waitFor();
      assert.equal(await event.getAttribute('aria-pressed'), 'true');
      await focused(event);
      assert.ok((await detail.innerText()).includes(text ?? 'missing event text'));
      assert.equal(await page.locator('.timeline-marker[aria-pressed="true"]').count(), 1);
      assert.equal(await event.evaluate(node => node.parentElement?.classList.contains('selected')), true);
      assert.match(page.url(), /#\/timeline$/);
    }
    await events.first().click();
    assert.equal(await events.first().getAttribute('aria-pressed'), 'true');
    assert.ok((await detail.innerText()).includes(await events.first().locator('title').textContent() ?? 'missing'));
  } finally { await page.context().close(); }
});

async function backgroundInert(page: Page, expected: boolean): Promise<void> {
  assert.deepEqual(await page.locator('.sidebar, .main').evaluateAll(nodes => nodes.map(node => node.hasAttribute('inert'))), [expected, expected]);
}

test('palette cycles Tab in both directions, inerts the background and restores focus after Escape or a pick', async () => {
  const page = await rig.open('/requests');
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    const opener = page.getByRole('button', { name: /^Palette/ });
    await opener.focus();
    await page.keyboard.press('Enter');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const input = palette.getByRole('combobox');
    await input.waitFor();
    await focused(input);
    await backgroundInert(page, true);
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      await focused(input);
    }
    await opener.evaluate(node => { (node as HTMLElement).focus(); });
    await focused(input);
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });
    await focused(opener);
    await backgroundInert(page, false);
    await page.keyboard.press('Enter');
    await input.fill('>sett');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/#/settings');
    await palette.waitFor({ state: 'detached' });
    await focused(opener);
    await backgroundInert(page, false);
  } finally { await page.context().close(); }
});

async function paletteSelectionVisible(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const active = document.querySelector('#palette-list [aria-selected="true"]')?.getBoundingClientRect();
    const viewport = document.getElementById('palette-list')?.getBoundingClientRect();
    return active && viewport && active.top >= viewport.top - 1 && active.bottom <= viewport.bottom + 1;
  }, undefined, { timeout: 2000 });
}

test('long palette keeps the keyboard-active option visible and its combobox descendant correct', async () => {
  const page = await rig.open('/requests', { width: 1440, height: 480 });
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.getByRole('button', { name: /^Palette/ }).click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const input = palette.getByRole('combobox');
    const list = palette.getByRole('listbox');
    const options = list.getByRole('option');
    await options.last().waitFor();
    const count = await options.count();
    assert.ok(count > 10, 'the palette has enough options to overflow');
    assert.equal(await list.evaluate(node => node.scrollHeight > node.clientHeight), true);
    assert.equal(await options.last().evaluate(node => {
      const viewport = document.getElementById('palette-list')?.getBoundingClientRect();
      return viewport !== undefined && node.getBoundingClientRect().top >= viewport.bottom;
    }), true, 'the last option starts below the visible rows');
    for (const [key, index] of [['ArrowDown', count - 1], ['ArrowUp', 0]] as const) {
      for (let step = 1; step < count; step++) await page.keyboard.press(key);
      await options.nth(index).and(list.locator('[aria-selected="true"]')).waitFor();
      assert.equal(await options.nth(index).getAttribute('aria-selected'), 'true');
      assert.equal(await input.getAttribute('aria-activedescendant'), await options.nth(index).getAttribute('id'));
      await paletteSelectionVisible(page);
      await focused(input);
    }
  } finally { await page.context().close(); }
});

test('palette keyboard navigation ignores a stationary pointer until it moves', async () => {
  const page = await rig.open('/requests', { width: 1440, height: 480 });
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.getByRole('button', { name: /^Palette/ }).click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const input = palette.getByRole('combobox');
    const options = palette.getByRole('option');
    await options.nth(2).hover();
    await options.nth(2).and(palette.locator('[aria-selected="true"]')).waitFor();
    const count = await options.count();
    for (let index = 3; index < count; index++) {
      await page.keyboard.press('ArrowDown');
      // Let scrolling and its generated pointer events settle without moving the mouse.
      await page.evaluate(() => new Promise<void>(done => {
        requestAnimationFrame(() => { requestAnimationFrame(() => { done(); }); });
      }));
      assert.equal(await options.nth(index).getAttribute('aria-selected'), 'true', `option ${index} keeps keyboard selection`);
      assert.equal(await input.getAttribute('aria-activedescendant'), await options.nth(index).getAttribute('id'));
      await paletteSelectionVisible(page);
    }
    const hovered = options.nth(count - 2);
    await hovered.hover();
    await hovered.and(palette.locator('[aria-selected="true"]')).waitFor();
    assert.equal(await input.getAttribute('aria-activedescendant'), await hovered.getAttribute('id'));
    await focused(input);
  } finally { await page.context().close(); }
});

test('help contains focus and restores its opener after Escape and its Close button', async () => {
  const page = await rig.open('/requests');
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    const opener = page.getByRole('button', { name: /^Help/ });
    await opener.focus();
    for (const key of ['Escape', 'Enter']) {
      await page.keyboard.press('Enter');
      const help = page.getByRole('dialog', { name: 'Keyboard help' });
      const close = help.getByRole('button', { name: /^Close/ });
      await close.waitFor();
      await focused(close);
      await backgroundInert(page, true);
      for (const tab of ['Tab', 'Shift+Tab']) { await page.keyboard.press(tab); await focused(close); }
      await page.keyboard.press(key);
      await help.waitFor({ state: 'detached' });
      await focused(opener);
      await backgroundInert(page, false);
    }
  } finally { await page.context().close(); }
});

test('mouse palette picks and Help backdrop dismissal restore focus without blocking palette input selection', async () => {
  const page = await rig.open('/requests');
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    const paletteOpener = page.getByRole('button', { name: /^Palette/ });
    await paletteOpener.click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const input = palette.getByRole('combobox');
    await input.fill('>sett');
    await palette.locator('.pal-heading').first().click();
    await input.click({ clickCount: 3, position: { x: 30, y: 20 } });
    await focused(input);
    assert.equal(await input.evaluate(node => { const field = node as HTMLInputElement; return field.selectionStart !== field.selectionEnd; }), true, 'mouse text selection in the input is preserved');
    await palette.getByRole('option').first().click();
    await page.waitForURL('**/#/settings');
    await palette.waitFor({ state: 'detached' });
    await focused(paletteOpener);
    await backgroundInert(page, false);

    const helpOpener = page.getByRole('button', { name: /^Help/ });
    await helpOpener.click();
    const help = page.getByRole('dialog', { name: 'Keyboard help' });
    await help.waitFor();
    await page.locator('.overlay').click({ position: { x: 10, y: 10 } });
    await help.waitFor({ state: 'detached' });
    await focused(helpOpener);
    await backgroundInert(page, false);
  } finally { await page.context().close(); }
});

test('request selection is labelled, tabbable, visibly focused and activated by Enter and Space without navigating', async () => {
  const page = await rig.open('/requests');
  try {
    const cards = page.locator('.request-card');
    await cards.nth(1).waitFor();
    const card = cards.nth(1);
    const select = card.getByRole('button', { name: /^Show details for / });
    const text = await select.innerText();
    await card.getByRole('link').focus();
    await page.keyboard.press('Tab');
    await focused(select);
    assert.equal(await select.getAttribute('aria-label'), `Show details for ${text}`);
    assert.equal(await select.evaluate(node => node.matches(':focus-visible') && getComputedStyle(node).boxShadow !== 'none'), true);
    await page.keyboard.press('Enter');
    await card.locator('button[aria-pressed="true"]').waitFor();
    assert.equal(await card.getAttribute('aria-current'), 'true');
    assert.ok((await page.locator('.request-detail').innerText()).includes(text));
    assert.match(page.url(), /#\/requests$/);
    // The rest of the card remains mouse-selectable, independently of the button and session link.
    await cards.first().locator('[data-origin]').click();
    await cards.first().locator('button[aria-pressed="true"]').waitFor();
    await select.focus();
    await page.keyboard.press('Space');
    await card.locator('button[aria-pressed="true"]').waitFor();
    assert.equal(await cards.locator('button[aria-pressed="true"]').count(), 1);
    assert.match(page.url(), /#\/requests$/);
    await card.getByRole('link').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/#/session/*');
  } finally { await page.context().close(); }
});
