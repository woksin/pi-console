import assert from 'node:assert/strict';
import test from 'node:test';
import { questionMapper } from '@pi-console/adapters';
import { assessMoot, type LinkObservation } from '@pi-console/contract';
import { safeJson } from './output.ts';

const now = Date.parse('2026-01-02T12:00:00Z');
const closed: LinkObservation = { target: 'a/b#1', kind: 'issue', state: 'closed', closedAt: '2026-01-01T00:00:00Z', fetchedAt: '2026-01-02T11:30:00Z', source: 'github-gh' };
const row = (links: string[]) => ({
  v: 1, id: 'q-1', rev: 1, type: 'question', priority: 'normal', blocking: '', text: 'Synthetic?', links,
  history: [{ seq: 1, type: 'created', ts: '2026-07-01T10:00:00Z' }],
});

/** The links exactly as ingestion stores them and as the API then serves them. */
function servedLinks(links: string[]): string[] {
  const snapshot = questionMapper(row(links)).find(item => item.type === 'QuestionSnapshotObserved');
  const stored = (snapshot?.payload as { links: string[] }).links;
  return (JSON.parse(safeJson({ links: stored })) as { links: string[] }).links;
}

// The same `assessMoot` runs in the daemon worker, the TUI and the web viewmodels, so the served links are what every consumer assesses.
for (const char of ['\u202e', '\u0085', '\u2066']) {
  test(`a/b#1 followed by U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} beside closed evidence is never moot after ingestion and the API`, () => {
    const links = servedLinks(['a/b#1', `a/b#1${char}`]);
    const result = assessMoot(links, [closed], now);
    assert.equal(result.moot, false);
    assert.equal(result.reason, 'unsupported-links');
  });
}

test('closed evidence for a link that survives ingestion and the API unchanged is still moot', () => {
  assert.equal(assessMoot(servedLinks(['a/b#1']), [closed], now).moot, true);
});
