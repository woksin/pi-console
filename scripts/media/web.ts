// Web captures: the real built bundle against the mock daemon with a frozen stream, so every run draws the same pixels.
import type { Page } from 'playwright-core';
import { startRig, type Rig } from '../../packages/web/e2e/harness.ts';
import { memoryItems } from '../../packages/testkit/src/mock-daemon/memory.ts';
import { fixedNow, shots, webViews } from './scenes.ts';
import { recordQuestionHistory, withStaleQuestion } from './questions.ts';
import { FrameSet, wanted, writeStill, type Work } from './capture.ts';

type Theme = 'midnight' | 'dawn';
const size = { width: 1280, height: 800 };
const health = {
  status: 'ok', eventLog: { lastSeq: 45210, dbBytes: 138412032 }, projection: { position: 45210, queueDepth: 0, skipped: 0 },
  stream: { seq: 45210, clients: 2, retained: 512 }, backfill: { complete: true, windowDays: 7 }, memory: { rssBytes: 112197632, heapUsedBytes: 50331648 },
};

/** A frozen-stream rig: speed ≈ 0 publishes only the t=0 events. */
export async function startFrozenRig(): Promise<Rig> {
  // Co-locate the checked-in memory and transcript fixtures in the session used by the gallery.
  for (const item of memoryItems()) if (item.sessionId === 's1') {
    item.sessionId = 's2';
    item.scope = { kind: 'session', key: 's2' };
  }
  const rig = await startRig({ speed: 1e-9 });
  const question = rig.daemon.store.fixture.questions[0];
  question.text += '\n\nKeep the cache bounded while preserving enough history to inspect a completed checkpoint. The selected window must apply consistently to the worker queue and its retry budget.\n\nWhich option should the synthetic coordinator use before the next migration checkpoint?';
  question.options = question.options.map(option => `${option} — retain completed checkpoint metadata for this window, then expire the synthetic cache entries without changing pending decisions or the worker retry budget.`);
  recordQuestionHistory(rig.daemon.store.fixture.questions);
  return rig;
}

async function openConsole(rig: Rig, options: { theme: Theme; scale: number; route: string; before?: (page: Page) => Promise<void> }): Promise<Page> {
  const context = await rig.browser.newContext({ viewport: size, deviceScaleFactor: options.scale, reducedMotion: 'reduce', timezoneId: 'UTC', colorScheme: options.theme === 'dawn' ? 'light' : 'dark' });
  await context.addInitScript(prefs => { localStorage.setItem('pi-console.prefs', prefs); }, JSON.stringify({ theme: options.theme, reducedMotion: true, sidebarCollapsed: false }));
  const page = await context.newPage();
  await page.route('**/api/v1/health', route => route.fulfill({ json: health }));
  // Synthetic provider capability: the controls request a native pi review, never mutate memory here.
  await page.route('**/api/v1/sessions/s2/memory-actions', route => route.fulfill({ json: {
    version: 1, available: true, providerVersion: 1, generation: 'gallery-s2', reason: 'available',
  } }));
  await page.clock.setFixedTime(new Date(fixedNow));
  await options.before?.(page);
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
  // Session readers now open at the tail; the fixture reset is in older history.
  await go(page, '/session/s2?entry=entry101');
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

/** Its own page: the idle question's old creation date would stretch the Timeline axis, so it only exists while this shot is taken. */
const questionsStill = (rig: Rig, theme: Theme): Promise<Buffer> => withStaleQuestion(rig, async () => {
  const page = await openConsole(rig, { theme, scale: 2, route: '/questions' });
  await page.locator('.question-history summary').first().click();
  const still = await png(page);
  await page.context().close();
  return still;
});

async function captureWebViews(rig: Rig, page: Page, work: Work, suffix: string): Promise<void> {
  for (const view of webViews) {
    const id = `web-${view.id}${suffix}`;
    if (!wanted(work, id)) continue;
    if (view.id === 'questions') { writeStill(work, id, await questionsStill(rig, suffix === '-light' ? 'dawn' : 'midnight')); continue; }
    await go(page, view.route);
    if (view.id === 'session') {
      await showTranscriptTail(page);
      await page.locator('.memory-panel').scrollIntoViewIfNeeded();
      await page.evaluate(() => { window.scrollTo(0, 0); });
    }
    if (view.id === 'transcript-history') await showOlderTranscript(page);
    if (view.id === 'graph') await page.locator('[aria-label="Lane communication"] .edge.message').first().waitFor({ state: 'attached' });
    writeStill(work, id, await png(page));
  }
}

async function showOlderTranscript(page: Page): Promise<void> {
  await showTranscriptTail(page);
  await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await page.getByRole('button', { name: 'Return to live', exact: true }).waitFor();
  await settle(page);
}

async function boundedTimeline(page: Page, rig: Rig): Promise<void> {
  const snapshot = rig.daemon.store.snapshot();
  snapshot.messages = snapshot.messages.slice(-10);
  snapshot.bounded.push('messages');
  // Keep the SSE response open, as in the history e2e fixture, without reconnect races.
  await page.addInitScript(payload => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/v1/stream')) return nativeFetch(input, init);
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ seq: 1, type: 'snapshot', occurredAt: '2026-11-20T12:00:00Z', payload })}\n\n`));
      } });
      return Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    };
  }, snapshot);
}

async function historyStills(rig: Rig, work: Work, theme: Theme): Promise<void> {
  const suffix = theme === 'dawn' ? '-light' : '';
  const scenes = [
    { id: 'timeline-history', route: '/timeline', before: (page: Page) => boundedTimeline(page, rig) },
    { id: 'attention-retry', route: '/overview', before: async (page: Page) => {
      await page.route('**/api/v1/needs-you', route => route.fulfill({ status: 503, json: { error: 'Synthetic outage' } }));
    } },
  ];
  for (const scene of scenes) {
    const id = `web-${scene.id}${suffix}`;
    if (!wanted(work, id)) continue;
    const page = await openConsole(rig, { theme, scale: 2, route: scene.route, before: scene.before });
    if (scene.id === 'timeline-history') {
      await page.getByText('Showing 10 of 40 messages', { exact: true }).waitFor();
      await page.getByRole('region', { name: 'Timeline history', exact: true }).scrollIntoViewIfNeeded();
    } else await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    writeStill(work, id, await png(page));
    await page.context().close();
  }
}

async function stillsFor(rig: Rig, work: Work, theme: Theme): Promise<void> {
  const suffix = theme === 'dawn' ? '-light' : '';
  const page = await openConsole(rig, { theme, scale: 2, route: '/overview' });
  await captureWebViews(rig, page, work, suffix);
  await go(page, '/overview');
  if (theme === 'midnight' && wanted(work, 'web-pulse')) writeStill(work, 'web-pulse', await page.screenshot({ clip: { x: 224, y: 0, width: 1056, height: 216 } }));
  if (theme === 'midnight') await darkOnlyStills(page, work);
  await go(page, '/session/s2');
  await showResetDivider(page);
  if (wanted(work, `web-session-resets${suffix}`)) writeStill(work, `web-session-resets${suffix}`, await png(page));
  await page.context().close();
  await historyStills(rig, work, theme);
}

async function darkOnlyStills(page: Page, work: Work): Promise<void> {
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
