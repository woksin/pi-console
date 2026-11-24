import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSince, overviewViewModel } from '@pi-console/viewmodels';
import { generate, needsYou } from '@pi-console/testkit';
import type { AttentionItem } from '@pi-console/contract';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { attentionPage } from './overview-attention.ts';

const base = needsYou(generate().fixture).items[0];
const items: AttentionItem[] = [
  { ...base, id: 'request A', reason: 'open-request', since: '2026-11-20T09:00:00Z' },
  { ...base, id: 'question B', reason: 'blocking-question', since: '2026-11-20T10:00:00Z' },
  { ...base, id: 'request C', reason: 'open-request', since: '2026-11-20T11:00:00Z' },
  { ...base, id: 'unseen D', reason: 'answer-possibly-unseen', since: '2026-11-20T12:00:00Z' },
];
const cards = overviewViewModel({ needsYou: items, sessions: [], repositories: 0, now: Date.parse('2026-11-20T12:00:00Z') }).cards;
const page = (cursor: number, height: number) => attentionPage({
  cards, cursor, width: 90, height, fresh: newSince(null, []), flashing: () => false,
  env: { data: new Store().getSnapshot(), ui: initial, width: 90, height, now: 0, phase: 0, click: () => undefined },
});
const text = (lines: ReturnType<typeof attentionPage>['lines']) => lines.map(line => line.map(part => part.text).join('')).join('\n');

test('TUI shows one counted heading per shared reason and maps card lines, not headings, to navigation indices', () => {
  const result = page(0, 30);
  assert.match(text(result.lines), /BLOCKING QUESTION \(1\)/);
  assert.equal(text(result.lines).match(/OPEN REQUESTS \(2\)/g)?.length, 1);
  assert.match(text(result.lines), /POSSIBLY UNSEEN \(1\)\n.*¿ Possibly unseen/);
  assert.deepEqual(result.indices, [null, 0, 0, 0, null, 1, 1, 1, 2, 2, 2, null, 3, 3, 3]);
  assert.deepEqual(cards.map(card => card.id), ['question B', 'request C', 'request A', 'unseen D']);
});

test('short viewports keep the selected card, full group count and aligned click indices across reason boundaries', () => {
  for (let cursor = 0; cursor < cards.length; cursor++) {
    const result = page(cursor, 7);
    assert.ok(result.lines.length <= 7);
    assert.ok(result.indices.includes(cursor));
    assert.ok(result.end > cursor);
    if (cursor === 1 || cursor === 2) assert.match(text(result.lines), /OPEN REQUESTS \(2\)/);
  }
});
