import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Job } from '@pi-console/contract';
import { isActive, mergeHistory, mergeSnapshot } from './window.ts';

const job = (id: string, status: Job['status'], startedAt: string): Job => ({ id, sessionId: 's1', kind: 'job', name: id, status, startedAt, exitCode: null });

test('a bounded snapshot wins by id, keeps loaded history and drops rows that were active but are gone', () => {
  const previous = [job('old', 'done', '2026-01-01T00:00:00Z'), job('stale', 'running', '2026-01-02T00:00:00Z'), job('now', 'running', '2026-01-03T00:00:00Z')];
  const incoming = [job('now', 'done', '2026-01-03T00:00:00Z'), job('new', 'running', '2026-01-04T00:00:00Z')];
  assert.deepEqual(mergeSnapshot('jobs', previous, incoming).map(item => `${item.id}:${item.status}`), ['old:done', 'now:done', 'new:running']);
});

test('history rows never overwrite rows already held, and the list stays sorted', () => {
  const current = [job('b', 'running', '2026-01-02T00:00:00Z')];
  const merged = mergeHistory(current, [job('b', 'done', '2026-01-02T00:00:00Z'), job('a', 'done', '2026-01-01T00:00:00Z')]);
  assert.deepEqual(merged.map(item => `${item.id}:${item.status}`), ['a:done', 'b:running']);
});

test('the active rule matches the daemon for every collection', () => {
  assert.ok(isActive('jobs', { id: 'j', status: 'running' } as never));
  assert.ok(!isActive('jobs', { id: 'j', status: 'queued' } as never));
  assert.ok(isActive('requests', { id: 'r', status: 'unanswered' } as never) && !isActive('requests', { id: 'r', status: 'answered' } as never));
  assert.ok(isActive('questions', { id: 'q', status: 'open' } as never) && !isActive('questions', { id: 'q', status: 'closed' } as never));
  assert.ok(isActive('messages', { id: 'm', status: 'sent' } as never) && !isActive('messages', { id: 'm', status: 'read' } as never));
  assert.ok(isActive('sessions', { id: 's', status: 'working' } as never) && !isActive('sessions', { id: 's', status: 'idle' } as never));
});
