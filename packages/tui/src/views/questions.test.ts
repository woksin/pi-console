import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Question, Snapshot } from '@pi-console/contract';
import { App } from '../app.ts';
import { Store } from '../store/store.ts';
import { h, mountHeadless } from '../view/renderer.ts';

const demoSnapshot = generate().fixture as unknown as Snapshot;
const paragraphs = Array.from({ length: 30 }, (_, index) => `Question-paragraph-${String(index).padStart(2, '0')} with full text.`);
const options = Array.from({ length: 12 }, (_, index) => `Option ${String(index).padStart(2, '0')} ${'complete option text '.repeat(5)}END-${String(index)}`);
const question: Question = { id: 'q-detail', sessionId: demoSnapshot.sessions[0].id, kind: 'question', text: paragraphs.join('\n'), options, urgency: 'normal', blocking: false, status: 'open', createdAt: demoSnapshot.generatedAt };

async function setup(width: number) {
  const store = new Store();
  store.apply({ seq: 1, type: 'snapshot', occurredAt: demoSnapshot.generatedAt, payload: { ...demoSnapshot, questions: [question] } });
  store.flush();
  const opened: string[] = [];
  const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { section: 'questions' }, loadTranscript: (id: string) => { opened.push(id); }, loadMemory: () => undefined, onQuit: () => undefined }), { width, height: 24 });
  await ui.settle();
  return { ui, store, opened };
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

test('wide Questions keeps the side panel and Enter still opens the session', async () => {
  const { ui, store, opened } = await setup(140);
  try {
    assert.match(ui.frame(), /OPTIONS/);
    await ui.press('RETURN');
    assert.deepEqual(opened, [question.sessionId]);
  } finally { ui.destroy(); store.dispose(); }
});
