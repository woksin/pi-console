import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import type { QuestionRow, TranscriptLine } from '@pi-console/viewmodels';

let server: ViteDevServer;
let QuestionHistory: ComponentType<{ row: QuestionRow }>;
let Transcript: ComponentType<{ lines: readonly TranscriptLine[]; focusEntry: string | null; searching: boolean }>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ Transcript } = await server.ssrLoadModule('/src/views/transcript.tsx'));
  ({ QuestionHistory } = await server.ssrLoadModule('/src/views/questions.tsx'));
});
after(async () => { await server.close(); });

const line = (key: number, at: string, time: string, kind = 'assistant'): TranscriptLine => ({
  id: `e${String(key)}`, cursor: key, key, at, time, kind, glyph: '', label: kind, color: 'text', text: `text ${String(key)}`, streaming: false, requestId: null, resetId: null,
  reset: kind === 'reset' ? { kind: 'compaction', summary: 'compaction · 0 carried · 0 interrupted', carried: [], interrupted: [] } : null, tool: null,
}) as unknown as TranscriptLine;

const html = (lines: TranscriptLine[]): string => renderToStaticMarkup(createElement(Transcript, { lines, focusEntry: null, searching: false }));

test('each line time keeps the source ISO and a readable absolute title; line ids and day headings do not collide', () => {
  const markup = html([line(1, '2026-11-19T23:59:50Z', '23:59:50'), line(2, '2026-11-20T00:00:10Z', '00:00:10'), line(3, '2026-11-20T00:10:00Z', '00:10:00', 'reset')]);
  assert.match(markup, /<time dateTime="2026-11-19T23:59:50Z" title="19 Nov 2026 23:59:50 UTC">23:59:50<\/time>/);
  assert.match(markup, /<time dateTime="2026-11-20T00:00:10Z" title="20 Nov 2026 00:00:10 UTC">00:00:10<\/time>/);
  assert.match(markup, /<time dateTime="2026-11-20T00:10:00Z" title="20 Nov 2026 00:10:00 UTC">00:10:00<\/time>/, 'the reset divider too');
  assert.deepEqual([...markup.matchAll(/<h2 class="tday-head">([^<]+)<\/h2>/g)].map(found => found[1]), ['19 Nov 2026', '20 Nov 2026']);
  assert.deepEqual([...markup.matchAll(/id="(line-\d+)"/g)].map(found => found[1]), ['line-1', 'line-2', 'line-3']);
});

test('question history shows the readable absolute time with its zone beside the relative age, keeping the ISO in dateTime', () => {
  const history = [{ key: '1', operation: 'commented', at: '2026-11-08T14:00:00Z', time: '8 Nov 2026 14:00:00 UTC', age: '12d', actor: 'L0', excerpt: null, withheld: false, shortened: false }];
  const markup = renderToStaticMarkup(createElement(QuestionHistory, { row: { id: 'q1', history } as unknown as QuestionRow }));
  assert.match(markup, /<time dateTime="2026-11-08T14:00:00Z" title="8 Nov 2026 14:00:00 UTC">8 Nov 2026 14:00:00 UTC<\/time>/);
  assert.match(markup, /\(12d ago\)/);
  assert.doesNotMatch(markup, />2026-11-08T14:00:00Z</);
});

test('only the last line of the whole transcript is the always-laid-out tail, whatever the day sections', () => {
  const markup = html([line(1, '2026-11-19T23:59:50Z', '23:59:50'), line(2, '2026-11-20T00:00:10Z', '00:00:10'), line(3, '2026-11-20T00:10:00Z', '00:10:00')]);
  assert.deepEqual([...markup.matchAll(/id="(line-\d+)" class="tline[^"]*tline-tail/g)].map(found => found[1]), ['line-3']);
  assert.doesNotMatch(markup, /<section[^>]*aria-label/);
});
