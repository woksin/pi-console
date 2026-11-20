import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startHarness, type Harness } from './testing/harness.ts';

/** The goldens are the view-model contract shared with the web UI; the TUI must show what they say, in its own layout. */
const golden = <T>(view: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../../viewmodels/src/${view}/golden.json`, import.meta.url)), 'utf8')) as T;
const flat = (text: string) => text.replace(/[│╭╮╰╯─▌]/g, ' ').replace(/\s+/g, ' ');
const lead = (text: string, length = 24) => text.slice(0, length).trim();

let harness: Harness;
before(async () => { harness = await startHarness({ width: 200, height: 160 }); });
after(async () => { await harness.stop(); });

const section = async (key: string, marker: string) => { await harness.ui.press(key); return flat(await harness.ui.waitFor(marker)); };

test('overview shows the headline and every attention card', async () => {
  const model = golden<{ headline: string; cards: { text: string; title: string }[] }>('overview');
  const frame = await section('1', 'need you');
  assert.ok(frame.includes(model.headline), model.headline);
  for (const card of model.cards) assert.ok(frame.includes(lead(card.text)), card.text);
});

test('fleet lists every repository group and session', async () => {
  const model = golden<{ rows: { kind: string; label?: string; name?: string }[] }>('fleet');
  const frame = await section('2', 'Fleet ·');
  for (const row of model.rows) {
    const label = row.kind === 'group' ? row.label : row.name;
    assert.ok(label && frame.includes(label), String(label));
  }
});

test('requests, questions and messages show their goldens', async () => {
  const requests = golden<{ rows: { text: string }[] }>('request-list');
  let frame = await section('3', 'Requests');
  for (const row of requests.rows) assert.ok(frame.includes(lead(row.text)), row.text);
  const questions = golden<{ rows: { text: string }[] }>('questions');
  frame = await section('4', 'Questions');
  for (const row of questions.rows) assert.ok(frame.includes(lead(row.text)), row.text);
  const messages = golden<{ rows: { text: string }[] }>('messages');
  frame = await section('5', 'Messages');
  for (const row of messages.rows.slice(0, 20)) assert.ok(frame.includes(lead(row.text, 16)), row.text);
});
