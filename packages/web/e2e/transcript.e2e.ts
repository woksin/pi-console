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

const openSession = async (): Promise<Page> => {
  let historyLoaded: Promise<Response> | undefined;
  const page = await rig.open('/session/s2', {
    beforeNavigate: page => {
      historyLoaded = page.waitForResponse(async response => {
        if (new URL(response.url()).pathname !== '/api/v1/sessions/s2/transcript' || !response.ok()) return false;
        const history = await response.json() as { hasMore: boolean };
        return !history.hasMore;
      });
    },
  });
  await historyLoaded;
  await page.getByRole('button', { name: /Following/ }).waitFor();
  await page.locator('.tline').nth(30).waitFor();
  return page;
};

/** History responses can finish before React's tail scroll; sample a stable bottom across two frames. */
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
      await page.waitForFunction(count => (document.querySelector('.transcript')?.children.item((document.querySelector('.transcript')?.children.length ?? 2) - 2)?.querySelector('.ttext')?.textContent.split('\n').length ?? 0) >= (count + 1) * 40, delta);
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
    const selectedInView = (): Promise<boolean> => page.evaluate(() => {
      const pane = document.querySelector('.transcript')?.getBoundingClientRect();
      const line = document.querySelector('.tline.selected')?.getBoundingClientRect();
      return Boolean(pane && line && line.bottom > pane.top && line.top < pane.bottom);
    });
    const scrollTop = (): Promise<number> => page.evaluate(() => document.querySelector('.transcript')?.scrollTop ?? -1);
    await waitForSettledTail(page);
    const atTail = await scrollTop();
    const tailSelection = await page.locator('.tline.selected').getAttribute('id');
    const firstLine = await page.locator('.transcript [id^="line-"]').first().getAttribute('id');
    await page.keyboard.press('PageUp');
    await page.getByRole('button', { name: /Follow tail/ }).waitFor();
    assert.notEqual(await page.locator('.tline.selected').getAttribute('id'), tailSelection, 'PageUp moves the selection');
    assert.ok(await selectedInView(), 'the selected line is visible after PageUp');
    assert.ok(await scrollTop() < atTail, 'the pane scrolled up');
    await page.keyboard.press('Home');
    await page.waitForFunction(id => document.querySelector('.tline.selected')?.id === id, firstLine);
    assert.equal(await page.locator('.tline.selected').getAttribute('id'), firstLine, 'Home selects the first line');
    assert.ok(await selectedInView(), 'the selected line is visible after Home');
    assert.ok(await scrollTop() < 80, 'Home reaches the top');
    await page.context().close();
  });
});
