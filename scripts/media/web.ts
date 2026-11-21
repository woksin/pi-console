// Web captures: the real built bundle against the mock daemon with a frozen stream, so every run draws the same pixels.
import type { Page } from 'playwright-core';
import { startRig, type Rig } from '../../packages/web/e2e/harness.ts';
import { fixedNow, shots } from './scenes.ts';
import { FrameSet, wanted, writeStill, type Work } from './capture.ts';

type Theme = 'midnight' | 'dawn';
const size = { width: 1280, height: 800 };
const health = {
  status: 'ok', eventLog: { lastSeq: 45210, dbBytes: 138412032 }, projection: { position: 45210, queueDepth: 0, skipped: 0 },
  stream: { seq: 45210, clients: 2, retained: 512 }, backfill: { complete: true, windowDays: 7 }, memory: { rssBytes: 112197632, heapUsedBytes: 50331648 },
};

/** A frozen-stream rig: speed ≈ 0 publishes only the t=0 events. */
export const startFrozenRig = (): Promise<Rig> => startRig({ speed: 1e-9 });

async function openConsole(rig: Rig, options: { theme: Theme; scale: number; route: string }): Promise<Page> {
  const context = await rig.browser.newContext({ viewport: size, deviceScaleFactor: options.scale, reducedMotion: 'reduce', colorScheme: options.theme === 'dawn' ? 'light' : 'dark' });
  await context.addInitScript(prefs => { localStorage.setItem('pi-console.prefs', prefs); }, JSON.stringify({ theme: options.theme, reducedMotion: true, sidebarCollapsed: false }));
  const page = await context.newPage();
  await page.route('**/api/v1/health', route => route.fulfill({ json: health }));
  await page.clock.setFixedTime(new Date(fixedNow));
  await page.goto(`${rig.baseUrl}/#${options.route}?token=${rig.daemon.token}`);
  await page.locator('.conn[data-connection="live"]').waitFor();
  await settle(page);
  return page;
}

const settle = async (page: Page): Promise<void> => {
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
};
const go = async (page: Page, route: string): Promise<void> => { await page.evaluate(hash => { location.hash = hash; }, route); await settle(page); };
const png = (page: Page): Promise<Buffer> => page.screenshot({ animations: 'disabled' });

/** Pin the tail after fonts/layout settle, rather than recording a race with React's initial scrollIntoView effect. */
async function showTranscriptTail(page: Page): Promise<void> {
  await page.locator('.transcript .tline').last().waitFor();
  await page.evaluate(() => {
    const pane = document.querySelector('.transcript');
    if (pane) pane.scrollTop = pane.scrollHeight;
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => {
    const pane = document.querySelector('.transcript');
    return pane && Math.abs(pane.scrollHeight - pane.clientHeight - pane.scrollTop) < 1 && window.scrollY === 0;
  });
}

/** Scrolls the transcript so the first ⟲ reset divider sits in the middle of the pane, then lets the layout settle. */
async function showResetDivider(page: Page): Promise<void> {
  await page.locator('.reset-marker').first().waitFor();
  await page.locator('.reset-marker').first().evaluate(marker => {
    let pane = marker.parentElement;
    while (pane && pane.scrollHeight <= pane.clientHeight) pane = pane.parentElement;
    if (!pane) return;
    pane.scrollTop += marker.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 3;
  });
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await settle(page);
}

async function stillsFor(rig: Rig, work: Work, theme: Theme): Promise<void> {
  const suffix = theme === 'dawn' ? '-light' : '';
  const page = await openConsole(rig, { theme, scale: 2, route: '/overview' });
  if (wanted(work, `web-overview${suffix}`)) writeStill(work, `web-overview${suffix}`, await png(page));
  if (theme === 'midnight' && wanted(work, 'web-pulse')) writeStill(work, 'web-pulse', await page.screenshot({ clip: { x: 224, y: 0, width: 1056, height: 216 } }));
  if (theme === 'midnight') await darkOnlyStills(page, work);
  await go(page, '/session/s2');
  await showResetDivider(page);
  if (wanted(work, `web-session-resets${suffix}`)) writeStill(work, `web-session-resets${suffix}`, await png(page));
  await page.context().close();
}

async function darkOnlyStills(page: Page, work: Work): Promise<void> {
  const routes: [string, string][] = [['web-fleet', '/fleet'], ['web-graph', '/messages?view=graph'], ['web-timeline', '/timeline']];
  for (const [id, route] of routes) {
    if (!wanted(work, id)) continue;
    await go(page, route);
    writeStill(work, id, await png(page));
  }
  if (!wanted(work, 'web-themes')) return;
  await go(page, '/settings');
  await page.locator('.theme-cards').evaluate(cards => { cards.style.gridTemplateColumns = 'repeat(3, 1fr)'; });
  writeStill(work, 'web-themes', await page.locator('.theme-cards').screenshot({ animations: 'disabled' }));
}

async function paletteGif(rig: Rig, work: Work): Promise<void> {
  const page = await openConsole(rig, { theme: 'midnight', scale: 1, route: '/overview' });
  const frames = new FrameSet(work, 'web-palette');
  frames.add(await png(page), 900);
  await page.keyboard.press('Control+p');
  await page.waitForTimeout(300);
  frames.add(await png(page), 900);
  for (const letter of 'aur') {
    await page.keyboard.type(letter);
    await page.waitForTimeout(200);
    frames.add(await png(page), 450);
  }
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  frames.add(await png(page), 1400);
  await page.keyboard.press('Enter');
  await settle(page);
  await showTranscriptTail(page);
  frames.add(await png(page), 1800);
  frames.finish();
  await page.context().close();
}

async function tourGif(rig: Rig, work: Work): Promise<void> {
  const page = await openConsole(rig, { theme: 'midnight', scale: 1, route: '/overview' });
  const frames = new FrameSet(work, 'web-tour');
  frames.add(await png(page), 1500);
  await page.keyboard.press('2');
  await settle(page);
  frames.add(await png(page), 1500);
  await go(page, '/session/s2');
  await showTranscriptTail(page);
  frames.add(await png(page), 1000);
  await showResetDivider(page);
  frames.add(await png(page), 2000);
  await page.keyboard.press('6');
  await settle(page);
  frames.add(await png(page), 1500);
  frames.finish();
  await page.context().close();
}

export async function captureWeb(rig: Rig, work: Work): Promise<void> {
  const wantsStills = shots.some(shot => shot.client === 'web' && shot.kind === 'still' && wanted(work, shot.id));
  if (wantsStills) { await stillsFor(rig, work, 'midnight'); await stillsFor(rig, work, 'dawn'); }
  if (wanted(work, 'web-palette')) await paletteGif(rig, work);
  if (wanted(work, 'web-tour')) await tourGif(rig, work);
}
