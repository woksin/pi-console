import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Session } from '@pi-console/contract';
import { displayWidth } from '@pi-console/viewmodels';
import type { Env, SectionView } from './common.ts';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { timelineView } from './timeline.ts';

const START = Date.parse('2026-01-01T12:00:00Z');
function groupedSessions(): Session[] {
  const base = generate().fixture.sessions[0] as unknown as Session;
  return [
    { ...base, id: 'a1', repositoryId: '/work/Alpha', name: 'Alpha-coordinator', laneId: 'L1', status: 'idle' },
    { ...base, id: 'b1', repositoryId: '/work/Beta', name: 'Beta-worker', laneId: 'L2', status: 'idle' },
    { ...base, id: 'a2', repositoryId: '/work/Alpha', name: 'Alpha-planner', laneId: 'L3', status: 'idle' },
  ];
}

interface TimelineOptions { width: number; height: number; cursor?: number; scrub?: number; sessions?: Session[] }
async function checkTimeline(options: TimelineOptions, check: (view: SectionView, frame: string) => void): Promise<void> {
  const sessions = options.sessions ?? groupedSessions();
  const store = new Store();
  const env: Env = {
    data: {
      ...store.getSnapshot(), loaded: true, sessions,
      resets: sessions.map(session => ({ id: session.id, sessionId: session.id, at: new Date(START).toISOString(), kind: 'compaction', carriedRequestIds: [], interruptedRequestIds: [] })),
    },
    ui: { ...initial, section: 'timeline', cursor: { ...initial.cursor, timeline: options.cursor ?? 0 }, window: { start: START, span: 420_000 }, scrub: options.scrub !== undefined, scrubColumn: options.scrub ?? 0 },
    measure: displayWidth, width: options.width, height: options.height, now: START, phase: 0, click: () => undefined,
  };
  const view = timelineView(env);
  const ui = await mountHeadless(h(Screen, {}, view.render()), options);
  try {
    await ui.settle();
    check(view, ui.frame());
  } finally { ui.destroy(); store.dispose(); }
}

test('timeline snapshot separates lane labels from a left-edge marker and aligns the shared axis', async () => {
  for (const width of [80, 120]) await checkTimeline({ width, height: 32 }, (view, frame) => {
    const line = frame.split('\n').find(row => row.includes('▌– coordinator'))!;
    const start = line.indexOf('▌');
    assert.equal(line.slice(start, start + 26), `▌– ${'coordinator · L1'.padEnd(21)} ⟲`);
    const axis = frame.split('\n').find(row => row.includes('12:00'))!;
    assert.equal(axis.indexOf('12:00'), start + 25, 'axis and first marker share a column');
    assert.equal(view.idAt?.(0), 'a1');
  });
});

test('repository headings group interleaved lanes, strip repeated prefixes, and preserve navigation ids', async () => {
  await checkTimeline({ width: 120, height: 40, cursor: 1 }, (view, frame) => {
    assert.equal(view.length, 3);
    assert.deepEqual([0, 1, 2].map(index => view.idAt?.(index)), ['a1', 'a2', 'b1']);
    assert.deepEqual(view.rowAt(1), { sessionId: 'a2', groupId: null });
    assert.equal(view.idAt?.(3), null);
    assert.match(frame, /▌– planner · L3/);
    assert.doesNotMatch(frame, /Alpha-coordinator|Alpha-planner|Beta-worker/);
    const rows = frame.split('\n');
    const alpha = rows.findIndex(row => row.slice(1, -1).trim() === 'Alpha');
    const beta = rows.findIndex(row => row.slice(1, -1).trim() === 'Beta');
    assert.ok(alpha >= 0 && alpha < rows.findIndex(row => row.includes('coordinator · L1')));
    assert.ok(rows.findIndex(row => row.includes('planner · L3')) < beta);
    assert.ok(beta < rows.findIndex(row => row.includes('worker · L2')));
  });
});

test('a scrolled selection keeps its repository heading and scrub marker visible', async () => {
  const base = groupedSessions()[0];
  const sessions = Array.from({ length: 12 }, (_, index) => ({ ...base, id: `a${String(index)}`, name: `Alpha-agent${String(index)}`, laneId: `L${String(index)}` }));
  await checkTimeline({ width: 80, height: 22, cursor: 11, scrub: 0, sessions }, (view, frame) => {
    assert.equal(view.idAt?.(11), 'a11');
    assert.match(frame, /▌– agent11 · L11/);
    assert.ok(frame.split('\n').some(row => row.slice(1, -1).trim() === 'Alpha'));
    assert.match(frame, /scrub 12:00:00/);
    assert.match(frame, /Reset · compaction/);
  });
});

for (const [span, label] of [[300000, '5m'], [7341000, '2h 2m'], [10800000, '3h'], [97200000, '1d 3h'], [172800000, '2d']] as const) {
  test(`timeline window uses the compact duration ${label}`, async () => {
    const store = new Store();
    const { fixture } = generate();
    const size = { width: 120, height: 30 };
    const view = timelineView({
      data: { ...store.getSnapshot(), loaded: true, sessions: fixture.sessions as unknown as Session[] },
      ui: { ...initial, section: 'timeline', window: { start: Date.parse(fixture.generatedAt), span } },
      ...size, now: Date.parse(fixture.generatedAt), phase: 0, click: () => undefined,
    });
    const ui = await mountHeadless(h(Screen, {}, view.render()), size);
    try {
      await ui.settle();
      assert.ok(ui.frame().includes(`Timeline · window ${label}`));
      assert.doesNotMatch(ui.frame(), /window \d{4,}s/);
    } finally { ui.destroy(); store.dispose(); }
  });
}
