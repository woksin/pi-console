import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { glyphs, markerLegend, transcriptLines, pressureColor, pressureGradient, requestsViewModel } from '@pi-console/viewmodels';
import { themeColors } from '@pi-console/contract';
import { palette, quantize } from './view/theme.ts';
import { renderEntry } from './views/session.ts';
import { pressureBar } from './view/parts.ts';
import { startHarness, type Harness } from './testing/harness.ts';

test('web gradient and true-colour terminal use the same ramp at 51%, with threshold ticks and band fallbacks', () => {
  for (const highContrast of [false, true]) {
    const colors = themeColors(highContrast);
    palette.configure('truecolor', highContrast ? 'contrast' : 'midnight');
    assert.equal(palette.resolve('pressure:51'), pressureColor(51, colors));
    assert.ok(pressureGradient(colors).includes(`${palette.resolve('pressure:51')} 51%`));
    for (const depth of ['256', '16'] as const) {
      palette.configure(depth, highContrast ? 'contrast' : 'midnight');
      assert.ok([colors.green, colors.amber, colors.red].map(color => quantize(color, depth)).includes(palette.resolve('pressure:51')));
    }
  }
  palette.configure('truecolor', 'midnight');
  const bar = pressureBar(100, 101);
  assert.equal(bar[51].color, 'pressure:51');
  assert.equal(bar[60].text, '│');
  assert.equal(bar[80].text, '│');
});

test('transcript glyphs match the shared table rendered by web, including resets; marker legend uses the same reset', () => {
  const kinds = ['user', 'thinking', 'assistant', 'tool.call', 'tool.result', 'diff', 'reset'] as const;
  for (const [index, kind] of kinds.entries()) {
    const [line] = transcriptLines([{ id: String(index), sessionId: 's', cursor: index, at: '2026-01-01T00:00:00Z', kind, text: 'body', toolCallId: null, resetId: null, requestId: null, toolResult: null }]);
    assert.equal(line.glyph, glyphs[line.kind]);
    assert.ok(renderEntry(line, 100).flat().some(part => part.text.includes(glyphs[line.kind])));
  }
  assert.equal(markerLegend.find(item => item.label === 'reset')?.glyph, glyphs.reset);
});

/** The goldens are the view-model contract shared with the web UI; the TUI must show what they say, in its own layout. */
const golden = (view: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../viewmodels/src/${view}/golden.json`, import.meta.url)), 'utf8'));
const flat = (text: string) => text.replace(/[│╭╮╰╯─▌]/g, ' ').replace(/\s+/g, ' ');
const lead = (text: string, length = 24) => text.slice(0, length).trim();

let harness: Harness;
// Frozen replay: the goldens describe one moment, and a running replay changes the attention count under load.
before(async () => { harness = await startHarness({ width: 200, height: 160 }, { speed: 0 }); });
after(async () => { await harness.stop(); });

const section = async (key: string, marker: string) => { await harness.ui.press(key); return flat(await harness.ui.waitFor(marker)); };

test('overview shows the headline and every attention card', async () => {
  const model = golden('overview') as { headline: string; cards: { text: string }[] };
  const frame = await section('1', model.headline);
  assert.ok(frame.includes(model.headline), model.headline);
  for (const card of model.cards) assert.ok(frame.includes(lead(card.text)), card.text);
});

test('fleet lists every repository group and session', async () => {
  const model = golden('fleet') as { rows: { kind: string; label?: string; name?: string }[] };
  const frame = await section('2', 'Fleet ·');
  for (const row of model.rows) {
    const label = row.kind === 'group' ? row.label : row.name;
    assert.ok(label && frame.includes(label), String(label));
  }
});

test('requests, questions and messages show their goldens', async () => {
  const requests = golden('request-list') as { rows: { id: string; text: string }[] };
  let frame = await section('3', 'Requests');
  // The mock daemon withholds r6's text on purpose (derived-request demo), so the TUI rightly shows [withheld] for it.
  for (const row of requests.rows.filter(item => item.id !== 'r6')) assert.ok(frame.includes(lead(row.text)), row.text);
  const questions = golden('questions') as { rows: { text: string }[] };
  frame = await section('4', 'Questions');
  for (const row of questions.rows) assert.ok(frame.includes(lead(row.text)), row.text);
  const messages = golden('messages') as { rows: { text: string }[] };
  frame = await section('5', 'Messages');
  for (const row of messages.rows.slice(0, 20)) assert.ok(frame.includes(lead(row.text, 16)), row.text);
});

test('requests show uncertain and possibly-unseen labels, filter with the shared keys, and Enter opens the transcript at the prompt', async () => {
  let frame = await section('3', 'Requests');
  assert.ok(frame.includes('uncertain'), 'uncertain label on the list');
  assert.ok(frame.includes('unseen?'), 'possibly unseen label on the list');
  assert.ok(frame.includes('state all · origin all · session all'), 'filter summary');
  await harness.ui.press(']');
  frame = flat(await harness.ui.waitFor('state open'));
  assert.ok(frame.includes('origin all'));
  await harness.ui.press('[');
  await harness.ui.waitFor('state all');
  for (let step = 0; step < 12 && !flat(await harness.ui.waitFor(() => true)).includes('opens the transcript'); step++) await harness.ui.press('j');
  await harness.ui.waitFor('opens the transcript');
  await harness.ui.press('RETURN');
  frame = await harness.ui.waitFor(() => true);
  for (let wait = 0; wait < 40 && !frame.includes('paused'); wait++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    await harness.ui.settle();
    frame = await harness.ui.waitFor(() => true);
  }
  frame = flat(frame);
  assert.ok(frame.includes('paused'), 'paused at the prompt once the transcript has loaded');
  assert.ok(!frame.includes('following tail'), 'opened scrolled to the prompt, not following the tail');
  await harness.ui.press('ESCAPE');
});

const requestFlags = (frame: string) => frame.split('\n').flatMap(line => {
  // Origin then two fixed flag columns; the legend and provenance panel are not request rows.
  const flags = / [●◆○] ([≈ ])([◌ ]) /.exec(line);
  return flags ? [{ line, uncertain: flags[1] === '≈', possiblyUnseen: flags[2] === '◌' }] : [];
});

/** Glyph-only columns preserve the web's per-request semantics; the legend is not evidence of a row's flags. */
for (const width of [80, 132]) {
  test(`requests rows keep their uncertain and unseen flags on the row at ${String(width)} columns`, async () => {
    const narrow = await startHarness({ width, height: 90 });
    try {
      await narrow.ui.press('3');
      const frame = await narrow.ui.waitFor('Requests');
      const { requests, sessions } = narrow.runtime.store.getSnapshot();
      const model = requestsViewModel({ requests, sessions, now: Date.now(), filter: { state: 'all', origin: 'all', sessionId: null, query: '' } });
      const displayed = requestFlags(frame);
      assert.equal(displayed.length, model.rows.length, 'every request has its own origin and flag columns');
      for (const [index, row] of model.rows.entries()) {
        assert.ok(displayed[index].line.includes(row.text.slice(0, 12)), `flags belong to request ${row.id}`);
        assert.equal(displayed[index].uncertain, Boolean(row.uncertain), `uncertain flag for ${row.id}`);
        assert.equal(displayed[index].possiblyUnseen, Boolean(row.possiblyUnseen), `possibly unseen flag for ${row.id}`);
      }
      assert.equal(displayed.filter(row => row.uncertain).length, model.uncertain, 'uncertain rows flagged on their own line');
      assert.equal(displayed.filter(row => row.possiblyUnseen).length, model.possiblyUnseen, 'possibly unseen rows flagged on their own line');
    } finally { await narrow.stop(); }
  });
}

test('a reset divider names its kind and counts, then lists what it carried over and interrupted', () => {
  const [line] = transcriptLines([{ id: 'x', sessionId: 's', cursor: 1, at: '2026-11-20T09:00:18Z', kind: 'reset', text: 'Handoff', toolCallId: null, resetId: 'reset1', requestId: null, toolResult: null }]);
  const reset = { kind: 'handoff' as const, summary: 'handoff · 2 carried · 1 interrupted', carried: [{ id: 'r1', text: 'Compare' }, { id: 'r2', text: 'Write' }], interrupted: [{ id: 'r1', text: 'Compare' }] };
  const text = renderEntry({ ...line, reset }, 100).map(parts => parts.map(part => part.text).join(''));
  assert.match(text[0], /09:00:18 .*⟲ handoff · 2 carried · 1 interrupted/);
  assert.match(text[1], /carried\s+r1 Compare/);
  assert.match(text[2], /^\s+┊\s+r2 Write/);
  assert.match(text[3], /interrupted\s+r1 Compare/);
});
