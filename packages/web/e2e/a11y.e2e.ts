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
