import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Event as ApiEvent, Snapshot } from '@pi-console/contract';
import type { Page } from 'playwright-core';
import { startRig, type Rig } from './harness.ts';

declare global {
  interface Window { emitTimelineFrame: (frame: ApiEvent) => void }
}

const collections = ['sessions', 'requests', 'questions', 'messages', 'resets'] as const;
type Collection = typeof collections[number];
let rig: Rig;
before(async () => { rig = await startRig({ speed: 1e-9 }); });
after(async () => { await rig.close(); });

function snapshot(age: 'Old' | 'New'): Snapshot {
  const id = age.toLowerCase();
  const sessionId = `s-${id}`;
  const at = (hour: number) => `2026-01-01T${String(hour).padStart(2, '0')}:00:00Z`;
  const start = age === 'Old' ? 0 : 12;
  return {
    version: 0, generatedAt: at(20), repositories: [{ id: 'repo', name: 'History repo' }], jobs: [], interventions: [], transcriptCursors: [], bounded: [...collections],
    totals: { sessions: 2, requests: 2, questions: 2, messages: 2, resets: 2, jobs: 0 },
    sessions: [{ id: sessionId, repositoryId: 'repo', name: `${age} session`, laneId: id, role: 'main', parentSessionId: null, orchestratorSessionId: sessionId, branch: '', cwd: '', model: '', status: 'idle', startedAt: at(start), updatedAt: at(start + 3), contextPercent: 0, samples: [] }],
    requests: [{ id: `r-${id}`, sessionId, text: `${age} request`, origin: 'human', originLabel: 'Human request', originEvidence: '', status: 'answered', createdAt: at(start), resetId: null, answer: null, interimAnswers: [] }],
    questions: [{ id: `q-${id}`, sessionId, text: `${age} question`, kind: 'question', options: [], urgency: 'normal', blocking: false, status: 'closed', createdAt: at(start + 1) }],
    messages: [{ id: `m-${id}`, fromSessionId: sessionId, toSessionId: sessionId, text: `${age} message`, status: 'read', sentAt: at(start + 2) }],
    resets: [{ id: `reset-${id}`, sessionId, kind: 'compaction', at: at(start + 3), carriedRequestIds: [`${age} reset`], interruptedRequestIds: [] }],
  };
}

/** A held SSE response permits deterministic live frames without a timer, reconnect, or a test-only app hook. */
async function connect(page: Page, initial: Snapshot): Promise<void> {
  await page.evaluate(payload => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== '/api/v1/stream') return nativeFetch(input, init);
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        window.emitTimelineFrame = frame => { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)); };
        window.emitTimelineFrame({ seq: 1, type: 'snapshot', occurredAt: payload.generatedAt, payload });
      } });
      return Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    };
  }, initial);
  await page.getByLabel('Access token').fill(rig.daemon.token);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('region', { name: 'Timeline history' }).waitFor();
}

const group = (page: Page, collection: Collection) => page.getByRole('group', { name: `${collection} history`, exact: true });
const button = (page: Page, collection: Collection) => group(page, collection).getByRole('button', { name: `Load older ${collection}`, exact: true });

function isHistoryPage(address: string, collection: Collection): boolean {
  const url = new URL(address);
  return url.pathname === `/api/v1/${collection}` && url.searchParams.get('limit') !== '1';
}

async function routePages(page: Page, failedRequest?: { released: Promise<void>; started: () => void }): Promise<Map<Collection, string[]>> {
  const seen = new Map<Collection, string[]>();
  const current = snapshot('New');
  const old = snapshot('Old');
  current.requests[0].text = 'Stale page request';
  for (const collection of collections) {
    const calls: string[] = [];
    seen.set(collection, calls);
    const failure = collection === 'requests' ? failedRequest : undefined;
    await page.route(`**/api/v1/${collection}?*`, async route => {
      const url = new URL(route.request().url());
      if (!isHistoryPage(route.request().url(), collection)) { await route.continue(); return; }
      assert.equal(url.searchParams.get('order'), 'desc');
      calls.push(url.searchParams.get('after') ?? '');
      if (calls.length === 1 && failure) {
        failure.started();
        await failure.released;
        await route.fulfill({ status: 503, json: { error: 'try again' } });
        return;
      }
      const hasMore = url.searchParams.get('after') === null;
      await route.fulfill({ json: { items: hasMore ? current[collection] : [...old[collection], ...current[collection]], nextCursor: hasMore ? `opaque/+?${collection}` : null, hasMore, total: 2 } });
    });
  }
  return seen;
}

async function loadPage(page: Page, collection: Collection): Promise<void> {
  const response = page.waitForResponse(result => isHistoryPage(result.url(), collection));
  await button(page, collection).click();
  const result = await response;
  assert.equal(result.status(), 200);
  await result.finished();
}

async function exhaust(page: Page, collection: Collection): Promise<void> {
  await loadPage(page, collection);
  assert.ok((await group(page, collection).innerText()).includes(`Showing 1 of 2 ${collection}`), 'overlapping page does not inflate loaded rows');
  await button(page, collection).waitFor();
  await loadPage(page, collection);
  await button(page, collection).waitFor({ state: 'detached' });
  assert.ok((await group(page, collection).innerText()).includes(`Showing 2 of 2 ${collection}`));
}

test('Timeline independently pages five collections, retries failure, dedupes live rows and retains old lanes on snapshot', async () => {
  const page = await rig.open('/timeline', { token: null });
  try {
    let release: () => void = () => undefined;
    const pendingFailure = new Promise<void>(resolve => { release = resolve; });
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const seen = await routePages(page, { released: pendingFailure, started: signalStarted });
    await connect(page, snapshot('New'));
    for (const collection of collections) assert.ok((await group(page, collection).innerText()).includes(`Showing 1 of 2 ${collection}`));
    const failed = page.waitForResponse(response => response.status() === 503 && new URL(response.url()).pathname === '/api/v1/requests');
    // A failed assertion closes the page; handle that waiter rejection without masking the assertion.
    void failed.catch(() => undefined);
    try {
      await button(page, 'requests').dblclick();
      await started;
      assert.equal(seen.get('requests')?.length, 1, 'in-flight double activation shares one page request');
    } finally { release(); }
    await failed;
    await button(page, 'requests').waitFor();
    assert.match(await group(page, 'requests').innerText(), /Showing 1 of 2 requests/);
    for (const collection of ['requests', 'questions', 'messages', 'resets', 'sessions'] as const) await exhaust(page, collection);
    for (const collection of collections) assert.deepEqual(seen.get(collection), [...(collection === 'requests' ? [''] : []), '', `opaque/+?${collection}`]);
    await assertLoadedTimeline(page);
  } finally { await page.context().close(); }
});

async function assertLoadedTimeline(page: Page): Promise<void> {
  const history = page.getByRole('region', { name: 'Timeline history' });
  assert.doesNotMatch(await history.innerText(), /Limited history/);
  assert.equal(await page.locator('.tl .lane').count(), 2);
  assert.equal(await page.locator('.timeline-marker').count(), 8, 'four kinds on each lane without duplicate controls');
  assert.equal(await page.getByRole('button', { name: /Stale page request/ }).count(), 0, 'current values beat overlapping stale pages');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  for (const collection of collections) assert.match(await group(page, collection).innerText(), /Showing 2 of 2/);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const event = page.getByRole('button', { name: /Human request.*repo\/old.*Old request/ });
  await event.click();
  const detail = page.getByRole('region', { name: 'Timeline event detail' });
  assert.ok((await detail.innerText()).includes('Old request'));
  const oldRequest = snapshot('Old').requests[0];
  await page.evaluate(payload => { window.emitTimelineFrame({ seq: 2, type: 'request.observed', occurredAt: payload.createdAt, payload }); }, { ...oldRequest, text: 'Live request update' });
  await detail.getByText('Live request update', { exact: true }).waitFor();
  await page.evaluate(payload => { window.emitTimelineFrame({ seq: 3, type: 'snapshot', occurredAt: payload.generatedAt, payload }); }, snapshot('New'));
  assert.equal(await page.locator('.timeline-marker').count(), 8);
  assert.ok((await detail.innerText()).includes('Live request update'));
  for (const collection of collections) assert.match(await group(page, collection).innerText(), /Showing 2 of 2/);
  assert.match(page.url(), /#\/timeline$/);
}

test('empty narrow Timeline exposes all history controls and can load a missing lane after its request', async () => {
  const page = await rig.open('/timeline', { token: null, width: 640, height: 700 });
  try {
    await routePages(page);
    const empty = snapshot('New');
    for (const collection of collections) empty[collection] = [];
    await connect(page, empty);
    assert.equal(await page.locator('.tl').count(), 0);
    for (const collection of collections) assert.ok((await group(page, collection).innerText()).includes(`Showing 0 of 2 ${collection}`));
    await loadPage(page, 'requests');
    assert.equal(await page.locator('.tl').count(), 0);
    await loadPage(page, 'sessions');
    await page.locator('.timeline-marker').waitFor();
    assert.match(await group(page, 'sessions').innerText(), /Showing 1 of 2 sessions/);
    const history = page.getByRole('region', { name: 'Timeline history' });
    assert.equal(await history.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  } finally { await page.context().close(); }
});

test('clicking adjacent Timeline glyphs selects the clicked event, not a neighbouring hit box', async () => {
  const page = await rig.open('/timeline', { token: null });
  try {
    const initial = snapshot('New');
    const request = initial.requests[0];
    initial.requests = [0, 32, 64, 3600].map((seconds, index) => ({
      ...request, id: `adjacent-${String(index)}`, text: `Adjacent event ${String(index)}`,
      createdAt: new Date(Date.parse(request.createdAt) + seconds * 1000).toISOString(),
    }));
    initial.questions = []; initial.messages = []; initial.resets = [];
    initial.bounded = ['requests'];
    initial.totals = { sessions: 1, requests: 5, questions: 0, messages: 0, resets: 0, jobs: 0 };
    await connect(page, initial);
    for (const index of [0, 1, 2, 0]) {
      const event = page.getByRole('button', { name: new RegExp(`Adjacent event ${String(index)}$`) });
      await event.click();
      await page.getByRole('region', { name: 'Timeline event detail' }).getByText(`Adjacent event ${String(index)}`, { exact: true }).waitFor();
      assert.equal(await event.getAttribute('aria-pressed'), 'true');
      assert.equal(await event.locator('.marker-ring').evaluate(node => getComputedStyle(node).pointerEvents), 'none');
      assert.equal(await event.locator('.marker-ring').evaluate(node => getComputedStyle(node).fill), 'none');
    }
  } finally { await page.context().close(); }
});
