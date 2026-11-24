// Page preparation shared by the stills, the animations and the live flows: a fresh context with the theme, UTC and the fixed wall clock.
import type { Page } from 'playwright-core';
import type { Rig } from '../../packages/web/e2e/harness.ts';
import { fixedNow } from './scenes.ts';

export type Theme = 'midnight' | 'dawn';
export const size = { width: 1280, height: 800 };

/** A new page in its own context; nothing is navigated, so a scene decides whether and how to authenticate. */
export async function preparePage(rig: Rig, options: { theme: Theme; scale: number; clock?: 'fixed' | 'running' }): Promise<Page> {
  const context = await rig.browser.newContext({ viewport: size, deviceScaleFactor: options.scale, reducedMotion: 'reduce', timezoneId: 'UTC', colorScheme: options.theme === 'dawn' ? 'light' : 'dark' });
  await context.addInitScript(prefs => { localStorage.setItem('pi-console.prefs', prefs); }, JSON.stringify({ theme: options.theme, reducedMotion: true, sidebarCollapsed: false }));
  const page = await context.newPage();
  // Fixed: Date.now never moves. Running: it starts at the capture time and ticks, which the store's 2 s derived-refresh interval needs
  // before an event can raise the Needs you count; the shots show nothing that changes within a few seconds.
  if (options.clock === 'running') { await page.clock.install({ time: new Date(fixedNow) }); await page.clock.resume(); }
  else await page.clock.setFixedTime(new Date(fixedNow));
  return page;
}

/** Open the console with the launch token and wait for the live stream. */
export async function connectLive(rig: Rig, page: Page, route: string): Promise<void> {
  await page.goto(`${rig.baseUrl}/#${route}?token=${rig.daemon.token}`);
  await page.locator('.conn[data-connection="live"]').waitFor();
}

export const settle = async (page: Page): Promise<void> => {
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
};
export const png = (page: Page): Promise<Buffer> => page.screenshot({ animations: 'disabled' });
