import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionViewModel, transcriptLines } from './session.ts';
import { fixture, golden, now } from '../test-support.ts';

const session = fixture.sessions.find(item => item.id === 's2')!;
const detail = {
  session, requests: fixture.requests.filter(r => r.sessionId === 's2'), questions: fixture.questions.filter(q => q.sessionId === 's2'),
  jobs: fixture.jobs.filter(j => j.sessionId === 's2'), resets: fixture.resets.filter(r => r.sessionId === 's2'), subagents: fixture.sessions.filter(s => s.parentSessionId === 's2'),
};
const transcript = fixture.transcript.filter(entry => entry.sessionId === 's2').slice(0, 40);

test('session view model: header, context pressure, requests, resets and transcript', () => {
  const model = sessionViewModel({ detail, transcript, now });
  assert.equal(model.id, 's2');
  assert.ok(model.requests.length > 0 && model.resets.length > 0);
  assert.ok(model.transcript.length > 0);
  golden('session', model);
});

test('streaming deltas collapse to one line and a final assistant entry replaces them', () => {
  const base = { sessionId: 's', at: '2026-01-01T00:00:00Z', toolCallId: null, resetId: null, requestId: null, toolResult: null } as const;
  const lines = transcriptLines([
    { ...base, id: 'a', cursor: 1, kind: 'assistant.delta', text: 'Hel' }, { ...base, id: 'b', cursor: 2, kind: 'assistant.delta', text: 'lo' },
  ]);
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].text, lines[0].streaming], ['Hello', true]);
  const final = transcriptLines([{ ...base, id: 'a', cursor: 1, kind: 'assistant.delta', text: 'Hel' }, { ...base, id: 'c', cursor: 3, kind: 'assistant', text: 'Hello.' }]);
  assert.deepEqual(final.map(line => [line.text, line.streaming]), [['Hello.', false]]);
});

test('hostile transcript text and withheld results are neutralised', () => {
  const base = { sessionId: 's', at: '2026-01-01T00:00:00Z', toolCallId: null, resetId: null, requestId: null } as const;
  const lines = transcriptLines([
    { ...base, id: 'x', cursor: 1, kind: 'assistant', text: 'ok\u001b]52;c;ZXZpbA==\u0007\u001b[2Jdone', toolResult: null },
    { ...base, id: 'y', cursor: 2, kind: 'tool.result', text: 'sk-live-AAAA', toolResult: { toolName: 'env', argsExcerpt: '', resultKind: 'text', resultExcerpt: 'sk-live-AAAA', truncated: false, withheld: true } },
  ]);
  assert.equal(lines[0].text, 'okdone');
  assert.ok(!lines[1].text.includes('sk-live'));
});

test('search keeps matching lines and reset markers', () => {
  const model = sessionViewModel({ detail, transcript, now, search: 'queue' });
  assert.ok(model.transcript.every(line => line.kind === 'reset' || line.text.toLowerCase().includes('queue')));
});
