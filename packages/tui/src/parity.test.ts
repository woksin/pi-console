import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requestsViewModel } from '@pi-console/viewmodels';
import { startHarness, type Harness } from './testing/harness.ts';

/** The goldens are the view-model contract shared with the web UI; the TUI must show what they say, in its own layout. */
const golden = (view: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../viewmodels/src/${view}/golden.json`, import.meta.url)), 'utf8'));
const flat = (text: string) => text.replace(/[│╭╮╰╯─▌]/g, ' ').replace(/\s+/g, ' ');
const lead = (text: string, length = 24) => text.slice(0, length).trim();

let harness: Harness;
before(async () => { harness = await startHarness({ width: 200, height: 160 }); });
after(async () => { await harness.stop(); });

const section = async (key: string, marker: string) => { await harness.ui.press(key); return flat(await harness.ui.waitFor(marker)); };

test('overview shows the headline and every attention card', async () => {
  const model = golden('overview') as { headline: string; cards: { text: string }[] };
  const frame = await section('1', 'need you');
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
  const requests = golden('request-list') as { rows: { text: string }[] };
  let frame = await section('3', 'Requests');
  for (const row of requests.rows) assert.ok(frame.includes(lead(row.text)), row.text);
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
  for (let step = 0; step < 12 && !flat(harness.ui.frame()).includes('opens the transcript'); step++) await harness.ui.press('j');
  await harness.ui.waitFor('opens the transcript');
  await harness.ui.press('RETURN');
  for (let wait = 0; wait < 40 && !harness.ui.frame().includes('paused'); wait++) { await new Promise(resolve => setTimeout(resolve, 100)); await harness.ui.settle(); }
  frame = flat(harness.ui.frame());
  assert.ok(frame.includes('paused'), 'paused at the prompt once the transcript has loaded');
  assert.ok(!frame.includes('following tail'), 'opened scrolled to the prompt, not following the tail');
  await harness.ui.press('ESCAPE');
});

/** Each flagged row carries its flag on its own line at ordinary widths, however long the request text; the summary counts must match the rows. */
for (const width of [80, 132]) {
  test(`requests rows keep their uncertain and unseen flags on the row at ${String(width)} columns`, async () => {
    const narrow = await startHarness({ width, height: 90 });
    try {
      await narrow.ui.press('3');
      const frame = await narrow.ui.waitFor('Requests');
      const { requests, sessions } = narrow.runtime.store.getSnapshot();
      const model = requestsViewModel({ requests, sessions, now: Date.now(), filter: { state: 'all', origin: 'all', sessionId: null, query: '' } });
      const marked = (flag: string) => frame.split('\n').filter(line => line.includes(flag) && /\b\d+[smhd]\b/.test(line)).length;
      assert.equal(marked('≈ uncertain'), model.uncertain, 'uncertain rows flagged on their own line');
      assert.equal(marked('◌ unseen?'), model.possiblyUnseen, 'possibly unseen rows flagged on their own line');
    } finally { await narrow.stop(); }
  });
}
