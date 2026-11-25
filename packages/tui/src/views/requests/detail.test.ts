import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Request } from '@pi-console/contract';
import { Store } from '../../store/store.ts';
import { initial } from '../../state/ui.ts';
import { requestDetailLines } from './detail.ts';

test('request detail separates inferred classification, its qualifier and the plain-language evidence', () => {
  const store = new Store();
  try {
    const { fixture } = generate();
    const request = { ...fixture.requests[0], derivedFrom: 'session-jsonl' } as unknown as Request;
    const env = { data: store.getSnapshot(), ui: initial, width: 120, height: 30, now: Date.parse(fixture.generatedAt), phase: 0, click: () => undefined };
    const lines = requestDetailLines(request, env, 80);
    const rows = lines.map(line => line.map(part => part.text).join(''));
    assert.equal(rows[1], 'Human request · classified from transcript');
    assert.equal(rows[2], '(not verified)');
    assert.equal(lines[2][0].color, 'faint');
    assert.equal(rows[3], 'Source says: The source explicitly marks this prompt as user input.');
    assert.doesNotMatch(rows.join('\n'), /Classified as|synthetic|user-input/);
  } finally { store.dispose(); }
});
