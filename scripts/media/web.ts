// Web captures: the real built bundle against the mock daemon with a frozen stream, so every run draws the same pixels.
import type { Page } from 'playwright-core';
import { startRig, type Rig } from '../../packages/web/e2e/harness.ts';
import { memoryItems } from '../../packages/testkit/src/mock-daemon/memory.ts';
import { fixedNow, flowIds, shots, webViews } from './scenes.ts';
import { withStaleQuestion } from './questions.ts';
import { memoryClock, prepareShowcase, rebase } from './fixture.mjs';
import { FrameSet, wanted, writeStill, type Work } from './capture.ts';
import { quiesce } from './showcase.ts';
import { connectLive, png, preparePage, settle, type Theme } from './web-page.ts';
import { captureFlows } from './web-flows.ts';

/** A frozen-stream rig: speed ≈ 0 publishes only the t=0 events. */
export async function startFrozenRig(): Promise<Rig> {
  const rig = await startRig({ speed: 1e-9 });
  await quiesce(rig.daemon.store);
  // Web ages follow snapshot/stream time, not the pinned browser wall clock alone.
  rig.daemon.store.fixture.generatedAt = fixedNow;
  const { store } = rig.daemon;
  const memory = memoryItems().map(item => ({ ...item }));
  prepareShowcase(store.fixture, memory);
  store.memory = rebase(memory, Date.parse(fixedNow) - Date.parse(memoryClock));
  store.memoryHandoffAt = fixedNow;
  return rig;
}

async function openConsole(rig: Rig, options: { theme: Theme; scale: number; route: string; before?: (page: Page) => Promise<void> }): Promise<Page> {
  const page = await preparePage(rig, options);
  // Synthetic provider capability: the controls request a native pi review, never mutate memory here.
  await page.route('**/api/v1/sessions/s2/memory-actions', route => route.fulfill({ json: {
    version: 1, available: true, providerVersion: 1, generation: 'gallery-s2', reason: 'available',
  } }));
  await options.before?.(page);
  await connectLive(rig, page, options.route);
  await settle(page);
  return page;
}

const go = async (page: Page, route: string): Promise<void> => { await page.evaluate(hash => { location.hash = hash; }, route); await settle(page); };

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

/** What a view needs on screen before its still: the tail, the memory panel, older history, the settings check or the graph edges. */
async function prepareView(page: Page, rig: Rig, id: string): Promise<void> {
  if (id === 'session') {
    await showTranscriptTail(page);
    await page.locator('.memory-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => { window.scrollTo(0, 0); });
  }
  if (id === 'transcript-history') await showOlderTranscript(page);
  if (id === 'settings') await assertSettingsSequence(page, rig);
  if (id === 'graph') await page.locator('[aria-label="Lane communication"] .edge.message').first().waitFor({ state: 'attached' });
}

async function captureWebViews(rig: Rig, page: Page, work: Work, suffix: string): Promise<void> {
  for (const view of webViews) {
    const id = `web-${view.id}${suffix}`;
    if (!wanted(work, id)) continue;
    if (view.id === 'questions') { writeStill(work, id, await questionsStill(rig, suffix === '-light' ? 'dawn' : 'midnight')); continue; }
    await go(page, view.route);
    await prepareView(page, rig, view.id);
    writeStill(work, id, await png(page));
  }
}

/** Settings shows the received stream sequence once, matching the quiescent rig. */
async function assertSettingsSequence(page: Page, rig: Rig): Promise<void> {
  const seq = String(rig.daemon.store.seq());
  const values = await page.locator('.settings dl.kv div').evaluateAll(rows => rows.map(row => [row.querySelector('dt')?.textContent ?? '', row.querySelector('dd')?.textContent ?? '']));
  const sequences = values.filter(([label]) => /(^|· )(Last sequence|Sequence)$/.test(label)).map(([, value]) => value);
  if (sequences.length !== 1 || sequences.some(value => value !== seq)) throw new Error(`Settings sequences ${JSON.stringify(sequences)} do not match the stream sequence ${seq}`);
}

async function showOlderTranscript(page: Page): Promise<void> {
  await showTranscriptTail(page);
  await page.getByRole('button', { name: 'Load older', exact: true }).click();
  // A paused transcript shows one tail action (#222): "Return to live" when newer lines are below, otherwise "Follow tail".
  await page.locator('.transcript-controls .btn.follow').filter({ hasText: /Return to live|Follow tail/ }).waitFor();
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
  const wantsStills = shots.some(shot => shot.client === 'web' && shot.kind === 'still' && !flowIds.includes(shot.id) && wanted(work, shot.id));
  if (wantsStills) { await stillsFor(rig, work, 'midnight'); await stillsFor(rig, work, 'dawn'); }
  if (wanted(work, 'web-palette')) await paletteGif(rig, work);
  if (wanted(work, 'web-tour')) await tourGif(rig, work);
  await captureFlows(work);
}
