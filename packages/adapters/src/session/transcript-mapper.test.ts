import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptEntry } from './transcript-mapper.ts';
import { redactValue } from '../tailing/redact.ts';

const at = '2026-01-02T03:04:05.000Z';
const row = (role: string, content: unknown, extra = {}) => ({ type: 'message', id: 'source-id', timestamp: at, message: { role, content, ...extra } });
const map = (value: unknown) => transcriptEntry(redactValue(value), 'session', 17);

test('displayable records preserve IDs/timestamps and one byte cursor per source line', () => {
  assert.deepEqual(map(row('user', 'hi')), { id: 'source-id', cursor: 18, sessionId: 'session', at, kind: 'user', text: 'hi', toolCallId: null, resetId: null });
  assert.equal(map(row('assistant', 'answer'))?.kind, 'assistant');
  assert.equal(map(row('assistant', [{ type: 'thinking', thinking: 'reason' }]))?.kind, 'thinking');
  const call = map(row('assistant', [{ type: 'toolCall', id: 'call', name: 'read', arguments: { password: 'never returned' } }]));
  assert.equal(call?.kind, 'tool.call');
  assert.equal(call?.toolCallId, 'call');
  assert.equal(call?.text, 'Tool call: read');
  assert.equal(map(row('toolResult', 'result', { toolCallId: 'call', toolName: 'read' }))?.kind, 'tool.result');
  assert.deepEqual(map({ type: 'compaction', id: 'reset', timestamp: at, summary: 'new context' }), { id: 'reset', cursor: 18, sessionId: 'session', at, kind: 'reset', text: 'new context', resetId: 'reset', toolCallId: null });
});

test('mixed assistant records stay one deterministic labeled row in block order', () => {
  const result = map(row('assistant', [{ type: 'thinking', thinking: 'reason' }, { type: 'text', text: 'answer' }, { type: 'toolCall', id: 'call', name: 'read' }]));
  assert.equal(result?.text, 'Thinking: reason\nText: answer\nTool call: read');
  assert.equal(result?.kind, 'assistant');
});

test('empty text blocks remain valid rather than discarding mixed rows', () => {
  assert.equal(map(row('user', ''))?.text, '');
  assert.equal(map(row('toolResult', ''))?.text, '');
  assert.equal(map(row('assistant', [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'answer' }]))?.text, 'Thinking: \nText: answer');
});

test('malformed, metadata, unsupported and withheld records have no raw fallback', () => {
  for (const value of [null, { type: 'session' }, { withheld: true }, row('unknown', 'no'), row('assistant', [{ type: 'image', data: 'private' }]), { ...row('user', 'no'), timestamp: 'bad' }, { ...row('user', 'no'), id: '' }]) {
    assert.equal(map(value), undefined);
  }
});

test('summaries rescan across block boundaries and never leak credentials beyond truncation', () => {
  const secret = 'ghp_' + 'x'.repeat(36);
  const record = row('assistant', [{ type: 'text', text: 'x'.repeat(190) }, { type: 'text', text: secret }]);
  const result = map(record)!;
  assert.ok(result.text.length <= 200);
  assert.ok(!JSON.stringify(result).includes(secret));
});
