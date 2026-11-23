import type { TranscriptEntry } from '@pi-console/contract';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetMarks, sessionViewModel, transcriptLines } from './session.ts';
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

test('a line key is stable while a run streams and when the final assistant entry replaces it', () => {
  const base = { sessionId: 's', at: '2026-01-01T00:00:00Z', toolCallId: null, resetId: null, requestId: null, toolResult: null } as const;
  const delta = (cursor: number): TranscriptEntry => ({ ...base, id: `d${String(cursor)}`, cursor, kind: 'assistant.delta', text: 'x' });
  const keyOf = (entries: TranscriptEntry[]) => transcriptLines(entries).map(line => line.key);
  assert.deepEqual([keyOf([delta(5)]), keyOf([delta(5), delta(6)]), keyOf([delta(5), delta(6), delta(7)])], [[5], [5], [5]]);
  assert.deepEqual(keyOf([delta(5), delta(6), { ...base, id: 'f', cursor: 8, kind: 'assistant', text: 'xx' }]), [5]);
  assert.deepEqual(keyOf([{ ...base, id: 'u', cursor: 4, kind: 'user', text: 'q' }, delta(5), { ...base, id: 't', cursor: 6, kind: 'thinking', text: 'h' }, { ...base, id: 'f', cursor: 7, kind: 'assistant', text: 'a' }]), [4, 5, 6, 7], 'an assistant entry after other entries is its own line');
});

test('a streaming run continues only within one request; aborts and other entries end it', () => {
  const base = { sessionId: 's', at: '2026-01-01T00:00:00Z', toolCallId: null, resetId: null, toolResult: null } as const;
  const e = (cursor: number, kind: TranscriptEntry['kind'], requestId: string | null, text = String(cursor)): TranscriptEntry => ({ ...base, id: `e${String(cursor)}`, cursor, kind, text, requestId });
  const d = 'assistant.delta';
  const table: { name: string; entries: TranscriptEntry[]; lines: [number, string][] }[] = [
    { name: 'aborted r1 then r2 delta and final', entries: [e(5, d, 'r1', 'p'), e(6, d, 'r2', 'q'), e(7, 'assistant', 'r2', 'Q.')], lines: [[5, 'p'], [6, 'Q.']] },
    { name: 'r1 r1 r2 then r2 final', entries: [e(1, d, 'r1', 'a'), e(2, d, 'r1', 'b'), e(3, d, 'r2', 'c'), e(4, 'assistant', 'r2', 'C.')], lines: [[1, 'ab'], [3, 'C.']] },
    { name: 'no requestId then requestId', entries: [e(1, d, null, 'a'), e(2, d, 'r1', 'b')], lines: [[1, 'a'], [2, 'b']] },
    { name: 'final of another request does not inherit', entries: [e(1, d, 'r1', 'a'), e(2, 'assistant', 'r2', 'B.')], lines: [[1, 'a'], [2, 'B.']] },
    { name: 'reset between deltas of one request', entries: [e(1, d, 'r1', 'a'), e(2, 'reset', 'r1', 'reset'), e(3, d, 'r1', 'b')], lines: [[1, 'a'], [2, 'reset'], [3, 'b']] },
    { name: 'same request continues', entries: [e(1, d, 'r1', 'a'), e(2, d, 'r1', 'b'), e(3, 'assistant', 'r1', 'AB')], lines: [[1, 'AB']] },
  ];
  for (const row of table) assert.deepEqual(transcriptLines(row.entries).map(line => [line.key, line.text]), row.lines, row.name);
});

test('transcript edge cases: null requests, a standalone final, a final after a reset, interleaved requests', () => {
  const base = { sessionId: 's', at: '2026-01-01T00:00:00Z', toolCallId: null, resetId: null, toolResult: null } as const;
  const e = (cursor: number, kind: TranscriptEntry['kind'], requestId: string | null, text = String(cursor)): TranscriptEntry => ({ ...base, id: `e${String(cursor)}`, cursor, kind, text, requestId });
  const d = 'assistant.delta';
  const table: { name: string; entries: TranscriptEntry[]; lines: [number, string, boolean][] }[] = [
    { name: 'null requestId deltas form one run and a null final replaces it', entries: [e(1, d, null, 'a'), e(2, d, null, 'b'), e(3, 'assistant', null, 'AB')], lines: [[1, 'AB', false]] },
    { name: 'a null run and a null final after a user entry are separate lines', entries: [e(1, d, null, 'a'), e(2, 'user', null, 'q'), e(3, 'assistant', null, 'A')], lines: [[1, 'a', true], [2, 'q', false], [3, 'A', false]] },
    { name: 'a standalone final keeps its own key', entries: [e(7, 'assistant', 'r1', 'A')], lines: [[7, 'A', false]] },
    { name: 'a final after a reset does not take over the run before it', entries: [e(1, d, 'r1', 'a'), e(2, 'reset', 'r1', 'reset'), e(3, 'assistant', 'r1', 'A')], lines: [[1, 'a', true], [2, 'reset', false], [3, 'A', false]] },
    { name: 'interleaved requests start a new run at every switch', entries: [e(1, d, 'r1', 'a'), e(2, d, 'r2', 'b'), e(3, d, 'r1', 'c'), e(4, d, 'r2', 'd')], lines: [[1, 'a', true], [2, 'b', true], [3, 'c', true], [4, 'd', true]] },
    { name: 'interleaved requests: a final replaces only the directly preceding run', entries: [e(1, d, 'r1', 'a'), e(2, d, 'r2', 'b'), e(3, 'assistant', 'r1', 'A')], lines: [[1, 'a', true], [2, 'b', true], [3, 'A', false]] },
  ];
  for (const row of table) assert.deepEqual(transcriptLines(row.entries).map(line => [line.key, line.text, line.streaming]), row.lines, row.name);
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

test('a reset at 09:00:18 shows a divider naming what it carried and interrupted', () => {
  const model = sessionViewModel({ detail, transcript: fixture.transcript.filter(entry => entry.sessionId === 's2').slice(0, 120), now });
  const divider = model.transcript.find(line => line.kind === 'reset');
  assert.ok(divider?.reset, 'the reset line carries its divider');
  assert.equal(divider.time, '09:00:18');
  assert.equal(divider.reset.summary, 'handoff · 2 carried · 1 interrupted');
  assert.deepEqual(divider.reset.carried.map(request => request.id), ['r1', 'r2']);
  assert.deepEqual(divider.reset.interrupted, [{ id: 'r1', text: 'Compare the queue strategies and explain the trade-offs.' }]);
  assert.ok(model.transcript.filter(line => line.kind !== 'reset').every(line => line.reset === null));
});

test('a reset the detail does not list keeps a plain divider', () => {
  const model = sessionViewModel({ detail: { ...detail, resets: [] }, transcript: fixture.transcript.filter(entry => entry.sessionId === 's2').slice(0, 120), now });
  assert.equal(model.transcript.find(line => line.kind === 'reset')?.reset, null);
});

test('resets tick the context sparkline at the sample before them', () => {
  assert.deepEqual(sessionViewModel({ detail, transcript, now }).context.resetMarks, [0]);
  const samples = ['09:00', '09:01', '09:02'].map(time => ({ at: `2026-11-20T${time}:00.000Z` }));
  const reset = (at: string) => ({ ...detail.resets[0], at: `2026-11-20T${at}.000Z` });
  assert.deepEqual(resetMarks(samples, [reset('09:01:30'), reset('09:01:59'), reset('08:59:00'), reset('09:05:00')]), [1]);
  assert.deepEqual(resetMarks([], [reset('09:01:00')]), []);
});

test('every line keeps the source ISO timestamp: streaming takes the last delta, a final entry its own', () => {
  const base = { sessionId: 's', toolCallId: null, resetId: null, requestId: null, toolResult: null } as const;
  const [streaming] = transcriptLines([
    { ...base, id: 'a', cursor: 1, at: '2026-01-01T23:59:58+01:00', kind: 'assistant.delta', text: 'Hel' }, { ...base, id: 'b', cursor: 2, at: '2026-01-02T00:00:05.250Z', kind: 'assistant.delta', text: 'lo' },
  ]);
  assert.deepEqual([streaming.at, streaming.time, streaming.key], ['2026-01-02T00:00:05.250Z', '00:00:05', 1]);
  const [final] = transcriptLines([
    { ...base, id: 'a', cursor: 1, at: '2026-01-01T10:00:00Z', kind: 'assistant.delta', text: 'Hel' }, { ...base, id: 'c', cursor: 3, at: '2026-01-01T10:00:09Z', kind: 'assistant', text: 'Hello.' },
  ]);
  assert.deepEqual([final.at, final.time, final.key], ['2026-01-01T10:00:09Z', '10:00:09', 1]);
});

test('filtering keeps the original timestamp of the surviving lines', () => {
  const all = new Map(sessionViewModel({ detail, transcript, now }).transcript.map(item => [item.key, item.at]));
  const filtered = sessionViewModel({ detail, transcript, now, search: transcript[3].text.slice(0, 6) }).transcript;
  assert.ok(filtered.length > 0 && filtered.length < all.size);
  for (const item of filtered) assert.equal(item.at, all.get(item.key));
});
