// The four live-state web flows. Each runs on its own throwaway rig against the real mock daemon and the built bundle: a new
// visitor, a connected empty daemon, a live status and attention change over SSE, and a memory review through its receipt stages.
// A flow reports its pictures through `snap`; the e2e spec runs the same flows with a no-op `snap`, so the behaviour is tested
// without encoding anything.
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { startRig, type Rig } from '../../packages/web/e2e/harness.ts';
import { FrameSet, wanted, writeStill, type Work } from './capture.ts';
import {
  applyProducerConfirmation, emptyFixture, finishedSession, liveQuestion, liveQuestionText, memoryReceipt, memoryReviewItem,
  memoryReviewSession, memoryReviewStages, needsYouCount, prepareMemoryReview, quiesce, quietSession, showcaseHealth,
} from './showcase.ts';
import { advanceUntil, connectLive, png, preparePage, settle } from './web-page.ts';

/** One picture of the page's current state; `holdMs` is how long an animation shows it. */
export type Snap = (page: Page, holdMs: number) => Promise<void>;
const quiet: Snap = async () => undefined;

/** A frozen-stream rig that has finished its t=0 replay; closed whatever the scene does. */
async function withRig<T>(scene: (rig: Rig) => Promise<T>): Promise<T> {
  const rig = await startRig({ speed: 1e-9 });
  try {
    await quiesce(rig.daemon.store);
    return await scene(rig);
  } finally { await rig.close(); }
}

const healthFor = async (rig: Rig, page: Page): Promise<void> => {
  await page.route('**/api/v1/health', route => route.fulfill({ json: showcaseHealth(rig.daemon.store.seq(), rig.daemon.store.clients()) }));
};
const go = async (page: Page, route: string): Promise<void> => { await page.evaluate(hash => { location.hash = hash; }, route); await settle(page); };
const headline = async (page: Page): Promise<number | null> => needsYouCount(await page.locator('#needs-you').innerText());

/** A visitor with no launch link: the token screen, then a manual paste that connects without ever putting the token in the URL. */
export async function connectFlow(snap: Snap = quiet): Promise<void> {
  await withRig(async rig => {
    const page = await preparePage(rig, { theme: 'midnight', scale: 2 });
    await page.goto(`${rig.baseUrl}/#/overview`);
    const field = page.getByLabel('Access token');
    await field.waitFor();
    await page.getByRole('heading', { name: 'Connect to the daemon' }).waitFor();
    assert.equal(await field.inputValue(), '');
    await settle(page);
    await snap(page, 0);
    await field.fill(rig.daemon.token);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.locator('.conn[data-connection="live"]').waitFor();
    assert.equal(page.url().includes(rig.daemon.token), false, 'the token never appears in the address bar');
    await page.context().close();
  });
}

/** A daemon that is running but has seen nothing: the snapshot really is empty, and the checklist is the connected state. */
export async function firstRunFlow(snap: Snap = quiet): Promise<void> {
  await withRig(async rig => {
    emptyFixture(rig.daemon.store.fixture);
    const page = await preparePage(rig, { theme: 'midnight', scale: 2 });
    await healthFor(rig, page);
    await connectLive(rig, page, '/overview');
    await page.locator('.first-run').waitFor();
    await page.locator('.first-run').getByText('Daemon running', { exact: true }).waitFor();
    await page.locator('.first-run').getByText('Extension installed', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-reason]').count(), 0);
    assert.equal(await page.locator('.conn[data-connection="live"]').count(), 1);
    await settle(page);
    await snap(page, 0);
    await page.context().close();
  });
}

/** A session finishes and a new blocking question arrives, both through the daemon's own publish and the page's SSE stream. */
export async function liveFleetFlow(snap: Snap = quiet): Promise<void> {
  await withRig(async rig => {
    const { store } = rig.daemon;
    const working = quietSession(store.fixture, 'working');
    const idle = quietSession(store.fixture, 'idle');
    const page = await preparePage(rig, { theme: 'midnight', scale: 1, clock: 'controlled' });
    await healthFor(rig, page);
    await connectLive(rig, page, '/overview');
    // The first derived read is behind the store's debounce timer, which only the stepped clock fires.
    await advanceUntil(page, (selector: string) => document.querySelector(selector) !== null, '[data-reason]');
    await settle(page);
    const before = await headline(page);
    assert.ok(before !== null && before > 0);
    await snap(page, 1500);

    await go(page, '/fleet');
    // The Fleet table is virtualised: filtering to the session keeps its row mounted for the change.
    await page.getByPlaceholder('Filter sessions, lanes, branches…').fill(working.name);
    await page.locator(`[data-session="${working.id}"]`).waitFor();
    await settle(page);
    await snap(page, 1000);
    store.publish('session.updated', finishedSession(working));
    await advanceUntil(page, (id: string) => /done/i.test(document.querySelector(`[data-session="${id}"]`)?.textContent ?? ''), working.id);
    await settle(page);
    await snap(page, 1500);

    await go(page, '/overview');
    store.publish('question.asked', liveQuestion(idle.id));
    const card = page.locator('[data-reason="blocking-question"]').filter({ hasText: liveQuestionText });
    // The count rises only after the store's 2 s refresh interval: the clock is stepped to it, never left to run.
    await advanceUntil(page, (count: number) => Number(/^(\d+)/.exec(document.querySelector('#needs-you')?.textContent ?? '')?.[1]) > count, before);
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    await settle(page);
    assert.ok((await headline(page) ?? 0) > before, 'the Needs you count rose without a reload');
    await snap(page, 2000);
    await page.context().close();
  });
}

const stage = (page: Page, text: string) => page.locator(`[data-memory-item="${memoryReviewItem}"]`).getByRole('status').filter({ hasText: text });

/** A proposed item is confirmed in pi (synthetic provider), and becomes active only when the producer's own update arrives. */
export async function memoryReviewFlow(snap: Snap = quiet): Promise<void> {
  const restore = prepareMemoryReview();
  try {
    await withRig(async rig => {
      const page = await preparePage(rig, { theme: 'midnight', scale: 1 });
      await healthFor(rig, page);
      let phase: (typeof memoryReviewStages)[number] = memoryReviewStages[0];
      let posts = 0;
      let posted = { requestId: '', itemId: '', action: '' };
      const reply = () => memoryReceipt(phase, posted);
      await page.route('**/api/v1/**/memory-actions*', async route => {
        if (route.request().method() === 'POST') { posts++; posted = route.request().postDataJSON() as typeof posted; await route.fulfill({ json: reply() }); return; }
        await route.fulfill({ json: { version: 1, available: true, providerVersion: 1, generation: 'gallery-s2', reason: 'available' } });
      });
      await page.route('**/api/v1/memory-actions/*', route => route.fulfill({ json: reply() }));
      await connectLive(rig, page, `/session/${memoryReviewSession}`);
      const row = page.locator(`[data-memory-item="${memoryReviewItem}"]`);
      const confirm = row.getByRole('button', { name: 'Confirm…', exact: true });
      await confirm.waitFor();
      await row.evaluate(element => { element.scrollIntoView({ block: 'center' }); });
      await settle(page);
      assert.equal(await row.locator('[data-memory-status]').getAttribute('data-memory-status'), 'proposed');
      await snap(page, 1500);

      await confirm.click();
      await stage(page, 'Awaiting confirmation in pi').waitFor();
      assert.equal(posts, 1);
      assert.equal(await row.locator('[data-memory-status]').getAttribute('data-memory-status'), 'proposed');
      await snap(page, 2000);

      phase = 'awaiting-ingestion';
      await stage(page, 'awaiting producer ingestion').waitFor();
      assert.equal(await row.locator('[data-memory-status]').getAttribute('data-memory-status'), 'proposed');
      await snap(page, 2000);

      // The producer applies the confirmation first; the web only learns of it from the session's memoryChanged update.
      applyProducerConfirmation();
      const session = rig.daemon.store.fixture.sessions.find(candidate => candidate.id === memoryReviewSession);
      assert.ok(session);
      rig.daemon.store.publish('session.updated', { ...session, memoryChanged: true });
      await row.locator('[data-memory-status="active"]').waitFor();
      phase = 'observed-applied';
      await stage(page, 'Producer change observed').waitFor();
      assert.equal(posts, 1);
      await settle(page);
      await snap(page, 2500);
      await page.context().close();
    });
  } finally { restore(); }
}

/** Capture whichever of the four flows `--only` asks for, each into its own frames. */
export async function captureFlows(work: Work): Promise<void> {
  if (wanted(work, 'web-connect')) await connectFlow(async page => { writeStill(work, 'web-connect', await png(page)); });
  if (wanted(work, 'web-first-run')) await firstRunFlow(async page => { writeStill(work, 'web-first-run', await png(page)); });
  for (const [id, flow] of [['web-live-fleet', liveFleetFlow], ['web-memory-review', memoryReviewFlow]] as const) {
    if (!wanted(work, id)) continue;
    const frames = new FrameSet(work, id);
    await flow(async (page, holdMs) => { frames.add(await png(page), holdMs); });
    frames.finish();
  }
}
