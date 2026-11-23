import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Page } from 'playwright-core';
import type { SessionDetail } from '@pi-console/contract';
import { startRig, type Rig } from './harness.ts';

let rig: Rig;
before(async () => { rig = await startRig(); });
after(async () => { await rig.close(); });

/** Console errors a user would care about: the optional /health read model is absent from the mock daemon, so its 404 is expected. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); });
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  return errors;
}

const connection = (page: Page): Promise<string | null> => page.locator('.conn').getAttribute('data-connection');

describe('web console e2e', () => {
  test('session topbar includes repository, lane, name and status', async () => {
    const page = await rig.open('/session/s2');
    await page.locator('.conn[data-connection="live"]').waitFor();
    assert.match(await page.locator('.topbar h1').innerText(), /.+ \/ L\d+ \/ .+/);
    await page.locator('.topbar .badge').waitFor();
    await page.locator('.session-head').waitFor();
    assert.equal(await page.locator('.session-head h2, .session-head .badge').count(), 0, 'identity and status appear only in the topbar');
    assert.equal(await page.locator('.rail .badge').filter({ hasText: 'Unknown' }).count(), 0);
    await page.context().close();
  });

  test('a session outside the snapshot loads, offers keyboard Retry on failure, and recovers', async () => {
    const isolated = await startRig({ speed: 1e-9 });
    const page = await isolated.open('/fleet', { token: null });
    const first = Promise.withResolvers<undefined>();
    const retried = Promise.withResolvers<undefined>();
    const recovered = Promise.withResolvers<undefined>();
    let attempts = 0;
    try {
      const response = await page.request.get(`${isolated.baseUrl}/api/v1/sessions/s2`, { headers: { Authorization: `Bearer ${isolated.daemon.token}` } });
      assert.equal(response.status(), 200);
      const detail = await response.json() as SessionDetail;
      detail.session = { ...detail.session, id: 'detail-only' };
      await page.route('**/api/v1/sessions/detail-only', async route => {
        attempts++;
        if (attempts === 1) { await first.promise; await route.abort(); }
        else if (attempts === 2) { await retried.promise; await route.fulfill({ status: 503, json: { error: 'offline' } }); }
        else { await recovered.promise; await route.fulfill({ json: detail }); }
      });
      await page.getByLabel('Access token').fill(isolated.daemon.token);
      await page.getByRole('button', { name: 'Connect' }).click();
      await page.locator('.conn[data-connection="live"]').waitFor();
      await page.evaluate(() => { window.location.hash = '#/session/detail-only'; });
      await page.getByRole('status', { name: 'Loading session', exact: true }).waitFor();
      assert.equal(await page.getByText('Session not found', { exact: true }).count(), 0);
      first.resolve(undefined);
      await page.getByRole('status').filter({ hasText: 'Could not load session.' }).waitFor();
      assert.equal(await page.getByText('Session not found', { exact: true }).count(), 0);
      const retry = page.getByRole('button', { name: 'Retry', exact: true });
      await page.locator('#content').focus();
      await page.keyboard.press('Tab');
      assert.equal(await retry.evaluate(node => node === document.activeElement), true, 'Retry is reachable by Tab');
      await page.keyboard.press('Enter');
      await page.getByRole('status', { name: 'Loading session', exact: true }).waitFor();
      assert.equal(await retry.isDisabled(), true, 'Retry is guarded while busy');
      assert.equal(await retry.evaluate(node => node === document.activeElement), true, 'Retry retains focus while loading');
      retried.resolve(undefined);
      await page.getByRole('status').filter({ hasText: 'Could not load session.' }).waitFor();
      assert.equal(await retry.evaluate(node => node === document.activeElement), true, 'Retry retains focus after another failure');
      await page.keyboard.press('Enter');
      await page.getByRole('status', { name: 'Loading session', exact: true }).waitFor();
      assert.equal(await retry.evaluate(node => node === document.activeElement), true, 'a repeated keyboard Retry retains focus');
      recovered.resolve(undefined);
      await page.locator('.session-head').waitFor();
      assert.equal(attempts, 3, 'both keyboard retries issue new detail requests');
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.equal(await page.getByRole('status', { name: 'Loading session', exact: true }).count(), 0);
    } finally { first.resolve(undefined); retried.resolve(undefined); recovered.resolve(undefined); await page.context().close(); await isolated.close(); }
  });

  for (const status of [404, 503]) test(`a session arriving over the stream replaces HTTP ${String(status)} detail feedback`, async () => {
    const isolated = await startRig({ speed: 1e-9 });
    const page = await isolated.open('/fleet', { token: null });
    try {
      const response = await page.request.get(`${isolated.baseUrl}/api/v1/sessions/s2`, { headers: { Authorization: `Bearer ${isolated.daemon.token}` } });
      assert.equal(response.status(), 200);
      const detail = await response.json() as SessionDetail;
      detail.session = { ...detail.session, id: 'streamed-session', name: 'Streamed session' };
      await page.route('**/api/v1/sessions/streamed-session', route => route.fulfill({ status, json: { error: 'unavailable' } }));
      await page.getByLabel('Access token').fill(isolated.daemon.token);
      await page.getByRole('button', { name: 'Connect' }).click();
      await page.locator('.conn[data-connection="live"]').waitFor();
      await page.evaluate(() => { window.location.hash = '#/session/streamed-session'; });
      if (status === 404) await page.getByRole('heading', { name: 'Session not found', exact: true }).waitFor();
      else await page.getByRole('status').filter({ hasText: 'Could not load session.' }).waitFor();
      isolated.daemon.store.publish('session.updated', detail.session);
      await page.locator('.session-head').waitFor();
      assert.match(await page.locator('.topbar h1').innerText(), /Streamed session/);
      assert.equal(await page.getByText('Session not found', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Could not load session.', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
    } finally { await page.context().close(); await isolated.close(); }
  });

  test('a real session 404 shows not-found without Retry', async () => {
    const page = await rig.open('/session/missing-session', { token: null });
    try {
      await page.route('**/api/v1/sessions/missing-session', route => route.fulfill({ status: 404, json: { error: 'not found' } }));
      await page.getByLabel('Access token').fill(rig.daemon.token);
      await page.getByRole('button', { name: 'Connect' }).click();
      await page.getByRole('heading', { name: 'Session not found', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Back to the fleet', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
      assert.equal(await page.getByRole('alert').count(), 0);
    } finally { await page.context().close(); }
  });

  test('initial stream hold shows skeletons, not empty states', async () => {
    const page = await rig.open('/fleet', { token: null });
    await page.route('**/api/v1/stream*', route => route.abort());
    await page.getByLabel('Access token').fill(rig.daemon.token);
    await page.getByRole('button', { name: 'Connect' }).click();
    for (const [view, label] of [['fleet', 'sessions'], ['requests', 'requests'], ['work', 'work'], ['overview', 'overview']]) {
      await page.evaluate(view => { window.location.hash = `#/${view}`; }, view);
      await page.getByRole('status', { name: `Loading ${label}` }).waitFor();
      assert.equal(await page.locator('.empty').count(), 0);
      assert.ok(!(await page.locator('#content').innerText()).includes('No pi sessions found yet'));
    }
    await page.context().close();
  });

  test('Overview waits for attention, shows a retryable failure, then clears only after success', async () => {
    const isolated = await startRig({ speed: 1e-9 });
    const page = await isolated.open('/', { token: null });
    let attempts = 0;
    const failed = Promise.withResolvers<boolean>();
    const retried = Promise.withResolvers<boolean>();
    await page.route('**/api/v1/needs-you', async route => {
      attempts++;
      if (attempts === 1) { await failed.promise; await route.fulfill({ status: 503, json: { error: 'offline' } }); }
      else { await retried.promise; await route.fulfill({ json: { items: [] } }); }
    });
    try {
      await page.getByLabel('Access token').fill(isolated.daemon.token);
      await page.getByRole('button', { name: 'Connect' }).click();
      await page.locator('.conn[data-connection="live"]').waitFor();
      await page.getByRole('status').filter({ hasText: 'Checking needs you…' }).waitFor();
      assert.equal(await page.locator('.hero.clear, .empty').count(), 0);
      assert.ok(!(await page.locator('#content').innerText()).includes('All clear'));
      failed.resolve(true);
      await page.getByRole('alert').filter({ hasText: 'Needs you unavailable' }).waitFor();
      assert.equal(await page.locator('.hero.clear, .empty').count(), 0);
      assert.equal(await page.locator('.conn[data-connection="live"]').count(), 1);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Checking needs you…' }).waitFor();
      assert.equal(attempts, 2, 'retry re-issues the same load');
      retried.resolve(true);
      await page.locator('.hero.clear').waitFor();
      await page.getByRole('heading', { name: 'All clear: nothing needs you', exact: true }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0);
    } finally { failed.resolve(true); retried.resolve(true); await page.context().close(); await isolated.close(); }
  });

  test('Settings renders nested daemon health with human labels', async () => {
    const page = await rig.open('/settings', { token: null });
    await page.route('**/api/v1/health', route => route.fulfill({ json: {
      status: 'ok', eventLog: { lastSeq: 42, dbBytes: 1048576 },
      projection: { position: 42, queueDepth: 0, skipped: 0 },
      stream: { seq: 42, clients: 1, retained: 42 },
      backfill: { complete: true, windowDays: 7 }, memory: { rssBytes: 2097152, heapUsedBytes: 1048576 },
    } }));
    await page.getByLabel('Access token').fill(rig.daemon.token);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByText('Event log · Last sequence', { exact: true }).waitFor();
    assert.ok(!(await page.locator('.settings').innerText()).includes('[object'));
    await page.getByText('2.0 MB', { exact: true }).waitFor();
    await page.context().close();
  });
  test('P1 type scale stays readable and contained at desktop and narrow desktop widths', async () => {
    for (const width of [1280, 1100]) {
      for (const view of ['overview', 'requests', 'fleet']) {
        const page = await rig.open(`/${view}`, { width, height: 800 });
        try {
          await page.locator('.conn[data-connection="live"]').waitFor();
          await page.locator('h1').first().waitFor();
          const layout = await page.evaluate(() => {
            const title = document.querySelector('h1');
            const hero = document.querySelector('.hero-title');
            return {
              body: getComputedStyle(document.body).fontSize,
              title: title ? getComputedStyle(title).fontSize : null,
              hero: hero ? getComputedStyle(hero).fontSize : null,
              overflow: document.documentElement.scrollWidth > window.innerWidth,
            };
          });
          assert.equal(layout.body, '14px');
          assert.ok(layout.title === '14px' || layout.title === '20px', 'breadcrumb or page title uses the shared scale');
          if (layout.hero) assert.equal(layout.hero, '20px');
          assert.equal(layout.overflow, false, `${view} at ${String(width)}px`);
        } finally { await page.context().close(); }
      }
    }
  });

  test('loads with the launch-link token, shows the fleet live, and scrubs the token from the URL', async () => {
    const page = await rig.open('/fleet');
    const errors = watchErrors(page);
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.locator('tr[data-session]').first().waitFor();
    assert.ok(await page.locator('tr[data-session]').count() > 10);
    assert.equal(new URL(page.url()).hash, '#/fleet', 'the token never stays in the address bar');
    assert.equal(await page.evaluate(() => localStorage.length + document.cookie.length), 0, 'the token is never persisted outside the tab');
    assert.deepEqual(errors, []);
    await page.context().close();
  });

  test('a live SSE update appears without a reload', async () => {
    const page = await rig.open('/settings');
    await page.locator('.conn[data-connection="live"]').waitFor();
    const received = async (): Promise<number> => Number((await page.locator('.settings dt', { hasText: 'Events this run' }).locator('xpath=following-sibling::dd').first().innerText()).replace(/\D/g, ''));
    const first = await received();
    await page.waitForFunction(previous => {
      const label = [...document.querySelectorAll('.settings dt')].find(node => node.textContent === 'Events this run');
      return Number(label?.nextElementSibling?.textContent.replace(/\D/g, '')) > previous;
    }, first, { timeout: 15_000 });
    await page.context().close();
  });

  test('shows the token screen for a wrong token, then recovers with the right one', async () => {
    const page = await rig.open('/fleet', { token: 'x'.repeat(64) });
    await page.getByRole('heading', { name: 'That token was not accepted' }).waitFor();
    assert.equal(await page.locator('tr[data-session]').count(), 0);
    await page.getByLabel('Access token').fill(rig.daemon.token);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.locator('tr[data-session]').first().waitFor();
    await page.context().close();
  });

  test('asks for a token when none is supplied', async () => {
    const page = await rig.open('', { token: null });
    await page.getByRole('heading', { name: 'Connect to the daemon' }).waitFor();
    await page.context().close();
  });

  test('flags a daemon restart, keeps the last data visible, and reconnects by itself', async () => {
    // The mock resets its sequence on restart; do not inherit a cursor aged by unrelated tests.
    const isolated = await startRig();
    const page = await isolated.open('/fleet');
    try {
      await page.locator('.conn[data-connection="live"]').waitFor();
      await page.locator('tr[data-session]').first().waitFor();
      await isolated.stopDaemon();
      await page.waitForFunction(() => document.querySelector('.conn')?.getAttribute('data-connection') !== 'live', undefined, { timeout: 15_000 });
      assert.ok(await page.locator('tr[data-session]').count() > 0, 'stale data stays on screen instead of blanking');
      await page.getByTestId('banner').waitFor();
      await page.locator('#content[data-stale="true"]').waitFor();
      assert.equal(await page.locator('#content').evaluate(el => getComputedStyle(el).opacity), '1');
      assert.equal(await page.locator('.app').getAttribute('data-stale'), 'true');
      assert.equal(await page.locator('.app').evaluate(el => {
        const css = getComputedStyle(el);
        return css.getPropertyValue('--cyan').trim() === css.getPropertyValue('--muted').trim();
      }), true, 'offline accents use the readable neutral palette');
      await page.locator('.stale-asof').waitFor();
      assert.match(await page.locator('.stale-asof').innerText(), /^As of \d{2}:\d{2}:\d{2}$/);
      assert.equal(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).opacity), '1');
      await isolated.startDaemon();
      await page.locator('.conn[data-connection="live"]').waitFor({ timeout: 30_000 });
      assert.equal(await connection(page), 'live');
      await page.locator('#content[data-stale="false"]').waitFor();
      assert.equal(await page.locator('.app').getAttribute('data-stale'), 'false');
      assert.equal(await page.locator('.stale-asof').count(), 0);
    } finally { await page.context().close(); await isolated.close(); }
  });

  test('title and favicon carry the needs-you count; the palette groups, highlights and ranks prefix matches first', async () => {
    const page = await rig.open('/overview');
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.waitForFunction(() => /^\(\d+\) Overview · pi console$/.test(document.title));
    assert.match(await page.locator("link[rel='icon']").getAttribute('href') ?? '', /circle/, 'the favicon shows the needs-you dot');
    await page.keyboard.press('Control+p');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('combobox').fill('aur');
    const first = palette.getByRole('option').first();
    assert.equal(await first.locator('mark').first().innerText(), 'aur');
    assert.ok((await palette.getByRole('group').count()) >= 1, 'results are grouped');
    await palette.getByRole('combobox').fill('>sett');
    assert.equal(await palette.getByRole('option').first().locator('.pal-label').innerText(), 'Open settings');
    await page.keyboard.press('Escape');
    await page.context().close();
  });

  test('keyboard map: sections, help, palette, selection, open and back', async () => {
    const page = await rig.open('/overview');
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.keyboard.press('2');
    await page.waitForFunction(() => window.location.hash === '#/fleet');
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard help' });
    await help.waitFor();
    const close = help.getByRole('button', { name: /^Close/ });
    await close.focus();
    assert.equal(await close.evaluate(node => node === document.activeElement), true, 'Help Close has keyboard focus');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.locator('tr.row').first().waitFor();
    await page.keyboard.press('j');
    const first = await page.locator('tr.row.selected').getAttribute('data-session');
    await page.keyboard.press('j');
    assert.notEqual(await page.locator('tr.row.selected').getAttribute('data-session'), first);
    await page.keyboard.press('k');
    assert.equal(await page.locator('tr.row.selected').getAttribute('data-session'), first);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.location.hash.startsWith('#/session/'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.location.hash === '#/fleet');
    await page.keyboard.press('Control+p');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.getByRole('combobox').fill('timeline');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.location.hash === '#/timeline');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('input[type=search]') === null, undefined, { timeout: 10000 });
    await page.locator('#content-heading:focus').waitFor();
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'content-heading', 'a view without a search box ignores the filter key and retains heading focus');
    await page.context().close();
  });

  test('/ focuses the Questions filter and Esc clears and releases it', async () => {
    const page = await rig.open('/questions');
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.locator('li.question').first().waitFor();
    const total = await page.locator('li.question').count();
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('type')), 'search');
    await page.keyboard.type('no-such-question-zzz');
    await page.getByText('No questions match').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('li.question').first().waitFor();
    assert.equal(await page.locator('li.question').count(), total);
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BODY');
    await page.context().close();
  });

  test('focused links and buttons activate natively instead of opening the selected row', async () => {
    const page = await rig.open('/fleet');
    await page.locator('.conn[data-connection="live"]').waitFor();
    await page.locator('tr.row').first().waitFor();
    await page.keyboard.press('j');
    await page.locator('tr.row.selected').waitFor();
    await page.evaluate(() => {
      const controls = document.createElement('div');
      controls.innerHTML = '<a href="#/work" aria-label="Native link"><span>Work</span></a><button aria-label="Native button"><span>Press</span></button>';
      controls.querySelector('button')?.addEventListener('click', () => { controls.setAttribute('data-activated', 'yes'); });
      controls.id = 'native-controls';
      document.body.append(controls);
    });
    for (const key of ['Enter', 'Space']) {
      await page.getByRole('button', { name: 'Native button' }).focus();
      await page.keyboard.press(key);
      assert.equal(await page.locator('#native-controls').getAttribute('data-activated'), 'yes');
      assert.equal(await page.evaluate(() => window.location.hash), '#/fleet');
      await page.locator('#native-controls').evaluate(node => { node.removeAttribute('data-activated'); });
    }
    await page.getByRole('button', { name: 'Native button' }).focus();
    await page.keyboard.press('?');
    await page.getByRole('dialog', { name: 'Keyboard help' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('link', { name: 'Native link' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.location.hash === '#/work');
    await page.context().close();
  });

  test('transcript jump: an attention item opens its session at the exact line', async () => {
    // The accelerated mock evicts old entries. Own a fresh request/entry pair, not the first retained pointer.
    const fixture = rig.daemon.store.fixture;
    const requestId = 'jump-request';
    rig.daemon.store.publish('transcript.appended', { ...fixture.transcript[0], kind: 'user', requestId });
    const entry = fixture.transcript.at(-1);
    assert.ok(entry);
    rig.daemon.store.publish('request.observed', {
      ...fixture.requests[0], id: requestId, sessionId: entry.sessionId, status: 'open', text: 'Transcript-jump request', resetId: null, answer: null, interimAnswers: [],
    });
    const page = await rig.open('/overview');
    try {
      const link = page.locator('[data-reason="open-request"]', { hasText: 'Transcript-jump request' }).getByRole('link', { name: 'Open in session' });
      const href = `#/session/${entry.sessionId}?entry=${entry.id}`;
      assert.equal(await link.getAttribute('href'), href);
      await link.click();
      await page.locator('.tline.target').waitFor();
      assert.equal(new URL(page.url()).hash, href);
      assert.equal(await page.locator('.tline.target').getAttribute('id'), `line-${String(entry.cursor)}`);
      assert.ok(await page.locator('.tline.target').isVisible());
    } finally {
      fixture.requests = fixture.requests.filter(request => request.id !== requestId);
      fixture.transcript = fixture.transcript.filter(item => item.id !== entry.id);
      await page.context().close();
    }
  });

  test('reading back pauses following and keeps the viewport on the same line while new lines arrive', async () => {
    const page = await rig.open('/session/s2');
    await page.locator('.tline').nth(30).waitFor();
    const follow = page.getByRole('button', { name: /Following/ });
    await follow.waitFor();
    await page.locator('.transcript').hover();
    await page.mouse.wheel(0, -600);
    await page.getByRole('button', { name: /Follow tail/ }).waitFor();
    const probe = (): Promise<[string, number] | null> => page.evaluate(() => {
      const pane = document.querySelector('.transcript');
      const edge = pane?.getBoundingClientRect().top ?? 0;
      const found = [...(pane?.querySelectorAll('[id^="line-"]') ?? [])].find(node => node.getBoundingClientRect().bottom > edge + 1);
      return found ? [found.id, Math.round(found.getBoundingClientRect().top - edge)] : null;
    });
    await page.waitForFunction(() => new Promise<boolean>(resolve => {
      const top = document.querySelector('.transcript')?.scrollTop;
      requestAnimationFrame(() => requestAnimationFrame(() => { resolve(document.querySelector('.transcript')?.scrollTop === top); }));
    }), undefined, { polling: 100 });
    const before = await probe();
    await page.waitForTimeout(1500);
    assert.deepEqual(await probe(), before, 'the viewport stays anchored while the transcript changes');
    await page.context().close();
  });

  test('transcript text is escaped: markup and terminal escapes in a payload never execute', async () => {
    const page = await rig.open('');
    await page.route('**/api/v1/sessions/s2/transcript*', async route => {
      const body = {
        items: [{ id: 'evil1', cursor: 1, sessionId: 's2', at: '2026-11-20T09:00:00.000Z', kind: 'assistant', text: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>\u001b[31mred\u001b[0m\u001b]0;title\u0007', toolCallId: null, resetId: null, requestId: null, toolResult: null }],
        nextCursor: 1, hasMore: false,
      };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.evaluate(() => { window.location.hash = '#/session/s2'; });
    const line = page.locator('#line-1');
    await line.waitFor();
    assert.match(await line.evaluate(node => node.textContent), /<img src=x onerror=/, 'shown as text');
    assert.equal(await line.locator('img, script').count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned), undefined);
    assert.ok(!(await line.evaluate(node => node.textContent)).includes(String.fromCharCode(27)));
    await page.context().close();
  });

  test('every view renders without errors and the graph has a working time scrubber', async () => {
    const page = await rig.open('/overview');
    const errors = watchErrors(page);
    await page.locator('.conn[data-connection="live"]').waitFor();
    for (const key of ['1', '2', '3', '4', '5', '6', '7', ',']) {
      await page.keyboard.press(key);
      await page.locator('#content').waitFor();
      assert.ok((await page.locator('#content').innerText()).length > 0);
    }
    await page.evaluate(() => { window.location.hash = '#/messages?view=graph'; });
    await page.locator('svg.graph').first().waitFor();
    const edges = await page.locator('path.edge').count();
    await page.keyboard.press('t');
    const slider = page.getByRole('slider', { name: 'Time scrubber' });
    await slider.waitFor();
    await slider.fill(await slider.getAttribute('min') ?? '0');
    assert.ok(await page.locator('path.edge').count() <= edges);
    assert.deepEqual(errors, []);
    await page.context().close();
  });

  test('requests: filters cycle with the shared keys, labels are visible, and a request opens its transcript entry', async () => {
    const page = await rig.open('/requests');
    const errors = watchErrors(page);
    await page.locator('[data-request]').first().waitFor();
    await page.locator('[data-testid="uncertain"]').first().waitFor();
    assert.ok(await page.locator('[data-request]').count() > 3);
    await page.keyboard.press(']');
    await page.getByTestId('request-summary').getByText('state open', { exact: false }).waitFor();
    await page.keyboard.press('[');
    await page.getByTestId('request-summary').getByText('state all', { exact: false }).waitFor();
    await page.keyboard.press('o');
    await page.getByTestId('request-summary').getByText('origin human', { exact: false }).waitFor();
    await page.keyboard.press('o');
    await page.getByTestId('request-summary').getByText('origin launch', { exact: false }).waitFor();
    await page.keyboard.press('o');
    await page.keyboard.press('o');
    const cards = page.locator('[data-request]');
    for (let index = 0; index < await cards.count() && await page.getByTestId('request-jump').count() === 0; index++) await cards.nth(index).click();
    await page.getByRole('complementary', { name: 'Request detail' }).waitFor();
    await page.getByTestId('request-jump').click();
    await page.waitForURL(/#\/session\/s\d+/);
    assert.match(page.url(), /entry=/, 'the jump carries the transcript entry');
    assert.deepEqual(errors, []);
    await page.context().close();
  });

  test('the bundle enforces its strict CSP in the browser: no inline script runs, nothing leaves the origin', async () => {
    const page = await rig.open('/fleet');
    const external: string[] = [];
    page.on('request', request => { if (!request.url().startsWith(rig.baseUrl) && !request.url().startsWith('data:')) external.push(request.url()); });
    const violations: string[] = [];
    page.on('console', message => { if (message.text().includes('Content Security Policy')) violations.push(message.text()); });
    await page.locator('.conn[data-connection="live"]').waitFor();
    const ran = await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__inline = true';
      document.head.append(script);
      return (window as unknown as { __inline?: boolean }).__inline === true;
    });
    assert.equal(ran, false, 'inline script is refused by the CSP');
    assert.deepEqual(external, []);
    assert.ok(violations.length > 0, 'the browser reported the blocked inline script');
    await page.context().close();
  });
});

test('real-shaped identity and unknown dollars render without fake lane metadata', async () => {
  const realRig = await startRig({ speed: 1e-9 });
  const page = await realRig.open('/fleet');
  try {
    await page.locator('.conn[data-connection="live"]').waitFor();
    const response = await page.request.get(`${realRig.baseUrl}/api/v1/sessions/s2`, { headers: { Authorization: `Bearer ${realRig.daemon.token}` } });
    assert.equal(response.status(), 200);
    const detail = await response.json() as SessionDetail;
    detail.session = { ...detail.session, repositoryId: '/work/repo', cwd: '/work/repo', name: 'repo', laneId: 'unassigned', branch: '', model: '', samples: [], costUsd: null };
    // Existing snapshot sessions skip HTTP detail reads; update the authoritative stream instead.
    realRig.daemon.store.publish('session.updated', detail.session);
    await page.evaluate(() => { window.location.hash = '#/session/s2'; });
    await page.getByRole('heading', { name: 's2 repo', exact: true }).waitFor();
    const header = await page.locator('.session-head').innerText();
    assert.match(header, /—/);
    assert.doesNotMatch(header, /unassigned|\$0\.00| · {2}· /);
  } finally { await page.context().close(); await realRig.close(); }
});
