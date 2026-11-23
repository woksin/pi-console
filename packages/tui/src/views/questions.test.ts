import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Question, Snapshot, TranscriptEntry } from '@pi-console/contract';
import { App } from '../app.ts';
import { Store } from '../store/store.ts';
import { h, mountHeadless } from '../view/renderer.ts';

const demoSnapshot = generate().fixture as unknown as Snapshot & { transcript: TranscriptEntry[] };
const paragraphs = Array.from({ length: 30 }, (_, index) => `Question-paragraph-${String(index).padStart(2, '0')} with full text.`);
const options = Array.from({ length: 12 }, (_, index) => `Option ${String(index).padStart(2, '0')} ${'complete option text '.repeat(5)}END-${String(index)}`);
const question: Question = { id: 'q-detail', sessionId: demoSnapshot.sessions[0].id, kind: 'question', text: paragraphs.join('\n'), options, urgency: 'normal', blocking: false, status: 'open', createdAt: demoSnapshot.generatedAt };
const sessionTranscript = (sessionId: string): TranscriptEntry[] => Array.from({ length: 60 }, (_, index) => ({ ...demoSnapshot.transcript[0], sessionId, id: `entry-${String(index)}`, cursor: index + 1 }));

async function setup(width: number, questions = [question]) {
  const store = new Store();
  store.apply({ seq: 1, type: 'snapshot', occurredAt: demoSnapshot.generatedAt, payload: { ...demoSnapshot, questions } });
  store.flush();
  const opened: string[] = [];
  const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { section: 'questions' }, loadTranscript: (id: string) => { opened.push(id); store.mergeTranscript(id, sessionTranscript(id)); store.flush(); }, loadMemory: () => undefined, onQuit: () => undefined }), { width, height: 24 });
  await ui.settle();
  return { ui, store, opened };
}

async function withScrolledDetail(check: (ui: Awaited<ReturnType<typeof setup>>['ui'], frame: string) => Promise<void>) {
  const { ui, store } = await setup(80);
  try {
    await ui.press('RETURN');
    await ui.press('\u001b[6~');
    const frame = ui.frame();
    assert.match(frame, /enter session/);
    assert.doesNotMatch(frame, /Question-paragraph-00/);
    await check(ui, frame);
  } finally { ui.destroy(); store.dispose(); }
}

test('80x24: Enter opens full-width question detail; scrolling reaches every paragraph and option; Esc returns', async () => {
  const { ui, store, opened } = await setup(80);
  try {
    await ui.press('RETURN');
    assert.match(ui.frame(), /esc back/);
    let seen = ui.frame();
    for (let page = 0; page < 10; page++) { await ui.press('\u001b[6~'); seen += ui.frame(); }
    for (const paragraph of paragraphs) assert.ok(seen.includes(paragraph.split(' ')[0]), paragraph);
    for (let index = 0; index < options.length; index++) {
      assert.ok(seen.includes(`Option ${String(index).padStart(2, '0')}`));
      assert.ok(seen.includes(`END-${String(index)}`));
    }
    assert.deepEqual(opened, [], 'question detail does not open its session');
    await ui.press('HOME');
    assert.match(ui.frame(), /Question-paragraph-00/);
    await ui.press('END');
    assert.match(ui.frame(), /END-11/);
    await ui.press('ESCAPE');
    assert.match(ui.frame(), /Questions · 1 open/);
    await ui.press('RETURN');
    assert.match(ui.frame(), /Question-paragraph-00/, 'reopening resets scroll');
  } finally { ui.destroy(); store.dispose(); }
});

test('palette open and Esc preserve narrow question detail and its scroll position', () => withScrolledDetail(async (ui, scrolled) => {
  await ui.press(':');
  assert.match(ui.frame(), /Command palette/);
  await ui.type('not-a-palette-match');
  await ui.press('ESCAPE');
  assert.equal(ui.frame(), scrolled);
  await ui.press('ARROW_DOWN');
  assert.notEqual(ui.frame(), scrolled, 'detail remains scrollable');
}));

test('Help open and close preserve narrow question detail and its scroll position', () => withScrolledDetail(async (ui, scrolled) => {
  for (const close of ['ESCAPE', '?']) {
    await ui.press('?');
    assert.match(ui.frame(), /keyboard map/i);
    await ui.press('ARROW_DOWN');
    await ui.press(close);
    assert.equal(ui.frame(), scrolled);
  }
  await ui.press('ARROW_UP');
  assert.notEqual(ui.frame(), scrolled, 'detail remains scrollable');
}));

test('a Help action dispatched through the palette preserves the underlying question detail', () => withScrolledDetail(async (ui, scrolled) => {
  await ui.press(':');
  await ui.type('help');
  await ui.press('RETURN');
  assert.match(ui.frame(), /keyboard map/i);
  await ui.press('ESCAPE');
  assert.equal(ui.frame(), scrolled);
}));

test('filter typing and Escape preserve narrow detail even when the draft matches no question', () => withScrolledDetail(async (ui, scrolled) => {
  await ui.press('/');
  await ui.type('not-a-question-match');
  await ui.press('ESCAPE');
  assert.equal(ui.frame(), scrolled);
}));

test('resizing wide while the palette is open dismisses detail and narrowing again does not restore it', () => withScrolledDetail(async ui => {
  await ui.press(':');
  await ui.resize(140, 42);
  await ui.press('ESCAPE');
  assert.match(ui.frame(), /Questions · 1 open/);
  await ui.resize(80, 24);
  assert.match(ui.frame(), /Questions · 1 open/);
  assert.doesNotMatch(ui.frame(), /enter session/);
}));

test('resizing an open narrow detail to wide restores list navigation and Enter targets the moved cursor', async () => {
  const second = { ...question, id: 'q-second', sessionId: demoSnapshot.sessions[1].id, text: 'Second question' };
  const { ui, store, opened } = await setup(80, [question, second]);
  try {
    await ui.press('RETURN');
    assert.match(ui.frame(), /esc back/);
    await ui.resize(140, 42);
    assert.match(ui.frame(), /Questions · 2 open/);
    await ui.press('ARROW_DOWN');
    await ui.press('RETURN');
    assert.deepEqual(opened, [second.sessionId]);
    await ui.press('ESCAPE');
    assert.match(ui.frame(), /Questions · 2 open/, 'one Esc leaves the session');
  } finally { ui.destroy(); store.dispose(); }
});

test('a palette session opened from narrow question detail scrolls its transcript and closes with one Esc', async () => {
  const { ui, store, opened } = await setup(80);
  try {
    await ui.press('RETURN');
    await ui.press(':');
    await ui.type('@');
    await ui.press('RETURN');
    assert.equal(opened.length, 1);
    assert.match(ui.frame(), /Transcript/);
    await ui.press('HOME');
    assert.match(ui.frame(), /paused/, 'Home navigates the transcript rather than hidden detail');
    await ui.press('ESCAPE');
    assert.match(ui.frame(), /Questions · 1 open/, 'one Esc leaves the session');
    assert.doesNotMatch(ui.frame(), /enter session/, 'the old narrow detail is cleared');
  } finally { ui.destroy(); store.dispose(); }
});

test('Enter in narrow detail can open the question session', async () => {
  const { ui, store, opened } = await setup(80);
  try {
    await ui.press('RETURN');
    assert.match(ui.frame(), /enter session/);
    await ui.press('RETURN');
    assert.deepEqual(opened, [question.sessionId]);
    assert.match(ui.frame(), /Transcript/);
  } finally { ui.destroy(); store.dispose(); }
});

for (const width of [80, 120, 160, 200]) {
  test(`${String(width)} columns: v expands the full question and every wrapped option; v and Esc return to the list`, async () => {
    const { ui, store, opened } = await setup(width);
    try {
      await ui.press('v');
      assert.match(ui.frame(), /enter session/);
      assert.match(ui.frame(), /Question-paragraph-00/);
      let seen = ui.frame();
      for (let page = 0; page < 10; page++) { await ui.press('\u001b[6~'); seen += ui.frame(); }
      for (const paragraph of paragraphs) assert.ok(seen.includes(paragraph.split(' ')[0]), paragraph);
      for (let index = 0; index < options.length; index++) {
        assert.ok(seen.includes(`Option ${String(index).padStart(2, '0')}`));
        assert.ok(seen.includes(`END-${String(index)}`));
      }
      assert.deepEqual(opened, []);
      await ui.press('HOME');
      assert.match(ui.frame(), /Question-paragraph-00/);
      await ui.press('END');
      assert.match(ui.frame(), /END-11/);
      await ui.press('v');
      assert.match(ui.frame(), /Questions · 1 open/);
      await ui.press('v');
      assert.match(ui.frame(), /Question-paragraph-00/, 'expanding resets scroll');
      await ui.press('ESCAPE');
      assert.match(ui.frame(), /Questions · 1 open/);
    } finally { ui.destroy(); store.dispose(); }
  });
}

test('explicit wide expansion survives resize and Help, and Enter still opens the question session', async () => {
  const { ui, store, opened } = await setup(160);
  try {
    await ui.press('v');
    await ui.press('\u001b[6~');
    await ui.press('?');
    await ui.press('ESCAPE');
    assert.doesNotMatch(ui.frame(), /Question-paragraph-00/);
    await ui.resize(120, 24);
    assert.match(ui.frame(), /enter session/);
    assert.doesNotMatch(ui.frame(), /Question-paragraph-00/);
    await ui.press('RETURN');
    assert.deepEqual(opened, [question.sessionId]);
    await ui.press('ESCAPE');
    assert.match(ui.frame(), /Questions · 1 open/);
  } finally { ui.destroy(); store.dispose(); }
});

test('wide Questions keeps the side panel and Enter still opens the session', async () => {
  const { ui, store, opened } = await setup(140);
  try {
    assert.match(ui.frame(), /OPTIONS/);
    await ui.press('RETURN');
    assert.deepEqual(opened, [question.sessionId]);
  } finally { ui.destroy(); store.dispose(); }
});

const history = Array.from({ length: 40 }, (_, index) => ({
  sequence: 40 - index, operation: index % 2 ? 'comment' : 'answered', at: new Date(Date.parse(demoSnapshot.generatedAt) - index * 60_000).toISOString(),
  actor: `Actor${String(40 - index)}`, excerpt: `Note-${String(40 - index).padStart(2, '0')} \u001b]8;;http://evil.invalid\u0007link\u001b]8;;\u0007 \u001b[31mred\u001b[0m`, withheld: false,
}));
const withHistory: Question = { ...question, id: 'q-history', text: 'Short question', options: ['A', 'B'], updatedAt: demoSnapshot.generatedAt, history };

test('80x24: full detail reaches every history entry, newest first, with terminal escapes stripped', async () => {
  const { ui, store } = await setup(80, [withHistory]);
  try {
    await ui.press('RETURN');
    let seen = ui.frame();
    for (let page = 0; page < 30; page++) { await ui.press('\u001b[6~'); seen += ui.frame(); }
    for (let sequence = 1; sequence <= 40; sequence++) {
      assert.ok(seen.includes(`Note-${String(sequence).padStart(2, '0')}`), `note ${String(sequence)}`);
      assert.ok(seen.includes(`Actor${String(sequence)}`), `actor ${String(sequence)}`);
    }
    assert.ok(seen.indexOf('Note-40') < seen.indexOf('Note-01'), 'newest first');
    assert.ok(!seen.includes('evil.invalid') && !seen.includes('\u001b'), 'escapes are removed');
    assert.match(seen, /HISTORY \(40, NEWEST FIRST\)/i);
  } finally { ui.destroy(); store.dispose(); }
});

test('80x24: history shows the readable absolute time with its zone next to the relative age', async () => {
  const { ui, store } = await setup(80, [withHistory]);
  try {
    await ui.press('RETURN');
    const frame = ui.frame();
    assert.match(frame, /20 Nov 2026 09:00:00 UTC answered by Actor40 · \d+[smhd] ago/);
    assert.doesNotMatch(frame, /2026-11-20T09:00:00/);
  } finally { ui.destroy(); store.dispose(); }
});

test('wide preview names updated, last activity and the history count without hiding the question', async () => {
  const { ui, store } = await setup(160, [withHistory]);
  try {
    const frame = ui.frame();
    assert.match(frame, /Short question/);
    assert.match(frame, /answered by[\s│]+Actor40/);
    assert.match(frame, /History \(40\) · v expand/);
  } finally { ui.destroy(); store.dispose(); }
});

test('old questions without history say so in the preview and the full detail', async () => {
  const { ui, store } = await setup(80);
  try {
    await ui.press('RETURN');
    await ui.press('END');
    assert.match(ui.frame(), /History unavailable: this question predates recorded history\./);
  } finally { ui.destroy(); store.dispose(); }
});

test('o cycles the sort, S cycles the stale threshold, and both show in the title and reset the cursor', async () => {
  const old: Question = { ...question, id: 'q-old', text: 'Ancient question', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
  const fresh: Question = { ...question, id: 'q-fresh', text: 'Fresh question', createdAt: demoSnapshot.generatedAt, updatedAt: demoSnapshot.generatedAt };
  const { ui, store } = await setup(100, [old, fresh]);
  try {
    assert.match(ui.frame(), /priority · stale 7d/);
    assert.match(ui.frame(), /stale/);
    await ui.press('j');
    await ui.press('o');
    assert.match(ui.frame(), /last updated · stale 7d/);
    assert.ok(ui.frame().indexOf('Fresh question') < ui.frame().indexOf('Ancient question'));
    await ui.press('o');
    assert.match(ui.frame(), /last activity · stale 7d/);
    await ui.press('S');
    assert.match(ui.frame(), /last activity · stale 14d/);
    await ui.press('o');
    assert.match(ui.frame(), /priority · stale 14d/);
  } finally { ui.destroy(); store.dispose(); }
});

test('80x24: long actor labels wrap in history and shortened notes are labelled', async () => {
  const actor = 'Z'.repeat(20) + 'ENDACTOR';
  const long: Question = { ...withHistory, id: 'q-long', history: [{ ...history[0], actor: actor + 'w'.repeat(30) + 'TAILMARK', excerpt: 'partial note', truncated: true }] };
  const { ui, store } = await setup(80, [long]);
  try {
    await ui.press('RETURN');
    await ui.press('END');
    const frame = ui.frame().replace(/[│\s]+/g, '');
    assert.ok(frame.includes('TAILMARK'), 'metadata is wrapped, not clipped');
    assert.match(ui.frame(), /partial note… \(shortened\)/);
  } finally { ui.destroy(); store.dispose(); }
});

const mootEvidence = (target: string, state: string) => ({ target, kind: 'issue', state, closedAt: state === 'open' ? null : '2026-01-01T00:00:00Z', fetchedAt: new Date(Date.now() - 60_000).toISOString(), source: 'github-gh' });
const mootQuestions = [
  { ...question, id: 'q-moot', text: 'Moot candidate question', options: [], links: ['a/b#1'], linkEvidence: [mootEvidence('a/b#1', 'closed')] },
  { ...question, id: 'q-live', text: 'Still live question', options: [], links: ['a/b#2'], linkEvidence: [mootEvidence('a/b#2', 'open')] },
] as Question[];

for (const width of [80, 120, 160]) {
  test(`${String(width)} columns: the list row says "Possibly moot" only for the fully closed question, advisory only`, async () => {
    const { ui, store } = await setup(width, mootQuestions);
    try {
      const lines = ui.frame().split('\n');
      assert.equal(lines.filter(line => line.includes('Possibly moot')).length, 1);
      assert.ok(lines.find(line => line.includes('Possibly moot'))?.includes('Moot candidate'));
      assert.ok(!lines.find(line => line.includes('Still live'))?.includes('Possibly moot'));
    } finally { ui.destroy(); store.dispose(); }
  });
}
