import './transcript-history.e2e.ts';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Page, Response } from 'playwright-core';
import { startRig, type Rig } from './harness.ts';

let rig: Rig;
// A near-frozen timeline: the only transcript changes are the ones a spec publishes.
before(async () => { rig = await startRig({ speed: 0.001 }); });
after(async () => { await rig.close(); });

let cursor = 900_000;
const publish = (kind: string, text: string, requestId: string | null = null): void => {
  cursor++;
  rig.daemon.store.publish('transcript.appended', {
    id: `t${String(cursor)}`, cursor, sessionId: 's2', at: new Date().toISOString(), kind, text, toolCallId: null, resetId: null, requestId, toolResult: null,
  });
};

/** The first line at or below the pane's top edge and its offset from it. */
const probe = (page: Page): Promise<[string, number] | null> => page.evaluate(() => {
  const pane = document.querySelector('.transcript');
  const edge = pane?.getBoundingClientRect().top ?? 0;
  const found = [...(pane?.querySelectorAll('[id^="line-"]') ?? [])].find(node => node.getBoundingClientRect().bottom > edge + 1);
  return found ? [found.id, Math.round(found.getBoundingClientRect().top - edge)] : null;
});

/** How far the tail is below the visible bottom of the pane. */
const behindTail = (page: Page): Promise<number> => page.evaluate(() => {
  const pane = document.querySelector('.transcript');
  return pane ? Math.round(pane.scrollHeight - pane.clientHeight - pane.scrollTop) : -1;
});

const openSession = async (viewport: { width?: number; height?: number } = {}): Promise<Page> => {
  let historyLoaded: Promise<Response> | undefined;
  const page = await rig.open('/session/s2', {
    ...viewport,
    beforeNavigate: page => {
      historyLoaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/sessions/s2/transcript' && response.ok());
    },
  });
  await historyLoaded;
  await page.getByRole('button', { name: /Following/ }).waitFor();
  await page.locator('.tline').nth(30).waitFor();
  return page;
};

/** History responses can finish before React's tail scroll; sample a stable bottom across two frames. */
/** How far the selected line sits inside the pane's nearer edge (negative when that edge cuts it), and its height. */
const selectedInset = (page: Page): Promise<{ inset: number; height: number } | null> => page.evaluate(() => {
  const pane = document.querySelector('.transcript')?.getBoundingClientRect();
  const line = document.querySelector('.tline.selected')?.getBoundingClientRect();
  return pane && line ? { inset: Math.min(line.top - pane.top, pane.bottom - line.bottom), height: line.height } : null;
});

/** Where the selected line sits in the pane: fully inside, partly cut by an edge, or out of view. */
const selectedPlacement = async (page: Page): Promise<'full' | 'partial' | 'hidden'> => {
  const found = await selectedInset(page);
  if (!found) return 'hidden';
  if (found.inset >= 0) return 'full';
  return found.inset > -found.height ? 'partial' : 'hidden';
};

const waitForSettledTail = async (page: Page): Promise<void> => {
  await page.waitForFunction(async () => {
    const pane = document.querySelector('.transcript');
    if (!pane) return false;
    const top = pane.scrollTop;
    const height = pane.scrollHeight;
    await new Promise<void>(done => { requestAnimationFrame(() => { requestAnimationFrame(() => { done(); }); }); });
    return pane.scrollTop === top && pane.scrollHeight === height && Math.abs(pane.scrollHeight - pane.clientHeight - pane.scrollTop) <= 1;
  });
};

describe('transcript scrolling', () => {
  test('following stays on the tail while one collapsed streaming run keeps growing', async () => {
    const page = await openSession();
    const block = Array.from({ length: 40 }, (_, index) => `streamed row ${String(index)}`).join('\n');
    for (let delta = 0; delta < 4; delta++) {
      publish('assistant.delta', `${block}\n`, 'req-stream');
      await page.waitForFunction(count => ([...document.querySelectorAll('.transcript .ttext')].at(-1)?.textContent.split('\n').length ?? 0) >= (count + 1) * 40, delta);
      await page.waitForTimeout(250);
      assert.ok(await behindTail(page) <= 12, `delta ${String(delta)}: the viewport is on the tail`);
    }
    await page.context().close();
  });

  test('pause, resume following, then pause again keeps the second reading position', async () => {
    const page = await openSession();
    await page.locator('.transcript').hover();
    await page.mouse.wheel(0, -600);
    await page.getByRole('button', { name: /Follow tail/ }).waitFor();
    await page.getByRole('button', { name: /Follow tail/ }).click();
    await page.getByRole('button', { name: /Following/ }).waitFor();
    await page.waitForTimeout(300);
    const scrollTop = (): Promise<number> => page.evaluate(() => document.querySelector('.transcript')?.scrollTop ?? -1);
    const tailTop = await scrollTop();
    await page.locator('.transcript').hover();
    await page.mouse.wheel(0, -1500);
    await page.getByRole('button', { name: /Follow tail/ }).waitFor();
    await page.waitForTimeout(300);
    assert.ok(Math.abs(await scrollTop() - (tailTop - 1500)) < 150, 'the viewport stays where the second scroll left it, not at the first pause position');
    const second = await probe(page);
    publish('assistant', 'a later line');
    await page.waitForTimeout(800);
    assert.deepEqual(await probe(page), second, 'the second pause is not pulled back to the first one');
    await page.context().close();
  });

  test('PageUp and Home move the selection and scroll it into view', async () => {
    const page = await openSession();
    const selectedInView = async (): Promise<boolean> => await selectedPlacement(page) !== 'hidden';
    const scrollTop = (): Promise<number> => page.evaluate(() => document.querySelector('.transcript')?.scrollTop ?? -1);
    await waitForSettledTail(page);
    const atTail = await scrollTop();
    const tailSelection = await page.locator('.tline.selected').getAttribute('id');
    const firstLine = await page.locator('.transcript [id^="line-"]').first().getAttribute('id');
    await page.keyboard.press('PageUp');
    await page.getByRole('button', { name: /Follow tail/ }).waitFor();
    assert.notEqual(await page.locator('.tline.selected').getAttribute('id'), tailSelection, 'PageUp moves the selection');
    assert.ok(await selectedInView(), 'the selected line is visible after PageUp');
    assert.ok(await scrollTop() <= atTail, 'the pane did not scroll down');
    assert.equal(await selectedPlacement(page), 'full', 'no heading covers the selected line: it is fully inside the pane');
    await page.keyboard.press('Home');
    await page.waitForFunction(id => document.querySelector('.tline.selected')?.id === id, firstLine);
    assert.equal(await page.locator('.tline.selected').getAttribute('id'), firstLine, 'Home selects the first line');
    assert.ok(await selectedInView(), 'the selected line is visible after Home');
    assert.ok(await scrollTop() < 80, 'Home reaches the top');
    await page.context().close();
  });
});

describe('transcript times', () => {
  test('a line time carries its source ISO and the absolute time with its zone, under a day heading', async () => {
    const page = await openSession();
    const meta = await page.locator('.tline time').last().evaluate(node => ({ at: node.getAttribute('datetime'), title: node.getAttribute('title') }));
    assert.match(meta.at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(meta.title ?? '', /^\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} UTC$/);
    assert.ok(await page.locator('.tday-head').count() >= 1, 'the first displayed day has a heading');
    await page.context().close();
  });

  test('a non-UTC browser shows local times with an offset and zone in the title', async () => {
    const page = await rig.open('/session/s2', { timezoneId: 'Pacific/Auckland' });
    await page.locator('.tline time').first().waitFor();
    assert.match(await page.locator('.tline time').first().getAttribute('title') ?? '', /UTC\+1[23]:00 \(Pacific\/Auckland\)$/);
    await page.context().close();
  });
});

describe('transcript chrome polish', () => {
  test('while following, the last line is fully visible and no day heading covers a line; the current day is in the controls', async () => {
    const page = await openSession();
    await page.getByRole('button', { name: /Following/ }).waitFor();
    await waitForSettledTail(page);
    // The last line ends inside the pane: nothing at the bottom is cut off while following.
    await page.waitForFunction(() => {
      const pane = document.querySelector('.transcript');
      const last = [...document.querySelectorAll('.transcript .tline')].at(-1);
      return Boolean(pane && last && last.getBoundingClientRect().bottom <= pane.getBoundingClientRect().bottom + 0.5);
    }, undefined, { timeout: 5000 });
    const layout = await page.evaluate(() => {
      const pane = document.querySelector('.transcript');
      const head = document.querySelector('.tday-head');
      return pane && head ? {
        position: getComputedStyle(head).position, day: document.querySelector('.transcript-controls .transcript-day')?.textContent,
        topDay: [...document.querySelectorAll<HTMLElement>('.tday')].find(section => section.getBoundingClientRect().bottom > pane.getBoundingClientRect().top)?.dataset.day,
      } : null;
    });
    assert.ok(layout);
    assert.equal(layout.position, 'static', 'day headings scroll with the lines instead of overlaying them');
    assert.ok(layout.day, 'the controls name the current day');
    assert.equal(layout.day, layout.topDay, 'the label is the day at the top of the pane');
    await page.context().close();
  });

  test('in the single-column layout, following never scrolls the page and a wheel pause does not snap back', async () => {
    const page = await openSession({ width: 900, height: 900 });
    await waitForSettledTail(page);
    const contentTop = (): Promise<number> => page.evaluate(() => (document.scrollingElement?.scrollTop ?? 0) + (document.querySelector('.content')?.scrollTop ?? 0));
    await page.evaluate(() => {
      // Either the shell's .content or the document scrolls the rail into view, depending on the layout.
      for (const scroller of [document.querySelector('.content'), document.scrollingElement]) if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    const scrolled = await contentTop();
    assert.ok(scrolled > 0, 'the page scrolls down to the rail under the transcript');
    await page.waitForTimeout(2500);
    // The page may get a few pixels shorter as relative times tick, which clamps its scroll; it must still be at its bottom, not pulled up to the transcript.
    const pageBelow = await page.evaluate(() => [document.querySelector('.content'), document.scrollingElement].reduce((sum, scroller) => sum + (scroller ? Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) : 0), 0));
    assert.ok(await contentTop() > 0, 'the page is still scrolled down');
    assert.ok(pageBelow <= 1, 'a following transcript leaves the page at the rail where the user put it');
    assert.equal(await page.getByRole('button', { name: /Following/ }).count(), 1, 'still following');
    await page.locator('.transcript').hover();
    await page.mouse.wheel(0, -600);
    await page.getByRole('button', { name: /Follow tail/ }).waitFor();
    await page.waitForTimeout(300);
    const paused = await behindTail(page);
    await page.waitForTimeout(2500);
    assert.ok(paused > 100, 'the wheel moved the pane up from the tail');
    assert.equal(await behindTail(page), paused, 'the paused pane is not pulled back to the tail');
    await page.context().close();
  });

  test('a paused transcript offers one tail action', async () => {
    const page = await openSession();
    await page.locator('.transcript').hover();
    await page.mouse.wheel(0, -900);
    await page.getByRole('button', { name: /Follow tail/ }).waitFor();
    assert.equal(await page.locator('.transcript-controls').getByRole('button', { name: /Follow tail|Return to live/ }).count(), 1, 'one tail action while paused');
    await page.context().close();
  });

  test('request filter dropdowns match the search input height', async () => {
    const page = await rig.open('/requests');
    await page.locator('.request-filters select').first().waitFor();
    const heights = await page.evaluate(() => ['.request-filters select', '.request-filters .search'].map(selector => Math.round(document.querySelector(selector)?.getBoundingClientRect().height ?? 0)));
    assert.equal(heights[0], heights[1]);
    await page.context().close();
  });
});
