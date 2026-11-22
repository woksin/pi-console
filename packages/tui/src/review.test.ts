import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { Event, TranscriptEntry } from '@pi-console/contract';
import { DaemonClient } from './api/client.ts';
import { startHarness, type Harness } from './testing/harness.ts';
import { Store, TRANSCRIPT_LIMIT } from './store/store.ts';
import { initial } from './state/ui.ts';
import { sessionView } from './views/session.ts';
import { h, mountHeadless, Screen } from './view/renderer.ts';
import { t } from './view/parts.ts';

const ESC = '\u001b';
const BEL = '\u0007';
const hostile = `${ESC}]0;PWNED-OSC${BEL}${ESC}]52;c;PWNED-CLIP${BEL}${ESC}[31mred${ESC}[2J${ESC}P1;PWNED-DCS${ESC}\\ok`;
const poisoned = new Set(['text', 'name', 'branch', 'model', 'cwd', 'originEvidence']);
const poison = (value: unknown, key = ''): unknown => {
  if (typeof value === 'string') return poisoned.has(key) ? `${value} ${hostile}` : value;
  if (Array.isArray(value)) return value.map(item => poison(item, key === 'options' ? 'text' : key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, poison(item, name)]));
  return value;
};

let harness: Harness;
before(async () => { harness = await startHarness({ width: 150, height: 44 }); });
after(async () => { await harness.stop(); });

const controls = (frame: string) => [...frame].filter(character => { const code = character.codePointAt(0) ?? 0; return (code < 32 && code !== 10) || (code >= 127 && code <= 159); });
const quiet = async () => { harness.runtime.store.flush(); await new Promise(resolve => setTimeout(resolve, 60)); await harness.ui.settle(); };

test('t() strips terminal escapes from any text', () => {
  assert.equal(t(`a${hostile}b`).text, 'aredokb');
  assert.doesNotMatch(t(hostile).text, /PWNED/);
  assert.deepEqual(controls(t(hostile).text), []);
});

test('hostile escapes in every kind of daemon text never reach any view', async () => {
  const data = harness.runtime.store.getSnapshot();
  const snapshot = poison({ repositories: [], sessions: data.sessions, requests: data.requests, questions: data.questions, messages: data.messages, jobs: data.jobs, resets: data.resets }) as Record<string, unknown>;
  harness.runtime.store.apply({ seq: 9000, type: 'snapshot', payload: { ...snapshot, repositories: Array.from({ length: 5 }, (_, index) => ({ id: `r${String(index)}`, name: `repo ${hostile}` })) } } as unknown as Event);
  const frames: string[] = [];
  for (const key of ['1', '2', '3', '4', '5', '6', '7']) { await harness.ui.press(key); await quiet(); frames.push(harness.ui.frame()); }
  await harness.ui.press('5'); await harness.ui.press('v'); await quiet(); frames.push(harness.ui.frame());
  await harness.ui.press('v');
  await harness.ui.press('2'); await harness.ui.press('j'); await harness.ui.press('j'); await harness.ui.press('RETURN'); await quiet();
  for (const { id } of harness.runtime.store.getSnapshot().sessions) harness.runtime.store.mergeTranscript(id, [{ id: 'hostile', cursor: 9_000_000, sessionId: id, at: '2026-11-20T09:30:00.000Z', kind: 'assistant', text: `visible ${hostile}`, toolCallId: null, resetId: null, requestId: null, toolResult: null }]);
  await quiet();
  frames.push(harness.ui.frame());
  for (const frame of frames) {
    assert.deepEqual(controls(frame), []);
    assert.doesNotMatch(frame, /PWNED/);
  }
  assert.ok(frames.some(frame => frame.includes('visible')), 'the hostile entry still shows its readable text');
  await harness.ui.press('ESCAPE');
});

test('pausing follow keeps the transcript viewport fixed while entries arrive, and resuming shows them', async () => {
  await harness.ui.press('1'); await harness.ui.press('2'); await harness.ui.press('j'); await harness.ui.press('j'); await harness.ui.press('RETURN'); await quiet();
  const ids = harness.runtime.store.getSnapshot().sessions.map(session => session.id);
  const entry = (n: number): TranscriptEntry => ({ id: `live-${String(n)}`, cursor: 9_100_000 + n, sessionId: 'x', at: '2026-11-20T09:31:00.000Z', kind: 'assistant', text: `LIVE-MARK-${String(n)}`, toolCallId: null, resetId: null, requestId: null, toolResult: null });
  const merge = async (entries: TranscriptEntry[]) => { for (const id of ids) harness.runtime.store.mergeTranscript(id, entries.map(item => ({ ...item, sessionId: id }))); await quiet(); };
  await merge([entry(0)]);
  await harness.ui.press('f'); await harness.ui.waitFor('paused');
  const body = (frame: string) => frame.split('\n').filter(line => !line.includes('paused') && !line.startsWith(' pulse ')).join('\n');
  const before = body(harness.ui.frame());
  assert.match(before, /LIVE-MARK-0/);
  await merge([entry(1), entry(2)]);
  const during = harness.ui.frame();
  assert.doesNotMatch(during, /LIVE-MARK-1/);
  assert.equal(body(during), before);
  await harness.ui.press('f'); await quiet();
  assert.match(harness.ui.frame(), /LIVE-MARK-2/);
  await harness.ui.press('ESCAPE');
});

test('Ctrl+C quits even while a text overlay is open', async () => {
  await harness.ui.press('2');
  await harness.ui.press('/');
  harness.quit.requested = false;
  await harness.ui.press('c', { ctrl: true });
  await quiet();
  assert.equal(harness.quit.requested, true);
});

test('transcript backfill reaches the tail beyond 50 pages using exclusive, non-contiguous cursors', async () => {
  const total = 51_000;
  let pages = 0;
  const server: Server = createServer((request, response) => {
    pages++;
    const after = Number(new URL(request.url ?? '', 'http://x').searchParams.get('after')) / 17;
    const items = Array.from({ length: Math.min(1000, total - after) }, (_, index) => ({ id: `e${String(after + index + 1)}`, cursor: (after + index + 1) * 17 }));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ items, nextCursor: (after + items.length) * 17, hasMore: after + items.length < total }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const { entries, truncated } = await new DaemonClient({ baseUrl: `http://127.0.0.1:${String(port)}`, token: 'x', tokenSource: 'test' }).transcriptTail({ sessionId: 's1' });
    assert.equal(truncated, true);
    assert.equal(entries.length, TRANSCRIPT_LIMIT);
    assert.equal(entries[0].cursor, (total - TRANSCRIPT_LIMIT + 1) * 17);
    assert.equal(entries[entries.length - 1].cursor, total * 17);
    assert.equal(pages, 51);
  } finally { server.close(); }
});

test('a capped transcript explicitly labels the retained newest entries, including in search', async () => {
  const session = harness.runtime.store.getSnapshot().sessions[0];
  const entries: TranscriptEntry[] = Array.from({ length: TRANSCRIPT_LIMIT }, (_, index) => ({
    id: `cap-${String(index)}`, cursor: index + 1, sessionId: session.id, at: '2026-11-20T09:31:00.000Z',
    kind: 'assistant', text: `tail ${String(index)}`, toolCallId: null, resetId: null, requestId: null, toolResult: null,
  }));
  const data = { ...new Store().getSnapshot(), sessions: [session], transcripts: new Map([[session.id, entries]]), transcriptsTruncated: new Set([session.id]) };
  for (const width of [80, 150]) {
    const view = sessionView({ data, ui: { ...initial, sessionId: session.id, search: 'tail' }, width, height: 30, now: 0, phase: 0, click: () => undefined });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 30 });
    try {
      await ui.settle();
      assert.match(ui.frame(), /capped at newest 2500/);
      assert.match(ui.frame(), /tail 2499/);
    } finally { ui.destroy(); }
  }
});
