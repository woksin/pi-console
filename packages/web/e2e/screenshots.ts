import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { startRig } from './harness.ts';

/** Captures every view against the mock daemon into docs/media/web/. Run after `npm run build`. */
const out = resolve(import.meta.dirname, '../../../docs/media/web');
mkdirSync(out, { recursive: true });
const rig = await startRig({ speed: 400 });
const shot = async (page: Page, name: string): Promise<void> => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name);
};
const live = async (page: Page): Promise<void> => { await page.locator('.conn[data-connection="live"]').waitFor(); };

try {
  const page = await rig.open('/overview', { width: 1440, height: 900 });
  await live(page);
  await page.locator('[data-reason]').first().waitFor();
  await shot(page, 'overview');
  const views: [string, string][] = [['fleet', '/fleet'], ['requests', '/requests'], ['questions', '/questions'], ['messages-list', '/messages'], ['messages-graph', '/messages?view=graph'], ['timeline', '/timeline'], ['work', '/work'], ['settings', '/settings'], ['session', '/session/s2']];
  for (const [name, route] of views) {
    await page.evaluate(hash => { window.location.hash = hash; }, route);
    await shot(page, name);
  }
  await page.evaluate(() => { window.location.hash = '#/fleet'; });
  await page.keyboard.press('Control+p');
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
  await shot(page, 'palette');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: 'Keyboard help' }).waitFor();
  await shot(page, 'help');
  await page.keyboard.press('Escape');
  await page.context().close();

  const token = await rig.open('', { token: null, width: 1440, height: 900 });
  await token.getByRole('heading', { name: 'Connect to the daemon' }).waitFor();
  await shot(token, 'token');
  await token.context().close();

  const offline = await rig.open('/fleet', { width: 1440, height: 900 });
  await live(offline);
  await offline.locator('tr[data-session]').first().waitFor();
  await rig.stopDaemon();
  await offline.getByTestId('banner').waitFor({ timeout: 30_000 });
  await shot(offline, 'offline');
  await offline.context().close();
} finally {
  await rig.close();
}
