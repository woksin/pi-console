import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Job, Session } from '@pi-console/contract';
import { Store } from '../store/store.ts';
import { commit, initial, reduce, typing, type Bounds, type UiState } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import type { SectionView } from './common.ts';
import { workView } from './work.ts';

const base = (generate().fixture as unknown as { sessions: Session[] }).sessions[0];
const sessions: Session[] = [
  { ...base, id: 'session-failure', name: 'Atlas owner' },
  { ...base, id: 'session-active', name: 'Beta owner' },
  { ...base, id: 'session-finished', name: 'Gamma owner' },
];
const jobs: Job[] = [
  { id: 'job-finish', sessionId: sessions[2].id, name: 'audit Gamma', kind: 'phase', status: 'done', startedAt: base.updatedAt, exitCode: 0 },
  { id: 'job-run', sessionId: sessions[1].id, name: 'deploy Beta', kind: 'job', status: 'running', startedAt: base.updatedAt, exitCode: null },
  { id: 'job-needle', sessionId: sessions[0].id, name: 'compile Alpha', kind: 'ci', status: 'failed', startedAt: base.updatedAt, exitCode: 9 },
];
const store = new Store();
const data = { ...store.getSnapshot(), jobs, sessions };
store.dispose();
const workUi: UiState = { ...initial, section: 'work' };
const viewOf = (ui: UiState = workUi, width = 140) => workView({ data, ui, width, height: 24, now: Date.parse(base.updatedAt), phase: 0, click: () => undefined });
const boundsOf = (view: SectionView): Bounds => ({ length: view.length, page: 10, fit: { start: 0, span: 1000 }, width: 140, rowAt: view.rowAt, transcript: { keys: [], ends: [] }, viewport: 10 });
const sessionIds = (view: SectionView) => Array.from({ length: view.length }, (_, index) => view.rowAt(index).sessionId);

for (const [query, sessionId] of [
  ['ALPHA', sessions[0].id], ['Atlas owner', sessions[0].id], ['job-needle', sessions[0].id],
  ['session-active', sessions[1].id], ['CI', sessions[0].id], ['FAILED', sessions[0].id],
  ['exit 9', sessions[0].id], ['  GAMMA  ', sessions[2].id],
]) {
  test(`Work filters displayed rows case-insensitively by ${query}`, () => {
    const view = viewOf({ ...workUi, filter: query });
    assert.deepEqual(sessionIds(view), [sessionId]);
    assert.deepEqual(view.rowAt(1), { sessionId: null, groupId: null });
  });
}

test('Work previews the draft, cancels or commits it, and opens the filtered selection', () => {
  const committed = { ...workUi, filter: 'Beta', cursor: { ...workUi.cursor, work: 2 } };
  let preview = reduce(committed, 'filter.open', boundsOf(viewOf()));
  for (let remaining = preview.input.length; remaining > 0; remaining--) preview = typing(preview, 'Backspace', undefined);
  for (const character of 'ALPHA') preview = typing(preview, character, character);
  assert.equal(preview.cursor.work, 0);
  assert.deepEqual(sessionIds(viewOf(preview)), [sessions[0].id]);
  const cancelled = reduce(preview, 'back', boundsOf(viewOf(preview)));
  assert.equal(cancelled.filter, 'Beta');
  assert.deepEqual(sessionIds(viewOf(cancelled)), [sessions[1].id]);
  const accepted = commit(preview);
  assert.equal(accepted.filter, 'ALPHA');
  const filtered = viewOf(accepted);
  assert.equal(reduce(accepted, 'open', boundsOf(filtered)).sessionId, sessions[0].id);
  const cleared = reduce(accepted, 'back', boundsOf(filtered));
  assert.equal(cleared.filter, '');
  assert.deepEqual(sessionIds(viewOf(cleared)), sessions.map(session => session.id), 'unfiltered status ordering is unchanged');
});

for (const width of [80, 140]) {
  test(`Work renders only matching rows and a truthful selection at ${String(width)} columns`, async () => {
    const view = viewOf({ ...workUi, filter: 'beta' }, width);
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 24 });
    try {
      await ui.settle();
      const frame = ui.frame();
      assert.match(frame, /deploy Beta/);
      assert.doesNotMatch(frame, /compile Alpha|audit Gamma/);
      assert.match(frame, /▌.*Running.*deploy Beta/);
      assert.equal(view.length, 1);
    } finally { ui.destroy(); }
  });
}

test('a Work filter with no matches has no selectable row', () => {
  const state = { ...workUi, filter: 'missing' };
  const view = viewOf(state);
  assert.equal(view.length, 0);
  assert.deepEqual(view.rowAt(0), { sessionId: null, groupId: null });
  assert.equal(reduce(state, 'open', boundsOf(view)).sessionId, null);
});
