// Page preparation shared by the stills, the animations and the live flows: a fresh context with the theme, UTC and the fixed wall clock.
import type { Page } from 'playwright-core';
import type { Rig } from '../../packages/web/e2e/harness.ts';
import { fixedNow } from './scenes.ts';

export type Theme = 'midnight' | 'dawn';
export const size = { width: 1280, height: 800 };

/** A new page in its own context; nothing is navigated, so a scene decides whether and how to authenticate. */
export async function preparePage(rig: Rig, options: { theme: Theme; scale: number; clock?: 'fixed' | 'controlled' }): Promise<Page> {
  const context = await rig.browser.newContext({ viewport: size, deviceScaleFactor: options.scale, reducedMotion: 'reduce', timezoneId: 'UTC', colorScheme: options.theme === 'dawn' ? 'light' : 'dark' });
  await context.addInitScript(prefs => { localStorage.setItem('pi-console.prefs', prefs); }, JSON.stringify({ theme: options.theme, reducedMotion: true, sidebarCollapsed: false }));
  const page = await context.newPage();
  // Fixed: Date.now never moves. Controlled: the clock is installed at the capture time and stays paused; a flow moves it only
  // through `advanceUntil`, in whole 100 ms (`stepMs`) steps, so no wall-clock delay ever reaches a rendered age.
  if (options.clock === 'controlled') {
    await page.clock.install({ time: Date.parse(fixedNow) - 1000 });
    await page.clock.pauseAt(new Date(fixedNow));
    controlled.add(page);
  }
  else await page.clock.setFixedTime(new Date(fixedNow));
  return page;
}

/** Open the console with the launch token and wait for the live stream. */
export async function connectLive(rig: Rig, page: Page, route: string): Promise<void> {
  await page.goto(`${rig.baseUrl}/#${route}?token=${rig.daemon.token}`);
  await page.locator('.conn[data-connection="live"]').waitFor();
}

const controlled = new WeakSet<Page>();

/** Virtual time per step and the most a flow may advance while waiting for one change: the only clock movement a controlled flow has. */
export const stepMs = 100;
export const maxAdvanceMs = 6000;

/** Fonts are ready and two frames have been laid out; a controlled page's frames are driven by the fake clock, not by the display. */
export const settle = async (page: Page): Promise<void> => {
  await page.waitForTimeout(600);
  if (controlled.has(page)) { await page.evaluate(() => document.fonts.ready.then(() => undefined)); await page.clock.runFor(32); return; }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
};

/** Run the fake clock forward in 100 ms (`stepMs`) steps (firing the store's refresh timer and the 1 s tick) until `condition(argument)` holds in the page (the function is serialised, so it may use only its argument); the real pause between steps only lets network replies land. Returns the virtual ms advanced. */
export async function advanceUntil<T>(page: Page, condition: (argument: T) => boolean, argument: T): Promise<number> {
  for (let elapsed = 0; elapsed <= maxAdvanceMs; elapsed += stepMs) {
    if (await page.evaluate(condition as (value: unknown) => boolean, argument)) return elapsed;
    await page.clock.runFor(stepMs);
    await page.waitForTimeout(40);
  }
  throw new Error(`The page did not reach the expected state within ${maxAdvanceMs} ms of virtual time`);
}
export const png = (page: Page): Promise<Buffer> => page.screenshot({ animations: 'disabled' });
